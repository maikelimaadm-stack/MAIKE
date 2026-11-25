/**
 * D-PROD-309 — sincronização incremental das listas grandes.
 *
 * Antes, cada leitura com internet de `/lotes`, `/pontos-suplementacao`, `/leituras-cocho` e
 * `/suplementacao-eventos` baixava a lista INTEIRA — e a mesma lista era pedida pelo cache
 * das entidades, pelo mapa e pelas telas (até três vezes por sincronização). Com milhões de
 * registros por cliente, não escala.
 *
 * Agora, para esses caminhos, o aparelho guarda a lista e a MARCA (instante do servidor) da
 * última sincronização, e pede só `GET /…/mudancas?desde=marca` (páginas): junta os itens
 * novos e alterados pelo id, tira os excluídos, ordena como a listagem do servidor e devolve
 * a lista inteira — quem chama não percebe diferença. Sem marca (primeira vez, ou a cópia
 * foi gravada por uma leitura comum), as mesmas páginas trazem tudo.
 *
 * Tudo isto acontece dentro de `nativeRequest` (um ponto só): as três camadas ganham juntas.
 */

/** Sobe quando a forma guardada muda: a cópia antiga é descartada e a lista vem toda. */
export const FORMATO_INCREMENTAL = 1;

/** Tamanho da página pedida ao servidor. */
const LIMITE_POR_PAGINA = 1000;
/** Segurança: uma sincronização nunca pede mais que isto de páginas (1 milhão de registros). */
const MAX_PAGINAS = 1000;

/** @param {string} a @param {string} b */
const desc = (a, b) => (a < b ? 1 : a > b ? -1 : 0);
const texto = (v) => (v === null || v === undefined ? '' : String(v));

/** Ordem da listagem do servidor: createdAt DESC, id DESC. */
const porCriacao = (/** @type {any} */ a, /** @type {any} */ b) =>
  desc(texto(a?.created_date), texto(b?.created_date)) || desc(texto(a?.id), texto(b?.id));

/**
 * Caminhos com sincronização incremental: a lista (sem filtros) → a rota de mudanças e a
 * ordem da listagem do servidor.
 * @type {Readonly<Record<string, {mudancas: string, ordem: (a: any, b: any) => number}>>}
 */
export const CAMINHOS_INCREMENTAIS = Object.freeze({
  '/lotes': { mudancas: '/lotes/mudancas', ordem: porCriacao },
  '/pontos-suplementacao': { mudancas: '/pontos-suplementacao/mudancas', ordem: porCriacao },
  '/suplementacao-eventos': { mudancas: '/suplementacao-eventos/mudancas', ordem: porCriacao },
  // Leituras: dia da leitura DESC, depois createdAt DESC, id DESC.
  '/leituras-cocho': {
    mudancas: '/leituras-cocho/mudancas',
    ordem: (a, b) => desc(texto(a?.data_leitura), texto(b?.data_leitura)) || porCriacao(a, b),
  },
});

/**
 * A resposta de `/…/mudancas` tem a forma do contrato? (Senão, quem chama cai na lista inteira.)
 * @param {any} r
 */
const respostaValida = (r) =>
  Boolean(r) &&
  typeof r === 'object' &&
  !Array.isArray(r) &&
  typeof r.agora === 'string' &&
  !Number.isNaN(Date.parse(r.agora)) &&
  Array.isArray(r.itens) &&
  Array.isArray(r.excluidos) &&
  (r.proximo === null || typeof r.proximo === 'string');

/** @param {string} caminho */
// `hasOwnProperty.call` (não `Object.hasOwn`): roda em WebView Android antigo (Chrome < 93).
export const incrementalDe = (caminho) =>
  Object.prototype.hasOwnProperty.call(CAMINHOS_INCREMENTAIS, caminho) ? CAMINHOS_INCREMENTAIS[caminho] : null;

/**
 * Lê a lista pelo que mudou desde a marca guardada.
 *
 * @param {{
 *   caminho: string,
 *   guardada?: {corpo: unknown, marca?: string|null, formato?: number|null},
 *   pedir: (caminho: string) => Promise<any>,
 * }} p `pedir`: GET na rede (sem cópia), com o timeout de quem chama.
 * @returns {Promise<{corpo: any[], marca: string}>}
 */
export const lerIncremental = async ({ caminho, guardada, pedir }) => {
  const inc = incrementalDe(caminho);
  if (!inc) throw new Error(`incremental: caminho sem registro "${caminho}"`);
  const podeContinuar =
    Boolean(guardada?.marca) && guardada?.formato === FORMATO_INCREMENTAL && Array.isArray(guardada?.corpo);

  /**
   * @param {string|null} desde
   * @returns {Promise<{corpo: any[], marca: string}|{recarregar: true}>}
   */
  const sincronizar = async (desde) => {
    /** @type {Map<string, any>} */
    const porId = new Map();
    if (desde) for (const item of /** @type {any[]} */ (guardada?.corpo ?? [])) if (item?.id != null) porId.set(String(item.id), item);
    let marca = null;
    let cursor = null;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const busca = new URLSearchParams();
      if (desde) busca.set('desde', desde);
      if (cursor) busca.set('cursor', cursor);
      busca.set('limite', String(LIMITE_POR_PAGINA));
      const resposta = await pedir(`${inc.mudancas}?${busca.toString()}`);
      if (!respostaValida(resposta)) throw new Error(`incremental: resposta fora do contrato em "${inc.mudancas}"`);
      if (resposta.recarregar) return { recarregar: true };
      // A marca nova é o "agora" da PRIMEIRA página: o que mudar durante as páginas seguintes
      // volta na próxima sincronização (a margem do servidor cobre o resto).
      if (marca === null) marca = resposta.agora;
      for (const id of resposta.excluidos) porId.delete(String(id));
      for (const item of resposta.itens) if (item?.id != null) porId.set(String(item.id), item);
      cursor = resposta.proximo;
      if (!cursor) break;
    }
    if (cursor) throw new Error(`incremental: páginas demais em "${caminho}"`);
    return { corpo: [...porId.values()].sort(inc.ordem), marca: /** @type {string} */ (marca) };
  };

  const r = await sincronizar(podeContinuar ? /** @type {string} */ (guardada?.marca) : null);
  if ('recarregar' in r) {
    const tudo = await sincronizar(null);
    if ('recarregar' in tudo) throw new Error(`incremental: o servidor pediu recarga sem "desde" em "${caminho}"`);
    return tudo;
  }
  return r;
};

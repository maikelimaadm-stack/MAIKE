/**
 * MAIKE-ENTREGA3 (D-PROD-276) — as regras PURAS da reforma de pastagem na tela (o agrupador): o nome sugerido, a
 * natureza ("recuperação: mesmo capim" ou "renovação: troca de capim"), o "Faz parte de" da Nova realização, a pergunta
 * da troca do capim na conclusão e o "Em reforma desde" do mapa. Quem decide é o servidor (`planejamentoService.js`): aqui
 * só se repete a regra para a prévia e se monta o corpo.
 */

import { safraDoDia } from './camposPorTipo.js';

/** Os tipos do "Planejar" (CHECK `Planejamento_tipo_check`), com o texto da tela. */
export const TIPOS_DE_REFORMA = Object.freeze([
  Object.freeze({ value: 'REFORMA', label: 'Reforma de pastagem' }),
  Object.freeze({ value: 'FORMACAO', label: 'Formação de pasto novo' }),
  Object.freeze({ value: 'OUTRO', label: 'Outro' }),
]);

/** O começo do nome sugerido, por tipo (o mesmo do servidor). */
export const PREFIXO_DA_REFORMA = Object.freeze(/** @type {Record<string, string>} */ ({ REFORMA: 'Reforma', FORMACAO: 'Formação', OUTRO: 'Planejamento' }));

/** O ciclo da reforma. */
export const STATUS_REFORMA = Object.freeze({ ABERTO: 'ABERTO', CONCLUIDO: 'CONCLUIDO', CANCELADO: 'CANCELADO' });

/** Como o status aparece na tela. */
export const ROTULO_DO_STATUS_DA_REFORMA = Object.freeze(/** @type {Record<string, string>} */ ({ ABERTO: 'Aberta', CONCLUIDO: 'Concluída', CANCELADO: 'Cancelada' }));

/** O teto de áreas numa reforma (o mesmo do servidor). */
export const AREAS_NA_REFORMA_MAXIMO = 20;

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** `2026-09-10` → `10/09`. @param {unknown} dia */
export const diaCurtoDaReforma = (dia) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(dia));
  return m ? `${m[3]}/${m[2]}` : '';
};

/**
 * O nome que o servidor dá à reforma: `<Reforma|Formação|Planejamento> · <Área 1>[ +N] · <safra>` ("Reforma · PASTO DA
 * AROEIRA · 2026/27"). Só para a prévia (o servidor ainda encurta a área se passar do teto). Sem área ou sem dia, vazio.
 * @param {string} tipo @param {string[]} areas os nomes, na ordem da tabela @param {string} dia o início previsto
 */
export const nomeSugeridoDaReforma = (tipo, areas, dia) => {
  const primeira = texto(areas[0]);
  const safra = safraDoDia(dia);
  if (!primeira || !safra) return '';
  return `${PREFIXO_DA_REFORMA[tipo] ?? PREFIXO_DA_REFORMA.OUTRO} · ${primeira}${areas.length > 1 ? ` +${areas.length - 1}` : ''} · ${safra}`;
};

/**
 * A natureza da reforma numa área, pelo capim que vai ficar e o capim de HOJE da área (Embrapa: recuperar = o mesmo
 * capim; renovar = trocar). Sem capim escolhido, nada.
 * @param {{ capimAlvoId?: string|null, capimAtualId?: string|null }} p
 * @returns {null|'recuperacao'|'renovacao'|'capim_novo'}
 */
export const naturezaDaReforma = ({ capimAlvoId, capimAtualId }) => {
  if (!texto(capimAlvoId)) return null;
  if (!texto(capimAtualId)) return 'capim_novo';
  return String(capimAlvoId) === String(capimAtualId) ? 'recuperacao' : 'renovacao';
};

/** O texto que aparece ao lado. */
export const TEXTO_DA_NATUREZA = Object.freeze(
  /** @type {Record<string, string>} */ ({
    recuperacao: '(recuperação: mesmo capim)',
    renovacao: '(renovação: troca de capim)',
    capim_novo: '(a área ainda não tem capim no cadastro)',
  }),
);

/**
 * O texto da natureza para as áreas escolhidas: uma frase só quando todas dão o mesmo; senão, uma por área
 * ("PASTO DA AROEIRA: renovação: troca de capim").
 * @param {string|null|undefined} capimAlvoId @param {Array<{ nome?: string|null, cultura_id?: string|null }>} areas
 * @returns {string[]}
 */
export const textosDaNatureza = (capimAlvoId, areas) => {
  const n = areas.map((a) => naturezaDaReforma({ capimAlvoId, capimAtualId: a?.cultura_id ?? null }));
  if (!n.length || n.every((x) => x === null)) return [];
  if (n.every((x) => x === n[0])) return [TEXTO_DA_NATUREZA[/** @type {string} */ (n[0])]];
  return areas.map((a, i) => `${texto(a?.nome) || 'Área'}: ${TEXTO_DA_NATUREZA[/** @type {string} */ (n[i])].replace(/^\(|\)$/g, '')}`);
};

/**
 * As reformas ABERTAS que podem receber a realização: as que aparecem nos resumos das áreas do registro e têm TODAS as
 * áreas dele (a mesma regra do servidor). Faltando algum resumo, null (ainda lendo). Sem área, nenhuma.
 * @param {{ areaIds: string[], resumos: Array<any|null|undefined> }} p
 * @returns {any[]|null}
 */
export const reformasDoRegistro = ({ areaIds, resumos }) => {
  if (!areaIds.length) return [];
  if (resumos.length !== areaIds.length || resumos.some((r) => !r)) return null;
  /** @type {Map<string, any>} */
  const porId = new Map();
  for (const r of resumos) for (const p of Array.isArray(r?.planejamentos) ? r.planejamentos : []) if (p?.id && !porId.has(String(p.id))) porId.set(String(p.id), p);
  return [...porId.values()].filter((p) => {
    const daReforma = new Set((Array.isArray(p.area_ids) ? p.area_ids : []).map(String));
    return areaIds.every((id) => daReforma.has(String(id)));
  });
};

/** A opção "não faz parte de reforma" da lista (duas reformas abertas na área). */
export const NAO_FAZ_PARTE = 'nenhuma';

/**
 * O "Faz parte de" da Nova realização (seção Planejamento, só leitura): o que mostrar e o que mandar.
 *  - o serviço que CONTINUA já faz parte de uma reforma → `ja_ligada` (nada a escolher; o servidor nunca troca a ligação);
 *  - nenhuma reforma aberta com as áreas → `nenhuma` (a linha não aparece);
 *  - uma → `uma`, já marcada, com o "tirar"; tirada → `tirada` (com o "pôr de volta");
 *  - duas ou mais → `escolher` (uma lista; a escolha é obrigatória: uma delas ou "não faz parte").
 * `enviar` é o `planejamento_id` do corpo (null = não vai).
 * @param {{ candidatas: any[]|null, ligadaId?: string|null, ligadaNome?: string|null, tirada?: boolean, escolhaId?: string }} p
 * @returns {{ modo: 'nenhuma'|'lendo'|'ja_ligada'|'uma'|'tirada'|'escolher', reforma: any|null, candidatas: any[], enviar: string|null, falta: boolean }}
 */
export const fazParteDe = ({ candidatas, ligadaId = null, ligadaNome = null, tirada = false, escolhaId = '' }) => {
  const lista = candidatas ?? [];
  if (ligadaId) {
    const r = lista.find((p) => String(p.id) === String(ligadaId)) ?? { id: ligadaId, nome: ligadaNome || 'outra reforma' };
    return { modo: 'ja_ligada', reforma: r, candidatas: lista, enviar: null, falta: false };
  }
  if (candidatas === null) return { modo: 'lendo', reforma: null, candidatas: [], enviar: null, falta: false };
  if (!lista.length) return { modo: 'nenhuma', reforma: null, candidatas: [], enviar: null, falta: false };
  if (lista.length === 1) {
    return tirada
      ? { modo: 'tirada', reforma: lista[0], candidatas: lista, enviar: null, falta: false }
      : { modo: 'uma', reforma: lista[0], candidatas: lista, enviar: String(lista[0].id), falta: false };
  }
  if (escolhaId === NAO_FAZ_PARTE) return { modo: 'escolher', reforma: null, candidatas: lista, enviar: null, falta: false };
  const escolhida = lista.find((p) => String(p.id) === String(escolhaId)) ?? null;
  return { modo: 'escolher', reforma: escolhida, candidatas: lista, enviar: escolhida ? String(escolhida.id) : null, falta: !escolhida };
};

/**
 * As áreas da reforma que ainda não têm o capim que vai ficar (a troca da conclusão). Sem capim escolhido, nenhuma.
 * @param {any} reforma @returns {any[]}
 */
export const areasParaTrocarCapim = (reforma) => {
  const alvo = texto(reforma?.cultura_alvo_id);
  if (!alvo) return [];
  return (Array.isArray(reforma?.areas) ? reforma.areas : []).filter((a) => texto(a?.cultura_id) !== alvo);
};

/**
 * A pergunta da conclusão: "Trocar o capim da área para MOMBAÇA?" (várias: "Trocar o capim das 2 áreas para MOMBAÇA?").
 * Sem troca a fazer, vazio.
 * @param {any} reforma
 */
export const perguntaDaTrocaDeCapim = (reforma) => {
  const areas = areasParaTrocarCapim(reforma);
  const capim = texto(reforma?.cultura_alvo?.nome);
  if (!areas.length || !capim) return '';
  return areas.length === 1 ? `Trocar o capim da área para ${capim}?` : `Trocar o capim das ${areas.length} áreas para ${capim}?`;
};

/**
 * O "Em reforma desde 10/09" do mapa (Detalhes da área): a reforma aberta mais antiga da área. Com o início previsto
 * ainda no futuro, "Reforma prevista para 10/09". Sem reforma aberta, vazio.
 * @param {any[]} planejamentos os do resumo da área @param {string} hoje
 */
export const textoDaReformaNaArea = (planejamentos, hoje) => {
  const p = (Array.isArray(planejamentos) ? planejamentos : [])[0];
  const dia = texto(p?.data_inicio);
  if (!p || !dia) return '';
  return hoje && dia > hoje ? `Reforma prevista para ${diaCurtoDaReforma(dia)}` : `Em reforma desde ${diaCurtoDaReforma(dia)}`;
};

/** A reforma na pílula do filtro: o nome e, se não está aberta, a situação. @param {any} p */
export const rotuloDaReformaNoFiltro = (p) => {
  const nome = texto(p?.nome) || `Reforma ${texto(p?.numero)}`;
  return p?.status && p.status !== STATUS_REFORMA.ABERTO ? `${nome} (${(ROTULO_DO_STATUS_DA_REFORMA[p.status] ?? '').toLowerCase()})` : nome;
};

/**
 * O corpo do "Planejar" da reforma (as linhas da tabela das áreas já validadas): só os campos que vão.
 * @param {{ tipo: string, areas: Array<{ area_id: string, hectares: string }>, capimId?: string, inicio: string }} p
 */
export const corpoDaReforma = ({ tipo, areas, capimId, inicio }) => ({
  tipo,
  areas: areas.map((a) => ({ area_id: a.area_id, hectares: a.hectares })),
  ...(texto(capimId) ? { cultura_alvo_id: texto(capimId) } : {}),
  data_inicio: inicio,
});

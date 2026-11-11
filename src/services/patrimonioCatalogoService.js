/**
 * Service dos catálogos de Patrimônio e Frota (D-PROD-157): famílias e tipos.
 *
 * D-PROD-162: os catálogos vivem DENTRO do cadastro de Bens (as guardas são as
 * da tela de Bens; ver `acoesDeCatalogoNoBem`) e saíram os perfis de medição e
 * os combustíveis. O `codigo` é opcional na criação (P-05): sem ele o servidor
 * o gera a partir do nome.
 *
 * Catálogos são do TENANT (sem empresa): o bem pode mudar de fazenda no futuro
 * sem quebrar referência. Sem exclusão física: inativar/reativar é PATCH só com
 * `{versao, ativo}` (exige a ação `inativar` da tela de Bens); a edição comum
 * nunca leva `ativo`. Campos de classificação (código, natureza, família) só
 * vão na criação — o servidor os trata como imutáveis.
 */

import {
  listPatrimonioCatalogoPage,
  getPatrimonioCatalogo,
  createPatrimonioCatalogo,
  updatePatrimonioCatalogo,
  instalarPatrimonioCatalogoPadrao,
  listOpcoesBemPatrimonial,
} from '@/apis/patrimonio';

export const RECURSOS_CATALOGO = Object.freeze({
  FAMILIAS: 'familias',
  TIPOS: 'tipos',
});

/** Código de catálogo: maiúsculas, dígitos e sublinhado (2 a 32). */
export const PADRAO_CODIGO_CATALOGO = /^[A-Z0-9_]{2,32}$/;

/** Campos aceitos na criação e na edição de cada catálogo. */
const CAMPOS = Object.freeze({
  familias: Object.freeze({
    criacao: Object.freeze(['codigo', 'nome', 'natureza', 'descricao', 'ordem', 'vida_util_meses_padrao']),
    edicao: Object.freeze(['nome', 'descricao', 'ordem', 'vida_util_meses_padrao']),
  }),
  tipos: Object.freeze({
    criacao: Object.freeze(['familia_id', 'codigo', 'nome', 'descricao', 'vida_util_meses_sugerida']),
    edicao: Object.freeze(['nome', 'descricao', 'vida_util_meses_sugerida']),
  }),
});

/** @param {string} recurso */
const camposDo = (recurso) => {
  const campos = /** @type {Record<string, { criacao: readonly string[], edicao: readonly string[] }>} */ (CAMPOS)[recurso];
  if (!campos) throw new TypeError(`catálogo de patrimônio desconhecido: ${recurso}`);
  return campos;
};

/** Valor comparável de um campo de catálogo: texto aparado (vazio = null). @param {unknown} v */
const comparavel = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
};

/** Valor como vai no corpo: texto aparado (vazio = null). @param {unknown} v */
const paraCorpo = (v) => {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v === undefined ? null : v;
};

/**
 * @param {string} recurso
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean, natureza?: string|null, familiaId?: string|null }} [opts]
 */
export const listarCatalogoPagina = (recurso, opts = {}) =>
  listPatrimonioCatalogoPage(recurso, {
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    ativo: opts.ativo,
    natureza: opts.natureza || undefined,
    familia_id: opts.familiaId || undefined,
  });

/** @param {string} recurso @param {string} id */
export const detalharCatalogo = (recurso, id) => getPatrimonioCatalogo(recurso, id);

/**
 * Criação: só os campos do catálogo, sem vazios (o servidor aplica os padrões).
 * Sem `codigo` (ou vazio) o servidor o gera do nome (P-05).
 * @param {string} recurso @param {Record<string, any>} dados
 */
export const criarCatalogo = (recurso, dados) => {
  /** @type {Record<string, any>} */
  const corpo = {};
  for (const campo of camposDo(recurso).criacao) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = paraCorpo(dados[campo]);
    if (valor === null) continue;
    corpo[campo] = valor;
  }
  return createPatrimonioCatalogo(recurso, corpo);
};

/**
 * PATCH mínimo: só o que mudou, com a `versao` do registro aberto. Texto vazio
 * vai como `null` (limpa). Sem mudança → nada é enviado.
 * @param {string} recurso @param {Record<string, any>} original @param {Record<string, any>} dados
 * @returns {Promise<{ alterado: boolean, registro: any }>}
 */
export const atualizarCatalogo = async (recurso, original, dados) => {
  /** @type {Record<string, any>} */
  const corpo = {};
  for (const campo of camposDo(recurso).edicao) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    if (comparavel(dados[campo]) === comparavel(original?.[campo])) continue;
    corpo[campo] = paraCorpo(dados[campo]);
  }
  if (!Object.keys(corpo).length) return { alterado: false, registro: original };
  const registro = await updatePatrimonioCatalogo(recurso, original.id, { versao: original.versao, ...corpo });
  return { alterado: true, registro };
};

/**
 * Inativar (`ativo:false`) ou reativar (`ativo:true`): o corpo leva só
 * `versao` e `ativo` — o servidor exige a ação `inativar` nesse caso.
 * @param {string} recurso @param {{ id: string, versao: number }} original @param {boolean} ativo
 */
export const alterarSituacaoCatalogo = (recurso, original, ativo) =>
  updatePatrimonioCatalogo(recurso, original.id, { versao: original.versao, ativo: ativo === true });

/** Catálogo padrão (só administrador): cria o que falta por código; devolve o resumo. */
export const instalarCatalogoPadrao = () => instalarPatrimonioCatalogoPadrao();

const ROTULO_RECURSO_PADRAO = /** @type {Record<string, [string, string]>} */ ({
  familias: ['família', 'famílias'],
  tipos: ['tipo', 'tipos'],
});

const MOTIVO_CONFLITO = /** @type {Record<string, string>} */ ({
  natureza_divergente: 'já existe com outra natureza',
  familia_divergente: 'já existe em outra família',
  inativo: 'já existe, mas está inativo',
  dependencia_em_conflito: 'depende de um item em conflito',
  nome_em_uso: 'o nome já é usado por outro código',
});

/** @param {{ familias: number, tipos: number }} c */
const listaDeContagens = (c) =>
  ['familias', 'tipos']
    .map((k) => {
      const n = /** @type {Record<string, number>} */ (c)[k] ?? 0;
      const [um, varios] = ROTULO_RECURSO_PADRAO[k];
      return `${n} ${n === 1 ? um : varios}`;
    })
    .join(', ');

/**
 * Resumo legível da instalação do catálogo padrão (D-PROD-162: só famílias e tipos).
 * @param {{ criados: any, existentes: any, conflitos: Array<{ recurso: string, codigo: string, motivo: string }> }} r
 * @returns {{ criados: string, existentes: string, conflitos: string[] }}
 */
export const resumoCatalogoPadrao = (r) => ({
  criados: listaDeContagens(r.criados),
  existentes: listaDeContagens(r.existentes),
  conflitos: r.conflitos.map((c) => {
    const [um] = ROTULO_RECURSO_PADRAO[c.recurso] ?? [c.recurso];
    return `${um} ${c.codigo}: ${MOTIVO_CONFLITO[c.motivo] ?? c.motivo}`;
  }),
});

/**
 * Uma página de opções ATIVAS de catálogo (famílias, tipos) para os seletores
 * — sem empresa (catálogo do tenant). `tipos` aceita `familiaId`.
 * @param {'familias'|'tipos'} recurso
 * @param {{ q?: string, cursor?: string|null, limit?: number, familiaId?: string|null }} [opts]
 */
export const listarOpcoesCatalogo = (recurso, opts = {}) =>
  listOpcoesBemPatrimonial(recurso, {
    q: opts.q?.trim() || undefined,
    cursor: opts.cursor || undefined,
    limit: opts.limit ?? 50,
    familia_id: opts.familiaId || undefined,
  });

/** Nome comparável (sem diferenciar maiúsculas nem espaços repetidos), como o servidor. @param {unknown} nome */
const nomeComparavel = (nome) => String(nome ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * "Usar a existente" depois de um 409 `PATRIMONIO_NOME_DUPLICADO` no cadastro
 * rápido: procura, entre as opções ATIVAS, o item com o MESMO nome (tipo:
 * dentro da família). `null` quando o homônimo está inativo (ele não pode ser
 * escolhido para um bem: reative-o em "Gerenciar famílias e tipos").
 * @param {'familias'|'tipos'} recurso @param {string} nome @param {{ familiaId?: string|null }} [opts]
 * @returns {Promise<any|null>}
 */
export const buscarCatalogoPorNome = async (recurso, nome, opts = {}) => {
  const alvo = nomeComparavel(nome);
  if (!alvo) return null;
  const pagina = await listarOpcoesCatalogo(recurso, { q: String(nome).trim(), limit: 50, familiaId: opts.familiaId ?? null });
  return pagina.itens.find((o) => o && nomeComparavel(o.nome) === alvo) ?? null;
};

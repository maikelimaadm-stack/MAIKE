/**
 * Service dos catálogos de Patrimônio e Frota (D-PROD-156): famílias, tipos,
 * perfis de medição e combustíveis.
 *
 * Catálogos são do TENANT (sem empresa): o bem pode mudar de fazenda no futuro
 * sem quebrar referência. Sem exclusão física: inativar/reativar é PATCH só com
 * `{versao, ativo}` (exige a ação extra `inativar`); a edição comum nunca leva
 * `ativo`. Campos de classificação (código, natureza, família, dimensão,
 * finalidade, unidade) só vão na criação — o servidor os trata como imutáveis.
 */

import {
  listPatrimonioCatalogoPage,
  getPatrimonioCatalogo,
  createPatrimonioCatalogo,
  updatePatrimonioCatalogo,
  instalarPatrimonioCatalogoPadrao,
  listOpcoesBemPatrimonial,
} from '@/apis/patrimonio';
import { DIMENSOES, unidadesDaDimensao } from '@/lib/patrimonioDominio';

export const RECURSOS_CATALOGO = Object.freeze({
  FAMILIAS: 'familias',
  TIPOS: 'tipos',
  PERFIS_MEDICAO: 'perfis-medicao',
  COMBUSTIVEIS: 'combustiveis',
});

/** Código de catálogo: maiúsculas, dígitos e sublinhado (2 a 32). */
export const PADRAO_CODIGO_CATALOGO = /^[A-Z0-9_]{2,32}$/;

/** Limite de perfis sugeridos por tipo (servidor: 422 `TIPO_PERFIS_INVALIDOS` reason `limite`). */
export const LIMITE_PERFIS_DO_TIPO = 10;

/** Campos aceitos na criação e na edição de cada catálogo. */
const CAMPOS = Object.freeze({
  familias: Object.freeze({
    criacao: Object.freeze(['codigo', 'nome', 'natureza', 'descricao', 'ordem', 'vida_util_meses_padrao']),
    edicao: Object.freeze(['nome', 'descricao', 'ordem', 'vida_util_meses_padrao']),
  }),
  tipos: Object.freeze({
    criacao: Object.freeze(['familia_id', 'codigo', 'nome', 'descricao', 'vida_util_meses_sugerida', 'perfis']),
    edicao: Object.freeze(['nome', 'descricao', 'vida_util_meses_sugerida', 'perfis']),
  }),
  'perfis-medicao': Object.freeze({
    criacao: Object.freeze(['codigo', 'nome', 'dimensao', 'finalidade', 'unidades_permitidas', 'descricao']),
    edicao: Object.freeze(['nome', 'unidades_permitidas', 'descricao']),
  }),
  combustiveis: Object.freeze({
    criacao: Object.freeze(['codigo', 'nome', 'unidade', 'descricao']),
    edicao: Object.freeze(['nome', 'descricao']),
  }),
});

/** @param {string} recurso */
const camposDo = (recurso) => {
  const campos = /** @type {Record<string, { criacao: readonly string[], edicao: readonly string[] }>} */ (CAMPOS)[recurso];
  if (!campos) throw new TypeError(`catálogo de patrimônio desconhecido: ${recurso}`);
  return campos;
};

/**
 * Perfis sugeridos do tipo, normalizados para `{perfil_id, principal, nome, dimensao, ativo}`
 * (aceita `perfil_id` ou `perfil.id`; ordem do servidor, por `ordem` quando vier).
 * @param {any} tipo
 * @returns {Array<{ perfil_id: string, principal: boolean, nome: string, codigo: string, dimensao: string|null, ativo: boolean }>|null}
 *   `null` quando o registro não trouxe a lista (ela precisa ser lida no detalhe).
 */
export const perfisDoTipo = (tipo) => {
  if (!tipo || !Array.isArray(tipo.perfis)) return null;
  const lista = [...tipo.perfis].filter((p) => p && typeof p === 'object');
  if (lista.every((p) => Number.isInteger(p.ordem))) lista.sort((a, b) => a.ordem - b.ordem);
  return lista
    .map((p) => {
      const perfil = p.perfil && typeof p.perfil === 'object' ? p.perfil : {};
      const id = p.perfil_id ?? perfil.id;
      return {
        perfil_id: typeof id === 'string' ? id : '',
        principal: p.principal === true,
        nome: String(perfil.nome ?? p.nome ?? p.perfil_nome ?? ''),
        codigo: String(perfil.codigo ?? p.codigo ?? ''),
        dimensao: typeof (perfil.dimensao ?? p.dimensao) === 'string' ? String(perfil.dimensao ?? p.dimensao) : null,
        ativo: (perfil.ativo ?? p.ativo) !== false,
      };
    })
    .filter((p) => p.perfil_id);
};

/** Forma do corpo de `perfis`: `[{perfil_id, principal?: true}]` na ordem escolhida. @param {unknown} perfis */
const corpoDosPerfis = (perfis) =>
  (Array.isArray(perfis) ? perfis : [])
    .filter((p) => p && typeof p.perfil_id === 'string' && p.perfil_id)
    .map((p) => (p.principal === true ? { perfil_id: p.perfil_id, principal: true } : { perfil_id: p.perfil_id }));

/** Unidades na ordem da dimensão (a canônica primeiro), sem repetição. @param {unknown} unidades */
const unidadesOrdenadas = (unidades) => {
  const escolhidas = new Set((Array.isArray(unidades) ? unidades : []).map(String));
  const ordem = DIMENSOES.flatMap((d) => unidadesDaDimensao(d));
  return [...ordem.filter((u) => escolhidas.has(u)), ...[...escolhidas].filter((u) => !ordem.includes(u)).sort()];
};

/**
 * Valor comparável de um campo de catálogo: texto aparado (vazio = null),
 * perfis como lista ordenada `perfil_id:principal`, unidades como conjunto.
 * @param {string} campo @param {unknown} v
 */
const comparavel = (campo, v) => {
  if (campo === 'perfis') return JSON.stringify(corpoDosPerfis(v));
  if (campo === 'unidades_permitidas') return JSON.stringify(unidadesOrdenadas(v));
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  return v;
};

/** Valor como vai no corpo: texto aparado (vazio = null), listas normalizadas. @param {string} campo @param {unknown} v */
const paraCorpo = (campo, v) => {
  if (campo === 'perfis') return corpoDosPerfis(v);
  if (campo === 'unidades_permitidas') return unidadesOrdenadas(v);
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
 * @param {string} recurso @param {Record<string, any>} dados
 */
export const criarCatalogo = (recurso, dados) => {
  /** @type {Record<string, any>} */
  const corpo = {};
  for (const campo of camposDo(recurso).criacao) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = paraCorpo(campo, dados[campo]);
    if (valor === null || (Array.isArray(valor) && valor.length === 0 && campo !== 'unidades_permitidas')) continue;
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
    const atual = campo === 'perfis' ? perfisDoTipo(original) : original?.[campo];
    if (comparavel(campo, dados[campo]) === comparavel(campo, atual)) continue;
    corpo[campo] = paraCorpo(campo, dados[campo]);
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
  perfis: ['perfil de medição', 'perfis de medição'],
  'perfis-medicao': ['perfil de medição', 'perfis de medição'],
  combustiveis: ['combustível', 'combustíveis'],
});

const MOTIVO_CONFLITO = /** @type {Record<string, string>} */ ({
  natureza_divergente: 'já existe com outra natureza',
  familia_divergente: 'já existe em outra família',
  dimensao_divergente: 'já existe com outra dimensão',
  unidade_divergente: 'já existe com outra unidade',
  inativo: 'já existe, mas está inativo',
  dependencia_em_conflito: 'depende de um item em conflito',
  nome_em_uso: 'o nome já é usado por outro código',
});

/** @param {{ familias: number, tipos: number, perfis: number, combustiveis: number }} c */
const listaDeContagens = (c) =>
  ['familias', 'tipos', 'perfis', 'combustiveis']
    .map((k) => {
      const n = /** @type {Record<string, number>} */ (c)[k] ?? 0;
      const [um, varios] = ROTULO_RECURSO_PADRAO[k];
      return `${n} ${n === 1 ? um : varios}`;
    })
    .join(', ');

/**
 * Resumo legível da instalação do catálogo padrão.
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
 * Uma página de opções ATIVAS de catálogo (famílias, tipos, perfis de medição,
 * combustíveis) para os seletores — sem empresa (catálogo do tenant).
 * @param {'familias'|'tipos'|'perfis-medicao'|'combustiveis'} recurso
 * @param {{ q?: string, cursor?: string|null, limit?: number, familiaId?: string|null }} [opts]
 */
export const listarOpcoesCatalogo = (recurso, opts = {}) =>
  listOpcoesBemPatrimonial(recurso, {
    q: opts.q?.trim() || undefined,
    cursor: opts.cursor || undefined,
    limit: opts.limit ?? 50,
    familia_id: opts.familiaId || undefined,
  });

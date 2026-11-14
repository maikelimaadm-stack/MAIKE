/**
 * Porta nativa do Lançamento de Atividades (D-PROD-200, Fatia 2).
 *
 * Dois níveis: a ATIVIDADE (o cabeçalho aberto, "Cigarrinha Pasto 01") e os
 * APONTAMENTOS dela (um por dia e turno; a sequência 1, 2… no mesmo dia e turno
 * são as passadas). Contrato: docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md
 * (§4 rotas, §10 formato). Só online; tenant só no JWT, empresa na query da
 * leitura e no corpo da escrita.
 *
 * Todo corpo vai por ALLOWLIST (o servidor recusa qualquer outra chave com
 * 400): nada de `cliente_id`, número, sequência, snapshots do tipo, setor,
 * centros, unidade, status, autoria nem totais. Setor vem da área; centros e
 * unidade vêm do tipo; a sequência é do servidor. No apontamento, área, setor,
 * safra, centros, unidade e máquina são do cabeçalho: o corpo não os leva.
 *
 * Decimais vão como TEXTO (o servidor não faz coerção) e datas como AAAA-MM-DD.
 * Sem DELETE: a atividade e o apontamento só se CANCELAM (com motivo e a
 * `versao` lida). Os seletores de máquina e de operador têm rotas PRÓPRIAS da
 * tela (`/atividades-opcoes/…`): quem só tem esta tela não leva 403 das telas
 * de bens ou de usuários.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'Atividade';
const RESOURCE_APONTAMENTO = 'AtividadeApontamento';
const CAMINHO = '/atividades';
const CAMINHO_OPCOES = '/atividades-opcoes';

/** Seletores próprios da tela (guardados por "ver" da tela). */
export const RECURSOS_OPCOES_ATIVIDADE = Object.freeze(['bens', 'operadores']);

// ─── Atividade (cabeçalho) ───────────────────────────────────────────────

/**
 * Dados que o formulário da atividade grava. Fora daqui (e recusados pelo
 * servidor): setor (herdado da área), centros e unidade (herdados do tipo).
 */
export const CAMPOS_DA_ATIVIDADE = Object.freeze([
  'nome',
  'area_id',
  'bem_id',
  'safra_ciclo',
  'data_inicio',
  'data_prevista_fim',
  'area_planejada',
  'lancamento_tarefa_id',
  'observacao',
]);

/** POST /atividades (§10): a empresa e o tipo, mais os dados. */
export const CAMPOS_DE_ABERTURA = Object.freeze(['empresa_id', 'tipo_atividade_id', ...CAMPOS_DA_ATIVIDADE]);
/** PATCH /atividades/:id (§10): os dados de abertura menos empresa e tipo (o tipo é imutável), mais a `versao` (CAS). */
export const CAMPOS_DE_EDICAO = Object.freeze(['versao', ...CAMPOS_DA_ATIVIDADE]);
/** POST /atividades/:id/concluir. */
export const CAMPOS_DE_CONCLUSAO = Object.freeze(['empresa_id', 'versao', 'data_conclusao']);
/** POST /atividades/:id/reabrir. */
export const CAMPOS_DE_REABERTURA = Object.freeze(['empresa_id', 'versao', 'motivo']);
/** POST /atividades/:id/cancelar (cancela também os apontamentos confirmados). */
export const CAMPOS_DE_CANCELAMENTO = Object.freeze(['empresa_id', 'versao', 'motivo']);
/** POST /atividades/:id/duplicar: abertura nova a partir desta (corpo opcional). */
export const CAMPOS_DE_DUPLICACAO = Object.freeze(['empresa_id', 'nome', 'data_inicio', 'data_prevista_fim']);

// ─── Apontamento (filho) ─────────────────────────────────────────────────

/** Dados do apontamento do dia. A sequência é do servidor; área, centros, unidade e máquina são do cabeçalho. */
export const CAMPOS_DO_APONTAMENTO = Object.freeze([
  'data_operacional',
  'turno',
  'operador_usuario_id',
  'area_executada_dia',
  'quantidade_produzida_dia',
  'observacao',
  'origem',
]);

/** POST /atividades/:id/apontamentos. */
export const CAMPOS_DE_CRIACAO_APONTAMENTO = Object.freeze(['empresa_id', ...CAMPOS_DO_APONTAMENTO]);
/**
 * PATCH /atividades/:id/apontamentos/:apontamentoId (§10): os mesmos campos de dado, mais a `versao`. A origem é
 * gravada no lançamento e não muda na edição: o schema fechado do servidor a recusa (400), então ela não vai.
 */
export const CAMPOS_DE_EDICAO_APONTAMENTO = Object.freeze(['versao', ...CAMPOS_DO_APONTAMENTO.filter((c) => c !== 'origem')]);
/** POST …/:apontamentoId/cancelar. */
export const CAMPOS_DE_CANCELAMENTO_APONTAMENTO = Object.freeze(['empresa_id', 'versao', 'motivo']);
/** POST …/:apontamentoId/duplicar ("Repetir"): só o dia, padrão hoje no servidor. */
export const CAMPOS_DE_DUPLICACAO_APONTAMENTO = Object.freeze(['empresa_id', 'data_operacional']);

// ─── Leitura ─────────────────────────────────────────────────────────────

/** Filtros da lista (query FECHADA no servidor: nada além disso vai). Datas sobre `data_inicio`. */
const FILTROS_LISTA = Object.freeze(['empresa_id', 'status', 'tipo_atividade_id', 'area_id', 'data_de', 'data_ate', 'limit', 'cursor']);
const FILTROS_OPCOES = Object.freeze(['empresa_id', 'q', 'limit', 'cursor']);

/** @param {string} operation @param {Record<string, unknown>} [details] @param {string} [resource] */
const ctx = (operation, details, resource = RESOURCE) => ({ operation, resource, ...(details ? { details } : {}) });

/** @param {unknown} valor */
const valorDeEnvio = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/**
 * Só as chaves permitidas, na forma de envio: texto vazio vira `null` (limpa o
 * campo opcional na EDIÇÃO) e `undefined` fica ausente.
 * @param {Record<string, unknown>} dados @param {readonly string[]} permitidos
 */
export const corpoDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = valorDeEnvio(/** @type {Record<string, unknown>} */ (dados)[campo]);
    if (valor !== undefined) corpo[campo] = valor;
  }
  return corpo;
};

/**
 * Corpo de CRIAÇÃO (abrir, duplicar, ações, novo apontamento): as chaves
 * permitidas sem as vazias. O opcional não informado fica AUSENTE (o servidor
 * aplica o padrão), nunca `null`.
 * @param {Record<string, unknown>} dados @param {readonly string[]} permitidos
 */
export const corpoSemVazios = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const [campo, valor] of Object.entries(corpoDeEnvio(dados, permitidos))) {
    if (valor !== null) corpo[campo] = valor;
  }
  return corpo;
};

/**
 * Caminho com só as chaves permitidas, sem vazio.
 * @param {string} caminho @param {readonly string[]} permitidas @param {Record<string, unknown>} filtros
 */
const comFiltros = (caminho, permitidas, filtros) => {
  const params = new URLSearchParams();
  for (const chave of permitidas) {
    const valor = filtros[chave];
    if (valor === undefined || valor === null) continue;
    const texto = typeof valor === 'string' ? valor.trim() : String(valor);
    if (texto) params.set(chave, texto);
  }
  const qs = params.toString();
  return qs ? `${caminho}?${qs}` : caminho;
};

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagem = (filtros = {}) => comFiltros(CAMINHO, FILTROS_LISTA, filtros);

/** @param {string} recurso @param {Record<string, unknown>} [filtros] */
export const montarCaminhoOpcoes = (recurso, filtros = {}) => {
  const caminho = comFiltros(`${CAMINHO_OPCOES}/${encodeURIComponent(recurso)}`, FILTROS_OPCOES, filtros);
  if (recurso !== 'bens') return caminho;
  // Máquina da atividade: só MAQUINA, VEICULO e EQUIPAMENTO (como a tela antiga); nunca benfeitoria ou implemento.
  const params = new URLSearchParams();
  for (const natureza of NATUREZAS_MAQUINA_ATIVIDADE) params.append('natureza', natureza);
  return `${caminho}${caminho.includes('?') ? '&' : '?'}${params.toString()}`;
};

/** Naturezas de bem aceitas como máquina da atividade. */
export const NATUREZAS_MAQUINA_ATIVIDADE = Object.freeze(['MAQUINA', 'VEICULO', 'EQUIPAMENTO']);

/** @param {string} id */
const daAtividade = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;
/** @param {string} atividadeId @param {string} [apontamentoId] */
const doApontamento = (atividadeId, apontamentoId) =>
  `${daAtividade(atividadeId)}/apontamentos${apontamentoId ? `/${encodeURIComponent(apontamentoId)}` : ''}`;
/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;

export const operacoesNativas = Object.freeze({
  // ── Atividade ──
  /** @param {Record<string, unknown>} [filtros] */
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listAtividadesPage')),

  /** Cabeçalho com os objetos (tipo, área, setor, máquina, centros, unidade, tarefa) e os totais. @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(daAtividade(id), empresaId), { autenticado: true }, ctx('getAtividade', { id })),

  /** @param {Record<string, unknown>} dados */
  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_ABERTURA), autenticado: true }, ctx('createAtividade')),

  /** @param {string} id @param {Record<string, unknown>} dados */
  update: (id, dados) =>
    nativeRequest(daAtividade(id), { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_EDICAO), autenticado: true }, ctx('updateAtividade', { id })),

  /** @param {string} id @param {Record<string, unknown>} dados */
  concluir: (id, dados) =>
    nativeRequest(
      `${daAtividade(id)}/concluir`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_CONCLUSAO), autenticado: true },
      ctx('completeAtividade', { id }),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  reabrir: (id, dados) =>
    nativeRequest(
      `${daAtividade(id)}/reabrir`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_REABERTURA), autenticado: true },
      ctx('reopenAtividade', { id }),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  cancelar: (id, dados) =>
    nativeRequest(
      `${daAtividade(id)}/cancelar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_CANCELAMENTO), autenticado: true },
      ctx('cancelAtividade', { id }),
    ),

  /** @param {string} id @param {Record<string, unknown>} dados */
  duplicar: (id, dados) =>
    nativeRequest(
      `${daAtividade(id)}/duplicar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_DUPLICACAO), autenticado: true },
      ctx('duplicateAtividade', { id }),
    ),

  // ── Apontamentos da atividade ──
  /** `{ items }` sem paginação (dia desc, turno, sequência). @param {string} atividadeId @param {string} empresaId */
  listApontamentos: (atividadeId, empresaId) =>
    nativeRequest(
      comEmpresa(doApontamento(atividadeId), empresaId),
      { autenticado: true },
      ctx('listAtividadeApontamentos', { atividadeId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {string} apontamentoId @param {string} empresaId */
  getApontamento: (atividadeId, apontamentoId, empresaId) =>
    nativeRequest(
      comEmpresa(doApontamento(atividadeId, apontamentoId), empresaId),
      { autenticado: true },
      ctx('getAtividadeApontamento', { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {Record<string, unknown>} dados */
  createApontamento: (atividadeId, dados) =>
    nativeRequest(
      doApontamento(atividadeId),
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_CRIACAO_APONTAMENTO), autenticado: true },
      ctx('createAtividadeApontamento', { atividadeId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} dados */
  updateApontamento: (atividadeId, apontamentoId, dados) =>
    nativeRequest(
      doApontamento(atividadeId, apontamentoId),
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_EDICAO_APONTAMENTO), autenticado: true },
      ctx('updateAtividadeApontamento', { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} dados */
  cancelarApontamento: (atividadeId, apontamentoId, dados) =>
    nativeRequest(
      `${doApontamento(atividadeId, apontamentoId)}/cancelar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_CANCELAMENTO_APONTAMENTO), autenticado: true },
      ctx('cancelAtividadeApontamento', { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  /** @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} dados */
  duplicarApontamento: (atividadeId, apontamentoId, dados) =>
    nativeRequest(
      `${doApontamento(atividadeId, apontamentoId)}/duplicar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DE_DUPLICACAO_APONTAMENTO), autenticado: true },
      ctx('duplicateAtividadeApontamento', { atividadeId, apontamentoId }, RESOURCE_APONTAMENTO),
    ),

  // ── Opções da tela ──
  /** @param {string} recurso @param {Record<string, unknown>} [filtros] */
  opcoes: (recurso, filtros = {}) =>
    nativeRequest(montarCaminhoOpcoes(recurso, filtros), { autenticado: true }, ctx('listOpcoesAtividade', { recurso })),
});

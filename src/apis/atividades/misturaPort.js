/**
 * Porta do Diário da máquina (mistura no implemento, aplicação no pasto, sobra e resumo do dia). Contrato do servidor:
 *  - GET  /atividades/:id/misturas?empresa_id=
 *  - POST /atividades/:id/misturas
 *  - POST /atividades/:id/apontamentos/:apId/misturas/:misturaId/aplicar
 *  - POST /atividades/:id/misturas/:misturaId/aplicar (sem lançamento do dia: o servidor cria o de hoje)
 *  - POST /atividades/:id/misturas/:misturaId/sobra
 *  - POST /atividades/:id/trajetos (só horímetros entre pastos, sem sobra)
 *  - POST /atividades/:id/diario-dia (garante o lançamento de hoje da área, idempotente)
 *  - GET  /atividades/:id/diario-resumo?empresa_id=&dia=
 *
 * Mesmas regras do `lancamentoAtividadePort.js`: o corpo passa por ALLOWLIST (o servidor recusa chave desconhecida com
 * 400), os decimais vão como TEXTO e o `operation_id` vem do service (com a pendência persistente). Sem rede própria:
 * usa o cliente nativo. Quando o servidor ainda não tem estas rotas, a chamada falha e o service trata como indisponível.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { corpoSemVazios } from './lancamentoAtividadePort.js';

const CAMINHO = '/atividades';
const RECURSO = 'Mistura';

/** POST /atividades/:id/misturas. */
export const CAMPOS_DA_MISTURA = Object.freeze(['empresa_id', 'implemento_bem_id', 'area_id', 'itens', 'capacidade', 'unidade', 'operation_id']);
/** Cada item da mistura: produto, local de onde sai e a quantidade por implemento cheio (texto). */
export const CAMPOS_DO_ITEM_DA_MISTURA = Object.freeze(['produto_id', 'local_estoque_id', 'quantidade']);
/** POST …/apontamentos/:apId/misturas/:misturaId/aplicar. */
export const CAMPOS_DA_APLICACAO = Object.freeze(['empresa_id', 'esvaziou', 'sobra', 'operation_id']);
/** POST /atividades/:id/misturas/:misturaId/aplicar (sem o apontamento na rota: o servidor acha ou cria o de hoje). */
export const CAMPOS_DA_APLICACAO_NO_DIA = Object.freeze(['empresa_id', 'esvaziou', 'sobra', 'operation_id']);
/** POST /atividades/:id/trajetos. */
export const CAMPOS_DO_TRAJETO = Object.freeze(['empresa_id', 'de_area_id', 'para_area_id', 'horimetro_saida', 'horimetro_chegada', 'operation_id']);
/** POST /atividades/:id/diario-dia. */
export const CAMPOS_DO_DIA_DO_DIARIO = Object.freeze(['empresa_id', 'area_id']);
/** POST /atividades/:id/misturas/:misturaId/sobra. */
export const CAMPOS_DA_SOBRA = Object.freeze([
  'empresa_id',
  'tipo',
  'para_area_id',
  'apontamento_id',
  'motivo',
  'horimetro_saida',
  'horimetro_chegada',
  'operation_id',
]);

/** @param {string} operation @param {Record<string, unknown>} [details] */
const ctx = (operation, details) => ({ operation, resource: RECURSO, ...(details ? { details } : {}) });
/** @param {string} id */
const daAtividade = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;
/** @param {Record<string, unknown>} dados */
const comEmpresa = (caminho, dados) => `${caminho}?${new URLSearchParams({ empresa_id: String(dados.empresa_id ?? '') }).toString()}`;

/**
 * O corpo da mistura com os itens por allowlist (sem as vazias). @param {Record<string, any>} dados
 */
export const corpoDaMistura = (dados) => {
  const corpo = corpoSemVazios(dados, CAMPOS_DA_MISTURA);
  if (Array.isArray(dados?.itens)) {
    corpo.itens = dados.itens
      .filter((i) => i && typeof i === 'object' && !Array.isArray(i))
      .map((i) => corpoSemVazios(/** @type {Record<string, unknown>} */ (i), CAMPOS_DO_ITEM_DA_MISTURA));
  }
  return corpo;
};

export const misturaPort = Object.freeze({
  /** `{ items }` das misturas da atividade (ABERTA, ACABOU, DEVOLVIDA, PERDA). @param {string} atividadeId @param {string} empresaId */
  listar: (atividadeId, empresaId) =>
    nativeRequest(comEmpresa(`${daAtividade(atividadeId)}/misturas`, { empresa_id: empresaId }), { autenticado: true }, ctx('listMisturas', { atividadeId })),

  /** @param {string} atividadeId @param {Record<string, any>} dados */
  criar: (atividadeId, dados) =>
    nativeRequest(`${daAtividade(atividadeId)}/misturas`, { method: 'POST', body: corpoDaMistura(dados), autenticado: true }, ctx('createMistura', { atividadeId })),

  /** @param {string} atividadeId @param {string} apontamentoId @param {string} misturaId @param {Record<string, any>} dados */
  aplicar: (atividadeId, apontamentoId, misturaId, dados) =>
    nativeRequest(
      `${daAtividade(atividadeId)}/apontamentos/${encodeURIComponent(apontamentoId)}/misturas/${encodeURIComponent(misturaId)}/aplicar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DA_APLICACAO), autenticado: true },
      ctx('aplicarMistura', { atividadeId, apontamentoId, misturaId }),
    ),

  /** @param {string} atividadeId @param {string} misturaId @param {Record<string, any>} dados */
  aplicarNoDia: (atividadeId, misturaId, dados) =>
    nativeRequest(
      `${daAtividade(atividadeId)}/misturas/${encodeURIComponent(misturaId)}/aplicar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DA_APLICACAO_NO_DIA), autenticado: true },
      ctx('aplicarMisturaNoDia', { atividadeId, misturaId }),
    ),

  /** @param {string} atividadeId @param {Record<string, any>} dados */
  trajeto: (atividadeId, dados) =>
    nativeRequest(`${daAtividade(atividadeId)}/trajetos`, { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DO_TRAJETO), autenticado: true }, ctx('registrarTrajeto', { atividadeId })),

  /** @param {string} atividadeId @param {Record<string, any>} dados */
  diaDoDiario: (atividadeId, dados) =>
    nativeRequest(`${daAtividade(atividadeId)}/diario-dia`, { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DO_DIA_DO_DIARIO), autenticado: true }, ctx('garantirDiaDoDiario', { atividadeId })),

  /** @param {string} atividadeId @param {string} misturaId @param {Record<string, any>} dados */
  sobra: (atividadeId, misturaId, dados) =>
    nativeRequest(
      `${daAtividade(atividadeId)}/misturas/${encodeURIComponent(misturaId)}/sobra`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DA_SOBRA), autenticado: true },
      ctx('sobraMistura', { atividadeId, misturaId }),
    ),

  /** Resumo do dia por pasto (implementos cheios, volume, produtos, horas; R$ só se o servidor mandar). */
  resumoDoDia: (atividadeId, empresaId, dia) =>
    nativeRequest(
      `${comEmpresa(`${daAtividade(atividadeId)}/diario-resumo`, { empresa_id: empresaId })}&${new URLSearchParams({ dia: String(dia) }).toString()}`,
      { autenticado: true },
      ctx('diarioResumo', { atividadeId }),
    ),
});

// Superfície pública (index.js): funções, nunca o port (o service não importa arquivo interno do módulo).
/** @param {string} atividadeId @param {string} empresaId */
export const listMisturas = (atividadeId, empresaId) => misturaPort.listar(atividadeId, empresaId);
/** @param {string} atividadeId @param {Record<string, any>} dados */
export const createMistura = (atividadeId, dados) => misturaPort.criar(atividadeId, dados);
/** @param {string} atividadeId @param {string} apontamentoId @param {string} misturaId @param {Record<string, any>} dados */
export const aplicarMistura = (atividadeId, apontamentoId, misturaId, dados) => misturaPort.aplicar(atividadeId, apontamentoId, misturaId, dados);
/** Passo 2 sem o lançamento do dia na tela: o servidor cria o de hoje (D-PROD-325). @param {string} atividadeId @param {string} misturaId @param {Record<string, any>} dados */
export const aplicarMisturaNoDia = (atividadeId, misturaId, dados) => misturaPort.aplicarNoDia(atividadeId, misturaId, dados);
/** Trajeto sem sobra: só os horímetros entre dois pastos (D-PROD-325). @param {string} atividadeId @param {Record<string, any>} dados */
export const registrarTrajetoMistura = (atividadeId, dados) => misturaPort.trajeto(atividadeId, dados);
/** O lançamento de hoje da área, criado se faltar (idempotente; o abastecimento precisa dele). @param {string} atividadeId @param {Record<string, any>} dados */
export const garantirDiaDoDiario = (atividadeId, dados) => misturaPort.diaDoDiario(atividadeId, dados);
/** @param {string} atividadeId @param {string} misturaId @param {Record<string, any>} dados */
export const registrarSobraMistura = (atividadeId, misturaId, dados) => misturaPort.sobra(atividadeId, misturaId, dados);
/** @param {string} atividadeId @param {string} empresaId @param {string} dia */
export const getDiarioResumo = (atividadeId, empresaId, dia) => misturaPort.resumoDoDia(atividadeId, empresaId, dia);

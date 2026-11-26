/**
 * Porta do rastreio do trajeto no Diário da máquina (GPS, fase 1). Contrato do servidor:
 *  - POST /atividades/:id/trajetos                       (abre; mesma operation_id = replay, 200)
 *  - POST /atividades/:id/trajetos/:trajetoId/pontos     (lote de 1 a 200 pontos; reenvio do mesmo seq não duplica)
 *  - POST /atividades/:id/trajetos/:trajetoId/encerrar   (idempotente)
 *  - GET  /atividades/:id/trajetos?empresa_id=&dia=      (trajetos do dia com a linha amostrada)
 *
 * Mesmas regras das outras portas: o corpo passa por ALLOWLIST, o `operation_id` vem do service e o cliente nativo faz a
 * chamada. Os pontos NÃO usam `corpoSemVazios`: `precisao_m` e `velocidade_ms` vão como `null` quando o aparelho não
 * informa (o contrato aceita número ou null). Campos que o operador não preencheu não vão ao servidor.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { corpoSemVazios } from './lancamentoAtividadePort.js';

const CAMINHO = '/atividades';
const RECURSO = 'Trajeto';

/** POST /atividades/:id/trajetos. */
export const CAMPOS_DO_ABRIR_TRAJETO = Object.freeze(['empresa_id', 'bem_id', 'data_operacional', 'operation_id', 'implemento_bem_id', 'apontamento_id']);
/** Cada ponto do lote (o contrato). */
export const CAMPOS_DO_PONTO = Object.freeze(['seq', 'lat', 'lng', 'precisao_m', 'velocidade_ms', 'capturado_em']);
/** POST …/encerrar. */
export const CAMPOS_DO_ENCERRAR_TRAJETO = Object.freeze(['empresa_id']);

/** @param {string} operation @param {Record<string, unknown>} [details] */
const ctx = (operation, details) => ({ operation, resource: RECURSO, ...(details ? { details } : {}) });
/** @param {string} id */
const daAtividade = (id) => `${CAMINHO}/${encodeURIComponent(id)}/trajetos`;

/** Um ponto no formato do contrato: campos da allowlist, com `null` onde o aparelho não tem a leitura. @param {Record<string, any>} p */
export const corpoDoPonto = (p) => ({
  seq: p.seq,
  lat: p.lat,
  lng: p.lng,
  precisao_m: Number.isFinite(p.precisao_m) ? p.precisao_m : null,
  velocidade_ms: Number.isFinite(p.velocidade_ms) ? p.velocidade_ms : null,
  capturado_em: p.capturado_em,
});

export const trajetoPort = Object.freeze({
  /** @param {string} atividadeId @param {Record<string, any>} dados */
  abrir: (atividadeId, dados) =>
    nativeRequest(daAtividade(atividadeId), { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DO_ABRIR_TRAJETO), autenticado: true }, ctx('abrirTrajeto', { atividadeId })),

  /** @param {string} atividadeId @param {string} trajetoId @param {{ empresa_id: string, pontos: Array<Record<string, any>> }} dados */
  pontos: (atividadeId, trajetoId, dados) =>
    nativeRequest(
      `${daAtividade(atividadeId)}/${encodeURIComponent(trajetoId)}/pontos`,
      { method: 'POST', body: { empresa_id: dados.empresa_id, pontos: (dados.pontos ?? []).map(corpoDoPonto) }, autenticado: true },
      ctx('enviarPontosTrajeto', { atividadeId, trajetoId }),
    ),

  /** @param {string} atividadeId @param {string} trajetoId @param {Record<string, any>} dados */
  encerrar: (atividadeId, trajetoId, dados) =>
    nativeRequest(
      `${daAtividade(atividadeId)}/${encodeURIComponent(trajetoId)}/encerrar`,
      { method: 'POST', body: corpoSemVazios(dados, CAMPOS_DO_ENCERRAR_TRAJETO), autenticado: true },
      ctx('encerrarTrajeto', { atividadeId, trajetoId }),
    ),

  /** @param {string} atividadeId @param {string} empresaId @param {string} dia */
  listarDoDia: (atividadeId, empresaId, dia) =>
    nativeRequest(
      `${daAtividade(atividadeId)}?${new URLSearchParams({ empresa_id: String(empresaId), dia: String(dia) }).toString()}`,
      { autenticado: true },
      ctx('listarTrajetosDoDia', { atividadeId }),
    ),
});

// Superfície pública (index.js): funções, nunca o port.
/** @param {string} atividadeId @param {Record<string, any>} dados */
export const abrirTrajeto = (atividadeId, dados) => trajetoPort.abrir(atividadeId, dados);
/** @param {string} atividadeId @param {string} trajetoId @param {{ empresa_id: string, pontos: Array<Record<string, any>> }} dados */
export const enviarPontosTrajeto = (atividadeId, trajetoId, dados) => trajetoPort.pontos(atividadeId, trajetoId, dados);
/** @param {string} atividadeId @param {string} trajetoId @param {Record<string, any>} dados */
export const encerrarTrajeto = (atividadeId, trajetoId, dados) => trajetoPort.encerrar(atividadeId, trajetoId, dados);
/** @param {string} atividadeId @param {string} empresaId @param {string} dia */
export const listarTrajetosDoDia = (atividadeId, empresaId, dia) => trajetoPort.listarDoDia(atividadeId, empresaId, dia);

/**
 * Service de reversão da suplementação (P1.4) — FAIL-CLOSED desde a P0 do
 * estoque (D-PROD-161, MAIKE-ESTOQUE-P0-01, F3).
 *
 * Era a reversão feita pelo NAVEGADOR: apagar lotes de suplementação, reabrir o
 * período anterior, devolver estoque "por custo" (PATCH do saldo de um lote
 * compatível ou POST de um lote `REVERSAO`), reescrever `Produto.estoque_atual`
 * e apagar movimentos e lotes — tudo com escritas genéricas, sem transação e
 * fora do motor físico. Já estava suspensa na interface (D-PROD-94a, a
 * política de estorno do domínio); agora o backend recusa essas escritas (409
 * ESTOQUE_ESCRITA_DIRETA_RECUSADA) e o caminho inseguro sai também daqui.
 *
 * As três exportações mantêm a assinatura (os históricos do cocho e do depósito
 * continuam importando) e rejeitam com `ApiError` ANTES de qualquer I/O — nem
 * leitura. O estorno de verdade (suplementação e transferência) virá do motor,
 * numa transação única no servidor (P1).
 */

import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

/** @param {string} operation */
const estornoSuspenso = (operation) =>
  Promise.reject(
    new ApiError(API_ERROR_CODES.OPERATION_FAILED, {
      operation,
      resource: 'SuplementacaoHistorico',
      details: { motivo: 'estorno_suspenso_motor_unico' },
    })
  );

/**
 * Devolvia `quantidade` ao local por escrita genérica de lote e de
 * `estoque_atual`. Fail-closed: rejeita sem chamar API.
 * @param {{ empresaId?: string, produtoId?: string, produtoNome?: string, quantidade?: number, localEstoqueId?: string, localEstoqueNome?: string, custoUnitario?: number }} [_params]
 * @returns {Promise<never>}
 */
export const restaurarEstoqueNoLocal = async (_params) => estornoSuspenso('restaurarEstoqueNoLocal');

/**
 * Excluía um evento de suplementação revertendo o estoque pelo navegador.
 * Fail-closed: rejeita sem chamar API (nem lotes, nem período, nem evento).
 * @param {{ evento?: object, ponto?: object, userEmail?: string }} [_params]
 * @returns {Promise<never>}
 */
export const excluirEventoSuplementacaoComReversao = async (_params) =>
  estornoSuspenso('excluirEventoSuplementacaoComReversao');

/**
 * Excluía uma transferência entre depósitos apagando lotes e movimentos e
 * devolvendo saldo à origem pelo navegador. Fail-closed: rejeita sem chamar API.
 * @param {{ movimentacao?: object }} [_params]
 * @returns {Promise<never>}
 */
export const excluirTransferenciaDeposito = async (_params) => estornoSuspenso('excluirTransferenciaDeposito');

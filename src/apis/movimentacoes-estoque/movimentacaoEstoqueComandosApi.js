/**
 * Comandos transacionais de movimentação (ESTAB-P0-01).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';

const BASE = '/movimentacoes-estoque/comandos';

const ctx = (operation) => ({ operation, resource: 'MovimentacaoEstoqueComando' });

/** @param {Record<string, unknown>} body */
export const comandoSaidaSuplementacao = (body) =>
  nativeRequest(`${BASE}/saida-suplementacao`, { method: 'POST', body, autenticado: true }, ctx('comandoSaidaSuplementacao'));

/** @param {Record<string, unknown>} body */
export const comandoTransferenciaEntreLocais = (body) =>
  nativeRequest(
    `${BASE}/transferencia-locais`,
    { method: 'POST', body, autenticado: true },
    ctx('comandoTransferenciaEntreLocais')
  );

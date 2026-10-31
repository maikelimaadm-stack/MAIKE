/**
 * Idempotência persistida por tenant + operation_key (ESTAB-P0-01).
 */
import { createHash } from 'node:crypto';

import { AppError } from '../errors/AppError.js';

/** @param {unknown} payload */
export const fingerprintDePayload = (payload) =>
  createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex');

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{
 *   clienteId: string;
 *   operationKey: string;
 *   tipoOperacao: string;
 *   fingerprint: string;
 *   executar: () => Promise<{ httpStatus: number; body: Record<string, unknown> }>;
 * }} opcoes
 */
export const executarComIdempotencia = async (tx, opcoes) => {
  const { clienteId, operationKey, tipoOperacao, fingerprint, executar } = opcoes;
  const chave = {
    cliente_id_operation_key_tipo_operacao: {
      cliente_id: clienteId,
      operation_key: operationKey,
      tipo_operacao: tipoOperacao,
    },
  };

  const existente = await tx.operacaoIdempotente.findUnique({ where: chave });
  if (existente) {
    if (existente.fingerprint !== fingerprint) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', {
        details: { operation_id: operationKey, tipo_operacao: tipoOperacao },
      });
    }
    if (existente.status === 'committed' && existente.response_json) {
      return {
        replay: true,
        httpStatus: existente.http_status ?? 200,
        body: /** @type {Record<string, unknown>} */ (existente.response_json),
      };
    }
    if (existente.status === 'processing') {
      throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'Operação com a mesma chave ainda em processamento', {
        details: { operation_id: operationKey },
      });
    }
  }

  // Reserva da chave com `INSERT ... ON CONFLICT DO NOTHING` (createMany com
  // skipDuplicates), não `create` + captura de P2002: no PostgreSQL, um erro de
  // unique dentro da transação a deixa abortada, e a releitura no `catch` falhava
  // com 500 quando dois pedidos com a mesma chave chegavam juntos (D-PROD-90 R1).
  // Com ON CONFLICT, o segundo pedido espera o primeiro terminar e, sem erro,
  // relê a linha já confirmada: replay (mesmo conteúdo) ou conflito (outro).
  const { count } = await tx.operacaoIdempotente.createMany({
    data: [
      {
        cliente_id: clienteId,
        operation_key: operationKey,
        tipo_operacao: tipoOperacao,
        fingerprint,
        status: 'processing',
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) {
    const concorrente = await tx.operacaoIdempotente.findUnique({ where: chave });
    if (!concorrente || concorrente.fingerprint !== fingerprint) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', {
        details: { operation_id: operationKey },
      });
    }
    if (concorrente.status === 'committed' && concorrente.response_json) {
      return {
        replay: true,
        httpStatus: concorrente.http_status ?? 200,
        body: /** @type {Record<string, unknown>} */ (concorrente.response_json),
      };
    }
    throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'Operação com a mesma chave ainda em processamento', {
      details: { operation_id: operationKey },
    });
  }

  const { httpStatus, body } = await executar();
  await tx.operacaoIdempotente.update({
    where: chave,
    data: {
      status: 'committed',
      http_status: httpStatus,
      response_json: /** @type {import('@prisma/client').Prisma.InputJsonValue} */ (body),
    },
  });
  return { replay: false, httpStatus, body };
};

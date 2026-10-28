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

  try {
    await tx.operacaoIdempotente.create({
      data: {
        cliente_id: clienteId,
        operation_key: operationKey,
        tipo_operacao: tipoOperacao,
        fingerprint,
        status: 'processing',
      },
    });
  } catch (erro) {
    const codigo = /** @type {{ code?: string }} */ (erro)?.code;
    if (codigo === 'P2002') {
      const concorrente = await tx.operacaoIdempotente.findUnique({ where: chave });
      if (concorrente?.fingerprint !== fingerprint) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'operation_id reutilizado com payload diferente', {
          details: { operation_id: operationKey },
        });
      }
      if (concorrente?.status === 'committed' && concorrente.response_json) {
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
    throw erro;
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

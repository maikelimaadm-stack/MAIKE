/**
 * Tradutor único de erro para HTTP.
 *
 * Duas responsabilidades, e nenhuma a mais:
 *
 *  1. `AppError` vira `{ code, message }` com o status do contrato;
 *  2. erro de unique do PostgreSQL (Prisma `P2002`) vira
 *     `CONCURRENCY_CONFLICT` — a última barreira de concorrência produz código
 *     estável em vez de 500 opaco, como o contrato exige.
 *
 * Qualquer outra coisa é erro não previsto: 500 com corpo genérico. O erro
 * original vai para o log, nunca para o cliente — mensagem de erro é uma via de
 * vazamento de esquema e de dado.
 */

import { AppError, ehAppError } from './AppError.js';

/** Prisma sinaliza violação de unique com `P2002`. */
const ehViolacaoDeUnique = (erro) => erro?.code === 'P2002';

/** Prisma sinaliza violação de foreign key com `P2003`. */
const ehViolacaoDeVinculo = (erro) => erro?.code === 'P2003';

/**
 * Erro de validação de schema do Fastify.
 *
 * Sem este ramo, requisição malformada caía no `INTERNAL_ERROR` e voltava 500 —
 * o servidor culpando a si mesmo por um erro do cliente. Aqui ela vira 400 com
 * código próprio.
 */
const ehErroDeValidacao = (erro) =>
  Array.isArray(erro?.validation) || erro?.code === 'FST_ERR_VALIDATION';

/** Erro do Fastify que já traz status HTTP de cliente (4xx). */
const statusDeClienteDoFastify = (erro) => {
  const status = Number(erro?.statusCode);
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : null;
};

/**
 * Normaliza qualquer erro em `AppError`.
 * @param {unknown} erro
 * @returns {AppError}
 */
export const normalizarErro = (erro) => {
  if (ehAppError(erro)) return erro;

  if (ehViolacaoDeUnique(erro)) {
    return new AppError('CONCURRENCY_CONFLICT', 'registro já existe', { cause: erro });
  }

  if (ehViolacaoDeVinculo(erro)) {
    return new AppError('TENANT_SCOPE_VIOLATION', 'vínculo inválido para este tenant', {
      cause: erro,
    });
  }

  if (ehErroDeValidacao(erro)) {
    const appError = new AppError('REQUEST_VALIDATION_FAILED', 'requisição inválida', {
      cause: erro,
    });
    appError.status = 400;
    return appError;
  }

  const statusDeCliente = statusDeClienteDoFastify(erro);
  if (statusDeCliente !== null) {
    const mensagem =
      typeof (/** @type {{message?: unknown}} */ (erro)?.message) === 'string'
        ? /** @type {{message: string}} */ (erro).message
        : 'requisição recusada';
    const appError = new AppError('REQUEST_REJECTED', mensagem, {
      cause: erro,
    });
    appError.status = statusDeCliente;
    return appError;
  }

  return new AppError('INTERNAL_ERROR', 'erro interno', { cause: erro });
};

/**
 * Handler de erro do Fastify.
 * @param {unknown} erro
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 */
export const errorHandler = (erro, request, reply) => {
  const appError = normalizarErro(erro);
  const status = appError.status;

  // O log carrega a causa; a resposta, nunca.
  request.log.error(
    {
      code: appError.code,
      request_id: request.contexto?.requestId,
      cliente_id: request.contexto?.auth?.clienteId,
      err: appError.cause ?? appError,
    },
    `erro tratado: ${appError.code}`
  );

  reply.status(status).send({
    code: appError.code,
    message: status === 500 ? 'erro interno' : appError.message,
    request_id: request.contexto?.requestId,
  });
};

/**
 * Barreira de escrita no catálogo global (D-PROD-57).
 *
 * `Permissao.is_admin` do tenant NÃO basta. O operador precisa existir em
 * `OperadorProdutoMaike` com identidade verificada (cliente_id + usuario_id do
 * auth_context) e estado ativo — sem auto-provisionamento por endpoint.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from './authContext.js';
import { productOperatorRequired } from '../errors/AppError.js';

/**
 * @param {import('fastify').FastifyRequest} request
 * @returns {Promise<import('@prisma/client').OperadorProdutoMaike>}
 */
export const exigirOperadorProduto = async (request) => {
  const auth = exigirAuthContext(request.contexto?.auth);
  const prisma = getPrismaClient();
  const operador = await prisma.operadorProdutoMaike.findUnique({
    where: {
      cliente_id_usuario_id: {
        cliente_id: auth.clienteId,
        usuario_id: auth.usuarioId,
      },
    },
  });

  if (!operador?.ativo) {
    throw productOperatorRequired();
  }

  request.contexto.operadorProduto = operador;
  return operador;
};

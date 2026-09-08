/**
 * Repositório de autenticação.
 *
 * Camada de acesso a dado, sem regra de negócio. Duas buscas, e as duas são
 * deliberadamente estreitas: o login resolve o `Cliente` pelo `codigo`
 * operacional e o `Usuario` **dentro daquele cliente**.
 *
 * Repare que `buscarUsuarioPorLogin` recebe `clienteId` como parâmetro
 * explícito e o usa no filtro. É o padrão de toda a camada: repositório recebe
 * tenant já resolvido pelo contexto, nunca um DTO de HTTP.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * @param {string} codigo identificador operacional do tenant
 */
export const buscarClientePorCodigo = async (codigo) => {
  const prisma = getPrismaClient();
  return prisma.cliente.findUnique({
    where: { codigo },
    select: { id: true, codigo: true, nome: true, ativo: true },
  });
};

/**
 * @param {string} clienteId tenant já resolvido
 * @param {string} login
 */
export const buscarUsuarioPorLogin = async (clienteId, login) => {
  const prisma = getPrismaClient();
  return prisma.usuario.findUnique({
    where: { cliente_id_login: { cliente_id: clienteId, login } },
    select: {
      id: true,
      cliente_id: true,
      nome: true,
      login: true,
      senha_hash: true,
      ativo: true,
    },
  });
};

/**
 * @param {string} clienteId
 * @param {string} usuarioId
 */
export const buscarUsuarioAtivoPorId = async (clienteId, usuarioId) => {
  const prisma = getPrismaClient();
  return prisma.usuario.findFirst({
    where: { id: usuarioId, cliente_id: clienteId, ativo: true },
    select: { id: true, cliente_id: true, nome: true, login: true, ativo: true },
  });
};

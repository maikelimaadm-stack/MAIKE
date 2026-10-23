/**
 * Repositório de autenticação.
 *
 * Camada de acesso a dado, sem regra de negócio. Duas buscas, e as duas são
 * deliberadamente estreitas. Desde a simplificação do login (D-PROD-32), quem
 * entra informa só `login` e `senha`; o tenant vem do `Usuario` encontrado.
 *
 * `buscarUsuarioPorLogin` permanece para bootstrap e testes que já conhecem o
 * tenant. `buscarUsuarioAtivoPorLogin` resolve o par login+senha na entrada.
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

const SELECAO_LOGIN = Object.freeze({
  id: true,
  cliente_id: true,
  nome: true,
  login: true,
  senha_hash: true,
  ativo: true,
});

/**
 * Usuário ativo cujo login coincide, com cliente ativo.
 *
 * Devolve `null` quando não há match **ou** quando há ambiguidade (dois tenants
 * com o mesmo login). Ambos casos viram "credenciais inválidas" no service —
 * sem oráculo de enumeração.
 *
 * @param {string} login
 */
export const buscarUsuarioAtivoPorLogin = async (login) => {
  const prisma = getPrismaClient();
  const candidatos = await prisma.usuario.findMany({
    where: {
      login,
      ativo: true,
      cliente: { ativo: true },
    },
    select: SELECAO_LOGIN,
    take: 2,
  });

  if (candidatos.length !== 1) return null;
  return candidatos[0];
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

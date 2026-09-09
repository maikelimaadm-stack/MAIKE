/**
 * Utilidades dos testes de backend.
 *
 * Os testes rodam contra um PostgreSQL **real**. Não há mock de Prisma: o que
 * precisa ser provado aqui — isolamento entre tenants, atomicidade da sequência
 * sob concorrência, violação de unique virando código estável — só existe de
 * verdade no banco. Um mock provaria que o mock funciona.
 */

import { randomUUID } from 'node:crypto';

import { construirApp } from '../src/app.js';
import { getPrismaClient, closePrismaClient } from '../src/database/prismaClient.js';
import { gerarSenhaHash } from '../src/modules/auth/authService.js';

/** Ordem de limpeza respeita as foreign keys (tudo é Restrict). */
const ORDEM_DE_LIMPEZA = [
  'auditLog',
  'registroAnexo',
  'setor',
  'entidadeCodigoSequencia',
  'usuario',
  'cliente',
];

export const limparBanco = async () => {
  const prisma = getPrismaClient();
  for (const model of ORDEM_DE_LIMPEZA) {
    await prisma[model].deleteMany({});
  }
};

export const encerrar = async () => {
  await closePrismaClient();
};

/**
 * Cria um tenant com um usuário, prontos para autenticar.
 * @param {{codigo?: string, login?: string, senha?: string}} [opcoes]
 */
export const criarTenant = async (opcoes = {}) => {
  const prisma = getPrismaClient();
  const codigo = opcoes.codigo || `t-${randomUUID().slice(0, 8)}`;
  const login = opcoes.login || 'operador';
  const senha = opcoes.senha || 'senha-de-teste-1';

  const cliente = await prisma.cliente.create({
    data: { codigo, nome: `Tenant ${codigo}` },
  });

  const usuario = await prisma.usuario.create({
    data: {
      cliente_id: cliente.id,
      nome: 'Operador de Teste',
      login,
      senha_hash: await gerarSenhaHash(senha),
    },
  });

  return { cliente, usuario, credenciais: { cliente: codigo, login, senha } };
};

/** Monta o app sem abrir porta. */
export const criarApp = async () => construirApp({ logger: false });

/**
 * Autentica e devolve o token.
 * @param {import('fastify').FastifyInstance} app
 * @param {{cliente: string, login: string, senha: string}} credenciais
 */
export const autenticarNoApp = async (app, credenciais) => {
  const resposta = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: credenciais,
  });
  return { resposta, corpo: resposta.json() };
};

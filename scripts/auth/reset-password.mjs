#!/usr/bin/env node
/**
 * Redefine a senha de um usuário **ativo** pelo login global (D-PROD-33 / D-PROD-35).
 *
 * Não é CRUD de usuários (P6). É recuperação operacional quando o operador
 * esqueceu a senha ou o hash no banco não bate com o esperado — sem reintroduzir
 * "código de cliente" na entrada.
 *
 * Proteções:
 *  - exige RESET_PASSWORD_LOGIN, RESET_PASSWORD_NOVA_SENHA e RESET_PASSWORD_CONFIRM=sim;
 *  - falha se zero ou mais de um usuário ativo coincidir com o login;
 *  - não imprime senha, hash nem DATABASE_URL.
 */

import { PrismaClient } from '@prisma/client';

import { env } from '../../backend/src/config/env.js';
import { gerarSenhaHash } from '../../backend/src/modules/auth/authService.js';

const falhar = (mensagem) => {
  console.error(`auth:reset-password — FALHOU\n\n  ${mensagem}\n`);
  process.exit(1);
};

const texto = (nome) => {
  const valor = process.env[nome];
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
};

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{ login: string, novaSenha: string }} entrada
 */
export const redefinirSenhaPorLogin = async (prisma, { login, novaSenha }) => {
  const loginNormalizado = login.trim().toLowerCase();
  if (!loginNormalizado || !novaSenha) {
    throw new Error('login e nova senha são obrigatórios.');
  }

  const candidatos = await prisma.usuario.findMany({
    where: {
      login: { equals: loginNormalizado, mode: 'insensitive' },
      ativo: true,
      cliente: { ativo: true },
    },
    select: { id: true, login: true },
    take: 2,
  });

  if (candidatos.length !== 1) {
    throw new Error(
      `nenhum usuário ativo único com login '${loginNormalizado}'. ` +
        'Verifique duplicatas (migration p6_1_login_global_hygiene) ou desative contas extras.'
    );
  }

  const usuario = candidatos[0];

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: { senha_hash: await gerarSenhaHash(novaSenha) },
  });

  return { login: usuario.login, usuarioId: usuario.id };
};

const principal = async () => {
  if (!env.databaseUrl) falhar('DATABASE_URL ausente. Veja .env.example.');

  const login = texto('RESET_PASSWORD_LOGIN');
  const novaSenha = texto('RESET_PASSWORD_NOVA_SENHA');
  const confirmacao = texto('RESET_PASSWORD_CONFIRM');

  if (!login || !novaSenha) {
    falhar(
      'defina RESET_PASSWORD_LOGIN e RESET_PASSWORD_NOVA_SENHA.\n' +
        '  Exemplo:\n' +
        '    RESET_PASSWORD_LOGIN=admin \\\n' +
        '    RESET_PASSWORD_NOVA_SENHA=\'SuaSenhaSegura\' \\\n' +
        '    RESET_PASSWORD_CONFIRM=sim \\\n' +
        '    npm run auth:reset-password'
    );
  }

  if (confirmacao !== 'sim') {
    falhar(
      'RESET_PASSWORD_CONFIRM deve ser exatamente "sim" para executar.\n' +
        '  Isto evita redefinição acidental em pipeline.'
    );
  }

  const prisma = new PrismaClient();
  try {
    const resultado = await redefinirSenhaPorLogin(prisma, { login, novaSenha });
    console.log('auth:reset-password — OK');
    console.log(`  login '${resultado.login}' teve a senha atualizada.`);
    console.log('  a nova senha não é exibida.');
  } catch (erro) {
    falhar(erro instanceof Error ? erro.message : 'erro desconhecido');
  } finally {
    await prisma.$disconnect();
  }
};

if (process.argv[1] && process.argv[1].endsWith('reset-password.mjs')) {
  await principal();
}

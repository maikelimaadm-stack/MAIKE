#!/usr/bin/env node
/**
 * Bootstrap ÚNICO do Administrador Principal (proprietário) do MAIKE (D-PROD-70).
 *
 * - Sem administrador padrão e sem senha no código, em argumento ou em variável.
 * - Login e senha são pedidos no terminal (senha oculta, digitada duas vezes).
 * - Exige confirmação digitada; recusa se já existir proprietário.
 * - Recusa NODE_ENV=production ou banco fora desta máquina sem
 *   ADMIN_BOOTSTRAP_ALLOW_PRODUCTION=sim (produção só com aprovação separada
 *   do proprietário — ver runbook). A checagem vem antes de qualquer conexão.
 * - Nunca imprime senha, hash ou DATABASE_URL.
 * - O MFA NÃO é criado aqui: o primeiro login no MAIKE Admin obriga a inscrição.
 *
 * Uso:  DATABASE_URL=... node scripts/admin/bootstrap-admin-principal.mjs
 * Teste automatizado (sem TTY): ADMIN_BOOTSTRAP_STDIN=sim e as respostas em linhas no stdin.
 */

import { createInterface } from 'node:readline';
import { motivoAlvoProtegido } from '../auth/alvoProtegido.mjs';

const sair = (msg, codigo = 1) => {
  console.error(`bootstrap-admin-principal: ${msg}`);
  process.exit(codigo);
};

if (!process.stdin.isTTY && process.env.ADMIN_BOOTSTRAP_STDIN !== 'sim') {
  sair('execute num terminal interativo (a senha não é aceita por argumento nem variável)');
}

const { env } = await import('../../backend/src/config/env.js');
if (!env.databaseUrl) sair('DATABASE_URL ausente');
const motivo = motivoAlvoProtegido(process.env, env.databaseUrl);
if (motivo && process.env.ADMIN_BOOTSTRAP_ALLOW_PRODUCTION !== 'sim') {
  sair(`recusado em ${motivo} (exige ADMIN_BOOTSTRAP_ALLOW_PRODUCTION=sim e aprovação separada)`);
}

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
const linhas = rl[Symbol.asyncIterator]();
let oculto = false;
// Em TTY, não ecoa o que é digitado enquanto `oculto` estiver ligado.
const escritaOriginal = /** @type {any} */ (rl)._writeToOutput?.bind(rl);
/** @type {any} */ (rl)._writeToOutput = (texto) => {
  if (!oculto || /\n|\r/.test(texto)) escritaOriginal?.(oculto ? '\n' : texto);
};
const perguntar = async (texto, { secreto = false } = {}) => {
  process.stdout.write(texto);
  oculto = secreto;
  const { value, done } = await linhas.next();
  oculto = false;
  if (secreto && !process.stdin.isTTY) process.stdout.write('\n');
  if (done) sair('entrada encerrada');
  return String(value ?? '');
};

console.log('Criação do proprietário do MAIKE (uma única vez).');
const login = (await perguntar('Login do proprietário: ')).trim();
const senha = await perguntar('Senha (mín. 12 caracteres, não aparece na tela): ', { secreto: true });
const confirmacao = await perguntar('Repita a senha: ', { secreto: true });
if (senha !== confirmacao) sair('as senhas não conferem; nada foi criado');
const ok = (await perguntar('Digite CRIAR PROPRIETARIO para confirmar: ')).trim();
rl.close();
if (ok !== 'CRIAR PROPRIETARIO') sair('confirmação não digitada; nada foi criado');

const { criarProprietarioInicial } = await import('../../backend/src/modules/adminMaike/adminService.js');
const { closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
try {
  const admin = await criarProprietarioInicial({ login, senha });
  console.log(`proprietário criado: login=${admin.login} id=${admin.id}`);
  console.log('Próximo passo: entre no MAIKE Admin; o segundo fator (TOTP) será exigido no primeiro acesso.');
} catch (erro) {
  sair(/** @type {any} */ (erro)?.message ?? 'falha ao criar proprietário');
} finally {
  await closePrismaClient();
}

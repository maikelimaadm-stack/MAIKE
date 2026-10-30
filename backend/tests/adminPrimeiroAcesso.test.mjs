/**
 * D-PROD-78 — primeiro acesso do proprietário pela web (sem terminal).
 *
 * Só enquanto não há proprietário, só com a prova de posse da
 * ADMIN_MAIKE_CHAVE e com o Origin do admin. Depois, 409 para sempre. Também a
 * chave em texto (gerenciador de senhas, ≥ 32 caracteres) passa a valer.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { env } from '../src/config/env.js';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarApp, limparBanco, encerrar, cookieAdminDe, ORIGEM_ADMIN } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
const CHAVE = 'Texto-Aleatorio-De-Gerenciador-De-Senhas-42xYz';
const original = { chave: env.adminMaikeChave, nodeEnv: env.nodeEnv, origins: env.adminOrigins };
const base = { origin: ORIGEM_ADMIN };
const prisma = () => getPrismaClient();
const post = (payload, headers = base) => app.inject({ method: 'POST', url: '/admin-maike/primeiro-acesso', headers, payload });
const disponivel = async () => (await app.inject({ method: 'GET', url: '/admin-maike/primeiro-acesso' })).json().disponivel;

before(async () => {
  env.adminMaikeChave = CHAVE;
  app = await criarApp();
  await app.ready();
});
after(async () => {
  Object.assign(env, { adminMaikeChave: original.chave, nodeEnv: original.nodeEnv, adminOrigins: original.origins });
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
  await prisma().eventoSegurancaAdminMaike.deleteMany();
  await prisma().sessaoAdminMaike.deleteMany();
  await prisma().adminPrincipalMaike.deleteMany();
});

describe('MAIKE Admin — primeiro acesso pela web', () => {
  test('PA-01 chave errada recusa; certa cria o proprietário; depois some (409) e o login exige MFA', async () => {
    assert.equal(await disponivel(), true);
    const errada = await post({ chave: `${CHAVE}x`, login: 'dono.maike', senha: 'senha-forte-do-dono-1' });
    assert.equal(errada.statusCode, 401);
    assert.equal(await prisma().adminPrincipalMaike.count(), 0);
    assert.equal(await prisma().eventoSegurancaAdminMaike.count({ where: { acao: 'primeiro_acesso', sucesso: false } }), 1);

    const certa = await post({ chave: CHAVE, login: 'dono.maike', senha: 'senha-forte-do-dono-1' });
    assert.equal(certa.statusCode, 201, certa.body);
    assert.equal(certa.json().admin.login, 'dono.maike');
    assert.equal(JSON.stringify(certa.json()).includes('senha'), false, 'resposta sem senha nem hash');
    const admin = await prisma().adminPrincipalMaike.findFirst();
    assert.equal(admin.mfa_ativo, false);
    assert.equal(await disponivel(), false);

    const segunda = await post({ chave: CHAVE, login: 'outro.dono', senha: 'senha-forte-do-dono-2' });
    assert.equal(segunda.statusCode, 409);
    assert.equal(await prisma().adminPrincipalMaike.count(), 1);

    const login = await app.inject({ method: 'POST', url: '/admin-maike/auth/login', headers: base, payload: { login: 'dono.maike', senha: 'senha-forte-do-dono-1' } });
    assert.equal(login.statusCode, 200);
    assert.ok(cookieAdminDe(login));
    assert.notEqual(login.json().etapa, 'verificada', 'sem MFA inscrito, a sessão não é verificada');
  });

  test('PA-02 sem Origin do admin, senha fraca ou sem chave configurada: recusa e não cria', async () => {
    for (const headers of [{}, { origin: 'https://evil.example' }]) {
      const r = await post({ chave: CHAVE, login: 'dono.maike', senha: 'senha-forte-do-dono-1' }, headers);
      assert.equal(r.statusCode, 403);
    }
    assert.equal((await post({ chave: CHAVE, login: 'dono.maike', senha: 'curta' })).statusCode, 422);
    assert.equal(await prisma().adminPrincipalMaike.count(), 0);
    env.adminMaikeChave = null;
    env.nodeEnv = 'production';
    try {
      assert.equal((await app.inject({ method: 'GET', url: '/admin-maike/primeiro-acesso' })).statusCode, 503);
    } finally {
      env.adminMaikeChave = CHAVE;
      env.nodeEnv = original.nodeEnv;
    }
  });

  test('PA-03 tentativas seguidas por IP: 429', async () => {
    let ultimo;
    for (let i = 0; i < 6; i += 1) ultimo = await post({ chave: 'errada-errada-errada-errada-errada-1', login: 'dono.maike', senha: 'senha-forte-do-dono-1' });
    assert.equal(ultimo.statusCode, 429);
    assert.equal(await prisma().adminPrincipalMaike.count(), 0);
  });

  test('PA-04 chave em texto curta (< 32) ou com espaço é inválida em produção (503)', async () => {
    env.nodeEnv = 'production';
    env.adminOrigins = [ORIGEM_ADMIN];
    try {
      for (const chave of ['curta-demais', 'tem espaco no meio mas e longa o suficiente']) {
        env.adminMaikeChave = chave;
        assert.equal((await app.inject({ method: 'GET', url: '/admin-maike/primeiro-acesso' })).statusCode, 503, chave);
      }
      env.adminMaikeChave = CHAVE;
      assert.equal((await app.inject({ method: 'GET', url: '/admin-maike/primeiro-acesso' })).statusCode, 200);
    } finally {
      Object.assign(env, { adminMaikeChave: CHAVE, nodeEnv: original.nodeEnv, adminOrigins: original.origins });
    }
  });
});

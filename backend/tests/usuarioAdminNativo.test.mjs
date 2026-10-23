/**
 * Administração de Usuario nativa (P6.0, D-PROD-34).
 *
 * Prova tenant do token, CRUD mínimo sem DELETE, senha_hash fora da resposta,
 * login único por cliente e bloqueio de auto-desativação.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { gerarSenhaHash } from '../src/modules/auth/authService.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;

before(async () => {
  app = await criarApp();
  await app.ready();
});

after(async () => {
  await app.close();
  await encerrar();
});

beforeEach(async () => {
  await limparBanco();
});

const auth = (token) => ({ authorization: `Bearer ${token}` });

const tenantAutenticado = async (opcoes) => {
  const { cliente, usuario, credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, usuario, token: corpo.token, credenciais };
};

describe('P6.0 — sessão obrigatória', () => {
  test('BE-P60-01 GET /usuarios sem token reprova', async () => {
    const r = await app.inject({ method: 'GET', url: '/usuarios' });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
  });

  test('BE-P60-02 DELETE /usuarios/:id não existe', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'DELETE',
      url: '/usuarios/qualquer',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 404);
  });
});

describe('P6.0 — CRUD mínimo', () => {
  test('BE-P60-03 POST cria conta sem expor senha_hash', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: auth(token),
      payload: { nome: 'Ana Operadora', login: 'ana.ops', senha: 'senha-segura-1' },
    });
    assert.equal(r.statusCode, 201);
    const corpo = r.json();
    assert.equal(corpo.login, 'ana.ops');
    assert.equal(corpo.ativo, true);
    assert.equal('senha_hash' in corpo, false);
    assert.equal('senha' in corpo, false);

    const prisma = getPrismaClient();
    const bruto = await prisma.usuario.findFirst({ where: { login: 'ana.ops' } });
    assert.ok(bruto?.senha_hash);
    assert.notEqual(bruto.senha_hash, 'senha-segura-1');
  });

  test('BE-P60-04 login duplicado no tenant reprova', async () => {
    const { token } = await tenantAutenticado({ login: 'unico' });
    const r = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: auth(token),
      payload: { nome: 'Outro', login: 'unico', senha: 'senha-segura-2' },
    });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'USUARIO_LOGIN_DUPLICADO');
  });

  test('BE-P60-05 PATCH atualiza nome, ativo e nova_senha', async () => {
    const { token, usuario } = await tenantAutenticado();
    const hashAntes = usuario.senha_hash;

    const r = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${usuario.id}`,
      headers: auth(token),
      payload: { nome: 'Nome Novo', nova_senha: 'outra-senha-99' },
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().nome, 'Nome Novo');

    const prisma = getPrismaClient();
    const depois = await prisma.usuario.findUnique({ where: { id: usuario.id } });
    assert.notEqual(depois.senha_hash, hashAntes);
  });

  test('BE-P60-06 não desativa a própria conta', async () => {
    const { token, usuario } = await tenantAutenticado();
    const r = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${usuario.id}`,
      headers: auth(token),
      payload: { ativo: false },
    });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'USUARIO_SELF_DEACTIVATE');
  });
});

describe('P6.0 — isolamento entre tenants', () => {
  test('BE-P60-07 tenant B não vê usuário do tenant A', async () => {
    const a = await tenantAutenticado({ login: 'a-user' });
    const b = await tenantAutenticado({ login: 'b-user' });

    const prisma = getPrismaClient();
    await prisma.usuario.create({
      data: {
        cliente_id: a.cliente.id,
        nome: 'Só A',
        login: 'so-a',
        senha_hash: await gerarSenhaHash('senha-segura-3'),
      },
    });

    const listaB = await app.inject({
      method: 'GET',
      url: '/usuarios',
      headers: auth(b.token),
    });
    assert.equal(listaB.statusCode, 200);
    const logins = listaB.json().map((u) => u.login);
    assert.ok(!logins.includes('so-a'));
    assert.ok(logins.includes('b-user'));
  });

  test('BE-P60-08b POST recusa login já ativo em outro tenant (D-PROD-35)', async () => {
    await tenantAutenticado({ login: 'global-login' });
    const b = await tenantAutenticado({ login: 'outro-user' });

    const r = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: auth(b.token),
      payload: { nome: 'Conflito', login: 'global-login', senha: 'senha-segura-9' },
    });

    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'USUARIO_LOGIN_DUPLICADO');
  });

  test('BE-P60-08 PATCH com id de outro tenant reprova como NOT_FOUND', async () => {
    const a = await tenantAutenticado({ login: 'tenant-a' });
    const b = await tenantAutenticado({ login: 'tenant-b' });

    const r = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${a.usuario.id}`,
      headers: auth(b.token),
      payload: { nome: 'Invadir' },
    });
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().code, 'USUARIO_NOT_FOUND');
  });
});

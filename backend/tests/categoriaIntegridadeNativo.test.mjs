/**
 * R5 — integridade hierárquica de Categoria (CAT-01 a CAT-04).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import {
  criarApp,
  criarTenant,
  limparBanco,
  encerrar,
  autenticarNoApp,
} from './helpers.mjs';

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

const tenantAutenticado = async () => {
  const { credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token };
};

const criarCategoria = async (token, payload) => {
  const r = await app.inject({
    method: 'POST',
    url: '/categorias',
    headers: auth(token),
    payload,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

describe('R5 — Categoria hierarquia', () => {
  test('BE-R5-01 rejeita PATCH que forma ciclo A→B→C e C como pai de A', async () => {
    const { token } = await tenantAutenticado();
    const a = await criarCategoria(token, { nome: 'A' });
    const b = await criarCategoria(token, { nome: 'B', categoria_pai_id: a.id });
    const c = await criarCategoria(token, { nome: 'C', categoria_pai_id: b.id });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/categorias/${a.id}`,
      headers: auth(token),
      payload: { categoria_pai_id: c.id },
    });
    assert.equal(patch.statusCode, 400);
    assert.equal(patch.json().code, 'REQUEST_VALIDATION_FAILED');

    const prisma = getPrismaClient();
    const registroA = await prisma.categoria.findFirst({ where: { id: a.id } });
    assert.equal(registroA.categoria_pai_id, null);
  });

  test('BE-R5-02 rejeita auto-parentesco', async () => {
    const { token } = await tenantAutenticado();
    const a = await criarCategoria(token, { nome: 'SOLO' });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/categorias/${a.id}`,
      headers: auth(token),
      payload: { categoria_pai_id: a.id },
    });
    assert.equal(patch.statusCode, 400);
    assert.equal(patch.json().code, 'REQUEST_VALIDATION_FAILED');
  });

  test('BE-R5-03 PATCH com categoria_pai_id null desfaz vínculo', async () => {
    const { token } = await tenantAutenticado();
    const pai = await criarCategoria(token, { nome: 'PAI' });
    const filho = await criarCategoria(token, { nome: 'FILHO', categoria_pai_id: pai.id });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/categorias/${filho.id}`,
      headers: auth(token),
      payload: { categoria_pai_id: null },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().categoria_pai_id, null);
    assert.equal(patch.json().categoria_pai_nome, null);
  });

  test('BE-R5-04 rename do pai propaga categoria_pai_nome às filhas diretas', async () => {
    const { token } = await tenantAutenticado();
    const pai = await criarCategoria(token, { nome: 'ANTIGO' });
    await criarCategoria(token, { nome: 'B', categoria_pai_id: pai.id });
    await criarCategoria(token, { nome: 'C', categoria_pai_id: pai.id });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/categorias/${pai.id}`,
      headers: auth(token),
      payload: { nome: 'NOVO' },
    });
    assert.equal(patch.statusCode, 200);

    const prisma = getPrismaClient();
    const filhas = await prisma.categoria.findMany({
      where: { categoria_pai_id: pai.id },
      select: { id: true, categoria_pai_nome: true },
    });
    assert.equal(filhas.length, 2);
    for (const f of filhas) {
      assert.equal(f.categoria_pai_nome, 'NOVO');
    }
  });
});

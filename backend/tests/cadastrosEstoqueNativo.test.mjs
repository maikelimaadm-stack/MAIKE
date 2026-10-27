/**
 * Categoria, LocalEstoque e Produto nativos (P5.2).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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

const EMPRESA = 'empresa-legada-1';

const tenantAutenticado = async () => {
  const { credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token };
};

const auth = (token) => ({ authorization: `Bearer ${token}` });

describe('P5.2 — Categoria', () => {
  test('BE-P52-01 cria categoria numerada', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/categorias',
      headers: auth(token),
      payload: { nome: 'Ração' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().numero_categoria, '1');
  });
});

describe('P5.2 — LocalEstoque', () => {
  test('BE-P52-02 cria local numerado', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/locais-estoque',
      headers: auth(token),
      payload: { nome: 'Depósito central' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().numero_local, '1');
  });
});

describe('P5.2 — Produto', () => {
  test('BE-P52-03 cria produto numerado', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome_produto: 'Milho' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().numero_produto, '1');
    assert.equal(r.json().nome_produto, 'MILHO');
  });

  test('BE-P52-04 filtra por empresa_id', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome_produto: 'Sal' },
    });
    const lista = await app.inject({
      method: 'GET',
      url: `/produtos?empresa_id=${EMPRESA}`,
      headers: auth(token),
    });
    assert.equal(lista.json().length, 1);
  });
});

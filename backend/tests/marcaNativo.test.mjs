/**
 * Marca nativa — PostgreSQL real (P4.4-Marcas, D-PROD-42).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { escopoDaNumeracao, ENTIDADE_SEQUENCIA } from '../src/modules/marcas/marcaService.js';
import { ESCOPO_TENANT } from '../src/modules/sequencias/entidadeCodigoService.js';
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

const tenantAutenticado = async (opcoes) => {
  const { credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token };
};

const auth = (token) => ({ authorization: `Bearer ${token}` });

const corpoValido = (extras = {}) => ({
  empresa_id: EMPRESA,
  nome: 'NELORE',
  ...extras,
});

const criarMarca = (token, extras) =>
  app.inject({
    method: 'POST',
    url: '/marcas',
    headers: auth(token),
    payload: corpoValido(extras),
  });

describe('P4.4-Marcas — sessão e numeração', () => {
  test('BE-P44-01 GET /marcas sem token reprova', async () => {
    const r = await app.inject({ method: 'GET', url: '/marcas' });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
  });

  test('BE-P44-02 primeira marca recebe numero_marca "1"', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarMarca(token);
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().numero_marca, '1');
    assert.equal(escopoDaNumeracao(), ESCOPO_TENANT);
    assert.equal(ENTIDADE_SEQUENCIA, 'Marca');
  });

  test('BE-P44-03 cliente_id no corpo é recusado', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarMarca(token, { cliente_id: 'x' });
    assert.equal(r.statusCode, 400);
  });
});

describe('P4.4-Marcas — tenant e unicidade', () => {
  test('BE-P44-04 marca de outro tenant não é visível', async () => {
    const a = await tenantAutenticado();
    const b = await tenantAutenticado();
    const criada = await criarMarca(a.token);
    const id = criada.json().id;

    const listaB = await app.inject({ method: 'GET', url: '/marcas', headers: auth(b.token) });
    assert.equal(listaB.json().length, 0);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/marcas/${id}`,
      headers: auth(b.token),
      payload: { nome: 'OUTRA' },
    });
    assert.equal(patch.statusCode, 404);
    assert.equal(patch.json().code, 'MARCA_NOT_FOUND');
  });

  test('BE-P44-05 nome duplicado na mesma empresa reprova', async () => {
    const { token } = await tenantAutenticado();
    assert.equal((await criarMarca(token)).statusCode, 201);
    const r = await criarMarca(token, { nome: 'nelore' });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'MARCA_NAME_CONFLICT');
  });
});

describe('P4.4-Marcas — exclusão', () => {
  test('BE-P44-06 DELETE remove a marca do tenant', async () => {
    const { token } = await tenantAutenticado();
    const criada = await criarMarca(token);
    const id = criada.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/marcas/${id}`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 204);
    assert.equal(await getPrismaClient().marca.count(), 0);
  });
});

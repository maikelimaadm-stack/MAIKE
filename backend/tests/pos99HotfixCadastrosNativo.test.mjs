/**
 * POS-PR99 — fluxos HTTP Empresa e Categoria (GET após POST/PATCH).
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

const auth = (token) => ({ authorization: `Bearer ${token}` });

const tenantAutenticado = async () => {
  const { credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token };
};

describe('POS99 — Empresa nativa', () => {
  test('POST 201 → GET contém id; PATCH persiste; pessoa física sem CPF', async () => {
    const { token } = await tenantAutenticado();

    const post = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(token),
      payload: { apelido: 'JUR', nome: 'EMPRESA JUR', tipo_pessoa: 'Jurídica' },
    });
    assert.equal(post.statusCode, 201);
    const id = post.json().id;
    assert.ok(id);

    const lista = await app.inject({ method: 'GET', url: '/empresas', headers: auth(token) });
    assert.equal(lista.statusCode, 200);
    assert.ok(lista.json().some((e) => e.id === id));

    const patch = await app.inject({
      method: 'PATCH',
      url: `/empresas/${id}`,
      headers: auth(token),
      payload: { nome: 'EMPRESA JUR OK' },
    });
    assert.equal(patch.statusCode, 200);

    const posPatch = await app.inject({ method: 'GET', url: '/empresas', headers: auth(token) });
    assert.equal(posPatch.json().find((e) => e.id === id)?.nome, 'EMPRESA JUR OK');

    const pf = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(token),
      payload: { apelido: 'PF', nome: 'PESSOA FISICA', tipo_pessoa: 'Física' },
    });
    assert.equal(pf.statusCode, 201);
  });

  test('schema inválido retorna 400', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(token),
      payload: { apelido: 'X' },
    });
    assert.equal(r.statusCode, 400);
  });

  test('tenants distintos não veem empresas um do outro', async () => {
    const t1 = await tenantAutenticado();
    const t2 = await tenantAutenticado();

    const criada = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(t1.token),
      payload: { apelido: 'T1', nome: 'SOMENTE T1', tipo_pessoa: 'Jurídica' },
    });
    const id = criada.json().id;

    const lista2 = await app.inject({ method: 'GET', url: '/empresas', headers: auth(t2.token) });
    assert.equal(lista2.json().some((e) => e.id === id), false);
  });
});

describe('POS99 — Categoria nativa', () => {
  test('POST raiz e filha → GET lista contém ambos', async () => {
    const { token } = await tenantAutenticado();

    const raiz = await app.inject({
      method: 'POST',
      url: '/categorias',
      headers: auth(token),
      payload: { nome: 'RAIZ POS99' },
    });
    assert.equal(raiz.statusCode, 201);
    const raizId = raiz.json().id;

    const filha = await app.inject({
      method: 'POST',
      url: '/categorias',
      headers: auth(token),
      payload: { nome: 'FILHA POS99', categoria_pai_id: raizId },
    });
    assert.equal(filha.statusCode, 201);
    const filhaId = filha.json().id;

    const lista = await app.inject({ method: 'GET', url: '/categorias', headers: auth(token) });
    assert.equal(lista.statusCode, 200);
    const ids = lista.json().map((c) => c.id);
    assert.ok(ids.includes(raizId));
    assert.ok(ids.includes(filhaId));
  });
});

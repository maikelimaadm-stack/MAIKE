/**
 * EMPRESA-NUM-01 — numeração sequencial tenant-scoped + POST sem GET prévio.
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

const criarEmpresa = async (token, nome, apelido = 'AP') => {
  const r = await app.inject({
    method: 'POST',
    url: '/empresas',
    headers: auth(token),
    payload: { apelido, nome, tipo_pessoa: 'Jurídica' },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

describe('EMPRESA-NUM-01 — sequência', () => {
  test('1,2,3 — delete 2 — próximo 4; PATCH não altera número', async () => {
    const { token } = await tenantAutenticado();
    const a = await criarEmpresa(token, 'EMPRESA A');
    const b = await criarEmpresa(token, 'EMPRESA B');
    const c = await criarEmpresa(token, 'EMPRESA C');
    assert.equal(a.numero_empresa, 1);
    assert.equal(b.numero_empresa, 2);
    assert.equal(c.numero_empresa, 3);

    const del = await app.inject({
      method: 'DELETE',
      url: `/empresas/${b.id}`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 204);

    const d = await criarEmpresa(token, 'EMPRESA D');
    assert.equal(d.numero_empresa, 4);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/empresas/${a.id}`,
      headers: auth(token),
      payload: { nome: 'EMPRESA A OK' },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().numero_empresa, 1);
  });

  test('tenants isolados — ambos começam em 1', async () => {
    const t1 = await tenantAutenticado();
    const t2 = await tenantAutenticado();
    const e1 = await criarEmpresa(t1.token, 'T1 ONLY');
    const e2 = await criarEmpresa(t2.token, 'T2 ONLY');
    assert.equal(e1.numero_empresa, 1);
    assert.equal(e2.numero_empresa, 1);
  });

  test('rejeita numero_empresa no POST e PATCH', async () => {
    const { token } = await tenantAutenticado();
    const post = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(token),
      payload: { apelido: 'X', nome: 'X', tipo_pessoa: 'Jurídica', numero_empresa: 99 },
    });
    assert.equal(post.statusCode, 400);

    const base = await criarEmpresa(token, 'BASE');
    const patch = await app.inject({
      method: 'PATCH',
      url: `/empresas/${base.id}`,
      headers: auth(token),
      payload: { numero_empresa: 2 },
    });
    assert.equal(patch.statusCode, 400);
  });

  test('nome duplicado retorna 409 EMPRESA_NAME_CONFLICT', async () => {
    const { token } = await tenantAutenticado();
    await criarEmpresa(token, 'UNICA');
    const dup = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(token),
      payload: { apelido: 'DUP', nome: '  unica  ', tipo_pessoa: 'Jurídica' },
    });
    assert.equal(dup.statusCode, 409);
    assert.equal(dup.json().code, 'EMPRESA_NAME_CONFLICT');
  });

  test('GET /api/native/empresas após POST', async () => {
    const { token } = await tenantAutenticado();
    const criada = await criarEmpresa(token, 'NATIVA');
    const get = await app.inject({
      method: 'GET',
      url: '/api/native/empresas',
      headers: auth(token),
    });
    assert.equal(get.statusCode, 200);
    assert.ok(get.json().some((e) => e.id === criada.id && e.numero_empresa === criada.numero_empresa));
  });
});

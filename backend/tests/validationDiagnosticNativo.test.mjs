/**
 * Diagnóstico sanitizado de validação — sem vazamento de AJV cru.
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

describe('validation diagnostic', () => {
  test('POST lancamento-tarefa sem titulo expõe field/reason sem body', async () => {
    const { credenciais } = await criarTenant();
    const { corpo: login } = await autenticarNoApp(app, credenciais);

    const r = await app.inject({
      method: 'POST',
      url: '/lancamentos-tarefa',
      headers: auth(login.token),
      payload: {
        empresa_id: 'emp-1',
        tipo: 'Manejo',
        tipo_tarefa_id: 'tipo-x',
      },
    });
    assert.equal(r.statusCode, 400);
    const corpo = r.json();
    assert.equal(corpo.code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(corpo.field, 'titulo');
    assert.equal(corpo.reason, 'required');
    assert.ok(typeof corpo.request_id === 'string');
    assert.equal(JSON.stringify(corpo).includes('must have required property'), false);
  });
});

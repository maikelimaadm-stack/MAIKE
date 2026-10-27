/**
 * UnidadeMedida nativa — PostgreSQL real (P4.5, D-PROD-44).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { escopoDaNumeracao, ENTIDADE_SEQUENCIA } from '../src/modules/unidadesMedida/unidadeMedidaService.js';
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

const tenantAutenticado = async (opcoes) => {
  const { credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token };
};

const auth = (token) => ({ authorization: `Bearer ${token}` });

describe('P4.5-UnidadeMedida — sessão e numeração', () => {
  test('BE-P45-01 GET /unidades-medida sem token reprova', async () => {
    const r = await app.inject({ method: 'GET', url: '/unidades-medida' });
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
  });

  test('BE-P45-02 primeira unidade recebe numero_unidade "1"', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'kg', descricao: 'Quilograma' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().numero_unidade, '1');
    assert.equal(r.json().sigla, 'KG');
    assert.equal(escopoDaNumeracao(), ESCOPO_TENANT);
    assert.equal(ENTIDADE_SEQUENCIA, 'UnidadeMedida');
  });

  test('BE-P45-03 sigla duplicada reprova', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'UN', descricao: 'Unidade' },
    });
    const r = await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'un', descricao: 'Outra' },
    });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'UNIDADE_MEDIDA_SIGLA_CONFLICT');
  });
});

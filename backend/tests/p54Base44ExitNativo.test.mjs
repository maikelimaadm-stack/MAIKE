/**
 * P5.4 — Empresa e MovimentacaoEstoque nativos (amostra).
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

describe('P5.4 — Empresa', () => {
  test('BE-P54-01 cria empresa tenant-scoped', async () => {
    const { credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);
    const r = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(corpo.token),
      payload: { apelido: 'Fazenda', nome: 'FAZENDA TESTE', tipo_pessoa: 'Jurídica' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().nome, 'FAZENDA TESTE');
  });
});

describe('P5.4 — MovimentacaoEstoque', () => {
  test('BE-P54-02 numera movimentação na criação', async () => {
    const { credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);
    const r = await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque',
      headers: auth(corpo.token),
      payload: {
        empresa_id: 'emp-1',
        tipo_movimentacao: 'Entrada',
        data_movimentacao: new Date().toISOString(),
        produto_id: 'prod-1',
        quantidade: 10,
        unidade_medida: 'KG',
      },
    });
    assert.equal(r.statusCode, 201);
    assert.ok(r.json().numero_movimentacao);
  });
});

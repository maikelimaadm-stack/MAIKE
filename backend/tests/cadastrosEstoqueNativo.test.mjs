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

  test('BE-P52-PAGE-03 GET /locais-estoque/page devolve envelope tenant-global', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/locais-estoque',
      headers: auth(token),
      payload: { nome: 'Galpão A' },
    });
    const page = await app.inject({
      method: 'GET',
      url: '/locais-estoque/page?limit=10',
      headers: auth(token),
    });
    assert.equal(page.statusCode, 200);
    const corpo = page.json();
    assert.equal(corpo.total, 1);
    assert.equal(corpo.items.length, 1);
    assert.match(corpo.items[0].nome, /galpão/i);
    assert.equal(typeof corpo.has_more, 'boolean');
  });

  test('BE-P52-PAGE-04 GET /locais-estoque legado continua array', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'GET',
      url: '/locais-estoque',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.json()));
  });

  test('BE-P52-06 DELETE bloqueado com movimentação (LOCAL_ESTOQUE_DELETE_BLOCKED)', async () => {
    const { token } = await tenantAutenticado();
    const local = await app.inject({
      method: 'POST',
      url: '/locais-estoque',
      headers: auth(token),
      payload: { nome: 'Local bloqueado' },
    });
    const localId = local.json().id;
    const produto = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome_produto: 'Item teste' },
    });
    await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque',
      headers: auth(token),
      payload: {
        empresa_id: EMPRESA,
        tipo_movimentacao: 'Entrada',
        data_movimentacao: new Date().toISOString(),
        produto_id: produto.json().id,
        quantidade: 3,
        unidade_medida: 'KG',
        local_estoque_destino: localId,
      },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/locais-estoque/${localId}`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 409);
    assert.equal(del.json().code, 'LOCAL_ESTOQUE_DELETE_BLOCKED');
    assert.equal(del.json().details?.motivo, 'movimentacoes_vinculadas');
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

  test('BE-P52-PAGE-01 GET /produtos/page exige empresa_id e devolve envelope', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome_produto: 'Soja' },
    });
    const page = await app.inject({
      method: 'GET',
      url: `/produtos/page?empresa_id=${EMPRESA}&limit=10`,
      headers: auth(token),
    });
    assert.equal(page.statusCode, 200);
    const corpo = page.json();
    assert.equal(corpo.total, 1);
    assert.equal(corpo.items.length, 1);
    assert.equal(corpo.items[0].nome_produto, 'SOJA');
    assert.equal(typeof corpo.has_more, 'boolean');
  });

  test('BE-P52-PAGE-02 GET /produtos legado continua array', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'GET',
      url: `/produtos?empresa_id=${EMPRESA}`,
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.json()));
  });

  test('BE-P52-05 DELETE bloqueado com movimentação (PRODUTO_DELETE_BLOCKED)', async () => {
    const { token } = await tenantAutenticado();
    const criado = await app.inject({
      method: 'POST',
      url: '/produtos',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome_produto: 'Ração bloqueada' },
    });
    const produtoId = criado.json().id;
    await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque',
      headers: auth(token),
      payload: {
        empresa_id: EMPRESA,
        tipo_movimentacao: 'Entrada',
        data_movimentacao: new Date().toISOString(),
        produto_id: produtoId,
        quantidade: 5,
        unidade_medida: 'KG',
      },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/produtos/${produtoId}`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 409);
    assert.equal(del.json().code, 'PRODUTO_DELETE_BLOCKED');
    assert.equal(del.json().details?.quantidade, 1);
  });
});

/**
 * Lote nativo — PostgreSQL real (P5.1, D-PROD-47).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

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

describe('P5.1 — Lote', () => {
  test('GET /lotes sem token reprova', async () => {
    const r = await app.inject({ method: 'GET', url: '/lotes' });
    assert.equal(r.statusCode, 401);
  });

  test('criar lote atribui numero_lote e campos de entrada imutáveis', async () => {
    const { token } = await tenantAutenticado();

    const criar = await app.inject({
      method: 'POST',
      url: '/lotes',
      headers: auth(token),
      payload: {
        empresa_id: 'emp-1',
        nome: 'Lote Teste',
        quantidade_cabecas: 42,
        motivo_entrada: 'Compra',
        categoria: 'Novilho',
      },
    });
    assert.equal(criar.statusCode, 201);
    const corpo = criar.json();
    assert.equal(corpo.nome, 'Lote Teste');
    assert.equal(corpo.quantidade_cabecas, 42);
    assert.equal(corpo.quantidade_entrada, 42);
    assert.equal(corpo.categoria_entrada, 'Novilho');
    assert.match(corpo.numero_lote, /^\d+$/);

    const listar = await app.inject({
      method: 'GET',
      url: '/lotes',
      headers: auth(token),
    });
    assert.equal(listar.statusCode, 200);
    assert.equal(listar.json().length, 1);
  });

  test('criar lote Inventário com campos mínimos (150 cabeças)', async () => {
    const { token } = await tenantAutenticado();
    const criar = await app.inject({
      method: 'POST',
      url: '/lotes',
      headers: auth(token),
      payload: {
        empresa_id: 'emp-1',
        nome: 'LOTE INVENTARIO',
        quantidade_cabecas: 150,
        motivo_entrada: 'Inventário',
      },
    });
    assert.equal(criar.statusCode, 201);
    const corpo = criar.json();
    assert.equal(corpo.quantidade_cabecas, 150);
    assert.equal(corpo.quantidade_entrada, 150);
    assert.equal(corpo.motivo_entrada, 'Inventário');
  });

  test('corpo com setor_nome enviado reprova', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/lotes',
      headers: auth(token),
      payload: {
        empresa_id: 'emp-1',
        nome: 'X',
        quantidade_cabecas: 1,
        motivo_entrada: 'Ajuste',
        setor_nome: 'Não pode',
      },
    });
    assert.equal(r.statusCode, 400);
  });

  test('DELETE bloqueado com movimentação do mapa (LOTE_DELETE_BLOCKED)', async () => {
    const tenant = await criarTenant();
    const { corpo: login } = await autenticarNoApp(app, tenant.credenciais);
    const token = login.token;

    const criar = await app.inject({
      method: 'POST',
      url: '/lotes',
      headers: auth(token),
      payload: {
        empresa_id: 'emp-1',
        nome: 'Lote Vinculado',
        quantidade_cabecas: 10,
        motivo_entrada: 'Inventário',
      },
    });
    assert.equal(criar.statusCode, 201);
    const loteId = criar.json().id;

    const prisma = getPrismaClient();
    await prisma.movimentacaoMapa.create({
      data: {
        id: 'mov-map-lote-del',
        cliente_id: tenant.cliente.id,
        empresa_id: 'emp-1',
        dados: { lote_id: loteId, origem: 'teste-delete-guard' },
      },
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/lotes/${loteId}`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 409);
    assert.equal(del.json().code, 'LOTE_DELETE_BLOCKED');
    assert.equal(del.json().details?.vinculo, 'movimentacoes_mapa');

    await prisma.movimentacaoMapa.deleteMany({ where: { id: 'mov-map-lote-del' } });

    const delOk = await app.inject({
      method: 'DELETE',
      url: `/lotes/${loteId}`,
      headers: auth(token),
    });
    assert.equal(delOk.statusCode, 204);
  });
});

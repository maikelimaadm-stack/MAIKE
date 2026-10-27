/**
 * GET listagens com ?limit= — contrato frontend↔backend (hotfix pós-PR #103).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;

const ENDPOINTS = [
  '/movimentacoes-mapa',
  '/movimentacoes-pecuaria',
  '/suplementacao-lotes',
  '/suplementacao-eventos',
  '/manejos-tecnico-rebanho',
  '/bebedouros-historico',
  '/bebedouros-sanidade',
  '/bebedouros-alertas',
  '/aplicacoes-medicamento',
  '/eventos-sanitarios',
];

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
  return { token: corpo.token, credenciais };
};

describe('listagem GET — parâmetro limit', () => {
  test('?limit=200 era rejeitado (simulação pré-correção) — hoje retorna 200', async () => {
    const { token } = await tenantAutenticado();
    for (const url of ENDPOINTS) {
      const r = await app.inject({
        method: 'GET',
        url: `${url}?limit=200`,
        headers: auth(token),
      });
      assert.equal(r.statusCode, 200, `${url}?limit=200 deve ser aceito`);
      assert.ok(Array.isArray(r.json()));
    }
  });

  test('prefixo /api/native reescrito — movimentacoes-mapa?limit=200', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'GET',
      url: '/api/native/movimentacoes-mapa?limit=200',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.json()));
  });

  test('simulação ingresso Vercel — path legado não chega ao AJV', async () => {
    const { normalizarIngressoServerlessVercel } = await import('../../config/vercelFastifyIngress.js');
    const { token } = await tenantAutenticado();
    const url = normalizarIngressoServerlessVercel('/api/fastify?path=aplicacoes-medicamento&limit=200');
    const r = await app.inject({
      method: 'GET',
      url,
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200, url);
    assert.ok(Array.isArray(r.json()));
  });

  test('simulação ingresso Vercel — __native_route (rewrite PR #105)', async () => {
    const { normalizarIngressoServerlessVercel } = await import('../../config/vercelFastifyIngress.js');
    const { token } = await tenantAutenticado();
    const url = normalizarIngressoServerlessVercel(
      '/api/fastify?__native_route=eventos-sanitarios&limit=200',
    );
    const r = await app.inject({
      method: 'GET',
      url,
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200, url);
    assert.ok(Array.isArray(r.json()));
  });

  test('query desconhecida continua 400 com field/reason sanitizado', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'GET',
      url: '/movimentacoes-mapa?foo=1',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 400);
    const corpo = r.json();
    assert.equal(corpo.code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(corpo.field, 'foo');
    assert.equal(corpo.reason, 'unknown_field');
    assert.ok(typeof corpo.request_id === 'string');
    assert.equal(corpo.message?.includes('validation'), false);
  });

  test('limit acima do máximo reprova com range', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'GET',
      url: '/movimentacoes-mapa?limit=99999',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 400);
    const corpo = r.json();
    assert.equal(corpo.field, 'limit');
    assert.equal(corpo.reason, 'range');
  });

  test('take no SQL respeita limit com mais registros no banco', async () => {
    const tenantA = await criarTenant();
    const { corpo: loginA } = await autenticarNoApp(app, tenantA.credenciais);
    const prisma = getPrismaClient();

    const base = {
      cliente_id: tenantA.cliente.id,
      empresa_id: 'emp-limite',
      dados: { origem: 'teste-limit' },
    };
    for (let i = 0; i < 5; i += 1) {
      await prisma.movimentacaoMapa.create({
        data: { ...base, id: `mov-lim-${i}` },
      });
    }

    const r = await app.inject({
      method: 'GET',
      url: '/movimentacoes-mapa?empresa_id=emp-limite&limit=2',
      headers: auth(loginA.token),
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().length, 2);

    const tenantB = await criarTenant();
    const { corpo: loginB } = await autenticarNoApp(app, tenantB.credenciais);
    const rB = await app.inject({
      method: 'GET',
      url: '/movimentacoes-mapa?empresa_id=emp-limite&limit=10',
      headers: auth(loginB.token),
    });
    assert.equal(rB.statusCode, 200);
    assert.equal(rB.json().length, 0);
  });
});

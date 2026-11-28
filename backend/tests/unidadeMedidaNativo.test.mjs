/**
 * UnidadeMedida nativa — PostgreSQL real (P4.5, D-PROD-44).
 *
 * D-PROD-197 barrava a exclusão da unidade de produção de um Tipo de Atividade;
 * D-PROD-383: o Tipo de Atividade saiu, a exclusão é física e auditada, e o
 * módulo de unidade continua sem consultar `TipoAtividade` (lição do hotfix #259).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { escopoDaNumeracao, ENTIDADE_SEQUENCIA } from '../src/modules/unidadesMedida/unidadeMedidaService.js';
import { ESCOPO_TENANT } from '../src/modules/sequencias/entidadeCodigoService.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

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
  const { cliente, credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token, clienteId: cliente.id };
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

  test('BE-P45-03 GET /unidades-medida legado devolve array', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'KG', descricao: 'Quilograma' },
    });
    const r = await app.inject({
      method: 'GET',
      url: '/unidades-medida',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    assert.ok(Array.isArray(r.json()));
    assert.equal(r.json().length, 1);
  });
});

describe('P4.5-UnidadeMedida — listagem keyset (MotorBase1)', () => {
  test('BE-P45-04 GET /unidades-medida/page devolve envelope paginado', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'UN', descricao: 'Unidade' },
    });
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'KG', descricao: 'Quilograma' },
    });

    const r = await app.inject({
      method: 'GET',
      url: '/unidades-medida/page?limit=1',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    const corpo = r.json();
    assert.equal(corpo.items.length, 1);
    assert.equal(corpo.limit, 1);
    assert.equal(corpo.total, 2);
    assert.equal(corpo.has_more, true);
    assert.equal(typeof corpo.next_cursor, 'string');

    const r2 = await app.inject({
      method: 'GET',
      url: `/unidades-medida/page?limit=1&cursor=${encodeURIComponent(corpo.next_cursor)}`,
      headers: auth(token),
    });
    assert.equal(r2.statusCode, 200);
    const corpo2 = r2.json();
    assert.equal(corpo2.items.length, 1);
    assert.notEqual(corpo2.items[0].id, corpo.items[0].id);
    assert.equal(corpo2.has_more, false);
  });

  test('BE-P45-05 busca q filtra sigla/descricao', async () => {
    const { token } = await tenantAutenticado();
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'KG', descricao: 'QUILOGRAMA' },
    });
    await app.inject({
      method: 'POST',
      url: '/unidades-medida',
      headers: auth(token),
      payload: { sigla: 'UN', descricao: 'UNIDADE' },
    });

    const r = await app.inject({
      method: 'GET',
      url: '/unidades-medida/page?q=qui',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().total, 1);
    assert.equal(r.json().items[0].sigla, 'KG');
  });

  test('BE-P45-06 cursor inválido reprova 400', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'GET',
      url: '/unidades-medida/page?cursor=nao-e-cursor',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
  });
});

describe('P4.5-UnidadeMedida — conflitos', () => {
  test('BE-P45-07 sigla duplicada reprova', async () => {
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

describe('D-PROD-383 — exclusão de unidade (o Tipo de Atividade saiu)', () => {
  const req = (metodo, url, token, payload) =>
    app.inject({ method: metodo, url, headers: auth(token), ...(payload !== undefined ? { payload } : {}) });
  const criarUnidade = async (token, sigla, descricao) => {
    const r = await req('POST', '/unidades-medida', token, { sigla, descricao });
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  const auditoriaDaUnidade = (clienteId, id) =>
    prisma().auditLog.findMany({ where: { cliente_id: clienteId, entidade: 'UnidadeMedida', entidade_id: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  test('BE-P45-08 unidade sem uso é excluída (204, exclusão física e auditada); a mesma unidade some da lista', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const livre = await criarUnidade(token, 'KG', 'Quilograma');
    const usada = await criarUnidade(token, 'HA', 'Hectare');

    const r = await req('DELETE', `/unidades-medida/${livre.id}`, token);
    assert.equal(r.statusCode, 204, r.body);
    assert.equal(await prisma().unidadeMedida.count({ where: { id: livre.id } }), 0, 'exclusão física');
    assert.deepEqual((await auditoriaDaUnidade(clienteId, livre.id)).map((a) => a.acao).sort(), ['create', 'delete']);
    assert.deepEqual((await req('GET', '/unidades-medida', token)).json().map((u) => u.id), [usada.id]);
  });

  test('BE-P45-10 (hotfix #259) o módulo de unidade nunca consulta TipoAtividade: a recusa vem só da FK', () => {
    const raiz = new URL('../src/modules/unidadesMedida/', import.meta.url);
    const arquivos = /** @type {string[]} */ (readdirSync(raiz)).filter((f) => /\.(m?js)$/.test(f));
    assert.ok(arquivos.length >= 3, 'varreu o módulo');
    const consulta = /\.tipoAtividade\s*\.|"TipoAtividade"/;
    const fora = arquivos.filter((f) => consulta.test(readFileSync(new URL(f, raiz), 'utf8')));
    assert.deepEqual(fora, [], 'sem SELECT em TipoAtividade (nem pelo Prisma, nem por SQL)');
  });
});

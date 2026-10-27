/**
 * GrupoAtividade e TipoTarefa nativos — PostgreSQL real (P5.0, D-PROD-45).
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

const tenantAutenticado = async (opcoes) => {
  const { credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token };
};

const auth = (token) => ({ authorization: `Bearer ${token}` });

describe('P5.0 — GrupoAtividade', () => {
  test('GET /grupos-atividade sem token reprova', async () => {
    const r = await app.inject({ method: 'GET', url: '/grupos-atividade' });
    assert.equal(r.statusCode, 401);
  });

  test('criar grupo normaliza nome e lista', async () => {
    const { token } = await tenantAutenticado();
    const criar = await app.inject({
      method: 'POST',
      url: '/grupos-atividade',
      headers: auth(token),
      payload: { nome_grupo: 'manejo' },
    });
    assert.equal(criar.statusCode, 201);
    assert.equal(criar.json().nome_grupo, 'MANEJO');

    const listar = await app.inject({
      method: 'GET',
      url: '/grupos-atividade',
      headers: auth(token),
    });
    assert.equal(listar.statusCode, 200);
    assert.equal(listar.json().length, 1);
  });
});

describe('P5.0 — TipoTarefa', () => {
  test('tipo herda nome do grupo e FK composta', async () => {
    const { token } = await tenantAutenticado();

    const grupo = await app.inject({
      method: 'POST',
      url: '/grupos-atividade',
      headers: auth(token),
      payload: { nome_grupo: 'OPERACIONAL' },
    });
    const grupoId = grupo.json().id;

    const tipo = await app.inject({
      method: 'POST',
      url: '/tipos-tarefa',
      headers: auth(token),
      payload: { nome_tipo: 'reforma cerca', grupo_atividade_id: grupoId },
    });
    assert.equal(tipo.statusCode, 201);
    assert.equal(tipo.json().nome_tipo, 'REFORMA CERCA');
    assert.equal(tipo.json().grupo_atividade_nome, 'OPERACIONAL');
  });

  test('renomear grupo propaga cache nos tipos', async () => {
    const { token } = await tenantAutenticado();

    const grupo = await app.inject({
      method: 'POST',
      url: '/grupos-atividade',
      headers: auth(token),
      payload: { nome_grupo: 'A' },
    });
    const grupoId = grupo.json().id;

    await app.inject({
      method: 'POST',
      url: '/tipos-tarefa',
      headers: auth(token),
      payload: { nome_tipo: 'T1', grupo_atividade_id: grupoId },
    });

    await app.inject({
      method: 'PATCH',
      url: `/grupos-atividade/${grupoId}`,
      headers: auth(token),
      payload: { nome_grupo: 'B' },
    });

    const tipos = await app.inject({
      method: 'GET',
      url: '/tipos-tarefa',
      headers: auth(token),
    });
    assert.equal(tipos.json()[0].grupo_atividade_nome, 'B');
  });
});

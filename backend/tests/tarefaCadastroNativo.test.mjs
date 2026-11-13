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

  test('D-PROD-179: flags de exigência saíram do cadastro; cliente antigo é aceito e as chaves são ignoradas', async () => {
    const { token } = await tenantAutenticado();
    const FLAGS = ['exige_area', 'pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento'];
    const CAMPOS_PUBLICOS = [
      'ativo', 'created_date', 'descricao', 'grupo_atividade_id', 'grupo_atividade_nome',
      'id', 'nome_tipo', 'updated_date',
    ];

    const grupo = await app.inject({
      method: 'POST',
      url: '/grupos-atividade',
      headers: auth(token),
      payload: { nome_grupo: 'LEGADO' },
    });
    const grupoId = grupo.json().id;

    const criado = await app.inject({
      method: 'POST',
      url: '/tipos-tarefa',
      headers: auth(token),
      payload: {
        nome_tipo: 'roçada',
        grupo_atividade_id: grupoId,
        exige_area: true,
        pode_ter_produto: true,
        pode_ter_maquina: true,
        pode_ter_implemento: true,
      },
    });
    assert.equal(criado.statusCode, 201, criado.body);
    assert.deepEqual(Object.keys(criado.json()).sort(), CAMPOS_PUBLICOS);
    const id = criado.json().id;

    const soLegado = await app.inject({
      method: 'PATCH',
      url: `/tipos-tarefa/${id}`,
      headers: auth(token),
      payload: { exige_area: false, pode_ter_maquina: null },
    });
    assert.equal(soLegado.statusCode, 200, soLegado.body);
    assert.equal(soLegado.json().nome_tipo, 'ROÇADA');

    const misto = await app.inject({
      method: 'PATCH',
      url: `/tipos-tarefa/${id}`,
      headers: auth(token),
      payload: { descricao: 'com trator', pode_ter_implemento: true },
    });
    assert.equal(misto.statusCode, 200, misto.body);
    assert.equal(misto.json().descricao, 'com trator');

    const lista = await app.inject({ method: 'GET', url: '/tipos-tarefa', headers: auth(token) });
    const doTipo = lista.json().find((t) => t.id === id);
    assert.deepEqual(Object.keys(doTipo).sort(), CAMPOS_PUBLICOS);
    for (const f of FLAGS) assert.equal(f in doTipo, false, f);

    const outroCampo = await app.inject({
      method: 'PATCH',
      url: `/tipos-tarefa/${id}`,
      headers: auth(token),
      payload: { exige_produto: true },
    });
    assert.equal(outroCampo.statusCode, 400, 'só as 4 chaves legadas são toleradas');
  });
});

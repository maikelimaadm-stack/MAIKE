/**
 * LancamentoTarefa nativo — PostgreSQL real (P5.3, D-PROD-49).
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

const criarGrupoETipo = async (token) => {
  const grupo = await app.inject({
    method: 'POST',
    url: '/grupos-atividade',
    headers: auth(token),
    payload: { nome_grupo: 'GRUPO TESTE', ativo: true },
  });
  assert.equal(grupo.statusCode, 201);
  const grupoId = grupo.json().id;

  const tipo = await app.inject({
    method: 'POST',
    url: '/tipos-tarefa',
    headers: auth(token),
    payload: { nome_tipo: 'TIPO TESTE', grupo_atividade_id: grupoId, ativo: true },
  });
  assert.equal(tipo.statusCode, 201);
  return { grupoId, tipoId: tipo.json().id };
};

describe('P5.3 — LancamentoTarefa', () => {
  test('GET /lancamentos-tarefa sem token reprova', async () => {
    const r = await app.inject({ method: 'GET', url: '/lancamentos-tarefa' });
    assert.equal(r.statusCode, 401);
  });

  test('criar lançamento deriva caches de tipo_tarefa', async () => {
    const { token } = await tenantAutenticado();
    const { tipoId } = await criarGrupoETipo(token);

    const criar = await app.inject({
      method: 'POST',
      url: '/lancamentos-tarefa',
      headers: auth(token),
      payload: {
        empresa_id: 'emp-1',
        titulo: 'Tarefa mapa',
        tipo: 'Manejo',
        tipo_tarefa_id: tipoId,
        data_pedido: '2026-10-27',
      },
    });
    assert.equal(criar.statusCode, 201);
    const corpo = criar.json();
    assert.equal(corpo.titulo, 'Tarefa mapa');
    assert.equal(corpo.tipo_tarefa_id, tipoId);
    assert.equal(corpo.tipo_tarefa_nome, 'TIPO TESTE');
    assert.equal(corpo.grupo_atividade_nome, 'GRUPO TESTE');

    const historico = await app.inject({
      method: 'POST',
      url: '/historicos-lancamento-tarefa',
      headers: auth(token),
      payload: {
        empresa_id: 'emp-1',
        tarefa_id: corpo.id,
        titulo_tarefa: corpo.titulo,
        evento: 'Criação',
        data_evento: new Date().toISOString(),
        status: corpo.status,
      },
    });
    assert.equal(historico.statusCode, 201);

    const listarHist = await app.inject({
      method: 'GET',
      url: '/historicos-lancamento-tarefa?limite=10',
      headers: auth(token),
    });
    assert.equal(listarHist.statusCode, 200);
    assert.equal(listarHist.json().length, 1);
  });

  test('corpo com tipo_tarefa_nome enviado reprova', async () => {
    const { token } = await tenantAutenticado();
    const { tipoId } = await criarGrupoETipo(token);
    const r = await app.inject({
      method: 'POST',
      url: '/lancamentos-tarefa',
      headers: auth(token),
      payload: {
        empresa_id: 'emp-1',
        titulo: 'X',
        tipo: 'Manejo',
        tipo_tarefa_id: tipoId,
        tipo_tarefa_nome: 'Não pode',
      },
    });
    assert.equal(r.statusCode, 400);
  });
});

/**
 * LancamentoTarefa nativo — PostgreSQL real (P5.3, D-PROD-49).
 * D-PROD-320: LS-01..04 — lançamento simples (só o título; sem tipo vira "SEM TIPO").
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

describe('D-PROD-320 — lançamento simples (só o título)', () => {
  const prisma = () => getPrismaClient();
  const criarSo = (token, titulo, extra = {}) =>
    app.inject({ method: 'POST', url: '/lancamentos-tarefa', headers: auth(token), payload: { empresa_id: 'emp-1', titulo, ...extra } });

  test('LS-01 só o título: tipo "SEM TIPO" no grupo GERAL, tipo base Outro, pedido hoje, quem pediu = quem lançou', async () => {
    const { token } = await tenantAutenticado();
    const r = await criarSo(token, 'ARRUMAR CERCA');
    assert.equal(r.statusCode, 201, r.body);
    const t = r.json();
    assert.equal(t.tipo_tarefa_nome, 'SEM TIPO');
    assert.equal(t.grupo_atividade_nome, 'GERAL');
    assert.equal(t.tipo, 'Outro');
    assert.equal(t.status, 'Pendente');
    assert.equal(String(t.data_pedido).slice(0, 10), '2027-06-15');
    assert.ok(t.solicitante, 'quem pediu');
  });

  test('LS-02 a segunda tarefa (e duas ao mesmo tempo) usam o MESMO tipo e o mesmo grupo', async () => {
    const { token } = await tenantAutenticado();
    const [a, b, c] = await Promise.all([criarSo(token, 'A'), criarSo(token, 'B'), criarSo(token, 'C')]);
    for (const r of [a, b, c]) assert.equal(r.statusCode, 201, r.body);
    assert.equal(new Set([a, b, c].map((r) => r.json().tipo_tarefa_id)).size, 1);
    const clienteId = (await prisma().lancamentoTarefa.findUnique({ where: { id: a.json().id } })).cliente_id;
    assert.equal(await prisma().tipoTarefa.count({ where: { cliente_id: clienteId, nome_tipo: 'SEM TIPO' } }), 1);
    assert.equal(await prisma().grupoAtividade.count({ where: { cliente_id: clienteId, nome_grupo: 'GERAL' } }), 1);
  });

  test('LS-03 com tipo informado, como antes; o administrador troca o SEM TIPO depois pela edição', async () => {
    const { token } = await tenantAutenticado();
    const { tipoId } = await criarGrupoETipo(token);
    const comTipo = await criarSo(token, 'COM TIPO', { tipo_tarefa_id: tipoId, data_pedido: '2027-06-01', solicitante: 'FULANO' });
    assert.equal(comTipo.statusCode, 201, comTipo.body);
    assert.equal(comTipo.json().tipo_tarefa_nome, 'TIPO TESTE');
    assert.equal(String(comTipo.json().data_pedido).slice(0, 10), '2027-06-01');
    assert.equal(comTipo.json().solicitante, 'FULANO');
    const semTipo = await criarSo(token, 'SEM');
    const editada = await app.inject({ method: 'PATCH', url: `/lancamentos-tarefa/${semTipo.json().id}`, headers: auth(token), payload: { tipo_tarefa_id: tipoId } });
    assert.equal(editada.statusCode, 200, editada.body);
    assert.equal(editada.json().tipo_tarefa_nome, 'TIPO TESTE');
    assert.equal(editada.json().grupo_atividade_nome, 'GRUPO TESTE');
  });

  test('LS-04 sem título: 400', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({ method: 'POST', url: '/lancamentos-tarefa', headers: auth(token), payload: { empresa_id: 'emp-1' } });
    assert.equal(r.statusCode, 400, r.body);
  });
});

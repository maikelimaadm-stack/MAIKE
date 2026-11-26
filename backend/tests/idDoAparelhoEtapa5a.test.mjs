/**
 * D-PROD-319 — Etapa 5a da sincronização: id gerado no aparelho na medição de forragem, na tarefa do mapa e no
 * evento de suplementação (o automático da chegada do gado). Repetir a criação não duplica.
 *
 * 5A-01 medição com id do aparelho: criada com esse id; repetir devolve a mesma (uma linha, uma auditoria)
 * 5A-02 duas criações simultâneas da mesma medição: uma só
 * 5A-03 o mesmo id em OUTRO tenant: 409 ID_DO_APARELHO_EM_USO, nada vaza
 * 5A-04 medição excluída (apagada de vez): repetir a criação não recria (409 ID_DO_APARELHO_EXCLUIDO)
 * 5A-05 tarefa com id do aparelho: repetir devolve a mesma, com UM registro no histórico
 * 5A-06 tarefa excluída: repetir não recria
 * 5A-07 evento de suplementação com id do aparelho: repetir devolve o mesmo (o id não vai para os dados)
 * 5A-08 sem id (ou id que não é UUID no evento): o caminho de sempre, o servidor gera o id; na medição e na tarefa,
 *       id que não é UUID é recusado pelo schema (400)
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(payload !== undefined ? { payload } : {}) });

let seq = 0;
/** Administrador com uma fazenda (fuso de São Paulo), um setor e um pasto. */
const conta = async () => {
  seq += 1;
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const empresa = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'FAZ', nome: `Fazenda ${c}`, fuso_horario: 'America/Sao_Paulo' } });
  const setor = await prisma().setor.create({ data: { cliente_id: c, empresa_id: empresa.id, numero_setor: '1', nome: 'SETOR 1' } });
  const pasto = await prisma().areaPastagem.create({
    data: { cliente_id: c, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: `A${seq}-${randomUUID().slice(0, 6)}`, nome: `PASTO ${seq}`, tamanho_hectares: 8 },
  });
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  assert.ok(corpo.token, 'login');
  return { clienteId: c, token: corpo.token, empresa, pasto };
};

const medicao = (c, id) => ({ ...(id ? { id } : {}), empresa_id: c.empresa.id, area_id: c.pasto.id, data_medicao: '2027-06-15', metodo: 'OLHO', situacao: 'PRONTO' });

const tipoDeTarefa = async (c) => {
  const grupo = await req('POST', '/grupos-atividade', c.token, { nome_grupo: 'GRUPO TESTE', ativo: true });
  assert.equal(grupo.statusCode, 201, grupo.body);
  const tipo = await req('POST', '/tipos-tarefa', c.token, { nome_tipo: 'TIPO TESTE', grupo_atividade_id: grupo.json().id, ativo: true });
  assert.equal(tipo.statusCode, 201, tipo.body);
  return tipo.json().id;
};
const tarefa = (c, tipoId, id) => ({
  ...(id ? { id } : {}),
  empresa_id: c.empresa.id, titulo: 'Arrumar cerca', tipo: 'Manejo', tipo_tarefa_id: tipoId, data_pedido: '2027-06-15',
  historico_evento: 'Criação', historico_descricao: 'Tarefa criada pelo mapa.',
});
const evento = (c, id) => ({ ...(id ? { id } : {}), empresa_id: c.empresa.id, area_id: c.pasto.id, data_lancamento: '2027-06-15', quantidade_total_kg: 0, sobra_kg: 3, dias_periodo: null });

const auditorias = (clienteId, entidade, acao = 'create') => prisma().auditLog.count({ where: { cliente_id: clienteId, entidade, acao } });

describe('D-PROD-319 — medição de forragem com id do aparelho', () => {
  test('5A-01 criada com o id do aparelho; repetir devolve a mesma', async () => {
    const c = await conta();
    const id = randomUUID();
    const a = await req('POST', '/medicoes-forragem', c.token, medicao(c, id));
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(a.json().id, id);
    const b = await req('POST', '/medicoes-forragem', c.token, medicao(c, id.toUpperCase()));
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(b.json().id, id);
    assert.equal(await prisma().medicaoForragem.count({ where: { cliente_id: c.clienteId } }), 1);
    assert.equal(await auditorias(c.clienteId, 'MedicaoForragem'), 1);
  });

  test('5A-02 duas criações simultâneas com o mesmo id: uma só', async () => {
    const c = await conta();
    const id = randomUUID();
    const [a, b] = await Promise.all([req('POST', '/medicoes-forragem', c.token, medicao(c, id)), req('POST', '/medicoes-forragem', c.token, medicao(c, id))]);
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(await prisma().medicaoForragem.count({ where: { cliente_id: c.clienteId } }), 1);
  });

  test('5A-03 o mesmo id em outro tenant: 409 ID_DO_APARELHO_EM_USO, nada vaza', async () => {
    const a = await conta();
    const b = await conta();
    const id = randomUUID();
    assert.equal((await req('POST', '/medicoes-forragem', a.token, medicao(a, id))).statusCode, 201);
    const r = await req('POST', '/medicoes-forragem', b.token, medicao(b, id));
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ID_DO_APARELHO_EM_USO');
    assert.equal(r.json().details?.area_id, undefined);
    assert.equal(await prisma().medicaoForragem.count({ where: { cliente_id: b.clienteId } }), 0);
  });

  test('5A-04 excluída: repetir a criação não recria', async () => {
    const c = await conta();
    const id = randomUUID();
    assert.equal((await req('POST', '/medicoes-forragem', c.token, medicao(c, id))).statusCode, 201);
    assert.equal((await req('DELETE', `/medicoes-forragem/${id}`, c.token)).statusCode, 204);
    const r = await req('POST', '/medicoes-forragem', c.token, medicao(c, id));
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ID_DO_APARELHO_EXCLUIDO');
    assert.equal(await prisma().medicaoForragem.count({ where: { cliente_id: c.clienteId } }), 0);
  });
});

describe('D-PROD-319 — tarefa do mapa com id do aparelho', () => {
  test('5A-05 repetir devolve a mesma, com um registro só no histórico', async () => {
    const c = await conta();
    const tipoId = await tipoDeTarefa(c);
    const id = randomUUID();
    const a = await req('POST', '/lancamentos-tarefa', c.token, tarefa(c, tipoId, id));
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(a.json().id, id);
    const b = await req('POST', '/lancamentos-tarefa', c.token, tarefa(c, tipoId, id));
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(b.json().id, id);
    assert.equal(b.json().titulo, 'Arrumar cerca');
    assert.equal(await prisma().lancamentoTarefa.count({ where: { cliente_id: c.clienteId } }), 1);
    assert.equal(await prisma().historicoLancamentoTarefa.count({ where: { cliente_id: c.clienteId, tarefa_id: id } }), 1);
    assert.equal(await auditorias(c.clienteId, 'LancamentoTarefa'), 1);
  });

  test('5A-06 excluída: repetir não recria', async () => {
    const c = await conta();
    const tipoId = await tipoDeTarefa(c);
    const id = randomUUID();
    assert.equal((await req('POST', '/lancamentos-tarefa', c.token, tarefa(c, tipoId, id))).statusCode, 201);
    const del = await req('DELETE', `/lancamentos-tarefa/${id}`, c.token);
    assert.ok([200, 204].includes(del.statusCode), del.body);
    const r = await req('POST', '/lancamentos-tarefa', c.token, tarefa(c, tipoId, id));
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ID_DO_APARELHO_EXCLUIDO');
  });
});

describe('D-PROD-319 — evento de suplementação com id do aparelho', () => {
  test('5A-07 repetir devolve o mesmo; o id não vai para os dados do documento', async () => {
    const c = await conta();
    const id = randomUUID();
    const a = await req('POST', '/suplementacao-eventos', c.token, evento(c, id));
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(a.json().id, id);
    const b = await req('POST', '/suplementacao-eventos', c.token, evento(c, id));
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(b.json().id, id);
    const linhas = await prisma().suplementacaoEvento.findMany({ where: { cliente_id: c.clienteId } });
    assert.equal(linhas.length, 1);
    assert.equal(/** @type {any} */ (linhas[0].dados).id, undefined);
  });
});

describe('D-PROD-319 — sem id do aparelho', () => {
  test('5A-08 sem id: o servidor gera; id que não é UUID: 400 na medição e na tarefa, ignorado no evento', async () => {
    const c = await conta();
    const tipoId = await tipoDeTarefa(c);
    const m = await req('POST', '/medicoes-forragem', c.token, medicao(c));
    assert.equal(m.statusCode, 201, m.body);
    assert.ok(m.json().id);
    const t = await req('POST', '/lancamentos-tarefa', c.token, tarefa(c, tipoId));
    assert.equal(t.statusCode, 201, t.body);
    assert.ok(t.json().id);
    assert.equal((await req('POST', '/medicoes-forragem', c.token, medicao(c, 'offline_x_1'))).statusCode, 400);
    assert.equal((await req('POST', '/lancamentos-tarefa', c.token, tarefa(c, tipoId, 'offline_x_1'))).statusCode, 400);
    const e = await req('POST', '/suplementacao-eventos', c.token, evento(c, 'offline_x_1'));
    assert.equal(e.statusCode, 201, e.body);
    assert.notEqual(e.json().id, 'offline_x_1');
  });
});

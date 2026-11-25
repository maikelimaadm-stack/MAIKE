/**
 * D-PROD-308 — criação com o id gerado no aparelho: repetir não duplica.
 *
 * ID-01 lote com id do aparelho: criado com esse id; repetir devolve o mesmo (um lote, uma numeração)
 * ID-02 duas criações simultâneas com o mesmo id: um lote só
 * ID-03 o mesmo id em OUTRO tenant: 409 ID_DO_APARELHO_EM_USO, nada vaza
 * ID-04 lote excluído: repetir a criação não recria (409 ID_DO_APARELHO_EXCLUIDO)
 * ID-05 ponto (cocho) com id do aparelho: repetir devolve o mesmo
 * ID-06 ponto apagado de vez: repetir a criação não recria (pelo histórico)
 * ID-07 sem id (ou id que não é UUID no ponto): o caminho de sempre, o servidor gera o id
 * ID-08 lote apagado de vez (exclusão física): repetir a criação não recria (pelo histórico)
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

const conta = async () => {
  const c = await criarTenant();
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  const empresa = await prisma().empresa.create({
    data: { cliente_id: c.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' },
  });
  return { ...c, token: corpo.token, empresa };
};

const novoLote = (c, id) => ({
  ...(id ? { id } : {}),
  empresa_id: c.empresa.id,
  nome: 'LOTE DO CAMPO',
  quantidade_cabecas: 30,
  motivo_entrada: 'Compra',
});

describe('D-PROD-308 — lote com id do aparelho', () => {
  test('ID-01 criado com o id do aparelho; repetir devolve o mesmo (um lote, uma numeração)', async () => {
    const c = await conta();
    const id = randomUUID();
    const a = await req('POST', '/lotes', c.token, novoLote(c, id));
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(a.json().id, id);
    const b = await req('POST', '/lotes', c.token, novoLote(c, id.toUpperCase()));
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(b.json().id, id);
    assert.equal(b.json().numero_lote, a.json().numero_lote);
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 1);
    const criacoes = await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'Lote', acao: 'create' } });
    assert.equal(criacoes, 1);
  });

  test('ID-02 duas criações simultâneas com o mesmo id: um lote só', async () => {
    const c = await conta();
    const id = randomUUID();
    const [a, b] = await Promise.all([req('POST', '/lotes', c.token, novoLote(c, id)), req('POST', '/lotes', c.token, novoLote(c, id))]);
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(a.json().id, id);
    assert.equal(b.json().id, id);
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 1);
  });

  test('ID-03 o mesmo id em outro tenant: 409 ID_DO_APARELHO_EM_USO, nada vaza', async () => {
    const a = await conta();
    const b = await conta();
    const id = randomUUID();
    assert.equal((await req('POST', '/lotes', a.token, novoLote(a, id))).statusCode, 201);
    const r = await req('POST', '/lotes', b.token, novoLote(b, id));
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code ?? r.json().error?.code, 'ID_DO_APARELHO_EM_USO');
    assert.ok(!r.body.includes('LOTE DO CAMPO'));
    assert.equal(await prisma().lote.count({ where: { cliente_id: b.cliente.id } }), 0);
  });

  test('ID-04 lote excluído: repetir a criação não recria', async () => {
    const c = await conta();
    const id = randomUUID();
    assert.equal((await req('POST', '/lotes', c.token, novoLote(c, id))).statusCode, 201);
    await prisma().lote.update({ where: { id }, data: { excluido_em: new Date() } });
    const r = await req('POST', '/lotes', c.token, novoLote(c, id));
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code ?? r.json().error?.code, 'ID_DO_APARELHO_EXCLUIDO');
  });

  test('ID-08 lote apagado de vez (sem histórico): repetir a criação não recria', async () => {
    const c = await conta();
    const id = randomUUID();
    assert.equal((await req('POST', '/lotes', c.token, novoLote(c, id))).statusCode, 201);
    const del = await req('DELETE', `/lotes/${id}`, c.token);
    assert.ok([200, 204].includes(del.statusCode), del.body);
    assert.equal(await prisma().lote.count({ where: { id } }), 0, 'exclusão física');
    const r = await req('POST', '/lotes', c.token, novoLote(c, id));
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code ?? r.json().error?.code, 'ID_DO_APARELHO_EXCLUIDO');
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 0);
  });

  test('ID-07a sem id: o servidor gera o id, como sempre', async () => {
    const c = await conta();
    const r = await req('POST', '/lotes', c.token, novoLote(c));
    assert.equal(r.statusCode, 201, r.body);
    assert.ok(r.json().id);
  });

  test('ID-07b id que não é UUID no lote: recusado pelo schema (400)', async () => {
    const c = await conta();
    const r = await req('POST', '/lotes', c.token, novoLote(c, 'offline_Lote_123_abc'));
    assert.equal(r.statusCode, 400, r.body);
  });
});

describe('D-PROD-308 — ponto (cocho) com id do aparelho', () => {
  const novoPonto = (c, id) => ({ ...(id ? { id } : {}), empresa_id: c.empresa.id, nome_ponto: 'COCHO NOVO', categoria_ponto: 'COCHO' });

  test('ID-05 criado com o id do aparelho; repetir devolve o mesmo', async () => {
    const c = await conta();
    const id = randomUUID();
    const a = await req('POST', '/pontos-suplementacao', c.token, novoPonto(c, id));
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(a.json().id, id);
    const b = await req('POST', '/pontos-suplementacao', c.token, novoPonto(c, id));
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(b.json().numero_ponto, a.json().numero_ponto);
    assert.equal(await prisma().pontoSuplementacao.count({ where: { cliente_id: c.cliente.id } }), 1);
  });

  test('ID-06 ponto apagado de vez: repetir a criação não recria', async () => {
    const c = await conta();
    const id = randomUUID();
    assert.equal((await req('POST', '/pontos-suplementacao', c.token, novoPonto(c, id))).statusCode, 201);
    const del = await req('DELETE', `/pontos-suplementacao/${id}`, c.token);
    assert.ok([200, 204].includes(del.statusCode), del.body);
    const r = await req('POST', '/pontos-suplementacao', c.token, novoPonto(c, id));
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code ?? r.json().error?.code, 'ID_DO_APARELHO_EXCLUIDO');
    assert.equal(await prisma().pontoSuplementacao.count({ where: { cliente_id: c.cliente.id } }), 0);
  });

  test('ID-07c id que não é UUID no ponto: ignorado, o servidor gera o id (como antes)', async () => {
    const c = await conta();
    const r = await req('POST', '/pontos-suplementacao', c.token, novoPonto(c, 'offline_PontoSuplementacao_1_x'));
    assert.equal(r.statusCode, 201, r.body);
    assert.notEqual(r.json().id, 'offline_PontoSuplementacao_1_x');
  });
});

/**
 * D-PROD-345 — Fase 3 da sincronização: "o que mudou desde a última vez" também em pontos de referência, linhas e
 * tarefas (como lotes e cochos, D-PROD-309).
 *
 * MC-01 cada um: sem `desde` vem tudo, na forma da listagem; com `desde`, só o alterado e o excluído do período
 * MC-02 tenant: a outra conta não vê nada
 * MC-03 `desde` inválido → 400
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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

const AQUI = { lat: -15.6, lng: -56.1 };

const conta = async () => {
  const c = await criarTenant();
  const { corpo } = await autenticarNoApp(app, c.credenciais);
  const empresa = await prisma().empresa.create({
    data: { cliente_id: c.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' },
  });
  return { ...c, token: corpo.token, empresa };
};

/** @param {any} c @param {string} url @param {any} corpo */
const criar = async (c, url, corpo) => {
  const r = await req('POST', url, c.token, corpo);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

/** Volta a hora de gravação para trás (fora da margem de 60 s), sem passar pela regra do serviço. */
const envelhecer = async (tabela, ids) => {
  const antes = new Date(Date.now() - 10 * 60_000);
  await prisma().$executeRawUnsafe(`UPDATE "${tabela}" SET "updatedAt" = $1 WHERE id = ANY($2)`, antes, ids);
  await prisma().auditLog.updateMany({ where: { entidade_id: { in: ids } }, data: { createdAt: antes } });
};

describe('D-PROD-345 — /mudancas em mais cadastros', () => {
  test('MC-01 pontos de referência, linhas e tarefas: tudo sem desde; só o do período com desde', async () => {
    const c = await conta();
    const p1 = await criar(c, '/pontos-referencia', { empresa_id: c.empresa.id, nome: 'PORTEIRA', tipo: 'PORTEIRA', coordenadas: AQUI });
    const p2 = await criar(c, '/pontos-referencia', { empresa_id: c.empresa.id, nome: 'MATA', tipo: 'PORTEIRA', coordenadas: AQUI });
    const l1 = await criar(c, '/linhas-geograficas', { empresa_id: c.empresa.id, nome: 'CERCA', tipo: 'Cerca' });
    const l2 = await criar(c, '/linhas-geograficas', { empresa_id: c.empresa.id, nome: 'ESTRADA', tipo: 'Estrada' });
    const t1 = await criar(c, '/lancamentos-tarefa', { empresa_id: c.empresa.id, titulo: 'CERCA', status: 'Pendente' });
    const t2 = await criar(c, '/lancamentos-tarefa', { empresa_id: c.empresa.id, titulo: 'COCHO', status: 'Pendente' });

    for (const [url, ids] of [['/pontos-referencia', [p1.id, p2.id]], ['/linhas-geograficas', [l1.id, l2.id]], ['/lancamentos-tarefa', [t1.id, t2.id]]]) {
      const tudo = await req('GET', `${url}/mudancas`, c.token);
      assert.equal(tudo.statusCode, 200, tudo.body);
      assert.deepEqual(tudo.json().itens.map((r) => r.id).sort(), [...ids].sort());
      const lista = (await req('GET', url, c.token)).json();
      // A mesma forma pública da listagem.
      assert.deepEqual(Object.keys(tudo.json().itens[0]).sort(), Object.keys(lista[0]).sort());
    }

    await envelhecer('PontoReferencia', [p1.id, p2.id]);
    await envelhecer('LinhaGeografica', [l1.id, l2.id]);
    await envelhecer('LancamentoTarefa', [t1.id, t2.id]);
    const desde = new Date(Date.now() - 5 * 60_000).toISOString();

    assert.equal((await req('PATCH', `/pontos-referencia/${p1.id}`, c.token, { nome: 'PORTEIRA NOVA' })).statusCode, 200);
    assert.equal((await req('DELETE', `/pontos-referencia/${p2.id}`, c.token)).statusCode < 300, true);
    assert.equal((await req('PATCH', `/linhas-geograficas/${l2.id}`, c.token, { ativo: false })).statusCode, 200);
    assert.equal((await req('PATCH', `/lancamentos-tarefa/${t1.id}`, c.token, { status: 'Em Andamento' })).statusCode, 200);
    assert.equal((await req('DELETE', `/lancamentos-tarefa/${t2.id}`, c.token)).statusCode < 300, true);

    const pontos = (await req('GET', `/pontos-referencia/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(pontos.itens.map((r) => [r.id, r.nome]), [[p1.id, 'PORTEIRA NOVA']]);
    assert.deepEqual(pontos.excluidos, [p2.id]);

    const linhas = (await req('GET', `/linhas-geograficas/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(linhas.itens.map((r) => [r.id, r.ativo]), [[l2.id, false]]);
    assert.deepEqual(linhas.excluidos, []);

    const tarefas = (await req('GET', `/lancamentos-tarefa/mudancas?desde=${encodeURIComponent(desde)}`, c.token)).json();
    assert.deepEqual(tarefas.itens.map((r) => [r.id, r.status]), [[t1.id, 'Em Andamento']]);
    assert.deepEqual(tarefas.excluidos, [t2.id]);
  });

  test('MC-02 a outra conta não vê nada', async () => {
    const a = await conta();
    const b = await conta();
    await criar(a, '/pontos-referencia', { empresa_id: a.empresa.id, nome: 'DE A', tipo: 'PORTEIRA', coordenadas: AQUI });
    await criar(a, '/lancamentos-tarefa', { empresa_id: a.empresa.id, titulo: 'DE A', status: 'Pendente' });
    for (const url of ['/pontos-referencia/mudancas', '/linhas-geograficas/mudancas', '/lancamentos-tarefa/mudancas']) {
      const r = await req('GET', url, b.token);
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual(r.json().itens, []);
    }
  });

  test('MC-03 desde inválido → 400', async () => {
    const c = await conta();
    for (const url of ['/pontos-referencia/mudancas', '/linhas-geograficas/mudancas', '/lancamentos-tarefa/mudancas']) {
      const r = await req('GET', `${url}?desde=ontem-a-noite`, c.token);
      assert.equal(r.statusCode, 400, `${url}: ${r.body}`);
    }
  });
});

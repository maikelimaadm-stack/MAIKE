/**
 * D-PROD-335 — o lançamento do cocho guarda o código da operação (`operation_id`).
 *
 * O app que tentou enviar sem receber a resposta (sinal fraco) confere por ele se o lançamento já está na lista do
 * servidor: sem isso o lançamento sumia da tela e a pessoa lançava de novo.
 *
 * LO-01 o lançamento volta (na resposta e na lista) com o operation_id; repetir o pedido não cria outro
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

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

const auth = (token) => ({ authorization: `Bearer ${token}` });

describe('D-PROD-335 — código da operação no lançamento do cocho', () => {
  test('LO-01 resposta e lista trazem o operation_id; repetir não duplica', async () => {
    const { credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);
    const token = corpo.token;
    const empresa = await app.inject({ method: 'POST', url: '/empresas', headers: auth(token), payload: { apelido: 'FAZENDA', nome: 'FAZENDA', tipo_pessoa: 'Jurídica' } });
    assert.equal(empresa.statusCode, 201, empresa.body.slice(0, 300));
    const empresaId = empresa.json().id;
    const operacao = `lanc-${randomUUID()}`;
    const pedido = {
      operation_id: operacao,
      evento: { empresa_id: empresaId, data_lancamento: '2026-11-10', quantidade_total_kg: 100, sobra_kg: 0 },
      lotes: [],
    };
    const r = await app.inject({ method: 'POST', url: '/suplementacao-eventos/comandos/lancamento-com-lotes', headers: auth(token), payload: pedido });
    assert.ok(r.statusCode === 200 || r.statusCode === 201, r.body.slice(0, 300));
    assert.equal(r.json().evento.operation_id, operacao);

    const repetido = await app.inject({ method: 'POST', url: '/suplementacao-eventos/comandos/lancamento-com-lotes', headers: auth(token), payload: pedido });
    assert.ok(repetido.statusCode === 200 || repetido.statusCode === 201, repetido.body.slice(0, 300));
    assert.equal(repetido.json().evento.id, r.json().evento.id);

    const lista = await app.inject({ method: 'GET', url: '/suplementacao-eventos', headers: auth(token) });
    assert.equal(lista.statusCode, 200, lista.body.slice(0, 300));
    const doTenant = lista.json().filter((e) => e.operation_id === operacao);
    assert.equal(doTenant.length, 1);
  });
});

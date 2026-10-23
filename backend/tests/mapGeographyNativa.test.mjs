/**
 * Geografia do mapa nativa (P4.3, D-PROD-32) — PostgreSQL real.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { escopoDaNumeracao as escopoPonto, ENTIDADE_SEQUENCIA as SEQ_PONTO } from '../src/modules/mapGeography/pontoReferenciaService.js';
import { escopoDaNumeracao as escopoLinha, ENTIDADE_SEQUENCIA as SEQ_LINHA } from '../src/modules/mapGeography/linhaGeograficaService.js';
import { ESCOPO_TENANT } from '../src/modules/sequencias/entidadeCodigoService.js';
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

const EMPRESA = 'empresa-legada-1';
const auth = (token) => ({ authorization: `Bearer ${token}` });

const tenantAutenticado = async (opcoes) => {
  const { credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token };
};

describe('P4.3 — numeração', () => {
  test('BE-P43-01 escopos tenant para ponto e linha', () => {
    assert.equal(escopoPonto(), ESCOPO_TENANT);
    assert.equal(escopoLinha(), ESCOPO_TENANT);
    assert.equal(SEQ_PONTO, 'PontoReferencia');
    assert.equal(SEQ_LINHA, 'LinhaGeografica');
  });

  test('BE-P43-02 numero_ponto e numero_linha sequenciais', async () => {
    const { token } = await tenantAutenticado();

    const p1 = await app.inject({
      method: 'POST',
      url: '/pontos-referencia',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome: 'COCHO 1', tipo: 'Cocho' },
    });
    assert.equal(p1.statusCode, 201);
    assert.equal(p1.json().numero_ponto, '1');

    const l1 = await app.inject({
      method: 'POST',
      url: '/linhas-geograficas',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome: 'ESTRADA 1', tipo: 'Estrada' },
    });
    assert.equal(l1.statusCode, 201);
    assert.equal(l1.json().numero_linha, '1');
  });
});

describe('P4.3 — tenant isolation', () => {
  test('BE-P43-03 ponto de outro tenant é 404 no PATCH e DELETE', async () => {
    const a = await tenantAutenticado({ codigo: 'CLI-A', login: 'a@geo' });
    const b = await tenantAutenticado({ codigo: 'CLI-B', login: 'b@geo' });

    const criado = await app.inject({
      method: 'POST',
      url: '/pontos-referencia',
      headers: auth(b.token),
      payload: { empresa_id: EMPRESA, nome: 'P B', tipo: 'Cocho' },
    });
    const id = criado.json().id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/pontos-referencia/${id}`,
      headers: auth(a.token),
      payload: { nome: 'X' },
    });
    assert.equal(patch.statusCode, 404);
    assert.equal(patch.json().code, 'PONTO_REFERENCIA_NOT_FOUND');

    const del = await app.inject({
      method: 'DELETE',
      url: `/pontos-referencia/${id}`,
      headers: auth(a.token),
    });
    assert.equal(del.statusCode, 404);
  });
});

describe('P4.3 — DELETE ponto e ausência DELETE linha', () => {
  test('BE-P43-04 DELETE remove ponto', async () => {
    const { token } = await tenantAutenticado();
    const criado = await app.inject({
      method: 'POST',
      url: '/pontos-referencia',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome: 'P', tipo: 'Cocho' },
    });
    const id = criado.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/pontos-referencia/${id}`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 200);

    const lista = await app.inject({ method: 'GET', url: '/pontos-referencia', headers: auth(token) });
    assert.equal(lista.json().length, 0);
  });

  test('BE-P43-05 não existe DELETE /linhas-geograficas/:id', async () => {
    const { token } = await tenantAutenticado();
    const criado = await app.inject({
      method: 'POST',
      url: '/linhas-geograficas',
      headers: auth(token),
      payload: { empresa_id: EMPRESA, nome: 'L', tipo: 'Estrada' },
    });
    const id = criado.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/linhas-geograficas/${id}`,
      headers: auth(token),
    });
    assert.equal(del.statusCode, 404);
  });
});

describe('P4.3 — ícone sem numero', () => {
  test('BE-P43-06 cria ícone sem numero_*', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'POST',
      url: '/configuracao-icones',
      headers: auth(token),
      payload: { tipo_entidade: 'Ponto', categoria: 'COCHO', ativo: true },
    });
    assert.equal(r.statusCode, 201);
    const icone = r.json();
    assert.ok(icone.id);
    assert.equal('numero_icone' in icone, false);
  });
});

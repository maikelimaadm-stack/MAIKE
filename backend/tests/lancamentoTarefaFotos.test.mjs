/**
 * D-PROD-327 — a tarefa com foto salva: as fotos vão dentro da tarefa (endereço `data:`) e o corpo da tarefa
 * aceita até 4 MB (antes, o padrão de 1 MB recusava a tarefa com uma foto só).
 *
 * TF-01 criar com uma foto de ~1,5 MB: 201, e a foto volta igual
 * TF-02 editar juntando mais duas fotos (~3 MB no total): 200
 * TF-03 acima de 4 MB: 413 (a tarefa não é gravada)
 * D-PROD-335:
 * TF-04 `fotos_adicionar` SOMA às fotos que a tarefa tem no servidor (sem repetir); o aparelho não precisa da lista
 * TF-05 com `fotos` junto, a soma é sobre a lista enviada (o que a pessoa tirou, sai)
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

const auth = (token) => ({ authorization: `Bearer ${token}` });
const tokenDoTenant = async () => {
  const { credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return corpo.token;
};
/** Uma "foto" em `data:` com cerca de `kb` KB. */
const foto = (kb, letra = 'A') => `data:image/jpeg;base64,${letra.repeat(kb * 1024)}`;

describe('D-PROD-327 — tarefa com foto', () => {
  test('TF-01 criar com uma foto de ~1,5 MB', async () => {
    const token = await tokenDoTenant();
    const f = foto(1536);
    const r = await app.inject({ method: 'POST', url: '/lancamentos-tarefa', headers: auth(token), payload: { empresa_id: 'emp-1', titulo: 'CERCA', fotos: [f] } });
    assert.equal(r.statusCode, 201, r.body.slice(0, 300));
    assert.equal(r.json().fotos[0], f);
  });

  test('TF-02 editar juntando mais duas fotos (~3 MB)', async () => {
    const token = await tokenDoTenant();
    const criada = await app.inject({ method: 'POST', url: '/lancamentos-tarefa', headers: auth(token), payload: { empresa_id: 'emp-1', titulo: 'COCHO', fotos: [foto(1024, 'A')] } });
    assert.equal(criada.statusCode, 201, criada.body.slice(0, 300));
    const fotos = [foto(1024, 'A'), foto(1024, 'B'), foto(1024, 'C')];
    const r = await app.inject({ method: 'PATCH', url: `/lancamentos-tarefa/${criada.json().id}`, headers: auth(token), payload: { fotos } });
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    assert.equal(r.json().fotos.length, 3);
  });

  test('TF-03 acima de 4 MB: 413', async () => {
    const token = await tokenDoTenant();
    const r = await app.inject({ method: 'POST', url: '/lancamentos-tarefa', headers: auth(token), payload: { empresa_id: 'emp-1', titulo: 'PESADA', fotos: [foto(2200, 'A'), foto(2200, 'B')] } });
    assert.equal(r.statusCode, 413);
    const lista = await app.inject({ method: 'GET', url: '/lancamentos-tarefa', headers: auth(token) });
    assert.equal(lista.json().length, 0);
  });

  test('TF-04 fotos_adicionar soma às fotos do servidor, sem repetir', async () => {
    const token = await tokenDoTenant();
    const criada = await app.inject({ method: 'POST', url: '/lancamentos-tarefa', headers: auth(token), payload: { empresa_id: 'emp-1', titulo: 'CERCA', fotos: ['https://f/escritorio.jpg'] } });
    assert.equal(criada.statusCode, 201, criada.body.slice(0, 300));
    const id = criada.json().id;
    const r = await app.inject({ method: 'PATCH', url: `/lancamentos-tarefa/${id}`, headers: auth(token), payload: { fotos_adicionar: ['https://f/campo.jpg'], historico_evento: 'Edição', historico_descricao: 'Foto tirada sem internet enviada.' } });
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    assert.deepEqual(r.json().fotos, ['https://f/escritorio.jpg', 'https://f/campo.jpg']);
    const de_novo = await app.inject({ method: 'PATCH', url: `/lancamentos-tarefa/${id}`, headers: auth(token), payload: { fotos_adicionar: ['https://f/campo.jpg'] } });
    assert.equal(de_novo.statusCode, 200, de_novo.body.slice(0, 300));
    assert.deepEqual(de_novo.json().fotos, ['https://f/escritorio.jpg', 'https://f/campo.jpg']);
    assert.equal(Object.prototype.hasOwnProperty.call(de_novo.json(), 'fotos_adicionar'), false);
  });

  test('TF-05 com fotos junto, a soma é sobre a lista enviada', async () => {
    const token = await tokenDoTenant();
    const criada = await app.inject({ method: 'POST', url: '/lancamentos-tarefa', headers: auth(token), payload: { empresa_id: 'emp-1', titulo: 'CERCA', fotos: ['https://f/a.jpg', 'https://f/b.jpg'] } });
    const r = await app.inject({ method: 'PATCH', url: `/lancamentos-tarefa/${criada.json().id}`, headers: auth(token), payload: { fotos: ['https://f/a.jpg'], fotos_adicionar: ['https://f/c.jpg'] } });
    assert.equal(r.statusCode, 200, r.body.slice(0, 300));
    assert.deepEqual(r.json().fotos, ['https://f/a.jpg', 'https://f/c.jpg']);
  });
});

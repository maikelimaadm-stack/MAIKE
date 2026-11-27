/**
 * D-PROD-344 — Fase 2 da sincronização: a versão do registro em área, ponto de referência, linha e tarefa (como
 * lote e cocho, D-PROD-316). Sem versão, duas pessoas editando o mesmo cadastro (uma sem internet) apagavam a edição
 * uma da outra em silêncio.
 *
 * VC-01 cada um: a versão vista grava; outra edição com a versão velha → 409, nada gravado; a MESMA edição repetida
 *       (resposta perdida) → 200; sem versão grava como antes
 * VC-02 área: a altura digitada com vírgula ("30,5") repetida conta como a mesma edição (compara o valor já tratado)
 * VC-03 tarefa: só histórico ou fotos somadas não conferem a versão (não apagam o que outra pessoa fez)
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

const esperar = () => new Promise((r) => setTimeout(r, 5));

/** @param {any} c @param {string} url @param {any} corpo */
const criar = async (c, url, corpo) => {
  const r = await req('POST', url, c.token, corpo);
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

/**
 * @param {any} c @param {string} base @param {any} registro @param {Record<string, unknown>} a @param {Record<string, unknown>} b
 */
const conferirVersao = async (c, base, registro, a, b) => {
  await esperar();
  const r1 = await req('PATCH', `${base}/${registro.id}`, c.token, { ...a, versao_esperada: registro.updated_date });
  assert.equal(r1.statusCode, 200, `${base} versão vista: ${r1.body}`);
  await esperar();
  const repetida = await req('PATCH', `${base}/${registro.id}`, c.token, { ...a, versao_esperada: registro.updated_date });
  assert.equal(repetida.statusCode, 200, `${base} repetida: ${repetida.body}`);
  const velha = await req('PATCH', `${base}/${registro.id}`, c.token, { ...b, versao_esperada: registro.updated_date });
  assert.equal(velha.statusCode, 409, `${base} versão velha: ${velha.body}`);
  assert.equal(velha.json().code, 'REGISTRO_VERSAO_CONFLITO');
  const semVersao = await req('PATCH', `${base}/${registro.id}`, c.token, b);
  assert.equal(semVersao.statusCode, 200, `${base} sem versão: ${semVersao.body}`);
};

describe('D-PROD-344 — versão em mais cadastros', () => {
  test('VC-01 área, ponto de referência, linha e tarefa conferem a versão', async () => {
    const c = await conta();
    const setor = await criar(c, '/setores', { empresa_id: c.empresa.id, nome: 'RETIRO', tipo: 'Próprio' });
    const area = await criar(c, '/areas-pastagem', { empresa_id: c.empresa.id, setor_id: setor.id, nome: 'P1', tamanho_hectares: 1 });
    await conferirVersao(c, '/areas-pastagem', area, { nome: 'P1 NOVO' }, { nome: 'P1 OUTRO' });
    assert.equal((await prisma().areaPastagem.findFirst({ where: { id: area.id } })).nome, 'P1 OUTRO');

    const ponto = await criar(c, '/pontos-referencia', { empresa_id: c.empresa.id, nome: 'PORTEIRA', tipo: 'PORTEIRA', coordenadas: AQUI });
    await conferirVersao(c, '/pontos-referencia', ponto, { nome: 'PORTEIRA 1' }, { nome: 'PORTEIRA 2' });

    const linha = await criar(c, '/linhas-geograficas', { empresa_id: c.empresa.id, nome: 'CERCA', tipo: 'Cerca' });
    await conferirVersao(c, '/linhas-geograficas', linha, { nome: 'CERCA NORTE' }, { nome: 'CERCA SUL' });

    const tarefa = await criar(c, '/lancamentos-tarefa', { empresa_id: c.empresa.id, titulo: 'CERCA', status: 'Pendente' });
    await conferirVersao(c, '/lancamentos-tarefa', tarefa, { titulo: 'CERCA CAÍDA' }, { titulo: 'CERCA ARRUMADA' });
  });

  test('VC-02 área: a altura com vírgula repetida conta como a mesma edição', async () => {
    const c = await conta();
    const setor = await criar(c, '/setores', { empresa_id: c.empresa.id, nome: 'RETIRO', tipo: 'Próprio' });
    const area = await criar(c, '/areas-pastagem', { empresa_id: c.empresa.id, setor_id: setor.id, nome: 'P2', tamanho_hectares: 1 });
    await esperar();
    const r1 = await req('PATCH', `/areas-pastagem/${area.id}`, c.token, { altura_entrada_cm: '30,5', versao_esperada: area.updated_date });
    assert.equal(r1.statusCode, 200, r1.body);
    const repetida = await req('PATCH', `/areas-pastagem/${area.id}`, c.token, { altura_entrada_cm: '30,5', versao_esperada: area.updated_date });
    assert.equal(repetida.statusCode, 200, repetida.body);
  });

  test('VC-03 tarefa: histórico e fotos somadas não conferem a versão', async () => {
    const c = await conta();
    const tarefa = await criar(c, '/lancamentos-tarefa', { empresa_id: c.empresa.id, titulo: 'COCHO', status: 'Pendente' });
    await esperar();
    const outra = await req('PATCH', `/lancamentos-tarefa/${tarefa.id}`, c.token, { titulo: 'COCHO 2' });
    assert.equal(outra.statusCode, 200, outra.body);
    const historico = await req('PATCH', `/lancamentos-tarefa/${tarefa.id}`, c.token, {
      historico_evento: 'Registro',
      historico_descricao: 'Visto no campo',
      versao_esperada: tarefa.updated_date,
    });
    assert.equal(historico.statusCode, 200, historico.body);
    const fotos = await req('PATCH', `/lancamentos-tarefa/${tarefa.id}`, c.token, { fotos_adicionar: ['https://f/a.jpg'], versao_esperada: tarefa.updated_date });
    assert.equal(fotos.statusCode, 200, fotos.body);
    assert.equal(fotos.json().titulo, 'COCHO 2');
  });
});

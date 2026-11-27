/**
 * D-PROD-316 — Etapa 3 da sincronização: versão do registro e quem alterou.
 *
 * VR-01 lote: a edição com a versão vista grava; com a versão velha → 409 REGISTRO_VERSAO_CONFLITO, nada gravado,
 *       com a versão atual, quem alterou e quando
 * VR-02 sem versão (app antigo, cascata): grava como antes
 * VR-03 cocho: o mesmo; o depósito diz "O depósito"
 * VR-04 versão em formato inválido → 400, nada gravado
 * VR-05 mudança feita pelo servidor (sem PATCH) também muda a versão
 * VR-06 outro tenant: 404, não vaza a versão nem quem alterou
 * VR-07 (D-PROD-342) a MESMA edição repetida com a versão de antes (resposta perdida com o sinal fraco) não é conflito
 *       (lote e cocho); uma edição diferente com a versão velha continua 409
 * VR-08 (D-PROD-342) o reconhecimento da repetição compara pelo tipo gravado: texto como texto ("01" ≠ "1" e a chave
 *       de 44 dígitos não vira número), coordenadas com as chaves em outra ordem e número com mais casas que a coluna
 *       guarda contam como a mesma edição
 * VR-09 (D-PROD-342) a mesma edição da tarefa repetida não grava outra linha no histórico; um registro só de
 *       histórico (sem campos) continua gravando
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

const criarLote = async (c, nome) => {
  const r = await req('POST', '/lotes', c.token, { empresa_id: c.empresa.id, nome, quantidade_cabecas: 10, motivo_entrada: 'Compra' });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const criarPonto = async (c, categoria = 'COCHO') => {
  const r = await req('POST', '/pontos-suplementacao', c.token, { id: randomUUID(), empresa_id: c.empresa.id, nome_ponto: `P ${categoria}`, categoria_ponto: categoria });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

/** Garante um milissegundo de diferença entre duas gravações. */
const esperar = () => new Promise((r) => setTimeout(r, 5));

describe('D-PROD-316 — versão do registro', () => {
  test('VR-01 lote: versão vista grava; versão velha → 409 com quem e quando; nada gravado', async () => {
    const c = await conta();
    const lote = await criarLote(c, 'A');
    await esperar();
    const r1 = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'A1', versao_esperada: lote.updated_date });
    assert.equal(r1.statusCode, 200, r1.body);
    const v1 = r1.json();
    assert.notEqual(v1.updated_date, lote.updated_date, 'a gravação muda a versão');
    // Outra pessoa (ou o aparelho sem internet) ainda com a versão de antes:
    const r2 = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'A2', versao_esperada: lote.updated_date });
    assert.equal(r2.statusCode, 409, r2.body);
    const e = r2.json();
    assert.equal(e.code, 'REGISTRO_VERSAO_CONFLITO');
    assert.equal(e.details.versao_atual, v1.updated_date);
    assert.equal(e.details.entidade, 'Lote');
    assert.equal(e.details.id, lote.id);
    assert.ok(e.details.alterado_por_nome, 'diz quem alterou');
    assert.ok(Date.parse(e.details.alterado_em), 'e quando');
    const atual = await prisma().lote.findUnique({ where: { id: lote.id } });
    assert.equal(atual.nome, 'A1', 'nada gravado');
    // Com a versão atual, grava.
    const r3 = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'A3', versao_esperada: v1.updated_date });
    assert.equal(r3.statusCode, 200, r3.body);
  });

  test('VR-02 sem versão: grava como antes', async () => {
    const c = await conta();
    const lote = await criarLote(c, 'B');
    await esperar();
    await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'B1' });
    const r = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'B2' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().nome, 'B2');
  });

  test('VR-03 cocho e depósito: o mesmo, com o nome certo na mensagem', async () => {
    const c = await conta();
    const cocho = await criarPonto(c, 'COCHO');
    await esperar();
    const ok = await req('PATCH', `/pontos-suplementacao/${cocho.id}`, c.token, { nome_ponto: 'C1', versao_esperada: cocho.updated_date });
    assert.equal(ok.statusCode, 200, ok.body);
    const velho = await req('PATCH', `/pontos-suplementacao/${cocho.id}`, c.token, { nome_ponto: 'C2', versao_esperada: cocho.updated_date });
    assert.equal(velho.statusCode, 409, velho.body);
    assert.equal(velho.json().code, 'REGISTRO_VERSAO_CONFLITO');
    assert.equal((await prisma().pontoSuplementacao.findUnique({ where: { id: cocho.id } })).nome_ponto, 'C1');
    const deposito = await criarPonto(c, 'DEPOSITO');
    await esperar();
    await req('PATCH', `/pontos-suplementacao/${deposito.id}`, c.token, { nome_ponto: 'D1' });
    const d = await req('PATCH', `/pontos-suplementacao/${deposito.id}`, c.token, { nome_ponto: 'D2', versao_esperada: deposito.updated_date });
    assert.equal(d.statusCode, 409, d.body);
    assert.match(d.json().message, /^O depósito foi alterado/);
  });

  test('VR-04 versão em formato inválido → 400, nada gravado', async () => {
    const c = await conta();
    const lote = await criarLote(c, 'C');
    const cocho = await criarPonto(c);
    for (const [url, corpo] of [[`/lotes/${lote.id}`, { nome: 'X', versao_esperada: 'ontem' }], [`/pontos-suplementacao/${cocho.id}`, { nome_ponto: 'X', versao_esperada: 'ontem' }]]) {
      const r = await req('PATCH', url, c.token, corpo);
      assert.equal(r.statusCode, 400, `${url}: ${r.body}`);
    }
    assert.equal((await prisma().lote.findUnique({ where: { id: lote.id } })).nome, 'C');
  });

  test('VR-05 mudança feita pelo servidor (sem PATCH) também muda a versão', async () => {
    const c = await conta();
    const lote = await criarLote(c, 'D');
    await esperar();
    await prisma().lote.update({ where: { id: lote.id }, data: { observacoes: 'mudou por um manejo' } });
    const r = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'D1', versao_esperada: lote.updated_date });
    assert.equal(r.statusCode, 409, r.body);
  });

  test('VR-06 outro tenant: 404, sem vazar versão nem autor', async () => {
    const a = await conta();
    const b = await conta();
    const lote = await criarLote(a, 'E');
    const r = await req('PATCH', `/lotes/${lote.id}`, b.token, { nome: 'E1', versao_esperada: lote.updated_date });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(r.json().details?.alterado_por_nome, undefined);
  });

  test('VR-07 a mesma edição repetida (resposta perdida) não é conflito; outra edição com a versão velha é', async () => {
    const c = await conta();
    const lote = await criarLote(c, 'F');
    await esperar();
    const r1 = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'F1', versao_esperada: lote.updated_date });
    assert.equal(r1.statusCode, 200, r1.body);
    await esperar();
    // O aparelho não recebeu a resposta e manda a mesma edição de novo, com a versão de antes.
    const repetida = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'F1', versao_esperada: lote.updated_date });
    assert.equal(repetida.statusCode, 200, repetida.body);
    assert.equal(repetida.json().nome, 'F1');
    // Outra edição com a versão velha: alguém (a própria edição anterior) mudou o lote → conflito, como antes.
    const outra = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: 'F2', versao_esperada: lote.updated_date });
    assert.equal(outra.statusCode, 409, outra.body);

    const cocho = await criarPonto(c);
    await esperar();
    const p1 = await req('PATCH', `/pontos-suplementacao/${cocho.id}`, c.token, { nome_ponto: 'COCHO NOVO', versao_esperada: cocho.updated_date });
    assert.equal(p1.statusCode, 200, p1.body);
    const pRepetida = await req('PATCH', `/pontos-suplementacao/${cocho.id}`, c.token, { nome_ponto: 'COCHO NOVO', versao_esperada: cocho.updated_date });
    assert.equal(pRepetida.statusCode, 200, pRepetida.body);
    const pOutra = await req('PATCH', `/pontos-suplementacao/${cocho.id}`, c.token, { nome_ponto: 'OUTRO', versao_esperada: cocho.updated_date });
    assert.equal(pOutra.statusCode, 409, pOutra.body);
  });

  test('VR-08 a repetição é reconhecida pelo tipo gravado', async () => {
    const c = await conta();
    const lote = await criarLote(c, 'G');
    await esperar();
    // Outro aparelho grava nome "1"; este, com a versão velha, manda "01": é outra edição → conflito.
    const b = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: '1', versao_esperada: lote.updated_date });
    assert.equal(b.statusCode, 200, b.body);
    const a = await req('PATCH', `/lotes/${lote.id}`, c.token, { nome: '01', versao_esperada: lote.updated_date });
    assert.equal(a.statusCode, 409, a.body);
    assert.equal((await prisma().lote.findFirst({ where: { id: lote.id } })).nome, '1');

    const cocho = await criarPonto(c);
    await esperar();
    const edicao = { coordenadas: { lng: -47.1, lat: -15.2 }, capacidade_cocho_kg: 1500.12345 };
    const p1 = await req('PATCH', `/pontos-suplementacao/${cocho.id}`, c.token, { ...edicao, versao_esperada: cocho.updated_date });
    assert.equal(p1.statusCode, 200, p1.body);
    const repetida = await req('PATCH', `/pontos-suplementacao/${cocho.id}`, c.token, {
      coordenadas: { lat: -15.2, lng: -47.1 },
      capacidade_cocho_kg: 1500.12345,
      versao_esperada: cocho.updated_date,
    });
    assert.equal(repetida.statusCode, 200, repetida.body);
    const outra = await req('PATCH', `/pontos-suplementacao/${cocho.id}`, c.token, { capacidade_cocho_kg: 1500.2, versao_esperada: cocho.updated_date });
    assert.equal(outra.statusCode, 409, outra.body);
  });

  test('VR-09 a mesma edição da tarefa repetida não grava outro histórico', async () => {
    const c = await conta();
    const criada = await req('POST', '/lancamentos-tarefa', c.token, { empresa_id: c.empresa.id, titulo: 'CERCA', status: 'Pendente' });
    assert.equal(criada.statusCode, 201, criada.body);
    const id = criada.json().id;
    const linhas = () => prisma().historicoLancamentoTarefa.count({ where: { tarefa_id: id } });
    const antes = await linhas();
    const conclusao = { status: 'Concluída', historico_evento: 'Conclusão', historico_descricao: 'Concluída no campo.' };
    const r1 = await req('PATCH', `/lancamentos-tarefa/${id}`, c.token, conclusao);
    assert.equal(r1.statusCode, 200, r1.body);
    assert.equal(await linhas(), antes + 1);
    // A resposta se perdeu e o aparelho manda de novo: o mesmo resultado, sem outra "Conclusão".
    const r2 = await req('PATCH', `/lancamentos-tarefa/${id}`, c.token, conclusao);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal(await linhas(), antes + 1);
    // A foto que subiu duas vezes também não repete o histórico.
    const foto = { fotos_adicionar: ['https://f/campo.jpg'], historico_evento: 'Edição', historico_descricao: 'Foto enviada.' };
    await req('PATCH', `/lancamentos-tarefa/${id}`, c.token, foto);
    await req('PATCH', `/lancamentos-tarefa/${id}`, c.token, foto);
    assert.equal(await linhas(), antes + 2);
    // Registro só de histórico (sem campos): cada um vale.
    const registro = { historico_evento: 'Registro', historico_descricao: 'Cerca arrumada' };
    await req('PATCH', `/lancamentos-tarefa/${id}`, c.token, registro);
    await req('PATCH', `/lancamentos-tarefa/${id}`, c.token, registro);
    assert.equal(await linhas(), antes + 4);
  });
});

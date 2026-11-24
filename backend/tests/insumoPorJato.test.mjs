/**
 * D-PROD-283 (MAIKE-INSUMO-POR-JATO) — os jatos de hoje, contra PostgreSQL real e HTTP autenticado (`app.inject`).
 *
 * - O implemento cujo tipo usa produto POR JATO vem na lista de implementos com `jato: { capacidade, unidade }`; os
 *   outros, com `jato: null`.
 * - No `POST /atividades/registrar`, cada produto de cada jato é uma linha de insumo de sempre com o número do jato
 *   (`"1"`, `"2"`…): a baixa FIFO é a de sempre (o estoque cai pela soma dos jatos) e a linha devolve `jato`.
 * - O jato fora de "1".."999", ou em número, é 400 e nada é gravado. Sem `jato`, a linha é a de antes (`jato: null`).
 * - Editar a quantidade da linha de um jato mantém o jato.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { montarLinhasCusto, opId, prisma } from './atividadeLinhaCustoCenario.mjs';
import { corpoImplemento } from './patrimonioP1Cenario.mjs';

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

const montar = async () => {
  const s = await montarLinhasCusto(app);
  const registrar = (corpo) =>
    s.H.req('POST', '/atividades/registrar', s.token, { empresa_id: s.e1.id, tipo_atividade_id: s.tipo.id, data_operacional: '2027-06-10', area_id: s.area1.id, ...corpo });
  const insumo = (quantidade, jato) => ({ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade, ...(jato === undefined ? {} : { jato }) });
  const saldo = async () => {
    const lotes = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: s.herbicida.id } });
    return lotes.reduce((t, l) => t + Number(l.quantidade_disponivel ?? l.saldo ?? 0), 0);
  };
  return { ...s, registrar, insumo, saldo };
};

describe('implementos: o jato do tipo', () => {
  test('o implemento de tipo "por jato" vem com a capacidade; o outro, com jato null', async () => {
    const s = await montar();
    const p = prisma();
    const comum = await s.H.ok(s.H.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, { nome: 'Roçadeira' })), 201);
    const tipoBarra = await p.tipoPatrimonial.findUnique({ where: { id: s.tip.ROCADEIRA } });
    const base = Object.fromEntries(Object.entries(tipoBarra).filter(([k]) => !['id', 'createdAt', 'updatedAt'].includes(k)));
    const tipoJato = await p.tipoPatrimonial.create({
      data: { ...base, codigo: 'PULVERIZADOR_TESTE', nome: 'Pulverizador', usa_produto: true, forma_produto: 'JATO', capacidade: '2000', capacidade_unidade: 'L' },
    });
    const pulverizador = await s.H.ok(s.H.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, { nome: 'Pulverizador 2000', tipo_id: tipoJato.id, numero_serie: 'PV-1' })), 201);
    const lista = await s.H.ok(s.H.req('GET', `/atividades-opcoes/implementos?empresa_id=${s.e1.id}`, s.token));
    const porId = Object.fromEntries(lista.itens.map((i) => [i.id, i]));
    assert.deepEqual(porId[pulverizador.id].jato, { capacidade: '2000', unidade: 'L' });
    assert.equal(porId[comum.id].jato, null);
  });
});

describe('registrar com jatos', () => {
  test('3 linhas em 2 jatos: cada uma com o seu jato; o estoque cai pela soma', async () => {
    const s = await montar();
    const antes = await s.saldo();
    const r = await s.registrar({ operation_id: opId('jatos'), produtos: [s.insumo('10', '1'), s.insumo('12', '2'), s.insumo('3', '2')] });
    assert.equal(r.statusCode, 201, r.body);
    const linhas = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(linhas.map((l) => [l.jato, Number(l.quantidade)]), [[1, 10], [2, 12], [2, 3]]);
    assert.equal(antes - (await s.saldo()), 25, 'a baixa é a soma dos jatos');
  });

  test('sem jato, a linha é a de antes (jato null)', async () => {
    const s = await montar();
    const r = await s.registrar({ operation_id: opId('sem'), produtos: [s.insumo('5')] });
    assert.equal(r.statusCode, 201, r.body);
    const [l] = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c } });
    assert.equal(l.jato, null);
  });

  test('jato inválido ("0", "1000", "a", número) → 400 e nada gravado', async () => {
    const s = await montar();
    for (const jato of ['0', '1000', 'a', '1.5', 2]) {
      const r = await s.registrar({ operation_id: opId('ruim'), produtos: [s.insumo('5', jato)] });
      assert.equal(r.statusCode, 400, `${JSON.stringify(jato)}: ${r.body}`);
    }
    assert.equal(await prisma().atividadeApontamentoProduto.count({ where: { cliente_id: s.c } }), 0);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c } }), 0);
  });

  test('editar a quantidade da linha de um jato mantém o jato', async () => {
    const s = await montar();
    const r = await s.registrar({ operation_id: opId('ed'), produtos: [s.insumo('10', '3')] });
    assert.equal(r.statusCode, 201, r.body);
    const [l] = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c } });
    const ap = await prisma().atividadeApontamento.findUnique({ where: { id: l.apontamento_id } });
    const e = await s.H.req('PATCH', `/atividades/${ap.atividade_id}/apontamentos/${ap.id}/produtos/${l.id}`, s.token, {
      empresa_id: s.e1.id, versao: ap.versao, operation_id: opId('edl'), quantidade: '14',
    });
    assert.equal(e.statusCode, 200, e.body);
    assert.equal(e.json().linha.jato, 3);
    assert.equal(e.json().linha.quantidade, '14.0000');
  });
});

describe('implemento da linha de máquina', () => {
  test('só o de tipo "por jato" ganha `jato`; o outro, a forma de sempre', async () => {
    const { implementoPublico } = await import('../src/modules/atividades/atividadeComum.js');
    const base = { id: 'i1', numero: '9', codigo_frota: 'PV-01', nome: 'Pulverizador', natureza: 'IMPLEMENTO' };
    assert.deepEqual(implementoPublico({ ...base, tipo: { usa_produto: true, forma_produto: 'JATO', capacidade: '2000.0000', capacidade_unidade: 'L' } }), {
      id: 'i1', numero: '9', codigo_frota: 'PV-01', nome: 'Pulverizador', natureza: 'IMPLEMENTO', jato: { capacidade: '2000', unidade: 'L' },
    });
    assert.deepEqual(implementoPublico({ ...base, tipo: { usa_produto: false } }), { id: 'i1', numero: '9', codigo_frota: 'PV-01', nome: 'Pulverizador', natureza: 'IMPLEMENTO' });
    assert.equal(implementoPublico(null), null);
  });
});

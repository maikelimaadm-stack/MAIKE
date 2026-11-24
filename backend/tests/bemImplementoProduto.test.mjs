/**
 * D-PROD-297 (MAIKE-BEM-IMPLEMENTO-PRODUTO) — o produto do implemento no PRÓPRIO bem, contra PostgreSQL real e HTTP
 * autenticado (`app.inject`).
 *
 * - POST/PATCH do bem IMPLEMENTO aceitam `usa_produto`, `forma_produto` (JATO), `capacidade` (texto decimal) e
 *   `capacidade_unidade` (L | KG); a leitura devolve os quatro.
 * - Outro Tipo de bem com qualquer um deles (mesmo null) é 400 `so_implemento`; "Não" com capacidade é 400; "Sim" sem
 *   capacidade é 400; `usa_produto` fora de sim/não é 400. Nada é gravado.
 * - A lista de implementos e a linha de máquina tiram o tanque do BEM; sem marcação no bem (nulo), do tipo (como antes);
 *   o bem com "Não" não tem jato mesmo que o tipo diga "por jato".
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { montarLinhasCusto, prisma } from './atividadeLinhaCustoCenario.mjs';
import { corpoImplemento, corpoTrator } from './patrimonioP1Cenario.mjs';

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

const POR_JATO = { usa_produto: true, forma_produto: 'JATO', capacidade: '2000', capacidade_unidade: 'L' };

const montar = async () => {
  const s = await montarLinhasCusto(app);
  const criar = (extra) => s.H.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, { numero_serie: `PV-${Math.random().toString(36).slice(2, 8)}`, ...extra }));
  const patch = async (id, corpo) => {
    const atual = await prisma().bemPatrimonial.findUnique({ where: { id } });
    return s.H.req('PATCH', `/bens-patrimoniais/${id}`, s.token, { empresa_id: s.e1.id, versao: atual.versao, ...corpo });
  };
  const jatos = async () => {
    const lista = await s.H.ok(s.H.req('GET', `/atividades-opcoes/implementos?empresa_id=${s.e1.id}`, s.token));
    return Object.fromEntries(lista.itens.map((i) => [i.id, i.jato]));
  };
  return { ...s, criar, patch, jatos };
};

describe('bem implemento: o produto no cadastro', () => {
  test('criar "por jato" grava e devolve os quatro campos; a lista de implementos traz o tanque do bem', async () => {
    const s = await montar();
    const r = await s.criar({ nome: 'Pulverizador PV-01', ...POR_JATO });
    assert.equal(r.statusCode, 201, r.body);
    const b = r.json();
    assert.deepEqual([b.usa_produto, b.forma_produto, b.capacidade, b.capacidade_unidade], [true, 'JATO', '2000.0000', 'L']);
    const gravado = await prisma().bemPatrimonial.findUnique({ where: { id: b.id } });
    assert.equal(Number(gravado.capacidade), 2000);
    assert.deepEqual((await s.jatos())[b.id], { capacidade: '2000', unidade: 'L' });
    const detalhe = await s.H.ok(s.H.req('GET', `/bens-patrimoniais/${b.id}?empresa_id=${s.e1.id}`, s.token));
    assert.equal(detalhe.usa_produto, true);
    assert.equal(detalhe.capacidade_unidade, 'L');
  });

  test('editar: trocar a capacidade e a medida; "Não" limpa e tira o jato; repetir o mesmo não grava', async () => {
    const s = await montar();
    const b = await s.H.ok(s.criar({ nome: 'Pulverizador PV-02', ...POR_JATO }), 201);
    const e1 = await s.patch(b.id, { capacidade: '600', capacidade_unidade: 'KG' });
    assert.equal(e1.statusCode, 200, e1.body);
    assert.deepEqual([e1.json().capacidade, e1.json().capacidade_unidade], ['600.0000', 'KG']);
    assert.deepEqual((await s.jatos())[b.id], { capacidade: '600', unidade: 'KG' });
    const versao = (await prisma().bemPatrimonial.findUnique({ where: { id: b.id } })).versao;
    const igual = await s.patch(b.id, { capacidade: '600.0000' });
    assert.equal(igual.statusCode, 200, igual.body);
    assert.equal((await prisma().bemPatrimonial.findUnique({ where: { id: b.id } })).versao, versao, 'sem mudança, sem versão nova');
    const nao = await s.patch(b.id, { usa_produto: false, forma_produto: null, capacidade: null, capacidade_unidade: null });
    assert.equal(nao.statusCode, 200, nao.body);
    assert.deepEqual([nao.json().usa_produto, nao.json().forma_produto, nao.json().capacidade, nao.json().capacidade_unidade], [false, null, null, null]);
    assert.equal((await s.jatos())[b.id], null);
  });

  test('sem marcação no bem vale o tipo (como antes); o bem com "Não" vence o tipo "por jato"', async () => {
    const s = await montar();
    const p = prisma();
    await p.tipoPatrimonial.update({ where: { id: s.tip.ROCADEIRA }, data: { usa_produto: true, forma_produto: 'JATO', capacidade: '3000', capacidade_unidade: 'L' } });
    const herda = await s.H.ok(s.criar({ nome: 'Pulverizador do tipo' }), 201);
    const naoUsa = await s.H.ok(s.criar({ nome: 'Grade', usa_produto: false }), 201);
    const proprio = await s.H.ok(s.criar({ nome: 'Pulverizador próprio', ...POR_JATO }), 201);
    const j = await s.jatos();
    assert.deepEqual(j[herda.id], { capacidade: '3000', unidade: 'L' });
    assert.equal(j[naoUsa.id], null);
    assert.deepEqual(j[proprio.id], { capacidade: '2000', unidade: 'L' });
  });

  test('recusas (400, nada gravado): outro Tipo de bem, "Sim" sem capacidade, "Não" com capacidade, forma/unidade/usa inválidos', async () => {
    const s = await montar();
    const maq = await s.H.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { codigo_frota: 'TX-90', usa_produto: null }));
    assert.equal(maq.statusCode, 400, maq.body);
    assert.equal(maq.json().reason, 'so_implemento');
    const casos = [
      [{ usa_produto: true, forma_produto: 'JATO', capacidade_unidade: 'L' }, 'obrigatorio'],
      [{ usa_produto: false, capacidade: '10' }, 'sem_produto'],
      [{ ...POR_JATO, forma_produto: 'SACO' }, 'invalido'],
      [{ ...POR_JATO, capacidade_unidade: 'M3' }, 'invalido'],
      [{ ...POR_JATO, capacidade: '0' }, 'nao_positivo'],
      [{ ...POR_JATO, capacidade: '100000.5' }, 'acima_do_maximo'],
    ];
    for (const [extra, reason] of casos) {
      const r = await s.criar({ nome: 'Ruim', ...extra });
      assert.equal(r.statusCode, 400, `${JSON.stringify(extra)}: ${r.body}`);
      assert.equal(r.json().reason, reason, `${JSON.stringify(extra)}: ${r.body}`);
    }
    const texto = await s.criar({ nome: 'Ruim', usa_produto: 'sim' });
    assert.equal(texto.statusCode, 400, texto.body);
    assert.equal(await prisma().bemPatrimonial.count({ where: { cliente_id: s.c, nome: 'Ruim' } }), 0);
    const trator = await s.H.ok(s.H.req('POST', '/bens-patrimoniais', s.token, corpoTrator(s, { codigo_frota: 'TX-91' })), 201);
    const pm = await s.patch(trator.id, { capacidade: '10' });
    assert.equal(pm.statusCode, 400, pm.body);
    assert.equal(pm.json().reason, 'so_implemento');
  });
});

describe('implemento da linha de máquina: o tanque do bem', () => {
  test('o bem marcado decide; sem marcação, o tipo', async () => {
    const { implementoPublico } = await import('../src/modules/atividades/atividadeComum.js');
    const base = { id: 'i1', numero: '9', codigo_frota: 'PV-01', nome: 'Pulverizador', natureza: 'IMPLEMENTO' };
    const tipoJato = { usa_produto: true, forma_produto: 'JATO', capacidade: '3000.0000', capacidade_unidade: 'L' };
    assert.deepEqual(implementoPublico({ ...base, usa_produto: true, forma_produto: 'JATO', capacidade: '2000.0000', capacidade_unidade: 'KG', tipo: tipoJato }).jato, { capacidade: '2000', unidade: 'KG' });
    assert.equal('jato' in implementoPublico({ ...base, usa_produto: false, tipo: tipoJato }), false);
    assert.deepEqual(implementoPublico({ ...base, usa_produto: null, tipo: tipoJato }).jato, { capacidade: '3000', unidade: 'L' });
  });
});

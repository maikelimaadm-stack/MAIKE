/**
 * D-PROD-297 (MAIKE-BEM-IMPLEMENTO-PRODUTO) — o produto do implemento no PRÓPRIO bem, contra PostgreSQL real e HTTP
 * autenticado (`app.inject`).
 *
 * - POST/PATCH do bem IMPLEMENTO aceitam `usa_produto`, `forma_produto` (JATO), `capacidade` (texto decimal) e
 *   `capacidade_unidade` (L | KG); a leitura devolve os quatro.
 * - Outro Tipo de bem com qualquer um deles (mesmo null) é 400 `so_implemento`; "Não" com capacidade é 400; "Sim" sem
 *   capacidade é 400; `usa_produto` fora de sim/não é 400. Nada é gravado.
 *
 * D-PROD-383: a lista de implementos e a linha de máquina eram do Lançamento de Atividades e saíram com ele; o cadastro
 * do bem continua igual.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { corpoImplemento, corpoTrator, http, montarPatrimonio, prisma } from './patrimonioP1Cenario.mjs';

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
  const s = { ...(await montarPatrimonio(app)), H: http(app) };
  const criar = (extra) => s.H.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, { numero_serie: `PV-${Math.random().toString(36).slice(2, 8)}`, ...extra }));
  const patch = async (id, corpo) => {
    const atual = await prisma().bemPatrimonial.findUnique({ where: { id } });
    return s.H.req('PATCH', `/bens-patrimoniais/${id}`, s.token, { empresa_id: s.e1.id, versao: atual.versao, ...corpo });
  };
  return { ...s, criar, patch };
};

describe('bem implemento: o produto no cadastro', () => {
  test('criar "por jato" grava e devolve os quatro campos', async () => {
    const s = await montar();
    const r = await s.criar({ nome: 'Pulverizador PV-01', ...POR_JATO });
    assert.equal(r.statusCode, 201, r.body);
    const b = r.json();
    assert.deepEqual([b.usa_produto, b.forma_produto, b.capacidade, b.capacidade_unidade], [true, 'JATO', '2000.0000', 'L']);
    const gravado = await prisma().bemPatrimonial.findUnique({ where: { id: b.id } });
    assert.equal(Number(gravado.capacidade), 2000);
    const detalhe = await s.H.ok(s.H.req('GET', `/bens-patrimoniais/${b.id}?empresa_id=${s.e1.id}`, s.token));
    assert.equal(detalhe.usa_produto, true);
    assert.equal(detalhe.capacidade_unidade, 'L');
  });

  test('editar: trocar a capacidade e a medida; "Não" limpa; repetir o mesmo não grava', async () => {
    const s = await montar();
    const b = await s.H.ok(s.criar({ nome: 'Pulverizador PV-02', ...POR_JATO }), 201);
    const e1 = await s.patch(b.id, { capacidade: '600', capacidade_unidade: 'KG' });
    assert.equal(e1.statusCode, 200, e1.body);
    assert.deepEqual([e1.json().capacidade, e1.json().capacidade_unidade], ['600.0000', 'KG']);
    const versao = (await prisma().bemPatrimonial.findUnique({ where: { id: b.id } })).versao;
    const igual = await s.patch(b.id, { capacidade: '600.0000' });
    assert.equal(igual.statusCode, 200, igual.body);
    assert.equal((await prisma().bemPatrimonial.findUnique({ where: { id: b.id } })).versao, versao, 'sem mudança, sem versão nova');
    const nao = await s.patch(b.id, { usa_produto: false, forma_produto: null, capacidade: null, capacidade_unidade: null });
    assert.equal(nao.statusCode, 200, nao.body);
    assert.deepEqual([nao.json().usa_produto, nao.json().forma_produto, nao.json().capacidade, nao.json().capacidade_unidade], [false, null, null, null]);
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

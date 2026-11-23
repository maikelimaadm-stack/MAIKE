/**
 * D-PROD-279 (MAIKE-TIPO-IMPLEMENTO-PRODUTO) — "a máquina sozinha não leva
 * produto; quem leva é o implemento": o tipo de IMPLEMENTO diz se usa produto,
 * como conta (por jato) e a capacidade do jato. PostgreSQL real, HTTP
 * autenticado, prova por persistência.
 *
 *  T1. IMPLEMENTO aceita os campos no POST e no PATCH; a leitura (lista e
 *      detalhe) devolve; a capacidade vai com 4 casas; auditado.
 *  T2. MAQUINA (e qualquer outra natureza) → 400 com qualquer campo, mesmo
 *      null; nada gravado; a leitura devolve os quatro nulos.
 *  T3. Cada regra: forma obrigatória e só JATO; capacidade obrigatória, texto
 *      decimal, > 0, ≤ 100000, até 4 casas; unidade obrigatória, L ou KG.
 *  T4. Sem produto (false/null): mandar forma/capacidade/unidade preenchidas é
 *      400; usa_produto=false limpa as gravadas; PATCH parcial confere o
 *      estado final; CAS por versão continua.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, http, montarPatrimonio, prisma } from './patrimonioP1Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const req = (...a) => H.req(...a);
const ok = (...a) => H.ok(...a);
const JATO = Object.freeze({ usa_produto: true, forma_produto: 'JATO', capacidade: '2000', capacidade_unidade: 'L' });
const doBanco = (id) =>
  prisma().tipoPatrimonial.findUnique({ where: { id }, select: { usa_produto: true, forma_produto: true, capacidade: true, capacidade_unidade: true, versao: true } });
const NULOS = Object.freeze({ usa_produto: null, forma_produto: null, capacidade: null, capacidade_unidade: null });
const produtoDe = (t) => ({ usa_produto: t.usa_produto, forma_produto: t.forma_produto, capacidade: t.capacidade, capacidade_unidade: t.capacidade_unidade });

describe('T1 — IMPLEMENTO aceita e a leitura devolve', () => {
  test('POST com jato de 2000 L; detalhe e lista devolvem; PATCH troca a capacidade e a unidade; auditado', async () => {
    const s = await montarPatrimonio(app);
    const t = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Pulverizador de barra', ...JATO }), 201);
    assert.equal(t.natureza, 'IMPLEMENTO');
    assert.deepEqual(produtoDe(t), { usa_produto: true, forma_produto: 'JATO', capacidade: '2000.0000', capacidade_unidade: 'L' });
    assert.deepEqual(produtoDe(await ok(req('GET', `/patrimonio-tipos/${t.id}`, s.token))), produtoDe(t));
    const lista = (await ok(req('GET', '/patrimonio-tipos?natureza=IMPLEMENTO&limit=100', s.token))).items;
    assert.deepEqual(produtoDe(lista.find((x) => x.id === t.id)), produtoDe(t));
    for (const outro of lista.filter((x) => x.id !== t.id)) assert.deepEqual(produtoDe(outro), NULOS, 'tipo padrão nasce sem produto');

    const p = await ok(req('PATCH', `/patrimonio-tipos/${t.id}`, s.token, { versao: t.versao, capacidade: '600.5', capacidade_unidade: 'KG' }));
    assert.deepEqual(produtoDe(p), { usa_produto: true, forma_produto: 'JATO', capacidade: '600.5000', capacidade_unidade: 'KG' });
    assert.equal(p.versao, t.versao + 1);
    const ev = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'TipoPatrimonial', entidade_id: t.id, acao: 'update' } });
    assert.ok(ev, 'update auditado');
    assert.deepEqual(/** @type {any} */ (ev.dados_novos).campos_alterados, ['capacidade', 'capacidade_unidade']);

    // PATCH sem mudança efetiva não sobe a versão.
    const igual = await ok(req('PATCH', `/patrimonio-tipos/${t.id}`, s.token, { versao: p.versao, capacidade: '600.5000' }));
    assert.equal(igual.versao, p.versao);
    // Tipo de implemento sem os campos nasce nulo (a grade).
    const grade = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Grade aradora' }), 201);
    assert.deepEqual(produtoDe(grade), NULOS);
  });
});

describe('T2 — outra natureza recusa', () => {
  test('MAQUINA: POST e PATCH com qualquer campo (mesmo null) → 400 so_implemento; nada gravado; leitura nula', async () => {
    const s = await montarPatrimonio(app);
    for (const corpo of [JATO, { usa_produto: false }, { usa_produto: null }, { capacidade: '10' }, { forma_produto: null }]) {
      const r = await req('POST', '/patrimonio-tipos', s.token, { natureza: 'MAQUINA', nome: 'Trator X', ...corpo });
      assert.deepEqual(erro(r).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], r.body);
      assert.equal(r.json().reason, 'so_implemento', r.body);
    }
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c, nome: 'Trator X' } }), 0);
    const m = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'MAQUINA', nome: 'Trator X' }), 201);
    assert.deepEqual(produtoDe(m), NULOS);
    const r = await req('PATCH', `/patrimonio-tipos/${m.id}`, s.token, { versao: m.versao, usa_produto: true });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().reason, 'so_implemento');
    assert.deepEqual({ ...(await doBanco(m.id)) }, { ...NULOS, versao: m.versao });
    for (const natureza of ['VEICULO', 'EQUIPAMENTO', 'BENFEITORIA', 'OUTRO']) {
      const x = await req('POST', '/patrimonio-tipos', s.token, { natureza, nome: `N ${natureza}`, usa_produto: false });
      assert.equal(x.statusCode, 400, `${natureza}: ${x.body}`);
    }
  });
});

describe('T3 — cada regra com produto', () => {
  test('forma, capacidade e unidade obrigatórias e no domínio; nada gravado', async () => {
    const s = await montarPatrimonio(app);
    const casos = [
      [{ ...JATO, forma_produto: undefined }, 'forma_produto', 'obrigatorio'],
      [{ ...JATO, forma_produto: null }, 'forma_produto', 'obrigatorio'],
      [{ ...JATO, forma_produto: 'SACO' }, 'forma_produto', 'invalido'],
      [{ ...JATO, forma_produto: 'jato' }, 'forma_produto', 'invalido'],
      [{ ...JATO, capacidade: undefined }, 'capacidade', 'obrigatorio'],
      [{ ...JATO, capacidade: '0' }, 'capacidade', 'nao_positivo'],
      [{ ...JATO, capacidade: '-5' }, 'capacidade', 'formato'],
      [{ ...JATO, capacidade: '100000.0001' }, 'capacidade', 'acima_do_maximo'],
      [{ ...JATO, capacidade: '1.23456' }, 'capacidade', 'formato'],
      [{ ...JATO, capacidade: '2.000,5' }, 'capacidade', 'formato'],
      [{ ...JATO, capacidade: 2000 }, 'capacidade', 'valor_deve_ser_texto'],
      [{ ...JATO, capacidade_unidade: undefined }, 'capacidade_unidade', 'obrigatorio'],
      [{ ...JATO, capacidade_unidade: 'SACO' }, 'capacidade_unidade', 'invalido'],
      [{ ...JATO, capacidade_unidade: 'l' }, 'capacidade_unidade', 'invalido'],
      [{ ...JATO, usa_produto: 'true' }, 'usa_produto', 'formato'],
    ];
    for (const [extra, field, reason] of casos) {
      const r = await req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Pulverizador', ...extra });
      assert.deepEqual(erro(r), [400, 'REQUEST_VALIDATION_FAILED', field, reason], `${JSON.stringify(extra)} → ${r.body}`);
    }
    assert.equal(await prisma().tipoPatrimonial.count({ where: { cliente_id: s.c, nome: 'Pulverizador' } }), 0);
    // Limites aceitos.
    const max = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Tanque grande', ...JATO, capacidade: '100000' }), 201);
    assert.equal(max.capacidade, '100000.0000');
    const min = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Costal', ...JATO, capacidade: '0.0001' }), 201);
    assert.equal(min.capacidade, '0.0001');
  });
});

describe('T4 — sem produto limpa; PATCH confere o estado final', () => {
  test('usa_produto=false/null com campos preenchidos → 400; false limpa as gravadas; PATCH parcial; CAS', async () => {
    const s = await montarPatrimonio(app);
    for (const usa of [false, null]) {
      const r = await req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Grade', usa_produto: usa, capacidade: '10' });
      assert.deepEqual(erro(r), [400, 'REQUEST_VALIDATION_FAILED', 'capacidade', 'sem_produto'], r.body);
    }
    const nao = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Grade', usa_produto: false, forma_produto: null, capacidade: null, capacidade_unidade: null }), 201);
    assert.deepEqual(produtoDe(nao), { ...NULOS, usa_produto: false });

    const t = await ok(req('POST', '/patrimonio-tipos', s.token, { natureza: 'IMPLEMENTO', nome: 'Pulverizador', ...JATO }), 201);
    // PATCH só usa_produto=false: limpa os três gravados.
    const limpo = await ok(req('PATCH', `/patrimonio-tipos/${t.id}`, s.token, { versao: t.versao, usa_produto: false }));
    assert.deepEqual(produtoDe(limpo), { ...NULOS, usa_produto: false });
    assert.deepEqual({ ...(await doBanco(t.id)) }, { ...NULOS, usa_produto: false, versao: t.versao + 1 });
    // PATCH só usa_produto=true sem os outros → o estado final não tem forma → 400.
    const falta = await req('PATCH', `/patrimonio-tipos/${t.id}`, s.token, { versao: limpo.versao, usa_produto: true });
    assert.deepEqual(erro(falta), [400, 'REQUEST_VALIDATION_FAILED', 'forma_produto', 'obrigatorio']);
    // PATCH com false e capacidade preenchida → 400.
    const misto = await req('PATCH', `/patrimonio-tipos/${t.id}`, s.token, { versao: limpo.versao, usa_produto: false, capacidade: '5' });
    assert.deepEqual(erro(misto), [400, 'REQUEST_VALIDATION_FAILED', 'capacidade', 'sem_produto']);
    // De volta com produto; depois null também limpa.
    const volta = await ok(req('PATCH', `/patrimonio-tipos/${t.id}`, s.token, { versao: limpo.versao, ...JATO, capacidade: '1500.25' }));
    assert.equal(volta.capacidade, '1500.2500');
    const nulo = await ok(req('PATCH', `/patrimonio-tipos/${t.id}`, s.token, { versao: volta.versao, usa_produto: null }));
    assert.deepEqual(produtoDe(nulo), NULOS);
    // CAS: versão velha → 409 e nada muda.
    const velha = await req('PATCH', `/patrimonio-tipos/${t.id}`, s.token, { versao: volta.versao, ...JATO });
    assert.equal(velha.statusCode, 409, velha.body);
    assert.deepEqual(produtoDe(await ok(req('GET', `/patrimonio-tipos/${t.id}`, s.token))), NULOS);
  });
});

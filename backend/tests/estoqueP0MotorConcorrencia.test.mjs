/**
 * D-PROD-161 — Estoque P0 (fatia F1): CONCORRÊNCIA do motor físico único.
 * PostgreSQL real, HTTP autenticado, prova pelas linhas gravadas e por
 * `pg_locks`/`pg_blocking_pids` (nunca por relógio).
 *
 *  K1. 5 rodadas de compra × venda × suplementação × transferência ×
 *      abastecimento × estornos (venda e abastecimento da rodada anterior) no
 *      MESMO produto: nunca 500, nenhum deadlock, invariantes, numeração limpa,
 *      conservação exata (a transferência soma 0);
 *  K2. a sequência de movimentos é reservada NO FIM: com a suplementação do
 *      produto A parada antes do INSERT do movimento (e a transferência de A
 *      parada antes do lote de destino), o comando do produto B conclui;
 *  K3. CAS no lote: um escritor fora do protocolo muda o lote no meio da
 *      suplementação → 409 CONCURRENCY_CONFLICT e nada gravado;
 *  K4. ordem canônica local → produto: a suplementação que espera o local
 *      (DELETE em curso) ainda não segura o produto (a venda do mesmo produto
 *      em outro local conclui).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, foto, loteLegado, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import { acoesAbastecimento, corpoAbastecimento, montarAbastecimento, opId as opIdAb } from './patrimonioP1AbastecimentoCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let AB;
/** Pool PRÓPRIO do teste (portões e observação de `pg_locks`); os comandos usam o pool do app. @type {PrismaClient} */
let aux;
let deadlocksAntes = 0n;
const deadlocks = async () => /** @type {any[]} */ (await aux.$queryRaw`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`)[0].deadlocks;

before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
  AB = acoesAbastecimento(app);
  aux = new PrismaClient();
  deadlocksAntes = await deadlocks();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});

// ─── portão e observação de travas (par de advisory próprio: 162, 1) ─────────
const PORTAO = 'p0f1_portao';
const instalarPortao = async (s, tabela, condicao = 'TRUE') => {
  const p = prisma();
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(162, 1); RETURN NEW; END $f$`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
  await p.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} BEFORE INSERT ON "${tabela}" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND ${condicao}) EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = (tabela) => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(162, 1)`;
    return fn();
  }, { maxWait: 10000, timeout: 60000 });
const paradosNoPortao = async () => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 162 AND objid = 1 AND objsubid = 2 AND NOT granted`);
  return l.length ? l.map((r) => r.pid) : null;
};
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const acompanhar = (pedido) => {
  const t0 = Date.now();
  /** @type {{ feito: boolean, r: any, ms: number, p: Promise<any> }} */
  const a = { feito: false, r: null, ms: 0, p: Promise.resolve() };
  a.p = Promise.resolve(pedido).then((r) => {
    Object.assign(a, { feito: true, r, ms: Date.now() - t0 });
    return r;
  });
  return a;
};
const corpoDe = (r) => {
  try {
    return r.json();
  } catch {
    return null;
  }
};
const resumo = (a) => (a.feito ? `${a.r.statusCode} ${corpoDe(a.r)?.code ?? ''} em ${a.ms} ms` : 'ainda esperando');

// ─── apoio ──────────────────────────────────────────────────────────────────
const D = (v) => new Prisma.Decimal(v);
const q4 = (v) => D(v).toFixed(4);
const URL_SUP = '/movimentacoes-estoque/comandos/saida-suplementacao';
const URL_TRANSF = '/movimentacoes-estoque/comandos/transferencia-locais';
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const definirEstoqueAtual = (produto, kg) => prisma().produto.update({ where: { id: produto.id }, data: { estoque_atual: kg } });
const somaDisponivel = async (where) => {
  const r = await prisma().estoqueLoteNota.aggregate({ _sum: { quantidade_disponivel: true }, where: { status: 'Disponivel', ...where } });
  return r._sum.quantidade_disponivel ? D(r._sum.quantidade_disponivel) : D(0);
};
/** Invariantes (a), (b), (c) do tenant + numeração limpa (sem `p-…`, números únicos). */
const conferirInvariantes = async (s, rotulo) => {
  const p = prisma();
  const produtos = await p.produto.findMany({ where: { cliente_id: s.c }, select: { id: true, empresa_id: true, estoque_atual: true } });
  const lotes = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c } });
  for (const prod of produtos) {
    const soma = lotes.filter((l) => l.produto_id === prod.id && l.empresa_id === prod.empresa_id && l.status === 'Disponivel').reduce((t, l) => t.plus(D(l.quantidade_disponivel)), D(0));
    assert.equal(D(prod.estoque_atual).toFixed(4), soma.toFixed(4), `${rotulo}: (a) produto ${prod.id}`);
  }
  const porLocal = new Map();
  for (const l of lotes) {
    const k = `${l.empresa_id}|${l.produto_id}|${l.local_estoque_id}`;
    porLocal.set(k, (porLocal.get(k) ?? D(0)).plus(D(l.quantidade_disponivel)));
    const disp = D(l.quantidade_disponivel);
    assert.ok(disp.gte(0) && disp.lte(D(l.quantidade_entrada)), `${rotulo}: (c) lote ${l.id}`);
    if (disp.gt(0)) assert.equal(l.status, 'Disponivel', `${rotulo}: (c) lote ${l.id}`);
    else assert.ok(['Esgotado', 'Estornado'].includes(l.status), `${rotulo}: (c) lote ${l.id} ${l.status}`);
  }
  for (const [k, v] of porLocal) assert.ok(v.gte(0), `${rotulo}: (b) ${k} = ${v}`);
  const ns = (await p.movimentacaoEstoque.findMany({ where: { cliente_id: s.c }, select: { numero_movimentacao: true } })).map((m) => m.numero_movimentacao);
  assert.deepEqual(ns.filter((n) => !/^\d+$/.test(n)), [], `${rotulo}: nenhum movimento commitado com número provisório`);
  assert.equal(new Set(ns).size, ns.length, `${rotulo}: números de movimento únicos`);
};
const aceito = (r) => [200, 201, 422].includes(r.statusCode) || (r.statusCode === 409 && corpoDe(r)?.code === 'CONCURRENCY_CONFLICT');
/** D-PROD-314 — só o último sai: um estorno com registro lançado depois no depósito recebe 409 registro posterior (legítimo). */
const recusaPosterior = (r) => r.statusCode === 409 && corpoDe(r)?.code === 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR';
const aceitoNoEstorno = (r) => aceito(r) || recusaPosterior(r);

// ─── P3 no tenant do abastecimento ──────────────────────────────────────────
const prepararP3 = async (s) => {
  if (s.p3) return s.p3;
  const p = prisma();
  const base = { cliente_id: s.c, empresa_id: s.e1.id };
  const m = randomUUID().slice(0, 6);
  await A.ok(A.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  s.p3 = {
    forn: await p.fornecedor.create({ data: { ...base, numero_cadastro: `KF-${m}`, tipo_pessoa: 'Jurídica', nome: `POSTO ${m}`, tipos: ['fornecedor'] } }),
    cli: await p.fornecedor.create({ data: { ...base, numero_cadastro: `KC-${m}`, tipo_pessoa: 'Jurídica', nome: `VIZINHO ${m}`, tipos: ['cliente'] } }),
    desp: await p.naturezaFinanceira.create({ data: { ...base, numero: `KD${m}`, tipo: 'DESPESA', nome: `COMBUSTIVEL ${m}` } }),
    rec: await p.naturezaFinanceira.create({ data: { ...base, numero: `KR${m}`, tipo: 'RECEITA', nome: `REVENDA ${m}` } }),
  };
  return s.p3;
};
const rascunhoP3 = async (s, direcao, kg, preco) => {
  const e = await prepararP3(s);
  const total = D(kg).times(D(preco)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  return A.ok(A.req('POST', '/operacoes-financeiras', s.token, {
    empresa_id: s.e1.id, direcao, conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: (direcao === 'PAGAR' ? e.forn : e.cli).id, data_emissao: '2027-06-10', data_operacional: '2027-06-10',
    efeito_fisico_confirmado: true,
    // D-PROD-162: o diesel do cenário é Produto em L → o item da P3 vai em L (sem fator).
    itens: [{ tipo_item: 'MERCADORIA', produto_id: s.diesel.id, local_estoque_id: s.local.id, unidade: s.diesel.unidade_principal_estoque === 'L' ? 'L' : 'KG', quantidade: kg, valor_unitario: preco }],
    rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: (direcao === 'PAGAR' ? e.desp : e.rec).id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
    operation_id: opId(),
  }), 201);
};
const confirmarP3 = (s, d) => A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), versao: d.versao });
const cancelarP3 = (s, d) => A.req('POST', `/operacoes-financeiras/${d.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'corrida K1' });
const corpoGerador = (s, extra = {}) => corpoAbastecimento(s, { bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, medidor_leitura: null, ...extra });

// ─────────────────────────────────────────────────────────────────────────────
describe('K1 — compra × venda × suplementação × transferência × abastecimento × estornos no mesmo produto', () => {
  test('5 rodadas em paralelo: só 200/201/422/409 CONCURRENCY_CONFLICT (nos estornos também 409 ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR, D-PROD-314; nunca 500), nenhum deadlock, invariantes, numeração limpa e conservação exata', async () => {
    const s = await montarAbastecimento(app);
    const p = prisma();
    const inicial = await somaDisponivel({ cliente_id: s.c, produto_id: s.diesel.id });
    assert.equal(inicial.toFixed(4), await estoqueAtual(s.diesel));
    const kgAbast = D('10'); // 10 L do Produto em L (D-PROD-162: o abastecimento baixa a quantidade digitada, sem fator)
    let esperado = inicial;
    /** @type {any} */ let vendaAnterior = null;
    /** @type {any} */ let abastAnterior = null;
    const todos = [];
    for (let rodada = 0; rodada < 5; rodada += 1) {
      const compra = await rascunhoP3(s, 'PAGAR', '10', '5.00');
      const venda = await rascunhoP3(s, 'RECEBER', '5', '9.00');
      const pedidos = [
        ['compra', () => confirmarP3(s, compra)],
        ['venda', () => confirmarP3(s, venda)],
        ['suplementação', () => A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: s.e1.id, produto_id: s.diesel.id, local_origem_id: s.local.id, quantidade: 2 })],
        ['transferência', () => A.req('POST', URL_TRANSF, s.token, {
          operation_id: opId(), empresa_id: s.e1.id, produto_id: s.diesel.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 3,
        })],
        ['abastecimento', () => AB.confirmar(s.operador.token, corpoGerador(s, { quantidade: '10', operation_id: opIdAb() }))],
        ...(vendaAnterior ? [['estorno da venda anterior', () => cancelarP3(s, vendaAnterior)]] : []),
        ...(abastAnterior ? [['estorno do abastecimento anterior', () => AB.cancelar(s.contaCancelar.token, abastAnterior.id, { empresa_id: s.e1.id, versao: 1, motivo: 'corrida K1', operation_id: opIdAb() })]] : []),
      ];
      const rs = await Promise.all(pedidos.map(([, f]) => f()));
      const tabela = pedidos.map(([nome], k) => `${nome}: ${rs[k].statusCode} ${corpoDe(rs[k])?.code ?? ''}`).join('\n');
      pedidos.forEach(([nome], k) => {
        const r = rs[k];
        const estorno = nome.startsWith('estorno');
        assert.ok(estorno ? aceitoNoEstorno(r) : aceito(r), `rodada ${rodada}: resposta fora do contrato\n${tabela}\n${r.body}`);
      });
      // D-PROD-314: o estorno recusado pelo registro posterior não grava nada — o documento continua valendo
      const k6 = pedidos.findIndex(([nome]) => nome === 'estorno da venda anterior');
      if (k6 >= 0 && recusaPosterior(rs[k6])) assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: vendaAnterior.id } })).status, vendaAnterior.status, `rodada ${rodada}: a venda anterior continua`);
      const k7 = pedidos.findIndex(([nome]) => nome === 'estorno do abastecimento anterior');
      if (k7 >= 0 && recusaPosterior(rs[k7])) assert.equal((await p.abastecimentoBem.findUnique({ where: { id: abastAnterior.id } })).status, abastAnterior.status, `rodada ${rodada}: o abastecimento anterior continua`);
      todos.push(...rs);
      const ok = Object.fromEntries(pedidos.map(([nome], k) => [nome, rs[k].statusCode < 300]));
      if (ok.compra) esperado = esperado.plus(10);
      if (ok.venda) esperado = esperado.minus(5);
      if (ok['suplementação']) esperado = esperado.minus(2);
      if (ok.abastecimento) esperado = esperado.minus(kgAbast);
      if (ok['estorno da venda anterior']) esperado = esperado.plus(5);
      if (ok['estorno do abastecimento anterior']) esperado = esperado.plus(kgAbast);
      vendaAnterior = ok.venda ? rs[1].json() : null;
      abastAnterior = ok.abastecimento ? rs[4].json() : null;
      assert.equal((await somaDisponivel({ cliente_id: s.c, produto_id: s.diesel.id })).toFixed(4), esperado.toFixed(4), `rodada ${rodada}: Δ Σ lotes = compras − vendas − supl − abast + estornos\n${tabela}`);
      await conferirInvariantes(s, `rodada ${rodada}`);
    }
    assert.ok(todos.filter((r) => r.statusCode < 300).length >= 25, 'a maioria dos comandos passa');
    assert.equal(await estoqueAtual(s.diesel), esperado.toFixed(4));
    const transferido = await somaDisponivel({ cliente_id: s.c, produto_id: s.diesel.id, local_estoque_id: s.local2.id });
    const transferencias = await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: 'transferencia_recebida' } });
    assert.equal(transferido.toFixed(4), D(3).times(transferencias).toFixed(4), 'o local 2 recebeu exatamente o que foi transferido');
    assert.equal(await deadlocks(), deadlocksAntes, 'pg_stat_database.deadlocks não mudou');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K2 — a sequência de movimentos é reservada no FIM', () => {
  const comandoDeBConcluiCom = async (s, portao, primeiro, segundo) => {
    await instalarPortao(s, portao.tabela, portao.condicao);
    /** @type {any[]} */ const pend = [];
    /** @type {any} */ let a;
    /** @type {any} */ let b;
    try {
      await comPortaoFechado(async () => {
        a = acompanhar(primeiro());
        pend.push(a);
        const [pid] = await esperar(async () => (a.feito ? [null] : paradosNoPortao()), 'primeiro parado no portão');
        assert.equal(a.feito, false, `o primeiro tinha de parar no portão: ${resumo(a)} ${a.r?.body}`);
        b = acompanhar(segundo());
        pend.push(b);
        await esperar(async () => b.feito || (await bloqueadosPor(pid)).length > 0, 'segundo concluindo ou esperando o primeiro');
        assert.equal(b.feito, true, `o comando do produto B não pode esperar o do produto A (sequência reservada no meio): ${resumo(b)}`);
      });
    } finally {
      await Promise.allSettled(pend.map((x) => x.p));
      await removerPortao(portao.tabela);
    }
    return { r1: a.r, r2: b.r };
  };

  test('suplementação do produto A parada antes do INSERT do movimento → a transferência do produto B conclui; transferência de A parada antes do lote de destino → a suplementação de B conclui', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    for (const prod of [e.sal, e.milho]) {
      await loteLegado(s, e, prod, s.local, { kg: '100', custo: '1.0000', dia: '2027-05-01' });
      await definirEstoqueAtual(prod, '100');
    }
    const sup = (prod) => A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: prod.id, local_origem_id: s.local.id, quantidade: 1 });
    const transf = (prod) => A.req('POST', URL_TRANSF, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: prod.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 1 });
    const c1 = await comandoDeBConcluiCom(s, { tabela: 'MovimentacaoEstoque', condicao: `NEW.tipo_detalhado = 'suplementacao'` }, () => sup(e.sal), () => transf(e.milho));
    assert.deepEqual([c1.r1.statusCode, c1.r2.statusCode], [201, 201], `${c1.r1.body}\n${c1.r2.body}`);
    const c2 = await comandoDeBConcluiCom(s, { tabela: 'EstoqueLoteNota', condicao: 'NEW.movimentacao_entrada_id IS NOT NULL' }, () => transf(e.sal), () => sup(e.milho));
    assert.deepEqual([c2.r1.statusCode, c2.r2.statusCode], [201, 201], `${c2.r1.body}\n${c2.r2.body}`);
    // a ordem dos números segue a ordem de commit: B (que concluiu antes) tem número menor que A
    const n = (r, chave) => BigInt(r.json()[chave].numero_movimentacao);
    assert.ok(n(c1.r2, 'movimentacao_saida') < n(c1.r1, 'movimentacao'), 'transferência de B numerada antes da suplementação de A');
    assert.ok(n(c2.r2, 'movimentacao') < n(c2.r1, 'movimentacao_saida'), 'suplementação de B numerada antes da transferência de A');
    await conferirInvariantes(s, 'K2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K3 — CAS no lote (escritor fora do protocolo no meio da suplementação)', () => {
  test('um gatilho tira 1 kg do lote no INSERT do movimento da suplementação (mesma transação) → 409 CONCURRENCY_CONFLICT, nada gravado; sem o gatilho, a suplementação passa', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const l = await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '10');
    const FN = 'p0f1_escritor_fora';
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${FN}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
      UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1
       WHERE cliente_id = NEW.cliente_id AND produto_id = NEW.produto_id AND local_estoque_id = NEW.local_estoque_origem AND status = 'Disponivel';
      RETURN NEW; END $f$`);
    const antes = await foto([s.c]);
    try {
      await p.$executeRawUnsafe(`CREATE TRIGGER ${FN} AFTER INSERT ON "MovimentacaoEstoque" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND NEW.tipo_detalhado = 'suplementacao') EXECUTE FUNCTION ${FN}()`);
      const r = await A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, quantidade: 4 });
      assert.deepEqual([r.statusCode, codigo(r)], [409, 'CONCURRENCY_CONFLICT'], r.body);
      assert.equal(r.json().details?.lote_id, l.id);
      assert.equal(await foto([s.c]), antes, 'nada gravado (nem o escritor de fora)');
    } finally {
      await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${FN} ON "MovimentacaoEstoque"`);
      await p.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FN}()`);
    }
    const ok = await A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, quantidade: 4 });
    assert.equal(ok.statusCode, 201, ok.body);
    assert.deepEqual([q4((await p.estoqueLoteNota.findUnique({ where: { id: l.id } })).quantidade_disponivel), await estoqueAtual(e.sal)], ['6.0000', '6.0000']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('K4 — ordem canônica: LocalEstoque (FOR KEY SHARE) antes do produto', () => {
  test('com o local travado por um DELETE em curso, a suplementação espera o LOCAL sem segurar o produto: a venda do mesmo produto em outro local conclui; soltando o local, a suplementação passa', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '50', custo: '1.0000', dia: '2027-05-01' });
    await loteLegado(s, e, e.sal, s.local2, { kg: '50', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '100');
    const venda = await A.criar(s.token, docCom(e, s.local2, [{ produto: e.sal, quantidade: '5', valor_unitario: '9' }], { direcao: 'RECEBER' }));
    /** @type {any} */ let sup;
    /** @type {any} */ let v;
    try {
      await aux.$transaction(async (tx) => {
        const [{ pid }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
        await tx.$queryRaw`SELECT id FROM "LocalEstoque" WHERE cliente_id = ${s.c} AND id = ${s.local.id} FOR UPDATE`;
        sup = acompanhar(A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, quantidade: 3 }));
        await esperar(async () => sup.feito || (await bloqueadosPor(pid)).length > 0, 'suplementação chegando no local');
        assert.equal(sup.feito, false, `a suplementação tem de esperar o local travado: ${resumo(sup)} ${sup.r?.body}`);
        v = acompanhar(A.confirmarReq(s.token, venda, e.id));
        await esperar(() => v.feito, 'venda do mesmo produto em outro local concluindo sem esperar a suplementação');
        assert.equal(sup.feito, false, 'a suplementação continua esperando o local');
      }, { maxWait: 10000, timeout: 30000 });
    } finally {
      await Promise.allSettled([sup?.p, v?.p].filter(Boolean));
    }
    assert.equal(v.r.statusCode, 200, v.r.body);
    assert.equal(sup.r.statusCode, 201, sup.r.body);
    assert.equal(await estoqueAtual(e.sal), '92.0000');
    await conferirInvariantes(s, 'K4');
  });
});

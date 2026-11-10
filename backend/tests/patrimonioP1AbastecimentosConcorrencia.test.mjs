/**
 * D-PROD-159 — Patrimônio P1-02: abastecimento × concorrência (C1–C11 do
 * contrato §9.1). PostgreSQL real, HTTP autenticado, prova por linhas gravadas.
 *
 * Corridas DETERMINÍSTICAS, no padrão de `gestaoP3Concorrencia.test.mjs`:
 *  - "portão": gatilho temporário (BEFORE INSERT/UPDATE, só do tenant do teste)
 *    que espera o advisory lock (159, 2) segurado por uma transação do TESTE.
 *    O comando para EXATAMENTE no ponto do efeito, com as travas dele já
 *    tomadas, até o teste abrir o portão. Para segurar o abastecimento: o
 *    INSERT do movimento com `NEW.origem_sistema = 'abastecimento_patrimonio'`;
 *  - quem espera quem é lido em `pg_locks`/`pg_blocking_pids`, nunca inferido
 *    por relógio. A única espera por relógio é o CENÁRIO de C9 (trava segura
 *    além do `lock_timeout` de 8 s): o comportamento testado É esse corte.
 *
 * Ordem REAL de travas do serviço (conferida no código e nas corridas abaixo):
 *   confirmar: R1 recibo → R2 Empresa FOR SHARE → R3 Bem FOR UPDATE → R5 advisory
 *     do vínculo → R6 TipoCombustivel KEY SHARE → R7 LocalEstoque KEY SHARE →
 *     R8 advisory estoque:produto + Produto FOR UPDATE → (leituras) → R10
 *     movimento (nº provisório) → R9 lotes (CAS) → R12a nº do abastecimento →
 *     R11 linha + fatias → R12b nº do movimento → R13 auditoria → recibo;
 *   cancelar: R1 → R2 → (leitura) → R3 Bem → R4 linha FOR UPDATE → R8 →
 *     movimento original FOR UPDATE → R10 estorno → R9 lotes → R11 → R12 → R13.
 *
 *  C1  mesma operation_id em paralelo (e payload divergente)
 *  C2  chaves diferentes, saldo para um só (mesmo bem e bens diferentes)
 *  C3  × venda P3 (P3-01) do mesmo produto, nas duas ordens
 *  C4  × cancelamento/retificação (P3-01/P3-03) de compra; × exclusão de venda e duplicar
 *  C5  × suplementação (comando antigo)
 *  C6  × PATCH do bem (tanque inativado; ajuste de medidor vê o piso novo)
 *  C7  × troca de fator (A14) e × situação do vínculo
 *  C8  confirmar × cancelar; cancelar × cancelar
 *  C9  P3 longa segurando o produto → 409 em ≈ 8 s; repetir com a MESMA chave conclui
 *  C10 × PATCH administrativo de lote (produto → lote; sem saldo fantasma)
 *  C11 numeração: sequência de movimentos reservada no fim; nunca commita `p-…`
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, corpoAbastecimento, corpoPrevia, erro, montarAbastecimento, opId, prisma } from './patrimonioP1AbastecimentoCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
/** Pool PRÓPRIO do teste (portões e observação de `pg_locks`); os comandos usam o pool do app. @type {PrismaClient} */
let aux;
/** Deadlocks do banco no início do arquivo (prova suplementar de "sem 40P01"). */
let deadlocksAntes = 0n;
const deadlocks = async () => /** @type {any[]} */ (await aux.$queryRaw`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`)[0].deadlocks;

before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoesAbastecimento(app);
  aux = new PrismaClient();
  deadlocksAntes = await deadlocks();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});

// ─── portão e observação de travas ──────────────────────────────────────────
const PORTAO = 'p102c_portao';
/** Gatilho BEFORE `evento` que segura a linha (só do tenant do teste) até o teste abrir o portão. */
const instalarPortao = async (s, tabela, condicao = 'TRUE', evento = 'INSERT') => {
  const p = prisma();
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(159, 2); RETURN NEW; END $f$`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
  await p.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} BEFORE ${evento} ON "${tabela}" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND ${condicao}) EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = (tabela) => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
/** Portão fechado (lock exclusivo numa transação do TESTE) enquanto `fn(pidDoPortao)` roda; abre no fim. */
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    const [{ pid }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(159, 2)`;
    return fn(pid);
  }, { maxWait: 10000, timeout: 60000 });
const paradosNoPortao = async () => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 159 AND objid = 2 AND objsubid = 2 AND NOT granted`);
  return l.length ? l.map((r) => r.pid) : null;
};
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
/** Espera uma CONDIÇÃO observável (nunca um tempo fixo); estoura com rótulo. */
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 15));
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

/**
 * Corrida determinística: `primeiro()` para no portão (gatilho em `portao.tabela`)
 * com as travas dele tomadas; `segundo()` chega e, com `segundoEspera`, TEM de
 * ficar bloqueado pelo pid do primeiro (lido em `pg_blocking_pids`); com
 * `segundoEspera: false`, TEM de concluir sem esperar. O portão abre e as duas
 * respostas voltam. `segundoEspera: null` = qualquer dos dois (informativo).
 * @returns {Promise<{ r1: any, r2: any, esperou: boolean }>}
 */
const corrida = async (s, portao, primeiro, segundo, { segundoEspera = true } = {}) => {
  await instalarPortao(s, portao.tabela, portao.condicao, portao.evento);
  /** @type {any[]} */
  const pend = [];
  /** @type {any} */ let a;
  /** @type {any} */ let b;
  let esperou = false;
  try {
    await comPortaoFechado(async () => {
      a = acompanhar(primeiro());
      pend.push(a);
      const [pid] = await esperar(async () => (a.feito ? [null] : paradosNoPortao()), 'primeiro parado no portão');
      assert.equal(a.feito, false, `o primeiro tinha de parar no portão: ${resumo(a)} ${a.r?.body}`);
      b = acompanhar(segundo());
      pend.push(b);
      if (segundoEspera === false) {
        await esperar(() => b.feito, 'segundo concluindo sem esperar o primeiro');
        return;
      }
      await esperar(async () => b.feito || (esperou = (await bloqueadosPor(pid)).length > 0), 'segundo chegando nas travas do primeiro');
      if (segundoEspera === true) assert.equal(b.feito, false, `o segundo não pode passar pelo primeiro: ${resumo(b)} ${b.r?.body}`);
    });
  } finally {
    await Promise.allSettled(pend.map((x) => x.p));
    await removerPortao(portao.tabela);
  }
  return { r1: a.r, r2: b.r, esperou };
};

const NO_MOVIMENTO_DO_ABASTECIMENTO = { tabela: 'MovimentacaoEstoque', condicao: `NEW.origem_sistema = 'abastecimento_patrimonio'` };
const NO_ESTORNO_DO_ABASTECIMENTO = { tabela: 'MovimentacaoEstoque', condicao: `NEW.origem_sistema = 'abastecimento_patrimonio' AND NEW.tipo_detalhado = 'estorno_abastecimento'` };
const NO_MOVIMENTO_DO_P3 = { tabela: 'MovimentacaoEstoque', condicao: `NEW.origem_sistema = 'operacao_financeira'` };

// ─── leituras do banco ──────────────────────────────────────────────────────
const p4 = (v) => (v === null || v === undefined ? null : v.toFixed(4));
const estoqueAtual = async (produto) => p4((await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual);
const somaLotes = async (s, produto, extra = {}) => {
  const r = await prisma().estoqueLoteNota.aggregate({ _sum: { quantidade_disponivel: true }, where: { cliente_id: s.c, produto_id: produto.id, status: 'Disponivel', ...extra } });
  return p4(r._sum.quantidade_disponivel) ?? '0.0000';
};
const loteKg = async (id) => {
  const l = await prisma().estoqueLoteNota.findUnique({ where: { id } });
  return `${p4(l.quantidade_disponivel)} ${l.status}`;
};
const fatiasDe = async (abastecimentoId) =>
  (await prisma().abastecimentoBemConsumoLote.findMany({ where: { abastecimento_id: abastecimentoId }, orderBy: { ordem: 'asc' } })).map((f) => [f.estoque_lote_nota_id, p4(f.quantidade)]);
const contar = (s, modelo, where = {}) => /** @type {any} */ (prisma())[modelo].count({ where: { cliente_id: s.c, ...where } });
/** Σ lotes Disponivel = estoque_atual (nenhum saldo negativo, nenhum lost update). */
const coerente = async (s, produto, rotulo) => {
  const [lotes, atual] = [await somaLotes(s, produto), await estoqueAtual(produto)];
  assert.equal(lotes, atual, `${rotulo}: Σ lotes Disponivel = estoque_atual`);
  assert.ok(!atual.startsWith('-'), `${rotulo}: estoque nunca negativo (${atual})`);
  const negativos = await contar(s, 'estoqueLoteNota', { quantidade_disponivel: { lt: 0 } });
  assert.equal(negativos, 0, `${rotulo}: nenhum lote negativo`);
  return atual;
};
/** Nenhum 409 CONCURRENCY_CONFLICT (deadlock 40P01, serialização ou timeout) nas corridas que não o esperam. */
const semConflito = (...respostas) => {
  for (const r of respostas) assert.notEqual(corpoDe(r)?.code, 'CONCURRENCY_CONFLICT', `corrida sem ciclo de travas: ${r.statusCode} ${r.body}`);
};
const numeros = async (s) => (await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: s.c }, select: { numero_movimentacao: true } })).map((m) => m.numero_movimentacao);
/** Numeração de movimentos: só números da sequência, sem repetição, nenhum provisório `p-…`. */
const numeracaoLimpa = async (s) => {
  const ns = await numeros(s);
  assert.deepEqual(ns.filter((n) => !/^\d+$/.test(String(n))), [], 'nenhum movimento commitado com número provisório');
  assert.equal(new Set(ns).size, ns.length, `números de movimento únicos: ${ns.join(',')}`);
};

/** Corpo do abastecimento do GERADOR (sem medidor, tanque de 100 L, diesel S10). */
const corpoGerador = (s, extra = {}) => corpoAbastecimento(s, { bem_id: s.gerador.id, tanque_id: s.gerador.tanques[0].id, medidor_leitura: null, ...extra });

// ─── P3 (Central Única de Lançamentos) no tenant do abastecimento ───────────
const p3Por = new Map();
/** Parceiros (fornecedor e cliente), naturezas e perfil da e1 para vendas/compras P3. */
const prepararP3 = async (s) => {
  if (p3Por.has(s.c)) return p3Por.get(s.c);
  const p = prisma();
  const base = { cliente_id: s.c, empresa_id: s.e1.id };
  const m = randomUUID().slice(0, 6);
  await A.ok(A.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  const e = {
    id: s.e1.id,
    forn: await p.fornecedor.create({ data: { ...base, numero_cadastro: `CF-${m}`, tipo_pessoa: 'Jurídica', nome: `POSTO ${m}`, tipos: ['fornecedor'] } }),
    cli: await p.fornecedor.create({ data: { ...base, numero_cadastro: `CC-${m}`, tipo_pessoa: 'Jurídica', nome: `VIZINHO ${m}`, tipos: ['cliente'] } }),
    desp: await p.naturezaFinanceira.create({ data: { ...base, numero: `CD${m}`, tipo: 'DESPESA', nome: `COMBUSTIVEL ${m}` } }),
    rec: await p.naturezaFinanceira.create({ data: { ...base, numero: `CR${m}`, tipo: 'RECEITA', nome: `REVENDA ${m}` } }),
  };
  p3Por.set(s.c, e);
  return e;
};
/** Documento P3 COM_PRODUTOS de 1 mercadoria diesel em KG (total em Decimal, 2 casas; nunca float). */
const docP3 = async (s, direcao, kg, preco, dia = '2027-06-10') => {
  const e = await prepararP3(s);
  const total = new Prisma.Decimal(kg).times(new Prisma.Decimal(preco)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  return {
    empresa_id: e.id, direcao, conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: (direcao === 'PAGAR' ? e.forn : e.cli).id, data_emissao: dia, data_operacional: dia,
    efeito_fisico_confirmado: true,
    itens: [{ tipo_item: 'MERCADORIA', produto_id: s.diesel.id, local_estoque_id: s.local.id, unidade: 'KG', quantidade: kg, valor_unitario: preco }],
    rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: (direcao === 'PAGAR' ? e.desp : e.rec).id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
  };
};
const rascunhoP3 = async (s, direcao, kg, preco, dia) => A.ok(A.req('POST', '/operacoes-financeiras', s.token, { ...(await docP3(s, direcao, kg, preco, dia)), operation_id: opId() }), 201);
const confirmarP3 = (s, d) => A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), versao: d.versao });
const confirmadoP3 = async (s, direcao, kg, preco, dia) => A.ok(confirmarP3(s, await rascunhoP3(s, direcao, kg, preco, dia)));
const cancelarP3 = (s, d) => A.req('POST', `/operacoes-financeiras/${d.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'corrida com abastecimento' });
const retificarP3 = async (s, d, direcao, kg, preco) =>
  A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, s.token, { ...(await docP3(s, direcao, kg, preco)), versao: d.versao, operation_id: opId(), motivo: 'quantidade corrigida' });
const excluirP3 = (s, d) => A.req('POST', `/operacoes-financeiras/${d.id}/excluir`, s.token, { empresa_id: s.e1.id, versao: d.versao, operation_id: opId(), motivo: 'lançado em duplicidade' });
const loteDaCompra = (d) => d.itens[0].estoque_lote_nota_id;

// ─────────────────────────────────────────────────────────────────────────────
describe('C1 — mesma operation_id em paralelo', () => {
  test('o 2º pedido espera o recibo do 1º e volta 200 replay (ou 409 IN_PROGRESS); payload divergente → 409 IDEMPOTENCY_CONFLICT sem gravar; rajada de 3 = 1 baixa só', async () => {
    const s = await montarAbastecimento(app);
    const corpo = corpoAbastecimento(s);
    const { r1, r2 } = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpo), () => A.confirmar(s.operador.token, { ...corpo }));
    assert.equal(r1.statusCode, 201, r1.body);
    assert.ok((r2.statusCode === 200 && r2.json().replay === true) || erro(r2)[1] === 'IDEMPOTENCY_IN_PROGRESS', `2º com a mesma chave: ${r2.statusCode} ${r2.body}`);
    if (r2.statusCode === 200) assert.equal(r2.json().id, r1.json().id, 'replay devolve o MESMO abastecimento');
    // retry depois do commit: replay, nenhuma 2ª saída
    const r3 = await A.confirmar(s.operador.token, corpo);
    assert.deepEqual([r3.statusCode, r3.json().replay, r3.json().id], [200, true, r1.json().id]);
    assert.equal(await contar(s, 'abastecimentoBem'), 1);
    assert.equal(await contar(s, 'movimentacaoEstoque', { origem_sistema: 'abastecimento_patrimonio' }), 1, 'uma única saída');
    assert.equal(await coerente(s, s.diesel, 'C1'), '82.8000');

    // payload divergente com a MESMA chave, em paralelo: espera e recusa sem gravar
    const k2 = corpoAbastecimento(s, { quantidade_litros: '20' });
    const div = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, k2), () => A.confirmar(s.operador.token, { ...k2, quantidade_litros: '21' }));
    assert.equal(div.r1.statusCode, 201, div.r1.body);
    assert.deepEqual(erro(div.r2).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT'], div.r2.body);
    assert.equal(await contar(s, 'abastecimentoBem'), 2, 'só o 1º da chave k2 gravou');
    const a2 = await prisma().abastecimentoBem.findFirst({ where: { cliente_id: s.c, operation_id: k2.operation_id } });
    assert.equal(p4(a2.quantidade_litros), '20.0000', 'o abastecimento gravado é o do 1º corpo');
    assert.equal(await contar(s, 'auditLog', { acao: 'abastecimento_bem.reenvio_conflitante' }), 1, 'conflito auditado (best-effort, transação própria)');
    assert.equal(await coerente(s, s.diesel, 'C1 divergente'), '66.0000');

    // rajada sem portão: 3 pedidos iguais → exatamente 1 efeito
    const k3 = corpoAbastecimento(s, { quantidade_litros: '10' });
    const rajada = await Promise.all([1, 2, 3].map(() => A.confirmar(s.operador.token, { ...k3 })));
    const st = rajada.map((r) => (r.statusCode === 201 ? 'novo' : r.statusCode === 200 && r.json().replay ? 'replay' : erro(r)[1])).sort();
    assert.equal(st.filter((x) => x === 'novo').length, 1, `exatamente um 201: ${st}`);
    assert.ok(st.every((x) => ['novo', 'replay', 'IDEMPOTENCY_IN_PROGRESS'].includes(x)), `só replay/em andamento nos outros: ${st}`);
    assert.equal(await contar(s, 'abastecimentoBem', { operation_id: k3.operation_id }), 1);
    assert.equal(await coerente(s, s.diesel, 'C1 rajada'), '57.6000');
    semConflito(r1, r2, div.r1, div.r2, ...rajada);
    await numeracaoLimpa(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C2 — chaves diferentes, saldo para um só', () => {
  test('mesmo bem (serializa no Bem) e bens diferentes (serializa no Produto): um 201 e um 422 saldo_lote_insuficiente; nunca saldo negativo', async () => {
    const s = await montarAbastecimento(app);
    // 150 kg; 100 L = 84 kg cada: só cabe um
    const { r1, r2 } = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO,
      () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '100' })),
      () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '100' })));
    assert.equal(r1.statusCode, 201, r1.body);
    assert.deepEqual(erro(r2), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade_litros', 'saldo_lote_insuficiente'], r2.body);
    assert.equal(r2.json().details.disponivel, '66.0000', 'o perdedor vê o saldo DEPOIS da baixa do vencedor');
    assert.equal(await coerente(s, s.diesel, 'C2 mesmo bem'), '66.0000');
    // bens diferentes: gerador (sem medidor) e trator; 50 L = 42 kg cada; 66 kg → só um
    const b = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO,
      () => A.confirmar(s.operador.token, corpoGerador(s, { quantidade_litros: '50' })),
      () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '50' })));
    assert.equal(b.r1.statusCode, 201, b.r1.body);
    assert.deepEqual(erro(b.r2), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade_litros', 'saldo_lote_insuficiente'], b.r2.body);
    assert.equal(await coerente(s, s.diesel, 'C2 bens diferentes'), '24.0000');
    assert.equal(await contar(s, 'abastecimentoBem'), 2);
    assert.equal(await contar(s, 'operacaoIdempotente', { tipo_operacao: 'confirmar_abastecimento_bem' }), 2, 'o perdedor não deixa recibo');
    semConflito(r1, r2, b.r1, b.r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C3 — abastecimento × venda P3 do mesmo produto', () => {
  test('nas duas ordens serializam no Produto (quem chega espera o pid do outro); Σ baixas = Σ lotes; sem 40P01', async () => {
    const s = await montarAbastecimento(app);
    // (a) abastecimento segura o produto; a venda (50 kg) espera
    const v1 = await rascunhoP3(s, 'RECEBER', '50', '6.00');
    const a = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)), () => confirmarP3(s, v1));
    assert.equal(a.r1.statusCode, 201, a.r1.body);
    assert.equal(a.r2.statusCode, 200, a.r2.body);
    assert.deepEqual(await fatiasDe(a.r1.json().id), [[s.lotes.dieselA.id, '50.0000'], [s.lotes.dieselB.id, '17.2000']]);
    assert.deepEqual([await loteKg(s.lotes.dieselA.id), await loteKg(s.lotes.dieselB.id)], ['0.0000 Esgotado', '32.8000 Disponivel'], 'a venda baixou B depois do abastecimento');
    assert.equal(await coerente(s, s.diesel, 'C3a'), '32.8000');
    // (b) a venda segura o produto (parada no movimento); o abastecimento (30 L = 25,2 kg) espera
    const v2 = await rascunhoP3(s, 'RECEBER', '5', '6.00');
    const b = await corrida(s, NO_MOVIMENTO_DO_P3, () => confirmarP3(s, v2), () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '30' })));
    assert.equal(b.r1.statusCode, 200, b.r1.body);
    assert.equal(b.r2.statusCode, 201, b.r2.body);
    assert.deepEqual(await fatiasDe(b.r2.json().id), [[s.lotes.dieselB.id, '25.2000']], 'o abastecimento releu o lote sob a trava (27,8 depois da venda)');
    assert.equal(await coerente(s, s.diesel, 'C3b'), '2.6000');
    semConflito(a.r1, a.r2, b.r1, b.r2);
    await numeracaoLimpa(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C4 — abastecimento × cancelamento/retificação/exclusão P3 do mesmo produto', () => {
  test('compra: cancelar e retificar nas duas ordens → sem ciclo; quem chega depois vê o efeito do outro (409 ESTOQUE_JA_CONSUMIDO / OPERACAO_RETIFICACAO_BLOQUEADA, 422 sem saldo, ou 2xx coerente)', async () => {
    const s = await montarAbastecimento(app, { lotes: false });
    const cx = await confirmadoP3(s, 'PAGAR', '100', '6.00');
    // R1: abastecimento segura o produto; cancelar a compra espera → o lote já foi consumido
    const r1 = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)), () => cancelarP3(s, cx));
    assert.equal(r1.r1.statusCode, 201, r1.r1.body);
    assert.deepEqual(erro(r1.r2).slice(0, 2), [409, 'ESTOQUE_JA_CONSUMIDO'], r1.r2.body);
    assert.equal(await loteKg(loteDaCompra(cx)), '32.8000 Disponivel');
    assert.equal(await coerente(s, s.diesel, 'C4 R1'), '32.8000');
    // R2: compra Y; abastecimento (consome X e Y) segura; retificar Y espera → bloqueada
    const cy = await confirmadoP3(s, 'PAGAR', '100', '6.00');
    const r2 = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)), () => retificarP3(s, cy, 'PAGAR', '120', '6.00'));
    assert.equal(r2.r1.statusCode, 201, r2.r1.body);
    assert.deepEqual(await fatiasDe(r2.r1.json().id), [[loteDaCompra(cx), '32.8000'], [loteDaCompra(cy), '34.4000']]);
    assert.deepEqual(erro(r2.r2).slice(0, 2), [409, 'OPERACAO_RETIFICACAO_BLOQUEADA'], r2.r2.body);
    assert.equal(await coerente(s, s.diesel, 'C4 R2'), '65.6000');
    // R3: compra Z; retificar Z (100 → 120) segura; o abastecimento espera e consome o lote NOVO
    const cz = await confirmadoP3(s, 'PAGAR', '100', '7.00');
    const r3 = await corrida(s, NO_MOVIMENTO_DO_P3, () => retificarP3(s, cz, 'PAGAR', '120', '7.00'), () => A.confirmar(s.operador.token, corpoAbastecimento(s)));
    assert.equal(r3.r1.statusCode, 200, r3.r1.body);
    assert.equal(r3.r2.statusCode, 201, r3.r2.body);
    const retificada = r3.r1.json();
    const loteNovoZ = retificada.itens[0].estoque_lote_nota_id;
    assert.deepEqual(await fatiasDe(r3.r2.json().id), [[loteDaCompra(cy), '65.6000'], [loteNovoZ, '1.6000']], 'consumiu Y e o lote da retificação (nunca o lote estornado de Z)');
    assert.equal(await coerente(s, s.diesel, 'C4 R3'), '118.4000');
    // R4: compra W com data ANTERIOR (seria a 1ª do FIFO); cancelar W segura; o abastecimento espera e não a consome
    const cw = await confirmadoP3(s, 'PAGAR', '100', '8.00', '2027-06-05');
    const r4 = await corrida(s, NO_MOVIMENTO_DO_P3, () => cancelarP3(s, cw), () => A.confirmar(s.operador.token, corpoAbastecimento(s)));
    assert.equal(r4.r1.statusCode, 200, r4.r1.body);
    assert.equal(r4.r2.statusCode, 201, r4.r2.body);
    assert.deepEqual(await fatiasDe(r4.r2.json().id), [[loteNovoZ, '67.2000']], 'o lote cancelado de W nunca é consumido');
    assert.equal(await loteKg(loteDaCompra(cw)), '0.0000 Estornado');
    assert.equal(await coerente(s, s.diesel, 'C4 R4'), '51.2000');
    semConflito(r1.r1, r1.r2, r2.r1, r2.r2, r3.r1, r3.r2, r4.r1, r4.r2);
    await numeracaoLimpa(s);
  });

  test('venda: excluir (P3-03) nas duas ordens (depois do abastecimento → 409 venda_com_movimento_posterior; antes → devolve e o abastecimento consome o devolvido) e duplicar durante o abastecimento (sem efeito físico)', async () => {
    const s = await montarAbastecimento(app);
    const v1 = await confirmadoP3(s, 'RECEBER', '30', '6.00'); // A: 50 → 20
    // E1: abastecimento segura; excluir a venda espera e, depois, vê o movimento posterior → bloqueada (D14), nada muda
    const e1 = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)), () => excluirP3(s, v1));
    assert.equal(e1.r1.statusCode, 201, e1.r1.body);
    assert.deepEqual(await fatiasDe(e1.r1.json().id), [[s.lotes.dieselA.id, '20.0000'], [s.lotes.dieselB.id, '47.2000']]);
    assert.deepEqual(erro(e1.r2), [409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'id', 'venda_com_movimento_posterior'], e1.r2.body);
    assert.equal(e1.r2.json().details.motivos[0].id, e1.r1.json().movimentacao.id, 'o movimento posterior é o do abastecimento que venceu a corrida');
    assert.deepEqual([await loteKg(s.lotes.dieselA.id), await loteKg(s.lotes.dieselB.id)], ['0.0000 Esgotado', '52.8000 Disponivel']);
    assert.equal(await coerente(s, s.diesel, 'C4 E1'), '52.8000');
    // E2: venda 2 (B: 52,8 → 22,8); excluir segura (devolvendo a B); o abastecimento (30 L = 25,2 kg) espera e consome o que voltou
    const v2 = await confirmadoP3(s, 'RECEBER', '30', '6.00');
    const e2 = await corrida(s, NO_MOVIMENTO_DO_P3, () => excluirP3(s, v2), () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '30' })));
    assert.equal(e2.r1.statusCode, 200, e2.r1.body);
    assert.equal(e2.r2.statusCode, 201, e2.r2.body);
    assert.deepEqual(await fatiasDe(e2.r2.json().id), [[s.lotes.dieselB.id, '25.2000']]);
    assert.equal(await coerente(s, s.diesel, 'C4 E2'), '27.6000');
    // D: duplicar a venda (rascunho com duplicado_de_id) enquanto um abastecimento segura o produto
    const dup = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '10' })),
      async () => A.req('POST', '/operacoes-financeiras', s.token, { ...(await docP3(s, 'RECEBER', '30', '6.00')), duplicado_de_id: v2.id, operation_id: opId() }),
      { segundoEspera: null });
    assert.equal(dup.r1.statusCode, 201, dup.r1.body);
    assert.equal(dup.r2.statusCode, 201, dup.r2.body);
    assert.equal(dup.r2.json().status, 'RASCUNHO');
    assert.equal(await coerente(s, s.diesel, 'C4 duplicar'), '19.2000', 'só o abastecimento (8,4 kg) baixou: o duplicado é rascunho');
    semConflito(e1.r1, e1.r2, e2.r1, e2.r2, dup.r1, dup.r2);
    await numeracaoLimpa(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C5 — abastecimento × suplementação', () => {
  test('nas duas ordens: serializam no Produto, sem lost update; numeração de movimentos única', async () => {
    const s = await montarAbastecimento(app);
    const suplementar = (kg) => A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, {
      operation_id: opId(), empresa_id: s.e1.id, produto_id: s.diesel.id, local_origem_id: s.local.id, quantidade: kg,
    });
    const a = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)), () => suplementar(5));
    assert.equal(a.r1.statusCode, 201, a.r1.body);
    assert.equal(a.r2.statusCode, 201, a.r2.body);
    assert.equal(await coerente(s, s.diesel, 'C5a'), '77.8000');
    const b = await corrida(s, { tabela: 'MovimentacaoEstoque', condicao: `NEW.tipo_detalhado = 'suplementacao'` },
      () => suplementar(5), () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '20' })));
    assert.equal(b.r1.statusCode, 201, b.r1.body);
    assert.equal(b.r2.statusCode, 201, b.r2.body);
    assert.equal(await coerente(s, s.diesel, 'C5b'), '56.0000');
    assert.equal(await contar(s, 'movimentacaoEstoque'), 4);
    semConflito(a.r1, a.r2, b.r1, b.r2);
    await numeracaoLimpa(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C6 — abastecimento × PATCH do bem', () => {
  test('abastecimento segura o Bem → o ajuste de medidor espera e vê o piso novo (422, nunca 409 de versão); PATCH segura o Bem → o abastecimento espera, relê medidor e tanque e recusa (422 leitura_regressiva / tanque_inativo) sem gravar', async () => {
    const s = await montarAbastecimento(app);
    const bem0 = await A.bem(s.token, s.e1.id, s.trator.id);
    // (b) abastecimento (leitura 1550,5 em 06-10) segura o Bem; ajuste 1540 em 06-14 (válido sem ele) espera
    const b = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)),
      () => A.req('PATCH', `/bens-patrimoniais/${s.trator.id}`, s.token, { empresa_id: s.e1.id, versao: bem0.versao, medidor: { tipo: 'HORIMETRO', leitura_atual: '1540', data_leitura: '2027-06-14' } }));
    assert.equal(b.r1.statusCode, 201, b.r1.body);
    assert.deepEqual(erro(b.r2), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor.leitura_atual', 'leitura_regressiva'], b.r2.body);
    assert.equal(b.r2.json().details.origem_referencia, 'ABASTECIMENTO', 'o PATCH leu o piso operacional gravado pelo abastecimento');
    assert.equal((await A.bem(s.token, s.e1.id, s.trator.id)).versao, bem0.versao, 'o abastecimento não mexe na versão do bem');
    // (c) ajuste de cadastro 1600 em 06-12 (≥ piso) segura o Bem; o abastecimento 1590 em 06-13 (válido ANTES do ajuste) espera,
    //     relê o medidor sob a trava e recusa: o ponto do cadastro (06-12) agora é anterior e maior
    const fotoC = JSON.stringify(await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } }));
    const c = await corrida(s, { tabela: 'AuditLog', condicao: `NEW.entidade = 'BemPatrimonial'` },
      () => A.req('PATCH', `/bens-patrimoniais/${s.trator.id}`, s.token, { empresa_id: s.e1.id, versao: bem0.versao, medidor: { tipo: 'HORIMETRO', leitura_atual: '1600', data_leitura: '2027-06-12' } }),
      () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '10', data_operacional: '2027-06-13', medidor_leitura: '1590' })));
    assert.equal(c.r1.statusCode, 200, c.r1.body);
    assert.deepEqual(erro(c.r2), [422, 'MEDIDOR_LEITURA_REGRESSIVA', 'medidor_leitura', 'leitura_regressiva'], c.r2.body);
    assert.equal(JSON.stringify(await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } })), fotoC, 'nada gravado pelo perdedor');
    // (a) PATCH inativando o tanque segura o Bem; o abastecimento espera e recusa
    const t = s.trator.tanques[0];
    const bem1 = await A.bem(s.token, s.e1.id, s.trator.id);
    const fotoAntes = JSON.stringify(await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } }));
    const a = await corrida(s, { tabela: 'AuditLog', condicao: `NEW.entidade = 'BemPatrimonial'` },
      () => A.req('PATCH', `/bens-patrimoniais/${s.trator.id}`, s.token, {
        empresa_id: s.e1.id, versao: bem1.versao,
        tanques: [{ id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros, observacao: t.observacao, combustivel_ids: t.combustiveis.map((c) => c.id), ativo: false }],
      }),
      () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '10' })));
    assert.equal(a.r1.statusCode, 200, a.r1.body);
    assert.deepEqual(erro(a.r2), [422, 'ABASTECIMENTO_TANQUE_INVALIDO', 'tanque_id', 'tanque_inativo'], a.r2.body);
    assert.equal(JSON.stringify(await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } })), fotoAntes, 'nada gravado pelo perdedor');
    assert.equal(await coerente(s, s.diesel, 'C6'), '82.8000');
    semConflito(a.r1, a.r2, b.r1, b.r2, c.r1, c.r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C7 — abastecimento × troca de fator (A14) e × situação do vínculo', () => {
  test('advisory do vínculo antes do Produto nos dois lados: 201 com o fator antigo / 409 ABASTECIMENTO_CONVERSAO_ALTERADA / 422 sem_vinculo_ativo; sem 40P01', async () => {
    const s = await montarAbastecimento(app);
    const f1 = s.fator.diesel;
    // (a) abastecimento segura advisory + produto; a troca f1 → f2 espera
    const a = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)),
      () => s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.850000', f1.id));
    assert.equal(a.r1.statusCode, 201, a.r1.body);
    assert.deepEqual([a.r1.json().kg_por_litro, a.r1.json().conversao.id], ['0.840000', f1.id], 'confirmado com o fator vigente visto');
    assert.equal(a.r2.statusCode, 201, a.r2.body);
    const f2 = a.r2.json();
    // (b) a troca f2 → f3 segura (parada no INSERT do fator novo, f2 já encerrado); o abastecimento com f2 espera e recusa
    const fotoAntes = JSON.stringify(await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } }));
    const b = await corrida(s, { tabela: 'ConversaoCombustivelProduto', condicao: 'TRUE' },
      () => s.configurarFator(s.e1, s.comb.DIESEL_S10, s.diesel, '0.860000', f2.id),
      () => A.confirmar(s.operador.token, corpoAbastecimento(s, { conversao_id: f2.id, conversao_versao: f2.versao })));
    assert.equal(b.r1.statusCode, 201, b.r1.body);
    assert.deepEqual(erro(b.r2).slice(0, 2), [409, 'ABASTECIMENTO_CONVERSAO_ALTERADA'], b.r2.body);
    assert.equal(JSON.stringify(await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } })), fotoAntes);
    const f3 = b.r1.json();
    // (d) abastecimento com f3 segura; inativar o vínculo espera e passa depois
    const vinc = await prisma().tipoCombustivelProduto.findFirst({ where: { cliente_id: s.c, produto_id: s.diesel.id } });
    const d = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s, { conversao_id: f3.id, conversao_versao: f3.versao, quantidade_litros: '10' })),
      () => A.req('PATCH', `/patrimonio-combustivel-produtos/${vinc.id}`, s.token, { empresa_id: s.e1.id, versao: vinc.versao, ativo: false }));
    assert.equal(d.r1.statusCode, 201, d.r1.body);
    assert.equal(d.r1.json().kg_por_litro, '0.860000');
    assert.equal(d.r2.statusCode, 200, d.r2.body);
    // reativar; (c) inativar segura (parado na auditoria); o abastecimento espera e recusa
    const reat = await A.ok(A.req('PATCH', `/patrimonio-combustivel-produtos/${vinc.id}`, s.token, { empresa_id: s.e1.id, versao: d.r2.json().versao, ativo: true }));
    const fotoC = JSON.stringify(await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } }));
    const c = await corrida(s, { tabela: 'AuditLog', condicao: `NEW.entidade = 'TipoCombustivelProduto'` },
      () => A.req('PATCH', `/patrimonio-combustivel-produtos/${vinc.id}`, s.token, { empresa_id: s.e1.id, versao: reat.versao, ativo: false }),
      () => A.confirmar(s.operador.token, corpoAbastecimento(s, { conversao_id: f3.id, conversao_versao: f3.versao, quantidade_litros: '10' })));
    assert.equal(c.r1.statusCode, 200, c.r1.body);
    assert.deepEqual(erro(c.r2), [422, 'COMBUSTIVEL_PRODUTO_INVALIDO', 'produto_id', 'sem_vinculo_ativo'], c.r2.body);
    assert.equal(JSON.stringify(await prisma().abastecimentoBem.findMany({ where: { cliente_id: s.c } })), fotoC);
    assert.equal(await coerente(s, s.diesel, 'C7'), '74.2000', '67,2 kg (f1) + 8,6 kg (10 L × f3 0,86)');
    semConflito(a.r1, a.r2, b.r1, b.r2, c.r1, c.r2, d.r1, d.r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C8 — confirmar × cancelar e cancelar × cancelar', () => {
  test('cancelar × cancelar (chaves diferentes): 200 e 409 ABASTECIMENTO_STATUS_INVALIDO; confirmar × cancelar do mesmo bem nas duas ordens: ambos aplicam, estoque exato', async () => {
    const s = await montarAbastecimento(app);
    const a1 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const corpoCancelar = (versao = 1) => ({ empresa_id: s.e1.id, versao, motivo: 'abastecimento lançado errado', operation_id: opId() });
    const cc = await corrida(s, NO_ESTORNO_DO_ABASTECIMENTO, () => A.cancelar(s.contaCancelar.token, a1.id, corpoCancelar()), () => A.cancelar(s.contaCancelar.token, a1.id, corpoCancelar()));
    assert.equal(cc.r1.statusCode, 200, cc.r1.body);
    assert.deepEqual(erro(cc.r2), [409, 'ABASTECIMENTO_STATUS_INVALIDO', 'status', 'status_invalido'], cc.r2.body);
    assert.equal(await contar(s, 'movimentacaoEstoque', { tipo_detalhado: 'estorno_abastecimento' }), 1, 'um estorno só');
    assert.equal(await coerente(s, s.diesel, 'C8 cancelar×cancelar'), '150.0000');
    // confirmar A3 segura o Bem; cancelar A2 espera
    const a2 = await A.confirmarOk(s.operador.token, corpoAbastecimento(s));
    const x = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)), () => A.cancelar(s.contaCancelar.token, a2.id, corpoCancelar()));
    assert.equal(x.r1.statusCode, 201, x.r1.body);
    assert.equal(x.r2.statusCode, 200, x.r2.body);
    assert.deepEqual([await loteKg(s.lotes.dieselA.id), await loteKg(s.lotes.dieselB.id)], ['50.0000 Disponivel', '32.8000 Disponivel']);
    assert.equal(await coerente(s, s.diesel, 'C8 confirmar×cancelar'), '82.8000');
    // cancelar A3 segura; confirmar A4 espera
    const y = await corrida(s, NO_ESTORNO_DO_ABASTECIMENTO, () => A.cancelar(s.contaCancelar.token, x.r1.json().id, corpoCancelar()), () => A.confirmar(s.operador.token, corpoAbastecimento(s)));
    assert.equal(y.r1.statusCode, 200, y.r1.body);
    assert.equal(y.r2.statusCode, 201, y.r2.body);
    assert.deepEqual(await fatiasDe(y.r2.json().id), [[s.lotes.dieselA.id, '50.0000'], [s.lotes.dieselB.id, '17.2000']], 'o confirmar releu os lotes devolvidos');
    assert.equal(await coerente(s, s.diesel, 'C8 cancelar×confirmar'), '82.8000');
    assert.equal(await contar(s, 'abastecimentoBem', { status: 'CONFIRMADO' }), 1);
    semConflito(cc.r1, cc.r2, x.r1, x.r2, y.r1, y.r2);
    await numeracaoLimpa(s);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C9 — P3 longa segurando o produto', () => {
  test('o abastecimento desiste em ≈ 8 s (lock_timeout) com 409 CONCURRENCY_CONFLICT, sem transação viva nem recibo; repetir com a MESMA chave conclui 201 uma vez', async (t) => {
    const s = await montarAbastecimento(app);
    const venda = await rascunhoP3(s, 'RECEBER', '10', '6.00');
    const corpo = corpoAbastecimento(s);
    await instalarPortao(s, NO_MOVIMENTO_DO_P3.tabela, NO_MOVIMENTO_DO_P3.condicao);
    /** @type {any[]} */
    const pend = [];
    /** @type {any} */ let v;
    /** @type {any} */ let ab;
    /** @type {string[]} */
    const vivas = [];
    try {
      await comPortaoFechado(async (pidPortao) => {
        v = acompanhar(confirmarP3(s, venda));
        pend.push(v);
        const [pid] = await esperar(paradosNoPortao, 'venda P3 parada com o produto travado');
        ab = acompanhar(A.confirmar(s.operador.token, corpo));
        pend.push(ab);
        await esperar(async () => ab.feito || (await bloqueadosPor(pid)).length > 0, 'abastecimento esperando o produto');
        // CENÁRIO (não sincronização): a P3 segura o produto além do lock_timeout de 8 s; até 15 s.
        const limite = Date.now() + 15000;
        while (Date.now() < limite && !ab.feito) await new Promise((r) => setTimeout(r, 50));
        // Ainda com a trava segura: ninguém esperando a P3 e nenhuma transação aberta além da dela e da do portão.
        const presos = await bloqueadosPor(pid);
        const abertas = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> ${pid}::int AND pid <> ${pidPortao}::int AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`);
        if (presos.length || abertas.length) vivas.push(`${presos.length} esperando, ${abertas.length} abertas`);
        assert.equal(await contar(s, 'operacaoIdempotente', { operation_key: corpo.operation_id }), 0, 'nenhum recibo da chave enquanto a P3 segura');
      });
    } finally {
      await Promise.allSettled(pend.map((x) => x.p));
      await removerPortao(NO_MOVIMENTO_DO_P3.tabela);
    }
    t.diagnostic(`abastecimento: ${resumo(ab)} · venda: ${resumo(v)}`);
    assert.deepEqual(erro(ab.r).slice(0, 2), [409, 'CONCURRENCY_CONFLICT'], ab.r.body);
    assert.ok(ab.ms >= 7000 && ab.ms < 12000, `o 409 vem do lock_timeout (≈ 8 s): ${ab.ms} ms`);
    assert.deepEqual(vivas, [], 'depois do 409 a transação do abastecimento já acabou no banco');
    assert.equal(v.r.statusCode, 200, v.r.body);
    assert.equal(await contar(s, 'abastecimentoBem'), 0, 'nada do abastecimento commitou depois de a trava soltar');
    assert.equal(await coerente(s, s.diesel, 'C9 depois da venda'), '140.0000');
    // repetir com a MESMA operation_id: executa agora, uma vez
    const r2 = await A.confirmar(s.operador.token, corpo);
    assert.equal(r2.statusCode, 201, r2.body);
    const r3 = await A.confirmar(s.operador.token, corpo);
    assert.deepEqual([r3.statusCode, r3.json().replay], [200, true]);
    assert.equal(await contar(s, 'movimentacaoEstoque', { origem_sistema: 'abastecimento_patrimonio' }), 1, 'uma única saída depois do retry');
    assert.equal(await coerente(s, s.diesel, 'C9 retry'), '72.8000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C10 — PATCH administrativo de lote × abastecimento', () => {
  test('abastecimento segura → PATCH do lote espera e recusa 409 REGISTRO_OPERACIONAL_IMUTAVEL; PATCH segura → o abastecimento espera e consome o saldo NOVO (sem saldo fantasma)', async () => {
    const s = await montarAbastecimento(app);
    const a = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)),
      () => A.req('PATCH', `/estoque-lotes-nota/${s.lotes.dieselA.id}`, s.token, { quantidade_disponivel: 40 }));
    assert.equal(a.r1.statusCode, 201, a.r1.body);
    assert.equal(a.r2.statusCode, 409, a.r2.body);
    assert.deepEqual([a.r2.json().code, a.r2.json().details.vinculo], ['REGISTRO_OPERACIONAL_IMUTAVEL', 'abastecimento_bem']);
    assert.equal(await loteKg(s.lotes.dieselA.id), '0.0000 Esgotado', 'o PATCH não ressuscitou o saldo baixado');
    assert.equal(await coerente(s, s.diesel, 'C10a'), '82.8000');
    // lote livre no local 2 (100 kg); PATCH para 70 segura (parado na auditoria); o abastecimento no local 2 espera
    const l2 = await s.lote(s.e1, s.diesel, s.local2, { kg: '100.0000', custo: '5.0000', dia: '2027-06-02' });
    const b = await corrida(s, { tabela: 'AuditLog', condicao: `NEW.entidade = 'EstoqueLoteNota'` },
      () => A.req('PATCH', `/estoque-lotes-nota/${l2.id}`, s.token, { quantidade_disponivel: 70 }),
      () => A.confirmar(s.operador.token, corpoAbastecimento(s, { local_estoque_id: s.local2.id })));
    assert.equal(b.r1.statusCode, 200, b.r1.body);
    assert.equal(b.r2.statusCode, 201, b.r2.body);
    assert.deepEqual(await fatiasDe(b.r2.json().id), [[l2.id, '67.2000']]);
    assert.equal(await loteKg(l2.id), '2.8000 Disponivel', 'baixa sobre o saldo gravado pelo PATCH (70 − 67,2), não sobre o lido antes (100)');
    semConflito(a.r1, a.r2, b.r1, b.r2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C11 — numeração de movimentos', () => {
  test('confirmar e cancelar não seguram a sequência de movimentos durante os efeitos (suplementação de OUTRO produto conclui com o abastecimento parado depois dos lotes); a prévia não espera; nenhum movimento commita com p-…', async () => {
    const s = await montarAbastecimento(app);
    const suplementarGasolina = () => A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, {
      operation_id: opId(), empresa_id: s.e1.id, produto_id: s.gasolina.id, local_origem_id: s.local.id, quantidade: 3,
    });
    // confirmar parado nas fatias (movimento provisório e lotes já gravados na transação, nº ainda não reservado)
    const c = await corrida(s, { tabela: 'AbastecimentoBemConsumoLote', condicao: 'TRUE' }, () => A.confirmar(s.operador.token, corpoAbastecimento(s)), suplementarGasolina, { segundoEspera: false });
    assert.equal(c.r2.statusCode, 201, `a suplementação não esperou o abastecimento: ${c.r2.body}`);
    assert.equal(c.r1.statusCode, 201, c.r1.body);
    const d = c.r1.json();
    assert.match(d.movimentacao.numero, /^\d+$/);
    // cancelar parado no UPDATE da linha (estorno e lotes já gravados, nº do estorno ainda não reservado)
    const x = await corrida(s, { tabela: 'AbastecimentoBem', condicao: 'TRUE', evento: 'UPDATE' },
      () => A.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, versao: 1, motivo: 'lançado no bem errado', operation_id: opId() }), suplementarGasolina, { segundoEspera: false });
    assert.equal(x.r2.statusCode, 201, `a suplementação não esperou o cancelamento: ${x.r2.body}`);
    assert.equal(x.r1.statusCode, 200, x.r1.body);
    assert.match(x.r1.json().estorno.numero, /^\d+$/);
    // a prévia (sem trava, RepeatableRead só de leitura) não espera uma confirmação parada com Bem, vínculo e produto travados
    const pv = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s, { quantidade_litros: '10' })),
      () => A.previa(s.operador.token, corpoPrevia(s, { quantidade_litros: '10' })), { segundoEspera: false });
    assert.equal(pv.r2.statusCode, 200, pv.r2.body);
    assert.deepEqual(pv.r2.json().bloqueios, []);
    assert.equal(pv.r1.statusCode, 201, pv.r1.body);
    await numeracaoLimpa(s);
    // a sequência é contígua: os 4 movimentos usam 1..4 em ordem de commit
    const ns = (await numeros(s)).map(Number).sort((p, q) => p - q);
    assert.deepEqual(ns, [1, 2, 3, 4, 5], `sequência sem buraco nem repetição: ${ns}`);
    assert.equal(await coerente(s, s.diesel, 'C11'), '141.6000');
    // prova suplementar do arquivo todo: o banco não registrou deadlock (40P01) em nenhuma corrida
    assert.equal(await deadlocks(), deadlocksAntes, 'pg_stat_database.deadlocks não mudou');
  });
});

/**
 * D-PROD-161 (MAIKE-PATRIMONIO-SIMPLIFICA-01) — corridas do abastecimento com
 * os Produtos aceitos e a unidade do Produto (contrato §6.1.4). PostgreSQL
 * real, HTTP autenticado, prova por linhas gravadas.
 *
 * Corridas DETERMINÍSTICAS no padrão de `patrimonioP1AbastecimentosConcorrencia`:
 * um gatilho temporário ("portão") segura o primeiro comando EXATAMENTE no ponto
 * do efeito, com as travas dele tomadas, até o teste abrir; quem espera quem é
 * lido em `pg_blocking_pids`, nunca inferido por relógio.
 *
 *  (a) duas confirmações com saldo para uma → 201 + 422 (nunca saldo negativo)
 *  (b) PATCH do bem tirando o aceite × confirmação do mesmo Produto, nas duas
 *      ordens → nunca 500 e nunca confirma com aceite desligado (as duas tomam
 *      o Bem FOR UPDATE)
 *  (c) troca L → KG do Produto × confirmação → 409 PRODUTO_UNIDADE_EM_USO (a
 *      troca espera a trava de estoque e vê o movimento) ou 422
 *  (d) troca de fazenda do Produto × PATCH do bem acrescentando o Produto, nas
 *      duas ordens → 409 PRODUTO_EM_TANQUE_PATRIMONIO ou 422 outra_empresa
 *  (e) cancelar × cancelar → 200 + 409
 *  (f) mesma operation_id em paralelo → 201 + 200 replay (ou 409 em andamento)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, corpoAbastecimento, erro, itemTanque, montarAbastecimento, opId, prisma } from './patrimonioP1AbastecimentoCenario.mjs';
import { produtoL } from './patrimonioP1Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let A;
/** Pool PRÓPRIO do teste (portão e `pg_locks`); os comandos usam o pool do app. @type {PrismaClient} */
let aux;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoesAbastecimento(app);
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});

// ─── portão e observação de travas ──────────────────────────────────────────
const PORTAO = 'simp_conc_portao';
const instalarPortao = async (s, tabela, condicao = 'TRUE', evento = 'INSERT') => {
  const p = prisma();
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(161, 4); RETURN NEW; END $f$`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
  await p.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} BEFORE ${evento} ON "${tabela}" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND ${condicao}) EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = (tabela) => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(161, 4)`;
    return fn();
  }, { maxWait: 10000, timeout: 60000 });
const paradosNoPortao = async () => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 161 AND objid = 4 AND objsubid = 2 AND NOT granted`);
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
    await new Promise((r) => setTimeout(r, 15));
  }
};
const acompanhar = (pedido) => {
  /** @type {{ feito: boolean, r: any, p: Promise<any> }} */
  const a = { feito: false, r: null, p: Promise.resolve() };
  a.p = Promise.resolve(pedido).then((r) => Object.assign(a, { feito: true, r }).r);
  return a;
};
/**
 * `primeiro()` para no portão com as travas dele tomadas; `segundo()` chega e
 * TEM de ficar bloqueado pelo pid do primeiro; o portão abre e as duas
 * respostas voltam.
 */
const corrida = async (s, portao, primeiro, segundo) => {
  await instalarPortao(s, portao.tabela, portao.condicao, portao.evento);
  /** @type {any[]} */
  const pend = [];
  /** @type {any} */ let a;
  /** @type {any} */ let b;
  try {
    await comPortaoFechado(async () => {
      a = acompanhar(primeiro());
      pend.push(a);
      const [pid] = await esperar(async () => (a.feito ? [null] : paradosNoPortao()), 'primeiro parado no portão');
      assert.equal(a.feito, false, `o primeiro tinha de parar no portão: ${a.r?.statusCode} ${a.r?.body}`);
      b = acompanhar(segundo());
      pend.push(b);
      await esperar(async () => b.feito || (await bloqueadosPor(pid)).length > 0, 'segundo chegando nas travas do primeiro');
      assert.equal(b.feito, false, `o segundo não pode passar pelo primeiro: ${b.r?.statusCode} ${b.r?.body}`);
    });
  } finally {
    await Promise.allSettled(pend.map((x) => x.p));
    await removerPortao(portao.tabela);
  }
  return { r1: a.r, r2: b.r };
};
const NO_MOVIMENTO_DO_ABASTECIMENTO = { tabela: 'MovimentacaoEstoque', condicao: `NEW.origem_sistema = 'abastecimento_patrimonio'` };
const NA_AUDITORIA = (entidade) => ({ tabela: 'AuditLog', condicao: `NEW.entidade = '${entidade}'` });

const p4 = (v) => (v === null || v === undefined ? null : v.toFixed(4));
const coerente = async (s, produto, rotulo) => {
  const r = await prisma().estoqueLoteNota.aggregate({ _sum: { quantidade_disponivel: true }, where: { cliente_id: s.c, produto_id: produto.id, status: 'Disponivel' } });
  const lotes = p4(r._sum.quantidade_disponivel) ?? '0.0000';
  const atual = p4((await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual);
  assert.equal(lotes, atual, `${rotulo}: Σ lotes Disponivel = estoque_atual`);
  assert.ok(!atual.startsWith('-'), `${rotulo}: estoque nunca negativo (${atual})`);
  return atual;
};
const nunca500 = (...rs) => {
  for (const r of rs) assert.ok(r.statusCode < 500, `nunca 500: ${r.statusCode} ${r.body}`);
};
const aceiteDe = (s, produto) => prisma().tanqueBemProduto.findFirst({ where: { cliente_id: s.c, tanque_id: s.trator.tanques[0].id, produto_id: produto.id } });

describe('D-PROD-161 — corridas do abastecimento com aceites e unidades', () => {
  test('(a) duas confirmações de 200 kg com 300 kg no lote: uma 201 e uma 422 saldo_lote_insuficiente; (f) mesma chave em paralelo: uma baixa só', async () => {
    const s = await montarAbastecimento(app);
    const c = (extra = {}) => corpoAbastecimento(s, { produto_id: s.dieselKg.id, quantidade: '200', ...extra });
    const { r1, r2 } = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, c()), () => A.confirmar(s.operador.token, c()));
    assert.equal(r1.statusCode, 201, r1.body);
    assert.deepEqual(erro(r2), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'saldo_lote_insuficiente'], r2.body);
    assert.deepEqual([r2.json().details.disponivel, r2.json().details.unidade], ['100.0000', 'KG'], 'o perdedor vê o saldo depois da baixa, em kg');
    assert.equal(await coerente(s, s.dieselKg, '(a)'), '100.0000');
    // (f)
    const mesma = c({ quantidade: '10' });
    const f = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, mesma), () => A.confirmar(s.operador.token, { ...mesma }));
    assert.equal(f.r1.statusCode, 201, f.r1.body);
    assert.ok((f.r2.statusCode === 200 && f.r2.json().replay === true && f.r2.json().id === f.r1.json().id) || erro(f.r2)[1] === 'IDEMPOTENCY_IN_PROGRESS', `${f.r2.statusCode} ${f.r2.body}`);
    assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c, operation_id: mesma.operation_id } }), 1);
    assert.equal(await coerente(s, s.dieselKg, '(f)'), '90.0000');
    nunca500(r1, r2, f.r1, f.r2);
  });

  test('(b) PATCH do bem tirando o aceite × confirmação do mesmo Produto, nas duas ordens: nunca 500, nunca confirma com o aceite desligado', async () => {
    const s = await montarAbastecimento(app);
    const tirarDiesel = async () => {
      const b = await s.bemAtual(s.trator);
      return A.req('PATCH', `/bens-patrimoniais/${s.trator.id}`, s.token, { empresa_id: s.e1.id, versao: b.versao, tanques: [itemTanque(b.tanques[0], [s.dieselKg.id])] });
    };
    // 1ª ordem: o PATCH (parado na auditoria do bem, Bem FOR UPDATE tomado) vence; a confirmação espera e recusa
    const um = await corrida(s, NA_AUDITORIA('BemPatrimonial'), tirarDiesel, () => A.confirmar(s.operador.token, corpoAbastecimento(s)));
    assert.equal(um.r1.statusCode, 200, um.r1.body);
    assert.deepEqual(erro(um.r2), [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque'], um.r2.body);
    assert.equal(await aceiteDe(s, s.diesel), null, 'sem histórico o aceite retirado é apagado (D11)');
    assert.equal(await prisma().abastecimentoBem.count({ where: { cliente_id: s.c } }), 0);
    // devolve o aceite
    await A.ok(s.patchAceites(s.trator, [[s.diesel.id, s.dieselKg.id]]));
    // 2ª ordem: a confirmação (parada no movimento, Bem FOR UPDATE tomado) vence; o PATCH espera e, com histórico, só desliga
    const dois = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)), tirarDiesel);
    assert.equal(dois.r1.statusCode, 201, dois.r1.body);
    assert.equal(dois.r2.statusCode, 200, dois.r2.body);
    const aceite = await aceiteDe(s, s.diesel);
    assert.deepEqual([aceite?.ativo, (await prisma().abastecimentoBem.findUnique({ where: { id: dois.r1.json().id } })).produto_id], [false, s.diesel.id],
      'o abastecimento confirmou ANTES do PATCH (aceite ativo na hora); depois o PATCH só desligou a linha que ele referencia');
    // e agora ninguém confirma com o aceite desligado
    assert.deepEqual(erro(await A.confirmar(s.operador.token, corpoAbastecimento(s))), [422, 'ABASTECIMENTO_PRODUTO_NAO_ACEITO', 'produto_id', 'nao_aceito_pelo_tanque']);
    assert.equal(await coerente(s, s.diesel, '(b)'), '70.0000');
    nunca500(um.r1, um.r2, dois.r1, dois.r2);
  });

  test('(c) troca L → KG do Produto × confirmação: a troca espera a trava de estoque e recusa 409 PRODUTO_UNIDADE_EM_USO; a unidade e o abastecimento ficam em L', async () => {
    const s = await montarAbastecimento(app);
    const c = await corrida(s, NO_MOVIMENTO_DO_ABASTECIMENTO, () => A.confirmar(s.operador.token, corpoAbastecimento(s)),
      () => A.req('PATCH', `/produtos/${s.diesel.id}`, s.token, { unidade_principal_estoque: 'KG' }));
    assert.equal(c.r1.statusCode, 201, c.r1.body);
    assert.deepEqual(erro(c.r2).slice(0, 2), [409, 'PRODUTO_UNIDADE_EM_USO'], c.r2.body);
    // `field`/`reason` saem de `details` para o topo do corpo (errorHandler.js:115-122)
    assert.ok(['estoque', 'lotes', 'movimentos'].includes(erro(c.r2)[3]), c.r2.body);
    assert.equal((await prisma().produto.findUnique({ where: { id: s.diesel.id } })).unidade_principal_estoque, 'L');
    assert.deepEqual([c.r1.json().unidade, (await prisma().abastecimentoBem.findUnique({ where: { id: c.r1.json().id } })).unidade], ['L', 'L']);
    // o cancelamento continua exato (unidade efetiva igual)
    const x = await A.cancelar(s.contaCancelar.token, c.r1.json().id, { empresa_id: s.e1.id, versao: 1, motivo: 'corrida de unidade', operation_id: opId() });
    assert.equal(x.statusCode, 200, x.body);
    assert.equal(await coerente(s, s.diesel, '(c)'), '150.0000');
    nunca500(c.r1, c.r2, x);
  });

  test('(d) troca de fazenda do Produto × PATCH do bem acrescentando o Produto, nas duas ordens: 409 PRODUTO_EM_TANQUE_PATRIMONIO ou 422 outra_empresa', async () => {
    const s = await montarAbastecimento(app);
    const novo1 = await produtoL(s, { nome: 'Diesel S500 (L)' });
    const novo2 = await produtoL(s, { nome: 'Diesel marítimo (L)' });
    const acrescentar = async (prod) => {
      const b = await s.bemAtual(s.gerador);
      return A.req('PATCH', `/bens-patrimoniais/${s.gerador.id}`, s.token, {
        empresa_id: s.e1.id, versao: b.versao, tanques: [itemTanque(b.tanques[0], [...b.tanques[0].produtos.map((x) => x.produto_id), prod.id])],
      });
    };
    const moverParaF2 = (prod) => A.req('PATCH', `/produtos/${prod.id}`, s.token, { empresa_id: s.e2.id });
    // 1ª ordem: o PATCH do bem (parado na auditoria, Produto FOR KEY SHARE tomado) vence; a troca de fazenda espera e recusa
    const um = await corrida(s, NA_AUDITORIA('BemPatrimonial'), () => acrescentar(novo1), () => moverParaF2(novo1));
    assert.equal(um.r1.statusCode, 200, um.r1.body);
    assert.deepEqual(erro(um.r2).slice(0, 2), [409, 'PRODUTO_EM_TANQUE_PATRIMONIO'], um.r2.body);
    assert.equal((await prisma().produto.findUnique({ where: { id: novo1.id } })).empresa_id, s.e1.id);
    // 2ª ordem: a troca de fazenda (parada na auditoria do Produto) vence; o PATCH do bem espera e recusa
    const dois = await corrida(s, NA_AUDITORIA('Produto'), () => moverParaF2(novo2), () => acrescentar(novo2));
    assert.equal(dois.r1.statusCode, 200, dois.r1.body);
    assert.deepEqual(erro(dois.r2), [422, 'TANQUE_PRODUTO_INVALIDO', 'tanques[0].produto_ids', 'outra_empresa'], dois.r2.body);
    const aceitos = (await s.bemAtual(s.gerador)).tanques[0].produtos.map((x) => x.produto_id).sort();
    assert.deepEqual(aceitos, [s.diesel.id, novo1.id].sort(), 'o Produto movido nunca entrou nos aceitos');
    nunca500(um.r1, um.r2, dois.r1, dois.r2);
  });

  test('(e) cancelar × cancelar (chaves diferentes): 200 e 409 ABASTECIMENTO_STATUS_INVALIDO; um estorno só', async () => {
    const s = await montarAbastecimento(app);
    const d = await A.confirmarOk(s.operador.token, corpoAbastecimento(s, { produto_id: s.dieselKg.id, quantidade: '50' }));
    const corpo = () => ({ empresa_id: s.e1.id, versao: 1, motivo: 'cancelado duas vezes', operation_id: opId() });
    const e = await corrida(s, { tabela: 'MovimentacaoEstoque', condicao: `NEW.tipo_detalhado = 'estorno_abastecimento'` },
      () => A.cancelar(s.contaCancelar.token, d.id, corpo()), () => A.cancelar(s.contaCancelar.token, d.id, corpo()));
    assert.equal(e.r1.statusCode, 200, e.r1.body);
    assert.deepEqual(erro(e.r2), [409, 'ABASTECIMENTO_STATUS_INVALIDO', 'status', 'status_invalido'], e.r2.body);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: 'estorno_abastecimento' } }), 1);
    assert.equal(await coerente(s, s.dieselKg, '(e)'), '300.0000');
    nunca500(e.r1, e.r2);
  });
});

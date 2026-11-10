/**
 * D-PROD-155 — P3-01 Central Única de Lançamentos: correções da revisão
 * adversarial (rodada 1, lentes CONCORRÊNCIA e ESTOQUE). PostgreSQL real, HTTP
 * autenticado, prova por linhas gravadas.
 *
 * Corridas DETERMINÍSTICAS, nunca por sono cego:
 *  - "portão": gatilho temporário (BEFORE INSERT, só do tenant do teste) que
 *    espera o advisory lock (154, 1) segurado por uma transação do TESTE. O
 *    comando para EXATAMENTE no ponto do efeito, com as travas dele já tomadas,
 *    até o teste abrir o portão;
 *  - quem espera quem é lido em `pg_locks`/`pg_blocking_pids`, nunca inferido
 *    por relógio.
 * A única espera por relógio é o CENÁRIO de C2 (trava segura além dos 5 s do
 * timeout padrão do Prisma): o defeito É esse timeout, não há sincronização ali.
 *
 *  C1. CONCORRENCIA-1 — PATCH/DELETE de lote × venda que o consome;
 *  C2. CONCORRENCIA-2/3 e ESTOQUE-2 — comandos antigos e PUT do perfil
 *      esperando travas longas (> 5 s): nunca 500; transitório → 409;
 *  C3. CONCORRENCIA-2 (janela) — confirmar/cancelar não seguram a sequência de
 *      movimentos do tenant durante os efeitos;
 *  C4. CONCORRENCIA-4 e ESTOQUE-3 — rascunho esperando produto não segura a
 *      sequência de documentos do tenant;
 *  C5. CONCORRENCIA-5 — replay do POST depois do descarte;
 *  C6. ESTOQUE-1 — kg replanejado na confirmação vai para o item (compra,
 *      venda e o cancelamento depois).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, docSem, foto, loteLegado, montarTenant, opId, prisma, somaLotes } from './gestaoP3Cenario.mjs';
import { travarProdutosEstoque } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';
import { ESCOPO_TENANT, reservarNumeros } from '../src/modules/sequencias/entidadeCodigoService.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/**
 * Cliente do TESTE com pool próprio para quem segura travas/portões e para quem
 * observa `pg_locks`. No CI o pool padrão do Prisma tem 5 conexões (2 × CPUs +
 * 1); com detentor, observador e comandos no MESMO pool do app, ele se esgotava
 * (P2024 no observador, não no produto). Os comandos sob teste usam o pool do app.
 * @type {PrismaClient}
 */
let aux;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});

const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });
const rascunhoVenda = (s, e, itens, extra = {}) => A.criar(s.token, docCom(e, s.local, itens, { direcao: 'RECEBER', ...extra }));
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const definirEstoqueAtual = (produto, kg) => prisma().produto.update({ where: { id: produto.id }, data: { estoque_atual: kg } });
const suplementar = (s, e, produto, local, quantidade, operation_id = opId()) =>
  A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, { operation_id, empresa_id: e.id, produto_id: produto.id, local_origem_id: local.id, quantidade });
const cancelar = (s, d, e) => A.cancelarReq(s.token, d.id, e.id);

// ─── portão e observação de travas ──────────────────────────────────────────
const PORTAO = 'p3c_portao';
/** Gatilho que segura o INSERT (só do tenant do teste) até o teste abrir o portão. */
const instalarPortao = async (s, tabela, condicao = 'TRUE') => {
  const p = prisma();
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(154, 1); RETURN NEW; END $f$`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
  await p.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} BEFORE INSERT ON "${tabela}" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND ${condicao}) EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = (tabela) => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
/** Portão fechado (lock exclusivo numa transação do TESTE) enquanto `fn` roda; abre no fim (commit ou erro). */
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(154, 1)`;
    return fn();
  }, { maxWait: 10000, timeout: 60000 });
/** pids parados no portão (ou null). */
const paradosNoPortao = async () => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 154 AND objid = 1 AND objsubid = 2 AND NOT granted`);
  return l.length ? l.map((r) => r.pid) : null;
};
/** pids bloqueados (direta ou transitivamente não: só diretamente) por `pid`. */
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
const algunsBloqueadosPor = async (pid) => {
  const l = await bloqueadosPor(pid);
  return l.length ? l : null;
};
/** Espera uma CONDIÇÃO observável (nunca um tempo fixo); estoura com rótulo. */
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
/** Pedido HTTP acompanhado: sabe se já terminou e em quanto tempo. */
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
/** Corpo JSON da resposta (204 e corpo vazio → null). */
const corpoDe = (r) => {
  try {
    return r.json();
  } catch {
    return null;
  }
};
const resumo = (a) => (a.feito ? `${a.r.statusCode} ${corpoDe(a.r)?.code ?? ''} em ${a.ms} ms` : 'ainda esperando');

// ─────────────────────────────────────────────────────────────────────────────
describe('C1 — CONCORRENCIA-1: PATCH/DELETE administrativo de lote × venda que o consome', () => {
  /**
   * A venda baixa o lote L por CAS e para no portão ANTES de gravar a fatia
   * FIFO (OperacaoFinanceiraConsumoLote). O comando administrativo chega nessa
   * janela: tem de esperar a venda e, depois do commit, ver a fatia → 409.
   */
  const corrida = async (acao) => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const L = await loteLegado(s, e, e.sal, s.local, { kg: '1000', custo: '1.0000' });
    await definirEstoqueAtual(e.sal, '1000');
    const venda = await rascunhoVenda(s, e, [item(e.sal, '200', '2')]);
    await instalarPortao(s, 'OperacaoFinanceiraConsumoLote');
    /** @type {any[]} */
    const pend = [];
    /** @type {any} */
    let conf;
    /** @type {any} */
    let admin;
    try {
      await comPortaoFechado(async () => {
        conf = acompanhar(A.confirmarReq(s.token, venda, e.id));
        pend.push(conf);
        const [pidVenda] = await esperar(paradosNoPortao, 'venda parada antes da fatia (CAS em L já feito)');
        admin = acompanhar(acao === 'PATCH'
          ? A.req('PATCH', `/estoque-lotes-nota/${L.id}`, s.token, { quantidade_disponivel: 1005 })
          : A.req('DELETE', `/estoque-lotes-nota/${L.id}`, s.token));
        pend.push(admin);
        await esperar(async () => admin.feito || (await bloqueadosPor(pidVenda)).length > 0, `${acao} do lote chegando na venda`);
        assert.equal(admin.feito, false, `o ${acao} não pode passar pela venda em curso: ${resumo(admin)} ${admin.r?.body}`);
      });
    } finally {
      await Promise.allSettled(pend.map((a) => a.p));
      await removerPortao('OperacaoFinanceiraConsumoLote');
    }
    assert.equal(conf.r.statusCode, 200, conf.r.body);
    const lote = await p.estoqueLoteNota.findUnique({ where: { id: L.id } });
    const fatias = await p.operacaoFinanceiraConsumoLote.aggregate({ _count: true, _sum: { quantidade: true }, where: { estoque_lote_nota_id: L.id } });
    const estado = `L=${lote?.quantidade_disponivel?.toFixed(4) ?? 'apagado'} | fatias ${fatias._count} (Σ ${fatias._sum.quantidade?.toFixed(4) ?? '0'}) | estoque_atual=${await estoqueAtual(e.sal)}`;
    assert.equal(admin.r.statusCode, 409, `${acao} do lote durante a venda: ${resumo(admin)} ${admin.r.body} | ${estado}`);
    assert.equal(codigo(admin.r), 'REGISTRO_OPERACIONAL_IMUTAVEL', estado);
    assert.equal(lote.quantidade_disponivel.toFixed(4), '800.0000', estado);
    assert.equal(await somaLotes({ cliente_id: s.c, produto_id: e.sal.id, status: 'Disponivel' }), await estoqueAtual(e.sal), `Σ lotes Disponivel = estoque_atual (${estado})`);
    const canc = await cancelar(s, venda, e);
    assert.equal(canc.statusCode, 200, `a venda continua cancelável: ${canc.body}`);
    assert.deepEqual([(await p.estoqueLoteNota.findUnique({ where: { id: L.id } })).quantidade_disponivel.toFixed(4), await estoqueAtual(e.sal)], ['1000.0000', '1000.0000']);
  };

  test('PATCH {quantidade_disponivel} do lote que a venda acabou de baixar: espera a venda e responde 409 REGISTRO_OPERACIONAL_IMUTAVEL; Σ lotes = estoque_atual; a venda cancela', async () => {
    await corrida('PATCH');
  });

  test('DELETE do lote que a venda acabou de baixar: espera a venda e responde 409 REGISTRO_OPERACIONAL_IMUTAVEL (nunca 403 da FK); a venda cancela', async () => {
    await corrida('DELETE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C2 — CONCORRENCIA-2/3 e ESTOQUE-2: travas longas de confirmar/cancelar', () => {
  // Detentor e observador no pool do TESTE (`aux`); as vítimas, no pool do
  // app, em ondas de 3 para caber em qualquer pool ≥ 3.
  test('com produto, sequência de movimentos, perfil e movimento original segurados por 6 s (as travas da confirmação/cancelamento), suplementação, transferência, POST e PATCH de movimento, PATCH de produto, PATCH e DELETE de lote e PUT do perfil esperam e concluem (nunca 500); a retentativa com a mesma operation_id aplica uma vez só', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.sal, s.local, { kg: '100' });
    await loteLegado(s, e, e.milho, s.local, { kg: '100' });
    const livre = await loteLegado(s, e, e.sal, s.local2, { kg: '10' });
    const livre2 = await loteLegado(s, e, e.sal, s.local2, { kg: '0', disponivel: '0', status: 'Esgotado' });
    await definirEstoqueAtual(e.sal, '110');
    // movimento ORIGINAL de uma compra confirmada (a linha que o cancelamento trava) e o depósito renomeado
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.racao, '1', '30')]));
    const original = await p.movimentacaoEstoque.findFirst({ where: { cliente_id: s.c, lancamento_origem_id: compra.id } });
    const nomeNovo = `DEPOSITO RENOMEADO ${s.c}`;
    await p.localEstoque.update({ where: { id: s.local.id }, data: { nome: nomeNovo } });
    await definirEstoqueAtual(e.milho, '100');
    const corpoSup = { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, quantidade: 5 };
    const corpoTransf = { operation_id: opId(), empresa_id: e.id, produto_id: e.milho.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 5 };
    /** Pedidos preguiçosos: cada onda dispara só os seus. */
    const pedidos = {
      'suplementação (mesmo produto: trava do produto)': () => A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, corpoSup),
      'transferência (OUTRO produto: sequência de movimentos)': () => A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, corpoTransf),
      'POST /movimentacoes-estoque (sequência de movimentos)': () => A.req('POST', '/movimentacoes-estoque', s.token, {
        empresa_id: e.id, tipo_movimentacao: 'Entrada', data_movimentacao: '2027-06-10T12:00:00.000Z', produto_id: e.milho.id, quantidade: 3, unidade_medida: 'KG', local_estoque_destino: s.local.id,
      }),
      'PATCH /produtos (linha do produto)': () => A.req('PATCH', `/produtos/${e.sal.id}`, s.token, { estoque_minimo: 3 }),
      'PUT do perfil (perfil em FOR SHARE)': () => A.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: e.id, pais: 'BR', moeda: 'BRL', locale: 'pt-PT' }),
      'PATCH de lote livre (trava do produto)': () => A.req('PATCH', `/estoque-lotes-nota/${livre.id}`, s.token, { custo_unitario: 2.5 }),
      'PATCH /movimentacoes-estoque (linha do movimento original)': () => A.req('PATCH', `/movimentacoes-estoque/${original.id}`, s.token, { local_destino: nomeNovo }),
      'DELETE de lote livre (trava do produto)': () => A.req('DELETE', `/estoque-lotes-nota/${livre2.id}`, s.token),
    };
    // [vítimas da onda, quantas têm de ficar paradas nas travas] — o PATCH de
    // lote livre pode ou não parar (custo não é coluna restrita), como antes.
    const ondas = [
      [['suplementação (mesmo produto: trava do produto)', 'transferência (OUTRO produto: sequência de movimentos)', 'POST /movimentacoes-estoque (sequência de movimentos)'], 3],
      [['PATCH /produtos (linha do produto)', 'PUT do perfil (perfil em FOR SHARE)', 'PATCH de lote livre (trava do produto)'], 2],
      [['PATCH /movimentacoes-estoque (linha do movimento original)', 'DELETE de lote livre (trava do produto)'], 2],
    ];
    /** @type {Record<string, any>} */
    const vitimas = {};
    for (const [nomes, minimo] of ondas) {
      try {
        await aux.$transaction(async (tx) => {
          const [{ pid }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
          // As MESMAS travas que confirmar/cancelar seguram durante os efeitos (§8.4).
          await travarProdutosEstoque(tx, s.c, e.id, [e.sal.id]);
          await reservarNumeros(tx, { clienteId: s.c, entidade: 'MovimentacaoEstoque', escopoTipo: ESCOPO_TENANT }, 1);
          await tx.$queryRaw`SELECT id FROM "PerfilFinanceiroEmpresa" WHERE cliente_id = ${s.c} AND empresa_id = ${e.id} FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM "MovimentacaoEstoque" WHERE cliente_id = ${s.c} AND id = ${original.id} FOR UPDATE`;
          for (const nome of nomes) vitimas[nome] = acompanhar(pedidos[nome]());
          await esperar(async () => (await bloqueadosPor(pid)).length >= minimo, `${minimo} comandos esperando as travas`);
          // CENÁRIO (não sincronização): a trava fica segura 6 s — além dos 5 s do
          // timeout padrão do Prisma e abaixo do lock_timeout de TRANSACAO_CURTA.
          await new Promise((r) => setTimeout(r, 6000));
          const cedo = nomes.filter((nome) => vitimas[nome].feito && !nome.startsWith('PATCH de lote'));
          assert.deepEqual(cedo.map((nome) => `${nome}: ${resumo(vitimas[nome])}`), [], 'nenhum comando pode desistir (500) enquanto a trava está segura');
        }, { maxWait: 10000, timeout: 60000 });
      } finally {
        await Promise.allSettled(nomes.filter((nome) => vitimas[nome]).map((nome) => vitimas[nome].p));
      }
    }
    const tabela = Object.entries(vitimas).map(([nome, v]) => `${nome}: ${resumo(v)}`).join('\n');
    for (const [nome, v] of Object.entries(vitimas)) assert.ok(v.r.statusCode < 300, `${nome} → ${v.r.body}\n${tabela}`);
    // retentativa com a MESMA operation_id: replay, efeito uma vez só
    const sup2 = await A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, corpoSup);
    const tr2 = await A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, corpoTransf);
    assert.deepEqual([sup2.statusCode < 300, sup2.json().replay, tr2.statusCode < 300, tr2.json().replay], [true, true, true, true], `${sup2.body}\n${tr2.body}`);
    assert.equal(await estoqueAtual(e.sal), '105.0000', 'suplementação aplicada uma vez só');
    assert.deepEqual(
      [await somaLotes({ cliente_id: s.c, produto_id: e.milho.id, local_estoque_id: s.local.id }), await somaLotes({ cliente_id: s.c, produto_id: e.milho.id, local_estoque_id: s.local2.id })],
      ['95.0000', '5.0000'],
      'transferência aplicada uma vez só',
    );
    const perfil = await p.perfilFinanceiroEmpresa.findFirst({ where: { cliente_id: s.c, empresa_id: e.id } });
    assert.equal(perfil.locale, 'pt-PT');
    assert.equal((await p.movimentacaoEstoque.findUnique({ where: { id: original.id } })).local_destino, nomeNovo, 'renomeação gravada no movimento');
    assert.equal(await p.estoqueLoteNota.count({ where: { id: livre2.id } }), 0, 'lote livre excluído');
    assert.equal(await p.auditLog.count({ where: { cliente_id: s.c, acao: 'perfil_financeiro.atualizar' } }), 1, 'locale gravado exatamente uma vez');
  });

  test('helper compartilhado: timeout da transação (P2028) e deadlock (40P01) viram 409 CONCURRENCY_CONFLICT; quem venceu a corrida segue; AppError e erro comum passam intactos', async () => {
    const { emTransacao } = await import('../src/shared/prisma/transacaoConcorrente.js');
    const timeout = await emTransacao({ maxWait: 5000, timeout: 300 }, async (tx) => {
      await tx.$executeRaw`SELECT pg_sleep(0.8)`;
      await tx.$executeRaw`SELECT 1`;
    }).then(() => null, (erro) => erro);
    assert.equal(timeout?.code, 'CONCURRENCY_CONFLICT', `timeout: ${timeout?.code} ${timeout?.message}`);
    /** @type {(v?: unknown) => void} */
    let temA = () => {};
    /** @type {(v?: unknown) => void} */
    let temB = () => {};
    const aPronto = new Promise((r) => { temA = r; });
    const bPronto = new Promise((r) => { temB = r; });
    const opcoes = { maxWait: 5000, timeout: 20000 };
    const t1 = emTransacao(opcoes, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(154, 11)`;
      temA();
      await bPronto;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(154, 12)`;
      return 't1';
    });
    const t2 = emTransacao(opcoes, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(154, 12)`;
      temB();
      await aPronto;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(154, 11)`;
      return 't2';
    });
    const r = await Promise.allSettled([t1, t2]);
    const perdeu = r.filter((x) => x.status === 'rejected').map((x) => /** @type {any} */ (x).reason);
    const venceu = r.filter((x) => x.status === 'fulfilled');
    assert.deepEqual([perdeu.length, venceu.length], [1, 1], JSON.stringify(r.map((x) => x.status)));
    assert.equal(perdeu[0].code, 'CONCURRENCY_CONFLICT', `deadlock: ${perdeu[0]?.code} ${perdeu[0]?.message}`);
    const { AppError } = await import('../src/shared/errors/AppError.js');
    const negocio = await emTransacao(opcoes, async () => { throw new AppError('OPERACAO_STATUS_INVALIDO', 'x'); }).then(() => null, (erro) => erro);
    assert.equal(negocio.code, 'OPERACAO_STATUS_INVALIDO');
    const comum = await emTransacao(opcoes, async () => { throw new Error('qualquer'); }).then(() => null, (erro) => erro);
    assert.equal(comum.message, 'qualquer');
  });

  test('prazo estourado (P2028) não deixa efeito parcial nem sucesso falso: a escrita feita antes do estouro some e o comando repetido com a mesma operation_id grava uma vez', async () => {
    const { emTransacao } = await import('../src/shared/prisma/transacaoConcorrente.js');
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const nomeAntes = (await p.produto.findUnique({ where: { id: e.racao.id } })).nome_produto;
    const estouro = await emTransacao({ maxWait: 5000, timeout: 300 }, async (tx) => {
      await tx.produto.update({ where: { id: e.racao.id }, data: { nome_produto: 'GRAVADO ANTES DO ESTOURO' } });
      await tx.$executeRaw`SELECT pg_sleep(0.8)`;
      await tx.$executeRaw`SELECT 1`;
      return 'sucesso falso';
    }).then((v) => ({ v }), (erro) => ({ erro }));
    assert.equal(estouro.v, undefined, 'a transação estourada nunca devolve sucesso');
    assert.equal(estouro.erro?.code, 'CONCURRENCY_CONFLICT', `${estouro.erro?.code} ${estouro.erro?.message}`);
    assert.equal((await p.produto.findUnique({ where: { id: e.racao.id } })).nome_produto, nomeAntes, 'nada do que foi escrito antes do estouro ficou');
    // Do lado do cliente, prazo estourado = resposta perdida: repetir com a MESMA
    // operation_id confirma uma vez só (replay), sem segundo lote nem segundo título.
    const d = await A.criar(s.token, docCom(e, s.local, [item(e.racao, '10', '3', { unidade: 'KG' })]));
    const chave = opId();
    const r1 = await A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, { empresa_id: e.id, operation_id: chave, versao: d.versao });
    const depois = await foto(s.c);
    const r2 = await A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, { empresa_id: e.id, operation_id: chave, versao: d.versao });
    assert.deepEqual([r1.statusCode, r2.statusCode, r2.json().replay], [200, 200, true], r2.body);
    assert.equal(await foto(s.c), depois, 'o reenvio não grava nada novo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C7 — CRITICO-1 (rodada 2): comandos chamados com os 20 s do navegador têm resposta DEFINITIVA antes dele desistir', () => {
  /**
   * O detentor (pool do TESTE) segura as travas de confirmar/cancelar por mais
   * tempo do que o servidor aceita esperar (lock_timeout de TRANSACAO_CURTA).
   * Cada vítima tem de responder 409 CONCURRENCY_CONFLICT bem antes dos 20 s
   * e, AINDA COM A TRAVA SEGURA, já não pode haver transação dela no banco:
   * nada pode commitar depois. Ondas de até 3 vítimas (cabe em pool ≥ 3).
   */
  test('suplementação, transferência, POST e PATCH de movimento, PATCH de produto, PATCH e DELETE de lote e PUT do perfil: 409 em ≈ 8 s (< 12 s), nenhuma transação viva depois do 409, nada gravado depois de soltar a trava; o reenvio com chave NOVA aplica uma vez', async (t) => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.sal, s.local, { kg: '100' });
    await loteLegado(s, e, e.milho, s.local, { kg: '100' });
    const loteP = await loteLegado(s, e, e.sal, s.local2, { kg: '10' });
    const loteD = await loteLegado(s, e, e.sal, s.local2, { kg: '0', disponivel: '0', status: 'Esgotado' });
    await definirEstoqueAtual(e.sal, '110');
    await definirEstoqueAtual(e.milho, '100');
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.racao, '1', '30')]));
    const original = await p.movimentacaoEstoque.findFirst({ where: { cliente_id: s.c, lancamento_origem_id: compra.id } });
    const nomeAntigo = original.local_destino;
    const nomeNovo = `DEPOSITO RENOMEADO ${s.c}`;
    await p.localEstoque.update({ where: { id: s.local.id }, data: { nome: nomeNovo } });
    const antes = await foto([s.c]);
    const [k1, k2] = [opId(), opId()];
    const pedidos = {
      'suplementação (formulário antigo, chave K1)': () => suplementar(s, e, e.sal, s.local, 10, k1),
      'transferência (formulário antigo, chave K2)': () => A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, {
        operation_id: k2, empresa_id: e.id, produto_id: e.milho.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 10,
      }),
      'POST /movimentacoes-estoque': () => A.req('POST', '/movimentacoes-estoque', s.token, {
        empresa_id: e.id, tipo_movimentacao: 'Entrada', data_movimentacao: '2027-06-10T12:00:00.000Z', produto_id: e.milho.id, quantidade: 3, unidade_medida: 'KG', local_estoque_destino: s.local.id,
      }),
      'PATCH /produtos': () => A.req('PATCH', `/produtos/${e.sal.id}`, s.token, { estoque_minimo: 3 }),
      'PATCH de lote': () => A.req('PATCH', `/estoque-lotes-nota/${loteP.id}`, s.token, { custo_unitario: 2.5 }),
      'DELETE de lote': () => A.req('DELETE', `/estoque-lotes-nota/${loteD.id}`, s.token),
      'PATCH /movimentacoes-estoque (renomeação de depósito)': () => A.req('PATCH', `/movimentacoes-estoque/${original.id}`, s.token, { local_destino: nomeNovo }),
      'PUT do perfil (tela nova, 20 s padrão)': () => A.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: e.id, pais: 'BR', moeda: 'BRL', locale: 'pt-PT' }),
    };
    const ondas = [
      ['suplementação (formulário antigo, chave K1)', 'transferência (formulário antigo, chave K2)', 'POST /movimentacoes-estoque'],
      ['PATCH /produtos', 'PATCH de lote', 'DELETE de lote'],
      ['PATCH /movimentacoes-estoque (renomeação de depósito)', 'PUT do perfil (tela nova, 20 s padrão)'],
    ];
    /** @type {Record<string, any>} */
    const vitimas = {};
    /** @type {string[]} */
    const vivasComATrava = [];
    const DESFAZ = 'p3c7-desfaz-detentor';
    for (const nomes of ondas) {
      try {
        await aux.$transaction(async (tx) => {
          const [{ pid }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
          await travarProdutosEstoque(tx, s.c, e.id, [e.sal.id, e.milho.id]);
          await reservarNumeros(tx, { clienteId: s.c, entidade: 'MovimentacaoEstoque', escopoTipo: ESCOPO_TENANT }, 1);
          await tx.$queryRaw`SELECT id FROM "PerfilFinanceiroEmpresa" WHERE cliente_id = ${s.c} AND empresa_id = ${e.id} FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM "MovimentacaoEstoque" WHERE cliente_id = ${s.c} AND id = ${original.id} FOR UPDATE`;
          for (const nome of nomes) vitimas[nome] = acompanhar(pedidos[nome]());
          await esperar(async () => (await bloqueadosPor(pid)).length >= nomes.length, `${nomes.length} comandos esperando as travas`);
          // CENÁRIO: as travas ficam seguras além do que o servidor aceita
          // esperar (até 15 s, mais do que o lock_timeout de 8 s).
          const limite = Date.now() + 15000;
          while (Date.now() < limite && !nomes.every((nome) => vitimas[nome].feito)) await new Promise((r) => setTimeout(r, 50));
          // Ainda com a trava segura: ninguém mais esperando por ela e nenhuma transação aberta além da do detentor.
          const presos = await bloqueadosPor(pid);
          const abertas = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> ${pid}::int AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`);
          if (presos.length || abertas.length) vivasComATrava.push(`${nomes.join(', ')}: ${presos.length} esperando, ${abertas.length} abertas`);
          // O detentor VOLTA (a reserva de número dele não pode sujar a foto do banco).
          throw new Error(DESFAZ);
        }, { maxWait: 10000, timeout: 60000 }).catch((erro) => { if (erro?.message !== DESFAZ) throw erro; });
      } finally {
        await Promise.allSettled(nomes.map((nome) => vitimas[nome].p));
      }
    }
    const tabela = Object.entries(vitimas).map(([nome, v]) => `${nome}: ${resumo(v)}`).join('\n');
    t.diagnostic(tabela);
    for (const [nome, v] of Object.entries(vitimas)) {
      assert.equal(`${v.r.statusCode} ${corpoDe(v.r)?.code}`, '409 CONCURRENCY_CONFLICT', `${nome} → ${v.r.body}\n${tabela}`);
      assert.ok(v.ms >= 7000 && v.ms < 12000, `${nome}: o 409 vem do lock_timeout (≈ 8 s), bem antes dos 20 s do navegador — ${v.ms} ms\n${tabela}`);
    }
    assert.deepEqual(vivasComATrava, [], 'depois do 409 a transação perdedora já acabou no banco (não commita quando a trava soltar)');
    // Trava solta: nada do que recebeu 409 aparece depois.
    assert.deepEqual(await foto([s.c]), antes, 'nenhuma linha mudou: movimentos, lotes, estoque, perfil, recibos e auditoria');
    assert.equal((await p.movimentacaoEstoque.findUnique({ where: { id: original.id } })).local_destino, nomeAntigo);
    assert.equal(await p.operacaoIdempotente.count({ where: { cliente_id: s.c, operation_key: { in: [k1, k2] } } }), 0, 'nenhum recibo das chaves K1/K2');
    // O usuário viu o erro e reenvia o MESMO formulário (chave NOVA): uma baixa só.
    const sup2 = await suplementar(s, e, e.sal, s.local, 10);
    const tr2 = await A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, {
      operation_id: opId(), empresa_id: e.id, produto_id: e.milho.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 10,
    });
    assert.deepEqual([sup2.statusCode, tr2.statusCode], [201, 201], `${sup2.body}\n${tr2.body}`);
    assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: 'suplementacao' } }), 1, 'uma suplementação só');
    assert.equal(await estoqueAtual(e.sal), '100.0000', 'uma baixa só (110 − 10)');
    assert.deepEqual(
      [await somaLotes({ cliente_id: s.c, produto_id: e.milho.id, local_estoque_id: s.local.id }), await somaLotes({ cliente_id: s.c, produto_id: e.milho.id, local_estoque_id: s.local2.id })],
      ['90.0000', '10.0000'],
      'uma transferência só',
    );
  });
});

describe('C8 — CRITICO-3 (rodada 2): renomear depósito durante um cancelamento longo', () => {
  test('PATCH {local_destino} do movimento original que o cancelamento travou: espera o cancelamento (6 s) e responde 200 com o nome gravado (nunca 500 com a renomeação pela metade)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '10', '2')]));
    const original = await p.movimentacaoEstoque.findFirst({ where: { cliente_id: s.c, lancamento_origem_id: compra.id } });
    const nomeNovo = `DEPOSITO RENOMEADO ${s.c}`;
    await p.localEstoque.update({ where: { id: s.local.id }, data: { nome: nomeNovo } });
    // O cancelamento para no portão DEPOIS dos efeitos (original já 'Estornada' e travado): no registro de auditoria.
    await instalarPortao(s, 'AuditLog', `NEW.acao = 'operacao_financeira.cancelar'`);
    /** @type {any[]} */
    const pend = [];
    /** @type {any} */
    let canc;
    /** @type {any} */
    let patch;
    try {
      await comPortaoFechado(async () => {
        canc = acompanhar(cancelar(s, compra, e));
        pend.push(canc);
        const [pidCanc] = await esperar(paradosNoPortao, 'cancelamento parado depois de marcar o original');
        patch = acompanhar(A.req('PATCH', `/movimentacoes-estoque/${original.id}`, s.token, { local_destino: nomeNovo }));
        pend.push(patch);
        await esperar(async () => patch.feito || (await bloqueadosPor(pidCanc)).length > 0, 'PATCH esperando a linha do movimento');
        // CENÁRIO: o cancelamento segura a linha 6 s (além dos 5 s padrão do Prisma).
        await new Promise((r) => setTimeout(r, 6000));
        assert.equal(patch.feito, false, `o PATCH não pode desistir enquanto o cancelamento segura a linha: ${resumo(patch)} ${patch.r?.body}`);
      });
    } finally {
      await Promise.allSettled(pend.map((a) => a.p));
      await removerPortao('AuditLog');
    }
    assert.equal(canc.r.statusCode, 200, canc.r.body);
    assert.equal(patch.r.statusCode, 200, `PATCH durante o cancelamento: ${resumo(patch)} ${patch.r.body}`);
    const depois = await p.movimentacaoEstoque.findUnique({ where: { id: original.id } });
    assert.deepEqual([depois.local_destino, depois.status], [nomeNovo, 'Estornada'], 'nome gravado; o estorno do cancelamento intacto');
  });
});

describe('C3 — CONCORRENCIA-2: janela da sequência de movimentos do tenant', () => {
  test('confirmar e cancelar só reservam os números de movimento DEPOIS dos efeitos: a suplementação de OUTRO produto conclui enquanto o comando está parado no meio; números finais numéricos, distintos e posteriores', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.milho, s.local, { kg: '100' });
    await definirEstoqueAtual(e.milho, '100');
    const compra = await A.criar(s.token, docCom(e, s.local, [item(e.sal, '10', '2'), item(e.sal, '5', '2'), item(e.sal, '1', '2')]));
    await instalarPortao(s, 'MovimentacaoEstoque', `NEW.origem_sistema = 'operacao_financeira'`);
    /** @type {any[]} */
    const pend = [];
    /**
     * @param {() => Promise<any>} comando
     * @param {string} rotulo
     */
    const suplementarDurante = async (comando, rotulo) => {
      /** @type {any} */
      let cmd;
      /** @type {any} */
      let sup;
      await comPortaoFechado(async () => {
        cmd = acompanhar(comando());
        pend.push(cmd);
        const [pid] = await esperar(paradosNoPortao, `${rotulo} parado no primeiro movimento`);
        sup = acompanhar(suplementar(s, e, e.milho, s.local, 1));
        pend.push(sup);
        await esperar(async () => sup.feito || (await bloqueadosPor(pid)).length > 0, `suplementação durante ${rotulo}`);
        assert.equal(sup.feito, true, `a suplementação de OUTRO produto ficou presa atrás de ${rotulo} (sequência de movimentos do tenant segura durante os efeitos)`);
        assert.equal(sup.r.statusCode, 201, sup.r.body);
        assert.equal(cmd.feito, false, `${rotulo} ainda parado no portão`);
      });
      await cmd.p;
      assert.equal(cmd.r.statusCode, 200, cmd.r.body);
      return { cmd: cmd.r.json(), sup: sup.r.json() };
    };
    try {
      const { cmd: confirmado } = await suplementarDurante(() => A.confirmarReq(s.token, compra, e.id), 'a confirmação');
      const { cmd: cancelado } = await suplementarDurante(() => cancelar(s, confirmado, e), 'o cancelamento');
      assert.equal(cancelado.status, 'CANCELADO');
    } finally {
      await Promise.allSettled(pend.map((a) => a.p));
      await removerPortao('MovimentacaoEstoque');
    }
    const movs = await p.movimentacaoEstoque.findMany({ where: { cliente_id: s.c }, orderBy: { createdAt: 'asc' } });
    for (const m of movs) assert.match(m.numero_movimentacao, /^\d+$/, `número final numérico (${m.tipo_detalhado}: ${m.numero_movimentacao})`);
    assert.equal(new Set(movs.map((m) => m.numero_movimentacao)).size, movs.length, 'números distintos');
    const num = (tipo) => movs.filter((m) => m.tipo_detalhado === tipo).map((m) => Number(m.numero_movimentacao));
    const [sup1, sup2] = num('suplementacao');
    assert.ok(num('compra_financeiro').every((n) => n > sup1), `a confirmação numera depois da suplementação que passou na frente (${num('compra_financeiro')} × ${sup1})`);
    assert.ok(num('estorno_compra').every((n) => n > sup2), `o cancelamento numera depois da suplementação que passou na frente (${num('estorno_compra')} × ${sup2})`);
    const compras = num('compra_financeiro');
    assert.deepEqual(compras, [...compras].sort((a, b) => a - b), 'na ordem dos itens');
    assert.deepEqual([await estoqueAtual(e.sal), await estoqueAtual(e.milho)], ['0.0000', '98.0000']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C4 — CONCORRENCIA-4 e ESTOQUE-3: rascunho esperando produto travado', () => {
  test('o rascunho que espera o produto de uma confirmação em curso NÃO segura a sequência de documentos do tenant: o rascunho sem produtos passa na frente e o que esperava conclui depois (números na ordem de reserva)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criar(s.token, docCom(e, s.local, [item(e.sal, '10', '2')]));
    await instalarPortao(s, 'MovimentacaoEstoque', `NEW.origem_sistema = 'operacao_financeira'`);
    /** @type {any[]} */
    const pend = [];
    /** @type {any} */
    let conf;
    /** @type {any} */
    let rA;
    /** @type {any} */
    let rB;
    try {
      await comPortaoFechado(async () => {
        conf = acompanhar(A.confirmarReq(s.token, compra, e.id));
        pend.push(conf);
        const [pidConf] = await esperar(paradosNoPortao, 'confirmação parada com o produto travado');
        rA = acompanhar(A.req('POST', '/operacoes-financeiras', s.token, { ...docCom(e, s.local, [item(e.sal, '1', '3')]), operation_id: opId() }));
        pend.push(rA);
        const [pidA] = await esperar(() => algunsBloqueadosPor(pidConf), 'rascunho A esperando o produto travado');
        rB = acompanhar(A.req('POST', '/operacoes-financeiras', s.token, { ...docSem(e), operation_id: opId() }));
        pend.push(rB);
        await esperar(async () => rB.feito || (await bloqueadosPor(pidA)).length > 0, 'rascunho B (sem produtos)');
        assert.equal(rB.feito, true, 'o rascunho SEM produtos ficou na fila atrás do rascunho que espera o produto (sequência de documentos do tenant segura por quem espera)');
        assert.equal(rB.r.statusCode, 201, rB.r.body);
        assert.equal(rA.feito, false, 'A continua esperando a confirmação');
      });
    } finally {
      await Promise.allSettled(pend.map((a) => a.p));
      await removerPortao('MovimentacaoEstoque');
    }
    assert.equal(conf.r.statusCode, 200, conf.r.body);
    assert.equal(rA.r.statusCode, 201, rA.r.body);
    assert.ok(Number(rB.r.json().numero) < Number(rA.r.json().numero), `B reservou antes de A (${rB.r.json().numero} × ${rA.r.json().numero})`);
  });

  test('PUT do rascunho que passa a ter o produto travado: espera a confirmação ANTES de apagar os filhos e conclui depois', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criar(s.token, docCom(e, s.local, [item(e.sal, '10', '2')]));
    const outro = await A.criar(s.token, docCom(e, s.local, [item(e.milho, '2', '3')]));
    await instalarPortao(s, 'MovimentacaoEstoque', `NEW.origem_sistema = 'operacao_financeira'`);
    /** @type {any[]} */
    const pend = [];
    /** @type {any} */
    let put;
    try {
      await comPortaoFechado(async () => {
        const conf = acompanhar(A.confirmarReq(s.token, compra, e.id));
        pend.push(conf);
        const [pidConf] = await esperar(paradosNoPortao, 'confirmação parada com o produto travado');
        put = acompanhar(A.req('PUT', `/operacoes-financeiras/${outro.id}`, s.token, { ...docCom(e, s.local, [item(e.sal, '2', '3')]), versao: outro.versao }));
        pend.push(put);
        await esperar(() => algunsBloqueadosPor(pidConf), 'PUT esperando o produto travado');
        // Os filhos do rascunho continuam lá enquanto ele espera (nada apagado antes da trava do produto).
        const [{ n }] = /** @type {any[]} */ (await aux.$queryRaw`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
          WHERE l.pid = ANY(${await bloqueadosPor(pidConf)}::int[]) AND c.relname = 'OperacaoFinanceiraItem' AND l.mode = 'RowExclusiveLock'`);
        assert.equal(n, 0, 'o PUT não pode ter apagado os itens antes de travar o produto');
      });
    } finally {
      await Promise.allSettled(pend.map((a) => a.p));
      await removerPortao('MovimentacaoEstoque');
    }
    assert.equal(put.r.statusCode, 200, put.r.body);
    assert.deepEqual(put.r.json().itens.map((i) => i.produto_id), [e.sal.id]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C5 — CONCORRENCIA-5: replay do POST depois do descarte', () => {
  test('POST (chave K) → DELETE → POST com a MESMA K: 409 IDEMPOTENCY_EFEITO_EXCLUIDO, nada gravado (nunca 200 com o documento apagado); chave nova cria; outro rascunho segue com replay normal', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const doc = docSem(e);
    const K = opId();
    const criado = await A.ok(A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: K }), 201);
    const outroK = opId();
    const outro = await A.ok(A.req('POST', '/operacoes-financeiras', s.token, { ...docSem(e, { valor_bruto: '70.00', rateios: [{ natureza_id: e.desp.id, valor: '70.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '70.00' }] }), operation_id: outroK }), 201);
    await A.ok(A.req('DELETE', `/operacoes-financeiras/${criado.id}?empresa_id=${e.id}&versao=${criado.versao}`, s.token), 204);
    const antes = await foto(s.c);
    const replay = await A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: K });
    assert.equal(replay.statusCode, 409, `replay depois do descarte: ${replay.body}`);
    assert.equal(codigo(replay), 'IDEMPOTENCY_EFEITO_EXCLUIDO');
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // o outro rascunho (não descartado) continua com replay normal
    const replayOutro = await A.req('POST', '/operacoes-financeiras', s.token, { ...docSem(e, { valor_bruto: '70.00', rateios: [{ natureza_id: e.desp.id, valor: '70.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '70.00' }] }), operation_id: outroK });
    assert.deepEqual([replayOutro.statusCode, replayOutro.json().replay, replayOutro.json().id], [200, true, outro.id]);
    // editado (PUT) e descartado: o recibo da criação também vira EXCLUIDO
    const K2 = opId();
    const r2 = await A.ok(A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: K2 }), 201);
    const put = await A.ok(A.req('PUT', `/operacoes-financeiras/${r2.id}`, s.token, { ...docSem(e, { descricao: 'editado' }), versao: r2.versao }));
    await A.ok(A.req('DELETE', `/operacoes-financeiras/${r2.id}?empresa_id=${e.id}&versao=${put.versao}`, s.token), 204);
    const replay2 = await A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: K2 });
    assert.deepEqual([replay2.statusCode, codigo(replay2)], [409, 'IDEMPOTENCY_EFEITO_EXCLUIDO'], replay2.body);
    // a chave nova cria normalmente
    const novo = await A.ok(A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: opId() }), 201);
    assert.equal(novo.replay, false);
    assert.deepEqual((await p.operacaoFinanceira.findMany({ where: { cliente_id: s.c }, select: { id: true }, orderBy: { id: 'asc' } })).map((o) => o.id), [outro.id, novo.id].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C6 — ESTOQUE-1: kg replanejado na confirmação vai para o item', () => {
  test('compra: peso por saco alterado entre o rascunho e a confirmação → item, lote, movimento e estoque_atual com o MESMO kg; o cancelamento estorna exatamente', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criar(s.token, docCom(e, s.local, [item(e.racao, '10', '80', { unidade: 'SACO' })]));
    assert.deepEqual([d.itens[0].fator_kg, d.itens[0].quantidade_estoque], ['30.0000', '300.0000']);
    const patch = await A.req('PATCH', `/produtos/${e.racao.id}`, s.token, { peso_por_saco_kg: 50 });
    assert.equal(patch.statusCode, 200, patch.body);
    const c = await A.confirmar(s.token, d, e.id);
    const lote = await p.estoqueLoteNota.findFirst({ where: { cliente_id: s.c, produto_id: e.racao.id } });
    const mov = await p.movimentacaoEstoque.findFirst({ where: { cliente_id: s.c, produto_id: e.racao.id, tipo_detalhado: 'compra_financeiro' } });
    assert.deepEqual(
      [c.itens[0].fator_kg, c.itens[0].quantidade_estoque, lote.quantidade_entrada.toFixed(4), mov.quantidade.toFixed(4), await estoqueAtual(e.racao)],
      ['50.0000', '500.0000', '500.0000', '500.0000', '500.0000'],
      'item = lote = movimento = estoque_atual (§8.2)',
    );
    const canc = await cancelar(s, c, e);
    assert.equal(canc.statusCode, 200, `cancelar a compra intocada: ${canc.body}`);
    assert.deepEqual([(await p.estoqueLoteNota.findUnique({ where: { id: lote.id } })).status, await estoqueAtual(e.racao)], ['Estornado', '0.0000']);
    const estorno = await p.movimentacaoEstoque.findFirst({ where: { cliente_id: s.c, tipo_detalhado: 'estorno_compra' } });
    assert.equal(estorno.quantidade.toFixed(4), '500.0000');
  });

  test('venda: peso por saco alterado entre o rascunho e a confirmação → item = Σ fatias = movimento; o cancelamento devolve as fatias e o estoque_atual', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const L = await loteLegado(s, e, e.racao, s.local, { kg: '1000', custo: '1.0000' });
    await definirEstoqueAtual(e.racao, '1000');
    const d = await rascunhoVenda(s, e, [item(e.racao, '2', '100', { unidade: 'SACO' })]);
    assert.equal(d.itens[0].quantidade_estoque, '60.0000');
    const patch = await A.req('PATCH', `/produtos/${e.racao.id}`, s.token, { peso_por_saco_kg: 40 });
    assert.equal(patch.statusCode, 200, patch.body);
    const c = await A.confirmar(s.token, d, e.id);
    const fatias = await p.operacaoFinanceiraConsumoLote.aggregate({ _sum: { quantidade: true }, where: { cliente_id: s.c } });
    const mov = await p.movimentacaoEstoque.findFirst({ where: { cliente_id: s.c, tipo_detalhado: 'venda_financeiro' } });
    assert.deepEqual(
      [c.itens[0].fator_kg, c.itens[0].quantidade_estoque, fatias._sum.quantidade.toFixed(4), mov.quantidade.toFixed(4), await estoqueAtual(e.racao)],
      ['40.0000', '80.0000', '80.0000', '80.0000', '920.0000'],
      'item = Σ fatias = movimento (§8.2)',
    );
    const canc = await cancelar(s, c, e);
    assert.equal(canc.statusCode, 200, `cancelar a venda: ${canc.body}`);
    assert.deepEqual([(await p.estoqueLoteNota.findUnique({ where: { id: L.id } })).quantidade_disponivel.toFixed(4), await estoqueAtual(e.racao)], ['1000.0000', '1000.0000']);
  });
});

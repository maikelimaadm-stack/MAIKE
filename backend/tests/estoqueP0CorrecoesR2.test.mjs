/**
 * D-PROD-161 — MAIKE-ESTOQUE-P0-01, fechamento R2: correções dos achados das
 * lentes adversariais A (integridade/FIFO), B (concorrência/AuditLog) e C
 * (crescimento da reconciliação). PostgreSQL real, HTTP autenticado; cada
 * teste nasceu RED contra o código da árvore e prova o contrato corrigido.
 *
 *  A01  camada do MOTOR com data < 2002 (copiada de uma camada legada numa
 *       retransferência) não é "bug 2001": uma divergência física real nela
 *       continua DIVERGENCIA_REAL; a camada legada continua LIMITACAO_LEGADA.
 *  A02  camada de origem sem `data_documento`: a camada transferida recebe o
 *       dia UTC do `createdAt` da origem (a idade FIFO real), nunca o dia
 *       escolhido em `data_movimentacao` (inclusive 0001-01-01).
 *  A03  retificação NO_LUGAR leva a procedência também às camadas nascidas do
 *       lote por transferência do motor (linhagem JSON, transitiva).
 *  B01  renomeação do lote concorrente com a baixa do motor: o AuditLog sai do
 *       estado TRAVADO (quantidade igual dos dois lados) e não mascara a
 *       divergência real seguinte.
 *  B02  idem para o PATCH /produtos sem `empresa_id` (cliente de API).
 *  C01  rajada de recibos na janela das saídas legadas: leitura LINEAR dos
 *       recibos (cada um no máximo uma vez por consulta), contada na
 *       pré-contagem da página.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, docCom, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import { ACAO_PROCEDENCIA_LOTE } from '../src/modules/financeiro/operacaoFinanceiraService.js';
import { lerReconciliacao } from '../src/modules/estoqueFisico/reconciliacaoEstoque.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** Pool PRÓPRIO do teste (portão de advisory, `pg_blocking_pids`, estatística da transação). @type {PrismaClient} */
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

const URL_SUP = '/movimentacoes-estoque/comandos/saida-suplementacao';
const URL_TRANSF = '/movimentacoes-estoque/comandos/transferencia-locais';
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });
const q4 = (v) => Number(v).toFixed(4);
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const lote = (id) => prisma().estoqueLoteNota.findUnique({ where: { id } });
const suplementar = (s, e, produto, local, quantidade) =>
  A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: local.id, quantidade });
const transferir = (s, e, produto, origem, destino, quantidade, extra = {}) =>
  A.req('POST', URL_TRANSF, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade, ...extra });
const relatorio = async (s, query = '') => {
  const r = await A.req('GET', `/estoque-fisico/reconciliacao?limite=2000${query}`, s.token);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
/** `nivel/classe/regra` dos achados cuja chave tem `campo = id`. */
const achados = (rel, nivel, campo, id) => rel.achados.filter((a) => a.nivel === nivel && a.chave?.[campo] === id).map((a) => `${a.classe}/${a.regra}`);
let seq = 0;
/** Movimento escrito direto no banco (formato legado). */
const movimento = (s, e, produto, dados) =>
  prisma().movimentacaoEstoque.create({
    data: {
      cliente_id: s.c, empresa_id: e.id, produto_id: produto.id, produto_nome: produto.nome_produto, unidade_medida: 'KG',
      data_movimentacao: new Date('2027-06-11T12:00:00.000Z'), numero_movimentacao: `R2FIX-${(seq += 1)}-${randomUUID().slice(0, 6)}`, status: 'Ativa', ...dados,
    },
  });
const recibo = (s, tipo, corpo) =>
  prisma().operacaoIdempotente.create({
    data: { cliente_id: s.c, operation_key: opId(), tipo_operacao: tipo, fingerprint: randomUUID().replace(/-/g, ''), status: 'committed', http_status: 201, response_json: corpo },
  });
/** Camada sem `data_documento` (legado/import), com o `createdAt` escolhido. */
const camadaSemData = (s, e, produto, local, { kg, custo, createdAt }) =>
  prisma().estoqueLoteNota.create({
    data: {
      cliente_id: s.c, empresa_id: e.id, produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_id: local.id, local_estoque_nome: local.nome,
      data_documento: null, custo_unitario: custo, quantidade_entrada: kg, quantidade_disponivel: kg, status: 'Disponivel', createdAt,
    },
  });
const camadaComData = (s, e, produto, local, { kg, custo, dia: d }) =>
  prisma().estoqueLoteNota.create({
    data: {
      cliente_id: s.c, empresa_id: e.id, produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_id: local.id, local_estoque_nome: local.nome,
      data_documento: new Date(`${d}T00:00:00.000Z`), custo_unitario: custo, quantidade_entrada: kg, quantidade_disponivel: kg, status: 'Disponivel',
    },
  });
const definirEstoqueAtual = (s, produto, valor) =>
  prisma().produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: produto.id } }, data: { estoque_atual: valor } });

// ─── portão determinístico (par de advisory PRÓPRIO deste arquivo: 161, 7) ────
const PORTAO = 'p0r2fix_portao';
const instalarPortao = async (s, tabela, momento, condicao = 'TRUE') => {
  const p = prisma();
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(161, 7); RETURN NEW; END $f$`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
  await p.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} ${momento} ON "${tabela}" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND ${condicao}) EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = (tabela) => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(161, 7)`;
    return fn();
  }, { maxWait: 10000, timeout: 60000 });
const paradosNoPortao = async () => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 161 AND objid = 7 AND objsubid = 2 AND NOT granted`);
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
  /** @type {{ feito: boolean, r: any, p: Promise<any> }} */
  const a = { feito: false, r: null, p: Promise.resolve() };
  a.p = Promise.resolve(pedido).then((r) => {
    Object.assign(a, { feito: true, r });
    return r;
  });
  return a;
};
/**
 * A suplementação faz o CAS no lote e PARA no portão (UPDATE do cache do produto, ainda com a
 * transação aberta); `escritor()` começa e precisa ESPERAR por ela; solto o portão, os dois commitam.
 */
const corridaComBaixa = async (s, e, produto, escritor) => {
  await instalarPortao(s, 'Produto', 'BEFORE UPDATE', `NEW.estoque_atual IS DISTINCT FROM OLD.estoque_atual AND NEW.id = '${produto.id}'`);
  /** @type {any} */ let r1;
  /** @type {any} */ let r2;
  try {
    await comPortaoFechado(async () => {
      r1 = acompanhar(suplementar(s, e, produto, s.local, 10));
      const [pid] = await esperar(async () => (r1.feito ? [null] : paradosNoPortao()), 'suplementação parada no portão');
      assert.equal(r1.feito, false, `a suplementação tinha de parar no portão: ${r1.r?.body}`);
      r2 = acompanhar(escritor());
      await esperar(async () => r2.feito || (await bloqueadosPor(pid)).length > 0, 'escritor esperando a baixa');
      assert.equal(r2.feito, false, `o escritor tinha de esperar a baixa: ${r2.r?.statusCode} ${r2.r?.body}`);
    });
  } finally {
    await Promise.allSettled([r1?.p, r2?.p].filter(Boolean));
    await removerPortao('Produto');
  }
  assert.equal(r1.r.statusCode, 201, r1.r.body);
  assert.equal(r2.r.statusCode, 200, r2.r.body);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('A — integridade da camada transferida (lente A)', () => {
  test('A01: retransferência pelo motor de uma camada legada de 2001 → a camada NOVA (linhagem do motor) não é "bug 2001": limpa sem achado, adulterada DIVERGENCIA_REAL; a legada continua LIMITACAO_LEGADA', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    // transferência ANTIGA (formato legado, sem lotes_consumidos) de 90 kg de ração para o local 2, com o ano 2001 na camada
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.racao, '10', '60', { unidade: 'SACO' })]));
    const L1 = compra.itens[0].estoque_lote_nota_id;
    await p.estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: L1 } }, data: { quantidade_disponivel: '210' } });
    const saida = await movimento(s, e, e.racao, {
      tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada', origem_sistema: 'deposito', quantidade: '90', local_estoque_origem: s.local.id, local_estoque_destino: s.local2.id,
    });
    const entrada = await movimento(s, e, e.racao, {
      tipo_movimentacao: 'Entrada', tipo_detalhado: 'transferencia_recebida', origem_sistema: 'deposito', quantidade: '90', local_estoque_origem: s.local.id, local_estoque_destino: s.local2.id,
      movimento_pai_id: saida.id,
    });
    await p.movimentacaoEstoque.update({ where: { cliente_id_id: { cliente_id: s.c, id: saida.id } }, data: { movimento_filho_id: entrada.id } });
    const T1 = await p.estoqueLoteNota.create({
      data: {
        cliente_id: s.c, empresa_id: e.id, produto_id: e.racao.id, local_estoque_id: s.local2.id, data_documento: new Date('2001-06-10T00:00:00.000Z'),
        custo_unitario: '2.0000', quantidade_entrada: '90', quantidade_disponivel: '90', movimentacao_entrada_id: entrada.id, status: 'Disponivel',
      },
    });
    await recibo(s, 'transferencia_locais', {
      committed: true, movimentacao_saida: { id: saida.id }, movimentacao_entrada: { id: entrada.id },
      rateio: [{ lote_id: L1, quantidade_consumida: 90, custo_unitario: 2, valor_total: 180 }],
    });
    // RETRANSFERÊNCIA pelo motor: a camada nova copia a data (2001) e a procedência da origem legada
    const r = await transferir(s, e, e.racao, s.local2, s.local, 50);
    assert.equal(r.statusCode, 201, r.body);
    const T2 = r.json().rateio[0].lote_destino_id;
    assert.equal(r.json().rateio[0].lote_id, T1.id);
    assert.equal(dia((await lote(T2)).data_documento), '2001-06-10', 'a retransferência copia a data da camada de origem');
    // controle: camada transferida normal (compra de milho → local 2)
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.milho, '10', '2.00')]));
    const rm = await transferir(s, e, e.milho, s.local, s.local2, 10);
    assert.equal(rm.statusCode, 201, rm.body);
    const Tm = rm.json().rateio[0].lote_destino_id;

    const limpo = await relatorio(s);
    assert.deepEqual(achados(limpo, 'lote', 'lote_id', T1.id), ['LIMITACAO_LEGADA/data_transferencia_2001'], 'a camada legada continua apontada');
    assert.deepEqual(achados(limpo, 'lote', 'lote_id', T2), [], 'a camada do motor (linhagem JSON do pai) não é bug 2001');
    assert.deepEqual(achados(limpo, 'produto', 'produto_id', e.racao.id), []);

    // a MESMA adulteração física nas duas camadas do motor (UPDATE SQL, sem AuditLog)
    await p.$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1 WHERE cliente_id = ${s.c} AND id IN (${T2}, ${Tm})`;
    const rel = await relatorio(s);
    assert.deepEqual(achados(rel, 'lote', 'lote_id', Tm), ['DIVERGENCIA_REAL/consumo_nao_explicado'], 'controle');
    assert.deepEqual(achados(rel, 'lote', 'lote_id', T2), ['DIVERGENCIA_REAL/consumo_nao_explicado'], 'a data copiada nunca mascara a divergência física');
    assert.deepEqual(achados(rel, 'produto', 'produto_id', e.racao.id), ['DIVERGENCIA_REAL/cache_diverge']);
    assert.deepEqual(achados(rel, 'lote', 'lote_id', T1.id), ['LIMITACAO_LEGADA/data_transferencia_2001']);
  });

  test('A02: origem sem data_documento → a camada transferida recebe o dia UTC do createdAt da origem (idade FIFO real), nunca o dia de data_movimentacao (nem 0001-01-01); a venda no destino respeita a idade; nada vira "bug 2001"', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    // sal: origem antiga (createdAt 2026-01-05) @1; no destino, lote de 2027-03-01 @9; transferência datada de "hoje"
    const velha = await camadaSemData(s, e, e.sal, s.local, { kg: '10', custo: '1.0000', createdAt: new Date('2026-01-05T10:00:00.000Z') });
    const bSal = await camadaComData(s, e, e.sal, s.local2, { kg: '10', custo: '9.0000', dia: '2027-03-01' });
    await definirEstoqueAtual(s, e.sal, '20');
    // milho: origem de 2027-05-20 @1; no destino, lote de 2027-03-01 @9; transferência com data_movimentacao 0001-01-01
    const nova = await camadaSemData(s, e, e.milho, s.local, { kg: '10', custo: '1.0000', createdAt: new Date('2027-05-20T10:00:00.000Z') });
    const bMilho = await camadaComData(s, e, e.milho, s.local2, { kg: '10', custo: '9.0000', dia: '2027-03-01' });
    await definirEstoqueAtual(s, e.milho, '20');

    const tSal = await transferir(s, e, e.sal, s.local, s.local2, 10, { data_movimentacao: '2027-06-15' });
    const tMilho = await transferir(s, e, e.milho, s.local, s.local2, 10, { data_movimentacao: '0001-01-01' });
    assert.deepEqual([tSal.statusCode, tMilho.statusCode], [201, 201], `${tSal.body} ${tMilho.body}`);
    const camSal = await lote(tSal.json().rateio[0].lote_destino_id);
    const camMilho = await lote(tMilho.json().rateio[0].lote_destino_id);
    assert.equal(tSal.json().rateio[0].lote_id, velha.id);
    assert.equal(tMilho.json().rateio[0].lote_id, nova.id);
    assert.equal(dia(camSal.data_documento), '2026-01-05', 'idade FIFO da origem (createdAt), não o dia da transferência');
    assert.equal(dia(camMilho.data_documento), '2027-05-20', 'idade FIFO da origem, nunca o ano 0001 escolhido na movimentação');
    assert.equal((await p.movimentacaoEstoque.findUnique({ where: { id: tMilho.json().movimentacao_saida.id } })).data_movimentacao.toISOString(), '0001-01-01T12:00:00.000Z',
      'a data da movimentação continua sendo a informada (metadado do fato)');

    // venda de 10 kg em cada destino: o FIFO segue a idade real
    const consumo = async (produto) => {
      const v = await A.criarConfirmar(s.token, docCom(e, s.local2, [item(produto, '10', '20.00')], { direcao: 'RECEBER' }));
      const f = await p.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.c, item_id: v.itens[0].id } });
      return f.map((x) => [x.estoque_lote_nota_id, q4(x.quantidade)]);
    };
    assert.deepEqual(await consumo(e.sal), [[camSal.id, '10.0000']], 'sal: a camada de 2026-01-05 sai antes do lote de 2027-03-01');
    assert.deepEqual(await consumo(e.milho), [[bMilho.id, '10.0000']], 'milho: o lote de 2027-03-01 sai antes da camada de 2027-05-20');

    const rel = await relatorio(s);
    for (const c of [camSal.id, camMilho.id]) {
      assert.ok(!achados(rel, 'lote', 'lote_id', c).some((x) => x.endsWith('/data_transferencia_2001')), `${c}: ${JSON.stringify(achados(rel, 'lote', 'lote_id', c))}`);
    }
    void bSal;
  });

  test('A03: retificação NO_LUGAR do parceiro e do nº do documento chega às camadas transferidas (ida e volta, transitiva), com AuditLog de procedência; a baixa seguinte cita o documento corrigido; reconciliação CONSISTENTE', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const doc = (extra = {}) => docCom(e, s.local, [item(e.sal, '100', '3.00')], { data_operacional: '2027-06-05', documento_referencia: 'NF-100', ...extra });
    const C = await A.criarConfirmar(s.token, doc());
    const L = C.itens[0].estoque_lote_nota_id;
    const ida = await transferir(s, e, e.sal, s.local, s.local2, 40);
    assert.equal(ida.statusCode, 201, ida.body);
    const T1 = ida.json().rateio[0].lote_destino_id;
    // volta de 15 kg do local 2 (só tem T1) → T2, neta de L
    const volta = await transferir(s, e, e.sal, s.local2, s.local, 15);
    assert.equal(volta.statusCode, 201, volta.body);
    assert.equal(volta.json().rateio[0].lote_id, T1);
    const T2 = volta.json().rateio[0].lote_destino_id;
    const outro = await p.fornecedor.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_cadastro: '199', tipo_pessoa: 'Jurídica', nome: 'FORNECEDOR CORRETO', tipos: ['fornecedor'] } });
    const atual = await A.detalhe(s.token, C.id, e.id);
    const r = await A.ok(A.req('POST', `/operacoes-financeiras/${C.id}/retificar`, s.token, {
      ...doc({ parceiro_id: outro.id, documento_referencia: 'NF-100-CORRIGIDA' }), versao: atual.versao, operation_id: opId(), motivo: 'nº da nota digitado errado',
    }));
    assert.equal(r.retificacao.modo, 'NO_LUGAR');
    const procedencia = async (id) => {
      const l = await lote(id);
      return [l.fornecedor_id, l.fornecedor_nome, l.numero_documento];
    };
    const certa = [outro.id, 'FORNECEDOR CORRETO', 'NF-100-CORRIGIDA'];
    assert.deepEqual(await procedencia(L), certa, 'lote da compra');
    assert.deepEqual(await procedencia(T1), certa, 'camada transferida (filha)');
    assert.deepEqual(await procedencia(T2), certa, 'camada transferida da transferida (neta)');
    const aud = await p.auditLog.findMany({ where: { cliente_id: s.c, entidade: 'EstoqueLoteNota', acao: ACAO_PROCEDENCIA_LOTE }, orderBy: { entidade_id: 'asc' } });
    assert.deepEqual(aud.map((a) => a.entidade_id).sort(), [L, T1, T2].sort(), 'cada camada gravada ganha o AuditLog do escritor benigno');
    for (const a of aud) assert.deepEqual([a.dados_anteriores.numero_documento, a.dados_novos.numero_documento], ['NF-100', 'NF-100-CORRIGIDA']);
    // quantidade, custo e situação intactos: reconciliação sem achado
    const rel = await relatorio(s);
    assert.equal(rel.resumo.situacao, 'CONSISTENTE', JSON.stringify(rel.achados));
    // a baixa seguinte sobre T1 cita o documento corrigido no rateio e nas observações
    const sup = await suplementar(s, e, e.sal, s.local2, 10);
    assert.equal(sup.statusCode, 201, sup.body);
    assert.deepEqual(sup.json().rateio.map((f) => [f.lote_id, f.numero_documento, f.fornecedor_id]), [[T1, 'NF-100-CORRIGIDA', outro.id]]);
    assert.match(sup.json().movimentacao.observacoes ?? '', /NF-100-CORRIGIDA/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B — AuditLog dos escritores benignos sob concorrência com o motor (lente B / LC-1)', () => {
  test('B01: renomeação do local no lote ESPERA a baixa e audita o estado travado (quantidade igual dos dois lados); −1 kg por SQL depois continua DIVERGENCIA_REAL no lote, no local e no produto', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2'), item(e.milho, '100', '2')]));
    const lSal = await p.estoqueLoteNota.findFirst({ where: { cliente_id: s.c, produto_id: e.sal.id } });
    const lMilho = await p.estoqueLoteNota.findFirst({ where: { cliente_id: s.c, produto_id: e.milho.id } });
    const nome = (await p.localEstoque.findUnique({ where: { id: s.local.id } })).nome;
    const renomear = (l) => A.req('PATCH', `/estoque-lotes-nota/${l.id}`, s.token, { local_estoque_nome: nome });
    // controle (milho): baixa e renomeação em série
    assert.equal((await suplementar(s, e, e.milho, s.local, 10)).statusCode, 201);
    assert.equal((await renomear(lMilho)).statusCode, 200);
    // corrida (sal): a renomeação começa enquanto a baixa segura o lote
    await corridaComBaixa(s, e, e.sal, () => renomear(lSal));
    const ultima = async (l) => p.auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'EstoqueLoteNota', entidade_id: l.id, acao: 'update' }, orderBy: { createdAt: 'desc' } });
    const qtd = (a) => [String(a.dados_anteriores?.quantidade_disponivel), String(a.dados_novos?.quantidade_disponivel)];
    const aSal = await ultima(lSal);
    assert.deepEqual(qtd(await ultima(lMilho)), ['90', '90'], 'controle');
    assert.deepEqual(qtd(aSal), ['90', '90'], 'a renomeação não audita uma mudança de quantidade que não fez');
    const limpo = await relatorio(s, `&produto_id=${e.sal.id}`);
    assert.equal(limpo.resumo.situacao, 'CONSISTENTE', JSON.stringify(limpo.achados));
    await aux.$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_disponivel - 1 WHERE cliente_id = ${s.c} AND id = ANY(${[lSal.id, lMilho.id]}::text[])`;
    for (const [prod, l] of [[e.milho, lMilho], [e.sal, lSal]]) {
      const rel = await relatorio(s, `&produto_id=${prod.id}`);
      assert.deepEqual(achados(rel, 'lote', 'lote_id', l.id), ['DIVERGENCIA_REAL/consumo_nao_explicado'], prod.nome_produto);
      assert.deepEqual(achados(rel, 'produto', 'produto_id', prod.id), ['DIVERGENCIA_REAL/cache_diverge'], prod.nome_produto);
      assert.deepEqual(rel.achados.filter((a) => a.nivel === 'local').map((a) => `${a.classe}/${a.regra}`), ['DIVERGENCIA_REAL/razao_diverge'], prod.nome_produto);
    }
  });

  test('B02: PATCH /produtos SEM empresa_id (cliente de API) ESPERA a baixa e audita o estado travado (estoque_atual igual); cache +1 por SQL depois continua DIVERGENCIA_REAL/cache_diverge', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2')]));
    await corridaComBaixa(s, e, e.sal, () => A.req('PATCH', `/produtos/${e.sal.id}`, s.token, { nome_produto: 'SAL RENOMEADO' }));
    const a = await p.auditLog.findFirst({ where: { cliente_id: s.c, entidade: 'Produto', entidade_id: e.sal.id, acao: 'update' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([String(a.dados_anteriores?.estoque_atual), String(a.dados_novos?.estoque_atual)], ['90', '90'], 'o PATCH não audita uma escrita de estoque_atual que não fez');
    assert.deepEqual([a.dados_anteriores?.nome_produto, a.dados_novos?.nome_produto], [e.sal.nome_produto, 'SAL RENOMEADO']);
    await aux.$executeRaw`UPDATE "Produto" SET estoque_atual = estoque_atual + 1 WHERE cliente_id = ${s.c} AND id = ${e.sal.id}`;
    const rel = await relatorio(s, `&produto_id=${e.sal.id}`);
    assert.deepEqual(achados(rel, 'produto', 'produto_id', e.sal.id), ['DIVERGENCIA_REAL/cache_diverge']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const DESFAZ = 'desfaz-medicao-r2fix';
/** UMA chamada de `lerReconciliacao` numa transação RepeatableRead do teste (desfeita), com a estatística física da transação. */
const medir = async (cli, filtro) => {
  /** @type {any} */ let r = null;
  /** @type {any[]} */ let stats = [];
  const estatistica = (tx) => tx.$queryRaw`SELECT relname::text AS tabela, seq_tup_read::int AS seq, idx_tup_fetch::int AS idx FROM pg_stat_xact_user_tables`;
  await aux.$transaction(async (tx) => {
    const base = /** @type {any[]} */ (await estatistica(tx));
    // tabelas pequenas no teste: sem isto o planejador leria a tabela inteira (todos os tenants); mede-se o plano de escala
    await tx.$queryRaw`SELECT set_config('enable_seqscan', 'off', true)`;
    r = await lerReconciliacao(tx, cli, filtro);
    const fim = /** @type {any[]} */ (await estatistica(tx));
    stats = fim.map((t) => {
      const b = base.find((x) => x.tabela === t.tabela);
      return { tabela: t.tabela, lidas: t.seq + t.idx - ((b?.seq ?? 0) + (b?.idx ?? 0)) };
    });
    throw new Error(DESFAZ);
  }, { isolationLevel: 'RepeatableRead', maxWait: 10000, timeout: 120000 }).catch((erro) => { if (erro?.message !== DESFAZ) throw erro; });
  return { r, lidasDe: (nome) => stats.find((t) => t.tabela === nome)?.lidas ?? 0 };
};

describe('C — recibo legado em rajada (lente C / LC-2)', () => {
  test('C01: 300 saídas legadas + 300 recibos com rateio + 3.000 recibos de outra operação na MESMA janela: cada recibo é lido no máximo uma vez por consulta (linear, não N×M), a pré-contagem cobre os recibos lidos e a classificação não muda', async (t) => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '1000', '2.00')]));
    const L = compra.itens[0].estoque_lote_nota_id;
    const N = 300;
    const RUIDO = 3000;
    // caminho legado: saída de 1 kg sem lotes_consumidos + recibo committed com o rateio, no mesmo instante (0,5 s entre saídas)
    await p.$executeRaw`INSERT INTO "MovimentacaoEstoque" (id, cliente_id, empresa_id, numero_movimentacao, tipo_movimentacao, tipo_detalhado, data_movimentacao, produto_id,
        quantidade, unidade_medida, local_estoque_origem, origem_sistema, status, "createdAt", "updatedAt")
      SELECT ${s.c} || '-leg-' || k, ${s.c}, ${e.id}, 'LEG-' || k, 'Saída', 'suplementacao', now(), ${e.sal.id}, 1, 'KG', ${s.local.id}, 'suplementacao', 'Ativa',
             now() + interval '1 minute' + k * interval '500 milliseconds', now()
      FROM generate_series(1, ${N}::int) k`;
    await p.$executeRaw`INSERT INTO "OperacaoIdempotente" (id, cliente_id, operation_key, tipo_operacao, fingerprint, status, http_status, response_json, "createdAt", "updatedAt")
      SELECT ${s.c} || '-rg-' || k, ${s.c}, 'op-rg-' || k, 'saida_suplementacao', md5(${s.c} || k), 'committed', 201,
             jsonb_build_object('committed', true, 'movimentacao', jsonb_build_object('id', ${s.c} || '-leg-' || k),
               'rateio', jsonb_build_array(jsonb_build_object('lote_id', ${L}::text, 'quantidade_consumida', 1, 'custo_unitario', 2, 'valor_total', 2))),
             now() + interval '1 minute' + k * interval '500 milliseconds', now()
      FROM generate_series(1, ${N}::int) k`;
    // rajada de OUTRAS suplementações do tenant na mesma janela (outro movimento): passam no filtro de tipo e status
    await p.$executeRaw`INSERT INTO "OperacaoIdempotente" (id, cliente_id, operation_key, tipo_operacao, fingerprint, status, http_status, response_json, "createdAt", "updatedAt")
      SELECT ${s.c} || '-rx-' || n, ${s.c}, 'op-rx-' || n, 'saida_suplementacao', md5('x' || ${s.c} || n), 'committed', 201,
             jsonb_build_object('committed', true, 'movimentacao', jsonb_build_object('id', 'outro-' || n), 'rateio', '[]'::jsonb),
             now() + interval '1 minute' + n * interval '50 milliseconds', now()
      FROM generate_series(1, ${RUIDO}::int) n`;
    await p.estoqueLoteNota.update({ where: { cliente_id_id: { cliente_id: s.c, id: L } }, data: { quantidade_disponivel: String(1000 - N) } });
    await definirEstoqueAtual(s, e.sal, String(1000 - N));
    await p.$executeRaw`ANALYZE "OperacaoIdempotente"`;
    await p.$executeRaw`ANALYZE "MovimentacaoEstoque"`;

    const m = await medir(s.c, { produtoId: e.sal.id, empresaId: e.id });
    assert.equal(m.r.resumo.situacao, 'CONSISTENTE', JSON.stringify(m.r.achados.slice(0, 5)));
    const recibos = N + RUIDO;
    const lidas = m.lidasDe('OperacaoIdempotente');
    t.diagnostic(`C01 recibos lidos=${lidas} (recibos na janela=${recibos}, saídas legadas=${N}); linhas_previstas=${m.r.cobertura.linhas_previstas}; páginas=${m.r.cobertura.paginas}`);
    assert.ok(lidas <= 4 * (recibos + N), `recibos lidos: ${lidas} (linear: ≤ ${4 * (recibos + N)}; N×M seria ~${2 * N * recibos})`);
    assert.ok(m.r.cobertura.linhas_previstas >= 1 + m.r.resumo.lotes + m.r.resumo.movimentos + recibos,
      `pré-contagem ${m.r.cobertura.linhas_previstas} não cobre os ${recibos} recibos lidos na janela`);

    // a janela continua valendo: um recibo deslocado 2 h deixa a SUA saída sem prova (nunca OK)
    await p.$executeRaw`UPDATE "OperacaoIdempotente" SET "createdAt" = "createdAt" + interval '2 hours' WHERE cliente_id = ${s.c} AND id = ${`${s.c}-rg-7`}`;
    const fora = (await medir(s.c, { produtoId: e.sal.id, empresaId: e.id })).r;
    assert.deepEqual(fora.achados.filter((a) => a.nivel === 'movimento').map((a) => [a.chave.movimento_id, a.classe, a.regra]),
      [[`${s.c}-leg-7`, 'DADOS_INSUFICIENTES', 'consumo_legado_sem_recibo']]);
  });
});

/**
 * D-PROD-158 — Gestão P3-03: EDITAR (retificar), EXCLUIR (lógico) e DUPLICAR
 * lançamentos da Central Única de Lançamentos. PostgreSQL real, HTTP
 * autenticado, prova pelas linhas gravadas e pela fotografia COMPLETA do tenant.
 *
 *  E0. duplicar: `duplicado_de_id` aceito (proveniência no AuditLog e no
 *      detalhe) e recusado (outro tenant, outra empresa, inexistente); ler o
 *      detalhe e a elegibilidade não grava nada;
 *  E1. compra confirmada (100 SACO + serviço, sem baixa) em GERAL/POR_ITEM ×
 *      VALOR/PERCENTUAL: SUBSTITUIÇÃO (lote antigo estornado, lote novo com o
 *      custo líquido do plano, `estoque_atual`/saldo coerentes, títulos sem
 *      duplicar, número preservado e antigo `/r<v>`, evento + snapshot);
 *  E2. venda sem movimento posterior: FIFO refeito, nenhuma fatia órfã;
 *  E3. só informativa: NO_LUGAR (mesmos movimentos e lote, nenhum movimento novo);
 *  E4. parcelas 1 → 3 → 12 em BRL, PYG e KWD com desconto/acréscimo; 200
 *      linhas de rateio por item;
 *  E5. bloqueios com 409 + motivo + "nada mudou": compra consumida por venda,
 *      transferência e suplementação; consumida e recomposta (venda cancelada,
 *      SQL sem `updatedAt`, SQL com `updatedAt`, movimento administrativo com
 *      `lotes_consumidos`); renomear o local NÃO bloqueia; venda com movimento
 *      posterior (outro local e outra empresa não contam); baixa parcial,
 *      integral, no ato e estornada;
 *  E6. excluir confirmado elegível (compra, venda, serviço) e bloqueado;
 *      rascunho continua no DELETE físico; documento histórico;
 *  E7. detalhe: cadeia de eventos nos dois sentidos; lista por `situacao`;
 *  E8. concorrência determinística (portão, sem sono): EDITAR×EDITAR,
 *      EDITAR×LIQUIDAR (nos dois sentidos), EDITAR×CANCELAR, EDITAR×EXCLUIR,
 *      EXCLUIR×VENDA (nos dois sentidos), replay e fingerprint;
 *  E9. segurança: 401, 403, 404, 400/422 e 409 de versão/moeda;
 *  E10. medição: 200 itens × 120 parcelas (retificar e excluir < 60 s).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, docSem, foto, loteLegado, montarTenant, motivo, opId, prisma, somaLotes } from './gestaoP3Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** Cliente do TESTE (pool próprio) para portões e observação de travas. @type {PrismaClient} */
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

// ─── apoio ──────────────────────────────────────────────────────────────────
const D = (v) => new Prisma.Decimal(v);
const MOTIVO_RET = 'correção de teste';
const MOTIVO_EXC = 'exclusão de teste';

const retificarReq = (token, d, doc, extra = {}) =>
  A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, token, { ...doc, versao: d.versao, operation_id: opId(), motivo: MOTIVO_RET, ...extra });
const retificar = (s, d, doc, extra) => A.ok(retificarReq(s.token, d, doc, extra));
const excluirReq = (token, d, empresaId, extra = {}) =>
  A.req('POST', `/operacoes-financeiras/${d.id}/excluir`, token, { empresa_id: empresaId, versao: d.versao, operation_id: opId(), motivo: MOTIVO_EXC, ...extra });
const excluir = (s, d, empresaId, extra) => A.ok(excluirReq(s.token, d, empresaId, extra));
const elegReq = (token, id, empresaId) => A.req('GET', `/operacoes-financeiras/${id}/elegibilidade?empresa_id=${empresaId}`, token);
const eleg = (s, id, empresaId, token = s.token) => A.ok(elegReq(token, id, empresaId));
const listar = (s, e, q = '') => A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}${q}`, s.token));
const idsDe = (pagina) => pagina.items.map((x) => x.id).sort();
const recusa = (r, status, code, reason) => {
  assert.equal(r.statusCode, status, r.body);
  assert.equal(codigo(r), code, r.body);
  if (reason !== undefined) assert.equal(motivo(r), reason, r.body);
  return r.json();
};
const codigosDe = (motivos) => motivos.map((m) => m.codigo);
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const definirEstoqueAtual = (produto, kg) => prisma().produto.update({ where: { id: produto.id }, data: { estoque_atual: kg } });
const lote = (id) => prisma().estoqueLoteNota.findUnique({ where: { id } });
const movimento = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const contarMovimentos = (s) => prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c } });
const suplementar = (s, e, produto, local, quantidade) =>
  A.ok(A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, { operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: local.id, quantidade }), 201);
const transferir = (s, e, produto, de, para, quantidade) =>
  A.ok(A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, {
    operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: de.id, local_destino_id: para.id, quantidade,
  }), 201);
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });

/** Parcelas iguais na escala `casas` (a última leva o resto), vencimentos mensais desde 2027-07-10. */
const parcelasDe = (total, n, casas = 2) => {
  const escala = D(10).pow(casas);
  const unidades = D(total).times(escala);
  const base = unidades.dividedToIntegerBy(n);
  const resto = unidades.minus(base.times(n));
  return Array.from({ length: n }, (_, i) => {
    const mes = 6 + i;
    const vencimento = `${2027 + Math.floor(mes / 12)}-${String((mes % 12) + 1).padStart(2, '0')}-10`;
    return { vencimento, valor: (i === n - 1 ? base.plus(resto) : base).dividedBy(escala).toFixed(casas) };
  });
};
const condicaoDe = (n) => (n === 1 ? 'PRAZO' : 'PARCELADO');

/**
 * Compra 100 SACO de ração (30 kg) + serviço, GERAL ou POR_ITEM, VALOR ou
 * PERCENTUAL. Sem desconto/acréscimo no POR_ITEM/VALOR (o líquido do item é o subtotal).
 */
const compraMista = (s, e, { escopo = 'GERAL', modo = 'VALOR', sacos = '100', preco = '90.00', servico = '500.00', desconto = null, acrescimo = null, n = 1, local = s.local } = {}) => {
  const subM = D(sacos).times(D(preco)).toDecimalPlaces(2);
  const subS = D(servico);
  const total = subM.plus(subS).minus(D(desconto ?? '0')).plus(D(acrescimo ?? '0'));
  /** @type {any[]} */
  const itens = [
    { tipo_item: 'MERCADORIA', produto_id: e.racao.id, local_estoque_id: local.id, unidade: 'SACO', quantidade: sacos, valor_unitario: preco },
    { tipo_item: 'SERVICO', unidade: 'UN', quantidade: '1', valor_unitario: servico, descricao: 'FRETE DA RACAO' },
  ];
  /** @type {any[]} */
  let rateios = [];
  if (escopo === 'GERAL') {
    const parte = total.times(D('0.6')).toDecimalPlaces(2);
    rateios = modo === 'VALOR'
      ? [{ natureza_id: e.desp.id, centro_custo_id: e.cc.id, valor: parte.toFixed(2) }, { natureza_id: e.desp2.id, valor: total.minus(parte).toFixed(2) }]
      : [{ natureza_id: e.desp.id, centro_custo_id: e.cc.id, percentual: '60' }, { natureza_id: e.desp2.id, percentual: '40' }];
  } else if (modo === 'VALOR') {
    const parte = subM.times(D('0.7')).toDecimalPlaces(2);
    itens[0].rateios = [{ natureza_id: e.desp.id, valor: parte.toFixed(2) }, { natureza_id: e.desp3.id, centro_custo_id: e.cc2.id, valor: subM.minus(parte).toFixed(2) }];
    itens[1].rateios = [{ natureza_id: e.desp2.id, valor: subS.toFixed(2) }];
  } else {
    itens[0].rateios = [{ natureza_id: e.desp.id, percentual: '70' }, { natureza_id: e.desp3.id, centro_custo_id: e.cc2.id, percentual: '30' }];
    itens[1].rateios = [{ natureza_id: e.desp2.id, percentual: '100' }];
  }
  return {
    empresa_id: e.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: condicaoDe(n), parceiro_id: e.forn.id, data_emissao: '2027-06-10',
    data_operacional: '2027-06-10', efeito_fisico_confirmado: true, itens, rateio_modo: modo, rateio_escopo: escopo, rateios,
    ...(desconto ? { valor_desconto: desconto } : {}), ...(acrescimo ? { valor_acrescimo: acrescimo } : {}), parcelas: parcelasDe(total.toFixed(2), n),
  };
};
const compraSimples = (s, e, produto, kg, preco = '2.00', extra = {}) => docCom(e, s.local, [item(produto, kg, preco)], extra);
const vendaSimples = (s, e, produto, kg, preco = '5.00', extra = {}) => docCom(e, s.local, [item(produto, kg, preco)], { direcao: 'RECEBER', ...extra });
const eventosDoBanco = (operacaoId) => prisma().operacaoFinanceiraEvento.findMany({ where: { OR: [{ operacao_id: operacaoId }, { operacao_nova_id: operacaoId }] }, orderBy: { createdAt: 'asc' } });

// ─────────────────────────────────────────────────────────────────────────────
describe('E0 — duplicar: duplicado_de_id (proveniência) e nada gravado só por ler', () => {
  test('aceito na mesma empresa (AuditLog da criação + detalhe); recusado (outra empresa, outro tenant, inexistente) com 422 e nada gravado', async () => {
    const s = await montarTenant(app);
    const outro = await montarTenant(app);
    const e = s.e1;
    const origem = await A.criarConfirmar(s.token, compraMista(s, e, { escopo: 'POR_ITEM', modo: 'PERCENTUAL' }));
    // ler o detalhe e a elegibilidade (o que a tela faz ao clicar em Duplicar) não grava nada
    const antesLer = await foto([s.c]);
    await A.detalhe(s.token, origem.id, e.id);
    const el = await eleg(s, origem.id, e.id);
    assert.deepEqual(el.duplicar, { permitido: true, motivos: [] });
    assert.equal(await foto([s.c]), antesLer, 'duplicar (ler) não grava');

    const copia = await A.ok(A.req('POST', '/operacoes-financeiras', s.token, { ...compraMista(s, e, { escopo: 'POR_ITEM', modo: 'PERCENTUAL' }), duplicado_de_id: origem.id, operation_id: opId() }), 201);
    assert.equal(copia.status, 'RASCUNHO');
    assert.equal(copia.duplicado_de_id, origem.id);
    assert.notEqual(copia.numero, origem.numero);
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, entidade_id: copia.id, acao: 'operacao_financeira.criar' } });
    assert.equal(/** @type {any} */ (audit?.dados_novos).duplicado_de_id, origem.id);
    assert.equal(/** @type {any} */ (audit?.dados_novos).duplicado_de_numero, origem.numero);
    assert.equal((await A.detalhe(s.token, origem.id, e.id)).duplicado_de_id, null, 'nada acopla a origem à cópia');

    const docE2 = await A.criar(s.token, docSem(s.e2));
    const docOutro = await A.criar(outro.token, docSem(outro.e1));
    const antes = await foto([s.c, outro.c]);
    for (const origemId of [docE2.id, docOutro.id, 'nao-existe-123']) {
      const r = await A.req('POST', '/operacoes-financeiras', s.token, { ...docSem(e), duplicado_de_id: origemId, operation_id: opId() });
      recusa(r, 422, 'OPERACAO_REFERENCIA_INVALIDA', 'duplicado_de_nao_encontrado');
      assert.equal(r.json().field, 'duplicado_de_id');
    }
    assert.equal(await foto([s.c, outro.c]), antes, 'nada gravado nas recusas');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E1 — compra confirmada: SUBSTITUIÇÃO em GERAL/POR_ITEM × VALOR/PERCENTUAL', () => {
  for (const escopo of ['GERAL', 'POR_ITEM']) {
    for (const modo of ['VALOR', 'PERCENTUAL']) {
      test(`${escopo} × ${modo}: 100 → 120 SACO (+ serviço) e 1 → 3 parcelas`, async () => {
        const s = await montarTenant(app);
        const e = s.e1;
        const d0 = await A.criarConfirmar(s.token, compraMista(s, e, { escopo, modo }));
        const L0 = d0.itens[0].estoque_lote_nota_id;
        const M0 = d0.itens[0].movimentacao_estoque_id;
        assert.equal(await estoqueAtual(e.racao), '3000.0000');
        const el = await eleg(s, d0.id, e.id);
        assert.deepEqual([el.editar.permitido, el.editar.modo, el.editar.efeito_fisico_permitido, el.excluir.permitido, el.excluir.modo], [true, 'RETIFICACAO', true, true, 'LOGICA']);

        const doc1 = compraMista(s, e, { escopo, modo, sacos: '120', n: 3 });
        const r = await retificar(s, d0, doc1);
        assert.deepEqual(r.retificacao, { modo: 'SUBSTITUICAO', operacao_anterior_id: d0.id, operacao_atual_id: r.id });
        assert.equal(r.replay, false);
        assert.notEqual(r.id, d0.id);
        assert.deepEqual([r.numero, r.status, r.versao, r.rateio_escopo, r.rateio_modo], [d0.numero, 'CONFIRMADO', d0.versao + 1, escopo, modo]);
        assert.equal(r.valor_total, '11300.00');
        // antigo: estornado, cancelado, renomeado e fora da lista operacional
        const antigo = await A.detalhe(s.token, d0.id, e.id);
        assert.deepEqual([antigo.status, antigo.numero, antigo.versao, antigo.motivo_cancelamento], ['CANCELADO', `${d0.numero}/r${d0.versao}`, d0.versao + 1, `Retificado: ${MOTIVO_RET}`]);
        assert.ok(antigo.retificado_em && !antigo.excluido_em);
        assert.deepEqual(antigo.substituido_por, { id: r.id, numero: d0.numero });
        assert.deepEqual(r.substitui, { id: d0.id, numero: antigo.numero });
        assert.ok(antigo.titulos.every((t) => t.status === 'CANCELADO'));
        assert.ok(antigo.itens[0].movimentacao_estorno_id);
        assert.equal(antigo.itens[1].movimentacao_estorno_id, null, 'serviço não tem estorno');
        // estoque: lote antigo estornado; lote novo com o custo líquido do plano
        const l0 = await lote(L0);
        assert.deepEqual([l0.status, l0.quantidade_disponivel.toFixed(4)], ['Estornado', '0.0000']);
        assert.equal((await movimento(M0)).status, 'Estornada');
        const L1 = r.itens[0].estoque_lote_nota_id;
        assert.ok(L1 && L1 !== L0);
        const l1 = await lote(L1);
        assert.deepEqual([l1.status, l1.quantidade_entrada.toFixed(4), l1.quantidade_disponivel.toFixed(4), l1.custo_unitario.toFixed(4)], ['Disponivel', '3600.0000', '3600.0000', r.itens[0].custo_kg]);
        assert.equal(r.itens[0].valor_liquido, '10800.00');
        assert.equal(r.itens[0].custo_kg, '3.0000');
        assert.equal(await estoqueAtual(e.racao), '3600.0000');
        assert.equal(await somaLotes({ cliente_id: s.c, produto_id: e.racao.id, local_estoque_id: s.local.id, status: 'Disponivel' }), '3600.0000');
        // títulos: 3 novos ABERTO (Σ = total); os do antigo CANCELADO; nada duplicado
        assert.deepEqual(r.titulos.map((t) => [t.numero_parcela, t.status]), [[1, 'ABERTO'], [2, 'ABERTO'], [3, 'ABERTO']]);
        assert.equal(r.titulos.reduce((t, x) => t.plus(D(x.valor)), D(0)).toFixed(2), '11300.00');
        const titulos = await prisma().tituloFinanceiro.findMany({ where: { cliente_id: s.c } });
        assert.deepEqual([titulos.length, titulos.filter((t) => t.status === 'ABERTO').length], [4, 3]);
        if (escopo === 'POR_ITEM') {
          assert.equal(r.itens[0].rateios.length, 2);
          assert.equal(r.itens[0].rateios.reduce((t, x) => t.plus(D(x.valor)), D(0)).toFixed(2), '10800.00');
        } else {
          assert.equal(r.rateios.reduce((t, x) => t.plus(D(x.valor)), D(0)).toFixed(2), '11300.00');
        }
        // evento + snapshot
        const evs = await eventosDoBanco(d0.id);
        assert.equal(evs.length, 1);
        const ev = evs[0];
        assert.deepEqual([ev.tipo, ev.modo, ev.operacao_id, ev.operacao_nova_id, ev.numero_original, ev.versao_anterior, ev.versao_nova, ev.motivo],
          ['RETIFICACAO', 'SUBSTITUICAO', d0.id, r.id, d0.numero, d0.versao, d0.versao + 1, MOTIVO_RET]);
        const snap = /** @type {any} */ (ev.snapshot_anterior);
        assert.deepEqual([snap.cabecalho.numero, snap.cabecalho.versao, snap.itens[0].estoque_lote_nota_id, snap.itens[0].movimentacao_estoque_id, snap.itens[0].quantidade_estoque],
          [d0.numero, d0.versao, L0, M0, '3000.0000']);
        assert.equal(snap.titulos.length, 1);
        assert.equal(snap.titulos[0].status, 'ABERTO');
        assert.equal(r.eventos.length, 1);
        assert.deepEqual([r.eventos[0].tipo, r.eventos[0].modo, r.eventos[0].operacao_id, r.eventos[0].operacao_nova_id, r.eventos[0].motivo], ['RETIFICACAO', 'SUBSTITUICAO', d0.id, r.id, MOTIVO_RET]);
        assert.equal('snapshot_anterior' in r.eventos[0], false, 'o detalhe não expõe o snapshot');
        const audits = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'operacao_financeira.retificar' } });
        assert.deepEqual(audits.map((a) => a.entidade_id).sort(), [d0.id, r.id].sort());
        // lista: OPERACIONAIS mostra só o atual; TODOS, os dois
        assert.deepEqual(idsDe(await listar(s, e)), [r.id]);
        assert.deepEqual(idsDe(await listar(s, e, '&situacao=TODOS')), [d0.id, r.id].sort());
        const linhaAntiga = (await listar(s, e, '&situacao=TODOS')).items.find((x) => x.id === d0.id);
        assert.ok(linhaAntiga.retificado_em);
        assert.equal(linhaAntiga.excluido_em, null);
        // elegibilidade do antigo: histórico, apontando a versão atual
        const elAntigo = await eleg(s, d0.id, e.id);
        assert.deepEqual([elAntigo.editar.permitido, elAntigo.excluir.permitido, elAntigo.duplicar.permitido], [false, false, true]);
        assert.deepEqual([elAntigo.editar.motivos[0].codigo, elAntigo.editar.motivos[0].id], ['documento_historico', r.id]);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E2 — venda sem movimento posterior: FIFO refeito', () => {
  test('100 → 150 kg: as fatias antigas voltam aos lotes, as novas saem FIFO; nenhuma fatia órfã; títulos corretos', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const A1 = await loteLegado(s, e, e.sal, s.local, { kg: '120', custo: '2.0000', dia: '2027-06-01' });
    const A2 = await loteLegado(s, e, e.sal, s.local, { kg: '500', custo: '3.0000', dia: '2027-06-02' });
    await definirEstoqueAtual(e.sal, '620');
    const v0 = await A.criarConfirmar(s.token, vendaSimples(s, e, e.sal, '100'));
    assert.deepEqual(v0.itens[0].consumos.map((c) => [c.estoque_lote_nota_id, c.quantidade]), [[A1.id, '100.0000']]);
    const r = await retificar(s, v0, vendaSimples(s, e, e.sal, '150', '5.00', { parcelas: parcelasDe('750.00', 3), condicao: 'PARCELADO' }));
    assert.equal(r.retificacao.modo, 'SUBSTITUICAO');
    assert.deepEqual(r.itens[0].consumos.map((c) => [c.estoque_lote_nota_id, c.quantidade]), [[A1.id, '120.0000'], [A2.id, '30.0000']]);
    assert.deepEqual([(await lote(A1.id)).quantidade_disponivel.toFixed(4), (await lote(A1.id)).status], ['0.0000', 'Esgotado']);
    assert.equal((await lote(A2.id)).quantidade_disponivel.toFixed(4), '470.0000');
    assert.equal(await estoqueAtual(e.sal), '470.0000');
    // cada fatia pertence a um item e soma a quantidade dele (antigo e novo)
    const consumos = await prisma().operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.c }, include: { item: true } });
    for (const it of [v0.itens[0].id, r.itens[0].id]) {
      const doItem = consumos.filter((c) => c.item_id === it);
      assert.equal(doItem.reduce((t, c) => t.plus(c.quantidade), D(0)).toFixed(4), it === v0.itens[0].id ? '100.0000' : '150.0000');
    }
    const antigo = await A.detalhe(s.token, v0.id, e.id);
    assert.ok(antigo.itens[0].movimentacao_estorno_id);
    const est = await movimento(antigo.itens[0].movimentacao_estorno_id);
    assert.deepEqual([est.tipo_detalhado, est.movimento_pai_id, est.quantidade.toFixed(4)], ['estorno_venda', v0.itens[0].movimentacao_estoque_id, '100.0000']);
    assert.deepEqual(r.titulos.map((t) => [t.valor, t.status]), [['250.00', 'ABERTO'], ['250.00', 'ABERTO'], ['250.00', 'ABERTO']]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E3 — retificação só informativa: NO_LUGAR', () => {
  test('compra: descrição, documento, rateio, vencimentos e parcelas mudam; mesmos ids de movimento e lote; nenhum movimento novo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d0 = await A.criarConfirmar(s.token, compraMista(s, e, { escopo: 'POR_ITEM', modo: 'VALOR' }));
    const movs = await contarMovimentos(s);
    const loteAntes = await lote(d0.itens[0].estoque_lote_nota_id);
    const titulosAntes = d0.titulos.map((t) => t.id);
    const doc1 = { ...compraMista(s, e, { escopo: 'POR_ITEM', modo: 'VALOR', n: 3 }), descricao: 'COMPRA CORRIGIDA', documento_referencia: 'NF-777' };
    doc1.itens[1].descricao = 'FRETE CORRIGIDO';
    const r = await retificar(s, d0, doc1);
    assert.deepEqual(r.retificacao, { modo: 'NO_LUGAR', operacao_anterior_id: d0.id, operacao_atual_id: d0.id });
    assert.deepEqual([r.id, r.numero, r.status, r.versao, r.descricao, r.documento_referencia], [d0.id, d0.numero, 'CONFIRMADO', d0.versao + 1, 'COMPRA CORRIGIDA', 'NF-777']);
    assert.deepEqual([r.itens[0].id, r.itens[0].movimentacao_estoque_id, r.itens[0].estoque_lote_nota_id], [d0.itens[0].id, d0.itens[0].movimentacao_estoque_id, d0.itens[0].estoque_lote_nota_id]);
    assert.equal(r.itens[1].descricao, 'FRETE CORRIGIDO');
    assert.equal(await contarMovimentos(s), movs, 'nenhum movimento novo');
    // Quantidade, custo, situação, local e datas do lote intactos; só a PROCEDÊNCIA (nº do documento) segue a correção (revisão DE-02/BC-01).
    const loteDepois = await lote(d0.itens[0].estoque_lote_nota_id);
    const semProcedencia = (l) => ({ ...l, numero_documento: null, updatedAt: null });
    assert.deepEqual(semProcedencia(loteDepois), semProcedencia(loteAntes), 'lote fisicamente intocado');
    assert.deepEqual([loteDepois.numero_documento, (await movimento(d0.itens[0].movimentacao_estoque_id)).numero_documento], ['NF-777', 'NF-777'], 'procedência no lote e no movimento');
    assert.equal(r.titulos.length, 3);
    assert.ok(r.titulos.every((t) => t.status === 'ABERTO' && !titulosAntes.includes(t.id)));
    assert.equal(await prisma().tituloFinanceiro.count({ where: { cliente_id: s.c } }), 3, 'títulos antigos apagados (sem baixa) e recriados');
    const evs = await eventosDoBanco(d0.id);
    assert.deepEqual(evs.map((x) => [x.tipo, x.modo, x.operacao_nova_id, x.versao_anterior, x.versao_nova]), [['RETIFICACAO', 'NO_LUGAR', null, d0.versao, d0.versao + 1]]);
    assert.equal(/** @type {any} */ (evs[0].snapshot_anterior).titulos[0].id, titulosAntes[0], 'o snapshot guarda o título apagado');
    assert.equal((await listar(s, e)).items.length, 1);
  });

  test('venda: preço, parceiro e vencimentos mudam sem tocar no FIFO (NO_LUGAR); documento duplicado é recusado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '1000' });
    await definirEstoqueAtual(e.sal, '1000');
    const v0 = await A.criarConfirmar(s.token, vendaSimples(s, e, e.sal, '100', '5.00'));
    const outra = await A.criarConfirmar(s.token, vendaSimples(s, e, e.sal, '1', '5.00', { documento_referencia: 'NF-1' }));
    const r = await retificar(s, v0, vendaSimples(s, e, e.sal, '100', '7.50', { descricao: 'preço corrigido' }));
    assert.equal(r.retificacao.modo, 'NO_LUGAR');
    assert.equal(r.valor_total, '750.00');
    assert.deepEqual(r.itens[0].consumos, v0.itens[0].consumos);
    assert.equal(r.itens[0].movimentacao_estoque_id, v0.itens[0].movimentacao_estoque_id);
    const antes = await foto([s.c]);
    recusa(await retificarReq(s.token, r, vendaSimples(s, e, e.sal, '100', '7.50', { documento_referencia: 'NF-1' })), 409, 'OPERACAO_DOCUMENTO_DUPLICADO', 'documento_duplicado');
    assert.equal(await foto([s.c]), antes);
    assert.ok(outra.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E4 — parcelas 1 → 3 → 12, moedas e volume de rateio', () => {
  for (const [pais, moeda, locale, casas] of [['BR', 'BRL', 'pt-BR', 2], ['PY', 'PYG', 'es-PY', 0], ['KW', 'KWD', 'en-US', 3]]) {
    test(`${moeda}: desconto e acréscimo, 1 → 3 → 12 parcelas (NO_LUGAR) e troca de quantidade (SUBSTITUIÇÃO)`, async () => {
      const s = await montarTenant(app, { perfil: { pais, moeda, locale } });
      const e = s.e1;
      const preco = casas === 0 ? '1500' : casas === 3 ? '1.125' : '2.50';
      const desconto = casas === 0 ? '700' : casas === 3 ? '0.333' : '3.33';
      const acrescimo = casas === 0 ? '250' : casas === 3 ? '0.101' : '1.01';
      const doc = (kg, n) => {
        const total = D(kg).times(D(preco)).toDecimalPlaces(casas).minus(D(desconto)).plus(D(acrescimo)).toFixed(casas);
        return docCom(e, s.local, [item(e.sal, kg, preco)], {
          condicao: condicaoDe(n), valor_desconto: desconto, valor_acrescimo: acrescimo, total, parcelas: parcelasDe(total, n, casas),
        });
      };
      let d = await A.criarConfirmar(s.token, doc('100', 1));
      const lote0 = d.itens[0].estoque_lote_nota_id;
      for (const n of [3, 12]) {
        d = await retificar(s, d, doc('100', n));
        assert.equal(d.retificacao.modo, 'NO_LUGAR', `${moeda} ${n}`);
        assert.equal(d.titulos.length, n);
        assert.equal(d.titulos.reduce((t, x) => t.plus(D(x.valor)), D(0)).toFixed(casas), d.valor_total);
        assert.ok(d.titulos.every((t) => t.valor.split('.')[1]?.length === (casas || undefined)));
        assert.equal(d.itens[0].estoque_lote_nota_id, lote0);
      }
      const r = await retificar(s, d, doc('110', 12));
      assert.equal(r.retificacao.modo, 'SUBSTITUICAO');
      assert.deepEqual([r.moeda, r.moeda_casas, r.titulos.length], [moeda, casas, 12]);
      assert.equal(await estoqueAtual(e.sal), '110.0000');
    });
  }

  test('POR_ITEM com 216 linhas de rateio (12 itens × 18 linhas): a retificação recria as linhas dentro dos limites', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    // 18 combinações distintas de natureza × centro de custo × centro de resultado por item (sem linha repetida).
    const nats = [e.desp, e.desp2, e.desp3];
    const linhas = Array.from({ length: 18 }, (_, j) => ({
      natureza_id: nats[j % 3].id, centro_custo_id: [null, e.cc.id, e.cc2.id][Math.floor(j / 3) % 3], centro_resultado_id: j >= 9 ? e.cr.id : null, percentual: j === 17 ? '6.5' : '5.5',
    }));
    const itens = Array.from({ length: 12 }, (_, i) => ({
      tipo_item: 'MERCADORIA', produto_id: (i % 2 ? e.sal : e.milho).id, local_estoque_id: s.local.id, unidade: 'KG', quantidade: '10', valor_unitario: '10.00', rateios: linhas,
    }));
    const doc = (n) => ({
      empresa_id: e.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: condicaoDe(n), parceiro_id: e.forn.id, data_emissao: '2027-06-10',
      data_operacional: '2027-06-10', efeito_fisico_confirmado: true, itens, rateio_modo: 'PERCENTUAL', rateio_escopo: 'POR_ITEM', rateios: [], parcelas: parcelasDe('1200.00', n),
    });
    const d0 = await A.criarConfirmar(s.token, doc(1));
    const r = await retificar(s, d0, doc(12));
    assert.equal(r.retificacao.modo, 'NO_LUGAR');
    assert.equal(r.itens.reduce((t, i) => t + i.rateios.length, 0), 216);
    assert.equal(await prisma().operacaoFinanceiraItemRateio.count({ where: { cliente_id: s.c } }), 216);
    assert.equal(r.titulos.length, 12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E5 — bloqueios: 409 com motivo e nada mudou', () => {
  /**
   * Compra de 100 kg de sal (lote L) e a situação montada por `preparar`;
   * confere a elegibilidade, a retificação FÍSICA (100 → 90 kg) e a exclusão.
   */
  const bloqueioDaCompra = async (preparar, esperado) => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c = await A.criarConfirmar(s.token, compraSimples(s, e, e.sal, '100'));
    const L = c.itens[0].estoque_lote_nota_id;
    const extra = await preparar(s, e, c, L);
    const atual = await A.detalhe(s.token, c.id, e.id);
    const el = await eleg(s, c.id, e.id);
    assert.deepEqual([el.editar.permitido, el.editar.efeito_fisico_permitido, el.excluir.permitido], [true, false, false], JSON.stringify(el));
    const m = el.excluir.motivos.find((x) => x.codigo === esperado.codigo);
    assert.ok(m, JSON.stringify(el.excluir.motivos));
    assert.equal(m.item_ordem, 1);
    if (esperado.entidade) assert.equal(m.entidade, esperado.entidade);
    if (esperado.numero) assert.equal(m.numero, esperado.numero(extra));
    assert.ok(el.editar.motivos.some((x) => x.codigo === esperado.codigo), 'a faixa da edição mostra a restrição física');
    const antes = await foto([s.c]);
    const r1 = recusa(await retificarReq(s.token, atual, compraSimples(s, e, e.sal, '90')), 409, 'OPERACAO_RETIFICACAO_BLOQUEADA', esperado.codigo);
    assert.ok(codigosDe(r1.details.motivos).includes(esperado.codigo));
    recusa(await excluirReq(s.token, atual, e.id), 409, 'OPERACAO_EXCLUSAO_BLOQUEADA', esperado.codigo);
    assert.equal(await foto([s.c]), antes, 'nada mudou');
    // a correção SEM efeito físico continua permitida (no lugar)
    const r = await retificar(s, atual, compraSimples(s, e, e.sal, '100', '2.00', { descricao: 'só a descrição' }));
    assert.equal(r.retificacao.modo, 'NO_LUGAR');
    return { s, e, c, L, extra };
  };

  test('consumida por VENDA (fatia FIFO): lote_consumido com o número da venda', async () => {
    await bloqueioDaCompra(async (s, e) => A.criarConfirmar(s.token, vendaSimples(s, e, e.sal, '10')), {
      codigo: 'lote_consumido', entidade: 'OperacaoFinanceira', numero: (venda) => venda.numero,
    });
  });

  test('consumida por TRANSFERÊNCIA entre locais: lote_consumido com o movimento', async () => {
    await bloqueioDaCompra(async (s, e) => transferir(s, e, e.sal, s.local, s.local2, 10), {
      codigo: 'lote_consumido', entidade: 'MovimentacaoEstoque', numero: (t) => t.movimentacao_saida.numero_movimentacao,
    });
  });

  test('consumida por SUPLEMENTAÇÃO: lote_consumido com o movimento', async () => {
    await bloqueioDaCompra(async (s, e) => suplementar(s, e, e.sal, s.local, 10), {
      codigo: 'lote_consumido', entidade: 'MovimentacaoEstoque', numero: (sup) => sup.movimentacao.numero_movimentacao,
    });
  });

  test('consumida e RECOMPOSTA pelo cancelamento da venda (lote cheio de novo): a fatia da venda cancelada ainda bloqueia', async () => {
    await bloqueioDaCompra(async (s, e, _c, L) => {
      const venda = await A.criarConfirmar(s.token, vendaSimples(s, e, e.sal, '10'));
      await A.ok(A.cancelarReq(s.token, venda.id, e.id));
      const l = await lote(L);
      assert.deepEqual([l.status, l.quantidade_disponivel.toFixed(4)], ['Disponivel', '100.0000'], 'recomposto');
      return venda;
    }, { codigo: 'lote_consumido', entidade: 'OperacaoFinanceira', numero: (venda) => venda.numero });
  });

  test('consumida por suplementação e RECOMPOSTA por SQL sem tocar em updatedAt: o recibo da suplementação ainda bloqueia', async () => {
    await bloqueioDaCompra(async (s, e, _c, L) => {
      const sup = await suplementar(s, e, e.sal, s.local, 10);
      await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_entrada, status = 'Disponivel', "updatedAt" = "createdAt" WHERE id = ${L}`;
      await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = estoque_atual + 10 WHERE id = ${e.sal.id}`;
      return sup;
    }, { codigo: 'lote_consumido', entidade: 'MovimentacaoEstoque', numero: (sup) => sup.movimentacao.numero_movimentacao });
  });

  test('lote alterado por SQL (mudou e voltou, com updatedAt): lote_alterado', async () => {
    await bloqueioDaCompra(async (_s, _e, _c, L) => {
      await prisma().estoqueLoteNota.update({ where: { id: L }, data: { quantidade_disponivel: '99' } });
      await prisma().estoqueLoteNota.update({ where: { id: L }, data: { quantidade_disponivel: '100' } });
    }, { codigo: 'lote_alterado' });
  });

  test('alterar só o custo_unitario por SQL, sem movimento posterior, continua lote_alterado', async () => {
    await bloqueioDaCompra(async (_s, _e, _c, L) => {
      await prisma().estoqueLoteNota.update({ where: { id: L }, data: { custo_unitario: '9.9999' } });
    }, { codigo: 'lote_alterado' });
  });

  test('D-PROD-256: reavaliação do poço numa camada irmã (10 kg a 2 + 10 kg a 4, venda de 5) não bloqueia a exclusão da segunda compra', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c1 = await A.criarConfirmar(s.token, compraSimples(s, e, e.sal, '10', '2.00'));
    const c2 = await A.criarConfirmar(s.token, compraSimples(s, e, e.sal, '10', '4.00'));
    await A.criarConfirmar(s.token, vendaSimples(s, e, e.sal, '5'));
    const L2 = c2.itens[0].estoque_lote_nota_id;
    const l2 = await lote(L2);
    assert.equal(l2.quantidade_disponivel.toFixed(4), '10.0000', 'a segunda compra não foi consumida');
    assert.notEqual(l2.updatedAt.getTime(), l2.createdAt.getTime(), 'o motor reavaliou a camada irmã');
    const el = await eleg(s, c2.id, e.id);
    assert.equal(el.excluir.permitido, true, JSON.stringify(el.excluir.motivos));
    assert.equal((await eleg(s, c1.id, e.id)).excluir.permitido, false, 'a primeira compra foi consumida');
    await excluir(s, c2, e.id);
  });

  // D-PROD-161 (MAIKE-ESTOQUE-P0-01, F3): o POST genérico não grava mais
  // movimento (409). O movimento LEGADO que cita o lote em `lotes_consumidos`
  // (escrito antes da P0) vira fixture de banco: a regra de `provaDaCompra`
  // continua valendo para ele.
  test('movimento administrativo (legado) citando o lote em lotes_consumidos: lote_consumido com o movimento', async () => {
    await bloqueioDaCompra(async (s, e, _c, L) => prisma().movimentacaoEstoque.create({
      data: {
        cliente_id: s.c, empresa_id: e.id, numero_movimentacao: '900001', tipo_movimentacao: 'Saída', data_movimentacao: new Date('2027-06-11T12:00:00.000Z'),
        produto_id: e.sal.id, quantidade: '1', unidade_medida: 'KG', local_estoque_origem: s.local.id, lotes_consumidos: [{ lote_id: L, quantidade: '1.0000' }],
      },
    }), { codigo: 'lote_consumido', entidade: 'MovimentacaoEstoque', numero: (m) => m.numero_movimentacao });
  });

  test('renomear o depósito (PATCH benigno de local_estoque_nome no lote) NÃO bloqueia; a substituição passa', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c = await A.criarConfirmar(s.token, compraSimples(s, e, e.sal, '100'));
    const L = c.itens[0].estoque_lote_nota_id;
    const nome = `DEPOSITO RENOMEADO ${s.c}`;
    await prisma().localEstoque.update({ where: { id: s.local.id }, data: { nome } });
    await A.ok(A.req('PATCH', `/estoque-lotes-nota/${L}`, s.token, { local_estoque_nome: nome }));
    const l = await lote(L);
    assert.notEqual(l.updatedAt.getTime(), l.createdAt.getTime(), 'o PATCH tocou o lote');
    const el = await eleg(s, c.id, e.id);
    assert.deepEqual([el.editar.efeito_fisico_permitido, el.excluir.permitido, el.editar.motivos], [true, true, []]);
    const r = await retificar(s, c, compraSimples(s, e, e.sal, '90'));
    assert.equal(r.retificacao.modo, 'SUBSTITUICAO');
    assert.equal((await lote(L)).status, 'Estornado');
  });

  test('VENDA com movimento posterior no mesmo produto + local: venda_com_movimento_posterior; outro local e outra empresa não contam', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '1000' });
    await loteLegado(s, e, e.sal, s.local2, { kg: '1000' });
    await definirEstoqueAtual(e.sal, '2000');
    const v = await A.criarConfirmar(s.token, vendaSimples(s, e, e.sal, '100'));
    // outro local do mesmo produto e um movimento de OUTRA empresa no mesmo produto + local: não contam
    await suplementar(s, e, e.sal, s.local2, 5);
    await prisma().movimentacaoEstoque.create({
      data: {
        cliente_id: s.c, empresa_id: s.e2.id, numero_movimentacao: `x-${opId().slice(0, 20)}`, tipo_movimentacao: 'Saída', data_movimentacao: new Date('2027-06-12T12:00:00.000Z'),
        produto_id: e.sal.id, quantidade: '1', unidade_medida: 'KG', local_estoque_origem: s.local.id,
      },
    });
    const livre = await eleg(s, v.id, e.id);
    assert.deepEqual([livre.editar.efeito_fisico_permitido, livre.excluir.permitido], [true, true], JSON.stringify(livre));
    // movimento posterior no MESMO produto + local
    const sup = await suplementar(s, e, e.sal, s.local, 5);
    const el = await eleg(s, v.id, e.id);
    assert.deepEqual([el.editar.permitido, el.editar.efeito_fisico_permitido, el.excluir.permitido], [true, false, false]);
    const m = el.excluir.motivos[0];
    assert.deepEqual([m.codigo, m.entidade, m.numero, m.item_ordem], ['venda_com_movimento_posterior', 'MovimentacaoEstoque', sup.movimentacao.numero_movimentacao, 1]);
    const antes = await foto([s.c]);
    recusa(await retificarReq(s.token, v, vendaSimples(s, e, e.sal, '90')), 409, 'OPERACAO_RETIFICACAO_BLOQUEADA', 'venda_com_movimento_posterior');
    recusa(await excluirReq(s.token, v, e.id), 409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'venda_com_movimento_posterior');
    assert.equal(await foto([s.c]), antes);
    // uma COMPRA posterior no mesmo produto + local também conta
    const s2 = await montarTenant(app);
    await loteLegado(s2, s2.e1, s2.e1.sal, s2.local, { kg: '1000' });
    await definirEstoqueAtual(s2.e1.sal, '1000');
    const v2 = await A.criarConfirmar(s2.token, vendaSimples(s2, s2.e1, s2.e1.sal, '100'));
    const c2 = await A.criarConfirmar(s2.token, compraSimples(s2, s2.e1, s2.e1.sal, '50'));
    const el2 = await eleg(s2, v2.id, s2.e1.id);
    assert.equal(el2.excluir.motivos[0].codigo, 'venda_com_movimento_posterior');
    assert.equal(el2.excluir.motivos[0].id, c2.itens[0].movimentacao_estoque_id);
    // relógios diferentes entre instâncias: `createdAt` ANTERIOR mas número MAIOR conta como posterior (falha fechado);
    // anterior nos dois relógios não conta
    const s3 = await montarTenant(app);
    const e3 = s3.e1;
    await loteLegado(s3, e3, e3.sal, s3.local, { kg: '1000' });
    await definirEstoqueAtual(e3.sal, '1000');
    const v3 = await A.criarConfirmar(s3.token, vendaSimples(s3, e3, e3.sal, '100'));
    const numeroVenda = (await movimento(v3.itens[0].movimentacao_estoque_id)).numero_movimentacao;
    const base3 = {
      cliente_id: s3.c, empresa_id: e3.id, tipo_movimentacao: 'Saída', data_movimentacao: new Date('2027-06-12T12:00:00.000Z'), produto_id: e3.sal.id, quantidade: '1',
      unidade_medida: 'KG', local_estoque_origem: s3.local.id, createdAt: new Date('2020-01-01T00:00:00.000Z'),
    };
    await prisma().movimentacaoEstoque.create({ data: { ...base3, numero_movimentacao: '0' } });
    assert.equal((await eleg(s3, v3.id, e3.id)).excluir.permitido, true, 'anterior nos dois relógios');
    const adiantado = await prisma().movimentacaoEstoque.create({ data: { ...base3, numero_movimentacao: String(Number(numeroVenda) + 1000) } });
    const el3 = await eleg(s3, v3.id, e3.id);
    assert.deepEqual([el3.excluir.permitido, el3.excluir.motivos[0].codigo, el3.excluir.motivos[0].id], [false, 'venda_com_movimento_posterior', adiantado.id]);
  });

  for (const [nome, preparar] of [
    ['baixa PARCIAL', async (s, d) => A.ok(A.liquidarReq(s.token, d.titulos[0].id, s.e1.id, { valor: '100.00' }), 201)],
    ['baixa INTEGRAL', async (s, d) => A.ok(A.liquidarReq(s.token, d.titulos[0].id, s.e1.id, { valor: '500.00' }), 201)],
    ['baixa ESTORNADA', async (s, d) => {
      const l = await A.ok(A.liquidarReq(s.token, d.titulos[0].id, s.e1.id, { valor: '100.00' }), 201);
      return A.ok(A.estornarReq(s.token, l.titulos[0].liquidacoes[0].id, s.e1.id), 201);
    }],
  ]) {
    test(`${nome}: tem_liquidacao (parcela e id da liquidação) bloqueia editar e excluir; duplicar continua`, async () => {
      const s = await montarTenant(app);
      const d = await A.criarConfirmar(s.token, docSem(s.e1));
      const depois = await preparar(s, d);
      const liq = depois.titulos[0].liquidacoes.find((x) => x.tipo === 'LIQUIDACAO');
      const el = await eleg(s, d.id, s.e1.id);
      assert.deepEqual([el.editar.permitido, el.editar.modo, el.excluir.permitido, el.excluir.modo, el.duplicar.permitido], [false, null, false, null, true]);
      assert.deepEqual([el.editar.motivos[0].codigo, el.editar.motivos[0].numero_parcela, el.editar.motivos[0].id], ['tem_liquidacao', 1, liq.id]);
      const atual = await A.detalhe(s.token, d.id, s.e1.id);
      const antes = await foto([s.c]);
      recusa(await retificarReq(s.token, atual, docSem(s.e1, { descricao: 'x' })), 409, 'OPERACAO_RETIFICACAO_BLOQUEADA', 'tem_liquidacao');
      recusa(await excluirReq(s.token, atual, s.e1.id), 409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'tem_liquidacao');
      assert.equal(await foto([s.c]), antes);
    });
  }

  test('baixa NO ATO (à vista): tem_liquidacao', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, docSem(e, { condicao: 'AVISTA', parcelas: [{ vencimento: '2027-06-10', valor: '500.00' }] }), { baixa_no_ato: { metodo: 'DINHEIRO', data: '2027-06-10' } });
    assert.equal(d.titulos[0].status, 'QUITADO');
    const antes = await foto([s.c]);
    recusa(await retificarReq(s.token, d, docSem(e, { condicao: 'AVISTA', descricao: 'x', parcelas: [{ vencimento: '2027-06-10', valor: '500.00' }] })), 409, 'OPERACAO_RETIFICACAO_BLOQUEADA', 'tem_liquidacao');
    recusa(await excluirReq(s.token, d, e.id), 409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'tem_liquidacao');
    assert.equal(await foto([s.c]), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E6 — excluir confirmado (lógico)', () => {
  const conferirExcluido = async (s, e, d, r) => {
    assert.deepEqual([r.id, r.status, r.versao, r.motivo_cancelamento], [d.id, 'CANCELADO', d.versao + 1, `Excluído: ${MOTIVO_EXC}`]);
    assert.ok(r.excluido_em && !r.retificado_em);
    assert.deepEqual([r.exclusao.motivo, r.exclusao.por.login, typeof r.exclusao.em], [MOTIVO_EXC, s.admLogin, 'string']);
    assert.ok(r.titulos.every((t) => t.status === 'CANCELADO'));
    assert.deepEqual(idsDe(await listar(s, e)), []);
    const excl = await listar(s, e, '&situacao=EXCLUIDOS');
    assert.deepEqual(idsDe(excl), [d.id]);
    assert.ok(excl.items[0].excluido_em);
    assert.deepEqual(idsDe(await listar(s, e, '&situacao=TODOS')), [d.id]);
    const evs = await eventosDoBanco(d.id);
    assert.deepEqual(evs.map((x) => [x.tipo, x.modo, x.operacao_nova_id, x.motivo]), [['EXCLUSAO', null, null, MOTIVO_EXC]]);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, entidade_id: d.id, acao: 'operacao_financeira.excluir' } }), 1);
    assert.equal(await prisma().operacaoFinanceira.count({ where: { id: d.id } }), 1, 'nunca DELETE');
    const el = await eleg(s, d.id, e.id);
    assert.deepEqual([el.editar.motivos[0].codigo, el.excluir.permitido, el.duplicar.permitido], ['documento_historico', false, true]);
  };

  test('compra: lote estornado, movimento original + estorno preservados, estoque reconciliado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, compraMista(s, e, { n: 2 }));
    const r = await excluir(s, d, e.id);
    await conferirExcluido(s, e, d, r);
    const original = await movimento(d.itens[0].movimentacao_estoque_id);
    const estorno = await movimento(r.itens[0].movimentacao_estorno_id);
    assert.deepEqual([original.status, original.movimento_filho_id, estorno.movimento_pai_id, estorno.tipo_detalhado], ['Estornada', estorno.id, original.id, 'estorno_compra']);
    assert.match(estorno.numero_movimentacao, /^\d+$/);
    assert.equal((await lote(d.itens[0].estoque_lote_nota_id)).status, 'Estornado');
    assert.equal(await estoqueAtual(e.racao), '0.0000');
  });

  test('venda: as fatias voltam aos lotes; serviço (sem produtos): sem movimento', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const L = await loteLegado(s, e, e.sal, s.local, { kg: '1000' });
    await definirEstoqueAtual(e.sal, '1000');
    const v = await A.criarConfirmar(s.token, vendaSimples(s, e, e.sal, '100'));
    const r = await excluir(s, v, e.id);
    await conferirExcluido(s, e, v, r);
    assert.equal((await lote(L.id)).quantidade_disponivel.toFixed(4), '1000.0000');
    assert.equal(await estoqueAtual(e.sal), '1000.0000');
    const s2 = await montarTenant(app);
    const sv = await A.criarConfirmar(s2.token, docSem(s2.e1));
    const movs = await contarMovimentos(s2);
    await conferirExcluido(s2, s2.e1, sv, await excluir(s2, sv, s2.e1.id));
    assert.equal(await contarMovimentos(s2), movs);
  });

  test('rascunho: /excluir recusa (409 de situação) e o DELETE físico continua; histórico: 409 documento_historico', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const rasc = await A.criar(s.token, docSem(e));
    const el = await eleg(s, rasc.id, e.id);
    assert.deepEqual([el.editar.modo, el.editar.efeito_fisico_permitido, el.excluir.modo, el.duplicar.permitido], ['RASCUNHO', true, 'DESCARTE', true]);
    recusa(await excluirReq(s.token, rasc, e.id), 409, 'OPERACAO_STATUS_INVALIDO');
    recusa(await retificarReq(s.token, rasc, docSem(e)), 409, 'OPERACAO_STATUS_INVALIDO');
    await A.ok(A.req('DELETE', `/operacoes-financeiras/${rasc.id}?empresa_id=${e.id}&versao=${rasc.versao}`, s.token), 204);
    assert.equal(await prisma().operacaoFinanceira.count({ where: { id: rasc.id } }), 0);
    // cancelado e excluído: históricos
    const c = await A.criarConfirmar(s.token, docSem(e));
    const cancelado = await A.ok(A.cancelarReq(s.token, c.id, e.id));
    const x = await A.criarConfirmar(s.token, docSem(e));
    const excluido = await excluir(s, x, e.id);
    const antes = await foto([s.c]);
    for (const h of [cancelado, excluido]) {
      recusa(await retificarReq(s.token, h, docSem(e)), 409, 'OPERACAO_RETIFICACAO_BLOQUEADA', 'documento_historico');
      recusa(await excluirReq(s.token, h, e.id), 409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'documento_historico');
    }
    assert.equal(await foto([s.c]), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E7 — cadeia de revisões e situação da lista', () => {
  test('SUBSTITUIÇÃO → NO_LUGAR → SUBSTITUIÇÃO → exclusão: eventos nos dois sentidos, números e versões', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d0 = await A.criarConfirmar(s.token, compraSimples(s, e, e.sal, '100'));
    const d1 = await retificar(s, d0, compraSimples(s, e, e.sal, '110'));
    const d1b = await retificar(s, d1, compraSimples(s, e, e.sal, '110', '2.00', { descricao: 'no lugar' }));
    const d2 = await retificar(s, d1b, compraSimples(s, e, e.sal, '120'));
    assert.deepEqual([d1.retificacao.modo, d1b.retificacao.modo, d2.retificacao.modo], ['SUBSTITUICAO', 'NO_LUGAR', 'SUBSTITUICAO']);
    assert.deepEqual([d0.versao, d1.versao, d1b.versao, d2.versao], [2, 3, 4, 5]);
    const v0 = await A.detalhe(s.token, d0.id, e.id);
    const v1 = await A.detalhe(s.token, d1.id, e.id);
    assert.deepEqual([v0.numero, v1.numero, d2.numero], [`${d0.numero}/r2`, `${d0.numero}/r4`, d0.numero]);
    const cadeia = (x) => x.eventos.map((ev) => [ev.modo, ev.operacao_id, ev.operacao_nova_id, ev.versao_anterior, ev.versao_nova, ev.numero_original]);
    const esperada = [['SUBSTITUICAO', d0.id, d1.id, 2, 3, d0.numero], ['NO_LUGAR', d1.id, null, 3, 4, d0.numero], ['SUBSTITUICAO', d1.id, d2.id, 4, 5, d0.numero]];
    for (const x of [v0, v1, d2]) assert.deepEqual(cadeia(x), esperada);
    assert.deepEqual([v0.substitui, v0.substituido_por?.id, v1.substitui?.id, v1.substituido_por?.id, d2.substitui?.id, d2.substituido_por], [null, d1.id, d0.id, d2.id, d1.id, null]);
    assert.deepEqual(d2.eventos[0].por, { id: s.admId, login: s.admLogin });
    assert.deepEqual(idsDe(await listar(s, e)), [d2.id]);
    assert.deepEqual(idsDe(await listar(s, e, '&situacao=TODOS')), [d0.id, d1.id, d2.id].sort());
    assert.deepEqual(idsDe(await listar(s, e, '&situacao=EXCLUIDOS')), []);
    assert.equal((await listar(s, e, '&situacao=TODOS')).total, 3);
    const x = await excluir(s, d2, e.id);
    assert.deepEqual(idsDe(await listar(s, e)), []);
    assert.deepEqual(idsDe(await listar(s, e, '&situacao=EXCLUIDOS')), [d2.id]);
    assert.equal(x.eventos.length, 4);
    assert.deepEqual(x.eventos.map((ev) => ev.tipo), ['RETIFICACAO', 'RETIFICACAO', 'RETIFICACAO', 'EXCLUSAO']);
    assert.equal(await estoqueAtual(e.sal), '0.0000');
    recusa(await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&situacao=OUTRA`, s.token), 400, 'REQUEST_VALIDATION_FAILED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Portão (padrão da P3-02): gatilho que segura o INSERT do tenant do teste até
// o teste abrir; quem espera quem é lido em pg_locks/pg_blocking_pids.
const PORTAO = 'p303_portao';
const instalarPortao = async (s, tabela) => {
  const p = prisma();
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(157, 1); RETURN NEW; END $f$`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
  await p.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} BEFORE INSERT ON "${tabela}" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}') EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = (tabela) => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "${tabela}"`);
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(157, 1)`;
    return fn();
  }, { maxWait: 10000, timeout: 60000 });
const paradosNoPortao = async () => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 157 AND objid = 1 AND objsubid = 2 AND NOT granted`);
  return l.length ? l.map((r) => r.pid) : null;
};
const bloqueadosPor = async (pids) => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND pg_blocking_pids(pid) && ${pids}::int[]`);
  return l.length ? l.map((r) => r.pid) : null;
};
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};
/**
 * `primeiro` para no portão (instalado em `tabela`); `segundo` chega e fica
 * BLOQUEADO por ele (observado em pg_blocking_pids); o teste abre o portão.
 */
const corrida = async (s, tabela, primeiro, segundo) => {
  await instalarPortao(s, tabela);
  try {
    return await comPortaoFechado(async () => {
      const p1 = primeiro();
      const pids = await esperar(paradosNoPortao, 'primeiro no portão');
      const p2 = segundo();
      await esperar(() => bloqueadosPor(pids), 'segundo bloqueado pelo primeiro');
      return { p1, p2 };
    }).then(async ({ p1, p2 }) => ({ r1: await p1, r2: await p2 }));
  } finally {
    await removerPortao(tabela);
  }
};

describe('E8 — concorrência determinística (portão): no máximo um efeito', () => {
  test('EDITAR × EDITAR (mesma versão): um passa, o outro 409 de versão; um evento', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, docSem(e));
    const { r1, r2 } = await corrida(s, 'OperacaoFinanceiraEvento',
      () => retificarReq(s.token, d, docSem(e, { descricao: 'primeira' })),
      () => retificarReq(s.token, d, docSem(e, { descricao: 'segunda' })));
    assert.equal(r1.statusCode, 200, r1.body);
    recusa(r2, 409, 'OPERACAO_VERSAO_CONFLITO');
    assert.equal((await A.detalhe(s.token, d.id, e.id)).descricao, 'primeira');
    assert.equal(await prisma().operacaoFinanceiraEvento.count({ where: { cliente_id: s.c } }), 1);
  });

  test('EDITAR × LIQUIDAR: retificação primeiro → a liquidação não acha o título antigo; liquidação primeiro → 409 tem_liquidacao', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, docSem(e));
    const { r1, r2 } = await corrida(s, 'OperacaoFinanceiraEvento',
      () => retificarReq(s.token, d, docSem(e, { descricao: 'corrigido' })),
      () => A.liquidarReq(s.token, d.titulos[0].id, e.id));
    assert.equal(r1.statusCode, 200, r1.body);
    recusa(r2, 404, 'TITULO_FINANCEIRO_NOT_FOUND');
    assert.equal(await prisma().liquidacaoFinanceira.count({ where: { cliente_id: s.c } }), 0);
    // ao contrário
    const d2 = await A.criarConfirmar(s.token, docSem(e));
    const { r1: l1, r2: l2 } = await corrida(s, 'LiquidacaoFinanceira',
      () => A.liquidarReq(s.token, d2.titulos[0].id, e.id),
      () => retificarReq(s.token, d2, docSem(e, { descricao: 'corrigido' })));
    assert.equal(l1.statusCode, 201, l1.body);
    recusa(l2, 409, 'OPERACAO_RETIFICACAO_BLOQUEADA', 'tem_liquidacao');
    assert.equal(await prisma().operacaoFinanceiraEvento.count({ where: { cliente_id: s.c, operacao_id: d2.id } }), 0);
  });

  test('EDITAR × CANCELAR (substituição primeiro): o cancelamento acha o antigo já CANCELADO', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, compraSimples(s, e, e.sal, '100'));
    const { r1, r2 } = await corrida(s, 'OperacaoFinanceiraEvento',
      () => retificarReq(s.token, d, compraSimples(s, e, e.sal, '120')),
      () => A.cancelarReq(s.token, d.id, e.id));
    assert.equal(r1.statusCode, 200, r1.body);
    recusa(r2, 409, 'OPERACAO_STATUS_INVALIDO');
    assert.equal(await estoqueAtual(e.sal), '120.0000');
  });

  test('EDITAR × EXCLUIR: a exclusão encontra a versão nova (409); um evento', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, docSem(e));
    const { r1, r2 } = await corrida(s, 'OperacaoFinanceiraEvento',
      () => retificarReq(s.token, d, docSem(e, { descricao: 'corrigido' })),
      () => excluirReq(s.token, d, e.id));
    assert.equal(r1.statusCode, 200, r1.body);
    recusa(r2, 409, 'OPERACAO_VERSAO_CONFLITO');
    assert.equal(await prisma().operacaoFinanceiraEvento.count({ where: { cliente_id: s.c } }), 1);
    assert.equal((await A.detalhe(s.token, d.id, e.id)).excluido_em, null);
  });

  test('EXCLUIR compra × VENDA do mesmo produto, nos dois sentidos: no máximo um efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c = await A.criarConfirmar(s.token, compraSimples(s, e, e.sal, '100'));
    const rascunhoVenda = await A.criar(s.token, vendaSimples(s, e, e.sal, '50'));
    const { r1, r2 } = await corrida(s, 'OperacaoFinanceiraEvento',
      () => excluirReq(s.token, c, e.id),
      () => A.confirmarReq(s.token, rascunhoVenda, e.id));
    assert.equal(r1.statusCode, 200, r1.body);
    recusa(r2, 422, 'ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente');
    assert.equal(await estoqueAtual(e.sal), '0.0000');
    // venda primeiro (portão na fatia FIFO): a exclusão vê o lote consumido
    const s2 = await montarTenant(app);
    const e2 = s2.e1;
    const c2 = await A.criarConfirmar(s2.token, compraSimples(s2, e2, e2.sal, '100'));
    const venda = await A.criar(s2.token, vendaSimples(s2, e2, e2.sal, '50'));
    const { r1: v1, r2: x2 } = await corrida(s2, 'OperacaoFinanceiraConsumoLote',
      () => A.confirmarReq(s2.token, venda, e2.id),
      () => excluirReq(s2.token, c2, e2.id));
    assert.equal(v1.statusCode, 200, v1.body);
    recusa(x2, 409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'lote_consumido');
    assert.equal(await estoqueAtual(e2.sal), '50.0000');
  });

  test('replay: mesma operation_id e mesmo corpo → mesma resposta sem gravar; corpo diferente → 409; em paralelo → um efeito e um replay', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, compraSimples(s, e, e.sal, '100'));
    const chave = opId();
    const corpo = { ...compraSimples(s, e, e.sal, '120'), versao: d.versao, operation_id: chave, motivo: MOTIVO_RET };
    const r1 = await A.ok(A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, s.token, corpo));
    const antes = await foto([s.c]);
    const r2 = await A.ok(A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, s.token, corpo));
    assert.equal(r2.replay, true);
    assert.deepEqual({ ...r2, replay: false }, r1);
    assert.equal(await foto([s.c]), antes, 'o replay não grava');
    recusa(await A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, s.token, { ...corpo, motivo: 'outro motivo' }), 409, 'IDEMPOTENCY_CONFLICT');
    // excluir: replay e conflito
    const x = await A.criarConfirmar(s.token, docSem(e));
    const cx = { empresa_id: e.id, versao: x.versao, operation_id: opId(), motivo: MOTIVO_EXC };
    const x1 = await A.ok(A.req('POST', `/operacoes-financeiras/${x.id}/excluir`, s.token, cx));
    const x2 = await A.ok(A.req('POST', `/operacoes-financeiras/${x.id}/excluir`, s.token, cx));
    assert.deepEqual([x1.replay, x2.replay], [false, true]);
    recusa(await A.req('POST', `/operacoes-financeiras/${x.id}/excluir`, s.token, { ...cx, motivo: 'outro' }), 409, 'IDEMPOTENCY_CONFLICT');
    // em paralelo com a mesma chave: o segundo espera o primeiro e devolve o replay
    const y = await A.criarConfirmar(s.token, docSem(e));
    const cy = { ...docSem(e, { descricao: 'paralelo' }), versao: y.versao, operation_id: opId(), motivo: MOTIVO_RET };
    const { r1: p1, r2: p2 } = await corrida(s, 'OperacaoFinanceiraEvento',
      () => A.req('POST', `/operacoes-financeiras/${y.id}/retificar`, s.token, cy),
      () => A.req('POST', `/operacoes-financeiras/${y.id}/retificar`, s.token, cy));
    assert.deepEqual([p1.statusCode, p2.statusCode, p1.json().replay, p2.json().replay], [200, 200, false, true]);
    assert.equal(await prisma().operacaoFinanceiraEvento.count({ where: { cliente_id: s.c, operacao_id: y.id } }), 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E9 — segurança', () => {
  test('401 sem sessão; 403 sem editar/confirmar/cancelar/excluir/visualizar; elegibilidade mostra sem_permissao', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, docSem(e));
    const corpoRet = { ...docSem(e, { descricao: 'x' }), versao: d.versao, operation_id: opId(), motivo: MOTIVO_RET };
    const corpoExc = { empresa_id: e.id, versao: d.versao, operation_id: opId(), motivo: MOTIVO_EXC };
    const semRetificar = [];
    for (const acoesConta of [{ editar: true }, { salvar: true }, { confirmar: true }, { editar: true, cancelar: true, excluir: true }]) semRetificar.push(await s.contaCom(acoesConta));
    const semExcluir = [];
    for (const acoesConta of [{ cancelar: true }, { excluir: true }, { editar: true, confirmar: true }]) semExcluir.push(await s.contaCom(acoesConta));
    const semVer = await s.contaCom({}, { semVisualizar: true });
    const leitor = await s.contaCom({});
    const editor = await s.contaCom({ salvar: true, confirmar: true });
    const excluidor = await s.contaCom({ cancelar: true, excluir: true });
    const antes = await foto([s.c]);
    for (const r of [
      await A.req('GET', `/operacoes-financeiras/${d.id}/elegibilidade?empresa_id=${e.id}`, null),
      await A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, null, corpoRet),
      await A.req('POST', `/operacoes-financeiras/${d.id}/excluir`, null, corpoExc),
    ]) assert.equal(r.statusCode, 401, r.body);
    for (const conta of semRetificar) recusa(await A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, conta.token, corpoRet), 403, 'ACAO_NAO_PERMITIDA');
    for (const conta of semExcluir) recusa(await A.req('POST', `/operacoes-financeiras/${d.id}/excluir`, conta.token, corpoExc), 403, 'ACAO_NAO_PERMITIDA');
    recusa(await elegReq(semVer.token, d.id, e.id), 403, 'ACAO_NAO_PERMITIDA');
    // só visualizar: a elegibilidade responde, com sem_permissao (não mascarada)
    const el = await eleg(s, d.id, e.id, leitor.token);
    assert.deepEqual([el.editar.permitido, el.excluir.permitido, el.duplicar.permitido], [false, false, false]);
    assert.deepEqual(el.editar.motivos.find((m) => m.codigo === 'sem_permissao').exige, ['editar', 'confirmar']);
    assert.deepEqual(el.excluir.motivos.find((m) => m.codigo === 'sem_permissao').exige, ['cancelar', 'excluir']);
    assert.equal(el.duplicar.motivos[0].codigo, 'sem_permissao');
    assert.equal(await foto([s.c]), antes, 'nada gravado pelas recusas');
    // com as duas ações: passa
    assert.equal((await A.ok(A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, editor.token, corpoRet))).retificacao.modo, 'NO_LUGAR');
    const atual = await A.detalhe(s.token, d.id, e.id);
    assert.ok((await A.ok(A.req('POST', `/operacoes-financeiras/${d.id}/excluir`, excluidor.token, { ...corpoExc, versao: atual.versao }))).excluido_em);
  });

  test('404 outro tenant / outra empresa; 400 corpo; 422 matemática e referência; 409 versão e moeda — nada gravado', async () => {
    const s = await montarTenant(app);
    const outro = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, docSem(e));
    const antes = await foto([s.c, outro.c]);
    for (const [token, empresaId] of [[outro.token, outro.e1.id], [s.token, s.e2.id]]) {
      recusa(await elegReq(token, d.id, empresaId), 404, 'OPERACAO_FINANCEIRA_NOT_FOUND');
      recusa(await A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, token, { ...docSem(e, { empresa_id: empresaId }), versao: d.versao, operation_id: opId(), motivo: 'x' }), 404, 'OPERACAO_FINANCEIRA_NOT_FOUND');
      recusa(await A.req('POST', `/operacoes-financeiras/${d.id}/excluir`, token, { empresa_id: empresaId, versao: d.versao, operation_id: opId(), motivo: 'x' }), 404, 'OPERACAO_FINANCEIRA_NOT_FOUND');
    }
    recusa(await retificarReq(s.token, d, docSem(e), { motivo: '   ' }), 400, 'REQUEST_VALIDATION_FAILED', 'obrigatorio');
    recusa(await excluirReq(s.token, d, e.id, { motivo: '  ' }), 400, 'REQUEST_VALIDATION_FAILED', 'obrigatorio');
    recusa(await retificarReq(s.token, d, docSem(e), { cliente_id: outro.c }), 400, 'REQUEST_VALIDATION_FAILED');
    recusa(await A.req('POST', `/operacoes-financeiras/${d.id}/retificar`, s.token, { ...docSem(e), versao: d.versao, operation_id: opId() }), 400, 'REQUEST_VALIDATION_FAILED');
    recusa(await retificarReq(s.token, d, docSem(e), { motivo: 'x'.repeat(501) }), 400, 'REQUEST_VALIDATION_FAILED');
    recusa(await retificarReq(s.token, d, docSem(e, { parcelas: [{ vencimento: '2027-07-10', valor: '400.00' }] })), 422, 'OPERACAO_PARCELAS_INVALIDAS');
    recusa(await retificarReq(s.token, d, docSem(e, { rateios: [{ natureza_id: s.e2.desp.id, valor: '500.00' }] })), 422, 'OPERACAO_REFERENCIA_INVALIDA', 'natureza_nao_encontrada');
    recusa(await retificarReq(s.token, d, docSem(e), { versao: d.versao - 1 }), 409, 'OPERACAO_VERSAO_CONFLITO');
    recusa(await excluirReq(s.token, d, e.id, { versao: d.versao + 1 }), 409, 'OPERACAO_VERSAO_CONFLITO');
    assert.equal(await foto([s.c, outro.c]), antes, 'nada gravado');
    // moeda do perfil diferente da do documento (adulterada fora da API) → 409 moeda_mudou
    await prisma().perfilFinanceiroEmpresa.update({ where: { cliente_id_empresa_id: { cliente_id: s.c, empresa_id: e.id } }, data: { moeda: 'USD' } });
    recusa(await retificarReq(s.token, d, docSem(e, { descricao: 'x' })), 409, 'OPERACAO_RETIFICACAO_BLOQUEADA', 'moeda_mudou');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E10 — medição: 200 itens × 120 parcelas', () => {
  test('retificar (substituição) e excluir cabem em 60 s com folga', async (t) => {
    const s = await montarTenant(app);
    const e = s.e1;
    const itens = Array.from({ length: 200 }, (_, i) => ({
      tipo_item: 'MERCADORIA', produto_id: [e.sal, e.milho][i % 2].id, local_estoque_id: (i % 3 ? s.local : s.local2).id, unidade: 'KG', quantidade: '10', valor_unitario: '1.00',
    }));
    const doc = (kg) => {
      const its = itens.map((x, i) => (i === 0 ? { ...x, quantidade: kg } : x));
      const total = D(kg).plus(D(1990)).toFixed(2);
      return {
        empresa_id: e.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PARCELADO', parceiro_id: e.forn.id, data_emissao: '2027-06-10',
        data_operacional: '2027-06-10', efeito_fisico_confirmado: true, itens: its, rateio_modo: 'PERCENTUAL', rateio_escopo: 'GERAL',
        rateios: [{ natureza_id: e.desp.id, percentual: '100' }], parcelas: parcelasDe(total, 120),
      };
    };
    const d = await A.criarConfirmar(s.token, doc('10'));
    assert.equal(d.titulos.length, 120);
    const t0 = Date.now();
    const r = await retificar(s, d, doc('20'));
    const msRetificar = Date.now() - t0;
    assert.equal(r.retificacao.modo, 'SUBSTITUICAO');
    assert.deepEqual([r.itens.length, r.titulos.length], [200, 120]);
    const t1 = Date.now();
    const x = await excluir(s, r, e.id);
    const msExcluir = Date.now() - t1;
    assert.ok(x.excluido_em);
    assert.equal(await estoqueAtual(e.sal), '0.0000');
    t.diagnostic(`medição 200 itens × 120 parcelas: retificar (substituição) ${msRetificar} ms; excluir ${msExcluir} ms`);
    assert.ok(msRetificar < 60000 && msExcluir < 60000, `${msRetificar} / ${msExcluir} ms`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E11 — o banco é a última rede: CHECK, UNIQUE e FKs do evento', () => {
  test('forma, motivo, versões, unique da substituição e FKs compostas (tenant, empresa, autor) recusam no banco', async () => {
    const s = await montarTenant(app);
    const outro = await montarTenant(app);
    const e = s.e1;
    const d0 = await A.criarConfirmar(s.token, docSem(e));
    const d1 = await retificar(s, d0, docSem(e, { direcao: 'RECEBER', parceiro_id: e.cli.id, rateios: [{ natureza_id: e.rec.id, valor: '500.00' }] }));
    assert.equal(d1.retificacao.modo, 'SUBSTITUICAO', 'trocar a direção é efeito novo (assinatura física)');
    const dOutraEmpresa = await A.criarConfirmar(s.token, docSem(s.e2));
    const base = {
      cliente_id: s.c, empresa_id: e.id, operacao_id: d0.id, tipo: 'EXCLUSAO', numero_original: '1', versao_anterior: 1, versao_nova: 2, motivo: 'x',
      usuario_id: s.admId, snapshot_anterior: {},
    };
    const recusados = {
      'tipo fora do domínio': { tipo: 'APAGAR' },
      'modo fora do domínio': { tipo: 'RETIFICACAO', modo: 'OUTRO' },
      'exclusão com modo': { modo: 'NO_LUGAR' },
      'exclusão com documento novo': { operacao_nova_id: d1.id },
      'substituição sem documento novo': { tipo: 'RETIFICACAO', modo: 'SUBSTITUICAO' },
      'no lugar com documento novo': { tipo: 'RETIFICACAO', modo: 'NO_LUGAR', operacao_nova_id: dOutraEmpresa.id },
      'retificação sem modo': { tipo: 'RETIFICACAO' },
      'motivo só com espaços': { motivo: '   ' },
      'versão nova não maior': { versao_nova: 1 },
      'versão anterior zero': { versao_anterior: 0 },
      'documento novo já nascido de outra substituição (unique)': { tipo: 'RETIFICACAO', modo: 'SUBSTITUICAO', operacao_nova_id: d1.id },
      'documento de outra empresa (FK composta)': { operacao_id: dOutraEmpresa.id },
      'autor de outro tenant (FK composta)': { usuario_id: outro.admId },
      'documento de outro tenant (FK composta)': { cliente_id: outro.c, empresa_id: outro.e1.id, usuario_id: outro.admId },
    };
    const antes = await foto([s.c, outro.c]);
    for (const [caso, extra] of Object.entries(recusados)) {
      await assert.rejects(prisma().operacaoFinanceiraEvento.create({ data: { ...base, ...extra } }), undefined, caso);
    }
    assert.equal(await foto([s.c, outro.c]), antes);
    // RLS ligada (sem FORCE) e sem acesso dos papéis da Data API
    const [rls] = /** @type {any[]} */ (await prisma().$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'OperacaoFinanceiraEvento'`);
    assert.deepEqual([rls.relrowsecurity, rls.relforcerowsecurity], [true, false]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E12 — revisão: peso por saco gravado e procedência do estoque', () => {
  /** Compra de 100 SACO de ração (30 kg) a 90,00 — lote de 3000 kg, 3,0000/kg. */
  const compraEmSacos = (s, e, sacos = '100', extra = {}) =>
    docCom(e, s.local, [item(e.racao, sacos, '90.00', { unidade: 'SACO' })], extra);

  test('o cadastro muda o peso por saco (e a unidade) depois da compra: corrigir só a descrição é NO_LUGAR com o fator GRAVADO, com e sem lote consumido; o kg do estoque não muda', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const doc = compraEmSacos(s, e);
    const d0 = await A.criarConfirmar(s.token, doc);
    assert.deepEqual([d0.itens[0].fator_kg, d0.itens[0].quantidade_estoque], ['30.0000', '3000.0000']);
    const loteAntes = await lote(d0.itens[0].estoque_lote_nota_id);
    const movs = await contarMovimentos(s);
    await prisma().produto.update({ where: { id: e.racao.id }, data: { peso_por_saco_kg: '25' } });
    const r1 = await retificar(s, d0, { ...doc, descricao: 'só a descrição' });
    assert.equal(r1.retificacao.modo, 'NO_LUGAR', 'o saco recebido não muda de peso porque o cadastro mudou');
    assert.deepEqual([r1.id, r1.itens[0].estoque_lote_nota_id, r1.itens[0].movimentacao_estoque_id], [d0.id, d0.itens[0].estoque_lote_nota_id, d0.itens[0].movimentacao_estoque_id]);
    assert.deepEqual([r1.itens[0].fator_kg, r1.itens[0].quantidade_estoque], ['30.0000', '3000.0000']);
    assert.deepEqual(await lote(d0.itens[0].estoque_lote_nota_id), loteAntes, 'lote intocado');
    assert.equal(await contarMovimentos(s), movs, 'nenhum movimento novo');
    assert.equal(await estoqueAtual(e.racao), '3000.0000');
    // o produto passa a ser medido em KG: a linha já recebida em SACO continua corrigível (sem `unidade_invalida`)
    await prisma().produto.update({ where: { id: e.racao.id }, data: { unidade_principal_estoque: 'KG' } });
    const r2 = await retificar(s, r1, { ...doc, descricao: 'de novo só a descrição' });
    assert.equal(r2.retificacao.modo, 'NO_LUGAR');
    // lote parcialmente vendido (efeito físico NÃO permitido): a correção informativa continua NO_LUGAR (antes: 409)
    await A.criarConfirmar(s.token, vendaSimples(s, e, e.racao, '10'));
    const el = await eleg(s, d0.id, e.id);
    assert.deepEqual([el.editar.permitido, el.editar.efeito_fisico_permitido], [true, false]);
    const r3 = await retificar(s, r2, { ...doc, descricao: 'descrição com lote consumido' });
    assert.equal(r3.retificacao.modo, 'NO_LUGAR');
    assert.equal(r3.itens[0].quantidade_estoque, '3000.0000');
    assert.equal(await estoqueAtual(e.racao), '2990.0000');
  });

  test('produto INATIVADO depois da compra: a correção recusa 422 produto_inativo, legível, e nada muda (falha fechada; reativar o produto para corrigir)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const doc = compraEmSacos(s, e);
    const d0 = await A.criarConfirmar(s.token, doc);
    await prisma().produto.update({ where: { id: e.racao.id }, data: { ativo: false } });
    const antes = await foto([s.c]);
    recusa(await retificarReq(s.token, d0, { ...doc, descricao: 'só a descrição' }), 422, 'OPERACAO_REFERENCIA_INVALIDA', 'produto_inativo');
    assert.equal(await foto([s.c]), antes, 'nada mudou');
  });

  test('peso por saco mudou e a correção muda a quantidade (100 → 90 SACO): SUBSTITUIÇÃO com o fator GRAVADO (o que a tela mostra); produto novo no documento usa o peso atual', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d0 = await A.criarConfirmar(s.token, compraEmSacos(s, e));
    await prisma().produto.update({ where: { id: e.racao.id }, data: { peso_por_saco_kg: '25' } });
    const novoSaco = await prisma().produto.create({
      data: { cliente_id: s.c, empresa_id: e.id, numero_produto: '19', nome_produto: `FARELO ${s.c}`, unidade_principal_estoque: 'SACO', peso_por_saco_kg: '40' },
    });
    const doc1 = docCom(e, s.local, [item(e.racao, '90', '90.00', { unidade: 'SACO' }), item(novoSaco, '2', '50.00', { unidade: 'SACO' })]);
    const r = await retificar(s, d0, doc1);
    assert.equal(r.retificacao.modo, 'SUBSTITUICAO');
    assert.deepEqual(r.itens.map((i) => [i.fator_kg, i.quantidade_estoque]), [['30.0000', '2700.0000'], ['40.0000', '80.0000']]);
    const l = await lote(r.itens[0].estoque_lote_nota_id);
    assert.deepEqual([l.quantidade_entrada.toFixed(4), l.custo_unitario.toFixed(4)], ['2700.0000', '3.0000'], 'custo = líquido / kg do fator gravado');
    assert.equal(await estoqueAtual(e.racao), '2700.0000');
    assert.equal((await lote(d0.itens[0].estoque_lote_nota_id)).status, 'Estornado');
  });

  test('com mercadoria, trocar parceiro, nº do documento e emissão (NO_LUGAR) leva a procedência ao lote e ao movimento originais, com os mesmos ids; a prova de procedência continua valendo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const base = compraSimples(s, e, e.sal, '100', '2.00', { documento_referencia: 'NF-ERRADA' });
    const d0 = await A.criarConfirmar(s.token, base);
    const L = d0.itens[0].estoque_lote_nota_id;
    const M = d0.itens[0].movimentacao_estoque_id;
    const movs = await contarMovimentos(s);
    const loteAntes = await lote(L);
    const r = await retificar(s, d0, { ...base, parceiro_id: e.prest.id, documento_referencia: 'NF-CERTA', data_emissao: '2027-06-01' });
    assert.equal(r.retificacao.modo, 'NO_LUGAR');
    assert.deepEqual([r.itens[0].estoque_lote_nota_id, r.itens[0].movimentacao_estoque_id], [L, M], 'mesmos ids');
    assert.equal(await contarMovimentos(s), movs, 'nenhum movimento novo');
    const l = await lote(L);
    const m = await movimento(M);
    assert.deepEqual([l.fornecedor_id, l.fornecedor_nome, l.numero_documento], [e.prest.id, e.prest.nome, 'NF-CERTA'], 'procedência do lote');
    assert.deepEqual(
      [l.quantidade_entrada, l.quantidade_disponivel, l.custo_unitario, l.status, l.data_documento].map(String),
      [loteAntes.quantidade_entrada, loteAntes.quantidade_disponivel, loteAntes.custo_unitario, loteAntes.status, loteAntes.data_documento].map(String),
      'quantidade, custo, situação e data do lote intactos',
    );
    assert.deepEqual([m.fornecedor_id, m.fornecedor_nome, m.numero_documento, m.data_documento.toISOString().slice(0, 10)], [e.prest.id, e.prest.nome, 'NF-CERTA', '2027-06-01'], 'procedência do movimento');
    // A correção de procedência não conta como "lote alterado": a reversão física continua provada.
    const el = await eleg(s, d0.id, e.id);
    assert.deepEqual([el.editar.efeito_fisico_permitido, el.excluir.permitido, el.editar.motivos], [true, true, []], JSON.stringify(el.editar.motivos));
    // e a exclusão estorna com o MESMO parceiro/documento do movimento original
    const x = await excluir(s, r, e.id);
    const est = await movimento(x.itens[0].movimentacao_estorno_id);
    assert.deepEqual([est.fornecedor_id, est.numero_documento], [m.fornecedor_id, m.numero_documento], 'par original/estorno coerente');
  });

  test('a procedência benigna só cobre fornecedor e nº do documento: alteração posterior do lote, ou um AuditLog forjado com a mesma ação mudando o custo, continua lote_alterado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const base = compraSimples(s, e, e.sal, '100', '2.00', { documento_referencia: 'NF-A' });
    const d0 = await A.criarConfirmar(s.token, base);
    const L = d0.itens[0].estoque_lote_nota_id;
    const d1 = await retificar(s, d0, { ...base, documento_referencia: 'NF-B' });
    assert.equal(d1.retificacao.modo, 'NO_LUGAR');
    const aud = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'EstoqueLoteNota', entidade_id: L } });
    assert.deepEqual(aud.map((a) => [a.acao, a.dados_anteriores.numero_documento, a.dados_novos.numero_documento]), [['operacao_financeira.retificar_procedencia', 'NF-A', 'NF-B']]);
    assert.equal((await eleg(s, d0.id, e.id)).excluir.permitido, true);
    const mexido = await prisma().estoqueLoteNota.update({ where: { id: L }, data: { custo_unitario: '2.5000' } });
    assert.ok(codigosDe((await eleg(s, d0.id, e.id)).excluir.motivos).includes('lote_alterado'), 'alteração sem AuditLog depois da procedência');
    await prisma().auditLog.create({
      data: {
        cliente_id: s.c, acao: 'operacao_financeira.retificar_procedencia', entidade: 'EstoqueLoteNota', entidade_id: L, request_id: 'forjado',
        dados_anteriores: { custo_unitario: '2.0000', updated_date: d1.updated_date }, dados_novos: { custo_unitario: '2.5000', updated_date: mexido.updatedAt.toISOString() },
      },
    });
    const el = await eleg(s, d0.id, e.id);
    assert.ok(codigosDe(el.excluir.motivos).includes('lote_alterado'), JSON.stringify(el.excluir.motivos));
    recusa(await excluirReq(s.token, d1, e.id), 409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'lote_alterado');
  });

  test('venda: trocar o nº do documento e a emissão (NO_LUGAR) leva a procedência ao movimento de saída; lote consumido de compra aceita a correção do fornecedor sem mexer em quantidade', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = compraSimples(s, e, e.sal, '100', '2.00', { documento_referencia: 'NF-C1' });
    const c0 = await A.criarConfirmar(s.token, compra);
    const venda = vendaSimples(s, e, e.sal, '10', '5.00', { documento_referencia: 'NF-V1' });
    const v0 = await A.criarConfirmar(s.token, venda);
    const v1 = await retificar(s, v0, { ...venda, documento_referencia: 'NF-V2', data_emissao: '2027-06-05' });
    assert.equal(v1.retificacao.modo, 'NO_LUGAR');
    const mv = await movimento(v1.itens[0].movimentacao_estoque_id);
    assert.deepEqual([mv.id, mv.numero_documento, mv.data_documento.toISOString().slice(0, 10), mv.cliente_nome], [v0.itens[0].movimentacao_estoque_id, 'NF-V2', '2027-06-05', e.cli.nome]);
    // a compra está consumida pela venda: a correção do fornecedor é NO_LUGAR e chega ao lote, sem tocar no saldo
    const L = c0.itens[0].estoque_lote_nota_id;
    const disp = (await lote(L)).quantidade_disponivel.toFixed(4);
    const c1 = await retificar(s, c0, { ...compra, parceiro_id: e.legado.id });
    assert.equal(c1.retificacao.modo, 'NO_LUGAR');
    const l = await lote(L);
    assert.deepEqual([l.fornecedor_id, l.fornecedor_nome, l.quantidade_disponivel.toFixed(4)], [e.legado.id, e.legado.nome, disp]);
    assert.equal(await estoqueAtual(e.sal), '90.0000');
  });
});

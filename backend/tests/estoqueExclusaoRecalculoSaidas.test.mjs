/**
 * D-PROD-273 (fatia 4) — EXCLUSÃO COM RECÁLCULO das SAÍDAS, contra PostgreSQL real e pelos serviços de verdade (HTTP
 * autenticado): saída manual, cocho (cancelamento do lançamento), linha de produto da atividade, abastecimento e venda
 * do financeiro. Com movimento depois no depósito, a exclusão grava o estorno (o par some das telas) e recalcula o
 * custo médio de tudo que veio depois, na ordem do número do movimento, com os dependentes. Números à mão em cada
 * cenário; no fim de cada um, o replay completo do produto tem de bater com o gravado (`auditarReplayDoProduto`).
 *
 * D-PROD-313 — só o último sai: com um registro DEPOIS que ainda vale (no mesmo produto e depósito; na transferência,
 * origem ou destino), a exclusão é recusada com 409 `ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR` e nada é gravado; exclui-se
 * do mais recente para o mais antigo. O recálculo só roda quando depois dele restam apenas pares já excluídos.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';
import { acoesAbastecimento, corpoAbastecimento, montarAbastecimento, opId } from './patrimonioP1AbastecimentoCenario.mjs';
import { auditarReplayDoProduto } from '../src/modules/estoqueRecalculo/estoqueRecalculoService.js';
import { emLeituraSomente } from '../src/modules/estoqueRecalculo/estoqueRecalculoLeitor.js';
import { chaveTravaProduto } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let AB;
/** Cliente do TESTE (pool próprio) para segurar a trava do produto de fora do app. @type {PrismaClient} */
let aux;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
  AB = acoesAbastecimento(app);
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const hoje = () => new Date().toISOString().slice(0, 10);
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};
let seq = 0;

const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const sal = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `SAL-${suf}`, nome_produto: 'Sal mineral', unidade_principal_estoque: 'KG' } });
  const motivosEntrada = (await H.ok(H.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const motivosSaida = (await H.ok(H.req('GET', '/estoque/motivos-saida', s.token))).items;
  const compra = motivosEntrada.find((m) => m.nome === 'Compra').id;
  const perda = motivosSaida.find((m) => m.nome === 'Perda').id;
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: `ADUBAÇÃO ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true } });
  ok(await H.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  return { ...s, sal, compra, perda, tipo };
};

const entrar = async (x, produto, local, kg, custo, unidade = 'KG') =>
  ok(await H.req('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e1.id, operation_id: `en-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade, quantidade: kg, custo_unitario: custo }],
  }), 201);
const sair = async (x, produto, local, kg) =>
  ok(await H.req('POST', '/estoque/saidas', x.token, {
    empresa_id: x.e1.id, operation_id: `sa-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg }],
  }), 201);
const excluirSaida = (x, s, versao = s.versao) =>
  H.req('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e1.id, versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
const transferir = async (x, produto, origem, destino, kg) => {
  const r = ok(await H.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e1.id, produto_id: produto.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade: kg,
  }), 201);
  return { s: r.movimentacao_saida, r: r.movimentacao_entrada };
};

const mov = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const movDoItem = (doc) => mov(doc.itens[0].movimentacao_estoque_id);
const v4 = (d) => (d === null || d === undefined ? null : Number(d).toFixed(4));
/** [valor_unitario, valor_total, saldo_antes, saldo_depois] gravados. */
const valores = (m) => [v4(m.valor_unitario), v4(m.valor_total), v4(m.saldo_antes), v4(m.saldo_depois)];
const fatias = (m) => (m.lotes_consumidos ?? []).map((f) => [f.lote_id, f.quantidade, f.custo_unitario]);
const camadasDe = async (x, produto, local) =>
  (await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, produto_id: produto.id, local_estoque_id: local.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
    .map((l) => ({ id: l.id, disp: v4(l.quantidade_disponivel), custo: v4(l.custo_unitario), status: l.status, entrada: v4(l.quantidade_entrada) }));
const camadaDaEntrada = async (doc) => (await prisma().estoqueLoteNota.findFirst({ where: { movimentacao_entrada_id: doc.itens[0].movimentacao_estoque_id } })).id;

/** Prova "replay = gravado" do produto (o que a SPEC exige depois de cada exclusão). */
const provarReplay = async (x, produto) => {
  const r = await emLeituraSomente((tx) => auditarReplayDoProduto(tx, x.c, x.e1.id, produto.id));
  assert.equal(r.reproduzivel, true, JSON.stringify({ problemas: r.problemas, parada: r.parada }));
  assert.deepEqual(r.divergencias, [], JSON.stringify(r.divergencias.slice(0, 5)));
  return r;
};
/** D-PROD-313 — exclusão da entrada documentada (a entrada do meio sai antes das mais antigas). */
const excluirEntrada = (x, doc, versao = doc.versao ?? 1) =>
  H.req('POST', `/estoque/entradas/${doc.id}/excluir`, x.token, { empresa_id: x.e1.id, versao, motivo: 'nota errada', operation_id: `ex-${randomUUID()}` });
/** D-PROD-313 — a recusa do registro posterior: [status, code, reason, posterior_id]. */
const POSTERIOR = 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR';
const recusa = (r) => [r.statusCode, r.json().code, r.json().reason ?? r.json().details?.reason, r.json().details?.posterior_id];
/** D-PROD-313 — tudo o que uma exclusão recusada não pode gravar: movimentos, camadas, saldos, documentos, cochos e trilha. */
const fotoGeral = async (x) => {
  const p = prisma();
  const w = { where: { cliente_id: x.c }, orderBy: { id: /** @type {const} */ ('asc') } };
  return JSON.stringify({
    m: await p.movimentacaoEstoque.findMany(w), l: await p.estoqueLoteNota.findMany(w),
    p: await p.produto.findMany({ ...w, select: { id: true, estoque_atual: true } }),
    s: await p.saidaEstoque.findMany(w), si: await p.saidaEstoqueItem.findMany(w), e: await p.entradaEstoque.findMany(w),
    c: await p.suplementacaoEvento.findMany({ ...w, select: { id: true, dados: true } }),
    a: await p.atividadeApontamentoProduto.findMany({ ...w, include: { consumos: true } }),
    b: await p.abastecimentoBem.findMany({ ...w, select: { id: true, status: true, versao: true, custo_total: true } }),
    o: await p.operacaoFinanceira.findMany({ ...w, select: { id: true, status: true, versao: true } }),
    k: await p.operacaoFinanceiraConsumoLote.findMany(w),
    t: await p.auditLog.count({ where: { cliente_id: x.c, acao: 'estoque.recalculo' } }),
  });
};
const trilha = (x, entidade, id) => prisma().auditLog.findMany({ where: { cliente_id: x.c, acao: 'estoque.recalculo', entidade, entidade_id: id }, orderBy: { createdAt: 'asc' } });

/**
 * Cenário base (conta à mão): A recebe 100 kg a R$ 4 (L1) e 100 kg a R$ 6 (L2): 200 kg, R$ 1.000, médio R$ 5.
 * S1 tira 50 kg (L1) a R$ 5 = R$ 250 → 150 kg a R$ 5. Entra 50 kg a R$ 9 (L3): 200 kg, R$ 1.200, médio R$ 6.
 * S2 tira 80 kg (L1 50 + L2 30) a R$ 6 = R$ 480 → 120 kg a R$ 6.
 * Excluir S1: 250 kg, R$ 1.450, médio R$ 5,8; S2 = 80 × 5,8 = R$ 464 (só L1); sobram 170 kg a R$ 5,8 (R$ 986).
 */
const cenarioBase = async (x, saidaS1, saidaS2) => {
  const A = x.local;
  const e1 = await entrar(x, x.sal, A, '100', '4');
  const e2 = await entrar(x, x.sal, A, '100', '6');
  const s1 = await saidaS1(A, '50');
  const e3 = await entrar(x, x.sal, A, '50', '9');
  const s2 = await saidaS2(A, '80');
  return { A, e1, e2, e3, s1, s2, L1: await camadaDaEntrada(e1), L2: await camadaDaEntrada(e2), L3: await camadaDaEntrada(e3) };
};

describe('D-PROD-273 fatia 4 — saída manual', () => {
  test('D-PROD-313: excluir a saída antiga com outra saída depois → 409 registro posterior (a S2) e nada gravado; do mais recente para o mais antigo (S2, a entrada do meio), a S1 sai pelo estorno do valor gravado', async () => {
    const x = await montar();
    const c = await cenarioBase(x, (A, kg) => sair(x, x.sal, A, kg), (A, kg) => sair(x, x.sal, A, kg));
    const m1 = await movDoItem(c.s1);
    const m2 = await movDoItem(c.s2);
    const me3 = await movDoItem(c.e3);
    assert.deepEqual(valores(m2), ['6.0000', '480.0000', '200.0000', '120.0000']);
    assert.deepEqual(fatias(m2), [[c.L1, '50.0000', '6.0000'], [c.L2, '30.0000', '6.0000']]);
    await provarReplay(x, x.sal);

    const antes = await fotoGeral(x);
    const r = await excluirSaida(x, c.s1);
    assert.deepEqual(recusa(r), [409, POSTERIOR, 'registro_posterior', m2.id], r.body);
    assert.deepEqual([r.json().details.posterior_numero, r.json().details.movimento_id, r.json().details.local_estoque_id], [m2.numero_movimentacao, m1.id, c.A.id]);
    assert.match(r.json().message, /exclua primeiro o mais recente/);
    assert.equal(await fotoGeral(x), antes, 'nada foi gravado: saldos, status, camadas e trilha iguais');

    // a S2 é a última: o estorno exato de sempre (nada depois, nada recalculado), com o valor gravado dela
    const r2 = ok(await excluirSaida(x, c.s2));
    assert.equal(r2.recalculo, null);
    const o2 = await mov(m2.id);
    assert.deepEqual([o2.status, o2.movimentacao_grupo_id], ['Estornada', null]);
    assert.equal(v4((await mov(o2.movimento_filho_id)).valor_total), '480.0000', 'o estorno devolve o valor gravado da S2');
    // o par já excluído da S2 não conta; a entrada do meio ainda vale
    assert.deepEqual(recusa(await excluirSaida(x, c.s1)), [409, POSTERIOR, 'registro_posterior', me3.id]);
    ok(await excluirEntrada(x, c.e3));
    const r1 = ok(await excluirSaida(x, c.s1));
    assert.equal(r1.status, 'EXCLUIDA');
    const o1 = await mov(m1.id);
    assert.equal(o1.status, 'Estornada');
    assert.equal(v4((await mov(o1.movimento_filho_id)).valor_total), '250.0000', 'o estorno devolve o valor gravado da S1');
    assert.equal(v4((await prisma().produto.findUnique({ where: { id: x.sal.id } })).estoque_atual), '200.0000');
    assert.equal((await camadasDe(x, x.sal, c.A)).filter((l) => l.status === 'Disponivel').reduce((t, l) => t + Number(l.disp), 0), 200);
    await provarReplay(x, x.sal);
  });
});

// ─── cocho ──────────────────────────────────────────────────────────────────
/**
 * Lançamento de cocho como o formulário: baixa do depósito e o comando de lançamento com a MESMA chave; com
 * `anterior`, o fechamento do período anterior (custo pela mesma conta da tela — o porte do servidor, provado igual no
 * smoke). Devolve o evento e o movimento.
 */
const lancarCocho = async (x, local, { ponto, kg, sobra = 0, data, anterior = null, fechamento = null }) => {
  const chave = `lanc-${randomUUID()}`;
  const movimentacao = ok(await H.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
    operation_id: chave, empresa_id: x.e1.id, produto_id: x.sal.id, local_origem_id: local.id, quantidade: kg, ponto_suplementacao_id: ponto, data_movimentacao: data,
  }), 201).movimentacao;
  const evento = ok(await H.req('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, {
    operation_id: chave,
    evento: {
      empresa_id: x.e1.id, ponto_suplementacao_id: ponto, ponto_nome: `Cocho ${ponto}`, area_id: `area-${ponto}`, area_ids: [`area-${ponto}`], data_lancamento: data,
      produto: 'Sal mineral', produto_id: x.sal.id, quantidade_total_kg: kg, sobra_kg: sobra, dias_periodo: null, consumo_diario_grupo_kg: null,
      total_cabecas_afetadas: 10, movimentacao_estoque_id: movimentacao.id, custo_unitario_kg: Number(movimentacao.valor_unitario),
    },
    lotes: [{ empresa_id: x.e1.id, lote_id: `lote-${ponto}`, lote_nome: 'A', data_lancamento: data, percentual_consumo_lote: 1, dias_periodo: null, dias_ativos_periodo: null, animal_dias_periodo: null, consumo_unitario_dia: null, consumo_por_cabeca_dia_kg: null, consumo_total_lote_periodo_kg: null }],
    ...(anterior ? { evento_anterior_id: anterior.id } : {}),
  }), 201).evento;
  if (anterior && fechamento) ok(await H.req('PATCH', `/suplementacao-eventos/${anterior.id}`, x.token, { ...fechamento, fechado_por_tipo: 'lancamento', fechado_por_evento_id: evento.id }));
  return { evento, mov: movimentacao };
};
const evento = (id) => prisma().suplementacaoEvento.findUnique({ where: { id } });
const cancelarCocho = (x, id) =>
  H.req('POST', `/suplementacao-eventos/${id}/cancelamento`, x.token, { empresa_id: x.e1.id, operation_id: `canc-${randomUUID()}`, motivo: 'lançado em dobro' });

describe('D-PROD-273 fatia 4 — cocho (o caso do dono)', () => {
  test('D-PROD-313 (o caso do dono): entrada, saída para o cocho, outras saídas depois → a elegibilidade e o cancelamento do cocho recusam (registro posterior: o C4, o mais recente) e nada é gravado; cancelados do mais recente para o mais antigo (C4, C3, C2, a entrada), o C1 sai', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    await entrar(x, x.sal, A, '100', '6');
    // C1 (cocho 1): 50 kg a R$ 5 = R$ 250 — a que o dono quer excluir
    const c1 = await lancarCocho(x, A, { ponto: 'cocho-1', kg: 50, data: '2027-06-01' });
    const e3 = await entrar(x, x.sal, A, '50', '9');
    // C2 (cocho 2): 80 kg a R$ 6 = R$ 480; C3 fecha o período de C2: sobra 10, 5 dias → consumo 70 × 6 = R$ 420
    const c2 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 80, data: '2027-06-02' });
    const fech2 = { sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 14, custo_unitario_kg: 6, custo_total_periodo: 420, custo_cab_dia: 8.4, sobra_herdada_kg: 0, custo_sobra_herdada_kg: null, custo_sobra_aproximado: null, sobra_final_camadas: [{ kg: 10, custo_kg: 6 }] };
    const c3 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 20, sobra: 10, data: '2027-06-07', anterior: c2.evento, fechamento: fech2 });
    // C4 fecha C3: herdou 10 kg a R$ 6, fornecido 20, sobra 5 → consumo 25 = 10 × 6 + 15 × 6 = R$ 150
    const fech3 = { sobra_kg: 5, dias_periodo: 5, consumo_diario_grupo_kg: 5, custo_unitario_kg: 6, custo_total_periodo: 150, custo_cab_dia: 3, sobra_herdada_kg: 10, custo_sobra_herdada_kg: 6, custo_sobra_aproximado: false, sobra_final_camadas: [{ kg: 5, custo_kg: 6 }] };
    const c4 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 10, sobra: 5, data: '2027-06-12', anterior: c3.evento, fechamento: fech3 });
    assert.deepEqual([c2.mov.valor_total, c3.mov.valor_total, c4.mov.valor_total].map(v4), ['480.0000', '120.0000', '60.0000']);
    await provarReplay(x, x.sal);

    // a elegibilidade (ensaio) já diz qual registro excluir antes; nada gravado
    const antes = await fotoGeral(x);
    const el = ok(await H.req('GET', `/suplementacao-eventos/${c1.evento.id}/elegibilidade-cancelamento?empresa_id=${x.e1.id}`, x.token));
    assert.deepEqual([el.elegivel, el.codigo], [false, POSTERIOR], JSON.stringify(el));
    const r = await cancelarCocho(x, c1.evento.id);
    assert.deepEqual(recusa(r), [409, POSTERIOR, 'registro_posterior', c4.mov.id], r.body);
    assert.equal(r.json().details.posterior_tipo, 'suplementacao');
    assert.equal(await fotoGeral(x), antes, 'nem o ensaio nem a recusa gravam nada');
    assert.notEqual((await evento(c1.evento.id)).dados.situacao, 'cancelado');

    // do mais recente para o mais antigo: C4, C3 e C2 (o custo deles nunca é recalculado), a entrada de 50 a R$ 9 e o C1
    for (const cx of [c4, c3, c2]) ok(await cancelarCocho(x, cx.evento.id));
    assert.deepEqual(valores(await mov(c2.mov.id)).slice(0, 2), ['6.0000', '480.0000'], 'o valor gravado do C2 não mudou');
    assert.deepEqual(recusa(await cancelarCocho(x, c1.evento.id)), [409, POSTERIOR, 'registro_posterior', e3.itens[0].movimentacao_estoque_id]);
    ok(await excluirEntrada(x, e3));
    ok(await cancelarCocho(x, c1.evento.id));
    assert.equal((await evento(c1.evento.id)).dados.situacao, 'cancelado');
    assert.equal(v4((await prisma().produto.findUnique({ where: { id: x.sal.id } })).estoque_atual), '200.0000');
    await provarReplay(x, x.sal);
  });
});

// ─── atividade, abastecimento, venda ────────────────────────────────────────
/** Atividade aberta + apontamento do dia; devolve as ações da linha de produto. */
const atividade = async (x) => {
  const a = ok(await H.req('POST', '/atividades', x.token, {
    empresa_id: x.e1.id, nome: `Adubação ${++seq}`, tipo_atividade_id: x.tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30',
  }), 201);
  const base = `/atividades/${a.id}/apontamentos`;
  let ap = ok(await H.req('POST', base, x.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', area_executada_dia: '10' }), 201).apontamento;
  return {
    lancar: async (produto, local, kg) => {
      const r = ok(await H.req('POST', `${base}/${ap.id}/produtos`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), produto_id: produto.id, local_estoque_id: local.id, quantidade: kg }), 201);
      ap = r.apontamento;
      return r.linha;
    },
    cancelar: async (linha) => {
      const r = ok(await H.req('POST', `${base}/${ap.id}/produtos/${linha.id}/cancelar`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), motivo: 'lançado errado' }));
      ap = r.apontamento;
      return r.linha;
    },
  };
};
/** Venda (RECEBER) confirmada pelo financeiro, com as linhas dadas (`[produto, local, kg, preço]`). */
const vender = async (x, linhas) => {
  const p = prisma();
  const base = { cliente_id: x.c, empresa_id: x.e1.id };
  const marca = randomUUID().slice(0, 6);
  const cli = await p.fornecedor.create({ data: { ...base, numero_cadastro: `CL-${marca}`, tipo_pessoa: 'Jurídica', nome: `Cliente ${marca}`, tipos: ['cliente'] } });
  const rec = await p.naturezaFinanceira.create({ data: { ...base, numero: `RC-${marca}`, tipo: 'RECEITA', nome: `VENDAS ${marca}` } });
  const centavos = linhas.reduce((t, [, , kg, preco]) => t + Math.round(Number(kg) * Number(preco) * 100), 0);
  const total = `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
  const doc = {
    empresa_id: x.e1.id, direcao: 'RECEBER', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: cli.id, data_emissao: '2027-06-10', data_operacional: '2027-06-10',
    efeito_fisico_confirmado: true,
    itens: linhas.map(([produto, local, kg, preco]) => ({ tipo_item: 'MERCADORIA', produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg, valor_unitario: preco })),
    rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: rec.id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
  };
  const criada = ok(await H.req('POST', '/operacoes-financeiras', x.token, { ...doc, operation_id: opId() }), 201);
  return ok(await H.req('POST', `/operacoes-financeiras/${criada.id}/confirmar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), versao: criada.versao }));
};
const cancelarVenda = (x, id) => H.req('POST', `/operacoes-financeiras/${id}/cancelar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), motivo: 'venda lançada errada' });
const consumosDoItem = async (itemId) =>
  (await prisma().operacaoFinanceiraConsumoLote.findMany({ where: { item_id: itemId }, orderBy: { estoque_lote_nota_id: 'asc' } })).map((c) => [c.estoque_lote_nota_id, v4(c.quantidade), v4(c.custo_unitario)]);

describe('D-PROD-273 fatia 4 — atividade, abastecimento e venda', () => {
  test('D-PROD-313 — linha de produto da atividade: cancelar a antiga com a linha posterior valendo → 409 registro posterior e nada gravado; cancelada a posterior e excluída a entrada do meio, a antiga sai', async () => {
    const x = await montar();
    const at = await atividade(x);
    let l1;
    let l2;
    const c = await cenarioBase(x, async (A, kg) => { l1 = await at.lancar(x.sal, A, kg); return l1; }, async (A, kg) => { l2 = await at.lancar(x.sal, A, kg); return l2; });
    const antes = await prisma().atividadeApontamentoProduto.findUnique({ where: { id: l2.id }, include: { consumos: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual([v4(antes.custo_unitario), v4(antes.custo_total), antes.consumos.map((f) => [f.estoque_lote_nota_id, f.ordem, v4(f.quantidade)])], ['6.0000', '480.0000', [[c.L1, 1, '50.0000'], [c.L2, 2, '30.0000']]]);
    await provarReplay(x, x.sal);
    const foto = await fotoGeral(x);
    await assert.rejects(at.cancelar(l1), (e) => e.message.includes(POSTERIOR) && e.message.includes(`"posterior_id":"${l2.movimentacao_estoque_id}"`));
    assert.equal(await fotoGeral(x), foto, 'nada foi gravado');
    assert.equal((await prisma().atividadeApontamentoProduto.findUnique({ where: { id: l1.id } })).status, l1.status);
    // do mais recente para o mais antigo: a linha posterior (custo gravado), a entrada do meio, a antiga
    assert.equal((await at.cancelar(l2)).status, 'CANCELADO');
    ok(await excluirEntrada(x, c.e3));
    assert.equal((await at.cancelar(l1)).status, 'CANCELADO');
    assert.equal(v4((await prisma().produto.findUnique({ where: { id: x.sal.id } })).estoque_atual), '200.0000');
    await provarReplay(x, x.sal);
  });

  test('D-PROD-313 — abastecimento: cancelar o antigo com o posterior valendo → 409 registro posterior, sem o estorno exato de antes, nada gravado; cancelado o posterior e excluída a entrada do meio, o antigo sai; diesel em L', async () => {
    const x = await montar();
    const d = x.diesel;
    const A = x.local;
    await entrar(x, d, A, '100', '4', 'L');
    await entrar(x, d, A, '100', '6', 'L');
    const ab1 = await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '50', medidor_leitura: '1550.5' }));
    const e3 = await entrar(x, d, A, '50', '9', 'L');
    const ab2 = await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '80', medidor_leitura: '1551' }));
    assert.deepEqual([v4(ab2.custo_unitario), v4(ab2.custo_total)], ['6.0000', '480.0000']);
    await provarReplay(x, d);
    const b2 = await prisma().abastecimentoBem.findUnique({ where: { id: ab2.id } });
    const foto = await fotoGeral(x);
    const r = await AB.cancelar(x.token, ab1.id, { empresa_id: x.e1.id, versao: ab1.versao, motivo: 'lançado em dobro', operation_id: opId() });
    assert.deepEqual(recusa(r), [409, POSTERIOR, 'registro_posterior', b2.movimentacao_estoque_id], r.body);
    assert.equal(r.json().details.posterior_origem, 'abastecimento_patrimonio');
    assert.equal(await fotoGeral(x), foto, 'nada foi gravado');
    // do mais recente para o mais antigo
    ok(await AB.cancelar(x.token, ab2.id, { empresa_id: x.e1.id, versao: b2.versao, motivo: 'lançado em dobro', operation_id: opId() }));
    ok(await excluirEntrada(x, e3));
    ok(await AB.cancelar(x.token, ab1.id, { empresa_id: x.e1.id, versao: ab1.versao, motivo: 'lançado em dobro', operation_id: opId() }));
    assert.notEqual((await prisma().abastecimentoBem.findUnique({ where: { id: ab1.id } })).status, ab1.status);
    assert.equal(v4((await prisma().produto.findUnique({ where: { id: d.id } })).estoque_atual), '200.0000');
    await provarReplay(x, d);
  });

  test('D-PROD-313 — venda do financeiro: cancelar a antiga com a posterior valendo → 409 registro posterior, sem o estorno exato de antes, nada gravado; cancelada a posterior e excluída a entrada do meio, a antiga sai', async () => {
    const x = await montar();
    let v1;
    let v2;
    const c = await cenarioBase(x, async (A, kg) => { v1 = await vender(x, [[x.sal, A, kg, '12']]); return v1; }, async (A, kg) => { v2 = await vender(x, [[x.sal, A, kg, '12']]); return v2; });
    const item2 = v2.itens[0];
    assert.deepEqual(await consumosDoItem(item2.id), [[c.L1, '50.0000', '6.0000'], [c.L2, '30.0000', '6.0000']].sort());
    await provarReplay(x, x.sal);
    const foto = await fotoGeral(x);
    const r = await cancelarVenda(x, v1.id);
    assert.deepEqual(recusa(r), [409, POSTERIOR, 'registro_posterior', item2.movimentacao_estoque_id], r.body);
    assert.equal(r.json().details.posterior_tipo, 'venda_financeiro');
    assert.equal(await fotoGeral(x), foto, 'nada foi gravado');
    assert.equal((await prisma().operacaoFinanceira.findUnique({ where: { id: v1.id } })).status, v1.status);
    // do mais recente para o mais antigo
    assert.equal(ok(await cancelarVenda(x, v2.id)).status, 'CANCELADO');
    assert.deepEqual(await consumosDoItem(item2.id), [[c.L1, '50.0000', '6.0000'], [c.L2, '30.0000', '6.0000']].sort(), 'o custo gravado da posterior não foi recalculado');
    ok(await excluirEntrada(x, c.e3));
    assert.equal(ok(await cancelarVenda(x, v1.id)).status, 'CANCELADO');
    assert.equal(v4((await prisma().produto.findUnique({ where: { id: x.sal.id } })).estoque_atual), '200.0000');
    await provarReplay(x, x.sal);
  });
});

// ─── escolha do proprietário (2026-11-23): contagem de inventário depois → recusa, sem o estorno exato ─────────
const ajustar = async (x, produto, local, contado, unidade = 'KG') =>
  ok(await H.req('POST', '/estoque/ajustes', x.token, {
    empresa_id: x.e1.id, operation_id: `aj-${randomUUID()}`, itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade, quantidade_contada: contado }],
  }), 201);
/** Tudo que o cancelamento poderia gravar no produto (movimentos, camadas, cache) e a trilha do recálculo. */
const fotoProduto = async (x, produto) => {
  const p = prisma();
  const w = { where: { cliente_id: x.c, produto_id: produto.id }, orderBy: { id: /** @type {const} */ ('asc') } };
  return JSON.stringify([await p.movimentacaoEstoque.findMany(w), await p.estoqueLoteNota.findMany(w), await p.produto.findUnique({ where: { id: produto.id } }),
    await p.auditLog.count({ where: { cliente_id: x.c, acao: 'estoque.recalculo' } })]);
};
/** 409 `ajuste_de_inventario_posterior` com o número do ajuste; nada gravado. */
const exigirRecusaPorAjuste = async (r, a) => {
  assert.equal(r.statusCode, 409, r.body);
  const b = r.json();
  assert.deepEqual([b.code, b.reason ?? b.details?.reason, b.details?.ajuste_numero, b.details?.movimento_id],
    ['ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'ajuste_de_inventario_posterior', a.numero, a.itens[0].movimentacao_estoque_id]);
};

describe('D-PROD-273 — escolha do proprietário: contagem de inventário depois recusa também nas origens com estorno exato (atividade, abastecimento, venda)', () => {
  test('linha de produto da atividade com ajuste (falta) depois → 409, sem estorno exato; a linha continua ativa', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    const at = await atividade(x);
    const l1 = await at.lancar(x.sal, A, '50');
    const a = await ajustar(x, x.sal, A, '40'); // falta 10 a 4
    await provarReplay(x, x.sal);
    const antes = await fotoProduto(x, x.sal);
    const prev = ok(await previa(x, l1.movimentacao_estoque_id));
    assert.deepEqual([prev.permitido, prev.modo, prev.recusa?.reason, prev.aviso], [false, null, 'ajuste_de_inventario_posterior', null]);
    await assert.rejects(at.cancelar(l1), /ajuste_de_inventario_posterior/);
    assert.equal(await fotoProduto(x, x.sal), antes, 'nada foi gravado');
    assert.equal((await prisma().atividadeApontamentoProduto.findUnique({ where: { id: l1.id } })).status, l1.status);
    await provarReplay(x, x.sal);
    assert.ok(a.numero);
  });

  test('abastecimento com ajuste (sobra) depois → 409, sem estorno exato; nada gravado', async () => {
    const x = await montar();
    const d = x.diesel;
    await entrar(x, d, x.local, '100', '4', 'L');
    const ab1 = await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '50', medidor_leitura: '1550.5' }));
    const a = await ajustar(x, d, x.local, '60', 'L'); // sobra 10 a 4
    const antes = await fotoProduto(x, d);
    await exigirRecusaPorAjuste(await AB.cancelar(x.token, ab1.id, { empresa_id: x.e1.id, versao: ab1.versao, motivo: 'lançado em dobro', operation_id: opId() }), a);
    assert.equal(await fotoProduto(x, d), antes, 'nada foi gravado');
    assert.equal((await prisma().abastecimentoBem.findUnique({ where: { id: ab1.id } })).status, ab1.status);
    await provarReplay(x, d);
  });

  test('venda do financeiro com ajuste depois → 409, sem estorno exato; a venda continua confirmada', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    const v1 = await vender(x, [[x.sal, A, '50', '12']]);
    const a = await ajustar(x, x.sal, A, '45'); // falta 5 a 4
    const antes = await fotoProduto(x, x.sal);
    await exigirRecusaPorAjuste(await cancelarVenda(x, v1.id), a);
    assert.equal(await fotoProduto(x, x.sal), antes, 'nada foi gravado');
    assert.equal((await prisma().operacaoFinanceira.findUnique({ where: { id: v1.id } })).status, v1.status);
    await provarReplay(x, x.sal);
  });
});

// ─── cascata e concorrência ─────────────────────────────────────────────────
describe('D-PROD-273 fatia 4 — cascata pela transferência e concorrência', () => {
  test('D-PROD-313 — cascata pela transferência: a saída antiga na origem recusa (a transferência vale depois no A) e a transferência recusa (a venda vale depois no B); nada gravado; do mais recente para o mais antigo (venda, transferência, entrada), a saída sai', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    const e1 = await entrar(x, x.sal, A, '50', '2');
    const e2 = await entrar(x, x.sal, A, '100', '5');
    const L2 = await camadaDaEntrada(e2);
    assert.ok(await camadaDaEntrada(e1));
    // S1 tira os 50 da L1 a R$ 4 (150 kg, R$ 600); entra 50 a R$ 10: 150 kg, R$ 900, médio R$ 6
    const s1 = await sair(x, x.sal, A, '50');
    const e3 = await entrar(x, x.sal, A, '50', '10');
    // T: 80 kg A→B a R$ 6 = R$ 480 (só L2); venda de 30 no B a R$ 6 = R$ 180
    const t = await transferir(x, x.sal, A, B, '80');
    const venda = await vender(x, [[x.sal, B, '30', '20']]);
    const [D1] = (await camadasDe(x, x.sal, B)).map((l) => l.id);
    assert.deepEqual(fatias(await mov(t.s.id)).map((f) => f.slice(0, 2)), [[L2, '80.0000']]);
    assert.deepEqual(await consumosDoItem(venda.itens[0].id), [[D1, '30.0000', '6.0000']]);
    await provarReplay(x, x.sal);

    const antes = await fotoGeral(x);
    const r = await excluirSaida(x, s1);
    assert.deepEqual(recusa(r).slice(0, 3), [409, POSTERIOR, 'registro_posterior'], r.body);
    assert.ok([t.s.id, t.r.id].includes(r.json().details.posterior_id), 'o mais recente no A é a transferência');
    assert.equal(r.json().details.local_estoque_id, A.id);
    // a transferência: vale a origem E o destino — a venda no B é posterior
    const rt = await cancelarTransferencia(x, t.s.id);
    assert.deepEqual(recusa(rt), [409, POSTERIOR, 'registro_posterior', venda.itens[0].movimentacao_estoque_id], rt.body);
    assert.equal(rt.json().details.local_estoque_id, B.id);
    assert.equal(await fotoGeral(x), antes, 'nada foi gravado');

    // do mais recente para o mais antigo
    assert.equal(ok(await cancelarVenda(x, venda.id)).status, 'CANCELADO');
    ok(await cancelarTransferencia(x, t.s.id));
    ok(await excluirEntrada(x, e3));
    ok(await excluirSaida(x, s1));
    const disp = async (local) => (await camadasDe(x, x.sal, local)).filter((l) => l.status === 'Disponivel').reduce((s, l) => s + Number(l.disp), 0);
    assert.deepEqual([await disp(A), await disp(B)], [150, 0]);
    await provarReplay(x, x.sal);
  });

  test('D-PROD-313 — duas exclusões simultâneas no mesmo produto (a trava do produto as enfileira) com uma saída depois: as duas recusam (registro posterior: a S3), nada gravado; depois, do mais recente para o mais antigo, todas saem e o replay bate', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    await entrar(x, x.sal, A, '100', '6');
    const s1 = await sair(x, x.sal, A, '50');
    const e3 = await entrar(x, x.sal, A, '50', '9');
    const s2 = await sair(x, x.sal, A, '30');
    const s3 = await sair(x, x.sal, A, '80');
    const m3 = await movDoItem(s3);
    const antes = await fotoGeral(x);
    // segura a trava do produto de fora; as duas exclusões param na fila; solta
    let liberar = () => {};
    const liberado = new Promise((res) => { liberar = () => res(undefined); });
    let pronto = () => {};
    const comTrava = new Promise((res) => { pronto = res; });
    const fim = aux.$transaction(async (t) => {
      await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chaveTravaProduto(x.c, x.e1.id, x.sal.id)}, 0))`;
      pronto();
      await liberado;
    }, { timeout: 60000, maxWait: 10000 });
    await comTrava;
    const ex1 = excluirSaida(x, s1);
    const ex2 = excluirSaida(x, s2);
    for (let i = 0; i < 400; i++) {
      const [{ c }] = /** @type {any[]} */ (await prisma().$queryRaw`SELECT count(*)::int AS c FROM pg_locks WHERE NOT granted`);
      if (c >= 2) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    liberar();
    await fim;
    const [r1, r2] = await Promise.all([ex1, ex2]);
    assert.deepEqual([recusa(r1), recusa(r2)], [[409, POSTERIOR, 'registro_posterior', m3.id], [409, POSTERIOR, 'registro_posterior', m3.id]], `${r1.body} ${r2.body}`);
    assert.equal(await fotoGeral(x), antes, 'nada foi gravado');
    // do mais recente para o mais antigo: S3, S2, a entrada do meio, S1
    ok(await excluirSaida(x, s3));
    ok(await excluirSaida(x, s2));
    ok(await excluirEntrada(x, e3));
    ok(await excluirSaida(x, s1));
    assert.equal(v4((await prisma().produto.findUnique({ where: { id: x.sal.id } })).estoque_atual), '200.0000');
    await provarReplay(x, x.sal);
  });
});

// ─── fail-closed ────────────────────────────────────────────────────────────
describe('D-PROD-273 fatia 4 — fail-closed', () => {
  const retrato = async (x) => JSON.stringify({
    m: await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } }),
    l: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } }),
    i: await prisma().saidaEstoqueItem.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } }),
    s: await prisma().saidaEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } }),
  });

  test('histórico que não reproduz o gravado: a saída manual recusa 409 (nada gravado); a venda mantém o estorno exato de antes, sem marca nem recálculo; teto de posteriores → 422 (D-PROD-313: com algo valendo depois a recusa é a do registro posterior; o recálculo só roda com pares já excluídos depois)', async () => {
    const x = await montar();
    const c = await cenarioBase(x, (A, kg) => sair(x, x.sal, A, kg), (A, kg) => sair(x, x.sal, A, kg));
    // D-PROD-313: com a S2 valendo depois, a recusa é a do registro posterior (antes de ler o histórico)
    const antes0 = await retrato(x);
    assert.deepEqual(recusa(await excluirSaida(x, c.s1)), [409, POSTERIOR, 'registro_posterior', (await movDoItem(c.s2)).id]);
    assert.equal(await retrato(x), antes0, 'nada gravado');
    // do mais recente para o mais antigo até a S1: a entrada do meio sai com recálculo e leva o par da S2 para fora da
    // sequência (os dois marcados); uma saída S4 lançada e excluída depois (estorno exato, sem marca) é o par que faz
    // a exclusão da S1 passar pelo recálculo, que prova o histórico
    ok(await excluirSaida(x, c.s2));
    ok(await excluirEntrada(x, c.e3));
    const s4 = await sair(x, x.sal, c.A, '5');
    ok(await excluirSaida(x, s4));
    // adultera o custo de uma camada fora do motor: o replay sem exclusão deixa de reproduzir o gravado
    const custoL2 = (await prisma().estoqueLoteNota.findUnique({ where: { id: c.L2 } })).custo_unitario;
    await prisma().estoqueLoteNota.update({ where: { id: c.L2 }, data: { custo_unitario: '9.9999' } });
    const antes = await retrato(x);
    const r = await excluirSaida(x, c.s1);
    assert.deepEqual([r.statusCode, r.json().code, r.json().reason ?? r.json().details?.reason], [409, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'replay_diverge_do_gravado'], r.body);
    assert.equal(await retrato(x), antes, 'nada gravado');

    const v = await vender(x, [[x.sal, c.A, '10', '12']]);
    const eDepois = await entrar(x, x.sal, c.A, '5', '7');
    const mv = await mov(v.itens[0].movimentacao_estoque_id);
    // D-PROD-313: a entrada depois vale → recusa, sem o estorno exato; excluída ela (a última), a venda cai no estorno exato
    assert.deepEqual(recusa(await cancelarVenda(x, v.id)), [409, POSTERIOR, 'registro_posterior', eDepois.itens[0].movimentacao_estoque_id]);
    ok(await excluirEntrada(x, eDepois));
    ok(await cancelarVenda(x, v.id));
    const o = await mov(mv.id);
    assert.deepEqual([o.status, o.movimentacao_grupo_id], ['Estornada', null], 'estorno exato, sem marca');
    // só a trilha da dispensa (o motivo), nenhum valor reescrito
    const dispensas = (await prisma().auditLog.findMany({ where: { cliente_id: x.c, acao: 'estoque.recalculo' } })).filter((t) => t.dados_novos.recalculo_dispensado);
    assert.deepEqual(dispensas.map((t) => [t.entidade, t.dados_novos.recalculo_dispensado, t.dados_novos.recusa.reason]), [['Produto', true, 'replay_diverge_do_gravado']]);

    // teto de posteriores (o serviço usa 5.000; aqui 1): 422 antes de processar qualquer coisa
    await prisma().estoqueLoteNota.update({ where: { id: c.L2 }, data: { custo_unitario: custoL2 } });
    const { provarExclusaoComRecalculo } = await import('../src/modules/estoqueRecalculo/estoqueExclusaoRecalculo.js');
    const m1 = await movDoItem(c.s1);
    await assert.rejects(
      prisma().$transaction((tx) => provarExclusaoComRecalculo(tx, x.c, { empresaId: x.e1.id, produtoId: x.sal.id, excluirIds: [m1.id], tetoAfetados: 1 })),
      (e) => e.code === 'ESTOQUE_RECALCULO_VOLUME_EXCEDIDO' && e.details.teto === 1,
    );
    // D-PROD-273 (fatia 5): a entrada passou a ser aceita; o ESTORNO continua não sendo excluível
    const me2 = await movDoItem(c.e2);
    await assert.rejects(
      prisma().$transaction((tx) => provarExclusaoComRecalculo(tx, x.c, { empresaId: x.e1.id, produtoId: x.sal.id, excluirIds: [me2.id], tetoAfetados: 0 })),
      (e) => e.code === 'ESTOQUE_RECALCULO_VOLUME_EXCEDIDO',
      'a entrada passa da validação da origem (para no teto, que vem depois)',
    );
    await assert.rejects(
      prisma().$transaction((tx) => provarExclusaoComRecalculo(tx, x.c, { empresaId: x.e1.id, produtoId: x.sal.id, excluirIds: [o.movimento_filho_id] })),
      (e) => e.code === 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL' && e.details.reason === 'origem_nao_suportada',
      'estorno não se exclui',
    );
  });
});

// ─── achados da revisão independente (rev4) ─────────────────────────────────
const cancelarTransferencia = (x, id) => H.req('POST', `/movimentacoes-estoque/${id}/cancelar-transferencia`, x.token, { empresa_id: x.e1.id, motivo: 'errada', operation_id: opId() });
const previa = (x, id) => H.req('GET', `/estoque/movimentos/${id}/exclusao/previa?empresa_id=${x.e1.id}`, x.token);
/** O "caso do dono" (cocho 1 e a cadeia do cocho 2 com fechamentos pela conta da tela). */
const montarCocho = async () => {
  const x = await montar();
  const A = x.local;
  await entrar(x, x.sal, A, '100', '4');
  await entrar(x, x.sal, A, '100', '6');
  const c1 = await lancarCocho(x, A, { ponto: 'cocho-1', kg: 50, data: '2027-06-01' });
  const e3 = await entrar(x, x.sal, A, '50', '9');
  const c2 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 80, data: '2027-06-02' });
  const fech2 = { sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 14, custo_unitario_kg: 6, custo_total_periodo: 420, custo_cab_dia: 8.4, sobra_herdada_kg: 0, custo_sobra_herdada_kg: null, custo_sobra_aproximado: null, sobra_final_camadas: [{ kg: 10, custo_kg: 6 }] };
  const c3 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 20, sobra: 10, data: '2027-06-07', anterior: c2.evento, fechamento: fech2 });
  const fech3 = { sobra_kg: 5, dias_periodo: 5, consumo_diario_grupo_kg: 5, custo_unitario_kg: 6, custo_total_periodo: 150, custo_cab_dia: 3, sobra_herdada_kg: 10, custo_sobra_herdada_kg: 6, custo_sobra_aproximado: false, sobra_final_camadas: [{ kg: 5, custo_kg: 6 }] };
  const c4 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 10, sobra: 5, data: '2027-06-12', anterior: c3.evento, fechamento: fech3 });
  return { x, A, e3, c1, c2, c3, c4 };
};

describe('D-PROD-273 fatia 4 — achados da revisão: depois de um recálculo, as operações seguintes passam', () => {
  test('(1) D-PROD-313: cancelar C1 com o C2 depois → 409 registro posterior (o C2); na ordem certa — o C2 (o último: estorno exato do valor gravado), a entrada do meio — o C1 sai', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    await entrar(x, x.sal, A, '100', '6');
    const c1 = await lancarCocho(x, A, { ponto: 'cocho-1', kg: 50, data: '2027-06-01' });
    const e3 = await entrar(x, x.sal, A, '50', '9');
    const c2 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 80, data: '2027-06-02' });
    const antes = await fotoGeral(x);
    assert.deepEqual(recusa(await cancelarCocho(x, c1.evento.id)), [409, POSTERIOR, 'registro_posterior', c2.mov.id]);
    assert.equal(await fotoGeral(x), antes, 'nada foi gravado');
    const r = ok(await cancelarCocho(x, c2.evento.id));
    assert.equal(r.recalculo, null, 'C2 é o último de verdade: estorno exato');
    assert.equal(v4(r.estorno.valor_total), '480.0000', 'devolve o valor gravado (80 × 6)');
    ok(await excluirEntrada(x, e3));
    ok(await cancelarCocho(x, c1.evento.id));
    assert.equal((await evento(c1.evento.id)).dados.situacao, 'cancelado');
    await provarReplay(x, x.sal);
  });

  test('(2) D-PROD-313: cancelar C1 com a cadeia do cocho 2 depois → 409 (o C4, o mais recente); cancelar o C4 reabre o período de C3 com o custo/kg gravado; depois C3, C2 e a entrada, o C1 sai', async () => {
    const { x, e3, c1, c2, c3, c4 } = await montarCocho();
    const antes = await fotoGeral(x);
    assert.deepEqual(recusa(await cancelarCocho(x, c1.evento.id)), [409, POSTERIOR, 'registro_posterior', c4.mov.id]);
    assert.equal(await fotoGeral(x), antes, 'nada foi gravado');
    assert.equal((await evento(c3.evento.id)).dados.custo_total_periodo, 150, 'o fechamento de C3 não foi recalculado');
    const r = ok(await cancelarCocho(x, c4.evento.id));
    assert.equal(r.periodo_reaberto.evento_id, c3.evento.id);
    const d3 = (await evento(c3.evento.id)).dados;
    assert.deepEqual([d3.dias_periodo ?? null, d3.custo_total_periodo ?? null, d3.sobra_kg, d3.custo_unitario_kg], [null, null, 10, 6],
      'volta ao retrato de antes do fechamento, com o custo/kg gravado da saída');
    ok(await cancelarCocho(x, c3.evento.id));
    ok(await cancelarCocho(x, c2.evento.id));
    ok(await excluirEntrada(x, e3));
    ok(await cancelarCocho(x, c1.evento.id));
    assert.equal((await evento(c1.evento.id)).dados.situacao, 'cancelado');
    await provarReplay(x, x.sal);
  });

  test('(1) D-PROD-313: excluir S1 com a transferência depois → 409 registro posterior; cancelar a transferência (a última nos dois depósitos) passa; depois a entrada do meio e a S1', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    await entrar(x, x.sal, A, '50', '2');
    await entrar(x, x.sal, A, '100', '5');
    const s1 = await sair(x, x.sal, A, '50');
    const e3 = await entrar(x, x.sal, A, '50', '10');
    const t = await transferir(x, x.sal, A, B, '80');
    const antes = await fotoGeral(x);
    const r = await excluirSaida(x, s1);
    assert.deepEqual(recusa(r).slice(0, 3), [409, POSTERIOR, 'registro_posterior'], r.body);
    assert.ok([t.s.id, t.r.id].includes(r.json().details.posterior_id), r.body);
    assert.equal(await fotoGeral(x), antes, 'nada foi gravado');
    ok(await cancelarTransferencia(x, t.s.id));
    // a transferência volta inteira (80 a 6 = 480): A fica com 150 kg
    const camadasA = (await camadasDe(x, x.sal, A)).filter((l) => l.status === 'Disponivel');
    assert.equal(camadasA.reduce((t2, l) => t2 + Number(l.disp), 0), 150);
    await provarReplay(x, x.sal);
    ok(await excluirEntrada(x, e3));
    ok(await excluirSaida(x, s1));
    assert.equal((await camadasDe(x, x.sal, A)).filter((l) => l.status === 'Disponivel').reduce((t2, l) => t2 + Number(l.disp), 0), 150);
    await provarReplay(x, x.sal);
  });

  test('(1) D-PROD-313: excluir S1 com a S2 depois → 409; EDITAR a S2 (D-PROD-271; a última de verdade) passa pelo médio gravado; a S1 continua presa à S2 nova até ela, a entrada do meio e a S1 saírem nessa ordem', async () => {
    const x = await montar();
    const c = await cenarioBase(x, (A, kg) => sair(x, x.sal, A, kg), (A, kg) => sair(x, x.sal, A, kg));
    assert.deepEqual(recusa(await excluirSaida(x, c.s1)), [409, POSTERIOR, 'registro_posterior', (await movDoItem(c.s2)).id]);
    const s2 = await prisma().saidaEstoque.findUnique({ where: { id: c.s2.id } });
    const r = ok(await H.req('PATCH', `/estoque/saidas/${c.s2.id}`, x.token, {
      empresa_id: x.e1.id, operation_id: `ed-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
      itens: [{ produto_id: x.sal.id, local_estoque_id: c.A.id, unidade: 'KG', quantidade: '70' }], versao: s2.versao, motivo_edicao: 'pesagem refeita',
    }));
    assert.equal(v4(r.itens[0].valor_total), '420.0000', '70 × 6 (o médio com a S1, que continua valendo)');
    await provarReplay(x, x.sal);
    // a linha nova da S2 é o registro posterior que vale agora
    assert.deepEqual(recusa(await excluirSaida(x, c.s1)), [409, POSTERIOR, 'registro_posterior', r.itens[0].movimentacao_estoque_id]);
    ok(await excluirSaida(x, c.s2, r.versao));
    ok(await excluirEntrada(x, c.e3));
    ok(await excluirSaida(x, c.s1));
    assert.equal(v4((await prisma().produto.findUnique({ where: { id: x.sal.id } })).estoque_atual), '200.0000');
    await provarReplay(x, x.sal);
  });
});

describe('D-PROD-273 fatia 4 — achados da revisão: fallback do estorno exato (abastecimento, atividade, venda)', () => {
  test('(3) venda com cocho posterior cujo fechamento não reproduz → D-PROD-313: o cocho vale depois: 409 registro posterior, sem o estorno exato de antes; nada gravado, nenhuma trilha', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    await entrar(x, x.sal, A, '100', '6');
    const v = await vender(x, [[x.sal, A, '50', '12']]);
    await entrar(x, x.sal, A, '50', '9');
    const c2 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 80, data: '2027-06-02' });
    // fechamento gravado fora da conta da tela (custo 999): o servidor não sabe refazer
    const fech = { sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 14, custo_unitario_kg: 6, custo_total_periodo: 999, custo_cab_dia: 8.4, sobra_herdada_kg: 0, custo_sobra_herdada_kg: null, custo_sobra_aproximado: null, sobra_final_camadas: [{ kg: 10, custo_kg: 6 }] };
    const c3 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 20, sobra: 10, data: '2027-06-07', anterior: c2.evento, fechamento: fech });
    const m2Antes = valores(await mov(c2.mov.id));
    const antes = await fotoGeral(x);
    const r = await cancelarVenda(x, v.id);
    // D-PROD-313: o recálculo desfeito (SAVEPOINT) com o estorno exato da venda (cocho_fechamento_nao_reproduzivel) agora é
    // precedido pela recusa do registro posterior: o lançamento C3 no cocho ainda vale.
    assert.deepEqual(recusa(r), [409, POSTERIOR, 'registro_posterior', c3.mov.id], r.body);
    assert.equal(await fotoGeral(x), antes, 'nada foi gravado');
    const mv = await mov(v.itens[0].movimentacao_estoque_id);
    assert.deepEqual([mv.status, mv.movimentacao_grupo_id], ['Ativa', null], 'a venda continua valendo');
    assert.equal((await prisma().operacaoFinanceira.findUnique({ where: { id: v.id } })).status, v.status);
    assert.deepEqual(valores(await mov(c2.mov.id)), m2Antes, 'nada recalculado');
    assert.equal((await evento(c2.evento.id)).dados.custo_total_periodo, 999);
    assert.deepEqual(await trilha(x, 'Produto', x.sal.id), [], 'nem trilha de dispensa');
    await provarReplay(x, x.sal);
  });

  test('(6) movimento legado com movimentacao_grupo_id preenchido: a saída manual recusa grupo_legado_preenchido; a venda cai no estorno exato (D-PROD-313: só com pares já excluídos depois; com algo valendo, registro posterior)', async () => {
    const x = await montar();
    const c = await cenarioBase(x, (A, kg) => sair(x, x.sal, A, kg), (A, kg) => sair(x, x.sal, A, kg));
    const m1 = await movDoItem(c.s1);
    await prisma().movimentacaoEstoque.update({ where: { id: m1.id }, data: { movimentacao_grupo_id: 'grupo-legado-1' } });
    // D-PROD-313: com a S2 valendo depois, a recusa é a do registro posterior
    assert.deepEqual(recusa(await excluirSaida(x, c.s1)), [409, POSTERIOR, 'registro_posterior', (await movDoItem(c.s2)).id]);
    // do mais recente para o mais antigo: a entrada do meio leva o par da S2 para fora da sequência (marcados); com o
    // par de uma S4 excluída pelo estorno exato depois, a S1 chega ao recálculo e ao grupo legado
    ok(await excluirSaida(x, c.s2));
    ok(await excluirEntrada(x, c.e3));
    const s4 = await sair(x, x.sal, c.A, '5');
    ok(await excluirSaida(x, s4));
    const r = await excluirSaida(x, c.s1);
    assert.deepEqual([r.statusCode, r.json().code, r.json().reason ?? r.json().details?.reason], [409, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'grupo_legado_preenchido'], r.body);

    const v = await vender(x, [[x.sal, c.A, '10', '12']]);
    const depois = await sair(x, x.sal, c.A, '5');
    const mv0 = await movDoItem(v);
    await prisma().movimentacaoEstoque.update({ where: { id: mv0.id }, data: { movimentacao_grupo_id: 'grupo-legado-2' } });
    assert.deepEqual(recusa(await cancelarVenda(x, v.id)), [409, POSTERIOR, 'registro_posterior', (await movDoItem(depois)).id]);
    ok(await excluirSaida(x, depois));
    ok(await cancelarVenda(x, v.id));
    const mv = await mov(mv0.id);
    assert.deepEqual([mv.status, mv.movimentacao_grupo_id], ['Estornada', 'grupo-legado-2']);
    const dispensas = (await trilha(x, 'Produto', x.sal.id)).filter((t) => t.dados_novos.recalculo_dispensado);
    assert.equal(dispensas.at(-1).dados_novos.recusa.reason, 'grupo_legado_preenchido');
  });
});

describe('D-PROD-273 fatia 4 — achados da revisão: a prévia diz o que a exclusão vai fazer', () => {
  test('(4) nada depois → "estorno exato" mesmo com histórico que não reproduz; venda com recálculo inviável → estorno exato sem recalcular (sem recusa); venda de 2 itens do mesmo produto e depósito → os dois juntos; D-PROD-313: com algo valendo depois, a prévia já diz qual registro excluir antes', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    const ultima = await sair(x, x.sal, A, '10');
    const camada = await prisma().estoqueLoteNota.findFirst({ where: { cliente_id: x.c, produto_id: x.sal.id } });
    await prisma().estoqueLoteNota.update({ where: { id: camada.id }, data: { custo_unitario: '9.9999' } });
    const p1 = ok(await previa(x, (await movDoItem(ultima)).id));
    assert.deepEqual([p1.permitido, p1.modo, p1.movimentos_posteriores, p1.movimentos.length], [true, 'estorno_exato', 0, 0]);

    const v = await vender(x, [[x.sal, A, '5', '12']]);
    const depois = await sair(x, x.sal, A, '3');
    // D-PROD-313: a saída depois vale → a prévia recusa e aponta para ela
    const p2r = ok(await previa(x, (await movDoItem(v)).id));
    assert.deepEqual([p2r.permitido, p2r.modo, p2r.recusa?.code, p2r.recusa?.reason, p2r.recusa?.posterior_id, p2r.aviso], [false, null, POSTERIOR, 'registro_posterior', (await movDoItem(depois)).id, null]);
    ok(await excluirSaida(x, depois));
    // só o par já excluído depois: a venda tenta o recálculo, que não reproduz → estorno exato sem recalcular
    const p2 = ok(await previa(x, (await movDoItem(v)).id));
    assert.deepEqual([p2.permitido, p2.modo, p2.recusa, p2.aviso.reason], [true, 'estorno_exato_sem_recalculo', null, 'replay_diverge_do_gravado']);
    await prisma().estoqueLoteNota.update({ where: { id: camada.id }, data: { custo_unitario: camada.custo_unitario } });

    const y = await montar();
    await entrar(y, y.sal, y.local, '100', '4');
    await entrar(y, y.sal, y.local, '100', '6');
    const v2 = await vender(y, [[y.sal, y.local, '20', '12'], [y.sal, y.local, '30', '12']]);
    const e3 = await entrar(y, y.sal, y.local, '50', '9');
    const s2 = await sair(y, y.sal, y.local, '80');
    const juntos = [v2.itens[0].movimentacao_estoque_id, v2.itens[1].movimentacao_estoque_id].sort();
    const p3 = ok(await previa(y, v2.itens[0].movimentacao_estoque_id));
    assert.deepEqual([...p3.excluidos].sort(), juntos, 'os dois itens do documento');
    assert.deepEqual([p3.permitido, p3.recusa?.code, p3.recusa?.posterior_id], [false, POSTERIOR, s2.itens[0].movimentacao_estoque_id]);
    assert.deepEqual(recusa(await cancelarVenda(y, v2.id)), [409, POSTERIOR, 'registro_posterior', s2.itens[0].movimentacao_estoque_id]);
    // do mais recente para o mais antigo: a S2 e a entrada do meio; a prévia passa a permitir (os dois itens juntos)
    ok(await excluirSaida(y, s2));
    ok(await excluirEntrada(y, e3));
    const p4 = ok(await previa(y, v2.itens[0].movimentacao_estoque_id));
    assert.deepEqual([p4.permitido, p4.recusa, [...p4.excluidos].sort()], [true, null, juntos]);
    assert.equal(ok(await cancelarVenda(y, v2.id)).status, 'CANCELADO');
    const ms2 = await movDoItem(s2);
    assert.deepEqual([ms2.status, v4(ms2.valor_total)], ['Estornada', '480.0000'], 'o par já excluído da S2 sai da sequência: o valor gravado (80 × 6) não é regravado');
  });
});

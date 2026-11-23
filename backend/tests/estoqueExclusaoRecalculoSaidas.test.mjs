/**
 * D-PROD-273 (fatia 4) — EXCLUSÃO COM RECÁLCULO das SAÍDAS, contra PostgreSQL real e pelos serviços de verdade (HTTP
 * autenticado): saída manual, cocho (cancelamento do lançamento), linha de produto da atividade, abastecimento e venda
 * do financeiro. Com movimento depois no depósito, a exclusão grava o estorno (o par some das telas) e recalcula o
 * custo médio de tudo que veio depois, na ordem do número do movimento, com os dependentes. Números à mão em cada
 * cenário; no fim de cada um, o replay completo do produto tem de bater com o gravado (`auditarReplayDoProduto`).
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
import { marcaDoPar } from '../src/modules/estoqueRecalculo/estoqueReplay.js';
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
  test('excluir a saída antiga com outra saída depois: passa, a posterior vai de R$ 6 (480) para R$ 5,8 (464), saldos sobem 50, fatias e camadas reatribuídas, linha da saída e trilha', async () => {
    const x = await montar();
    const c = await cenarioBase(x, (A, kg) => sair(x, x.sal, A, kg), (A, kg) => sair(x, x.sal, A, kg));
    const m1 = await movDoItem(c.s1);
    let m2 = await movDoItem(c.s2);
    const me3 = await movDoItem(c.e3);
    assert.deepEqual(valores(m2), ['6.0000', '480.0000', '200.0000', '120.0000']);
    assert.deepEqual(fatias(m2), [[c.L1, '50.0000', '6.0000'], [c.L2, '30.0000', '6.0000']]);
    await provarReplay(x, x.sal);

    const r = ok(await excluirSaida(x, c.s1));
    assert.equal(r.status, 'EXCLUIDA');
    assert.deepEqual(r.recalculo, { produtos: 1, movimentos: 2, camadas: 3, dependentes: 1 });
    m2 = await mov(m2.id);
    assert.deepEqual(valores(m2), ['5.8000', '464.0000', '250.0000', '170.0000']);
    assert.deepEqual([v4(m2.custo_medio_antes), v4(m2.custo_medio_depois)], [null, null], 'a saída manual não grava o médio; continua sem');
    assert.deepEqual(fatias(m2), [[c.L1, '80.0000', '5.8000']]);
    assert.deepEqual(valores(await mov(me3.id)).slice(2), ['200.0000', '250.0000'], 'o saldo da entrada do meio sobe 50');
    assert.deepEqual(await camadasDe(x, x.sal, c.A), [
      { id: c.L1, disp: '20.0000', custo: '5.8000', status: 'Disponivel', entrada: '100.0000' },
      { id: c.L2, disp: '100.0000', custo: '5.8000', status: 'Disponivel', entrada: '100.0000' },
      { id: c.L3, disp: '50.0000', custo: '5.8000', status: 'Disponivel', entrada: '50.0000' },
    ]);
    const item2 = await prisma().saidaEstoqueItem.findFirst({ where: { movimentacao_estoque_id: m2.id } });
    assert.deepEqual([v4(item2.custo_unitario), v4(item2.valor_total)], ['5.8000', '464.0000']);
    // o par excluído: original 'Estornada' + estorno, os dois com a marca; o estorno devolveu o valor gravado
    const o1 = await mov(m1.id);
    const e1 = await mov(o1.movimento_filho_id);
    assert.deepEqual([o1.status, o1.movimentacao_grupo_id, e1.movimentacao_grupo_id, v4(e1.valor_total)], ['Estornada', marcaDoPar(m1.id), marcaDoPar(m1.id), '250.0000']);
    assert.match(e1.numero_movimentacao, /^\d+$/);
    // trilha: antes → depois, autor, motivo, o excluído
    const [t2] = await trilha(x, 'MovimentacaoEstoque', m2.id);
    assert.deepEqual([t2.dados_anteriores.valor_total, t2.dados_novos.valor_total, t2.dados_novos.movimentos_excluidos, t2.usuario_id], ['480.0000', '464.0000', [m1.id], x.adm.usuario.id]);
    assert.match(t2.dados_novos.motivo, /lançada errada/);
    const [ti] = await trilha(x, 'SaidaEstoqueItem', item2.id);
    assert.deepEqual([ti.dados_anteriores.valor_total, ti.dados_novos.valor_total], ['480.0000', '464.0000']);
    await provarReplay(x, x.sal);
    // o kardex esconde o par e mostra o saldo regravado SEM descontar de novo (o par recalculado não ajusta nada)
    const kardex = ok(await H.req('GET', `/estoque/movimentos?empresa_id=${x.e1.id}&produto_id=${x.sal.id}`, x.token));
    assert.deepEqual(kardex.items.map((i) => i.id).includes(m1.id), false);
    const k2 = kardex.items.find((i) => i.id === m2.id);
    assert.deepEqual([k2.saldo_antes, k2.saldo_depois, k2.valor_total], ['250.0000', '170.0000', '464.0000']);
    assert.deepEqual([kardex.items.find((i) => i.id === me3.id).saldo_antes], ['200.0000']);

    // a S2 agora é a última: a exclusão dela é o estorno exato de sempre (nada depois, nada recalculado)
    const r2 = ok(await excluirSaida(x, c.s2));
    assert.equal(r2.recalculo, null);
    const o2 = await mov(m2.id);
    assert.deepEqual([o2.status, o2.movimentacao_grupo_id], ['Estornada', null]);
    assert.equal(v4((await mov(o2.movimento_filho_id)).valor_total), '464.0000', 'o estorno devolve o valor (já recalculado) da S2');
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
const custoCocho = (d) => ({
  custo_unitario_kg: d.custo_unitario_kg, custo_total_periodo: d.custo_total_periodo, custo_cab_dia: d.custo_cab_dia,
  custo_sobra_herdada_kg: d.custo_sobra_herdada_kg, sobra_final_camadas: d.sobra_final_camadas,
});

describe('D-PROD-273 fatia 4 — cocho (o caso do dono)', () => {
  test('entrada, saída para o cocho, outras saídas depois: excluir o cocho passa, os posteriores vão de R$ 6 a R$ 5,8, o fechamento dos outros cochos é refeito (cadeia da sobra herdada)', async () => {
    const x = await montar();
    const A = x.local;
    const e1 = await entrar(x, x.sal, A, '100', '4');
    const e2 = await entrar(x, x.sal, A, '100', '6');
    const L1 = await camadaDaEntrada(e1);
    const L2 = await camadaDaEntrada(e2);
    // C1 (cocho 1): 50 kg a R$ 5 = R$ 250 — a que o dono quer excluir
    const c1 = await lancarCocho(x, A, { ponto: 'cocho-1', kg: 50, data: '2027-06-01' });
    await entrar(x, x.sal, A, '50', '9');
    // C2 (cocho 2): 80 kg a R$ 6 = R$ 480; C3 fecha o período de C2: sobra 10, 5 dias → consumo 70 × 6 = R$ 420
    const c2 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 80, data: '2027-06-02' });
    const fech2 = { sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 14, custo_unitario_kg: 6, custo_total_periodo: 420, custo_cab_dia: 8.4, sobra_herdada_kg: 0, custo_sobra_herdada_kg: null, custo_sobra_aproximado: null, sobra_final_camadas: [{ kg: 10, custo_kg: 6 }] };
    const c3 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 20, sobra: 10, data: '2027-06-07', anterior: c2.evento, fechamento: fech2 });
    // C4 fecha C3: herdou 10 kg a R$ 6, fornecido 20, sobra 5 → consumo 25 = 10 × 6 + 15 × 6 = R$ 150
    const fech3 = { sobra_kg: 5, dias_periodo: 5, consumo_diario_grupo_kg: 5, custo_unitario_kg: 6, custo_total_periodo: 150, custo_cab_dia: 3, sobra_herdada_kg: 10, custo_sobra_herdada_kg: 6, custo_sobra_aproximado: false, sobra_final_camadas: [{ kg: 5, custo_kg: 6 }] };
    const c4 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 10, sobra: 5, data: '2027-06-12', anterior: c3.evento, fechamento: fech3 });
    assert.deepEqual([c2.mov.valor_total, c3.mov.valor_total, c4.mov.valor_total].map(v4), ['480.0000', '120.0000', '60.0000']);
    await provarReplay(x, x.sal);

    // antes: a elegibilidade (ensaio) já passa e diz o que será recalculado; nada gravado
    const el = ok(await H.req('GET', `/suplementacao-eventos/${c1.evento.id}/elegibilidade-cancelamento?empresa_id=${x.e1.id}`, x.token));
    assert.equal(el.elegivel, true, JSON.stringify(el));
    assert.deepEqual(el.efeitos.recalculo, { produtos: 1, movimentos: 4, camadas: 3, dependentes: 3 });
    assert.equal(v4((await mov(c2.mov.id)).valor_total), '480.0000', 'o ensaio não grava');

    const r = ok(await cancelarCocho(x, c1.evento.id));
    assert.deepEqual(r.recalculo, { produtos: 1, movimentos: 4, camadas: 3, dependentes: 3 });
    // sem C1: 250 kg a R$ 5,8; C2 = 80 × 5,8 = 464 (só L1); C3 = 20 × 5,8 = 116 (L1); C4 = 10 × 5,8 = 58 (L2)
    assert.deepEqual(valores(await mov(c2.mov.id)), ['5.8000', '464.0000', '250.0000', '170.0000']);
    assert.deepEqual(valores(await mov(c3.mov.id)), ['5.8000', '116.0000', '170.0000', '150.0000']);
    assert.deepEqual(valores(await mov(c4.mov.id)), ['5.8000', '58.0000', '150.0000', '140.0000']);
    const m2 = await mov(c2.mov.id);
    assert.deepEqual([v4(m2.custo_medio_antes), v4(m2.custo_medio_depois)], ['5.8000', '5.8000'], 'o cocho grava o médio do poço');
    assert.deepEqual(fatias(m2), [[L1, '80.0000', '5.8000']]);
    assert.deepEqual(fatias(await mov(c3.mov.id)), [[L1, '20.0000', '5.8000']]);
    assert.deepEqual(fatias(await mov(c4.mov.id)), [[L2, '10.0000', '5.8000']]);
    assert.match(m2.observacoes, /\[RATEIO_FIFO\] S\/N: 80\.000 kg$/, 'o rateio das observações segue as fatias novas');
    // o fechamento dos cochos: C2 = 70 × 5,8 = R$ 406 (8,12 por cab/dia); C3 herdou 10 kg a 5,8: 25 × 5,8 = R$ 145 (2,9)
    assert.deepEqual(custoCocho((await evento(c2.evento.id)).dados), { custo_unitario_kg: 5.8, custo_total_periodo: 406, custo_cab_dia: 8.12, custo_sobra_herdada_kg: null, sobra_final_camadas: [{ kg: 10, custo_kg: 5.8 }] });
    assert.deepEqual(custoCocho((await evento(c3.evento.id)).dados), { custo_unitario_kg: 5.8, custo_total_periodo: 145, custo_cab_dia: 2.9, custo_sobra_herdada_kg: 5.8, sobra_final_camadas: [{ kg: 5, custo_kg: 5.8 }] });
    assert.equal((await evento(c4.evento.id)).dados.custo_unitario_kg, 5.8, 'o lançamento aberto ganha o custo/kg novo');
    assert.equal((await evento(c1.evento.id)).dados.situacao, 'cancelado');
    const [t] = await trilha(x, 'SuplementacaoEvento', c3.evento.id);
    assert.deepEqual([t.dados_anteriores.custo_total_periodo, t.dados_novos.custo_total_periodo], [150, 145]);
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
  test('linha de produto da atividade: cancelar a antiga recalcula a linha posterior (480 → 464) e as fatias dela (L1 50 + L2 30 → L1 80: a fatia da L2 sai, a camada fica)', async () => {
    const x = await montar();
    const at = await atividade(x);
    let l1;
    let l2;
    const c = await cenarioBase(x, async (A, kg) => { l1 = await at.lancar(x.sal, A, kg); return l1; }, async (A, kg) => { l2 = await at.lancar(x.sal, A, kg); return l2; });
    const antes = await prisma().atividadeApontamentoProduto.findUnique({ where: { id: l2.id }, include: { consumos: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual([v4(antes.custo_unitario), v4(antes.custo_total), antes.consumos.map((f) => [f.estoque_lote_nota_id, f.ordem, v4(f.quantidade)])], ['6.0000', '480.0000', [[c.L1, 1, '50.0000'], [c.L2, 2, '30.0000']]]);
    await provarReplay(x, x.sal);
    const cancelada = await at.cancelar(l1);
    assert.equal(cancelada.status, 'CANCELADO');
    const depois = await prisma().atividadeApontamentoProduto.findUnique({ where: { id: l2.id }, include: { consumos: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual([v4(depois.custo_unitario), v4(depois.custo_total)], ['5.8000', '464.0000']);
    assert.deepEqual(depois.consumos.map((f) => [f.estoque_lote_nota_id, f.ordem, v4(f.quantidade), v4(f.custo_unitario)]), [[c.L1, 1, '80.0000', '5.8000']]);
    assert.equal(depois.consumos[0].id, antes.consumos[0].id, 'a fatia da mesma camada é atualizada, não recriada');
    assert.deepEqual(valores(await mov(l2.movimentacao_estoque_id)), ['5.8000', '464.0000', '250.0000', '170.0000']);
    const [t] = await trilha(x, 'AtividadeApontamentoProduto', l2.id);
    assert.deepEqual([t.dados_anteriores.custo_total, t.dados_novos.custo_total, t.dados_anteriores.fatias.length, t.dados_novos.fatias.length], ['480.0000', '464.0000', 2, 1]);
    await provarReplay(x, x.sal);
  });

  test('abastecimento: cancelar o antigo recalcula o posterior (custo do abastecimento 480 → 464 e as fatias); diesel em L', async () => {
    const x = await montar();
    const d = x.diesel;
    const A = x.local;
    const e1 = await entrar(x, d, A, '100', '4', 'L');
    const e2 = await entrar(x, d, A, '100', '6', 'L');
    const ab1 = await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '50', medidor_leitura: '1550.5' }));
    await entrar(x, d, A, '50', '9', 'L');
    const ab2 = await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '80', medidor_leitura: '1551' }));
    const L1 = await camadaDaEntrada(e1);
    const L2 = await camadaDaEntrada(e2);
    assert.deepEqual([v4(ab2.custo_unitario), v4(ab2.custo_total)], ['6.0000', '480.0000']);
    await provarReplay(x, d);
    ok(await AB.cancelar(x.token, ab1.id, { empresa_id: x.e1.id, versao: ab1.versao, motivo: 'lançado em dobro', operation_id: opId() }));
    const b2 = await prisma().abastecimentoBem.findUnique({ where: { id: ab2.id } });
    assert.deepEqual([v4(b2.custo_unitario), v4(b2.custo_total)], ['5.8000', '464.0000']);
    const f2 = await prisma().abastecimentoBemConsumoLote.findMany({ where: { abastecimento_id: ab2.id }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(f2.map((f) => [f.estoque_lote_nota_id, f.ordem, v4(f.quantidade), v4(f.custo_unitario)]), [[L1, 1, '80.0000', '5.8000']]);
    assert.ok(await prisma().estoqueLoteNota.findUnique({ where: { id: L2 } }), 'a camada que deixou de ser consumida continua');
    assert.deepEqual(valores(await mov(b2.movimentacao_estoque_id)), ['5.8000', '464.0000', '250.0000', '170.0000']);
    await provarReplay(x, d);
  });

  test('venda do financeiro: cancelar a antiga recalcula a posterior (custo das fatias 6 → 5,8; preço de venda não muda)', async () => {
    const x = await montar();
    let v1;
    let v2;
    const c = await cenarioBase(x, async (A, kg) => { v1 = await vender(x, [[x.sal, A, kg, '12']]); return v1; }, async (A, kg) => { v2 = await vender(x, [[x.sal, A, kg, '12']]); return v2; });
    const item2 = v2.itens[0];
    assert.deepEqual(await consumosDoItem(item2.id), [[c.L1, '50.0000', '6.0000'], [c.L2, '30.0000', '6.0000']].sort());
    await provarReplay(x, x.sal);
    const r = ok(await cancelarVenda(x, v1.id));
    assert.equal(r.status, 'CANCELADO');
    assert.deepEqual(await consumosDoItem(item2.id), [[c.L1, '80.0000', '5.8000']]);
    assert.deepEqual(valores(await mov(item2.movimentacao_estoque_id)), ['5.8000', '464.0000', '250.0000', '170.0000']);
    const it = await prisma().operacaoFinanceiraItem.findUnique({ where: { id: item2.id } });
    assert.deepEqual([Number(it.valor_unitario), v4(it.valor_total)], [12, '960.0000'], 'o preço de venda é o mesmo');
    await provarReplay(x, x.sal);
  });
});

// ─── cascata e concorrência ─────────────────────────────────────────────────
describe('D-PROD-273 fatia 4 — cascata pela transferência e concorrência', () => {
  test('excluir a saída antiga na origem: a transferência posterior muda de fatias e de custo, as camadas do destino são recriadas (a antiga fica Estornado) e a venda no destino é recalculada', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    const e1 = await entrar(x, x.sal, A, '50', '2');
    const e2 = await entrar(x, x.sal, A, '100', '5');
    const L1 = await camadaDaEntrada(e1);
    const L2 = await camadaDaEntrada(e2);
    // S1 tira os 50 da L1 a R$ 4 (150 kg, R$ 600); entra 50 a R$ 10: 150 kg, R$ 900, médio R$ 6
    const s1 = await sair(x, x.sal, A, '50');
    await entrar(x, x.sal, A, '50', '10');
    // T: 80 kg A→B a R$ 6 = R$ 480 (só L2); venda de 30 no B a R$ 6 = R$ 180
    const t = await transferir(x, x.sal, A, B, '80');
    const venda = await vender(x, [[x.sal, B, '30', '20']]);
    const [D1] = (await camadasDe(x, x.sal, B)).map((l) => l.id);
    assert.deepEqual(fatias(await mov(t.s.id)).map((f) => f.slice(0, 2)), [[L2, '80.0000']]);
    assert.deepEqual(await consumosDoItem(venda.itens[0].id), [[D1, '30.0000', '6.0000']]);
    await provarReplay(x, x.sal);

    const r = ok(await excluirSaida(x, s1));
    assert.equal(r.recalculo.produtos, 1);
    // sem S1: 200 kg, R$ 1.100, médio R$ 5,5; T = 80 × 5,5 = R$ 440 (L1 50 + L2 30); B: 80 a 5,5; venda 30 × 5,5 = R$ 165
    const ts = await mov(t.s.id);
    assert.deepEqual(valores(ts), ['5.5000', '440.0000', '200.0000', '120.0000']);
    assert.deepEqual(valores(await mov(t.r.id)), ['5.5000', '440.0000', '0.0000', '80.0000']);
    const destinos = ts.lotes_consumidos.map((f) => f.lote_destino_id);
    assert.deepEqual(ts.lotes_consumidos.map((f) => [f.lote_id, f.quantidade, f.custo_unitario]), [[L1, '50.0000', '5.5000'], [L2, '30.0000', '5.5000']]);
    assert.equal(destinos.includes(D1), false, 'a origem mudou: camadas de destino novas');
    const camadasB = await camadasDe(x, x.sal, B);
    const porId = new Map(camadasB.map((l) => [l.id, l]));
    assert.deepEqual(porId.get(D1), { id: D1, disp: '0.0000', custo: porId.get(D1).custo, status: 'Estornado', entrada: '80.0000' }, 'a camada antiga fica, Estornado, sem disponível');
    assert.deepEqual([porId.get(destinos[0]).disp, porId.get(destinos[0]).custo, porId.get(destinos[0]).entrada], ['20.0000', '5.5000', '50.0000']);
    assert.deepEqual([porId.get(destinos[1]).disp, porId.get(destinos[1]).custo, porId.get(destinos[1]).entrada], ['30.0000', '5.5000', '30.0000']);
    const mv = await mov(venda.itens[0].movimentacao_estoque_id);
    assert.deepEqual(valores(mv), ['5.5000', '165.0000', '80.0000', '50.0000']);
    assert.deepEqual(await consumosDoItem(venda.itens[0].id), [[destinos[0], '30.0000', '5.5000']], 'a fatia da venda passa à camada nova (a do D1 sai)');
    // L1 esgota na transferência sem nunca ter sido reavaliada (a reavaliação só toca o disponível): fica com o custo dela
    assert.deepEqual((await camadasDe(x, x.sal, A)).map((l) => [l.id === L1 ? 'L1' : l.id === L2 ? 'L2' : 'L3', l.disp, l.custo, l.status]), [['L1', '0.0000', '2.0000', 'Esgotado'], ['L2', '70.0000', '5.5000', 'Disponivel'], ['L3', '50.0000', '5.5000', 'Disponivel']]);
    const [nova] = await trilha(x, 'EstoqueLoteNota', destinos[0]);
    assert.equal(nova.dados_novos.nova, true);
    await provarReplay(x, x.sal);
  });

  test('duas exclusões simultâneas no mesmo produto (a trava do produto as enfileira): as duas passam, uma depois da outra, e o replay bate com o gravado', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    await entrar(x, x.sal, A, '100', '6');
    const s1 = await sair(x, x.sal, A, '50');
    await entrar(x, x.sal, A, '50', '9');
    const s2 = await sair(x, x.sal, A, '30');
    const s3 = await sair(x, x.sal, A, '80');
    const m3 = await movDoItem(s3);
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
    assert.deepEqual([r1.statusCode, r2.statusCode], [200, 200], `${r1.body} ${r2.body}`);
    // sem S1 e S2: 250 kg, R$ 1.450, médio 5,8; S3 = 80 × 5,8 = R$ 464, saldo 250 → 170
    assert.deepEqual(valores(await mov(m3.id)), ['5.8000', '464.0000', '250.0000', '170.0000']);
    const pares = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c, movimentacao_grupo_id: { startsWith: 'exclusao_recalculo:' } } });
    assert.equal(pares, 4, 'os dois pares marcados');
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

  test('histórico que não reproduz o gravado: a saída manual recusa 409 (nada gravado); a venda mantém o estorno exato de antes, sem marca nem recálculo; teto de posteriores → 422', async () => {
    const x = await montar();
    const c = await cenarioBase(x, (A, kg) => sair(x, x.sal, A, kg), (A, kg) => sair(x, x.sal, A, kg));
    // adultera o custo de uma camada fora do motor: o replay sem exclusão deixa de reproduzir o gravado
    await prisma().estoqueLoteNota.update({ where: { id: c.L3 }, data: { custo_unitario: '9.9999' } });
    const antes = await retrato(x);
    const r = await excluirSaida(x, c.s1);
    assert.deepEqual([r.statusCode, r.json().code, r.json().reason ?? r.json().details?.reason], [409, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'replay_diverge_do_gravado'], r.body);
    assert.equal(await retrato(x), antes, 'nada gravado');

    const v = await vender(x, [[x.sal, c.A, '10', '12']]);
    await entrar(x, x.sal, c.A, '5', '7');
    const mv = await mov(v.itens[0].movimentacao_estoque_id);
    ok(await cancelarVenda(x, v.id));
    const o = await mov(mv.id);
    assert.deepEqual([o.status, o.movimentacao_grupo_id], ['Estornada', null], 'estorno exato, sem marca');
    // só a trilha da dispensa (o motivo), nenhum valor reescrito
    const trilhas = await prisma().auditLog.findMany({ where: { cliente_id: x.c, acao: 'estoque.recalculo' } });
    assert.deepEqual(trilhas.map((t) => [t.entidade, t.dados_novos.recalculo_dispensado, t.dados_novos.recusa.reason]), [['Produto', true, 'replay_diverge_do_gravado']]);

    // teto de posteriores (o serviço usa 5.000; aqui 1): 422 antes de processar qualquer coisa
    await prisma().estoqueLoteNota.update({ where: { id: c.L3 }, data: { custo_unitario: '6.0000' } });
    const { provarExclusaoComRecalculo } = await import('../src/modules/estoqueRecalculo/estoqueExclusaoRecalculo.js');
    const m1 = await movDoItem(c.s1);
    await assert.rejects(
      prisma().$transaction((tx) => provarExclusaoComRecalculo(tx, x.c, { empresaId: x.e1.id, produtoId: x.sal.id, excluirIds: [m1.id], tetoAfetados: 1 })),
      (e) => e.code === 'ESTOQUE_RECALCULO_VOLUME_EXCEDIDO' && e.details.teto === 1,
    );
    const me3 = await movDoItem(c.e3);
    await assert.rejects(
      prisma().$transaction((tx) => provarExclusaoComRecalculo(tx, x.c, { empresaId: x.e1.id, produtoId: x.sal.id, excluirIds: [me3.id] })),
      (e) => e.code === 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL' && e.details.reason === 'origem_nao_suportada',
      'entrada é a fatia 5',
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
  await entrar(x, x.sal, A, '50', '9');
  const c2 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 80, data: '2027-06-02' });
  const fech2 = { sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 14, custo_unitario_kg: 6, custo_total_periodo: 420, custo_cab_dia: 8.4, sobra_herdada_kg: 0, custo_sobra_herdada_kg: null, custo_sobra_aproximado: null, sobra_final_camadas: [{ kg: 10, custo_kg: 6 }] };
  const c3 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 20, sobra: 10, data: '2027-06-07', anterior: c2.evento, fechamento: fech2 });
  const fech3 = { sobra_kg: 5, dias_periodo: 5, consumo_diario_grupo_kg: 5, custo_unitario_kg: 6, custo_total_periodo: 150, custo_cab_dia: 3, sobra_herdada_kg: 10, custo_sobra_herdada_kg: 6, custo_sobra_aproximado: false, sobra_final_camadas: [{ kg: 5, custo_kg: 6 }] };
  const c4 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 10, sobra: 5, data: '2027-06-12', anterior: c3.evento, fechamento: fech3 });
  return { x, A, c1, c2, c3, c4 };
};

describe('D-PROD-273 fatia 4 — achados da revisão: depois de um recálculo, as operações seguintes passam', () => {
  test('(1) cancelar C1 com recálculo e depois C2, agora o último do cocho 2: o estorno marcado do C1 não é "movimento posterior"', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    await entrar(x, x.sal, A, '100', '6');
    const c1 = await lancarCocho(x, A, { ponto: 'cocho-1', kg: 50, data: '2027-06-01' });
    await entrar(x, x.sal, A, '50', '9');
    const c2 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 80, data: '2027-06-02' });
    assert.equal(ok(await cancelarCocho(x, c1.evento.id)).recalculo.produtos, 1);
    const r = ok(await cancelarCocho(x, c2.evento.id));
    assert.equal(r.recalculo, null, 'C2 é o último de verdade: estorno exato');
    assert.equal(v4(r.estorno.valor_total), '464.0000', 'devolve o valor já recalculado (80 × 5,8)');
    await provarReplay(x, x.sal);
  });

  test('(2) cancelar C1 com recálculo e depois C4: o período de C3 reabre (o fechamento reescrito pelo recálculo é o estado legítimo) com o custo/kg novo', async () => {
    const { x, c1, c3, c4 } = await montarCocho();
    ok(await cancelarCocho(x, c1.evento.id));
    assert.equal((await evento(c3.evento.id)).dados.custo_total_periodo, 145);
    const r = ok(await cancelarCocho(x, c4.evento.id));
    assert.equal(r.periodo_reaberto.evento_id, c3.evento.id);
    const d3 = (await evento(c3.evento.id)).dados;
    assert.deepEqual([d3.dias_periodo ?? null, d3.custo_total_periodo ?? null, d3.sobra_kg, d3.custo_unitario_kg], [null, null, 10, 5.8],
      'volta ao retrato de antes do fechamento, mas com o custo/kg da saída já recalculado');
    await provarReplay(x, x.sal);
  });

  test('(1) excluir S1 com recálculo e depois cancelar a transferência recalculada (a última nos dois depósitos)', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    await entrar(x, x.sal, A, '50', '2');
    await entrar(x, x.sal, A, '100', '5');
    const s1 = await sair(x, x.sal, A, '50');
    await entrar(x, x.sal, A, '50', '10');
    const t = await transferir(x, x.sal, A, B, '80');
    ok(await excluirSaida(x, s1));
    await provarReplay(x, x.sal);
    ok(await cancelarTransferencia(x, t.s.id));
    // a transferência volta inteira (80 a 5,5 = 440): A fica com 200 kg, R$ 1.100
    const camadasA = (await camadasDe(x, x.sal, A)).filter((l) => l.status === 'Disponivel');
    assert.equal(camadasA.reduce((t2, l) => t2 + Number(l.disp), 0), 200);
    await provarReplay(x, x.sal);
  });

  test('(1) excluir S1 com recálculo e depois EDITAR a S2 (D-PROD-271; a última de verdade): passa e o replay bate', async () => {
    const x = await montar();
    const c = await cenarioBase(x, (A, kg) => sair(x, x.sal, A, kg), (A, kg) => sair(x, x.sal, A, kg));
    ok(await excluirSaida(x, c.s1));
    const s2 = await prisma().saidaEstoque.findUnique({ where: { id: c.s2.id } });
    const r = ok(await H.req('PATCH', `/estoque/saidas/${c.s2.id}`, x.token, {
      empresa_id: x.e1.id, operation_id: `ed-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
      itens: [{ produto_id: x.sal.id, local_estoque_id: c.A.id, unidade: 'KG', quantidade: '70' }], versao: s2.versao, motivo_edicao: 'pesagem refeita',
    }));
    assert.equal(v4(r.itens[0].valor_total), '406.0000', '70 × 5,8');
    await provarReplay(x, x.sal);
  });
});

describe('D-PROD-273 fatia 4 — achados da revisão: fallback do estorno exato (abastecimento, atividade, venda)', () => {
  test('(3) venda com cocho posterior cujo fechamento não reproduz: o recálculo é desfeito (SAVEPOINT) e a venda é cancelada pelo estorno exato, com o motivo na trilha', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    await entrar(x, x.sal, A, '100', '6');
    const v = await vender(x, [[x.sal, A, '50', '12']]);
    await entrar(x, x.sal, A, '50', '9');
    const c2 = await lancarCocho(x, A, { ponto: 'cocho-2', kg: 80, data: '2027-06-02' });
    // fechamento gravado fora da conta da tela (custo 999): o servidor não sabe refazer → recusa do recálculo
    const fech = { sobra_kg: 10, dias_periodo: 5, consumo_diario_grupo_kg: 14, custo_unitario_kg: 6, custo_total_periodo: 999, custo_cab_dia: 8.4, sobra_herdada_kg: 0, custo_sobra_herdada_kg: null, custo_sobra_aproximado: null, sobra_final_camadas: [{ kg: 10, custo_kg: 6 }] };
    await lancarCocho(x, A, { ponto: 'cocho-2', kg: 20, sobra: 10, data: '2027-06-07', anterior: c2.evento, fechamento: fech });
    const m2Antes = valores(await mov(c2.mov.id));
    ok(await cancelarVenda(x, v.id));
    const mv = await mov(v.itens[0].movimentacao_estoque_id);
    assert.deepEqual([mv.status, mv.movimentacao_grupo_id], ['Estornada', null], 'estorno exato, sem marca');
    assert.deepEqual(valores(await mov(c2.mov.id)), m2Antes, 'nada recalculado');
    assert.equal((await evento(c2.evento.id)).dados.custo_total_periodo, 999);
    const [t] = await trilha(x, 'Produto', x.sal.id);
    assert.deepEqual([t.dados_novos.recalculo_dispensado, t.dados_novos.recusa.code, t.dados_novos.recusa.reason], [true, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'cocho_fechamento_nao_reproduzivel']);
    await provarReplay(x, x.sal);
  });

  test('(6) movimento legado com movimentacao_grupo_id preenchido: a saída manual recusa grupo_legado_preenchido; a venda cai no estorno exato', async () => {
    const x = await montar();
    const c = await cenarioBase(x, (A, kg) => sair(x, x.sal, A, kg), (A, kg) => sair(x, x.sal, A, kg));
    const m1 = await movDoItem(c.s1);
    await prisma().movimentacaoEstoque.update({ where: { id: m1.id }, data: { movimentacao_grupo_id: 'grupo-legado-1' } });
    const r = await excluirSaida(x, c.s1);
    assert.deepEqual([r.statusCode, r.json().code, r.json().reason ?? r.json().details?.reason], [409, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'grupo_legado_preenchido'], r.body);

    const v = await vender(x, [[x.sal, c.A, '10', '12']]);
    await sair(x, x.sal, c.A, '5');
    const mv0 = await movDoItem(v);
    await prisma().movimentacaoEstoque.update({ where: { id: mv0.id }, data: { movimentacao_grupo_id: 'grupo-legado-2' } });
    ok(await cancelarVenda(x, v.id));
    const mv = await mov(mv0.id);
    assert.deepEqual([mv.status, mv.movimentacao_grupo_id], ['Estornada', 'grupo-legado-2']);
    const dispensas = (await trilha(x, 'Produto', x.sal.id)).filter((t) => t.dados_novos.recalculo_dispensado);
    assert.equal(dispensas.at(-1).dados_novos.recusa.reason, 'grupo_legado_preenchido');
  });
});

describe('D-PROD-273 fatia 4 — achados da revisão: a prévia diz o que a exclusão vai fazer', () => {
  test('(4) nada depois → "estorno exato" mesmo com histórico que não reproduz; venda com recálculo inviável → estorno exato sem recalcular (sem recusa); venda de 2 itens do mesmo produto e depósito → simula os dois juntos', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '4');
    const ultima = await sair(x, x.sal, A, '10');
    const camada = await prisma().estoqueLoteNota.findFirst({ where: { cliente_id: x.c, produto_id: x.sal.id } });
    await prisma().estoqueLoteNota.update({ where: { id: camada.id }, data: { custo_unitario: '9.9999' } });
    const p1 = ok(await previa(x, (await movDoItem(ultima)).id));
    assert.deepEqual([p1.permitido, p1.modo, p1.movimentos_posteriores, p1.movimentos.length], [true, 'estorno_exato', 0, 0]);

    const v = await vender(x, [[x.sal, A, '5', '12']]);
    await sair(x, x.sal, A, '3');
    const p2 = ok(await previa(x, (await movDoItem(v)).id));
    assert.deepEqual([p2.permitido, p2.modo, p2.recusa, p2.aviso.reason], [true, 'estorno_exato_sem_recalculo', null, 'replay_diverge_do_gravado']);
    await prisma().estoqueLoteNota.update({ where: { id: camada.id }, data: { custo_unitario: camada.custo_unitario } });

    const y = await montar();
    await entrar(y, y.sal, y.local, '100', '4');
    await entrar(y, y.sal, y.local, '100', '6');
    const v2 = await vender(y, [[y.sal, y.local, '20', '12'], [y.sal, y.local, '30', '12']]);
    await entrar(y, y.sal, y.local, '50', '9');
    const s2 = await sair(y, y.sal, y.local, '80');
    const p3 = ok(await previa(y, v2.itens[0].movimentacao_estoque_id));
    assert.deepEqual([...p3.excluidos].sort(), [v2.itens[0].movimentacao_estoque_id, v2.itens[1].movimentacao_estoque_id].sort(), 'os dois itens do documento');
    // sem os 50 kg da venda: 250 kg, R$ 1.450, médio 5,8; S2 = 464 (o mesmo do cancelamento de verdade)
    assert.equal(p3.movimentos.find((m) => m.id === s2.itens[0].movimentacao_estoque_id).depois.valor_total, '464.0000');
    ok(await cancelarVenda(y, v2.id));
    assert.equal(v4((await movDoItem(s2)).valor_total), '464.0000');
  });
});

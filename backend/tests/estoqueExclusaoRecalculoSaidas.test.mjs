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

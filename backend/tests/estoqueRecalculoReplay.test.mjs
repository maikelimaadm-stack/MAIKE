/**
 * D-PROD-273 (fatia 3) — REPLAY puro do custo médio, PRÉVIA da exclusão e a prova "replay = gravado", contra
 * PostgreSQL real. Os cenários são montados pelos serviços de verdade (HTTP autenticado e, para o cocho, a
 * primitiva do motor numa transação como o serviço chama): entrada documentada, compra e venda do financeiro,
 * saída manual, transferência, cocho, linha de produto da atividade, abastecimento, edição D-PROD-271 e os
 * estornos de cada um. Sem exclusão, o replay tem de reproduzir EXATAMENTE os valores gravados, movimento a
 * movimento, e as camadas no fim. A prévia nunca grava nada.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';
import { acoesAbastecimento, corpoAbastecimento, montarAbastecimento, opId } from './patrimonioP1AbastecimentoCenario.mjs';
import { estornarEmLote, exigirLocaisEstoque, estornarSaidaSuplementacao, numerarMovimentos, numeroMovimentoProvisorio, travarProdutosEstoque } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';
import { auditarReplayDoProduto, previaExclusao } from '../src/modules/estoqueRecalculo/estoqueRecalculoService.js';
import { emLeituraSomente, lerHistoricoDoProduto } from '../src/modules/estoqueRecalculo/estoqueRecalculoLeitor.js';
import { reproduzir } from '../src/modules/estoqueRecalculo/estoqueReplay.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let AB;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
  AB = acoesAbastecimento(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const hoje = () => new Date().toISOString().slice(0, 10);
const qs = (o) => `?${new URLSearchParams(o).toString()}`;
let seq = 0;

/** Cenário: o do abastecimento (tenant, 2 fazendas, trator com tanque de diesel, 2 locais, compra P3) + sal, atividade e financeiro de venda. */
const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const sal = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `SAL-${suf}`, nome_produto: 'Sal mineral', unidade_principal_estoque: 'KG' } });
  const ureia = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `UR-${suf}`, nome_produto: 'Ureia', unidade_principal_estoque: 'KG' } });
  const motivosEntrada = (await H.ok(H.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const motivosSaida = (await H.ok(H.req('GET', '/estoque/motivos-saida', s.token))).items;
  const compra = motivosEntrada.find((m) => m.nome === 'Compra').id;
  const perda = motivosSaida.find((m) => m.nome === 'Perda').id;
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: `ADUBAÇÃO ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true } });
  ok(await H.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  const ctx = { auth: { clienteId: s.c, usuarioId: s.adm.usuario.id, login: s.adm.credenciais.login } };
  return { ...s, sal, ureia, compra, perda, tipo, ctx };
};

const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};

/** Entrada documentada (Compra). */
const entrar = async (x, produto, local, kg, custo, unidade = 'KG') =>
  ok(await H.req('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e1.id, operation_id: `en-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade, quantidade: kg, custo_unitario: custo }],
  }), 201);
const corpoSaida = (x, produto, local, kg) => ({
  empresa_id: x.e1.id, operation_id: `sa-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
  itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg }],
});
const sair = async (x, produto, local, kg) => ok(await H.req('POST', '/estoque/saidas', x.token, corpoSaida(x, produto, local, kg)), 201);
const transferir = async (x, produto, origem, destino, kg) => {
  const r = ok(await H.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e1.id, produto_id: produto.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade: kg,
  }), 201);
  return { s: r.movimentacao_saida, r: r.movimentacao_entrada };
};
const cocho = async (x, produto, local, kg) =>
  ok(await H.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
    operation_id: `sup-${randomUUID()}`, empresa_id: x.e1.id, produto_id: produto.id, local_origem_id: local.id, quantidade: kg, ponto_suplementacao_id: 'ponto-1',
  }), 201).movimentacao;
/** Cancelamento do cocho pela primitiva do motor, numa transação como o serviço (locais → estorno → numeração no fim). */
const cancelarCocho = (x, m, produto) =>
  prisma().$transaction(async (tx) => {
    await exigirLocaisEstoque(tx, x.c, [{ id: m.local_estoque_origem, field: 'local_origem_id', exigirAtivo: false }]);
    const p = await tx.produto.findFirst({ where: { cliente_id: x.c, empresa_id: x.e1.id, id: produto.id } });
    const r = await estornarSaidaSuplementacao(tx, x.ctx, {
      empresaId: x.e1.id, movimentoId: m.id, produto: p, local: { id: m.local_estoque_origem, nome: 'Local' }, dia: '2027-06-15',
      origem: { operacaoId: `evento-${randomUUID()}`, motivoEstorno: 'Cancelamento do lançamento do cocho: lançado em dobro' }, numeroMovimento: numeroMovimentoProvisorio(),
    });
    await numerarMovimentos(tx, x.c, [r.movimento.id]);
    return r;
  });
const cancelarTransferencia = async (x, id) =>
  ok(await H.req('POST', `/movimentacoes-estoque/${id}/cancelar-transferencia`, x.token, { empresa_id: x.e1.id, motivo: 'lançada errada', operation_id: `ct-${randomUUID()}` }));

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
const cancelarOperacao = async (x, id) =>
  ok(await H.req('POST', `/operacoes-financeiras/${id}/cancelar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), motivo: 'teste do replay' }));

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

/** Prova "replay = gravado" de um produto: reproduzível, nenhuma divergência, todo movimento reproduzido. */
const provarReplay = async (x, produto) => {
  const r = await emLeituraSomente((tx) => auditarReplayDoProduto(tx, x.c, x.e1.id, produto.id));
  assert.equal(r.reproduzivel, true, JSON.stringify({ problemas: r.problemas, parada: r.parada }));
  assert.deepEqual(r.divergencias, [], JSON.stringify(r.divergencias.slice(0, 5)));
  return r;
};
const replayDe = async (x, produto) =>
  emLeituraSomente(async (tx) => {
    const historico = await lerHistoricoDoProduto(tx, x.c, x.e1.id, produto.id);
    return { historico, replay: reproduzir(historico) };
  });
const previa = (x, id, token = x.token, extra = {}) => H.req('GET', `/estoque/movimentos/${id}/exclusao/previa${qs({ empresa_id: x.e1.id, ...extra })}`, token);
/** Tudo o que a prévia não pode mudar. */
const retrato = async (x) => JSON.stringify({
  m: await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } }),
  l: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } }),
  p: await prisma().produto.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true, updatedAt: true } }),
  a: await prisma().auditLog.count({ where: { cliente_id: x.c } }),
});
const movDoItem = async (doc) => (await prisma().movimentacaoEstoque.findUnique({ where: { id: doc.itens[0].movimentacao_estoque_id } }));

describe('D-PROD-273 fatia 3 — replay = gravado (cenário pelos serviços reais)', () => {
  test('sal (entradas, compra e venda do financeiro, saída manual, transferências, cocho, atividade, edições, estornos de todos) e diesel (compra, abastecimento e cancelamento): replay sem exclusão reproduz cada valor gravado e cada camada', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    const sal = x.sal;
    // entradas a custos diferentes nos dois depósitos (o poço fica heterogêneo e a reavaliação importa)
    await entrar(x, sal, A, '100', '3');
    await x.compraP3(x.e1, sal, A, { quantidade: '50', preco: '4.10' });
    await sair(x, sal, A, '30');
    await transferir(x, sal, A, B, '40');
    await entrar(x, sal, B, '20', '5.55');
    // cocho no B, cancelado na hora (estorno exato), e outro com casas quebradas
    const c1 = await cocho(x, sal, B, '7.5');
    await cancelarCocho(x, c1, sal);
    await cocho(x, sal, B, '3.3333');
    // linha de produto da atividade no A; outra cancelada em seguida (estorno em lote da atividade)
    const at = await atividade(x);
    await at.lancar(sal, A, '12.3456');
    const l2 = await at.lancar(sal, A, '2.5');
    await at.cancelar(l2);
    // venda com DUAS linhas no mesmo depósito, cancelada (estorno em lote do financeiro: reavalia uma vez no fim)
    const venda = await vender(x, [[sal, A, '5', '9'], [sal, A, '7', '9.5']]);
    await cancelarOperacao(x, venda.id);
    await entrar(x, sal, A, '33', '2.7777');
    // edição D-PROD-271 da saída (estorno + saída nova) e da entrada (estorno de revisão + entrada nova)
    const s1 = await sair(x, sal, A, '10');
    ok(await H.req('PATCH', `/estoque/saidas/${s1.id}`, x.token, { ...corpoSaida(x, sal, A, '12'), versao: s1.versao, motivo_edicao: 'pesagem refeita', operation_id: `ed-${randomUUID()}` }));
    const e1 = await entrar(x, sal, B, '15', '3.3');
    ok(await H.req('PATCH', `/estoque/entradas/${e1.id}`, x.token, {
      empresa_id: x.e1.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
      itens: [{ produto_id: sal.id, local_estoque_id: B.id, unidade: 'KG', quantidade: '18', custo_unitario: '3.1' }],
      versao: e1.versao, motivo_edicao: 'conferência da nota',
    }));
    // transferência B→A cancelada na hora; outra A→B que fica
    const t1 = await transferir(x, sal, B, A, '20');
    await cancelarTransferencia(x, t1.s.id);
    await transferir(x, sal, A, B, '25');
    // saída manual no B excluída; entrada no A excluída (intacta)
    const s2 = await sair(x, sal, B, '4');
    ok(await H.req('POST', `/estoque/saidas/${s2.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: 1, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` }));
    const e2 = await entrar(x, sal, A, '9', '8');
    ok(await H.req('POST', `/estoque/entradas/${e2.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: 1, motivo: 'nota errada', operation_id: `ex-${randomUUID()}` }));
    await sair(x, sal, B, '1');
    await vender(x, [[sal, B, '3', '10']]);

    const r = await provarReplay(x, sal);
    const { replay } = await replayDe(x, sal);
    const classes = [...replay.resultados.values()].map((v) => v.classe);
    for (const classe of ['entrada', 'saida', 'transferencia_enviada', 'transferencia_recebida', 'estorno_saida', 'estorno_entrada', 'estorno_transferencia_recebida', 'estorno_transferencia_enviada']) {
      assert.ok(classes.includes(classe), `o cenário cobre ${classe}`);
    }
    assert.equal(r.legados, 0);
    assert.equal(replay.resultados.size, r.movimentos, 'todo movimento reproduzido');
    const origens = new Set((await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: x.c, produto_id: sal.id }, select: { origem_sistema: true } })).map((m) => m.origem_sistema));
    assert.deepEqual([...origens].sort(), ['apontamento_atividade', 'deposito', 'entrada_estoque', 'operacao_financeira', 'saida_estoque', 'suplementacao']);
    // o poço do B é heterogêneo antes da última saída (custos diferentes): a reavaliação foi exercida
    assert.ok(r.movimentos >= 35, `movimentos do sal: ${r.movimentos}`);

    // diesel: compra P3, abastecimento, cancelamento (estorno exato), entrada em L, abastecimentos
    const d = x.diesel;
    await x.compraP3(x.e1, d, A, { quantidade: '100', preco: '5.20' });
    await x.compraP3(x.e1, d, A, { quantidade: '60', preco: '5.90' });
    const ab1 = await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '30', medidor_leitura: '1550.5' }));
    ok(await AB.cancelar(x.token, ab1.id, { empresa_id: x.e1.id, versao: ab1.versao, motivo: 'lançado em dobro', operation_id: opId() }));
    await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '45.5', medidor_leitura: '1551' }));
    await entrar(x, d, A, '10', '6.6', 'L');
    await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '20', medidor_leitura: '1552' }));
    const rd = await provarReplay(x, d);
    assert.equal(rd.movimentos, 7, '2 compras, 3 abastecimentos, 1 cancelamento, 1 entrada');
  });
});

describe('D-PROD-273 fatia 3 — estorno em lote do financeiro', () => {
  test('estornar em lote uma venda de duas linhas no mesmo depósito reavalia o poço UMA vez no fim (5,3640; item a item daria 5,3641) e o replay reproduz', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '52', '6.31');
    await entrar(x, x.sal, A, '31', '2.78');
    const venda = await vender(x, [[x.sal, A, '3', '9'], [x.sal, A, '7', '9']]);
    await entrar(x, x.sal, A, '29', '6.43');
    // D-PROD-273 (fatia 4): pelo serviço, este cancelamento (com a entrada depois) passaria a RECALCULAR; aqui o estorno
    // em lote é o da regra antiga (pares antigos de produção), pela primitiva do motor, como o serviço chamava.
    await prisma().$transaction(async (tx) => {
      await travarProdutosEstoque(tx, x.c, x.e1.id, [x.sal.id]);
      const itens = await tx.operacaoFinanceiraItem.findMany({ where: { cliente_id: x.c, operacao_id: venda.id, tipo_item: 'MERCADORIA' }, orderBy: { ordem: 'asc' }, include: { consumos: true } });
      const estornos = await estornarEmLote(tx, x.ctx, {
        empresaId: x.e1.id, direcao: 'RECEBER', itens, dia: '2027-06-15', documento: { numero: venda.numero, data: '2027-06-10' },
        parceiro: { id: venda.parceiro_id, nome: null }, origem: { operacaoId: venda.id }, numeroMovimento: numeroMovimentoProvisorio,
      });
      await numerarMovimentos(tx, x.c, estornos);
    });
    const camadas = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, produto_id: x.sal.id, status: 'Disponivel' } });
    assert.deepEqual([...new Set(camadas.map((l) => l.custo_unitario.toFixed(4)))], ['5.3640']);
    await provarReplay(x, x.sal);
  });
});

describe('D-PROD-273 fatia 3 — simulação da exclusão (prévia)', () => {
  test('excluir uma saída antiga: o saldo dos posteriores sobe e o custo deles muda (conta à mão); nada é gravado', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '3');
    const s1 = await sair(x, x.sal, A, '40');
    await entrar(x, x.sal, A, '50', '6');
    const s2 = await sair(x, x.sal, A, '30');
    await provarReplay(x, x.sal);
    const m1 = await movDoItem(s1);
    const m2 = await movDoItem(s2);
    // gravado: S2 = 30 × round(480/110) = 30 × 4,3636 = 130,9080; poço final 80 a round(349,092/80) = 4,3637
    assert.deepEqual([m2.valor_unitario.toFixed(4), m2.valor_total.toFixed(4), m2.saldo_antes.toFixed(4)], ['4.3636', '130.9080', '110.0000']);
    const antes = await retrato(x);
    const p = ok(await previa(x, m1.id));
    assert.equal(await retrato(x), antes, 'a prévia não grava nada');
    assert.equal(p.permitido, true);
    assert.equal(p.recusa, null);
    assert.equal(p.gravado, false);
    assert.deepEqual(p.excluidos, [m1.id]);
    assert.deepEqual(p.depositos_afetados, [A.id]);
    const porId = new Map(p.movimentos.map((m) => [m.id, m]));
    // sem S1: poço 150 a 4,0000; S2 = 30 × 4 = 120
    assert.deepEqual(porId.get(m2.id).antes, { valor_unitario: '4.3636', valor_total: '130.9080', saldo_antes: '110.0000', saldo_depois: '80.0000', custo_medio_antes: '4.3636', custo_medio_depois: '4.3637' });
    assert.deepEqual(porId.get(m2.id).depois, { valor_unitario: '4.0000', valor_total: '120.0000', saldo_antes: '150.0000', saldo_depois: '120.0000', custo_medio_antes: '4.0000', custo_medio_depois: '4.0000' });
    assert.equal(porId.get(m2.id).fatias_mudaram, true);
    assert.equal(p.movimentos.length, 2, 'a entrada de 50 (saldo) e a saída de 30 (saldo e custo)');
    assert.deepEqual(p.depositos, [{ local_estoque_id: A.id, saldo_antes: '80.0000', saldo_depois: '120.0000', valor_antes: '349.0960', valor_depois: '480.0000', custo_medio_antes: '4.3637', custo_medio_depois: '4.0000' }]);
    // dependente: a linha da saída manual S2 (o custo dela muda); a própria S1 não é dependente (é a excluída)
    assert.deepEqual(p.dependentes.map((d) => [d.tipo, d.movimento_id]), [['SaidaEstoqueItem', m2.id]]);
  });

  test('excluir uma entrada que deixaria o saldo negativo → recusa ESTOQUE_EXCLUSAO_SALDO_NEGATIVO com depósito, movimento e saldo', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '3');
    const e2 = await entrar(x, x.sal, A, '50', '5');
    const s = await sair(x, x.sal, A, '120');
    const ms = await movDoItem(s);
    const antes = await retrato(x);
    const p = ok(await previa(x, e2.itens[0].movimentacao_estoque_id));
    assert.equal(await retrato(x), antes);
    assert.equal(p.permitido, false);
    assert.deepEqual(p.recusa, { code: 'ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', reason: 'saldo_negativo', local_estoque_id: A.id, movimento_id: ms.id, movimento_numero: ms.numero_movimentacao, saldo: '-20.0000' });
    assert.deepEqual([p.movimentos, p.dependentes], [[], []]);
  });

  test('transferência em cascata: excluir uma saída antiga na origem muda o custo da transferência, do destino e da saída no destino', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    await entrar(x, x.sal, A, '100', '2');
    const sOld = await sair(x, x.sal, A, '50');
    await entrar(x, x.sal, A, '50', '8');
    await entrar(x, x.sal, B, '60', '10');
    const t = await transferir(x, x.sal, A, B, '40');
    const sb = await vender(x, [[x.sal, B, '30', '20']]);
    await provarReplay(x, x.sal);
    const mOld = await movDoItem(sOld);
    const mVenda = await prisma().movimentacaoEstoque.findUnique({ where: { id: sb.itens[0].movimentacao_estoque_id } });
    // gravado: T = 40 × 5 = 200; B = (600 + 200) / 100 = 8; venda 30 × 8 = 240
    assert.deepEqual([Number(t.s.valor_total), mVenda.valor_total.toFixed(4)], [200, '240.0000']);
    const p = ok(await previa(x, mOld.id));
    assert.equal(p.permitido, true);
    assert.deepEqual(p.depositos_afetados, [A.id, B.id].sort());
    const porId = new Map(p.movimentos.map((m) => [m.id, m]));
    // sem a saída: A = 150 a 4; T = 160; B = 760 / 100 = 7,6; venda 30 × 7,6 = 228
    assert.deepEqual([porId.get(t.s.id).depois.valor_total, porId.get(t.s.id).depois.custo_medio_antes], ['160.0000', '4.0000']);
    assert.equal(porId.get(t.r.id).depois.valor_total, '160.0000');
    assert.deepEqual([porId.get(mVenda.id).antes.valor_total, porId.get(mVenda.id).depois.valor_total, porId.get(mVenda.id).depois.valor_unitario], ['240.0000', '228.0000', '7.6000']);
    const dep = new Map(p.depositos.map((d) => [d.local_estoque_id, d]));
    assert.deepEqual([dep.get(B.id).custo_medio_antes, dep.get(B.id).custo_medio_depois, dep.get(B.id).saldo_depois], ['8.0000', '7.6000', '70.0000']);
    assert.deepEqual([dep.get(A.id).saldo_antes, dep.get(A.id).saldo_depois, dep.get(A.id).custo_medio_depois], ['60.0000', '110.0000', '4.0000']);
    // dependentes: a linha e as fatias da venda (o preço não muda; o custo sim) — só identificados
    assert.deepEqual([...new Set(p.dependentes.map((d) => d.tipo))].sort(), ['OperacaoFinanceiraConsumoLote', 'OperacaoFinanceiraItem']);
    assert.ok(p.camadas.some((c) => c.local_estoque_id === B.id), 'as camadas do destino mudam de custo');

    // excluir a PRÓPRIA transferência: as duas pernas saem; o B fica só com os 60 a 10 e a venda passa a 300
    const pt = ok(await previa(x, t.r.id));
    assert.deepEqual(pt.excluidos, [t.s.id, t.r.id]);
    assert.equal(pt.permitido, true);
    const venda2 = pt.movimentos.find((m) => m.id === mVenda.id);
    assert.deepEqual([venda2.depois.valor_total, venda2.depois.saldo_antes], ['300.0000', '60.0000']);
  });

  test('recusas e guarda: estorno, já excluído, outra empresa, querystring fechada, sem permissão, volume acima do teto, histórico que não reproduz o gravado', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, x.sal, A, '100', '3');
    const s = await sair(x, x.sal, A, '10');
    const ex = ok(await H.req('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: 1, motivo: 'errada', operation_id: `ex-${randomUUID()}` }));
    const original = await prisma().movimentacaoEstoque.findUnique({ where: { id: s.itens[0].movimentacao_estoque_id } });
    const codigo = (r) => [r.statusCode, r.json().code, r.json().reason ?? r.json().details?.reason];
    assert.deepEqual(codigo(await previa(x, original.id)), [409, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'movimento_ja_excluido']);
    assert.deepEqual(codigo(await previa(x, original.movimento_filho_id)), [409, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'movimento_e_estorno']);
    assert.ok(ex);
    assert.deepEqual(codigo(await previa(x, 'nao-existe')), [404, 'MOVIMENTACAO_ESTOQUE_NOT_FOUND', undefined]);
    const s2 = await sair(x, x.sal, A, '5');
    const m2 = await movDoItem(s2);
    assert.equal((await H.req('GET', `/estoque/movimentos/${m2.id}/exclusao/previa${qs({ empresa_id: x.e2.id })}`, x.token)).statusCode, 404, 'outra empresa = inexistente');
    assert.equal((await previa(x, m2.id, x.token, { cliente_id: x.c })).statusCode, 400, 'tenant nunca vem da querystring');
    // guarda = a da exclusão da saída manual (`estoque.saida`): só visualizar não basta
    const leitor = await x.conta({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true }] });
    assert.deepEqual(codigo(await previa(x, m2.id, leitor.token)).slice(0, 2), [403, 'ACAO_NAO_PERMITIDA']);
    const operador = await x.conta({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true, saida: true }] });
    assert.equal(ok(await previa(x, m2.id, operador.token)).permitido, true);
    // teto fail-closed (serviço com teto pequeno): nada é processado
    await assert.rejects(previaExclusao(x.ctx, m2.id, { empresa_id: x.e1.id }, { teto: 3 }), (e) => e.code === 'ESTOQUE_RECALCULO_VOLUME_EXCEDIDO' && e.details.movimentos === 4);
    const e1m = (await prisma().movimentacaoEstoque.findFirst({ where: { cliente_id: x.c, produto_id: x.sal.id, tipo_detalhado: 'entrada_manual' } }));
    await assert.rejects(previaExclusao(x.ctx, e1m.id, { empresa_id: x.e1.id }, { tetoAfetados: 2 }), (e) => e.code === 'ESTOQUE_RECALCULO_VOLUME_EXCEDIDO' && e.details.afetados === 3);
    // histórico adulterado (custo de camada fora do motor): o replay não reproduz o gravado → a prévia recusa
    const camada = await prisma().estoqueLoteNota.findFirst({ where: { cliente_id: x.c, produto_id: x.sal.id } });
    await prisma().estoqueLoteNota.update({ where: { id: camada.id }, data: { custo_unitario: '9.9999' } });
    const div = await previa(x, m2.id);
    assert.deepEqual(codigo(div), [409, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'replay_diverge_do_gravado']);
    assert.ok(div.json().details.divergencias >= 1);
  });
});

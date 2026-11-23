/**
 * D-PROD-279 — achados da revisão independente do controle de lote, corrigidos. PostgreSQL real, pela API.
 *
 *  R1 prévia do financeiro = gravado: A 100 a 4 (vence 31/12/2027), B 50 a 6 (vence 01/08/2027); venda de 60 kg →
 *     FEFO B 50 × 6 + A 10 × 4 = 340,0000 (5,6667/kg) na prévia e no movimento (antes a prévia dava o médio,
 *     (400 + 300) ÷ 150 = 4,6667/kg → 280,0000).
 *  R2 a troca do flag não é driblada por estorno posterior: estorno/exclusão de movimento cujo modo (LOTE ou não)
 *     diverge do cadastro atual → 409 `ESTOQUE_ESTORNO_MODO_LOTE_DIVERGENTE`, nada gravado (saída manual, entrada,
 *     transferência, atividade, venda do financeiro e a exclusão com recálculo).
 *  R3 estorno de saída LOTE com movimento depois (estorno exato) não reavalia: L1 10 a 4 e L2 10 a 6 ficam a 4 e a 6.
 *  R4 sobra de ajuste: camada Estornada do mesmo lote não dá custo (custo informado obrigatório); com camada vigente,
 *     informar custo → 400 `custo_do_lote_existente` (o custo é o do lote).
 *  R5 lote vencido consumido pelo FEFO nas origens só com API → `avisos: [{ tipo: 'lote_vencido', lote, validade }]`.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';
import { acoesAbastecimento, corpoAbastecimento, montarAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';
import { auditarReplayDoProduto } from '../src/modules/estoqueRecalculo/estoqueRecalculoService.js';
import { emLeituraSomente } from '../src/modules/estoqueRecalculo/estoqueRecalculoLeitor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const hoje = () => new Date().toISOString().slice(0, 10);
const opId = () => `op-${randomUUID()}`;
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};
const erro = (r, status, code, reason) => {
  assert.equal(r.statusCode, status, r.body);
  const b = r.json();
  if (code) assert.equal(b.code, code, r.body);
  if (reason) assert.equal(b.reason ?? b.details?.reason, reason, r.body);
  return b;
};
const v4 = (d) => (d === null || d === undefined ? null : Number(d).toFixed(4));
const DIVERGENTE = 'ESTOQUE_ESTORNO_MODO_LOTE_DIVERGENTE';
let seq = 0;

const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const novo = (prefixo, nome) => p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `${prefixo}-${suf}`, nome_produto: `${nome} ${suf}`, unidade_principal_estoque: 'KG' } });
  const sal = await novo('SAL', 'Vermífugo');
  const semLote = await novo('SL', 'Sal comum');
  const motivosEntrada = (await H.ok(H.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const motivosSaida = (await H.ok(H.req('GET', '/estoque/motivos-saida', s.token))).items;
  const compra = motivosEntrada.find((m) => m.nome === 'Compra').id;
  const perda = motivosSaida.find((m) => m.nome === 'Perda').id;
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: `ADUBAÇÃO ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true } });
  ok(await H.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  ok(await H.req('PATCH', `/produtos/${sal.id}`, s.token, { controla_lote: true, controla_validade: true }));
  return { ...s, sal, semLote, compra, perda, tipo };
};

const marcarLote = async (x, produto, lote) => ok(await H.req('PATCH', `/produtos/${produto.id}`, x.token, { controla_lote: lote }));
const entrar = async (x, produto, local, kg, custo, lote = null, validade = null) =>
  ok(await H.req('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e1.id, operation_id: `en-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: produto.unidade_principal_estoque, quantidade: kg, custo_unitario: custo, lote_fabricante: lote, data_validade: validade }],
  }), 201);
const sair = async (x, produto, local, kg) =>
  ok(await H.req('POST', '/estoque/saidas', x.token, {
    empresa_id: x.e1.id, operation_id: `sa-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg }],
  }), 201);
const excluir = (x, tipo, doc) =>
  H.req('POST', `/estoque/${tipo}/${doc.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: doc.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
const transferir = async (x, produto, origem, destino, kg) =>
  ok(await H.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e1.id, produto_id: produto.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade: kg,
  }), 201);
/** Foto das camadas do produto (para provar "nada foi gravado"). */
const camadas = async (produto) =>
  (await prisma().estoqueLoteNota.findMany({ where: { produto_id: produto.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
    .map((l) => [l.lote_fabricante, v4(l.quantidade_disponivel), v4(l.custo_unitario), l.status, l.local_estoque_id]);
const provarReplay = async (x, produto) => {
  const r = await emLeituraSomente((tx) => auditarReplayDoProduto(tx, x.c, x.e1.id, produto.id));
  assert.equal(r.reproduzivel, true, JSON.stringify({ problemas: r.problemas, parada: r.parada }));
  assert.deepEqual(r.divergencias, [], JSON.stringify(r.divergencias.slice(0, 5)));
};

/** Venda (RECEBER) em rascunho, com as linhas `[produto, local, kg, preço]`. */
const rascunhoDeVenda = async (x, linhas) => {
  const p = prisma();
  const base = { cliente_id: x.c, empresa_id: x.e1.id };
  const marca = randomUUID().slice(0, 6);
  const cli = await p.fornecedor.create({ data: { ...base, numero_cadastro: `CL-${marca}`, tipo_pessoa: 'Jurídica', nome: `Cliente ${marca}`, tipos: ['cliente'] } });
  const rec = await p.naturezaFinanceira.create({ data: { ...base, numero: `RC-${marca}`, tipo: 'RECEITA', nome: `VENDAS ${marca}` } });
  const centavos = linhas.reduce((t, [, , kg, preco]) => t + Math.round(Number(kg) * Number(preco) * 100), 0);
  const total = `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
  return ok(await H.req('POST', '/operacoes-financeiras', x.token, {
    empresa_id: x.e1.id, direcao: 'RECEBER', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: cli.id, data_emissao: '2027-06-10', data_operacional: '2027-06-10',
    efeito_fisico_confirmado: true,
    itens: linhas.map(([produto, local, kg, preco]) => ({ tipo_item: 'MERCADORIA', produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg, valor_unitario: preco })),
    rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: rec.id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
    operation_id: opId(),
  }), 201);
};
const confirmar = async (x, rascunho) =>
  ok(await H.req('POST', `/operacoes-financeiras/${rascunho.id}/confirmar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), versao: rascunho.versao }));

/** Atividade aberta + apontamento do dia 10/06/2027; devolve lançar e cancelar linha de produto. */
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
      return r;
    },
    cancelar: (linha) => H.req('POST', `${base}/${ap.id}/produtos/${linha.id}/cancelar`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), motivo: 'lançado errado' }),
    sincronizar: (r) => { ap = r.apontamento; },
  };
};

describe('R1 — prévia do financeiro pelo custo do lote (FEFO), igual ao gravado', () => {
  test('A 100 a 4 e B 50 a 6 (vence antes): venda de 60 → prévia 340,0000 (5,6667/kg) = movimento gravado', async () => {
    const x = await montar();
    await entrar(x, x.sal, x.local, '100', '4', 'A', '2027-12-31');
    await entrar(x, x.sal, x.local, '50', '6', 'B', '2027-08-01');
    const rascunho = await rascunhoDeVenda(x, [[x.sal, x.local, '60', '10']]);
    const previa = ok(await H.req('POST', `/operacoes-financeiras/${rascunho.id}/previa`, x.token, { empresa_id: x.e1.id }));
    const saida = previa.plano.efeitos_estoque.saidas[0];
    assert.deepEqual([v4(saida.custo_total), saida.fatias.map((f) => [v4(f.quantidade), v4(f.custo_unitario)])], ['340.0000', [['50.0000', '6.0000'], ['10.0000', '4.0000']]], JSON.stringify(saida));
    const confirmado = await confirmar(x, rascunho);
    const m = await prisma().movimentacaoEstoque.findUnique({ where: { id: confirmado.itens[0].movimentacao_estoque_id } });
    assert.deepEqual([m.modo_saida_fifo, v4(m.valor_total), v4(m.valor_unitario)], ['LOTE', v4(saida.custo_total), '5.6667'], 'prévia = gravado');
    const fatias = (await prisma().operacaoFinanceiraConsumoLote.findMany({ where: { item_id: confirmado.itens[0].id } }))
      .map((f) => [f.estoque_lote_nota_id, v4(f.quantidade), v4(f.custo_unitario)]).sort();
    assert.deepEqual(fatias, saida.fatias.map((f) => [f.lote_id, v4(f.quantidade), v4(f.custo_unitario)]).sort(), 'as mesmas fatias');
  });
});

describe('R2 — estorno/exclusão com o modo divergente do cadastro atual → 409, nada gravado', () => {
  test('saída manual antiga (custo médio) num produto que passou a controlar lote', async () => {
    const x = await montar();
    await entrar(x, x.semLote, x.local, '10', '2');
    const s = await sair(x, x.semLote, x.local, '10');
    await marcarLote(x, x.semLote, true);
    await entrar(x, x.semLote, x.local, '10', '8', 'L1');
    const antes = await camadas(x.semLote);
    erro(await excluir(x, 'saidas', s), 409, DIVERGENTE, 'movimento_sem_lote');
    assert.deepEqual(await camadas(x.semLote), antes, 'nenhuma camada sem lote volta ao produto com lote');
    assert.equal((await prisma().movimentacaoEstoque.findMany({ where: { produto_id: x.semLote.id, status: 'Estornada' } })).length, 0);
  });

  test('o inverso: saída LOTE num produto que voltou a "sem lote"', async () => {
    const x = await montar();
    await marcarLote(x, x.semLote, true);
    await entrar(x, x.semLote, x.local, '10', '4', 'L1');
    const s = await sair(x, x.semLote, x.local, '10');
    await marcarLote(x, x.semLote, false);
    await entrar(x, x.semLote, x.local, '10', '2');
    await entrar(x, x.semLote, x.local, '10', '6');
    const antes = await camadas(x.semLote);
    erro(await excluir(x, 'saidas', s), 409, DIVERGENTE, 'movimento_com_lote');
    assert.deepEqual(await camadas(x.semLote), antes);
  });

  test('entrada antiga sem lote (já consumida) num produto que passou a controlar lote: a exclusão com recálculo recusa', async () => {
    const x = await montar();
    const e = await entrar(x, x.semLote, x.local, '10', '2');
    await sair(x, x.semLote, x.local, '10');
    await marcarLote(x, x.semLote, true);
    await entrar(x, x.semLote, x.local, '10', '8', 'L1');
    const antes = await camadas(x.semLote);
    erro(await excluir(x, 'entradas', e), 409, DIVERGENTE, 'movimento_sem_lote');
    assert.deepEqual(await camadas(x.semLote), antes);
  });

  test('entrada com lote (consumida) num produto que voltou a "sem lote": a exclusão com recálculo recusa', async () => {
    const x = await montar();
    await marcarLote(x, x.semLote, true);
    // A troca exige saldo zero: L1 entra e sai inteira; depois do "sem lote", entra 5 a 2 (a exclusão recalcula).
    const e = await entrar(x, x.semLote, x.local, '10', '4', 'L1');
    await sair(x, x.semLote, x.local, '10');
    await marcarLote(x, x.semLote, false);
    await entrar(x, x.semLote, x.local, '5', '2');
    erro(await excluir(x, 'entradas', e), 409, DIVERGENTE, 'movimento_com_lote');
  });

  test('transferência antiga (custo médio) num produto que passou a controlar lote: o cancelamento recusa', async () => {
    const x = await montar();
    await entrar(x, x.semLote, x.local, '10', '2');
    const t = await transferir(x, x.semLote, x.local, x.local2, '10');
    await sair(x, x.semLote, x.local2, '10');
    await marcarLote(x, x.semLote, true);
    const antes = await camadas(x.semLote);
    const r = await H.req('POST', `/movimentacoes-estoque/${t.movimentacao_saida.id}/cancelar-transferencia`, x.token, { empresa_id: x.e1.id, motivo: 'depósito errado', operation_id: opId() });
    erro(r, 409, DIVERGENTE, 'movimento_sem_lote');
    assert.deepEqual(await camadas(x.semLote), antes);
  });

  test('linha de produto da atividade (estorno em lote) e venda do financeiro', async () => {
    const x = await montar();
    await entrar(x, x.semLote, x.local, '20', '2');
    const at = await atividade(x);
    const { linha } = await at.lancar(x.semLote, x.local, '10');
    const venda = await confirmar(x, await rascunhoDeVenda(x, [[x.semLote, x.local, '10', '9']]));
    await marcarLote(x, x.semLote, true);
    await entrar(x, x.semLote, x.local, '10', '8', 'L1');
    const antes = await camadas(x.semLote);
    erro(await at.cancelar(linha), 409, DIVERGENTE, 'movimento_sem_lote');
    erro(await H.req('POST', `/operacoes-financeiras/${venda.id}/cancelar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), motivo: 'lançada errada' }), 409, DIVERGENTE, 'movimento_sem_lote');
    assert.deepEqual(await camadas(x.semLote), antes);
  });

  test('sem troca do cadastro, nada muda: excluir saída e entrada no mesmo modo continua aceito', async () => {
    const x = await montar();
    await entrar(x, x.semLote, x.local, '10', '2');
    const s = await sair(x, x.semLote, x.local, '4');
    ok(await excluir(x, 'saidas', s));
    const e = await entrar(x, x.sal, x.local, '10', '4', 'A', '2027-12-31');
    ok(await excluir(x, 'entradas', e));
    await provarReplay(x, x.semLote);
    await provarReplay(x, x.sal);
  });
});

describe('R3 — estorno de saída LOTE com movimento depois não reavalia camada', () => {
  test('L1 10 a 4 e L2 10 a 6; atividade 5 (L1), saída manual 2 depois; cancelar a linha → L1 8 a 4, L2 10 a 6', async () => {
    const x = await montar();
    await entrar(x, x.sal, x.local, '10', '4', 'L1', '2027-09-01');
    await entrar(x, x.sal, x.local, '10', '6', 'L2', '2027-12-01');
    const at = await atividade(x);
    const { linha } = await at.lancar(x.sal, x.local, '5');
    await sair(x, x.sal, x.local, '2');
    const r = ok(await at.cancelar(linha));
    at.sincronizar(r);
    const vigentes = (await camadas(x.sal)).filter((c) => c[3] !== 'Estornado').map((c) => c.slice(0, 3));
    assert.deepEqual(vigentes, [['L1', '8.0000', '4.0000'], ['L2', '10.0000', '6.0000']]);
    await provarReplay(x, x.sal);
  });
});

describe('R4 — sobra de ajuste pelo custo do mesmo lote (escolha do proprietário)', () => {
  test('camada Estornada do lote não dá custo; com camada vigente, custo informado → 400', async () => {
    const x = await montar();
    const ajustar = (itens) => H.req('POST', '/estoque/ajustes', x.token, { empresa_id: x.e1.id, operation_id: `aj-${randomUUID()}`, itens });
    const base = { produto_id: x.sal.id, local_estoque_id: x.local.id, unidade: 'KG' };
    const e = await entrar(x, x.sal, x.local, '10', '4', 'A', '2027-12-31');
    ok(await excluir(x, 'entradas', e)); // camada A Estornada, saldo 0
    erro(await ajustar([{ ...base, quantidade_contada: '5', lote_fabricante: 'A', data_validade: '2027-12-31' }]), 422, undefined, 'custo_obrigatorio_sem_saldo');
    const a1 = ok(await ajustar([{ ...base, quantidade_contada: '5', lote_fabricante: 'A', data_validade: '2027-12-31', custo_unitario: '7' }]), 201);
    assert.deepEqual([v4(a1.itens[0].custo_unitario), v4(a1.itens[0].valor_total), a1.itens[0].custo_informado], ['7.0000', '35.0000', true]);
    // Agora há camada vigente do A (a 7): informar outro custo é recusado; sem custo, entra a 7.
    erro(await ajustar([{ ...base, quantidade_contada: '8', lote_fabricante: 'A', custo_unitario: '9' }]), 400, 'REQUEST_VALIDATION_FAILED', 'custo_do_lote_existente');
    const a2 = ok(await ajustar([{ ...base, quantidade_contada: '8', lote_fabricante: 'A' }]), 201);
    assert.deepEqual([v4(a2.itens[0].custo_unitario), v4(a2.itens[0].valor_total), a2.itens[0].custo_informado], ['7.0000', '21.0000', false]);
    await provarReplay(x, x.sal);
  });
});

describe('R5 — aviso de lote vencido nas origens só com API', () => {
  const VENCIDO = { tipo: 'lote_vencido', lote: 'V1', validade: '2027-01-10' };
  const semId = (avisos) => avisos.map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'lote_id')));

  test('atividade, venda do financeiro e cocho: FEFO consome o lote vencido e avisa; lote em dia não avisa', async () => {
    const x = await montar();
    await entrar(x, x.sal, x.local, '30', '3', 'V1', '2027-01-10');
    await entrar(x, x.sal, x.local, '30', '5', 'OK', '2028-01-10');
    const at = await atividade(x);
    const r1 = await at.lancar(x.sal, x.local, '5');
    assert.deepEqual(semId(r1.avisos), [VENCIDO]);
    const venda = await confirmar(x, await rascunhoDeVenda(x, [[x.sal, x.local, '5', '9']]));
    assert.deepEqual(semId(venda.avisos), [{ ...VENCIDO, item_ordem: 1 }]);
    const cocho = ok(await H.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
      operation_id: `sup-${randomUUID()}`, empresa_id: x.e1.id, produto_id: x.sal.id, local_origem_id: x.local.id, quantidade: '5', ponto_suplementacao_id: 'ponto-1', data_movimentacao: '2027-06-10',
    }), 201);
    assert.deepEqual(semId(cocho.avisos), [VENCIDO]);
    // V1 tem 15; 20 kg → 15 do V1 + 5 do OK: um aviso só (o OK está em dia).
    const r2 = await at.lancar(x.sal, x.local, '20');
    assert.deepEqual(semId(r2.avisos), [VENCIDO]);
    const r3 = await at.lancar(x.sal, x.local, '5');
    assert.equal(r3.avisos, undefined, 'só o lote em dia: sem aviso (o campo só vem com aviso; o contrato de sempre não muda)');
  });

  test('abastecimento: diesel com lote vencido → aviso na confirmação', async () => {
    const x = await montar();
    await marcarLote(x, x.diesel, true);
    await entrar(x, x.diesel, x.local, '200', '5', 'V1', '2027-01-10');
    const AB = acoesAbastecimento(app);
    const r = await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '50', medidor_leitura: '1550.5' }));
    assert.deepEqual(semId(r.avisos), [VENCIDO]);
  });
});

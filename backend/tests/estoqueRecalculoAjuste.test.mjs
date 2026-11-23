/**
 * D-PROD-273 × D-PROD-272 — o replay do custo médio com o AJUSTE DE INVENTÁRIO, contra PostgreSQL real e pelos serviços
 * de verdade (HTTP autenticado). O ajuste grava, pela origem `ajuste_estoque`:
 *  - SOBRA (`ajuste_sobra`): entrada com camada nova ao custo médio do depósito naquele momento (sem saldo, ao custo
 *    informado na linha, `custo_informado = true`); o poço não é reavaliado;
 *  - FALTA (`ajuste_falta`): saída a custo médio, com as fatias em `lotes_consumidos` e o poço reavaliado;
 *  - exclusão: `estorno_ajuste_sobra` (a camada da sobra fica 'Estornado', sem reavaliar) e `estorno_ajuste_falta`
 *    (devolve as fatias e o valor exato, e o poço é reavaliado).
 * Cada cenário prova `auditarReplayDoProduto` = zero divergência. No caso do dono (entradas → S1 → ajuste → S2), a
 * exclusão de S1 com recálculo passa e recalcula o ajuste: a falta pelo médio novo e a SOBRA também — a camada dela
 * herdou o médio do depósito, então o custo dela segue o médio recalculado, salvo quando o custo foi informado.
 * Quantidades não mudam (o recálculo é de custo): a diferença do ajuste e o saldo contado ficam como lançados.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { auditarReplayDoProduto } from '../src/modules/estoqueRecalculo/estoqueRecalculoService.js';
import { emLeituraSomente } from '../src/modules/estoqueRecalculo/estoqueRecalculoLeitor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

before(async () => {
  app = await criarApp();
  await app.ready();
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const chamar = (method, url, token, payload) => app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload } : {}) });
const qs = (obj) => '?' + new URLSearchParams(obj).toString();
const hoje = () => new Date().toISOString().slice(0, 10);
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};

let seq = 0;
const produto = (c, e, nome) =>
  prisma().produto.create({ data: { cliente_id: c, empresa_id: e, numero_produto: String(++seq + 1000), nome_produto: nome, unidade_principal_estoque: 'KG' } });
const local = (c, nome) => prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome } });

const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const ureia = await produto(c, e.id, 'Ureia');
  const sal = await produto(c, e.id, 'Sal mineral');
  const galpao = await local(c, 'Galpão');
  const barracao = await local(c, 'Barracão');
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  const token = corpo.token;
  const compra = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items.find((m) => m.nome === 'Compra').id;
  const perda = (await chamar('GET', '/estoque/motivos-saida', token)).json().items.find((m) => m.nome === 'Perda').id;
  return { c, e, ureia, sal, galpao, barracao, token, compra, perda };
};

const entrar = async (x, p, qtd, custo, deposito = x.galpao) =>
  ok(await chamar('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: p.id, local_estoque_id: deposito.id, unidade: 'KG', quantidade: qtd, custo_unitario: custo }],
  }), 201);
const sair = async (x, p, qtd, deposito = x.galpao) =>
  ok(await chamar('POST', '/estoque/saidas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
    itens: [{ produto_id: p.id, local_estoque_id: deposito.id, unidade: 'KG', quantidade: qtd }],
  }), 201);
const ajustar = async (x, itens) =>
  ok(await chamar('POST', '/estoque/ajustes', x.token, { empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, itens: itens.map((i) => ({ unidade: 'KG', ...i })) }), 201);
const excluirAjuste = async (x, a) =>
  ok(await chamar('POST', `/estoque/ajustes/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: a.versao, motivo: 'contagem errada', operation_id: `ex-${randomUUID()}` }));
const excluirSaida = (x, s) =>
  chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: s.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
const previa = (x, movimentoId) => chamar('GET', `/estoque/movimentos/${movimentoId}/exclusao/previa${qs({ empresa_id: x.e.id })}`, x.token);

const mov = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const v4 = (d) => (d === null || d === undefined ? null : Number(d).toFixed(4));
/** [valor_unitario, valor_total, saldo_antes, saldo_depois] gravados. */
const valores = (m) => [v4(m.valor_unitario), v4(m.valor_total), v4(m.saldo_antes), v4(m.saldo_depois)];
const camadaDe = async (movimentoId) => prisma().estoqueLoteNota.findFirst({ where: { movimentacao_entrada_id: movimentoId } });
const itemDoAjuste = (id) => prisma().ajusteEstoqueItem.findUnique({ where: { id } });
/** [tipo, saldo_anterior, contado, diferenca, custo_unitario, valor_total, custo_informado] gravados. */
const linha = (i) => [i.tipo, v4(i.saldo_anterior), v4(i.contado_estoque), v4(i.diferenca), v4(i.custo_unitario), v4(i.valor_total), i.custo_informado];
const poco = async (x, p, deposito = x.galpao) => {
  const ls = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, produto_id: p.id, local_estoque_id: deposito.id, status: 'Disponivel' } });
  const q = ls.reduce((t, l) => t + Number(l.quantidade_disponivel), 0);
  const v = ls.reduce((t, l) => t + Number(l.quantidade_disponivel) * Number(l.custo_unitario), 0);
  return [q.toFixed(4), v.toFixed(4)];
};

/** Prova "replay = gravado" do produto. */
const provarReplay = async (x, p) => {
  const r = await emLeituraSomente((tx) => auditarReplayDoProduto(tx, x.c, x.e.id, p.id));
  assert.equal(r.reproduzivel, true, JSON.stringify({ problemas: r.problemas, parada: r.parada }));
  assert.deepEqual(r.divergencias, [], JSON.stringify(r.divergencias.slice(0, 5)));
  return r;
};

describe('D-PROD-273 × D-PROD-272 — replay = gravado com ajuste de inventário', () => {
  test('(a) entradas, ajuste com SOBRA ao médio (arredondado), saída depois: replay reproduz', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '30', '1');
    await entrar(x, x.ureia, '40', '2'); // 70 kg, R$ 110, médio 1,5714
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '80' }]);
    assert.deepEqual(linha(a.itens[0]), ['SOBRA', '70.0000', '80.0000', '10.0000', '1.5714', '15.7140', false]);
    const s = await sair(x, x.ureia, '25'); // 80 kg, R$ 125,714 → médio 1,5714; 25 × 1,5714 = 39,285
    assert.deepEqual(valores(await mov(s.itens[0].movimentacao_estoque_id)), ['1.5714', '39.2850', '80.0000', '55.0000']);
    const r = await provarReplay(x, x.ureia);
    assert.equal(r.movimentos, 4);
  });

  test('(b) ajuste com FALTA a médio, saída depois: replay reproduz', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '50', '2');
    await entrar(x, x.ureia, '50', '4');
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '90' }]);
    assert.deepEqual(linha(a.itens[0]), ['FALTA', '100.0000', '90.0000', '-10.0000', '3.0000', '30.0000', false]);
    const s = await sair(x, x.ureia, '20');
    assert.deepEqual(valores(await mov(s.itens[0].movimentacao_estoque_id)), ['3.0000', '60.0000', '90.0000', '70.0000']);
    await provarReplay(x, x.ureia);
  });

  test('(c) ajuste com sobra e falta EXCLUÍDO sem nada depois (estorno_ajuste_sobra e estorno_ajuste_falta): replay reproduz', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '50', '2');
    await entrar(x, x.ureia, '50', '4');
    await entrar(x, x.sal, '60', '5');
    await entrar(x, x.sal, '40', '10');
    const a = await ajustar(x, [
      { produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '120' },
      { produto_id: x.sal.id, local_estoque_id: x.galpao.id, quantidade_contada: '75' },
    ]);
    assert.deepEqual(a.itens.map(linha), [
      ['SOBRA', '100.0000', '120.0000', '20.0000', '3.0000', '60.0000', false],
      ['FALTA', '100.0000', '75.0000', '-25.0000', '7.0000', '175.0000', false],
    ]);
    await provarReplay(x, x.ureia);
    await provarReplay(x, x.sal);
    const b = await excluirAjuste(x, a);
    assert.equal(b.status, 'EXCLUIDA');
    const est = await Promise.all(b.itens.map((i) => mov(i.movimentacao_estorno_id)));
    assert.deepEqual(est.map((m) => [m.tipo_detalhado, ...valores(m)]), [
      ['estorno_ajuste_sobra', '3.0000', '60.0000', '120.0000', '100.0000'],
      ['estorno_ajuste_falta', '7.0000', '175.0000', '75.0000', '100.0000'],
    ]);
    assert.deepEqual([await poco(x, x.ureia), await poco(x, x.sal)], [['100.0000', '300.0000'], ['100.0000', '700.0000']]);
    await provarReplay(x, x.ureia);
    await provarReplay(x, x.sal);
  });

  test('(d) sobra num depósito SEM saldo (custo informado), saída depois; o outro depósito tem saldo: replay reproduz', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3'); // galpão
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.barracao.id, quantidade_contada: '15', custo_unitario: '7' }]);
    assert.deepEqual(linha(a.itens[0]), ['SOBRA', '0.0000', '15.0000', '15.0000', '7.0000', '105.0000', true]);
    const s = await sair(x, x.ureia, '5', x.barracao);
    assert.deepEqual(valores(await mov(s.itens[0].movimentacao_estoque_id)), ['7.0000', '35.0000', '15.0000', '10.0000']);
    await provarReplay(x, x.ureia);
  });
});

/**
 * O caso do dono com ajuste no meio (conta à mão). E1 100 kg a R$ 2; S1 tira 50 (R$ 100) → 50 kg a R$ 2; E2 50 kg a
 * R$ 5 → 100 kg, R$ 350, médio R$ 3,50. Ajuste; S2 tira 20.
 * Sem S1: E1 + E2 = 150 kg, R$ 450, médio R$ 3,00 no ponto do ajuste.
 */
const casoDoDono = async (x, contado, extra = {}) => {
  const e1 = await entrar(x, x.ureia, '100', '2');
  const s1 = await sair(x, x.ureia, '50');
  await entrar(x, x.ureia, '50', '5');
  const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: contado, ...extra }]);
  const s2 = await sair(x, x.ureia, '20');
  return { e1, s1, a, s2, ma: a.itens[0].movimentacao_estoque_id, m2: s2.itens[0].movimentacao_estoque_id };
};

describe('D-PROD-273 × D-PROD-272 — o caso do dono: entradas → S1 → ajuste → S2; excluir S1 com recálculo', () => {
  test('(e1) SOBRA no meio: o custo da camada da sobra segue o médio recalculado (3,50 → 3,00); S2 de R$ 70 para R$ 60; replay = gravado', async () => {
    const x = await cenario();
    const c = await casoDoDono(x, '110'); // sobra 10 a 3,50 = 35 → 110 kg, R$ 385; S2 20 × 3,50 = 70 → 90 kg, R$ 315
    assert.deepEqual(linha(c.a.itens[0]), ['SOBRA', '100.0000', '110.0000', '10.0000', '3.5000', '35.0000', false]);
    assert.deepEqual(valores(await mov(c.ma)), ['3.5000', '35.0000', '100.0000', '110.0000']);
    assert.deepEqual(valores(await mov(c.m2)), ['3.5000', '70.0000', '110.0000', '90.0000']);
    await provarReplay(x, x.ureia);

    // Prévia: a sobra e S2 mudam; a linha do ajuste é dependente.
    const p = ok(await previa(x, c.s1.itens[0].movimentacao_estoque_id));
    assert.deepEqual([p.permitido, p.modo], [true, 'recalculo']);
    const pm = new Map(p.movimentos.map((m) => [m.id, m]));
    assert.deepEqual([pm.get(c.ma)?.antes.valor_unitario, pm.get(c.ma)?.depois.valor_unitario, pm.get(c.ma)?.depois.valor_total], ['3.5000', '3.0000', '30.0000']);
    assert.deepEqual([pm.get(c.m2)?.antes.valor_total, pm.get(c.m2)?.depois.valor_total], ['70.0000', '60.0000']);
    assert.ok(p.dependentes.some((d) => d.tipo === 'AjusteEstoqueItem' && d.id === c.a.itens[0].id && d.movimento_id === c.ma && d.documento_id === c.a.id), JSON.stringify(p.dependentes));

    // Sem S1: 150 kg a 3,00 → sobra 10 a 3,00 = 30 → 160 kg, R$ 480, médio 3,00 → S2 20 × 3 = 60 → 140 kg, R$ 420.
    const r = ok(await excluirSaida(x, c.s1));
    assert.equal(r.status, 'EXCLUIDA');
    assert.deepEqual(valores(await mov(c.ma)), ['3.0000', '30.0000', '150.0000', '160.0000']);
    assert.deepEqual(valores(await mov(c.m2)), ['3.0000', '60.0000', '160.0000', '140.0000']);
    const camada = await camadaDe(c.ma);
    assert.deepEqual([v4(camada.quantidade_entrada), v4(camada.quantidade_disponivel), v4(camada.custo_unitario), camada.status], ['10.0000', '10.0000', '3.0000', 'Disponivel']);
    assert.deepEqual(await poco(x, x.ureia), ['140.0000', '420.0000']);
    // A linha do ajuste: custo e valor recalculados; a contagem (saldo anterior, contado, diferença) fica como lançada.
    assert.deepEqual(linha(await itemDoAjuste(c.a.itens[0].id)), ['SOBRA', '100.0000', '110.0000', '10.0000', '3.0000', '30.0000', false]);
    const t = await prisma().auditLog.findMany({ where: { cliente_id: x.c, acao: 'estoque.recalculo', entidade: 'AjusteEstoqueItem', entidade_id: c.a.itens[0].id } });
    assert.deepEqual(t.map((e) => [e.dados_anteriores.custo_unitario, e.dados_novos.custo_unitario, e.dados_anteriores.valor_total, e.dados_novos.valor_total]), [['3.5000', '3.0000', '35.0000', '30.0000']]);
    await provarReplay(x, x.ureia);
  });

  test('(e2) FALTA no meio: a falta é saída a médio e é recalculada (3,50 → 3,00), com a linha do ajuste; S2 de R$ 70 para R$ 60; replay = gravado', async () => {
    const x = await cenario();
    const c = await casoDoDono(x, '90'); // falta 10 a 3,50 = 35 → 90 kg a 3,50; S2 20 × 3,50 = 70 → 70 kg, R$ 245
    assert.deepEqual(linha(c.a.itens[0]), ['FALTA', '100.0000', '90.0000', '-10.0000', '3.5000', '35.0000', false]);
    assert.deepEqual(valores(await mov(c.m2)), ['3.5000', '70.0000', '90.0000', '70.0000']);
    await provarReplay(x, x.ureia);

    // Sem S1: 150 kg a 3,00 → falta 10 × 3 = 30 → 140 kg a 3,00 → S2 20 × 3 = 60 → 120 kg, R$ 360.
    const r = ok(await excluirSaida(x, c.s1));
    assert.equal(r.status, 'EXCLUIDA');
    const falta = await mov(c.ma);
    assert.deepEqual(valores(falta), ['3.0000', '30.0000', '150.0000', '140.0000']);
    assert.deepEqual(falta.lotes_consumidos.map((f) => [f.lote_id, f.quantidade, f.custo_unitario]), [[(await camadaDe(c.e1.itens[0].movimentacao_estoque_id)).id, '10.0000', '3.0000']]);
    assert.deepEqual(valores(await mov(c.m2)), ['3.0000', '60.0000', '140.0000', '120.0000']);
    assert.deepEqual(await poco(x, x.ureia), ['120.0000', '360.0000']);
    assert.deepEqual(linha(await itemDoAjuste(c.a.itens[0].id)), ['FALTA', '100.0000', '90.0000', '-10.0000', '3.0000', '30.0000', false]);
    await provarReplay(x, x.ureia);
  });

  test('(e3) sobra com CUSTO INFORMADO no meio (S1 zerou o depósito): o custo informado não muda; só o médio de S2 muda; replay = gravado', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    const s1 = await sair(x, x.ureia, '100'); // zera o galpão
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '10', custo_unitario: '7' }]);
    assert.deepEqual(linha(a.itens[0]), ['SOBRA', '0.0000', '10.0000', '10.0000', '7.0000', '70.0000', true]);
    const s2 = await sair(x, x.ureia, '5'); // 5 × 7 = 35
    const ma = a.itens[0].movimentacao_estoque_id;
    const m2 = s2.itens[0].movimentacao_estoque_id;
    assert.deepEqual(valores(await mov(m2)), ['7.0000', '35.0000', '10.0000', '5.0000']);
    await provarReplay(x, x.ureia);

    // Sem S1: 100 kg a 2 + sobra 10 a 7 (informado, fica) = 110 kg, R$ 270, médio 2,4545 → S2 5 × 2,4545 = 12,2725.
    ok(await excluirSaida(x, s1));
    assert.deepEqual(valores(await mov(ma)), ['7.0000', '70.0000', '100.0000', '110.0000']);
    assert.deepEqual(valores(await mov(m2)), ['2.4545', '12.2725', '110.0000', '105.0000']);
    assert.deepEqual(linha(await itemDoAjuste(a.itens[0].id)), ['SOBRA', '0.0000', '10.0000', '10.0000', '7.0000', '70.0000', true]);
    await provarReplay(x, x.ureia);
  });
});

/**
 * D-PROD-273 × D-PROD-272 — o replay do custo médio com o AJUSTE DE INVENTÁRIO, contra PostgreSQL real e pelos serviços
 * de verdade (HTTP autenticado). O ajuste grava, pela origem `ajuste_estoque`:
 *  - SOBRA (`ajuste_sobra`): entrada com camada nova ao custo médio do depósito naquele momento (sem saldo, ao custo
 *    informado na linha, `custo_informado = true`); o poço não é reavaliado;
 *  - FALTA (`ajuste_falta`): saída a custo médio, com as fatias em `lotes_consumidos` e o poço reavaliado;
 *  - exclusão: `estorno_ajuste_sobra` (a camada da sobra fica 'Estornado', sem reavaliar) e `estorno_ajuste_falta`
 *    (devolve as fatias e o valor exato, e o poço é reavaliado).
 * Cada cenário prova `auditarReplayDoProduto` = zero divergência. A sobra nasce, no replay, ao médio do depósito
 * naquele ponto (salvo custo informado), e o replay prova esse custo em vez de copiá-lo.
 * ESCOLHA DO PROPRIETÁRIO (2026-11-23): com contagem de inventário VIGENTE depois do movimento excluído, num depósito
 * que a exclusão alcança (o dele e, pela cascata da transferência, o destino), a exclusão é RECUSADA (409
 * `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL`, `ajuste_de_inventario_posterior`) e nada é gravado: o estoque nunca fica
 * diferente do contado. Ajuste ANTERIOR ao excluído, ajuste já excluído e ajuste no destino antes de a cascata chegar
 * não recusam; neles a sobra segue o médio recalculado (e a linha do ajuste, se mudar, é reescrita).
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
const transferir = async (x, p, origem, destino, kg) => {
  const r = ok(await chamar('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e.id, produto_id: p.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade: kg,
  }), 201);
  return { s: r.movimentacao_saida, r: r.movimentacao_entrada };
};
/** Tudo que a exclusão poderia gravar (movimentos, camadas, linhas do ajuste, saídas, trilha), para provar "nada foi gravado". */
const foto = async (x) => {
  const p = prisma();
  const w = { where: { cliente_id: x.c }, orderBy: { id: /** @type {const} */ ('asc') } };
  return JSON.stringify([
    await p.movimentacaoEstoque.findMany(w), await p.estoqueLoteNota.findMany(w), await p.ajusteEstoqueItem.findMany(w), await p.saidaEstoque.findMany(w),
    await p.saidaEstoqueItem.findMany(w), await p.produto.findMany(w), await p.auditLog.count({ where: { cliente_id: x.c, acao: 'estoque.recalculo' } }),
  ]);
};
/** A exclusão de S1 é recusada pela contagem posterior, com o depósito, o movimento e o número do ajuste; nada gravado. */
const exigirRecusaPorAjuste = async (x, s1, { ajuste, movimentoAjuste, deposito = x.galpao }) => {
  const antes = await foto(x);
  const r = await excluirSaida(x, s1);
  assert.equal(r.statusCode, 409, r.body);
  const b = r.json();
  assert.deepEqual([b.code, b.reason ?? b.details?.reason, b.details?.local_estoque_id, b.details?.movimento_id, b.details?.ajuste_id, b.details?.ajuste_numero],
    ['ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'ajuste_de_inventario_posterior', deposito.id, movimentoAjuste, ajuste.id, ajuste.numero]);
  assert.match(b.message, new RegExp(`contagem de inventário \\(ajuste nº ${ajuste.numero}\\) depois deste movimento`));
  assert.equal(await foto(x), antes, 'nada foi gravado');
  const p = ok(await previa(x, s1.itens[0].movimentacao_estoque_id));
  assert.deepEqual([p.permitido, p.modo, p.recusa?.code, p.recusa?.reason, p.recusa?.ajuste_numero, p.aviso], [false, null, 'ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'ajuste_de_inventario_posterior', ajuste.numero, null]);
};
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
 * O caso do dono com ajuste no meio. E1 100 kg a R$ 2; S1 tira 50 (R$ 100) → 50 kg a R$ 2; E2 50 kg a R$ 5 → 100 kg,
 * R$ 350, médio R$ 3,50. Ajuste; S2 tira 20 (a R$ 3,50 = R$ 70).
 */
const casoDoDono = async (x, contado, extra = {}) => {
  const e1 = await entrar(x, x.ureia, '100', '2');
  const s1 = await sair(x, x.ureia, '50');
  await entrar(x, x.ureia, '50', '5');
  const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: contado, ...extra }]);
  const s2 = await sair(x, x.ureia, '20');
  return { e1, s1, a, s2, ma: a.itens[0].movimentacao_estoque_id, m2: s2.itens[0].movimentacao_estoque_id };
};

describe('D-PROD-273 × D-PROD-272 — escolha do proprietário: com contagem de inventário depois, no depósito, a exclusão é recusada', () => {
  test('(e1) SOBRA no meio (entradas → S1 → ajuste → S2): excluir S1 → 409 ajuste_de_inventario_posterior, nada gravado; replay = gravado', async () => {
    const x = await cenario();
    const c = await casoDoDono(x, '110'); // sobra 10 a 3,50 = 35; S2 20 × 3,50 = 70
    assert.deepEqual(linha(c.a.itens[0]), ['SOBRA', '100.0000', '110.0000', '10.0000', '3.5000', '35.0000', false]);
    assert.deepEqual(valores(await mov(c.m2)), ['3.5000', '70.0000', '110.0000', '90.0000']);
    await provarReplay(x, x.ureia);
    await exigirRecusaPorAjuste(x, c.s1, { ajuste: c.a, movimentoAjuste: c.ma });
    assert.deepEqual(valores(await mov(c.ma)), ['3.5000', '35.0000', '100.0000', '110.0000']);
    await provarReplay(x, x.ureia);
  });

  test('(e2) FALTA no meio: excluir S1 → 409, nada gravado; replay = gravado', async () => {
    const x = await cenario();
    const c = await casoDoDono(x, '90'); // falta 10 a 3,50 = 35; S2 70
    assert.deepEqual(linha(c.a.itens[0]), ['FALTA', '100.0000', '90.0000', '-10.0000', '3.5000', '35.0000', false]);
    await exigirRecusaPorAjuste(x, c.s1, { ajuste: c.a, movimentoAjuste: c.ma });
    assert.deepEqual(valores(await mov(c.m2)), ['3.5000', '70.0000', '90.0000', '70.0000']);
    await provarReplay(x, x.ureia);
  });

  test('(e3) sobra com CUSTO INFORMADO no meio (S1 zerou o depósito): excluir S1 → 409, nada gravado', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    const s1 = await sair(x, x.ureia, '100');
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '10', custo_unitario: '7' }]);
    assert.deepEqual(linha(a.itens[0]), ['SOBRA', '0.0000', '10.0000', '10.0000', '7.0000', '70.0000', true]);
    await sair(x, x.ureia, '5');
    await exigirRecusaPorAjuste(x, s1, { ajuste: a, movimentoAjuste: a.itens[0].movimentacao_estoque_id });
    await provarReplay(x, x.ureia);
  });

  test('(e4) o ajuste é o ÚNICO posterior (entrada → S1 → ajuste): recusa também — o ajuste é "algo depois"', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    const s1 = await sair(x, x.ureia, '30');
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '75' }]); // falta 5
    await exigirRecusaPorAjuste(x, s1, { ajuste: a, movimentoAjuste: a.itens[0].movimentacao_estoque_id });
    await provarReplay(x, x.ureia);
  });

  test('(e5) cascada: S1 em A, transferência A→B, contagem em B depois dela → 409 com o depósito B (achado pelo replay), nada gravado', async () => {
    const x = await cenario();
    const A = x.galpao;
    const B = x.barracao;
    await entrar(x, x.ureia, '100', '2', A);
    const s1 = await sair(x, x.ureia, '50', A);
    await entrar(x, x.ureia, '50', '5', A); // A: 100 kg a 3,50
    await transferir(x, x.ureia, A, B, '40'); // B: 40 a 3,50
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: B.id, quantidade_contada: '45' }]); // sobra 5 a 3,50 em B
    await exigirRecusaPorAjuste(x, s1, { ajuste: a, movimentoAjuste: a.itens[0].movimentacao_estoque_id, deposito: B });
    await provarReplay(x, x.ureia);
  });
});

describe('D-PROD-273 × D-PROD-272 — ajuste que NÃO recusa: anterior ao excluído, já excluído, ou no destino antes da cascata', () => {
  test('(e6) ajuste ANTERIOR (entradas → ajuste → S1 → entrada → S2): excluir S1 passa e recalcula S2 (80 → 76); o ajuste não muda', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    await entrar(x, x.ureia, '50', '5'); // 150 kg, R$ 450, médio 3
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '160' }]); // sobra 10 a 3 = 30
    const s1 = await sair(x, x.ureia, '40'); // 40 × 3 = 120 → 120 kg a 3 (R$ 360)
    await entrar(x, x.ureia, '40', '7'); // 160 kg, R$ 640, médio 4
    const s2 = await sair(x, x.ureia, '20'); // 20 × 4 = 80
    const m2 = s2.itens[0].movimentacao_estoque_id;
    assert.deepEqual(valores(await mov(m2)), ['4.0000', '80.0000', '160.0000', '140.0000']);
    await provarReplay(x, x.ureia);
    // Sem S1: 160 kg a 3 (R$ 480) + 40 a 7 = 200 kg, R$ 760, médio 3,8 → S2 20 × 3,8 = 76 → 180 kg, R$ 684.
    const r = ok(await excluirSaida(x, s1));
    assert.equal(r.recalculo.produtos, 1);
    assert.deepEqual(valores(await mov(m2)), ['3.8000', '76.0000', '200.0000', '180.0000']);
    assert.deepEqual(await poco(x, x.ureia), ['180.0000', '684.0000']);
    assert.deepEqual(valores(await mov(a.itens[0].movimentacao_estoque_id)), ['3.0000', '30.0000', '150.0000', '160.0000']);
    assert.deepEqual(linha(await itemDoAjuste(a.itens[0].id)), ['SOBRA', '150.0000', '160.0000', '10.0000', '3.0000', '30.0000', false]);
    await provarReplay(x, x.ureia);
  });

  test('(e7) ajuste JÁ EXCLUÍDO depois de S1 (a contagem não vale mais): excluir S1 passa; a sobra e o estorno dela seguem o médio novo (3,50 → 3,00) e a linha do ajuste excluído é reescrita (trilha)', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    const s1 = await sair(x, x.ureia, '50');
    await entrar(x, x.ureia, '50', '5'); // 100 kg a 3,50
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '110' }]); // sobra 10 × 3,50 = 35
    const b = await excluirAjuste(x, a);
    const ma = a.itens[0].movimentacao_estoque_id;
    const me = b.itens[0].movimentacao_estorno_id;
    const s2 = await sair(x, x.ureia, '20'); // 100 kg a 3,50 → 20 × 3,50 = 70
    const m2 = s2.itens[0].movimentacao_estoque_id;
    assert.deepEqual(valores(await mov(m2)), ['3.5000', '70.0000', '100.0000', '80.0000']);
    await provarReplay(x, x.ureia);
    // Sem S1: 150 kg a 3 → sobra 10 × 3 = 30; estorno dela 30; 150 kg, R$ 450 → S2 20 × 3 = 60 → 130 kg, R$ 390.
    ok(await excluirSaida(x, s1));
    assert.deepEqual(valores(await mov(ma)), ['3.0000', '30.0000', '150.0000', '160.0000']);
    assert.deepEqual(valores(await mov(me)), ['3.0000', '30.0000', '160.0000', '150.0000']);
    assert.deepEqual(valores(await mov(m2)), ['3.0000', '60.0000', '150.0000', '130.0000']);
    assert.deepEqual(await poco(x, x.ureia), ['130.0000', '390.0000']);
    const camada = await camadaDe(ma);
    assert.deepEqual([v4(camada.quantidade_disponivel), v4(camada.custo_unitario), camada.status], ['0.0000', '3.0000', 'Estornado'], 'a camada estornada guarda o custo com que nasceu (o médio novo)');
    assert.deepEqual(linha(await itemDoAjuste(a.itens[0].id)), ['SOBRA', '100.0000', '110.0000', '10.0000', '3.0000', '30.0000', false]);
    const t = await prisma().auditLog.findMany({ where: { cliente_id: x.c, acao: 'estoque.recalculo', entidade: 'AjusteEstoqueItem', entidade_id: a.itens[0].id } });
    assert.deepEqual(t.map((e) => [e.dados_anteriores.custo_unitario, e.dados_novos.custo_unitario, e.dados_anteriores.valor_total, e.dados_novos.valor_total]), [['3.5000', '3.0000', '35.0000', '30.0000']]);
    await provarReplay(x, x.ureia);
  });

  test('(e8) contagem em B ANTES de a transferência levar a cascata a B: excluir S1 em A passa; a transferência e B são recalculados; o ajuste não muda', async () => {
    const x = await cenario();
    const A = x.galpao;
    const B = x.barracao;
    await entrar(x, x.ureia, '100', '2', A);
    await entrar(x, x.ureia, '10', '4', B);
    const s1 = await sair(x, x.ureia, '50', A); // A: 50 a 2
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: B.id, quantidade_contada: '12' }]); // B: sobra 2 × 4 = 8 → 12 kg, R$ 48
    await entrar(x, x.ureia, '50', '5', A); // A: 100 kg, R$ 350, médio 3,50
    const t = await transferir(x, x.ureia, A, B, '40'); // 40 × 3,50 = 140 → B 52 kg, R$ 188
    assert.deepEqual(valores(await mov(t.s.id)).slice(0, 2), ['3.5000', '140.0000']);
    await provarReplay(x, x.ureia);
    // Sem S1: A 150 kg a 3 → T 40 × 3 = 120 → B 52 kg, R$ 168 (médio 3,2308; as camadas de B a 3,2308 somam 168,0016).
    ok(await excluirSaida(x, s1));
    assert.deepEqual(valores(await mov(t.s.id)), ['3.0000', '120.0000', '150.0000', '110.0000']);
    assert.deepEqual(await poco(x, x.ureia, B), ['52.0000', '168.0016'], 'B reavaliado a 168 ÷ 52 = 3,2308');
    assert.deepEqual(valores(await mov(a.itens[0].movimentacao_estoque_id)), ['4.0000', '8.0000', '10.0000', '12.0000']);
    assert.deepEqual(linha(await itemDoAjuste(a.itens[0].id)), ['SOBRA', '10.0000', '12.0000', '2.0000', '4.0000', '8.0000', false]);
    await provarReplay(x, x.ureia);
  });
});

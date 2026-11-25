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
 * D-PROD-313 (só o último): com registro posterior que ainda vale no depósito do movimento, a exclusão é recusada antes
 * (409 `ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR`); exclui-se do mais recente para o mais antigo.
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
/** D-PROD-313 — a exclusão de S1 é recusada pelo registro posterior que ainda vale (o mais recente); nada gravado. */
const exigirRecusaPorPosterior = async (x, s1, posteriores, deposito = x.galpao) => {
  const antes = await foto(x);
  const r = await excluirSaida(x, s1);
  assert.equal(r.statusCode, 409, r.body);
  const b = r.json();
  assert.deepEqual([b.code, b.reason, b.details?.local_estoque_id], ['ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior', deposito.id], r.body);
  assert.ok(posteriores.includes(b.details?.posterior_id), r.body);
  assert.equal(await foto(x), antes, 'nada foi gravado');
  const p = ok(await previa(x, s1.itens[0].movimentacao_estoque_id));
  assert.deepEqual([p.permitido, p.modo, p.recusa?.code, p.recusa?.reason], [false, null, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior']);
  assert.ok(posteriores.includes(p.recusa?.posterior_id), JSON.stringify(p.recusa));
};
const excluirEntrada = async (x, a) =>
  ok(await chamar('POST', `/estoque/entradas/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: a.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` }));
const cancelarTransferencia = async (x, id) =>
  ok(await chamar('POST', `/movimentacoes-estoque/${id}/cancelar-transferencia`, x.token, { empresa_id: x.e.id, motivo: 'transferida errado', operation_id: `ct-${randomUUID()}` }));
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

  test('(e5) cascata: S1 em A, transferência A→B, contagem em B depois dela → D-PROD-313: 409 registro posterior (a transferência em A), nada gravado', async () => {
    const x = await cenario();
    const A = x.galpao;
    const B = x.barracao;
    await entrar(x, x.ureia, '100', '2', A);
    const s1 = await sair(x, x.ureia, '50', A);
    await entrar(x, x.ureia, '50', '5', A); // A: 100 kg a 3,50
    const t = await transferir(x, x.ureia, A, B, '40'); // B: 40 a 3,50
    await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: B.id, quantidade_contada: '45' }]); // sobra 5 a 3,50 em B
    // D-PROD-313: a recusa pela contagem em B (achada pela cascata) agora é precedida pela do registro posterior: a
    // cascata só chega a B por uma transferência depois de S1, e ela ainda vale no depósito A
    await exigirRecusaPorPosterior(x, s1, [t.s.id, t.r.id], A);
    await provarReplay(x, x.ureia);
  });
});

describe('D-PROD-273 × D-PROD-272 — ajuste que NÃO recusa: anterior ao excluído, já excluído, ou no destino antes da cascata', () => {
  test('(e6) ajuste ANTERIOR (entradas → ajuste → S1 → entrada → S2): D-PROD-313: excluir S1 → 409 registro posterior (S2); exclui-se S2, a entrada e S1, do mais recente ao mais antigo; o ajuste não muda', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    await entrar(x, x.ureia, '50', '5'); // 150 kg, R$ 450, médio 3
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '160' }]); // sobra 10 a 3 = 30
    const s1 = await sair(x, x.ureia, '40'); // 40 × 3 = 120 → 120 kg a 3 (R$ 360)
    const e3 = await entrar(x, x.ureia, '40', '7'); // 160 kg, R$ 640, médio 4
    const s2 = await sair(x, x.ureia, '20'); // 20 × 4 = 80
    const m2 = s2.itens[0].movimentacao_estoque_id;
    assert.deepEqual(valores(await mov(m2)), ['4.0000', '80.0000', '160.0000', '140.0000']);
    await provarReplay(x, x.ureia);
    // S2 é o registro mais recente que ainda vale: a exclusão de S1 é recusada por ele, nada gravado
    await exigirRecusaPorPosterior(x, s1, [m2]);
    // do mais recente para o mais antigo: S2, a entrada de 40 a 7 e então S1; o ajuste anterior não recusa nada
    ok(await excluirSaida(x, s2));
    await excluirEntrada(x, e3);
    const r = ok(await excluirSaida(x, s1));
    assert.equal(r.status, 'EXCLUIDA', JSON.stringify(r).slice(0, 300));
    // sem S1, a entrada e S2: 160 kg a 3 (R$ 480), como depois do ajuste
    assert.deepEqual(await poco(x, x.ureia), ['160.0000', '480.0000']);
    assert.deepEqual(valores(await mov(a.itens[0].movimentacao_estoque_id)), ['3.0000', '30.0000', '150.0000', '160.0000']);
    assert.deepEqual(linha(await itemDoAjuste(a.itens[0].id)), ['SOBRA', '150.0000', '160.0000', '10.0000', '3.0000', '30.0000', false]);
    await provarReplay(x, x.ureia);
  });

  test('(e7) ajuste JÁ EXCLUÍDO depois de S1 (a contagem não vale mais): D-PROD-313: o par do ajuste não prende S1, só S2 e a entrada (que saem antes); os pares já excluídos saem da sequência com o movimento, marcados e com o valor gravado; a linha do ajuste excluído não muda', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    const s1 = await sair(x, x.ureia, '50');
    const e2 = await entrar(x, x.ureia, '50', '5'); // 100 kg a 3,50
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, quantidade_contada: '110' }]); // sobra 10 × 3,50 = 35
    const b = await excluirAjuste(x, a);
    const ma = a.itens[0].movimentacao_estoque_id;
    const me = b.itens[0].movimentacao_estorno_id;
    const s2 = await sair(x, x.ureia, '20'); // 100 kg a 3,50 → 20 × 3,50 = 70
    const m2 = s2.itens[0].movimentacao_estoque_id;
    assert.deepEqual(valores(await mov(m2)), ['3.5000', '70.0000', '100.0000', '80.0000']);
    await provarReplay(x, x.ureia);
    // S2 e a entrada E2 ainda valem depois de S1: recusa pelo mais recente (S2), nada gravado
    await exigirRecusaPorPosterior(x, s1, [m2]);
    ok(await excluirSaida(x, s2));
    // com S2 fora, a entrada E2 é o mais recente que vale: S1 continua presa (o par do ajuste não conta)
    await exigirRecusaPorPosterior(x, s1, [e2.itens[0].movimentacao_estoque_id]);
    // Sem E2: o par do ajuste e o de S2 (já excluídos, depois dela) saem da sequência com ela, marcados, com o valor
    // gravado; fica E1 100 a 2 − S1 50 = 50 kg a 2.
    await excluirEntrada(x, e2);
    const gravados = [['3.5000', '35.0000', '100.0000', '110.0000'], ['3.5000', '35.0000', '110.0000', '100.0000'], ['3.5000', '70.0000', '100.0000', '80.0000']];
    assert.deepEqual([valores(await mov(ma)), valores(await mov(me)), valores(await mov(m2))], gravados);
    for (const id of [ma, me, m2]) assert.match(String((await mov(id)).movimentacao_grupo_id), /^exclusao_recalculo:/, id);
    assert.deepEqual(await poco(x, x.ureia), ['50.0000', '100.0000']);
    // Sem S1 (só pares marcados depois): 100 kg a 2; os pares continuam com o gravado.
    ok(await excluirSaida(x, s1));
    assert.deepEqual([valores(await mov(ma)), valores(await mov(me)), valores(await mov(m2))], gravados);
    assert.deepEqual(await poco(x, x.ureia), ['100.0000', '200.0000']);
    const camada = await camadaDe(ma);
    assert.deepEqual([v4(camada.quantidade_disponivel), v4(camada.custo_unitario), camada.status], ['0.0000', '3.5000', 'Estornado'], 'a camada estornada guarda o custo com que nasceu');
    assert.deepEqual(linha(await itemDoAjuste(a.itens[0].id)), ['SOBRA', '100.0000', '110.0000', '10.0000', '3.5000', '35.0000', false]);
    const t = await prisma().auditLog.findMany({ where: { cliente_id: x.c, acao: 'estoque.recalculo', entidade: 'AjusteEstoqueItem', entidade_id: a.itens[0].id } });
    assert.deepEqual(t, [], 'a linha do ajuste excluído não é reescrita');
    await provarReplay(x, x.ureia);
  });

  test('(e8) contagem em B ANTES da transferência A→B: D-PROD-313: excluir S1 em A → 409 registro posterior (a transferência); cancela-se a transferência e a entrada em A, e S1 sai; a contagem em B não recusa nem muda', async () => {
    const x = await cenario();
    const A = x.galpao;
    const B = x.barracao;
    await entrar(x, x.ureia, '100', '2', A);
    await entrar(x, x.ureia, '10', '4', B);
    const s1 = await sair(x, x.ureia, '50', A); // A: 50 a 2
    const a = await ajustar(x, [{ produto_id: x.ureia.id, local_estoque_id: B.id, quantidade_contada: '12' }]); // B: sobra 2 × 4 = 8 → 12 kg, R$ 48
    const e3 = await entrar(x, x.ureia, '50', '5', A); // A: 100 kg, R$ 350, médio 3,50
    const t = await transferir(x, x.ureia, A, B, '40'); // 40 × 3,50 = 140 → B 52 kg, R$ 188
    assert.deepEqual(valores(await mov(t.s.id)).slice(0, 2), ['3.5000', '140.0000']);
    await provarReplay(x, x.ureia);
    // a transferência depois de S1, no depósito A, ainda vale: recusa por ela, nada gravado
    await exigirRecusaPorPosterior(x, s1, [t.s.id, t.r.id], A);
    // do mais recente para o mais antigo: a transferência (B volta a 12 kg, R$ 48), a entrada em A e então S1
    // (as camadas de B, reavaliadas na chegada a 188 ÷ 52 = 3,6154 e na volta a 48,0008 ÷ 12 = 4,0001, somam 48,0012)
    await cancelarTransferencia(x, t.s.id);
    assert.deepEqual(await poco(x, x.ureia, B), ['12.0000', '48.0012']);
    await excluirEntrada(x, e3);
    ok(await excluirSaida(x, s1));
    assert.deepEqual(await poco(x, x.ureia, A), ['100.0000', '200.0000']);
    // a quantidade de B não muda; o valor volta aos 48 contados (a transferência cancelada sai da sequência com a entrada em A)
    assert.deepEqual(await poco(x, x.ureia, B), ['12.0000', '48.0000'], 'S1 em A não toca B');
    assert.deepEqual(valores(await mov(a.itens[0].movimentacao_estoque_id)), ['4.0000', '8.0000', '10.0000', '12.0000']);
    assert.deepEqual(linha(await itemDoAjuste(a.itens[0].id)), ['SOBRA', '10.0000', '12.0000', '2.0000', '4.0000', '8.0000', false]);
    await provarReplay(x, x.ureia);
  });
});

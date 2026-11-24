/**
 * D-PROD-285 — unidades de conversão no cadastro do produto (MULTIPLICA/DIVIDE), a conversão nos lançamentos (entrada
 * documentada, saída manual, ajuste, compra e venda do financeiro), o passado intocado ao editar/desativar, a cópia
 * da migration (peso_por_saco_kg → SACO e consumo → formulação) e os campos que saíram da tela do produto. Tudo
 * contra PostgreSQL real e HTTP autenticado; o tenant vem sempre do auth_context.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { acoes, docCom, montarTenant } from './gestaoP3Cenario.mjs';
import { MIGRATIONS_CONTRACT_APROVADAS } from '../../scripts/deploy/premergeMigrateLib.mjs';
import { converterQuantidade, equivalencia, fatorEfetivo, resolverUnidade } from '../src/modules/produtos/produtoUnidadesConversao.js';

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
const razao = (r) => r.json().reason ?? r.json().details?.reason;
const hoje = () => new Date().toISOString().slice(0, 10);
let seq = 0;
const local = (c, nome) => prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome } });

const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const galpao = await local(c, 'Galpão');
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  const token = corpo.token;
  const compra = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items.find((m) => m.nome === 'Compra').id;
  const perda = (await chamar('GET', '/estoque/motivos-saida', token)).json().items.find((m) => m.nome === 'Perda').id;
  return { c, e, galpao, token, compra, perda };
};

const SACO25 = { sigla: 'SACO', operacao: 'MULTIPLICA', fator: 25 };
const GRAMA = { sigla: 'G', operacao: 'DIVIDE', fator: 1000 };
const criarProduto = async (x, corpo) => {
  const r = await chamar('POST', '/produtos', x.token, { empresa_id: x.e.id, ...corpo });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const entrar = (x, p, unidade, quantidade, custo) => chamar('POST', '/estoque/entradas', x.token, {
  empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
  itens: [{ produto_id: p.id, local_estoque_id: x.galpao.id, unidade, quantidade, custo_unitario: custo }],
});
const sair = (x, p, unidade, quantidade) => chamar('POST', '/estoque/saidas', x.token, {
  empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
  itens: [{ produto_id: p.id, local_estoque_id: x.galpao.id, unidade, quantidade }],
});
const estoqueAtual = async (p) => (await prisma().produto.findUnique({ where: { id: p.id } })).estoque_atual.toFixed(4);

describe('D-PROD-285 — o motor da conversão (puro)', () => {
  test('MULTIPLICA e DIVIDE, 4 casas, fator efetivo e a frase da equivalência', () => {
    const saco = { sigla: 'SACO', operacao: 'MULTIPLICA', fator: '25' };
    const g = { sigla: 'G', operacao: 'DIVIDE', fator: '1000' };
    const terco = { sigla: 'T', operacao: 'DIVIDE', fator: '3' };
    assert.equal(converterQuantidade('10', saco).toFixed(4), '250.0000');
    assert.equal(converterQuantidade('1', g).toFixed(4), '0.0010');
    assert.equal(converterQuantidade('2', terco).toFixed(4), '0.6667', 'ROUND_HALF_UP uma vez, pela operação exata');
    assert.equal(converterQuantidade('0.00004', g).toFixed(4), '0.0000');
    assert.equal(fatorEfetivo(g).toFixed(4), '0.0010');
    assert.equal(fatorEfetivo(terco).toFixed(4), '0.3333');
    assert.equal(equivalencia(saco, 'KG'), '1 SACO = 25 KG');
    assert.equal(equivalencia(g, 'KG'), '1 G = 0,001 KG');
    assert.equal(equivalencia({ sigla: 'GL 20', operacao: 'MULTIPLICA', fator: '20' }, 'L'), '1 GL 20 = 20 L');
    const erro = (reason) => Object.assign(new Error(reason), { reason });
    const produto = { unidade_principal_estoque: 'KG', unidadesConversao: [{ ...saco, ativa: true, uso_compra: true, uso_venda: false }] };
    assert.equal(resolverUnidade(produto, 'SACO', { uso: 'compra', erro }).quantidadeEstoque('2').toFixed(4), '50.0000');
    assert.throws(() => resolverUnidade(produto, 'SACO', { uso: 'venda', erro }), { reason: 'unidade_sem_uso' });
    assert.throws(() => resolverUnidade(produto, 'L', { erro }), { reason: 'unidade_incompativel' });
    assert.throws(() => resolverUnidade(produto, 'GL', { erro }), { reason: 'unidade_nao_cadastrada' });
  });
});

describe('D-PROD-285 — cadastro: unidades de conversão dentro do POST/PATCH do produto', () => {
  test('POST com SACO ×25 e G ÷1000: devolve as unidades com a equivalência; código interno = número; preços e local ignorados', async () => {
    const x = await cenario();
    const p = await criarProduto(x, {
      nome_produto: 'Sal', codigo_interno: 'XPTO', preco_custo: 9, preco_venda: 12, local_estoque: 'GALPAO',
      unidades_conversao: [SACO25, { ...GRAMA, uso_compra: false, codigo_barras: '789' }],
    });
    assert.equal(p.codigo_interno, p.numero_produto, 'código interno automático, igual ao número');
    assert.deepEqual([p.preco_custo, p.preco_venda, p.local_estoque, p.unidade_estoque], [null, null, null, 'KG']);
    assert.deepEqual(p.unidades_conversao.map((u) => [u.sigla, u.operacao, u.fator, u.uso_compra, u.uso_venda, u.codigo_barras, u.ativa, u.equivalencia]), [
      ['SACO', 'MULTIPLICA', '25.000000', true, true, null, true, '1 SACO = 25 KG'],
      ['G', 'DIVIDE', '1000.000000', false, true, '789', true, '1 G = 0,001 KG'],
    ]);
    const lista = (await chamar('GET', `/produtos?empresa_id=${x.e.id}`, x.token)).json();
    assert.equal(lista[0].unidades_conversao.length, 2, 'o GET do produto traz as unidades');
    // PATCH tentando trocar o código interno: ignorado.
    const r = await chamar('PATCH', `/produtos/${p.id}`, x.token, { codigo_interno: 'OUTRO', preco_custo: 1 });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().codigo_interno, r.json().preco_custo], [p.numero_produto, null]);
  });

  test('recusas: unidade igual à de estoque, reservada, repetida, operação, fator ≤ 0, divide > 10000, sem uso — nada gravado', async () => {
    const x = await cenario();
    const casos = [
      [{ sigla: 'KG', operacao: 'MULTIPLICA', fator: 1 }, 'sigla_igual_principal'],
      [{ sigla: 'UN', operacao: 'MULTIPLICA', fator: 1 }, 'sigla_reservada'],
      [{ sigla: 'L', operacao: 'MULTIPLICA', fator: 1 }, 'sigla_reservada'],
      [{ sigla: 'X', operacao: 'MULTIPLICA', fator: 0 }, 'fator_invalido'],
      [{ sigla: 'X', operacao: 'DIVIDE', fator: 20000 }, 'fator_divide_alto'],
      [{ sigla: 'X', operacao: 'MULTIPLICA', fator: 2, uso_compra: false, uso_venda: false }, 'sem_uso'],
      [{ sigla: 'MUITO LONGA', operacao: 'MULTIPLICA', fator: 2 }, 'sigla_longa'],
    ];
    for (const [u, reason] of casos) {
      const r = await chamar('POST', '/produtos', x.token, { empresa_id: x.e.id, nome_produto: `P ${reason} ${u.sigla}`, unidades_conversao: [u] });
      assert.deepEqual([r.statusCode, razao(r)], [400, reason], `${u.sigla}: ${r.body}`);
    }
    const rep = await chamar('POST', '/produtos', x.token, { empresa_id: x.e.id, nome_produto: 'REP', unidades_conversao: [SACO25, { ...SACO25, sigla: 'saco' }] });
    assert.deepEqual([rep.statusCode, razao(rep)], [400, 'sigla_repetida']);
    // Produto em litros: a unidade alternativa não pode ser L (a própria unidade de estoque).
    const litros = await chamar('POST', '/produtos', x.token, { empresa_id: x.e.id, nome_produto: 'DIESEL', unidade_principal_estoque: 'L', unidades_conversao: [{ sigla: 'L', operacao: 'MULTIPLICA', fator: 1 }] });
    assert.deepEqual([litros.statusCode, razao(litros)], [400, 'sigla_igual_principal']);
    assert.equal(await prisma().produto.count({ where: { cliente_id: x.c } }), 0);
    assert.equal(await prisma().produtoUnidadeConversao.count({ where: { cliente_id: x.c } }), 0);
  });
});

describe('D-PROD-285 — lançamentos convertem para a unidade de estoque; o passado não muda', () => {
  test('entrada em SACO e em G, saída em SACO, ajuste em SACO: quantidade de estoque em 4 casas, custo por kg; reconciliação limpa', async () => {
    const x = await cenario();
    const p = await criarProduto(x, { nome_produto: 'Sal', unidades_conversao: [SACO25, GRAMA] });
    const e1 = await entrar(x, p, 'SACO', '10', '100');
    assert.equal(e1.statusCode, 201, e1.body);
    const i1 = e1.json().itens[0];
    assert.deepEqual([i1.unidade, i1.quantidade, i1.fator_kg, i1.quantidade_estoque, i1.custo_kg], ['SACO', '10.0000', '25.0000', '250.0000', '4.0000']);
    const e2 = await entrar(x, p, 'G', '500', '0.004');
    assert.equal(e2.statusCode, 201, e2.body);
    const i2 = e2.json().itens[0];
    assert.deepEqual([i2.unidade, i2.fator_kg, i2.quantidade_estoque, i2.custo_kg], ['G', '0.0010', '0.5000', '4.0000']);
    assert.equal(await estoqueAtual(p), '250.5000');
    const s = await sair(x, p, 'SACO', '2');
    assert.equal(s.statusCode, 201, s.body);
    assert.deepEqual([s.json().itens[0].quantidade_estoque, s.json().itens[0].custo_unitario], ['50.0000', '4.0000'], 'custo médio inalterado (D-PROD-256)');
    assert.equal(await estoqueAtual(p), '200.5000');
    const a = await chamar('POST', '/estoque/ajustes', x.token, {
      empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, itens: [{ produto_id: p.id, local_estoque_id: x.galpao.id, unidade: 'SACO', quantidade_contada: '8' }],
    });
    assert.equal(a.statusCode, 201, a.body);
    assert.deepEqual([a.json().itens[0].contado_estoque, a.json().itens[0].tipo], ['200.0000', 'FALTA']);
    assert.equal(await estoqueAtual(p), '200.0000');
    const rec = await chamar('GET', `/estoque-fisico/reconciliacao?empresa_id=${x.e.id}`, x.token);
    assert.deepEqual(rec.json().achados, [], rec.body.slice(0, 600));
  });

  test('editar o fator não altera lançamento gravado; unidade usada sai da lista → desativada (não apagada); sem uso → exclusão lógica; desativada não lança', async () => {
    const x = await cenario();
    const p = await criarProduto(x, { nome_produto: 'Sal', unidades_conversao: [SACO25, { sigla: 'SC 50', operacao: 'MULTIPLICA', fator: 50 }] });
    const e1 = await entrar(x, p, 'SACO', '4', '100');
    assert.equal(e1.statusCode, 201, e1.body);
    const antes = await prisma().entradaEstoqueItem.findFirst({ where: { cliente_id: x.c, produto_id: p.id } });
    const conv = p.unidades_conversao;
    const r = await chamar('PATCH', `/produtos/${p.id}`, x.token, { unidades_conversao: [{ id: conv[0].id, sigla: 'SACO', operacao: 'MULTIPLICA', fator: 30 }] });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().unidades_conversao.map((u) => [u.sigla, u.fator, u.ativa]), [['SACO', '30.000000', true]], 'SC 50 nunca usada: some (exclusão lógica)');
    const depois = await prisma().entradaEstoqueItem.findFirst({ where: { cliente_id: x.c, produto_id: p.id } });
    assert.deepEqual([depois.fator_kg.toFixed(4), depois.quantidade_estoque.toFixed(4)], [antes.fator_kg.toFixed(4), '100.0000'], 'o passado continua com 25');
    const sc50 = await prisma().produtoUnidadeConversao.findFirst({ where: { cliente_id: x.c, produto_id: p.id, sigla: 'SC 50' } });
    assert.ok(sc50.excluido_em, 'exclusão lógica, a linha continua no banco');
    // Tira o SACO (usado): fica desativado, não excluído.
    const r2 = await chamar('PATCH', `/produtos/${p.id}`, x.token, { unidades_conversao: [] });
    assert.deepEqual(r2.json().unidades_conversao.map((u) => [u.sigla, u.ativa]), [['SACO', false]]);
    const s = await sair(x, p, 'SACO', '1');
    assert.deepEqual([s.statusCode, razao(s)], [422, 'unidade_inativa'], s.body);
    // Recriar a sigla excluída é permitido (o único é parcial: só entre as não excluídas).
    const r3 = await chamar('PATCH', `/produtos/${p.id}`, x.token, { unidades_conversao: [{ sigla: 'SACO', operacao: 'MULTIPLICA', fator: 30 }, { sigla: 'SC 50', operacao: 'MULTIPLICA', fator: 50 }] });
    assert.equal(r3.statusCode, 200, r3.body);
    assert.deepEqual(r3.json().unidades_conversao.map((u) => [u.sigla, u.ativa]).sort(), [['SACO', true], ['SC 50', true]]);
    assert.equal(await prisma().produtoUnidadeConversao.count({ where: { cliente_id: x.c, produto_id: p.id, sigla: 'SC 50' } }), 2);
  });

  test('uso: unidade só de saída é recusada na entrada; L ↔ KG recusado; outra empresa/tenant não enxerga', async () => {
    const x = await cenario();
    const p = await criarProduto(x, { nome_produto: 'Sal', unidades_conversao: [{ ...SACO25, uso_compra: false }] });
    const r = await entrar(x, p, 'SACO', '1', '10');
    assert.deepEqual([r.statusCode, razao(r)], [422, 'unidade_sem_uso'], r.body);
    const l = await entrar(x, p, 'L', '1', '10');
    assert.deepEqual([l.statusCode, razao(l)], [422, 'unidade_incompativel'], l.body);
    const diesel = await criarProduto(x, { nome_produto: 'Diesel', unidade_principal_estoque: 'L', unidades_conversao: [{ sigla: 'GL 20', operacao: 'MULTIPLICA', fator: 20 }] });
    const g = await entrar(x, diesel, 'GL 20', '3', '120');
    assert.equal(g.statusCode, 201, g.body);
    assert.deepEqual([g.json().itens[0].quantidade_estoque, g.json().itens[0].custo_kg], ['60.0000', '6.0000']);
    const outro = await cenario();
    const alheio = await chamar('PATCH', `/produtos/${p.id}`, outro.token, { unidades_conversao: [] });
    assert.equal(alheio.statusCode, 404);
  });

  test('compra e venda do financeiro em SACO (conversão de produto KG) e em G: fator efetivo e kg gravados no item', async () => {
    const t = await montarTenant(app);
    const A = acoes(app);
    const e = t.e1;
    const r = await A.ok(A.req('PATCH', `/produtos/${e.sal.id}`, t.token, { unidades_conversao: [SACO25, GRAMA] }));
    assert.equal(r.unidades_conversao.length, 2);
    const compra = await A.criarConfirmar(t.token, docCom(e, t.local, [{ produto: e.sal, unidade: 'SACO', quantidade: '4', valor_unitario: '100' }]));
    const item = (await prisma().operacaoFinanceiraItem.findMany({ where: { cliente_id: t.c, operacao_id: compra.id } }))[0];
    assert.deepEqual([item.unidade, item.fator_kg.toFixed(4), item.quantidade_estoque.toFixed(4)], ['SACO', '25.0000', '100.0000']);
    const venda = await A.criarConfirmar(t.token, docCom(e, t.local, [{ produto: e.sal, unidade: 'G', quantidade: '2000', valor_unitario: '0.01' }], { direcao: 'RECEBER' }));
    const iv = (await prisma().operacaoFinanceiraItem.findMany({ where: { cliente_id: t.c, operacao_id: venda.id } }))[0];
    assert.deepEqual([iv.unidade, iv.fator_kg.toFixed(4), iv.quantidade_estoque.toFixed(4)], ['G', '0.0010', '2.0000']);
    const mov = await prisma().movimentacaoEstoque.findUnique({ where: { id: iv.movimentacao_estoque_id } });
    assert.deepEqual([mov.quantidade.toFixed(4), mov.valor_unitario.toFixed(4)], ['2.0000', '4.0000'], 'custo médio de 4/kg (400 ÷ 100 kg)');
  });
});

describe('D-PROD-285 — a cópia da migration (texto pinado) e a Formulação com o consumo', () => {
  test('INSERT do peso_por_saco_kg → SACO multiplica (fora os de litros) e UPDATE do consumo mínimo/máximo na formulação', async () => {
    const x = await cenario();
    const base = { cliente_id: x.c, empresa_id: x.e.id };
    const comPeso = await prisma().produto.create({ data: { ...base, numero_produto: '901', nome_produto: 'RACAO', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30', consumo_minimo_pv: '0.05', consumo_maximo_pv: '0.2' } });
    const semPeso = await prisma().produto.create({ data: { ...base, numero_produto: '902', nome_produto: 'UREIA' } });
    const litros = await prisma().produto.create({ data: { ...base, numero_produto: '903', nome_produto: 'OLEO', unidade_principal_estoque: 'L', peso_por_saco_kg: '5' } });
    const f = await prisma().formulacao.create({ data: { ...base, nome: 'F1', tipo: 'PRONTO', produto_id: comPeso.id, base_consumo: 'PV', percentual_pv_padrao: '0.1' } });
    const k = MIGRATIONS_CONTRACT_APROVADAS['20261124300000_produto_unidades_conversao'];
    const sql = readFileSync(new URL('../prisma/migrations/20261124300000_produto_unidades_conversao/migration.sql', import.meta.url), 'utf8');
    for (const instr of k.conversao) {
      assert.ok(sql.replace(/\s+/g, ' ').includes(instr), 'o texto pinado é o do arquivo');
      await prisma().$executeRawUnsafe(instr);
    }
    const convs = await prisma().produtoUnidadeConversao.findMany({ where: { cliente_id: x.c } });
    assert.deepEqual(convs.map((c) => [c.produto_id, c.sigla, c.operacao, c.fator.toFixed(4), c.id]), [[comPeso.id, 'SACO', 'MULTIPLICA', '30.0000', `puc_${comPeso.id}`]]);
    assert.ok(![semPeso.id, litros.id].includes(convs[0].produto_id));
    const fd = await prisma().formulacao.findUnique({ where: { id: f.id } });
    assert.deepEqual([fd.consumo_minimo_pv.toFixed(2), fd.consumo_maximo_pv.toFixed(2)], ['0.05', '0.20']);
    // A formulação expõe e edita o consumo (a tela do produto não tem mais esses campos).
    const g = await chamar('PATCH', `/formulacoes/${f.id}`, x.token, { empresa_id: x.e.id, consumo_minimo_pv: '0.08', consumo_maximo_pv: '0.25' });
    assert.equal(g.statusCode, 200, g.body);
    assert.deepEqual([g.json().consumo_minimo_pv, g.json().consumo_maximo_pv], [0.08, 0.25]);
    // O SACO legado (produto em SACO) segue convertendo pela conversão nova: 2 sacos = 60 kg.
    const e1 = await entrar(x, comPeso, 'SACO', '2', '90');
    assert.equal(e1.statusCode, 201, e1.body);
    assert.equal(e1.json().itens[0].quantidade_estoque, '60.0000');
  });
});

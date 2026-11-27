/**
 * D-PROD-369 (UE-1) — o estoque na unidade do cadastro do produto (emenda aprovada pelo proprietário em 2026-11-27).
 *
 *  U1. a unidade de estoque é KG, L ou uma sigla ATIVA do cadastro de Unidades do próprio tenant (SC, UN...); fora
 *      disso (e SACO novo) → 400 `unidade_invalida`, nada gravado; só a Unidade de Medida no corpo → ela é a unidade
 *      de estoque;
 *  U2. produto em SC com a conversão "1 KG = 0,04 SC" (KG divide 25): a entrada em KG vira SC; o saldo, o custo e o
 *      rótulo do movimento ficam em SC; a saída na própria unidade não converte;
 *  U3. trocar a unidade de estoque com histórico → 409 `PRODUTO_UNIDADE_EM_USO` (estoque, lotes, movimentos e
 *      lançamentos, nessa ordem); sem histórico troca; KG ↔ SACO legado continua passando;
 *  U4. conversões: KG num produto em L e L num produto em KG → `conversao_kg_l`; UN, KG e L valem onde não cruzam;
 *  U5. trava até a UE-3: o cocho recusa produto com estoque fora de KG (422 `unidade_sem_peso`), sem gravar nada.
 * PostgreSQL real, HTTP autenticado; o tenant vem sempre do auth_context.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { resolverUnidade, unidadeEstoqueEfetiva } from '../src/modules/produtos/produtoUnidadesConversao.js';
import { acoes, docCom, montarTenant } from './gestaoP3Cenario.mjs';

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
const corpo = (r) => r.json();
const razao = (r) => corpo(r).reason ?? corpo(r).details?.reason;
const codigo = (r) => corpo(r).code;
const hoje = () => new Date().toISOString().slice(0, 10);
let seq = 0;

const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const galpao = await prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 7000), nome: 'Galpão' } });
  const token = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const compra = corpo(await chamar('GET', '/estoque/motivos-entrada', token)).items.find((m) => m.nome === 'Compra').id;
  const perda = corpo(await chamar('GET', '/estoque/motivos-saida', token)).items.find((m) => m.nome === 'Perda').id;
  return { c, e, galpao, token, compra, perda };
};
/** Unidade do cadastro de Unidades do tenant (direto no banco, como o cadastro grava: sigla em maiúsculas). */
const unidadeMedida = (x, sigla, ativo = true) =>
  prisma().unidadeMedida.create({ data: { cliente_id: x.c, numero_unidade: String(++seq + 100), sigla, descricao: `UNIDADE ${sigla}`, ativo } });
const criar = (x, dados) => chamar('POST', '/produtos', x.token, { empresa_id: x.e.id, nome_produto: `PRODUTO ${++seq}`, ...dados });
const criarOk = async (x, dados) => {
  const r = await criar(x, dados);
  assert.equal(r.statusCode, 201, r.body);
  return corpo(r);
};
const entrar = (x, p, unidade, quantidade, custo) => chamar('POST', '/estoque/entradas', x.token, {
  empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
  itens: [{ produto_id: p.id, local_estoque_id: x.galpao.id, unidade, quantidade, custo_unitario: custo }],
});
const sair = (x, p, unidade, quantidade) => chamar('POST', '/estoque/saidas', x.token, {
  empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
  itens: [{ produto_id: p.id, local_estoque_id: x.galpao.id, unidade, quantidade }],
});
const lido = (p) => prisma().produto.findUnique({ where: { id: p.id } });
/** "1 KG = 0,04 SC": KG divide 25. */
const KG_EM_SC = { sigla: 'KG', operacao: 'DIVIDE', fator: 25 };
/** Fotografia do que o tenant tem gravado (para "nada foi gravado"). */
const foto = async (c) => JSON.stringify(await Promise.all([
  prisma().produto.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
  prisma().produtoUnidadeConversao.count({ where: { cliente_id: c } }),
  prisma().movimentacaoEstoque.count({ where: { cliente_id: c } }),
  prisma().auditLog.count({ where: { cliente_id: c } }),
]));

describe('U0 — o motor (puro)', () => {
  test('unidadeEstoqueEfetiva: a sigla real; SACO legado e vazio são KG; resolverUnidade só recusa KG ↔ L', () => {
    assert.deepEqual(['KG', 'L', 'SC', 'UN', 'SACO', '', null, ' sc '].map((u) => unidadeEstoqueEfetiva({ unidade_principal_estoque: u })), ['KG', 'L', 'SC', 'UN', 'KG', 'KG', 'KG', 'SC']);
    const erro = (reason) => Object.assign(new Error(reason), { reason });
    const sc = { unidade_principal_estoque: 'SC', unidadesConversao: [{ sigla: 'KG', operacao: 'DIVIDE', fator: '25', ativa: true }] };
    assert.equal(resolverUnidade(sc, 'SC', { erro }).fator.toFixed(4), '1.0000', 'a própria unidade de estoque: fator 1');
    const kg = resolverUnidade(sc, 'KG', { erro });
    assert.deepEqual([kg.unidadeEstoque, kg.quantidadeEstoque('50').toFixed(4), kg.fator.toFixed(4)], ['SC', '2.0000', '0.0400']);
    assert.throws(() => resolverUnidade(sc, 'L', { erro }), (e) => e.reason === 'unidade_nao_cadastrada', 'L sem conversão num produto em SC');
    assert.throws(() => resolverUnidade({ unidade_principal_estoque: 'L' }, 'KG', { erro }), (e) => e.reason === 'unidade_incompativel');
    assert.throws(() => resolverUnidade({ unidade_principal_estoque: 'KG' }, 'L', { erro }), (e) => e.reason === 'unidade_incompativel');
  });
});

describe('U1 — o domínio da unidade de estoque é o cadastro de Unidades', () => {
  test('SC do cadastro cria; sigla fora do cadastro, inativa, minúscula, longa ou SACO novo → 400 unidade_invalida, nada gravado', async () => {
    const x = await cenario();
    await unidadeMedida(x, 'SC');
    await unidadeMedida(x, 'CX', false);
    await unidadeMedida(x, 'BALDE20L');
    const p = await criarOk(x, { unidade_medida: 'SC', unidade_principal_estoque: 'SC' });
    assert.deepEqual([p.unidade_principal_estoque, p.unidade_estoque], ['SC', 'SC']);
    const oito = await criarOk(x, { unidade_principal_estoque: 'BALDE20L' });
    assert.equal(oito.unidade_estoque, 'BALDE20L', 'até 8 caracteres');
    for (const ruim of ['GL', 'CX', 'sc', 'SACO']) {
      const antes = await foto(x.c);
      const r = await criar(x, { unidade_principal_estoque: ruim });
      assert.deepEqual([r.statusCode, codigo(r), razao(r)], [400, 'REQUEST_VALIDATION_FAILED', 'unidade_invalida'], `${ruim}: ${r.body}`);
      assert.equal(await foto(x.c), antes, `${ruim}: nada gravado`);
    }
    // A unidade de outro tenant não vale aqui.
    const y = await cenario();
    await unidadeMedida(y, 'TON');
    const alheia = await criar(x, { unidade_principal_estoque: 'TON' });
    assert.deepEqual([alheia.statusCode, razao(alheia)], [400, 'unidade_invalida']);
  });

  test('só a Unidade de Medida no corpo: ela é a unidade de estoque (criação; edição só quando muda)', async () => {
    const x = await cenario();
    await unidadeMedida(x, 'SC');
    await unidadeMedida(x, 'UN');
    const p = await criarOk(x, { unidade_medida: ' sc ' });
    assert.deepEqual([p.unidade_medida, p.unidade_principal_estoque, p.unidade_estoque], ['SC', 'SC', 'SC']);
    const fora = await criar(x, { unidade_medida: 'SACO 50' });
    assert.deepEqual([fora.statusCode, razao(fora)], [400, 'unidade_invalida']);
    // Edição: reenviar a mesma Unidade de Medida não mexe no estoque; trocar, troca (sem histórico).
    const legado = await prisma().produto.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero_produto: `L${++seq}`, nome_produto: `LEGADO ${seq}`, unidade_medida: 'SC', unidade_principal_estoque: 'KG', estoque_atual: '10' } });
    const mesma = await chamar('PATCH', `/produtos/${legado.id}`, x.token, { nome_produto: 'LEGADO RENOMEADO', unidade_medida: 'SC' });
    assert.equal(mesma.statusCode, 200, mesma.body);
    assert.equal((await lido(legado)).unidade_principal_estoque, 'KG', 'a mesma Unidade de Medida: o estoque do produto antigo fica em KG');
    const troca = await chamar('PATCH', `/produtos/${p.id}`, x.token, { unidade_medida: 'UN' });
    assert.equal(troca.statusCode, 200, troca.body);
    assert.deepEqual([corpo(troca).unidade_medida, corpo(troca).unidade_principal_estoque], ['UN', 'UN']);
  });
});

describe('U2 — produto em SC: a entrada em KG converte; saldo, custo e rótulo em SC', () => {
  test('1 KG = 0,04 SC: 500 KG a R$ 2 → 20 SC a R$ 50; o movimento rotulado SC; a saída em SC não converte', async () => {
    const x = await cenario();
    await unidadeMedida(x, 'SC');
    const p = await criarOk(x, { unidade_medida: 'SC', unidade_principal_estoque: 'SC', unidades_conversao: [KG_EM_SC] });
    assert.deepEqual(p.unidades_conversao.map((c) => [c.sigla, c.equivalencia]), [['KG', '1 KG = 0,04 SC']]);
    const e = await entrar(x, p, 'KG', '500', '2');
    assert.equal(e.statusCode, 201, e.body);
    const i = corpo(e).itens[0];
    assert.deepEqual([i.unidade, i.fator_kg, i.quantidade_estoque, i.custo_kg, i.unidade_estoque], ['KG', '0.0400', '20.0000', '50.0000', 'SC']);
    assert.equal((await lido(p)).estoque_atual.toFixed(4), '20.0000');
    const mov = await prisma().movimentacaoEstoque.findFirst({ where: { cliente_id: x.c, produto_id: p.id } });
    assert.deepEqual([mov.unidade_medida, mov.quantidade.toFixed(4)], ['SC', '20.0000'], 'o rótulo é a unidade de estoque real');
    const s = await sair(x, p, 'SC', '5');
    assert.equal(s.statusCode, 201, s.body);
    assert.deepEqual([corpo(s).itens[0].quantidade_estoque, corpo(s).itens[0].unidade_estoque], ['5.0000', 'SC']);
    assert.equal((await lido(p)).estoque_atual.toFixed(4), '15.0000');
    const saldo = await chamar('GET', `/estoque/saldo?empresa_id=${x.e.id}`, x.token);
    assert.equal(saldo.statusCode, 200, saldo.body);
    const linha = corpo(saldo).items.find((it) => it.produto_id === p.id);
    assert.deepEqual([linha?.unidade, linha?.quantidade], ['SC', '15.0000'], saldo.body.slice(0, 400));
    // UN como unidade de estoque também entra e sai (a linha de estoque aceita UN desde a migration desta decisão).
    await unidadeMedida(x, 'UN');
    const brinco = await criarOk(x, { unidade_medida: 'UN', unidade_principal_estoque: 'UN' });
    const eu = await entrar(x, brinco, 'UN', '100', '3');
    assert.equal(eu.statusCode, 201, eu.body);
    assert.equal(corpo(eu).itens[0].quantidade_estoque, '100.0000');
    const rec = await chamar('GET', `/estoque-fisico/reconciliacao?empresa_id=${x.e.id}`, x.token);
    assert.deepEqual(corpo(rec).achados, [], rec.body.slice(0, 600));
  });
});

describe('U3 — trocar a unidade de estoque só sem histórico', () => {
  test('KG → SC: estoque → lotes → movimentos → lançamentos, 409 e nada gravado; sem histórico, troca; SACO → KG com estoque passa', async () => {
    const x = await cenario();
    await unidadeMedida(x, 'SC');
    const espera409 = async (p, reason) => {
      const antes = await foto(x.c);
      const r = await chamar('PATCH', `/produtos/${p.id}`, x.token, { unidade_medida: 'SC', unidade_principal_estoque: 'SC' });
      assert.deepEqual([r.statusCode, codigo(r), razao(r)], [409, 'PRODUTO_UNIDADE_EM_USO', reason], r.body);
      assert.deepEqual([corpo(r).details?.de, corpo(r).details?.para], ['KG', 'SC']);
      assert.equal(await foto(x.c), antes, `${reason}: nada gravado`);
    };
    const comEstoque = await criarOk(x, { unidade_principal_estoque: 'KG' });
    assert.equal((await entrar(x, comEstoque, 'KG', '10', '1')).statusCode, 201);
    await espera409(comEstoque, 'estoque');
    // Esgotado: sem saldo, mas com lote e movimento.
    assert.equal((await sair(x, comEstoque, 'KG', '10')).statusCode, 201);
    await espera409(comEstoque, 'lotes');
    const comMovimento = await criarOk(x, { unidade_principal_estoque: 'KG' });
    await prisma().movimentacaoEstoque.create({
      data: { cliente_id: x.c, empresa_id: x.e.id, numero_movimentacao: `M${++seq}`, tipo_movimentacao: 'Entrada', data_movimentacao: new Date(), produto_id: comMovimento.id, quantidade: '1', unidade_medida: 'KG' },
    });
    await espera409(comMovimento, 'movimentos');
    const novo = await criarOk(x, { unidade_principal_estoque: 'KG' });
    const r = await chamar('PATCH', `/produtos/${novo.id}`, x.token, { unidade_medida: 'SC', unidade_principal_estoque: 'SC' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(corpo(r).unidade_estoque, 'SC');
    // KG ↔ SACO (legado, guarda kg): a unidade efetiva não muda, passa mesmo com estoque.
    const saco = await prisma().produto.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero_produto: `S${++seq}`, nome_produto: `RACAO ${seq}`, unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30', estoque_atual: '90' } });
    const s1 = await chamar('PATCH', `/produtos/${saco.id}`, x.token, { unidade_principal_estoque: 'KG' });
    assert.equal(s1.statusCode, 200, s1.body);
    const s2 = await chamar('PATCH', `/produtos/${saco.id}`, x.token, { unidade_principal_estoque: 'SACO' });
    assert.deepEqual([s2.statusCode, razao(s2)], [400, 'unidade_invalida'], 'saiu do SACO legado: não volta (SACO novo não existe)');
  });
});

describe('U3b — o rascunho do financeiro também é histórico', () => {
  test('KG com item de rascunho da Gestão P3 → SC: 409 lancamentos, nada gravado', async () => {
    const t = await montarTenant(app);
    const A = acoes(app);
    await prisma().unidadeMedida.create({ data: { cliente_id: t.c, numero_unidade: String(++seq + 100), sigla: 'SC', descricao: 'SACA' } });
    await A.criar(t.token, docCom(t.e1, t.local, [{ produto: t.e1.milho, quantidade: '3', valor_unitario: '2.00' }]));
    const antes = await foto(t.c);
    const r = await chamar('PATCH', `/produtos/${t.e1.milho.id}`, t.token, { unidade_medida: 'SC', unidade_principal_estoque: 'SC' });
    assert.deepEqual([r.statusCode, codigo(r), razao(r)], [409, 'PRODUTO_UNIDADE_EM_USO', 'lancamentos'], r.body);
    assert.equal(await foto(t.c), antes);
  });
});

describe('U4 — conversões a partir da unidade de estoque', () => {
  test('KG em produto L e L em produto KG → conversao_kg_l; UN em produto KG, KG e UN em produto SC passam; a própria unidade não', async () => {
    const x = await cenario();
    await unidadeMedida(x, 'SC');
    for (const [unidade, conversao] of [['L', { sigla: 'KG', operacao: 'MULTIPLICA', fator: 1 }], ['KG', { sigla: 'L', operacao: 'MULTIPLICA', fator: 1 }]]) {
      const antes = await foto(x.c);
      const r = await criar(x, { unidade_principal_estoque: unidade, unidades_conversao: [conversao] });
      assert.deepEqual([r.statusCode, razao(r)], [400, 'conversao_kg_l'], `${unidade}/${conversao.sigla}: ${r.body}`);
      assert.equal(await foto(x.c), antes);
    }
    const kg = await criarOk(x, { unidade_principal_estoque: 'KG', unidades_conversao: [{ sigla: 'UN', operacao: 'MULTIPLICA', fator: 2 }] });
    assert.deepEqual(kg.unidades_conversao.map((c) => c.equivalencia), ['1 UN = 2 KG']);
    const sc = await criarOk(x, { unidade_principal_estoque: 'SC', unidades_conversao: [KG_EM_SC, { sigla: 'UN', operacao: 'DIVIDE', fator: 50 }] });
    assert.deepEqual(sc.unidades_conversao.map((c) => c.sigla).sort(), ['KG', 'UN']);
    const igual = await criar(x, { unidade_principal_estoque: 'SC', unidades_conversao: [{ sigla: 'SC', operacao: 'MULTIPLICA', fator: 1 }] });
    assert.deepEqual([igual.statusCode, razao(igual)], [400, 'sigla_igual_principal']);
  });
});

describe('U5 — trava até a UE-3: o cocho só conta produto com estoque em KG', () => {
  test('produto em SC → 422 unidade_sem_peso, nada gravado; o mesmo cocho com produto em KG passa', async () => {
    const x = await cenario();
    await unidadeMedida(x, 'SC');
    const p = await criarOk(x, { unidade_principal_estoque: 'SC', unidades_conversao: [KG_EM_SC] });
    assert.equal((await entrar(x, p, 'SC', '10', '50')).statusCode, 201);
    const antes = await foto(x.c);
    const r = await chamar('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
      operation_id: `sup-${randomUUID()}`, empresa_id: x.e.id, produto_id: p.id, local_origem_id: x.galpao.id, quantidade: 25, ponto_suplementacao_id: 'ponto-1',
    });
    assert.deepEqual([r.statusCode, codigo(r), razao(r)], [422, 'UNIDADE_LANCAMENTO_INVALIDA', 'unidade_sem_peso'], r.body);
    assert.match(corpo(r).message ?? '', /SC/);
    assert.equal(await foto(x.c), antes, 'nada gravado');
    const sal = await criarOk(x, { unidade_principal_estoque: 'KG' });
    assert.equal((await entrar(x, sal, 'KG', '100', '1')).statusCode, 201);
    const ok = await chamar('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
      operation_id: `sup-${randomUUID()}`, empresa_id: x.e.id, produto_id: sal.id, local_origem_id: x.galpao.id, quantidade: 25, ponto_suplementacao_id: 'ponto-1',
    });
    assert.equal(ok.statusCode, 201, ok.body);
  });
});

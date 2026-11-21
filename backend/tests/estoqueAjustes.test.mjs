/**
 * D-PROD-269 — Estoque → Novo movimento → Ajuste: ajuste de inventário documentado. O usuário informa o
 * CONTADO; o servidor compara com o saldo do depósito (sob a trava do produto) e lança a diferença pelo motor:
 * sobra a custo médio (sem saldo, pelo custo informado), falta a custo médio. Exclusão com estorno só sem
 * movimento depois. Ação extra `ajuste`. Tudo contra PostgreSQL real e HTTP autenticado.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

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
const razao = (r) => r.json().reason ?? r.json().details?.reason;
const hoje = () => new Date().toISOString().slice(0, 10);

let seq = 0;
const produto = (c, e, nome, unidade = 'KG', extra = {}) =>
  prisma().produto.create({ data: { cliente_id: c, empresa_id: e, numero_produto: String(++seq + 1000), nome_produto: nome, unidade_principal_estoque: unidade, ...extra } });
const local = (c, nome) => prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome } });

const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const ureia = await produto(c, e.id, 'Ureia', 'KG');
  const sal = await produto(c, e.id, 'Sal mineral', 'KG', { peso_por_saco_kg: '25' });
  const diesel = await produto(c, e.id, 'Diesel', 'L');
  const galpao = await local(c, 'Galpão');
  const barracao = await local(c, 'Barracão');
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  const token = corpo.token;
  const compra = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items.find((m) => m.nome === 'Compra').id;
  const perda = (await chamar('GET', '/estoque/motivos-saida', token)).json().items.find((m) => m.nome === 'Perda').id;
  return { c, e, ureia, sal, diesel, galpao, barracao, token, adm, compra, perda };
};

const entrar = async (x, p, qtd, custo, deposito = x.galpao, unidade = 'KG') => {
  const r = await chamar('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: p.id, local_estoque_id: deposito.id, unidade, quantidade: qtd, custo_unitario: custo }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const sair = (x, p, qtd, deposito = x.galpao) =>
  chamar('POST', '/estoque/saidas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
    itens: [{ produto_id: p.id, local_estoque_id: deposito.id, unidade: 'KG', quantidade: qtd }],
  });
const linhaAjuste = (x, extra = {}) => ({ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade_contada: '90', ...extra });
const corpoAjuste = (x, itens, extra = {}) => ({ empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, itens, ...extra });
const ajustar = (x, itens, extra, token = x.token) => chamar('POST', '/estoque/ajustes', token, corpoAjuste(x, itens, extra));
const excluirAjuste = (x, a, extra = {}, token = x.token) =>
  chamar('POST', `/estoque/ajustes/${a.id}/excluir`, token, { empresa_id: x.e.id, versao: a.versao, motivo: 'contagem errada', operation_id: `ex-${randomUUID()}`, ...extra });
const estoqueAtual = async (p) => Number((await prisma().produto.findUnique({ where: { id: p.id } })).estoque_atual);
const disponivel = async (p, deposito) =>
  Number((await prisma().estoqueLoteNota.aggregate({ _sum: { quantidade_disponivel: true }, where: { produto_id: p.id, local_estoque_id: deposito.id, status: 'Disponivel' } }))._sum.quantidade_disponivel ?? 0);
const reconciliacaoLimpa = async (x) => {
  const rec = await chamar('GET', `/estoque-fisico/reconciliacao${qs({ empresa_id: x.e.id })}`, x.token);
  assert.equal(rec.statusCode, 200, rec.body);
  assert.deepEqual(rec.json().achados, [], rec.body.slice(0, 800));
};
const contaCom = async (x, permissoes_telas) => {
  const hash = (await prisma().usuario.findUnique({ where: { id: x.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  await prisma().usuario.create({ data: { cliente_id: x.c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
  await prisma().permissao.create({ data: { cliente_id: x.c, user_email: login, user_nome: 'Op', modulos_permitidos: ['suporte-mapa'], permissoes_telas } });
  const { corpo } = await autenticarNoApp(app, { login, senha: x.adm.credenciais.senha });
  return corpo.token;
};
const linhaTela = (extras = {}) => ({ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...extras });

describe('D-PROD-269 — criar: o contado contra o saldo do depósito', () => {
  test('FALTA (contou 90 de 100, médio 3): sai 10 a custo médio; SOBRA (contou 120 de 100): entra 20 ao médio; SEM DIFERENÇA só registra; reconciliação limpa', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '50', '2');
    await entrar(x, x.ureia, '50', '4');
    await entrar(x, x.diesel, '200', '6', x.barracao, 'L');
    await entrar(x, x.sal, '4', '50', x.galpao, 'SACO'); // 100 kg a 2/kg
    const r = await ajustar(x, [
      linhaAjuste(x, { quantidade_contada: '90' }),
      { produto_id: x.diesel.id, local_estoque_id: x.barracao.id, unidade: 'L', quantidade_contada: '220' },
      { produto_id: x.sal.id, local_estoque_id: x.galpao.id, unidade: 'SACO', quantidade_contada: '4' },
    ], { observacao: 'contagem de novembro' });
    assert.equal(r.statusCode, 201, r.body);
    const a = r.json();
    assert.deepEqual([a.status, a.versao, a.data_ajuste, a.observacao], ['CONFIRMADA', 1, '2027-06-15', 'contagem de novembro']);
    assert.deepEqual(a.itens.map((i) => [i.tipo, i.saldo_anterior, i.contado_estoque, i.diferenca, i.custo_unitario, i.valor_total]), [
      ['FALTA', '100.0000', '90.0000', '-10.0000', '3.0000', '30.0000'],
      ['SOBRA', '200.0000', '220.0000', '20.0000', '6.0000', '120.0000'],
      ['SEM_DIFERENCA', '100.0000', '100.0000', '0.0000', '2.0000', '0.0000'],
    ]);
    assert.deepEqual([a.valor_faltas, a.valor_sobras], ['30.0000', '120.0000']);
    assert.deepEqual([await estoqueAtual(x.ureia), await estoqueAtual(x.diesel), await estoqueAtual(x.sal)], [90, 220, 100]);
    assert.deepEqual([await disponivel(x.ureia, x.galpao), await disponivel(x.diesel, x.barracao)], [90, 220]);
    const falta = await prisma().movimentacaoEstoque.findUnique({ where: { id: a.itens[0].movimentacao_estoque_id } });
    const sobra = await prisma().movimentacaoEstoque.findUnique({ where: { id: a.itens[1].movimentacao_estoque_id } });
    assert.deepEqual([falta.tipo_movimentacao, falta.tipo_detalhado, falta.origem_sistema, falta.lancamento_origem_id], ['Saída', 'ajuste_falta', 'ajuste_estoque', a.id]);
    assert.deepEqual([sobra.tipo_movimentacao, sobra.tipo_detalhado, sobra.origem_sistema], ['Entrada', 'ajuste_sobra', 'ajuste_estoque']);
    assert.equal(a.itens[2].movimentacao_estoque_id, null);
    // O detalhe do movimento (Kardex) leva ao ajuste.
    const det = (await chamar('GET', `/estoque/movimentos/${falta.id}${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.deepEqual([det.documento?.tipo, det.documento?.id], ['AJUSTE_ESTOQUE', a.id]);
    await reconciliacaoLimpa(x);
  });

  test('saldo do depósito: GET /estoque/ajustes/saldo devolve o saldo e o custo médio; sem saldo, custo médio nulo', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '50', '2');
    await entrar(x, x.ureia, '50', '4');
    const s = (await chamar('GET', `/estoque/ajustes/saldo${qs({ empresa_id: x.e.id, produto_id: x.ureia.id, local_estoque_id: x.galpao.id })}`, x.token)).json();
    assert.deepEqual([s.saldo, s.custo_medio, s.unidade_estoque], ['100.0000', '3.0000', 'KG']);
    const v = (await chamar('GET', `/estoque/ajustes/saldo${qs({ empresa_id: x.e.id, produto_id: x.ureia.id, local_estoque_id: x.barracao.id })}`, x.token)).json();
    assert.deepEqual([v.saldo, v.custo_medio], ['0.0000', null]);
  });

  test('SOBRA num depósito SEM saldo: sem custo informado → 422 custo_obrigatorio_sem_saldo; com custo → entra por ele (custo_informado)', async () => {
    const x = await cenario();
    const sem = await ajustar(x, [linhaAjuste(x, { local_estoque_id: x.barracao.id, quantidade_contada: '15' })]);
    assert.deepEqual([sem.statusCode, razao(sem)], [422, 'custo_obrigatorio_sem_saldo']);
    assert.equal(await prisma().ajusteEstoque.count({ where: { cliente_id: x.c } }), 0);
    const com = await ajustar(x, [linhaAjuste(x, { local_estoque_id: x.barracao.id, quantidade_contada: '15', custo_unitario: '2.5' })]);
    assert.equal(com.statusCode, 201, com.body);
    assert.deepEqual([com.json().itens[0].tipo, com.json().itens[0].custo_unitario, com.json().itens[0].valor_total, com.json().itens[0].custo_informado], ['SOBRA', '2.5000', '37.5000', true]);
    assert.equal(await disponivel(x.ureia, x.barracao), 15);
    await reconciliacaoLimpa(x);
  });

  test('contar zero zera o depósito (falta de tudo); custo informado com saldo é ignorado (vale o médio)', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '40', '3');
    const r = await ajustar(x, [linhaAjuste(x, { quantidade_contada: '0' })]);
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([r.json().itens[0].tipo, r.json().itens[0].diferenca], ['FALTA', '-40.0000']);
    assert.equal(await disponivel(x.ureia, x.galpao), 0);
    await entrar(x, x.ureia, '10', '4');
    const s = await ajustar(x, [linhaAjuste(x, { quantidade_contada: '12', custo_unitario: '99' })]);
    assert.deepEqual([s.json().itens[0].custo_unitario, s.json().itens[0].custo_informado], ['4.0000', false]);
  });

  test('recusas: unidade incompatível, par duplicado, número no JSON e cliente_id → 400/422; data não vai no corpo', async () => {
    const x = await cenario();
    assert.equal(razao(await ajustar(x, [linhaAjuste(x, { produto_id: x.diesel.id, unidade: 'KG' })])), 'unidade_incompativel');
    assert.equal(razao(await ajustar(x, [linhaAjuste(x), linhaAjuste(x, { quantidade_contada: '1' })])), 'par_duplicado');
    assert.equal((await ajustar(x, [linhaAjuste(x, { quantidade_contada: 5 })])).statusCode, 400);
    assert.equal((await ajustar(x, [linhaAjuste(x)], { cliente_id: 'outro' })).statusCode, 400);
    assert.equal((await ajustar(x, [linhaAjuste(x)], { data_ajuste: '2027-01-01' })).statusCode, 400);
  });

  test('replay da mesma operation_id devolve o mesmo ajuste sem lançar de novo; corpo diferente → 409', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const corpo = corpoAjuste(x, [linhaAjuste(x)]);
    const a = await chamar('POST', '/estoque/ajustes', x.token, corpo);
    const b = await chamar('POST', '/estoque/ajustes', x.token, corpo);
    assert.deepEqual([a.statusCode, b.statusCode, b.json().id, b.json().replay], [201, 200, a.json().id, true]);
    assert.equal(await estoqueAtual(x.ureia), 90);
    assert.equal((await chamar('POST', '/estoque/ajustes', x.token, { ...corpo, observacao: 'x' })).statusCode, 409);
  });
});

describe('D-PROD-269 — excluir: estorno integral, só sem movimento depois', () => {
  test('exclusão de ajuste com sobra e falta: EXCLUIDA, estornos ligados, estoque e custo médio voltam; reconciliação limpa', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '50', '2');
    await entrar(x, x.ureia, '50', '4');
    await entrar(x, x.diesel, '200', '6', x.barracao, 'L');
    const a = (await ajustar(x, [linhaAjuste(x, { quantidade_contada: '90' }), { produto_id: x.diesel.id, local_estoque_id: x.barracao.id, unidade: 'L', quantidade_contada: '250' }])).json();
    const r = await excluirAjuste(x, a);
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.deepEqual([b.status, b.versao, b.motivo_exclusao], ['EXCLUIDA', 2, 'contagem errada']);
    const estFalta = await prisma().movimentacaoEstoque.findUnique({ where: { id: b.itens[0].movimentacao_estorno_id } });
    const estSobra = await prisma().movimentacaoEstoque.findUnique({ where: { id: b.itens[1].movimentacao_estorno_id } });
    assert.deepEqual([estFalta.tipo_movimentacao, estFalta.tipo_detalhado, estFalta.origem_sistema], ['Entrada', 'estorno_ajuste_falta', 'ajuste_estoque']);
    assert.deepEqual([estSobra.tipo_movimentacao, estSobra.tipo_detalhado], ['Saída', 'estorno_ajuste_sobra']);
    assert.deepEqual([await estoqueAtual(x.ureia), await estoqueAtual(x.diesel)], [100, 200]);
    const s = (await chamar('GET', `/estoque/ajustes/saldo${qs({ empresa_id: x.e.id, produto_id: x.ureia.id, local_estoque_id: x.galpao.id })}`, x.token)).json();
    assert.deepEqual([s.saldo, s.custo_medio], ['100.0000', '3.0000']);
    assert.deepEqual(b.eventos.map((e) => e.tipo), ['CONFIRMACAO', 'EXCLUSAO']);
    await reconciliacaoLimpa(x);
  });

  test('outro movimento do produto no mesmo depósito depois → 409 AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR; ajuste só SEM_DIFERENCA exclui sem estorno', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const a = (await ajustar(x, [linhaAjuste(x)])).json();
    assert.equal((await sair(x, x.ureia, '1')).statusCode, 201);
    const r = await excluirAjuste(x, a);
    assert.deepEqual([r.statusCode, r.json().code], [409, 'AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR']);
    assert.equal(await estoqueAtual(x.ureia), 89);
    const zero = (await ajustar(x, [linhaAjuste(x, { quantidade_contada: '89' })])).json();
    assert.equal(zero.itens[0].tipo, 'SEM_DIFERENCA');
    const ok = await excluirAjuste(x, zero);
    assert.deepEqual([ok.statusCode, ok.json().status], [200, 'EXCLUIDA']);
  });

  test('segunda exclusão → 409 STATUS_INVALIDO; versão velha → 409; editar observação → 200; campo físico → 409', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const a = (await ajustar(x, [linhaAjuste(x)])).json();
    const ed = await chamar('PATCH', `/estoque/ajustes/${a.id}`, x.token, { empresa_id: x.e.id, versao: 1, motivo_edicao: 'corrigir', observacao: 'nova' });
    assert.deepEqual([ed.statusCode, ed.json().versao], [200, 2]);
    assert.equal((await chamar('PATCH', `/estoque/ajustes/${a.id}`, x.token, { empresa_id: x.e.id, versao: 2, motivo_edicao: 'abc', itens: [] })).json().code, 'AJUSTE_ESTOQUE_EDICAO_FISICA_NAO_SUPORTADA');
    assert.equal((await excluirAjuste(x, a)).json().code, 'AJUSTE_ESTOQUE_VERSAO_CONFLITO');
    assert.equal((await excluirAjuste(x, { ...a, versao: 2 })).statusCode, 200);
    assert.equal((await excluirAjuste(x, { ...a, versao: 3 })).json().code, 'AJUSTE_ESTOQUE_STATUS_INVALIDO');
  });
});

describe('D-PROD-269 — permissão e isolamento', () => {
  test('visualizar lê; criar, saldo e excluir exigem `ajuste`; `entrada`/`saida` não fazem ajuste; seletores aceitam `ajuste`', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const a = (await ajustar(x, [linhaAjuste(x)])).json();
    const soVer = await contaCom(x, [linhaTela()]);
    assert.equal((await chamar('GET', `/estoque/ajustes${qs({ empresa_id: x.e.id })}`, soVer)).statusCode, 200);
    assert.equal((await chamar('GET', `/estoque/ajustes/${a.id}${qs({ empresa_id: x.e.id })}`, soVer)).statusCode, 200);
    assert.equal((await ajustar(x, [linhaAjuste(x, { quantidade_contada: '80' })], {}, soVer)).statusCode, 403);
    assert.equal((await chamar('GET', `/estoque/ajustes/saldo${qs({ empresa_id: x.e.id, produto_id: x.ureia.id, local_estoque_id: x.galpao.id })}`, soVer)).statusCode, 403);
    const outras = await contaCom(x, [linhaTela({ entrada: true, saida: true })]);
    assert.equal((await ajustar(x, [linhaAjuste(x, { quantidade_contada: '80' })], {}, outras)).statusCode, 403);
    const comAjuste = await contaCom(x, [linhaTela({ ajuste: true })]);
    assert.equal((await ajustar(x, [linhaAjuste(x, { quantidade_contada: '80' })], {}, comAjuste)).statusCode, 201);
    assert.equal((await chamar('GET', `/estoque/entradas/opcoes/produtos${qs({ empresa_id: x.e.id })}`, comAjuste)).statusCode, 200);
  });

  test('outro tenant não lê, não exclui nem lança na fazenda alheia (404)', async () => {
    const x = await cenario();
    const y = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const a = (await ajustar(x, [linhaAjuste(x)])).json();
    assert.equal((await chamar('GET', `/estoque/ajustes/${a.id}${qs({ empresa_id: y.e.id })}`, y.token)).json().code, 'AJUSTE_ESTOQUE_NOT_FOUND');
    assert.equal((await excluirAjuste(y, a)).statusCode, 404);
    assert.equal((await chamar('POST', '/estoque/ajustes', y.token, corpoAjuste(x, [linhaAjuste(x)]))).statusCode, 404);
    assert.equal(await estoqueAtual(x.ureia), 90);
  });
});

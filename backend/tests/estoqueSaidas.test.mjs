/**
 * D-PROD-264 — Estoque → Novo movimento → Saída: saída manual documentada, valorizada pelo custo médio do
 * depósito, pelo motor de estoque; cadastro de motivos de saída; exclusão com estorno integral só sem
 * movimento depois; ação extra `saida`. Tudo contra PostgreSQL real e HTTP autenticado.
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
  const entradas = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items;
  const saidas = (await chamar('GET', '/estoque/motivos-saida', token)).json().items;
  const compra = entradas.find((m) => m.nome === 'Compra').id;
  const mot = Object.fromEntries(saidas.map((m) => [m.nome, m.id]));
  return { c, e, ureia, sal, diesel, galpao, barracao, token, adm, compra, mot };
};

/** Entrada manual (Compra) de `kg` a `custo` no depósito. */
const entrar = async (x, p, kg, custo, deposito = x.galpao, unidade = 'KG') => {
  const r = await chamar('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: p.id, local_estoque_id: deposito.id, unidade, quantidade: kg, custo_unitario: custo }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const corpoSaida = (x, extra = {}, item = {}) => ({
  empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.mot.Perda, data_saida: hoje(),
  itens: [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '30', ...item }],
  ...extra,
});
const sair = (x, extra, item, token = x.token) => chamar('POST', '/estoque/saidas', token, corpoSaida(x, extra, item));
const excluirSaida = (x, s, extra = {}, token = x.token) =>
  chamar('POST', `/estoque/saidas/${s.id}/excluir`, token, { empresa_id: x.e.id, versao: s.versao, motivo: 'lançada por engano', operation_id: `ex-${randomUUID()}`, ...extra });
const excluirEntrada = (x, ent, token = x.token) =>
  chamar('POST', `/estoque/entradas/${ent.id}/excluir`, token, { empresa_id: x.e.id, versao: ent.versao ?? 1, motivo: 'lançada por engano', operation_id: `ex-${randomUUID()}` });
/** D-PROD-314 — retrato do que a exclusão recusada não pode gravar: saldo, movimentos, camadas e documentos. */
const foto = async (x) => ({
  estoque: Number((await prisma().produto.findUnique({ where: { id: x.ureia.id } })).estoque_atual),
  movimentos: JSON.stringify(await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' },
    select: { id: true, status: true, movimento_filho_id: true, saldo_antes: true, saldo_depois: true, custo_medio_depois: true, valor_unitario: true, valor_total: true } })),
  camadas: JSON.stringify(await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, quantidade_disponivel: true, status: true } })),
  documentos: JSON.stringify([
    await prisma().saidaEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, versao: true } }),
    await prisma().entradaEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, versao: true } }),
  ]),
});
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
  assert.ok(corpo.token);
  return corpo.token;
};
const linha = (extras = {}) => ({ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true, novo: false, salvar: false, editar: false, excluir: false, importar: false, exportar: false, ...extras });

describe('D-PROD-264 — motivos de saída (cadastro)', () => {
  test('a 1ª leitura cria Perda, Consumo interno, Doação e Vencimento uma vez só; criar, duplicado, renomear e desativar', async () => {
    const x = await cenario();
    assert.deepEqual(Object.keys(x.mot).sort(), ['Consumo interno', 'Doação', 'Perda', 'Vencimento']);
    await chamar('GET', '/estoque/motivos-saida', x.token);
    assert.equal(await prisma().motivoSaidaEstoque.count({ where: { cliente_id: x.c } }), 4);
    const novo = await chamar('POST', '/estoque/motivos-saida', x.token, { nome: '  Roubo  ' });
    assert.equal(novo.statusCode, 201, novo.body);
    assert.equal(novo.json().nome, 'Roubo');
    const dup = await chamar('POST', '/estoque/motivos-saida', x.token, { nome: 'roubo' });
    assert.deepEqual([dup.statusCode, dup.json().code], [409, 'MOTIVO_SAIDA_DUPLICADO']);
    const ren = await chamar('PATCH', `/estoque/motivos-saida/${novo.json().id}`, x.token, { nome: 'Furto' });
    assert.equal(ren.json().nome, 'Furto');
    const off = await chamar('PATCH', `/estoque/motivos-saida/${x.mot.Vencimento}`, x.token, { ativo: false });
    assert.equal(off.json().ativo, false);
    const ativos = (await chamar('GET', `/estoque/motivos-saida${qs({ ativos: 'true' })}`, x.token)).json().items.map((m) => m.nome);
    assert.ok(!ativos.includes('Vencimento') && ativos.includes('Furto'));
    const outro = await cenario();
    assert.equal((await chamar('PATCH', `/estoque/motivos-saida/${novo.json().id}`, outro.token, { nome: 'X1' })).statusCode, 404);
  });
});

describe('D-PROD-264 — criar: baixa pelo motor a custo médio', () => {
  test('saída de 30 kg: 201, movimento Saída saida_manual com o nome do motivo, valor = custo médio, estoque e lotes baixam; evento CONFIRMACAO; reconciliação limpa', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    await entrar(x, x.ureia, '100', '4');
    const r = await sair(x, { centro_custo_id: null, observacao: 'molhou' });
    assert.equal(r.statusCode, 201, r.body);
    const s = r.json();
    assert.deepEqual([s.status, s.versao, s.motivo_nome, s.observacao, s.itens.length], ['CONFIRMADA', 1, 'Perda', 'molhou', 1]);
    const it = s.itens[0];
    assert.deepEqual([it.quantidade_estoque, it.custo_unitario, it.valor_total], ['30.0000', '3.0000', '90.0000']);
    assert.equal(s.valor_total, '90.0000');
    const mov = await prisma().movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estoque_id } });
    assert.deepEqual([mov.tipo_movimentacao, mov.tipo_detalhado, mov.origem_sistema, mov.motivo_movimentacao, mov.lancamento_origem_id],
      ['Saída', 'saida_manual', 'saida_estoque', 'Saída manual: Perda', s.id]);
    assert.ok(!mov.numero_movimentacao.startsWith('p-'));
    assert.ok(Array.isArray(mov.lotes_consumidos) && mov.lotes_consumidos.length >= 1);
    assert.equal(await estoqueAtual(x.ureia), 170);
    assert.equal(await disponivel(x.ureia, x.galpao), 170);
    assert.deepEqual(s.eventos.map((e) => e.tipo), ['CONFIRMACAO']);
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: x.c, acao: 'saida_estoque.confirmar' } });
    assert.ok(audit);
    await reconciliacaoLimpa(x);
  });

  test('VÁRIOS PRODUTOS: SACO (peso do saco), L e KG numa saída só; unidade incompatível → 422; produto sem peso do saco → 422', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    await entrar(x, x.sal, '4', '50', x.galpao, 'SACO');
    await entrar(x, x.diesel, '500', '6', x.barracao, 'L');
    const r = await chamar('POST', '/estoque/saidas', x.token, corpoSaida(x, { motivo_id: x.mot['Consumo interno'], itens: [
      { produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '10' },
      { produto_id: x.sal.id, local_estoque_id: x.galpao.id, unidade: 'SACO', quantidade: '2' },
      { produto_id: x.diesel.id, local_estoque_id: x.barracao.id, unidade: 'L', quantidade: '120.5' },
    ] }));
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual(r.json().itens.map((i) => [i.unidade, i.quantidade_estoque, i.valor_total]), [['KG', '10.0000', '30.0000'], ['SACO', '50.0000', '100.0000'], ['L', '120.5000', '723.0000']]);
    assert.deepEqual([await estoqueAtual(x.ureia), await estoqueAtual(x.sal), await estoqueAtual(x.diesel)], [90, 50, 379.5]);
    const incomp = await sair(x, {}, { produto_id: x.diesel.id, local_estoque_id: x.barracao.id, unidade: 'KG', quantidade: '1' });
    assert.deepEqual([incomp.statusCode, razao(incomp)], [422, 'unidade_incompativel']);
    const semPeso = await sair(x, {}, { unidade: 'SACO', quantidade: '1' });
    assert.deepEqual([semPeso.statusCode, razao(semPeso)], [422, 'peso_por_saco_ausente']);
    await reconciliacaoLimpa(x);
  });

  test('saldo insuficiente no depósito → 422 ESTOQUE_SALDO_INSUFICIENTE e NADA é gravado (nem a saída, nem a sequência dela)', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '20', '3');
    const r = await sair(x, {}, { quantidade: '20.0001' });
    assert.equal(r.statusCode, 422, r.body);
    assert.equal(r.json().code, 'ESTOQUE_SALDO_INSUFICIENTE');
    const outro = await sair(x, {}, { local_estoque_id: x.barracao.id, quantidade: '1' });
    assert.equal(outro.statusCode, 422);
    assert.equal(await prisma().saidaEstoque.count({ where: { cliente_id: x.c } }), 0);
    assert.equal(await estoqueAtual(x.ureia), 20);
  });

  test('recusas do corpo: data futura, motivo inativo/de outro cliente, centro inativo, par duplicado, quantidade zero → 422; número no JSON e cliente_id → 400', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const futura = '2099-01-01';
    assert.deepEqual([(await sair(x, { data_saida: futura })).statusCode], [422]);
    await chamar('PATCH', `/estoque/motivos-saida/${x.mot.Vencimento}`, x.token, { ativo: false });
    assert.equal(razao(await sair(x, { motivo_id: x.mot.Vencimento })), 'motivo_inativo');
    const y = await cenario();
    assert.equal(razao(await sair(x, { motivo_id: y.mot.Perda })), 'motivo_inexistente');
    const cc = await prisma().centroCusto.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero: '9', nome: 'Velho', ativo: false } });
    assert.equal(razao(await sair(x, { centro_custo_id: cc.id })), 'centro_custo_inativo');
    const dup = await chamar('POST', '/estoque/saidas', x.token, corpoSaida(x, { itens: [
      { produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '1' },
      { produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '2' },
    ] }));
    assert.deepEqual([dup.statusCode, razao(dup)], [422, 'par_duplicado']);
    assert.equal((await sair(x, {}, { quantidade: '0' })).statusCode, 422);
    assert.equal((await sair(x, {}, { quantidade: 5 })).statusCode, 400);
    assert.equal((await sair(x, { cliente_id: 'outro' })).statusCode, 400);
    assert.equal(await estoqueAtual(x.ureia), 100);
  });

  test('replay da mesma operation_id devolve 200 com a mesma saída, sem baixar de novo; corpo diferente com a mesma chave → 409', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const corpo = corpoSaida(x);
    const a = await chamar('POST', '/estoque/saidas', x.token, corpo);
    const b = await chamar('POST', '/estoque/saidas', x.token, corpo);
    assert.deepEqual([a.statusCode, b.statusCode, b.json().id, b.json().replay], [201, 200, a.json().id, true]);
    assert.equal(await estoqueAtual(x.ureia), 70);
    const c = await chamar('POST', '/estoque/saidas', x.token, { ...corpo, observacao: 'outra' });
    assert.equal(c.statusCode, 409);
  });

  test('saídas em paralelo do mesmo produto: o saldo nunca fica negativo (uma passa, a outra 422 de saldo)', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '50', '3');
    const rs = await Promise.all([sair(x, {}, { quantidade: '40' }), sair(x, {}, { quantidade: '40' })]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 422]);
    assert.equal(rs.find((r) => r.statusCode === 422).json().code, 'ESTOQUE_SALDO_INSUFICIENTE');
    assert.equal(await estoqueAtual(x.ureia), 10);
  });
});

describe('D-PROD-264 — excluir: estorno integral, só sem movimento depois', () => {
  test('exclusão: EXCLUIDA, movimento de estorno ligado ao original, estoque, lotes e custo médio voltam; evento EXCLUSAO; reconciliação limpa', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    await entrar(x, x.ureia, '100', '4');
    const s = (await sair(x)).json();
    const r = await excluirSaida(x, s);
    assert.equal(r.statusCode, 200, r.body);
    const b = r.json();
    assert.deepEqual([b.status, b.versao, b.motivo_exclusao], ['EXCLUIDA', 2, 'lançada por engano']);
    const est = await prisma().movimentacaoEstoque.findUnique({ where: { id: b.itens[0].movimentacao_estorno_id } });
    assert.deepEqual([est.tipo_movimentacao, est.tipo_detalhado, est.origem_sistema, est.movimento_pai_id], ['Entrada', 'estorno_saida_manual', 'saida_estoque', s.itens[0].movimentacao_estoque_id]);
    const original = await prisma().movimentacaoEstoque.findUnique({ where: { id: s.itens[0].movimentacao_estoque_id } });
    assert.deepEqual([original.status, original.movimento_filho_id], ['Estornada', est.id]);
    assert.equal(await estoqueAtual(x.ureia), 200);
    assert.equal(await disponivel(x.ureia, x.galpao), 200);
    // O custo médio do depósito volta ao de antes: uma nova saída de 30 kg vale 90.
    const nova = (await sair(x)).json();
    assert.equal(nova.itens[0].valor_total, '90.0000');
    assert.deepEqual(b.eventos.map((e) => e.tipo), ['CONFIRMACAO', 'EXCLUSAO']);
    // O detalhe do movimento (Kardex) leva à saída, tanto a baixa quanto o estorno.
    for (const movId of [s.itens[0].movimentacao_estoque_id, b.itens[0].movimentacao_estorno_id]) {
      const det = await chamar('GET', `/estoque/movimentos/${movId}${qs({ empresa_id: x.e.id })}`, x.token);
      assert.equal(det.statusCode, 200, det.body);
      assert.deepEqual([det.json().documento?.tipo, det.json().documento?.id, det.json().documento?.rotulo], ['SAIDA_ESTOQUE', s.id, `Saída nº ${s.numero} — Perda`]);
    }
    await reconciliacaoLimpa(x);
  });

  test('D-PROD-314: outro movimento do produto NO MESMO depósito depois (entrada ou outra saída) → 409 registro posterior e nada gravado; exclui o mais recente primeiro; em outro depósito não conta', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    await entrar(x, x.ureia, '100', '3', x.barracao);
    const s = (await sair(x)).json();
    await entrar(x, x.ureia, '10', '3', x.barracao);
    await sair(x, {}, { local_estoque_id: x.barracao.id, quantidade: '5' });
    const outroDeposito = (await sair(x, {}, { produto_id: x.ureia.id, local_estoque_id: x.barracao.id, quantidade: '1' })).json();
    assert.ok(outroDeposito.id);
    const ok = await excluirSaida(x, s);
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().recalculo, null, 'outro depósito não conta: estorno exato, sem recálculo');

    // Uma ENTRADA depois no Galpão: a saída s2 não sai enquanto a entrada valer.
    const s2 = (await sair(x)).json();
    const entradaDepois = await entrar(x, x.ureia, '1', '3');
    const movEntrada = await prisma().movimentacaoEstoque.findUnique({ where: { id: entradaDepois.itens[0].movimentacao_estoque_id } });
    const antes = await foto(x);
    const r = await excluirSaida(x, s2);
    assert.deepEqual([r.statusCode, r.json().code, r.json().reason, r.json().details?.posterior_id, r.json().details?.posterior_numero, r.json().details?.local_estoque_id],
      [409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior', movEntrada.id, movEntrada.numero_movimentacao, x.galpao.id], r.body);
    assert.deepEqual(await foto(x), antes, 'nada foi gravado');
    // Do mais recente para o mais antigo: a entrada sai, depois a saída.
    const exE = await excluirEntrada(x, entradaDepois);
    assert.equal(exE.statusCode, 200, exE.body);
    const r2 = await excluirSaida(x, s2);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.equal((await prisma().saidaEstoque.findUnique({ where: { id: s2.id } })).status, 'EXCLUIDA');
    assert.equal(await estoqueAtual(x.ureia), antes.estoque - 1 + Number(s2.itens[0].quantidade_estoque));

    // Outra SAÍDA depois no Galpão: a mesma regra.
    const s3 = (await sair(x)).json();
    const depois = (await sair(x, {}, { quantidade: '1' })).json();
    const antes3 = await foto(x);
    const r3 = await excluirSaida(x, s3);
    assert.deepEqual([r3.statusCode, r3.json().code, r3.json().details?.posterior_id], [409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', depois.itens[0].movimentacao_estoque_id], r3.body);
    assert.deepEqual(await foto(x), antes3, 'nada foi gravado');
    assert.equal((await excluirSaida(x, depois)).statusCode, 200);
    const r3b = await excluirSaida(x, s3);
    assert.equal(r3b.statusCode, 200, r3b.body);
    assert.equal(await estoqueAtual(x.ureia), antes3.estoque + 31);
    await reconciliacaoLimpa(x);
  });

  test('segunda exclusão → 409 STATUS_INVALIDO; versão velha → 409 VERSAO_CONFLITO; replay da mesma operation_id → 200', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = (await sair(x)).json();
    const velha = await excluirSaida(x, { ...s, versao: 9 });
    assert.equal(velha.json().code, 'SAIDA_ESTOQUE_VERSAO_CONFLITO');
    const op = `ex-${randomUUID()}`;
    const a = await excluirSaida(x, s, { operation_id: op });
    const b = await excluirSaida(x, s, { operation_id: op });
    assert.deepEqual([a.statusCode, b.statusCode, b.json().replay], [200, 200, true]);
    const de2 = await excluirSaida(x, { ...s, versao: 2 });
    assert.equal(de2.json().code, 'SAIDA_ESTOQUE_STATUS_INVALIDO');
    assert.equal(await estoqueAtual(x.ureia), 100);
  });

  test('a saída que consumiu a camada de uma entrada impede excluir a entrada quando ela é o único estoque (D-PROD-314: registro posterior; a saída sai primeiro)', async () => {
    const x = await cenario();
    const ent = await entrar(x, x.ureia, '100', '3');
    const s = (await sair(x)).json();
    // D-PROD-314: o saldo negativo (D-PROD-273 fatia 5) agora é precedido pela recusa do registro posterior: a saída vale.
    const antes = await foto(x);
    const r = await excluirEntrada(x, ent);
    assert.deepEqual([r.statusCode, r.json().code, r.json().details?.posterior_id], [409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', s.itens[0].movimentacao_estoque_id], r.body);
    assert.deepEqual(await foto(x), antes, 'nada foi devolvido');
    assert.equal((await excluirSaida(x, s)).statusCode, 200);
    const ok = await excluirEntrada(x, ent);
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(await estoqueAtual(x.ureia), 0);
  });
});

describe('D-PROD-264 → D-PROD-271 — editar: METADADOS (só a observação)', () => {
  test('observação nova → 200, versão sobe, evento EDICAO/METADADOS; campo físico sem a versão completa → 400; versão velha → 409', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = (await sair(x)).json();
    const r = await chamar('PATCH', `/estoque/saidas/${s.id}`, x.token, { empresa_id: x.e.id, versao: 1, motivo_edicao: 'corrigir texto', observacao: 'rasgou o saco' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().versao, r.json().observacao, r.json().eventos.map((e) => [e.tipo, e.modo])], [2, 'rasgou o saco', [['CONFIRMACAO', null], ['EDICAO', 'METADADOS']]]);
    const fis = await chamar('PATCH', `/estoque/saidas/${s.id}`, x.token, { empresa_id: x.e.id, versao: 2, motivo_edicao: 'abc', itens: [] });
    assert.equal(fis.statusCode, 400, fis.body);
    const incompleto = await chamar('PATCH', `/estoque/saidas/${s.id}`, x.token, { empresa_id: x.e.id, versao: 2, motivo_edicao: 'abc', motivo_id: x.mot.Doação });
    assert.deepEqual([incompleto.statusCode, razao(incompleto)], [400, 'formato'], incompleto.body);
    assert.equal(await estoqueAtual(x.ureia), 70, 'nada mudou no estoque');
    const velha = await chamar('PATCH', `/estoque/saidas/${s.id}`, x.token, { empresa_id: x.e.id, versao: 1, motivo_edicao: 'abc', observacao: 'x' });
    assert.equal(velha.json().code, 'SAIDA_ESTOQUE_VERSAO_CONFLITO');
  });
});

describe('D-PROD-264 — lista e detalhe', () => {
  test('lista por status e motivo; busca pelo produto; detalhe com nomes', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const a = (await sair(x)).json();
    const b = (await sair(x, { motivo_id: x.mot.Doação }, { quantidade: '5' })).json();
    await excluirSaida(x, b);
    const todas = (await chamar('GET', `/estoque/saidas${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.equal(todas.items.length, 2);
    const conf = (await chamar('GET', `/estoque/saidas${qs({ empresa_id: x.e.id, status: 'CONFIRMADA' })}`, x.token)).json();
    assert.deepEqual(conf.items.map((i) => i.id), [a.id]);
    const doa = (await chamar('GET', `/estoque/saidas${qs({ empresa_id: x.e.id, motivo_id: x.mot.Doação })}`, x.token)).json();
    assert.deepEqual(doa.items.map((i) => i.motivo_nome), ['Doação']);
    const busca = (await chamar('GET', `/estoque/saidas${qs({ empresa_id: x.e.id, q: 'ure' })}`, x.token)).json();
    assert.equal(busca.items.length, 2);
    const det = (await chamar('GET', `/estoque/saidas/${a.id}${qs({ empresa_id: x.e.id })}`, x.token)).json();
    assert.deepEqual([det.itens[0].produto_nome, det.itens[0].local_estoque_nome], ['Ureia', 'Galpão']);
  });
});

describe('D-PROD-264 — permissão: a ação `saida` da tela sup-estoque', () => {
  test('visualizar lê; criar, editar, excluir e motivos exigem `saida`; `entrada` sozinha não lança saída; os seletores do formulário aceitam `saida`', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = (await sair(x)).json();
    const soVer = await contaCom(x, [linha()]);
    assert.equal((await chamar('GET', `/estoque/saidas${qs({ empresa_id: x.e.id })}`, soVer)).statusCode, 200);
    assert.equal((await chamar('GET', `/estoque/saidas/${s.id}${qs({ empresa_id: x.e.id })}`, soVer)).statusCode, 200);
    assert.equal((await chamar('GET', '/estoque/motivos-saida', soVer)).statusCode, 200);
    assert.equal((await sair(x, {}, {}, soVer)).statusCode, 403);
    assert.equal((await chamar('POST', '/estoque/motivos-saida', soVer, { nome: 'Teste' })).statusCode, 403);
    assert.equal((await excluirSaida(x, s, {}, soVer)).statusCode, 403);
    const soEntrada = await contaCom(x, [linha({ entrada: true })]);
    assert.equal((await sair(x, {}, {}, soEntrada)).statusCode, 403);
    const comSaida = await contaCom(x, [linha({ saida: true })]);
    assert.equal((await sair(x, {}, { quantidade: '1' }, comSaida)).statusCode, 201);
    for (const rota of ['produtos', 'locais', 'centros-custo', 'centros-resultado']) {
      const q = rota === 'locais' ? '' : qs({ empresa_id: x.e.id });
      assert.equal((await chamar('GET', `/estoque/entradas/opcoes/${rota}${q}`, comSaida)).statusCode, 200, rota);
    }
    assert.equal((await chamar('GET', `/estoque/entradas/opcoes/fornecedores${qs({ empresa_id: x.e.id })}`, comSaida)).statusCode, 403);
    assert.equal((await chamar('POST', '/estoque/entradas', comSaida, {
      empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
      itens: [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '1', custo_unitario: '1' }],
    })).statusCode, 403);
  });
});

describe('D-PROD-264 — isolamento por tenant', () => {
  test('outro tenant não lê, não edita, não exclui nem lança na fazenda alheia (404)', async () => {
    const x = await cenario();
    const y = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = (await sair(x)).json();
    assert.equal((await chamar('GET', `/estoque/saidas/${s.id}${qs({ empresa_id: y.e.id })}`, y.token)).json().code, 'SAIDA_ESTOQUE_NOT_FOUND');
    assert.equal((await chamar('GET', `/estoque/saidas/${s.id}${qs({ empresa_id: x.e.id })}`, y.token)).statusCode, 404);
    assert.equal((await chamar('PATCH', `/estoque/saidas/${s.id}`, y.token, { empresa_id: y.e.id, versao: 1, motivo_edicao: 'abc', observacao: 'x' })).statusCode, 404);
    assert.equal((await excluirSaida(y, s)).statusCode, 404);
    assert.equal((await chamar('POST', '/estoque/saidas', y.token, corpoSaida(x))).statusCode, 404);
    assert.equal(await estoqueAtual(x.ureia), 70);
  });
});

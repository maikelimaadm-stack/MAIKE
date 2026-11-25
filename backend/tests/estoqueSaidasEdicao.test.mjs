/**
 * D-PROD-271 — edição COMPLETA da saída manual do Estoque (PATCH /estoque/saidas/:id, modo SUBSTITUICAO): o corpo é a
 * versão nova inteira (o mesmo da criação) + `versao`, `motivo_edicao` e `operation_id`. Só se nada mexeu depois em
 * nenhuma linha (a regra da exclusão), cada linha é estornada pelo motor, as linhas antigas vão INTEIRAS para o
 * `snapshot_anterior` do evento e são apagadas (sem migration: a saída não tem colunas de revisão) e as novas são
 * lançadas pelo motor pelo custo médio. PostgreSQL real, HTTP autenticado, reconciliação pela rota do estoque físico.
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
const ontem = () => new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

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
  const galpao = await local(c, 'Galpão');
  const barracao = await local(c, 'Barracão');
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  const token = corpo.token;
  const entradas = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items;
  const saidas = (await chamar('GET', '/estoque/motivos-saida', token)).json().items;
  const compra = entradas.find((m) => m.nome === 'Compra').id;
  const mot = Object.fromEntries(saidas.map((m) => [m.nome, m.id]));
  return { c, e, ureia, sal, galpao, barracao, token, adm, compra, mot };
};

/** Entrada manual (Compra) de `kg` a `custo` no depósito. */
const entrar = async (x, p, kg, custo, deposito = x.galpao) => {
  const r = await chamar('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: p.id, local_estoque_id: deposito.id, unidade: 'KG', quantidade: kg, custo_unitario: custo }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const corpoSaida = (x, extra = {}, itens = null) => ({
  empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.mot.Perda, data_saida: hoje(),
  itens: itens ?? [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '30' }],
  ...extra,
});
const sair = async (x, extra, itens) => {
  const r = await chamar('POST', '/estoque/saidas', x.token, corpoSaida(x, extra, itens));
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
/** PATCH de substituição: a versão nova COMPLETA (o corpo da criação) + versão, motivo da edição e operation_id. */
const editar = (x, s, extra = {}, itens = null, token = x.token) =>
  chamar('PATCH', `/estoque/saidas/${s.id}`, token, { ...corpoSaida(x, extra, itens), versao: s.versao, motivo_edicao: 'pesagem refeita', operation_id: `ed-${randomUUID()}`, ...extra });
const estoqueAtual = async (p) => Number((await prisma().produto.findUnique({ where: { id: p.id } })).estoque_atual);
const disponivel = async (p, deposito) =>
  Number((await prisma().estoqueLoteNota.aggregate({ _sum: { quantidade_disponivel: true }, where: { produto_id: p.id, local_estoque_id: deposito.id, status: 'Disponivel' } }))._sum.quantidade_disponivel ?? 0);
const movimento = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const reconciliacaoLimpa = async (x) => {
  const rec = await chamar('GET', `/estoque-fisico/reconciliacao${qs({ empresa_id: x.e.id })}`, x.token);
  assert.equal(rec.statusCode, 200, rec.body);
  assert.deepEqual(rec.json().achados, [], rec.body.slice(0, 800));
};
/** O que tem de ficar IGUAL quando a edição é recusada. */
const fotografia = async (x, id) => ({
  saida: await prisma().saidaEstoque.findUnique({ where: { id }, select: { versao: true, motivo_id: true, data_saida: true, observacao: true, status: true } }),
  itens: await prisma().saidaEstoqueItem.findMany({ where: { saida_id: id }, orderBy: { ordem: 'asc' }, select: { id: true, quantidade: true, movimentacao_estoque_id: true } }),
  eventos: await prisma().saidaEstoqueEvento.count({ where: { saida_id: id } }),
  movimentos: await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }),
  lotes: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, quantidade_disponivel: true } }),
  ureia: await estoqueAtual(x.ureia),
  sal: await estoqueAtual(x.sal),
});

describe('D-PROD-271 — substituição da saída: quantidade, produto, depósito, data, motivo e centros', () => {
  test('quantidade: estorno pelo motor, linha antiga inteira no snapshot e apagada, linha nova pelo custo médio; saldo e valor seguem a versão nova', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '2');
    await entrar(x, x.ureia, '100', '4');
    const s = await sair(x, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '50' }]);
    assert.equal(s.itens[0].custo_unitario, '3.0000');
    const antiga = s.itens[0];
    const r = await editar(x, s, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '100' }]);
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.deepEqual([d.id, d.numero, d.status, d.versao, d.replay, d.valor_total], [s.id, s.numero, 'CONFIRMADA', 2, false, '300.0000']);
    assert.equal(d.itens.length, 1);
    const [nova] = d.itens;
    assert.deepEqual([nova.ordem, nova.quantidade_estoque, nova.custo_unitario, nova.valor_total, nova.movimentacao_estorno_id], [1, '100.0000', '3.0000', '300.0000', null]);
    assert.notEqual(nova.id, antiga.id);
    assert.equal(await prisma().saidaEstoqueItem.count({ where: { id: antiga.id } }), 0, 'a linha antiga foi apagada');
    assert.equal(await estoqueAtual(x.ureia), 100);
    assert.equal((await movimento(antiga.movimentacao_estoque_id)).status, 'Estornada');
    const ev = await prisma().saidaEstoqueEvento.findFirst({ where: { saida_id: s.id, tipo: 'EDICAO' } });
    assert.equal(ev.motivo, 'pesagem refeita');
    assert.equal(ev.snapshot_anterior.modo, 'SUBSTITUICAO');
    const [snap] = ev.snapshot_anterior.itens;
    assert.deepEqual([snap.id, snap.ordem, snap.produto_id, snap.local_estoque_id, snap.unidade, snap.quantidade, snap.fator_kg, snap.quantidade_estoque, snap.custo_unitario, snap.valor_total, snap.movimentacao_estoque_id],
      [antiga.id, 1, x.ureia.id, x.galpao.id, 'KG', '50.0000', '1.0000', '50.0000', '3.0000', '150.0000', antiga.movimentacao_estoque_id]);
    const est = await movimento(snap.movimentacao_estorno_id);
    assert.deepEqual([est.tipo_movimentacao, est.tipo_detalhado, est.origem_sistema, est.movimento_pai_id, Number(est.quantidade), Number(est.valor_total)],
      ['Entrada', 'estorno_saida_manual', 'saida_estoque', antiga.movimentacao_estoque_id, 50, 150]);
    assert.ok(est.motivo_movimentacao.startsWith(`Edição da saída ${s.numero}: pesagem refeita`), est.motivo_movimentacao);
    assert.deepEqual(ev.snapshot_novo.estornos, [snap.movimentacao_estorno_id]);
    assert.deepEqual(ev.snapshot_novo.itens.map((i) => [i.id, i.movimentacao_estoque_id]), [[nova.id, nova.movimentacao_estoque_id]]);
    assert.ok(Number((await movimento(nova.movimentacao_estoque_id)).numero_movimentacao) > Number(est.numero_movimentacao), 'o estorno numera antes da saída nova');
    assert.deepEqual(d.eventos.map((e) => [e.tipo, e.modo]), [['CONFIRMACAO', null], ['EDICAO', 'SUBSTITUICAO']]);
    assert.ok(await prisma().auditLog.findFirst({ where: { cliente_id: x.c, acao: 'saida_estoque.editar' } }));
    // a Consulta ainda acha a saída pelo movimento antigo (a linha foi apagada; o motor gravou a origem)
    const cons = await chamar('GET', `/estoque/movimentos/${antiga.movimentacao_estoque_id}${qs({ empresa_id: x.e.id })}`, x.token);
    assert.equal(cons.statusCode, 200, cons.body);
    assert.deepEqual([cons.json().documento?.tipo, cons.json().documento?.id], ['SAIDA_ESTOQUE', s.id]);
    await reconciliacaoLimpa(x);
  });

  test('produto, depósito, unidade, data, motivo e centros: o estoque volta ao depósito antigo e sai do novo', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    await entrar(x, x.sal, '200', '2', x.barracao);
    const cc = await prisma().centroCusto.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero: 'CC1', nome: 'Recria' } });
    const cr = await prisma().centroResultado.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero: 'CR1', nome: 'Pecuária' } });
    const s = await sair(x);
    const r = await editar(x, s, { motivo_id: x.mot.Doação, data_saida: ontem(), centro_custo_id: cc.id, centro_resultado_id: cr.id, observacao: 'doado ao vizinho' }, [
      { produto_id: x.sal.id, local_estoque_id: x.barracao.id, unidade: 'SACO', quantidade: '2' },
      { produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '5' },
    ]);
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.deepEqual([d.motivo_nome, d.data_saida, d.centro_custo_nome, d.centro_resultado_nome, d.observacao], ['Doação', ontem(), 'Recria', 'Pecuária', 'doado ao vizinho']);
    assert.deepEqual(d.itens.map((i) => [i.ordem, i.produto_id, i.local_estoque_id, i.quantidade_estoque, i.custo_unitario]), [[1, x.sal.id, x.barracao.id, '50.0000', '2.0000'], [2, x.ureia.id, x.galpao.id, '5.0000', '3.0000']]);
    assert.deepEqual([await estoqueAtual(x.ureia), await estoqueAtual(x.sal), await disponivel(x.sal, x.barracao)], [95, 150, 150]);
    const m = await movimento(d.itens[0].movimentacao_estoque_id);
    assert.deepEqual([m.data_movimentacao.toISOString().slice(0, 10), m.motivo_movimentacao], [ontem(), 'Saída manual: Doação']);
    await reconciliacaoLimpa(x);
  });

  test('saldo insuficiente na versão nova → 422 ESTOQUE_SALDO_INSUFICIENTE e tudo desfeito (estorno incluído); data futura → 422', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = await sair(x);
    const antes = await fotografia(x, s.id);
    const r = await editar(x, s, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '101' }]);
    assert.equal(r.json().code, 'ESTOQUE_SALDO_INSUFICIENTE', r.body);
    assert.deepEqual(await fotografia(x, s.id), antes);
    const futura = await editar(x, s, { data_saida: '2999-01-01' });
    assert.deepEqual([futura.statusCode, razao(futura)], [422, 'data_futura'], futura.body);
    assert.deepEqual(await fotografia(x, s.id), antes);
  });
});

describe('D-PROD-271 — "se nada mexeu depois", versão e idempotência', () => {
  test('outro movimento do produto no depósito depois da saída → a EDIÇÃO recusa 409 SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR e nada muda; D-PROD-313: a exclusão recusa 409 registro posterior e sai depois do mais recente', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = await sair(x);
    const depois = await sair(x, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '1' }]);
    const antes = await fotografia(x, s.id);
    const r = await editar(x, s, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '10' }]);
    assert.deepEqual([r.statusCode, r.json().code, razao(r), r.json().details?.item_ordem], [409, 'SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR', 'movimento_posterior', 1], r.body);
    assert.match(r.json().message, /a edição não é possível/);
    assert.deepEqual(await fotografia(x, s.id), antes);
    // D-PROD-313: a EXCLUSÃO também recusa enquanto a saída de depois valer (não há mais recálculo); nada muda
    const ex = await chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 1, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    assert.deepEqual([ex.statusCode, ex.json().code, razao(ex), ex.json().details?.posterior_id], [409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior', depois.itens[0].movimentacao_estoque_id], ex.body);
    assert.deepEqual(await fotografia(x, s.id), antes);
    // do mais recente para o mais antigo: a de depois sai, depois a saída
    const exDepois = await chamar('POST', `/estoque/saidas/${depois.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 1, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    assert.equal(exDepois.statusCode, 200, exDepois.body);
    const ex2 = await chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 1, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex2.statusCode, 200, ex2.body);
    assert.equal(await estoqueAtual(x.ureia), 100);
    await reconciliacaoLimpa(x);
  });

  test('versão desatualizada → 409 VERSAO_CONFLITO; saída excluída → 409 STATUS_INVALIDO; nada muda', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = await sair(x);
    const ok = await chamar('PATCH', `/estoque/saidas/${s.id}`, x.token, { empresa_id: x.e.id, versao: 1, motivo_edicao: 'obs', observacao: 'nova' });
    assert.equal(ok.statusCode, 200, ok.body);
    const antes = await fotografia(x, s.id);
    const velha = await editar(x, s, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '1' }]);
    assert.deepEqual([velha.statusCode, velha.json().code], [409, 'SAIDA_ESTOQUE_VERSAO_CONFLITO'], velha.body);
    assert.deepEqual(await fotografia(x, s.id), antes);
    const ex = await chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 2, motivo: 'errada', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    const excluida = await editar(x, { ...s, versao: 3 });
    assert.deepEqual([excluida.statusCode, excluida.json().code], [409, 'SAIDA_ESTOQUE_STATUS_INVALIDO'], excluida.body);
  });

  test('idempotência: a mesma operation_id e o mesmo corpo → 200 replay sem duplicar; outro corpo com a mesma chave → 409 IDEMPOTENCY_CONFLICT', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = await sair(x);
    const corpo = { ...corpoSaida(x, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '40' }]), versao: 1, motivo_edicao: 'recontagem', operation_id: `ed-${randomUUID()}` };
    const r1 = await chamar('PATCH', `/estoque/saidas/${s.id}`, x.token, corpo);
    assert.equal(r1.statusCode, 200, r1.body);
    const movimentos = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
    const r2 = await chamar('PATCH', `/estoque/saidas/${s.id}`, x.token, corpo);
    assert.deepEqual([r2.statusCode, r2.json().replay, r2.json().versao, r2.json().itens[0].id], [200, true, 2, r1.json().itens[0].id], r2.body);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }), movimentos);
    assert.equal(await estoqueAtual(x.ureia), 60);
    const outro = await chamar('PATCH', `/estoque/saidas/${s.id}`, x.token, { ...corpo, itens: [{ ...corpo.itens[0], quantidade: '41' }] });
    assert.deepEqual([outro.statusCode, outro.json().code], [409, 'IDEMPOTENCY_CONFLICT'], outro.body);
    assert.equal(await estoqueAtual(x.ureia), 60);
  });
});

describe('D-PROD-271 — METADADOS pela versão completa, tenant, permissão e exclusão depois', () => {
  test('versão completa fisicamente igual com observação nova → EDICAO/METADADOS sem tocar o estoque; tudo igual → 422 nada_a_alterar', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = await sair(x);
    const movimentos = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
    const r = await editar(x, s, { observacao: 'conferida' }, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '30.000' }]);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().observacao, r.json().versao, r.json().itens[0].id, r.json().eventos.at(-1).modo], ['conferida', 2, s.itens[0].id, 'METADADOS']);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }), movimentos);
    const igual = await editar(x, r.json(), { observacao: 'conferida' });
    assert.deepEqual([igual.statusCode, razao(igual)], [422, 'nada_a_alterar'], igual.body);
  });

  test('outro tenant não edita (404, sem oráculo); sem a ação `saida` → 403; nada muda', async () => {
    const x = await cenario();
    const y = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = await sair(x);
    const antes = await fotografia(x, s.id);
    const alheia = await chamar('PATCH', `/estoque/saidas/${s.id}`, y.token, { ...corpoSaida(y), versao: 1, motivo_edicao: 'invasão', operation_id: `ed-${randomUUID()}` });
    assert.deepEqual([alheia.statusCode, alheia.json().code], [404, 'SAIDA_ESTOQUE_NOT_FOUND'], alheia.body);
    const empresaAlheia = await chamar('PATCH', `/estoque/saidas/${s.id}`, y.token, { ...corpoSaida(x), versao: 1, motivo_edicao: 'invasão', operation_id: `ed-${randomUUID()}` });
    assert.equal(empresaAlheia.statusCode, 404, empresaAlheia.body);
    const hash = (await prisma().usuario.findUnique({ where: { id: x.adm.usuario.id } })).senha_hash;
    const login = `op-${randomUUID().slice(0, 8)}`;
    await prisma().usuario.create({ data: { cliente_id: x.c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
    await prisma().permissao.create({ data: { cliente_id: x.c, user_email: login, user_nome: 'Op', modulos_permitidos: ['suporte-mapa'], permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true, novo: false, salvar: false, editar: true, excluir: false, importar: false, exportar: false, entrada: true }] } });
    const semSaida = (await autenticarNoApp(app, { login, senha: x.adm.credenciais.senha })).corpo.token;
    const negado = await editar(x, s, {}, null, semSaida);
    assert.equal(negado.statusCode, 403, negado.body);
    assert.deepEqual(await fotografia(x, s.id), antes);
  });

  test('edição seguida de outra edição e da exclusão: a linha vigente (nova) é estornada; o estoque volta; reconciliação limpa', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    await entrar(x, x.ureia, '50', '3', x.barracao);
    const s = await sair(x);
    const r1 = await editar(x, s, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '20' }]);
    assert.equal(r1.statusCode, 200, r1.body);
    const r2 = await editar(x, r1.json(), {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '25' }, { produto_id: x.ureia.id, local_estoque_id: x.barracao.id, unidade: 'KG', quantidade: '5' }]);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.deepEqual([r2.json().versao, r2.json().itens.length], [3, 2]);
    assert.deepEqual([await disponivel(x.ureia, x.galpao), await disponivel(x.ureia, x.barracao)], [75, 45]);
    const ex = await chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 3, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    assert.equal(await estoqueAtual(x.ureia), 150);
    assert.deepEqual(ex.json().eventos.map((e) => [e.tipo, e.modo]), [['CONFIRMACAO', null], ['EDICAO', 'SUBSTITUICAO'], ['EDICAO', 'SUBSTITUICAO'], ['EXCLUSAO', null]]);
    await reconciliacaoLimpa(x);
  });

  test('empate de createdAt entre o estorno da linha substituída e a linha nova (mesmo milissegundo) não trava a exclusão; um movimento de fato posterior trava a edição e, D-PROD-313, a exclusão (409 registro posterior; exclui o mais recente primeiro)', async () => {
    const x = await cenario();
    await entrar(x, x.ureia, '100', '3');
    const s = await sair(x);
    const r = await editar(x, s, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '20' }]);
    assert.equal(r.statusCode, 200, r.body);
    const ev = await prisma().saidaEstoqueEvento.findFirst({ where: { saida_id: s.id, tipo: 'EDICAO' } });
    const nova = await movimento(r.json().itens[0].movimentacao_estoque_id);
    await prisma().movimentacaoEstoque.update({ where: { id: ev.snapshot_novo.estornos[0] }, data: { createdAt: nova.createdAt } });
    const outra = await sair(x, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '1' }]);
    // a edição com um movimento de fato posterior continua travada (regra da D-PROD-271, fatia 5)
    const travada = await editar(x, { ...s, versao: 2 }, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '21' }]);
    assert.deepEqual([travada.statusCode, travada.json().code], [409, 'SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR'], travada.body);
    // D-PROD-313: a exclusão com o posterior de fato recusa e aponta para ELE (o estorno empatado da linha
    // substituída é um par já excluído: não conta como "depois"); nada muda
    const antes = await fotografia(x, s.id);
    const exclusao = await chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 2, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    assert.deepEqual([exclusao.statusCode, exclusao.json().code, exclusao.json().details?.posterior_id], [409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', outra.itens[0].movimentacao_estoque_id], exclusao.body);
    assert.deepEqual(await fotografia(x, s.id), antes);
    // do mais recente para o mais antigo
    const exOutra = await chamar('POST', `/estoque/saidas/${outra.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 1, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    assert.equal(exOutra.statusCode, 200, exOutra.body);
    assert.equal(exOutra.json().recalculo, null, 'a última: estorno exato');
    const exS = await chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 2, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    assert.equal(exS.statusCode, 200, exS.body);
    assert.equal(await estoqueAtual(x.ureia), 100);
    await reconciliacaoLimpa(x);
    const y = await cenario();
    await entrar(y, y.ureia, '100', '3');
    const t = await sair(y);
    const ry = await editar(y, t, {}, [{ produto_id: y.ureia.id, local_estoque_id: y.galpao.id, unidade: 'KG', quantidade: '20' }]);
    const evy = await prisma().saidaEstoqueEvento.findFirst({ where: { saida_id: t.id, tipo: 'EDICAO' } });
    const novay = await movimento(ry.json().itens[0].movimentacao_estoque_id);
    await prisma().movimentacaoEstoque.update({ where: { id: evy.snapshot_novo.estornos[0] }, data: { createdAt: novay.createdAt } });
    const ex = await chamar('POST', `/estoque/saidas/${t.id}/excluir`, y.token, { empresa_id: y.e.id, versao: 2, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    assert.equal(await estoqueAtual(y.ureia), 100);
    await reconciliacaoLimpa(y);
  });
});

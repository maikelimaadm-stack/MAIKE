/**
 * D-PROD-270 — edição COMPLETA da entrada manual do Estoque (PATCH /estoque/entradas/:id, modo SUBSTITUICAO):
 * o corpo é a versão nova inteira (o mesmo da criação) + `versao`, `motivo_edicao` e `operation_id`. Só se nada
 * mexeu depois nas camadas vigentes (a prova da exclusão), as linhas vigentes são estornadas pelo motor
 * (`estorno_entrada_revisao`), encerradas (`revisao_fim`) e as novas lançadas pelo motor; o cabeçalho guarda número
 * e id. PostgreSQL real, HTTP autenticado, reconciliação pela rota do estoque físico.
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
  const motivos = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items;
  const porNome = (n) => motivos.find((m) => m.nome === n).id;
  const mot = { implantacao: porNome('Saldo de implantação'), compra: porNome('Compra'), doacao: porNome('Doação') };
  const saidas = (await chamar('GET', '/estoque/motivos-saida', token)).json().items;
  const perda = saidas.find((m) => m.nome === 'Perda').id;
  return { c, e, ureia, sal, galpao, barracao, token, adm, mot, perda };
};

const fornecedor = (x, nome) =>
  prisma().fornecedor.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero_cadastro: `F-${++seq}`, tipo_pessoa: 'Jurídica', nome, tipos: ['fornecedor'] } });

/** Corpo da criação (Compra de ureia no galpão, 100 kg a 3). */
const corpoDe = (x, extra = {}, itens = null) => ({
  empresa_id: x.e.id,
  operation_id: `op-${randomUUID()}`,
  motivo_id: x.mot.compra,
  data_entrada: hoje(),
  itens: itens ?? [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '100', custo_unitario: '3' }],
  ...extra,
});
const criar = async (x, extra, itens) => {
  const r = await chamar('POST', '/estoque/entradas', x.token, corpoDe(x, extra, itens));
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
/** PATCH de substituição: a versão nova COMPLETA (o corpo da criação) + versão, motivo da edição e operation_id. */
const editar = (x, entrada, extra = {}, itens = null, token = x.token) =>
  chamar('PATCH', `/estoque/entradas/${entrada.id}`, token, { ...corpoDe(x, extra, itens), versao: entrada.versao, motivo_edicao: 'conferência da nota', operation_id: `ed-${randomUUID()}`, ...extra });
const detalhe = async (x, id) => (await chamar('GET', `/estoque/entradas/${id}${qs({ empresa_id: x.e.id })}`, x.token)).json();
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
  entrada: await prisma().entradaEstoque.findUnique({ where: { id }, select: { versao: true, revisao: true, motivo: true, motivo_id: true, data_entrada: true, observacao: true } }),
  itens: await prisma().entradaEstoqueItem.count({ where: { entrada_id: id } }),
  eventos: await prisma().entradaEstoqueEvento.count({ where: { entrada_id: id } }),
  movimentos: await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }),
  lotes: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, quantidade_disponivel: true } }),
  ureia: await estoqueAtual(x.ureia),
  sal: await estoqueAtual(x.sal),
});

describe('D-PROD-270 — substituição: quantidade, custo, produto, depósito e data', () => {
  test('quantidade e custo: saldo, camada e custo médio seguem a versão nova; a linha antiga é estornada pelo motor (estorno_entrada_revisao) e vira histórico', async () => {
    const x = await cenario();
    await criar(x, { documento_numero: 'NF 1' }, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '100', custo_unitario: '2' }]);
    const b = await criar(x, { documento_numero: 'NF 2' });
    const antiga = b.itens[0];
    const r = await editar(x, b, { documento_numero: 'NF 2' }, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '50', custo_unitario: '5' }]);
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.deepEqual([d.id, d.numero, d.status, d.versao, d.revisao, d.replay], [b.id, b.numero, 'CONFIRMADA', 2, 2, false]);
    assert.equal(d.itens.length, 1);
    const [nova] = d.itens;
    assert.deepEqual([nova.ordem, nova.quantidade_estoque, nova.custo_kg, nova.valor_total, nova.revisao_inicio, nova.revisao_fim], [1, '50.0000', '5.0000', '250.0000', 2, null]);
    assert.notEqual(nova.movimentacao_estoque_id, antiga.movimentacao_estoque_id);
    assert.equal(d.itens_historico.length, 1);
    const [hist] = d.itens_historico;
    assert.deepEqual([hist.id, hist.revisao_inicio, hist.revisao_fim, hist.quantidade_estoque], [antiga.id, 1, 1, '100.0000']);
    assert.ok(hist.movimentacao_estorno_id);
    const est = await movimento(hist.movimentacao_estorno_id);
    assert.deepEqual([est.tipo_movimentacao, est.tipo_detalhado, est.origem_sistema, est.movimento_pai_id, Number(est.quantidade)], ['Saída', 'estorno_entrada_revisao', 'entrada_estoque', antiga.movimentacao_estoque_id, 100]);
    assert.ok(est.motivo_movimentacao.startsWith(`Edição da entrada ${b.numero}: conferência da nota`), est.motivo_movimentacao);
    assert.ok(!est.numero_movimentacao.startsWith('p-'));
    assert.equal((await movimento(antiga.movimentacao_estoque_id)).status, 'Estornada');
    assert.equal((await prisma().estoqueLoteNota.findUnique({ where: { id: antiga.estoque_lote_nota_id } })).status, 'Estornado');
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { id: nova.estoque_lote_nota_id } });
    assert.deepEqual([Number(lote.quantidade_disponivel), Number(lote.custo_unitario)], [50, 5]);
    const mNovo = await movimento(nova.movimentacao_estoque_id);
    assert.ok(Number(mNovo.numero_movimentacao) > Number(est.numero_movimentacao), 'o estorno numera antes do lançamento novo');
    assert.equal(await estoqueAtual(x.ureia), 150);
    // custo médio do depósito: (100 × 2 + 50 × 5) ÷ 150 = 3
    const s = await chamar('POST', '/estoque/saidas', x.token, {
      empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
      itens: [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '30' }],
    });
    assert.equal(s.statusCode, 201, s.body);
    assert.equal(s.json().itens[0].custo_unitario, '3.0000');
    // evento EDICAO/SUBSTITUICAO com os dois snapshots
    assert.deepEqual(d.eventos.map((e) => [e.tipo, e.modo, e.revisao_anterior, e.revisao_nova, e.versao_anterior, e.versao_nova]), [['CONFIRMACAO', null, 0, 1, 0, 1], ['EDICAO', 'SUBSTITUICAO', 1, 2, 1, 2]]);
    const ev = await prisma().entradaEstoqueEvento.findFirst({ where: { entrada_id: b.id, tipo: 'EDICAO' } });
    assert.equal(ev.motivo, 'conferência da nota');
    assert.deepEqual(ev.snapshot_anterior.itens.map((i) => [i.id, i.quantidade, i.custo_unitario, i.movimentacao_estoque_id, i.estoque_lote_nota_id, i.movimentacao_estorno_id, i.revisao_fim]),
      [[antiga.id, '100.0000', '3.0000', antiga.movimentacao_estoque_id, antiga.estoque_lote_nota_id, hist.movimentacao_estorno_id, 1]]);
    assert.deepEqual(ev.snapshot_novo.itens.map((i) => [i.quantidade, i.custo_unitario, i.movimentacao_estoque_id, i.estoque_lote_nota_id]), [['50.0000', '5.0000', nova.movimentacao_estoque_id, nova.estoque_lote_nota_id]]);
    assert.deepEqual(ev.snapshot_novo.estornos, [hist.movimentacao_estorno_id]);
    assert.deepEqual([ev.snapshot_anterior.cabecalho.versao, ev.snapshot_novo.cabecalho.versao], [1, 2]);
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: x.c, acao: 'entrada_estoque.editar' } });
    assert.ok(audit);
    await reconciliacaoLimpa(x);
  });

  test('produto, depósito, unidade e data: o estoque sai do produto/depósito antigo e entra no novo, com a data nova no movimento', async () => {
    const x = await cenario();
    const a = await criar(x);
    const r = await editar(x, a, { data_entrada: ontem() }, [
      { produto_id: x.sal.id, local_estoque_id: x.barracao.id, unidade: 'SACO', quantidade: '4', custo_unitario: '50' },
      { produto_id: x.ureia.id, local_estoque_id: x.barracao.id, unidade: 'KG', quantidade: '10', custo_unitario: '3' },
    ]);
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.equal(d.data_entrada, ontem());
    assert.deepEqual(d.itens.map((i) => [i.ordem, i.produto_id, i.local_estoque_id, i.quantidade_estoque, i.custo_kg]), [[1, x.sal.id, x.barracao.id, '100.0000', '2.0000'], [2, x.ureia.id, x.barracao.id, '10.0000', '3.0000']]);
    assert.deepEqual([await estoqueAtual(x.ureia), await estoqueAtual(x.sal)], [10, 100]);
    assert.deepEqual([await disponivel(x.ureia, x.galpao), await disponivel(x.ureia, x.barracao), await disponivel(x.sal, x.barracao)], [0, 10, 100]);
    const m = await movimento(d.itens[0].movimentacao_estoque_id);
    assert.equal(m.data_movimentacao.toISOString().slice(0, 10), ontem());
    const est = await movimento(d.itens_historico[0].movimentacao_estorno_id);
    const diaEstorno = est.data_movimentacao.toISOString().slice(0, 10);
    assert.ok(diaEstorno >= hoje() && diaEstorno !== ontem(), `o estorno é do "hoje" da fazenda, não da data nova (${diaEstorno})`);
    await reconciliacaoLimpa(x);
  });

  test('data futura, produto inativo e depósito inativo na versão nova → 422 e nada muda', async () => {
    const x = await cenario();
    const a = await criar(x);
    const antes = await fotografia(x, a.id);
    const futura = await editar(x, a, { data_entrada: '2999-01-01' });
    assert.deepEqual([futura.statusCode, razao(futura)], [422, 'data_futura'], futura.body);
    await prisma().produto.update({ where: { id: x.sal.id }, data: { ativo: false } });
    const inativo = await editar(x, a, {}, [{ produto_id: x.sal.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '10', custo_unitario: '1' }]);
    assert.deepEqual([inativo.statusCode, razao(inativo)], [422, 'produto_inativo'], inativo.body);
    await prisma().localEstoque.update({ where: { id: x.barracao.id }, data: { ativo: false } });
    const deposito = await editar(x, a, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.barracao.id, unidade: 'KG', quantidade: '10', custo_unitario: '1' }]);
    assert.equal(deposito.statusCode, 422, deposito.body);
    assert.deepEqual(await fotografia(x, a.id), antes);
  });
});

describe('D-PROD-270 — substituição: motivo, fornecedor, documento e centros', () => {
  test('Compra → Doação com fornecedor e centros; depois → Saldo de implantação (sem fornecedor): a natureza segue o motivo novo', async () => {
    const x = await cenario();
    const forn = await fornecedor(x, 'Agro Insumos');
    const cc = await prisma().centroCusto.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero: 'CC1', nome: 'Recria' } });
    const cr = await prisma().centroResultado.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero: 'CR1', nome: 'Pecuária' } });
    const a = await criar(x, { documento_numero: 'NF 7' });
    const r = await editar(x, a, { motivo_id: x.mot.doacao, fornecedor_id: forn.id, documento_numero: 'NF 7-A', centro_custo_id: cc.id, centro_resultado_id: cr.id, observacao: 'doado' });
    assert.equal(r.statusCode, 200, r.body);
    const d = r.json();
    assert.deepEqual([d.motivo, d.motivo_nome, d.fornecedor_nome, d.documento_numero, d.centro_custo_nome, d.centro_resultado_nome, d.observacao], ['ENTRADA', 'Doação', 'Agro Insumos', 'NF 7-A', 'Recria', 'Pecuária', 'doado']);
    const m = await movimento(d.itens[0].movimentacao_estoque_id);
    assert.deepEqual([m.tipo_detalhado, m.motivo_movimentacao, m.numero_documento], ['entrada_manual', 'Entrada manual: Doação', 'NF 7-A']);
    // o produto só tem o histórico DESTA entrada: depois do estorno, ela vira implantação (sem fornecedor nem documento)
    const impl = await editar(x, d, { motivo_id: x.mot.implantacao }, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '120', custo_unitario: '3' }]);
    assert.equal(impl.statusCode, 200, impl.body);
    assert.deepEqual([impl.json().motivo, impl.json().fornecedor_id, impl.json().documento_numero, impl.json().revisao, impl.json().itens_historico.length], ['SALDO_IMPLANTACAO', null, null, 3, 2]);
    assert.equal(await estoqueAtual(x.ureia), 120);
    const comFornecedor = await editar(x, impl.json(), { motivo_id: x.mot.implantacao, fornecedor_id: forn.id });
    assert.deepEqual([comFornecedor.statusCode, razao(comFornecedor)], [422, 'implantacao_sem_fornecedor']);
    await reconciliacaoLimpa(x);
  });

  test('a implantação se edita (não conflita consigo mesma); outro produto com histórico não vira implantação', async () => {
    const x = await cenario();
    const a = await criar(x, { motivo_id: x.mot.implantacao });
    const r = await editar(x, a, { motivo_id: x.mot.implantacao }, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '90', custo_unitario: '3' }]);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(await estoqueAtual(x.ureia), 90);
    await criar(x, {}, [{ produto_id: x.sal.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '5', custo_unitario: '1' }]);
    const antes = await fotografia(x, a.id);
    const comSal = await editar(x, r.json(), { motivo_id: x.mot.implantacao }, [{ produto_id: x.sal.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '5', custo_unitario: '1' }]);
    assert.deepEqual([comSal.statusCode, comSal.json().code], [409, 'ENTRADA_ESTOQUE_IMPLANTACAO_COM_HISTORICO'], comSal.body);
    assert.deepEqual(await fotografia(x, a.id), antes, 'a recusa depois do estorno desfaz tudo');
  });

  test('documento: manter o próprio não conflita; usar o de outra entrada confirmada → 409 DOCUMENTO_CONFLITANTE', async () => {
    const x = await cenario();
    await criar(x, { documento_numero: 'NF 100' }, [{ produto_id: x.sal.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '5', custo_unitario: '1' }]);
    const a = await criar(x, { documento_numero: 'NF 200' });
    const mesmo = await editar(x, a, { documento_numero: ' nf 200 ' }, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '99', custo_unitario: '3' }]);
    assert.equal(mesmo.statusCode, 200, mesmo.body);
    const antes = await fotografia(x, a.id);
    const outro = await editar(x, mesmo.json(), { documento_numero: 'nf 100' });
    assert.deepEqual([outro.statusCode, outro.json().code, razao(outro)], [409, 'ENTRADA_ESTOQUE_DOCUMENTO_CONFLITANTE', 'documento_duplicado'], outro.body);
    assert.deepEqual(await fotografia(x, a.id), antes);
  });
});

describe('D-PROD-270 — "se nada mexeu depois", versão e idempotência', () => {
  test('a camada já consumida (uma saída depois) → 409 ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS, a mesma recusa da exclusão; nada muda', async () => {
    const x = await cenario();
    const a = await criar(x);
    const s = await chamar('POST', '/estoque/saidas', x.token, {
      empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
      itens: [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '10' }],
    });
    assert.equal(s.statusCode, 201, s.body);
    const antes = await fotografia(x, a.id);
    const r = await editar(x, a, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '200', custo_unitario: '3' }]);
    assert.deepEqual([r.statusCode, r.json().code, razao(r), r.json().details?.item_ordem], [409, 'ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS', 'camada_consumida', 1], r.body);
    assert.match(r.json().message, /edição recusada/);
    const ex = await chamar('POST', `/estoque/entradas/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 1, motivo: 'teste', operation_id: `ex-${randomUUID()}` });
    assert.deepEqual([ex.json().code, razao(ex)], [r.json().code, razao(r)], 'a mesma forma da exclusão');
    assert.deepEqual(await fotografia(x, a.id), antes);
  });

  test('versão desatualizada → 409 VERSAO_CONFLITO; entrada excluída → 409 STATUS_INVALIDO; nada muda', async () => {
    const x = await cenario();
    const a = await criar(x);
    const ok = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, { empresa_id: x.e.id, versao: 1, motivo_edicao: 'obs', observacao: 'nova' });
    assert.equal(ok.statusCode, 200, ok.body);
    const antes = await fotografia(x, a.id);
    const velha = await editar(x, a, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '1', custo_unitario: '3' }]);
    assert.deepEqual([velha.statusCode, velha.json().code], [409, 'ENTRADA_ESTOQUE_VERSAO_CONFLITO'], velha.body);
    assert.deepEqual(await fotografia(x, a.id), antes);
    const ex = await chamar('POST', `/estoque/entradas/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 2, motivo: 'errada', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    const excluida = await editar(x, { ...a, versao: 3 });
    assert.deepEqual([excluida.statusCode, excluida.json().code], [409, 'ENTRADA_ESTOQUE_STATUS_INVALIDO'], excluida.body);
  });

  test('idempotência: a mesma operation_id e o mesmo corpo → 200 replay sem duplicar; outro corpo com a mesma chave → 409 IDEMPOTENCY_CONFLICT', async () => {
    const x = await cenario();
    const a = await criar(x);
    const corpo = { ...corpoDe(x, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '40', custo_unitario: '3' }]), versao: 1, motivo_edicao: 'recontagem', operation_id: `ed-${randomUUID()}` };
    const r1 = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, corpo);
    assert.equal(r1.statusCode, 200, r1.body);
    const movimentos = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
    const r2 = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, corpo);
    assert.deepEqual([r2.statusCode, r2.json().replay, r2.json().versao, r2.json().itens[0].id], [200, true, 2, r1.json().itens[0].id], r2.body);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }), movimentos);
    assert.equal(await estoqueAtual(x.ureia), 40);
    const outro = await chamar('PATCH', `/estoque/entradas/${a.id}`, x.token, { ...corpo, itens: [{ ...corpo.itens[0], quantidade: '41' }] });
    assert.deepEqual([outro.statusCode, outro.json().code], [409, 'IDEMPOTENCY_CONFLICT'], outro.body);
    assert.equal(await estoqueAtual(x.ureia), 40);
  });
});

describe('D-PROD-270 — METADADOS pela versão completa, tenant, permissão e exclusão depois', () => {
  test('versão completa fisicamente igual com observação nova → EDICAO/METADADOS sem tocar o estoque; tudo igual → 422 nada_a_alterar', async () => {
    const x = await cenario();
    const a = await criar(x, { documento_numero: 'NF 9' });
    const movimentos = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
    const r = await editar(x, a, { documento_numero: 'NF 9', observacao: 'conferida' }, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '100.0', custo_unitario: '3.0000' }]);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().observacao, r.json().versao, r.json().itens[0].id, r.json().eventos.at(-1).modo], ['conferida', 2, a.itens[0].id, 'METADADOS']);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }), movimentos);
    const igual = await editar(x, r.json(), { documento_numero: 'NF 9', observacao: 'conferida' });
    assert.deepEqual([igual.statusCode, razao(igual)], [422, 'nada_a_alterar'], igual.body);
  });

  test('outro tenant não edita (404, sem oráculo); só `visualizar` → 403; nada muda', async () => {
    const x = await cenario();
    const y = await cenario();
    const a = await criar(x);
    const antes = await fotografia(x, a.id);
    const alheia = await chamar('PATCH', `/estoque/entradas/${a.id}`, y.token, { ...corpoDe(y), versao: 1, motivo_edicao: 'invasão', operation_id: `ed-${randomUUID()}` });
    assert.deepEqual([alheia.statusCode, alheia.json().code], [404, 'ENTRADA_ESTOQUE_NOT_FOUND'], alheia.body);
    const empresaAlheia = await chamar('PATCH', `/estoque/entradas/${a.id}`, y.token, { ...corpoDe(x), versao: 1, motivo_edicao: 'invasão', operation_id: `ed-${randomUUID()}` });
    assert.equal(empresaAlheia.statusCode, 404, empresaAlheia.body);
    const hash = (await prisma().usuario.findUnique({ where: { id: x.adm.usuario.id } })).senha_hash;
    const login = `op-${randomUUID().slice(0, 8)}`;
    await prisma().usuario.create({ data: { cliente_id: x.c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
    await prisma().permissao.create({ data: { cliente_id: x.c, user_email: login, user_nome: 'Op', modulos_permitidos: ['suporte-mapa'], permissoes_telas: [{ modulo_id: 'suporte-mapa', tela_id: 'sup-estoque', visualizar: true, novo: false, salvar: false, editar: true, excluir: false, importar: false, exportar: false }] } });
    const soVer = (await autenticarNoApp(app, { login, senha: x.adm.credenciais.senha })).corpo.token;
    const negado = await editar(x, a, {}, null, soVer);
    assert.equal(negado.statusCode, 403, negado.body);
    assert.deepEqual(await fotografia(x, a.id), antes);
  });

  test('edição seguida de exclusão: a linha vigente (nova) é estornada; estoque zera; reconciliação limpa; editar de novo depois de editar também vale', async () => {
    const x = await cenario();
    const a = await criar(x);
    const r1 = await editar(x, a, {}, [{ produto_id: x.ureia.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: '70', custo_unitario: '3' }]);
    assert.equal(r1.statusCode, 200, r1.body);
    const r2 = await editar(x, r1.json(), {}, [{ produto_id: x.ureia.id, local_estoque_id: x.barracao.id, unidade: 'KG', quantidade: '60', custo_unitario: '4' }]);
    assert.equal(r2.statusCode, 200, r2.body);
    assert.deepEqual([r2.json().versao, r2.json().revisao, r2.json().itens.length, r2.json().itens_historico.length], [3, 3, 1, 2]);
    assert.deepEqual([await disponivel(x.ureia, x.galpao), await disponivel(x.ureia, x.barracao)], [0, 60]);
    const ex = await chamar('POST', `/estoque/entradas/${a.id}/excluir`, x.token, { empresa_id: x.e.id, versao: 3, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    assert.equal(await estoqueAtual(x.ureia), 0);
    const d = await detalhe(x, a.id);
    assert.deepEqual([d.status, d.itens.length, d.itens_historico.length], ['EXCLUIDA', 0, 3]);
    assert.deepEqual(d.eventos.map((e) => [e.tipo, e.modo]), [['CONFIRMACAO', null], ['EDICAO', 'SUBSTITUICAO'], ['EDICAO', 'SUBSTITUICAO'], ['EXCLUSAO', null]]);
    await reconciliacaoLimpa(x);
  });
});

/**
 * D-PROD-267 — primitivas do MOTOR para os dois cancelamentos: estorno exato da saída de suplementação do
 * cocho (`estornarSaidaSuplementacao`), estorno exato da transferência entre locais
 * (`estornarTransferenciaEstoque`) e o helper compartilhado da regra do último (`buscarMovimentoPosterior`).
 * Contra PostgreSQL real: a montagem usa as rotas HTTP de sempre (entrada documentada, baixa do cocho,
 * transferência) e as primitivas são chamadas numa transação, como os serviços vão chamar. Depois de cada
 * estorno, a reconciliação (I1–I5) tem de continuar limpa.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import {
  estornarSaidaSuplementacao, estornarTransferenciaEstoque, descobrirParDeTransferencia, exigirLocaisEstoque, numerarMovimentos, numeroMovimentoProvisorio,
  TIPO_ESTORNO_SUPLEMENTACAO, TIPO_ESTORNO_TRANSFERENCIA_ENVIADA, TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA,
} from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';
import { buscarMovimentoPosterior, buscarMovimentoPosteriorA } from '../src/modules/estoqueFisico/movimentoPosterior.js';

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
const DIA = '2027-06-15';

let seq = 0;
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const p = await prisma().produto.create({ data: { cliente_id: c, empresa_id: e.id, numero_produto: String(++seq + 1000), nome_produto: 'Sal mineral', unidade_principal_estoque: 'KG' } });
  const outro = await prisma().produto.create({ data: { cliente_id: c, empresa_id: e.id, numero_produto: String(++seq + 1000), nome_produto: 'Ureia', unidade_principal_estoque: 'KG' } });
  const local = (nome) => prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome } });
  const galpao = await local('Galpão');
  const barracao = await local('Barracão');
  const retiro = await local('Retiro');
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  const token = corpo.token;
  const compra = (await chamar('GET', '/estoque/motivos-entrada', token)).json().items.find((m) => m.nome === 'Compra').id;
  const perda = (await chamar('GET', '/estoque/motivos-saida', token)).json().items.find((m) => m.nome === 'Perda').id;
  const ctx = { auth: { clienteId: c, usuarioId: adm.usuario.id, login: adm.credenciais.login } };
  return { c, e, p, outro, galpao, barracao, retiro, token, compra, perda, ctx };
};

const entrar = async (x, kg, custo, deposito = x.galpao, produto = x.p) => {
  const r = await chamar('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: deposito.id, unidade: 'KG', quantidade: kg, custo_unitario: custo }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const suplementar = async (x, kg, deposito = x.galpao, extra = {}) => {
  const r = await chamar('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
    operation_id: `sup-${randomUUID()}`, empresa_id: x.e.id, produto_id: x.p.id, local_origem_id: deposito.id, quantidade: kg, ponto_suplementacao_id: 'ponto-1', ...extra,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().movimentacao;
};
const transferir = async (x, kg, origem = x.galpao, destino = x.barracao) => {
  const r = await chamar('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e.id, produto_id: x.p.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade: kg,
  });
  assert.equal(r.statusCode, 201, r.body);
  return { s: r.json().movimentacao_saida, r: r.json().movimentacao_entrada };
};
const saidaManual = async (x, kg) => {
  const r = await chamar('POST', '/estoque/saidas', x.token, {
    empresa_id: x.e.id, operation_id: `op-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
    itens: [{ produto_id: x.p.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: kg }],
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const mov = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const estoqueAtual = async (x) => (await prisma().produto.findUnique({ where: { id: x.p.id } })).estoque_atual.toString();
/** Poço (Disponivel) de um local: quantidade e valor Σ disp × custo, em Number (tolerância nos asserts). */
const poco = async (x, deposito) => {
  const camadas = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, produto_id: x.p.id, local_estoque_id: deposito.id, status: 'Disponivel' } });
  return {
    quantidade: camadas.reduce((t, l) => t + Number(l.quantidade_disponivel), 0),
    valor: camadas.reduce((t, l) => t + Number(l.quantidade_disponivel) * Number(l.custo_unitario), 0),
  };
};
const camadas = async (x, deposito) =>
  (await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, produto_id: x.p.id, local_estoque_id: deposito.id }, orderBy: { createdAt: 'asc' } }))
    .map((l) => ({ id: l.id, disp: l.quantidade_disponivel.toString(), status: l.status }));
/** Retrato de tudo que um estorno recusado não pode ter mudado. */
const retrato = async (x) => ({
  movimentos: await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, movimento_filho_id: true, numero_movimentacao: true } }),
  lotes: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, quantidade_disponivel: true, custo_unitario: true } }),
  produtos: await prisma().produto.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true } }),
});
const proximo = (v, esperado, tol = 0.01) => assert.ok(Math.abs(v - esperado) <= tol, `${v} ≉ ${esperado}`);
const reconciliacaoLimpa = async (x) => {
  const rec = await chamar('GET', `/estoque-fisico/reconciliacao${qs({ empresa_id: x.e.id })}`, x.token);
  assert.equal(rec.statusCode, 200, rec.body);
  assert.deepEqual(rec.json().achados, [], rec.body.slice(0, 1500));
};

/** Recusa do motor: [code, reason]. */
const recusa = async (promessa) => {
  try {
    await promessa;
  } catch (erro) {
    return [/** @type {any} */ (erro).code, /** @type {any} */ (erro).details?.reason ?? null, /** @type {any} */ (erro).details ?? {}];
  }
  assert.fail('esperava recusa');
  return [];
};

/** Estorno do cocho numa transação, como o serviço: locais → (motor trava produto) → estorno → numeração. */
const cancelarCocho = (x, m, extra = {}) =>
  prisma().$transaction(async (tx) => {
    await exigirLocaisEstoque(tx, x.c, [{ id: m.local_estoque_origem, field: 'local_origem_id', exigirAtivo: false }]);
    const produto = await tx.produto.findFirst({ where: { cliente_id: x.c, empresa_id: x.e.id, id: x.p.id } });
    const r = await estornarSaidaSuplementacao(tx, x.ctx, {
      empresaId: x.e.id, movimentoId: m.id, produto, local: { id: m.local_estoque_origem, nome: 'Galpão' }, dia: DIA,
      origem: { operacaoId: 'evento-1', motivoEstorno: 'Cancelamento do lançamento do cocho: lançado em dobro' }, numeroMovimento: numeroMovimentoProvisorio(),
      ...extra,
    });
    await numerarMovimentos(tx, x.c, [r.movimento.id]);
    return r;
  }, { timeout: 20000 });

const cancelarTransferencia = (x, movimentoId, extra = {}) =>
  prisma().$transaction(async (tx) => {
    const r = await estornarTransferenciaEstoque(tx, x.ctx, { empresaId: x.e.id, movimentoId, dia: DIA, motivo: 'transferida errado', ...extra });
    await numerarMovimentos(tx, x.c, [r.estornoDestino.id, r.estornoOrigem.id]);
    return r;
  }, { timeout: 20000 });

// ─── cocho ────────────────────────────────────────────────────────────────────

describe('D-PROD-267 motor — estornarSaidaSuplementacao (cocho)', () => {
  test('caminho feliz: fatias voltam às camadas, poço com o valor exato, Entrada estorno_suplementacao ligada, M Estornada, estoque_atual de volta; reconciliação limpa', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    await entrar(x, '100', '4');
    const antes = await poco(x, x.galpao);
    const camadasAntes = await camadas(x, x.galpao);
    assert.equal(await estoqueAtual(x), '200');
    const m = await suplementar(x, 130);
    assert.deepEqual([m.tipo_detalhado, m.origem_sistema], ['suplementacao', 'suplementacao']);
    assert.equal(await estoqueAtual(x), '70');

    const r = await cancelarCocho(x, m, { vinculo: { pontoSuplementacaoId: 'ponto-1', quantidadeKg: 130 } });
    const estorno = await mov(r.movimento.id);
    const original = await mov(m.id);
    assert.deepEqual(
      [estorno.tipo_movimentacao, estorno.tipo_detalhado, estorno.origem_sistema, estorno.movimento_pai_id, estorno.lancamento_origem_id, estorno.local_estoque_destino, estorno.local_estoque_origem],
      ['Entrada', TIPO_ESTORNO_SUPLEMENTACAO, 'suplementacao', m.id, 'evento-1', x.galpao.id, null],
    );
    assert.equal(estorno.valor_total.toString(), original.valor_total.toString());
    assert.equal(estorno.quantidade.toString(), '130');
    assert.match(estorno.numero_movimentacao, /^[0-9]+$/);
    assert.deepEqual([original.status, original.movimento_filho_id], ['Estornada', estorno.id]);
    assert.equal(await estoqueAtual(x), '200');
    const depois = await poco(x, x.galpao);
    proximo(depois.quantidade, antes.quantidade, 0);
    proximo(depois.valor, antes.valor);
    assert.deepEqual((await camadas(x, x.galpao)).map((l) => [l.id, l.disp, l.status]), camadasAntes.map((l) => [l.id, l.disp, l.status]));
    assert.deepEqual(r.fatias.map((f) => f.quantidade.toString()).sort(), ['100', '30']);
    await reconciliacaoLimpa(x);
  });

  test('regra do último: compra, transferência ou outra baixa depois no depósito recusam (nada muda); outro produto e outro depósito não contam', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const m = await suplementar(x, 10);
    await entrar(x, '5', '9', x.galpao, x.outro);
    await entrar(x, '5', '9', x.retiro);
    assert.equal((await cancelarCocho(x, m)).movimento.tipo_detalhado, TIPO_ESTORNO_SUPLEMENTACAO);

    const m2 = await suplementar(x, 10);
    await entrar(x, '10', '3');
    const ret = await retrato(x);
    const [code, reason, det] = await recusa(cancelarCocho(x, m2));
    assert.deepEqual([code, reason], ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'movimento_posterior_no_deposito']);
    assert.match(String(det.movimento_numero), /^[0-9]+$/);
    assert.deepEqual(await retrato(x), ret);

    const y = await cenario();
    await entrar(y, '100', '2');
    const t = await suplementar(y, 10);
    await transferir(y, 5);
    assert.deepEqual((await recusa(cancelarCocho(y, t))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'movimento_posterior_no_deposito']);

    const z = await cenario();
    await entrar(z, '100', '2');
    const u = await suplementar(z, 10);
    await suplementar(z, 3);
    assert.deepEqual((await recusa(cancelarCocho(z, u))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'movimento_posterior_no_deposito']);
  });

  test('par neutro: cancelar N e depois N-1 passa; a saída manual excluída (estorno exato no mesmo depósito) também é neutra; o poço volta ao de antes', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    await entrar(x, '50', '5');
    const antes = await poco(x, x.galpao);
    const n1 = await suplementar(x, 40);
    const s = await saidaManual(x, '15');
    const ex = await chamar('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e.id, versao: s.versao, motivo: 'lançada por engano', operation_id: `ex-${randomUUID()}` });
    assert.equal(ex.statusCode, 200, ex.body);
    const n = await suplementar(x, 25);
    await cancelarCocho(x, n);
    await cancelarCocho(x, n1);
    const depois = await poco(x, x.galpao);
    proximo(depois.quantidade, antes.quantidade, 0);
    proximo(depois.valor, antes.valor);
    assert.equal(await estoqueAtual(x), '150');
    await reconciliacaoLimpa(x);
  });

  test('recusas: saída que não é do cocho, local ou quantidade divergentes, já estornada, sem fatias, camada estornada — todas sem efeito', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const manual = await saidaManual(x, '5');
    const movManual = { id: manual.itens[0].movimentacao_estoque_id, local_estoque_origem: x.galpao.id };
    assert.deepEqual((await recusa(cancelarCocho(x, movManual))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'saida_nao_comprovada']);
    const m = await suplementar(x, 10);
    assert.deepEqual((await recusa(cancelarCocho(x, m, { vinculo: { quantidadeKg: 11 } }))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'saida_nao_comprovada']);
    assert.deepEqual((await recusa(cancelarCocho(x, m, { vinculo: { pontoSuplementacaoId: 'outro-ponto' } }))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'saida_nao_comprovada']);
    assert.deepEqual((await recusa(cancelarCocho(x, { ...m, local_estoque_origem: x.barracao.id }))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'saida_nao_comprovada']);
    assert.deepEqual((await recusa(cancelarCocho(x, { ...m, id: 'nao-existe' }))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'saida_nao_comprovada']);

    const ret = await retrato(x);
    await prisma().estoqueLoteNota.updateMany({ where: { cliente_id: x.c, local_estoque_id: x.galpao.id }, data: { status: 'Estornado' } });
    assert.deepEqual((await recusa(cancelarCocho(x, m))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'lote_indisponivel_para_devolucao']);
    for (const l of ret.lotes) await prisma().estoqueLoteNota.update({ where: { id: l.id }, data: { status: l.status } });

    const fatias = (await mov(m.id)).lotes_consumidos;
    await prisma().movimentacaoEstoque.update({ where: { id: m.id }, data: { lotes_consumidos: [] } });
    assert.deepEqual((await recusa(cancelarCocho(x, m))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'saida_sem_fatias']);
    await prisma().movimentacaoEstoque.update({ where: { id: m.id }, data: { lotes_consumidos: fatias } });
    assert.deepEqual(await retrato(x), ret);

    await cancelarCocho(x, m);
    assert.deepEqual((await recusa(cancelarCocho(x, m))).slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'movimento_estornado']);
    await reconciliacaoLimpa(x);
  });

  test('concorrência: dois cancelamentos da mesma baixa ao mesmo tempo → um estorna, o outro recusa (movimento_estornado); um só estorno', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const m = await suplementar(x, 10);
    const rs = await Promise.allSettled([cancelarCocho(x, m), cancelarCocho(x, m)]);
    assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
    const falha = /** @type {any} */ (rs.find((r) => r.status === 'rejected')).reason;
    assert.deepEqual([falha.code, falha.details?.reason], ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'movimento_estornado']);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c, tipo_detalhado: TIPO_ESTORNO_SUPLEMENTACAO } }), 1);
    assert.equal(await estoqueAtual(x), '100');
    await reconciliacaoLimpa(x);
  });

  test('outro tenant: o movimento não existe para ele (saida_nao_comprovada), nada muda', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const m = await suplementar(x, 10);
    const y = await cenario();
    const ret = await retrato(x);
    const r = await recusa(prisma().$transaction(async (tx) => {
      const produto = await tx.produto.findFirst({ where: { cliente_id: y.c, id: y.p.id } });
      return estornarSaidaSuplementacao(tx, y.ctx, {
        empresaId: y.e.id, movimentoId: m.id, produto, local: { id: x.galpao.id }, dia: DIA, origem: { operacaoId: 'e', motivoEstorno: 'x' },
      });
    }));
    assert.deepEqual(r.slice(0, 2), ['SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'saida_nao_comprovada']);
    assert.deepEqual(await retrato(x), ret);
  });
});

// ─── transferência ───────────────────────────────────────────────────────────

describe('D-PROD-267 motor — estornarTransferenciaEstoque', () => {
  test('caminho feliz pela Saída: origem volta (lote Esgotado → Disponivel), destino zerado, par Estornada com E_d/E_o, estoque_atual intocado, números definitivos; reconciliação limpa', async () => {
    const x = await cenario();
    await entrar(x, '50', '2');
    await entrar(x, '100', '4');
    const antes = await poco(x, x.galpao);
    const camadasAntes = await camadas(x, x.galpao);
    const t = await transferir(x, 80);
    assert.equal(await estoqueAtual(x), '150');
    assert.ok((await camadas(x, x.galpao)).some((l) => l.status === 'Esgotado'));

    const r = await cancelarTransferencia(x, t.s.id);
    const [s, e, ed, eo] = await Promise.all([mov(t.s.id), mov(t.r.id), mov(r.estornoDestino.id), mov(r.estornoOrigem.id)]);
    assert.deepEqual([s.status, s.movimento_filho_id, e.status, e.movimento_filho_id], ['Estornada', e.id, 'Estornada', ed.id]);
    assert.deepEqual([ed.tipo_movimentacao, ed.tipo_detalhado, ed.movimento_pai_id, ed.local_estoque_origem, ed.local_estoque_destino, ed.origem_sistema],
      ['Saída', TIPO_ESTORNO_TRANSFERENCIA_RECEBIDA, e.id, x.barracao.id, null, 'deposito']);
    assert.deepEqual([eo.tipo_movimentacao, eo.tipo_detalhado, eo.movimento_pai_id, eo.local_estoque_destino, eo.local_estoque_origem],
      ['Entrada', TIPO_ESTORNO_TRANSFERENCIA_ENVIADA, s.id, x.galpao.id, null]);
    assert.equal(ed.valor_total.toString(), s.valor_total.toString());
    assert.equal(eo.valor_total.toString(), s.valor_total.toString());
    assert.equal(Number(eo.numero_movimentacao), Number(ed.numero_movimentacao) + 1);
    assert.match(eo.motivo_movimentacao, /^Cancelamento da transferência \d+: transferida errado$/);
    assert.equal(await estoqueAtual(x), '150');
    assert.deepEqual((await camadas(x, x.galpao)).map((l) => [l.id, l.disp, l.status]), camadasAntes.map((l) => [l.id, l.disp, l.status]));
    const destino = await camadas(x, x.barracao);
    assert.ok(destino.length >= 1 && destino.every((l) => l.status === 'Estornado' && l.disp === '0'));
    const depois = await poco(x, x.galpao);
    proximo(depois.quantidade, antes.quantidade, 0);
    proximo(depois.valor, antes.valor);
    assert.deepEqual(r.devolvido.map((d) => d.quantidade).sort(), ['30.0000', '50.0000']);
    await reconciliacaoLimpa(x);
  });

  test('custo exato pela Entrada: destino tinha 10 kg a 1,00 e recebe 10 kg a 10,00; depois do cancelamento volta a 10 kg a 1,00 e a origem ao valor de antes', async () => {
    const x = await cenario();
    await entrar(x, '10', '1', x.barracao);
    await entrar(x, '30', '10', x.galpao);
    const antesO = await poco(x, x.galpao);
    const antesD = await poco(x, x.barracao);
    const t = await transferir(x, 10);
    proximo((await poco(x, x.barracao)).valor, 110);
    await cancelarTransferencia(x, t.r.id);
    const d = await poco(x, x.barracao);
    const o = await poco(x, x.galpao);
    proximo(d.quantidade, antesD.quantidade, 0);
    proximo(d.valor, antesD.valor);
    proximo(o.quantidade, antesO.quantidade, 0);
    proximo(o.valor, antesO.valor);
    await reconciliacaoLimpa(x);
  });

  test('regra do último nos DOIS depósitos (lado destino e origem), cadeia A→B→C só pelo último elo; outro produto não bloqueia', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const t = await transferir(x, 40);
    await entrar(x, '7', '3', x.barracao, x.outro);
    await suplementar(x, 5, x.barracao);
    const ret = await retrato(x);
    const [code, reason, det] = await recusa(cancelarTransferencia(x, t.s.id));
    assert.deepEqual([code, reason, det.lado, det.local_estoque_id], ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior', 'destino', x.barracao.id]);
    assert.deepEqual(await retrato(x), ret);

    const y = await cenario();
    await entrar(y, '100', '2');
    const u = await transferir(y, 40);
    await entrar(y, '1', '2');
    const [, r2, d2] = await recusa(cancelarTransferencia(y, u.r.id));
    assert.deepEqual([r2, d2.lado], ['movimento_posterior', 'origem']);

    const z = await cenario();
    await entrar(z, '100', '2');
    const t1 = await transferir(z, 40, z.galpao, z.barracao);
    const t2 = await transferir(z, 20, z.barracao, z.retiro);
    assert.deepEqual((await recusa(cancelarTransferencia(z, t1.s.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior']);
    await cancelarTransferencia(z, t2.s.id);
    assert.deepEqual((await recusa(cancelarTransferencia(z, t1.s.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'movimento_posterior']);
    await reconciliacaoLimpa(z);
  });

  test('identidade e estado: já cancelada, não é transferência, de outra empresa ou tenant (404), legado sem fatias, par incoerente', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const t = await transferir(x, 40);
    const r = await cancelarTransferencia(x, t.s.id);
    assert.deepEqual((await recusa(cancelarTransferencia(x, t.s.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'original_ja_estornado']);
    assert.deepEqual((await recusa(cancelarTransferencia(x, t.r.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'original_ja_estornado']);
    assert.deepEqual((await recusa(cancelarTransferencia(x, r.estornoDestino.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'nao_e_transferencia']);
    assert.deepEqual((await recusa(cancelarTransferencia(x, 'nao-existe'))).slice(0, 1), ['MOVIMENTACAO_ESTOQUE_NOT_FOUND']);

    const y = await cenario();
    await entrar(y, '100', '2');
    const u = await transferir(y, 40);
    const outraEmpresa = await prisma().empresa.create({ data: { cliente_id: y.c, numero_empresa: 2, apelido: 'E2', fuso_horario: 'America/Sao_Paulo', nome: `Outra ${y.c}` } });
    assert.deepEqual((await recusa(cancelarTransferencia(y, u.s.id, { empresaId: outraEmpresa.id }))).slice(0, 1), ['MOVIMENTACAO_ESTOQUE_NOT_FOUND']);
    const outro = await cenario();
    const ret = await retrato(y);
    const deOutro = await recusa(prisma().$transaction((tx) => estornarTransferenciaEstoque(tx, outro.ctx, { empresaId: outro.e.id, movimentoId: u.s.id, dia: DIA, motivo: 'x' })));
    assert.deepEqual(deOutro.slice(0, 1), ['MOVIMENTACAO_ESTOQUE_NOT_FOUND']);

    const fatias = (await mov(u.s.id)).lotes_consumidos;
    await prisma().movimentacaoEstoque.update({ where: { id: u.s.id }, data: { lotes_consumidos: fatias.map((f) => ({ lote_id: f.lote_id, quantidade: f.quantidade, custo_unitario: f.custo_unitario })) } });
    assert.deepEqual((await recusa(cancelarTransferencia(y, u.s.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'fatias_ausentes']);
    await prisma().movimentacaoEstoque.update({ where: { id: u.s.id }, data: { lotes_consumidos: fatias } });
    await prisma().movimentacaoEstoque.update({ where: { id: u.r.id }, data: { movimento_pai_id: null } });
    assert.deepEqual((await recusa(cancelarTransferencia(y, u.r.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'par_incoerente']);
    await prisma().movimentacaoEstoque.update({ where: { id: u.r.id }, data: { movimento_pai_id: u.s.id } });
    assert.deepEqual(await retrato(y), ret);
    const par = await prisma().$transaction((tx) => descobrirParDeTransferencia(tx, y.c, { empresaId: y.e.id, movimentoId: u.r.id }));
    assert.deepEqual([par.saida.id, par.entrada.id, par.origemId, par.destinoId], [u.s.id, u.r.id, y.galpao.id, y.barracao.id]);
  });

  test('concorrência: dois cancelamentos da mesma transferência ao mesmo tempo → um passa, o outro recusa; nada devolvido duas vezes', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const t = await transferir(x, 40);
    const rs = await Promise.allSettled([cancelarTransferencia(x, t.s.id), cancelarTransferencia(x, t.r.id)]);
    assert.equal(rs.filter((r) => r.status === 'fulfilled').length, 1);
    const falha = /** @type {any} */ (rs.find((r) => r.status === 'rejected')).reason;
    assert.equal(falha.code, 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO');
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c, tipo_detalhado: TIPO_ESTORNO_TRANSFERENCIA_ENVIADA } }), 1);
    proximo((await poco(x, x.galpao)).quantidade, 100, 0);
    await reconciliacaoLimpa(x);
  });

  test('cintos fora do protocolo: camada recebida mexida, linhagem trocada, saldo adulterado, lote da origem estornado; local de origem inativo (422) e destino inativo aceito', async () => {
    const x = await cenario();
    await entrar(x, '5', '1', x.barracao);
    await entrar(x, '100', '2');
    const t = await transferir(x, 40);
    const recebida = await prisma().estoqueLoteNota.findFirst({ where: { cliente_id: x.c, movimentacao_entrada_id: t.r.id } });
    const ret = await retrato(x);

    await prisma().estoqueLoteNota.update({ where: { id: recebida.id }, data: { quantidade_disponivel: '39' } });
    assert.deepEqual((await recusa(cancelarTransferencia(x, t.s.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'camada_consumida']);
    await prisma().estoqueLoteNota.update({ where: { id: recebida.id }, data: { quantidade_disponivel: '40' } });

    const vizinha = await prisma().estoqueLoteNota.findFirst({ where: { cliente_id: x.c, local_estoque_id: x.barracao.id, NOT: { movimentacao_entrada_id: t.r.id } } });
    await prisma().estoqueLoteNota.update({ where: { id: vizinha.id }, data: { quantidade_disponivel: '4' } });
    assert.deepEqual((await recusa(cancelarTransferencia(x, t.s.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'saldo_local_divergente']);
    await prisma().estoqueLoteNota.update({ where: { id: vizinha.id }, data: { quantidade_disponivel: '5' } });

    const fatias = (await mov(t.s.id)).lotes_consumidos;
    await prisma().movimentacaoEstoque.update({ where: { id: t.s.id }, data: { lotes_consumidos: fatias.map((f) => ({ ...f, lote_destino_id: vizinha.id })) } });
    assert.deepEqual((await recusa(cancelarTransferencia(x, t.s.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'linhagem_divergente']);
    await prisma().movimentacaoEstoque.update({ where: { id: t.s.id }, data: { lotes_consumidos: fatias } });

    const loteOrigem = fatias[0].lote_id;
    await prisma().estoqueLoteNota.update({ where: { id: loteOrigem }, data: { status: 'Estornado' } });
    assert.deepEqual((await recusa(cancelarTransferencia(x, t.s.id))).slice(0, 2), ['TRANSFERENCIA_CANCELAMENTO_BLOQUEADO', 'lote_indisponivel_para_devolucao']);
    await prisma().estoqueLoteNota.update({ where: { id: loteOrigem }, data: { status: ret.lotes.find((l) => l.id === loteOrigem).status } });

    await prisma().localEstoque.update({ where: { id: x.galpao.id }, data: { ativo: false } });
    const [code, reason, det] = await recusa(cancelarTransferencia(x, t.s.id));
    assert.deepEqual([code, reason, det.field], ['ESTOQUE_LOCAL_INVALIDO', 'local_inativo', 'local_origem_id']);
    await prisma().localEstoque.update({ where: { id: x.galpao.id }, data: { ativo: true } });
    assert.deepEqual(await retrato(x), ret);

    await prisma().localEstoque.update({ where: { id: x.barracao.id }, data: { ativo: false } });
    await cancelarTransferencia(x, t.s.id);
    await reconciliacaoLimpa(x);
  });
});

// ─── helper compartilhado ────────────────────────────────────────────────────

describe('D-PROD-267 motor — buscarMovimentoPosterior', () => {
  test('sem pares neutros é a regra da D-PROD-264 (qualquer movimento depois, inclusive o par de estorno); com pares neutros, o par Saída Estornada + estorno_* no mesmo depósito é descontado, a transferência não', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const m = await suplementar(x, 10);
    const ref = await mov(m.id);
    const busca = (neutros) => prisma().$transaction((tx) => buscarMovimentoPosterior(tx, x.c, {
      empresaId: x.e.id, produtoId: x.p.id, locais: [x.galpao.id], ignorarIds: [m.id], desde: { createdAt: ref.createdAt, numero: ref.numero_movimentacao }, ignorarParesNeutros: neutros,
    }));
    assert.equal(await busca(false), null);
    const n = await suplementar(x, 5);
    await cancelarCocho(x, n);
    const sem = await busca(false);
    assert.ok(sem && sem.local_estoque_id === x.galpao.id);
    assert.equal(await busca(true), null);
    const viaA = await prisma().$transaction((tx) => buscarMovimentoPosteriorA(tx, x.c, { empresaId: x.e.id, movimentoId: m.id, produtoId: x.p.id, localId: x.galpao.id }));
    assert.equal(viaA.id, sem.id);
    const t = await transferir(x, 3);
    assert.ok([t.s.id, t.r.id].includes((await busca(true)).id));
    await assert.rejects(prisma().$transaction((tx) => buscarMovimentoPosteriorA(tx, x.c, { empresaId: x.e.id, movimentoId: 'nao-existe', produtoId: x.p.id, localId: x.galpao.id })), { code: 'MOVIMENTACAO_ESTOQUE_NOT_FOUND' });
  });
});

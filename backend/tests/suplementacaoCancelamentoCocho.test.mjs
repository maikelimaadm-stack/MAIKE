/**
 * D-PROD-268 — cancelamento do lançamento de cocho (POST /suplementacao-eventos/:id/cancelamento e o
 * ensaio GET .../elegibilidade-cancelamento) e os escritores endurecidos (PATCH de fechamento do
 * evento e do lote, POST genérico, bulk, comando de lançamento com `evento_anterior_id`, GET sem
 * cancelados). PostgreSQL real + HTTP autenticado, montagem pelas rotas de sempre (entrada no
 * depósito, baixa do cocho, comando de lançamento, PATCH de fechamento com a mesma chave).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { cancelarLancamentoCocho } from '../src/modules/suplementacaoEventos/suplementacaoEventoCancelamentoService.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

/** Cliente do TESTE (pool próprio) para segurar travas de fora do app. @type {PrismaClient} */
let aux;
before(async () => {
  app = await criarApp();
  await app.ready();
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const chamar = (method, url, token, payload) => app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const qs = (obj) => '?' + new URLSearchParams(obj).toString();
const hojeReal = () => new Date().toISOString().slice(0, 10);
const op = (p = 'op') => `${p}-${randomUUID()}`;
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};

let seq = 0;
const cenario = async () => {
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e = await prisma().empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', fuso_horario: 'America/Sao_Paulo', nome: `Fazenda ${c}` } });
  const p = await prisma().produto.create({ data: { cliente_id: c, empresa_id: e.id, numero_produto: String(++seq + 1000), nome_produto: 'Sal mineral', unidade_principal_estoque: 'KG' } });
  const galpao = await prisma().localEstoque.create({ data: { cliente_id: c, numero_local: String(++seq + 5000), nome: 'Galpão' } });
  const { corpo } = await autenticarNoApp(app, adm.credenciais);
  const token = corpo.token;
  const compra = ok(await chamar('GET', '/estoque/motivos-entrada', token)).items.find((m) => m.nome === 'Compra').id;
  return { adm, c, e, p, galpao, token, compra, ponto: `ponto-${randomUUID().slice(0, 8)}` };
};

const entrar = async (x, kg, custo) =>
  ok(await chamar('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e.id, operation_id: op(), motivo_id: x.compra, data_entrada: hojeReal(),
    itens: [{ produto_id: x.p.id, local_estoque_id: x.galpao.id, unidade: 'KG', quantidade: kg, custo_unitario: custo }],
  }), 201);

const lotesDoEvento = async (x, eventoId) =>
  (await prisma().suplementacaoLote.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } })).filter((l) => l.dados?.suplementacao_evento_id === eventoId);
const evento = (id) => prisma().suplementacaoEvento.findUnique({ where: { id } });
const mov = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });

/**
 * Lançamento como o formulário: baixa do depósito (mesma chave) → comando → fechamento do anterior.
 * @param {any} x
 * @param {{ kg: number, sobra?: number, data: string, anterior?: any, fechar?: boolean, comDeposito?: boolean, ponto?: string, eventoAnteriorId?: string|null|undefined, chave?: string, area?: string }} o
 */
const lancar = async (x, { kg, sobra = 0, data, anterior = null, fechar = true, comDeposito = true, ponto = x.ponto, eventoAnteriorId, chave = op('lanc'), area = 'area-1' }) => {
  let movimentacao = null;
  if (comDeposito && kg > 0) {
    movimentacao = ok(await chamar('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
      operation_id: chave, empresa_id: x.e.id, produto_id: x.p.id, local_origem_id: x.galpao.id, quantidade: kg, ponto_suplementacao_id: ponto, data_movimentacao: data,
    }), 201).movimentacao;
  }
  const corpo = {
    operation_id: chave,
    evento: {
      empresa_id: x.e.id, ponto_suplementacao_id: ponto, ponto_nome: 'Cocho 1', area_id: area, area_ids: [area], data_lancamento: data,
      produto: 'Sal mineral', produto_id: x.p.id, quantidade_total_kg: kg, sobra_kg: sobra, dias_periodo: null, consumo_diario_grupo_kg: null,
      total_cabecas_afetadas: 10, movimentacao_estoque_id: movimentacao?.id ?? null, custo_unitario_kg: movimentacao ? Number(movimentacao.valor_unitario) : null,
    },
    lotes: [{ empresa_id: x.e.id, lote_id: 'lote-a', lote_nome: 'A', data_lancamento: data, percentual_consumo_lote: 1, dias_periodo: null, dias_ativos_periodo: null, animal_dias_periodo: null, consumo_unitario_dia: null, consumo_por_cabeca_dia_kg: null, consumo_total_lote_periodo_kg: null }],
    ...(eventoAnteriorId !== undefined ? { evento_anterior_id: eventoAnteriorId } : anterior !== null ? { evento_anterior_id: anterior.id } : {}),
  };
  const r = await chamar('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, corpo);
  const resposta = ok(r, 201);
  if (anterior && fechar) await fecharAnterior(x, anterior, resposta.evento, { sobra });
  return { evento: resposta.evento, mov: movimentacao, chave, corpo };
};

/** O fechamento do período anterior que o formulário grava (D-PROD-212 + D-PROD-268). */
const fecharAnterior = async (x, anterior, novo, { sobra, dias = 5, custo = 2.5, tipo = 'lancamento', semOrigem = false }) => {
  const patch = {
    sobra_kg: sobra, dias_periodo: dias, consumo_diario_grupo_kg: 4, custo_unitario_kg: custo, custo_total_periodo: 50,
    sobra_herdada_kg: Number(anterior.sobra_kg ?? 0), sobra_final_camadas: [{ kg: sobra, custo_kg: custo }], farol_consumo: 'dentro',
    ...(semOrigem ? {} : { fechado_por_tipo: tipo, ...(tipo === 'lancamento' ? { fechado_por_evento_id: novo.id } : {}) }),
  };
  ok(await chamar('PATCH', `/suplementacao-eventos/${anterior.id}`, x.token, patch));
  for (const l of await lotesDoEvento(x, anterior.id)) {
    ok(await chamar('PATCH', `/suplementacao-lotes/${l.id}`, x.token, {
      dias_periodo: dias, consumo_unitario_dia: 1, consumo_por_cabeca_dia_kg: 0.1, consumo_total_lote_periodo_kg: 20, percentual_consumo_lote: 0.9, animal_dias_periodo: 50, dias_ativos_periodo: dias,
    }));
  }
};

const cancelar = (x, id, { token = x.token, chave = op('canc'), motivo = 'lançado em dobro', empresa = x.e.id } = {}) =>
  chamar('POST', `/suplementacao-eventos/${id}/cancelamento`, token, { empresa_id: empresa, operation_id: chave, motivo });
const elegibilidade = (x, id, token = x.token) => chamar('GET', `/suplementacao-eventos/${id}/elegibilidade-cancelamento${qs({ empresa_id: x.e.id })}`, token);
const recusa = (r) => [r.statusCode, r.json().code, r.json().reason ?? r.json().details?.reason ?? null];

/** Poço (Disponivel) do galpão, em Number. */
const poco = async (x) => {
  const camadas = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, produto_id: x.p.id, local_estoque_id: x.galpao.id, status: 'Disponivel' } });
  return { quantidade: camadas.reduce((t, l) => t + Number(l.quantidade_disponivel), 0), valor: camadas.reduce((t, l) => t + Number(l.quantidade_disponivel) * Number(l.custo_unitario), 0) };
};
const estoqueAtual = async (x) => (await prisma().produto.findUnique({ where: { id: x.p.id } })).estoque_atual.toString();
const proximo = (v, esperado, tol = 0.01) => assert.ok(Math.abs(v - esperado) <= tol, `${v} ≉ ${esperado}`);

/** Retrato de tudo que uma recusa não pode ter mudado. */
const retrato = async (x) => ({
  movimentos: await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, movimento_filho_id: true, numero_movimentacao: true } }),
  camadas: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, status: true, quantidade_disponivel: true } }),
  produtos: await prisma().produto.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true } }),
  eventos: await prisma().suplementacaoEvento.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, dados: true } }),
  lotes: await prisma().suplementacaoLote.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' }, select: { id: true, dados: true } }),
  auditoria: await prisma().auditLog.count({ where: { cliente_id: x.c } }),
  recibos: await prisma().operacaoIdempotente.count({ where: { cliente_id: x.c } }),
  sequencias: JSON.stringify(await prisma().entidadeCodigoSequencia.findMany({ where: { cliente_id: x.c }, orderBy: { id: 'asc' } })),
});

const reconciliacaoLimpa = async (x) => {
  const rec = ok(await chamar('GET', `/estoque-fisico/reconciliacao${qs({ empresa_id: x.e.id })}`, x.token));
  assert.deepEqual(rec.achados, [], JSON.stringify(rec).slice(0, 1500));
};

/** Campos do fechamento que a reabertura restaura (comparação sem os metadados). */
const semMeta = (dados) => {
  const resto = { ...dados };
  delete resto.reaberto_por_cancelamento;
  return resto;
};

/** Conta comum (papel `usuario`) com a linha de Permissão do mapa. */
const conta = async (x, { mapa = {}, isAdmin = false } = {}) => {
  const hash = (await prisma().usuario.findUnique({ where: { id: x.adm.usuario.id } })).senha_hash;
  const login = `op-${randomUUID().slice(0, 8)}`;
  const usuario = await prisma().usuario.create({ data: { cliente_id: x.c, nome: 'Operador', login, senha_hash: hash, papel_tenant: 'usuario' } });
  const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
  await prisma().permissao.create({
    data: {
      cliente_id: x.c, user_email: login, user_nome: 'Operador', is_admin: isAdmin, modulos_permitidos: ['mapa'],
      permissoes_telas: [{ modulo_id: 'mapa', tela_id: 'pec-mapa-geral', ...acoes(false), visualizar: true }], mapa_geral_permissoes: mapa,
    },
  });
  const { corpo } = await autenticarNoApp(app, { login, senha: x.adm.credenciais.senha });
  assert.ok(corpo.token, 'login do operador');
  return { token: corpo.token, login, usuarioId: usuario.id };
};

/** N-2 (30 kg), N-1 (30 kg, sobra 10, fecha N-2) e N (20 kg, sobra 8, fecha N-1), poço de 100 kg a R$ 2. */
const tresLancamentos = async (x, { area = 'area-1' } = {}) => {
  await entrar(x, '100', '2');
  const n2 = await lancar(x, { kg: 30, data: '2027-06-01', area });
  const n1 = await lancar(x, { kg: 30, sobra: 10, data: '2027-06-05', anterior: n2.evento, area });
  const antesDeN = {
    poco: await poco(x), estoque: await estoqueAtual(x),
    n1: (await evento(n1.evento.id)).dados, lotesN1: (await lotesDoEvento(x, n1.evento.id)).map((l) => l.dados), n2: (await evento(n2.evento.id)).dados,
  };
  const n = await lancar(x, { kg: 20, sobra: 8, data: '2027-06-10', anterior: n1.evento, area });
  return { n2, n1, n, antesDeN };
};

describe('D-PROD-268 — cancelar lançamento de cocho: caminho feliz', () => {
  test('estorno exato, N e rateio cancelados, N-1 reaberto ao retrato de antes de N, auditoria, GET sem cancelados, reconciliação limpa', async () => {
    const x = await cenario();
    const { n2, n1, n, antesDeN } = await tresLancamentos(x);
    assert.equal((await evento(n1.evento.id)).dados.fechado_por_evento_id, n.evento.id);
    assert.equal(await estoqueAtual(x), '20');

    const corpo = ok(await cancelar(x, n.evento.id));
    assert.equal(corpo.replay, false);
    assert.equal(corpo.evento.situacao, 'cancelado');
    assert.equal(corpo.lotes_cancelados, 1);
    assert.equal(corpo.estorno.movimentacao_original_id, n.mov.id);
    assert.equal(corpo.periodo_reaberto.evento_id, n1.evento.id);
    assert.equal(corpo.periodo_reaberto.sobra_inicial_restaurada_kg, 10);

    // Estoque: poço, estoque_atual, M Estornada com filho, Entrada estorno_suplementacao numerada.
    const depois = await poco(x);
    proximo(depois.quantidade, antesDeN.poco.quantidade, 0.0001);
    proximo(depois.valor, antesDeN.poco.valor, 0.0001 * depois.quantidade);
    assert.equal(await estoqueAtual(x), antesDeN.estoque);
    const m = await mov(n.mov.id);
    const estorno = await mov(corpo.estorno.movimentacao_estorno_id);
    assert.deepEqual([m.status, m.movimento_filho_id], ['Estornada', estorno.id]);
    assert.deepEqual([estorno.tipo_movimentacao, estorno.tipo_detalhado, estorno.movimento_pai_id, estorno.lancamento_origem_id], ['Entrada', 'estorno_suplementacao', m.id, n.evento.id]);
    assert.equal(estorno.valor_total.toString(), m.valor_total.toString());
    assert.match(estorno.numero_movimentacao, /^[0-9]+$/);

    // Documentos: N e o rateio de N cancelados (sem exclusão física); N-1 de volta; N-2 intocado.
    const N = await evento(n.evento.id);
    assert.equal(N.dados.situacao, 'cancelado');
    assert.equal(N.dados.cancelamento.motivo, 'lançado em dobro');
    assert.equal(N.dados.cancelamento.movimentacao_estorno_id, estorno.id);
    assert.ok((await lotesDoEvento(x, n.evento.id)).every((l) => l.dados.situacao === 'cancelado'));
    const N1 = await evento(n1.evento.id);
    assert.deepEqual(semMeta(N1.dados), antesDeN.n1);
    assert.equal(N1.dados.sobra_kg, 10);
    assert.equal(N1.dados.dias_periodo, null);
    assert.equal(N1.dados.fechado_por_evento_id, undefined);
    assert.equal(N1.dados.reaberto_por_cancelamento.evento_cancelado_id, n.evento.id);
    assert.deepEqual((await lotesDoEvento(x, n1.evento.id)).map((l) => l.dados), antesDeN.lotesN1);
    assert.deepEqual((await evento(n2.evento.id)).dados, antesDeN.n2);

    // Auditoria.
    const acoes = (await prisma().auditLog.findMany({ where: { cliente_id: x.c, acao: { in: ['cancelamento', 'reabertura', 'estorno'] } } })).map((a) => `${a.acao}:${a.entidade}`).sort();
    assert.deepEqual(acoes, ['cancelamento:SuplementacaoEvento', 'cancelamento:SuplementacaoLote', 'estorno:MovimentacaoEstoque', 'reabertura:SuplementacaoEvento', 'reabertura:SuplementacaoLote']);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: x.c, acao: 'create', entidade: 'MovimentacaoEstoque', entidade_id: estorno.id } }), 1);

    // GET omite os cancelados.
    const eventos = ok(await chamar('GET', `/suplementacao-eventos${qs({ empresa_id: x.e.id })}`, x.token));
    assert.deepEqual(eventos.map((e) => e.id).sort(), [n2.evento.id, n1.evento.id].sort());
    const lotes = ok(await chamar('GET', `/suplementacao-lotes${qs({ empresa_id: x.e.id, limit: '50' })}`, x.token));
    assert.ok(lotes.every((l) => l.suplementacao_evento_id !== n.evento.id));
    assert.equal(lotes.length, 2);
    await reconciliacaoLimpa(x);

    // Idempotência e replays.
    const chave = corpo.operation_id;
    const replay = ok(await cancelar(x, n.evento.id, { chave }));
    assert.equal(replay.replay, true);
    assert.equal(replay.estorno.movimentacao_estorno_id, estorno.id);
    assert.deepEqual(recusa(await cancelar(x, n.evento.id, { chave, motivo: 'outro motivo' })), [409, 'IDEMPOTENCY_CONFLICT', null]);
    assert.deepEqual(recusa(await cancelar(x, n.evento.id)), [409, 'CANCELAMENTO_JA_REALIZADO', null]);
    const movimentos = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
    const saidaReplay = await chamar('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
      operation_id: n.chave, empresa_id: x.e.id, produto_id: x.p.id, local_origem_id: x.galpao.id, quantidade: 20, ponto_suplementacao_id: x.ponto, data_movimentacao: '2027-06-10',
    });
    // A baixa foi estornada pelo cancelamento: o replay dela recusa (409) e não grava nada.
    assert.deepEqual(
      [saidaReplay.statusCode, saidaReplay.json().code, saidaReplay.json().reason],
      [409, 'SUPLEMENTACAO_REGISTRO_CANCELADO', 'saida_estornada'],
      saidaReplay.body
    );
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }), movimentos);

    // O cocho segue: um lançamento novo fecha N-1 normalmente (evento_anterior_id = N-1).
    const novo = await lancar(x, { kg: 5, sobra: 7, data: '2027-06-12', anterior: n1.evento });
    const N1b = await evento(n1.evento.id);
    assert.equal(N1b.dados.fechado_por_evento_id, novo.evento.id);
    assert.equal(N1b.dados.sobra_kg, 7);
    await reconciliacaoLimpa(x);
  });

  test('cancelar N e depois N-1 (par neutro no depósito): o poço volta ao de antes de N-1 e N-2 é reaberto', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    await entrar(x, '50', '5');
    const n2 = await lancar(x, { kg: 30, data: '2027-06-01' });
    const antesDeN1 = { poco: await poco(x), estoque: await estoqueAtual(x), n2: (await evento(n2.evento.id)).dados };
    const n1 = await lancar(x, { kg: 90, sobra: 10, data: '2027-06-05', anterior: n2.evento });
    const n = await lancar(x, { kg: 20, sobra: 8, data: '2027-06-10', anterior: n1.evento });
    ok(await cancelar(x, n.evento.id));
    const segundo = ok(await cancelar(x, n1.evento.id));
    assert.equal(segundo.periodo_reaberto.evento_id, n2.evento.id);
    const depois = await poco(x);
    proximo(depois.quantidade, antesDeN1.poco.quantidade, 0.0001);
    proximo(depois.valor, antesDeN1.poco.valor, 0.01);
    assert.equal(await estoqueAtual(x), antesDeN1.estoque);
    assert.deepEqual(semMeta((await evento(n2.evento.id)).dados), antesDeN1.n2);
    await reconciliacaoLimpa(x);
    // Relança: a cadeia continua (N-2 fecha de novo pelo lançamento novo).
    const novo = await lancar(x, { kg: 10, sobra: 3, data: '2027-06-06', anterior: n2.evento });
    assert.equal((await evento(n2.evento.id)).dados.fechado_por_evento_id, novo.evento.id);
  });
});

describe('D-PROD-268 — período anterior', () => {
  test('sem anterior; anterior aberto (fechamento falhou); anterior fechado ANTES pela movimentação do gado', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const so = await lancar(x, { kg: 10, data: '2027-06-01' });
    const r1 = ok(await cancelar(x, so.evento.id));
    assert.equal(r1.periodo_reaberto, null);

    const a = await lancar(x, { kg: 10, data: '2027-06-02' });
    const b = await lancar(x, { kg: 10, data: '2027-06-03', anterior: a.evento, fechar: false });
    const r2 = ok(await cancelar(x, b.evento.id));
    assert.equal(r2.periodo_reaberto, null);
    assert.equal((await evento(a.evento.id)).dados.dias_periodo, null);

    // a: fechado pela movimentação do gado (era o último), depois b é lançado.
    await fecharAnterior(x, a.evento, null, { sobra: 4, tipo: 'movimentacao_gado' });
    const fechadoA = (await evento(a.evento.id)).dados;
    const c = await lancar(x, { kg: 10, sobra: 4, data: '2027-06-04', anterior: a.evento, fechar: false });
    const r3 = ok(await cancelar(x, c.evento.id));
    assert.equal(r3.periodo_reaberto, null);
    assert.deepEqual((await evento(a.evento.id)).dados, fechadoA);
    await reconciliacaoLimpa(x);
  });

  test('prova legada pelo AuditLog: mesmo usuário em até 300 s e mesma sobra reabre; outro usuário, sobra diferente ou update depois recusam', async () => {
    const montar = async ({ usuarioOutro = false, sobraAudit = 8, atrasoMs = 1000 } = {}) => {
      const x = await cenario();
      await entrar(x, '100', '2');
      const n1 = await lancar(x, { kg: 30, data: '2027-06-05' });
      const antes = (await evento(n1.evento.id)).dados;
      const n = await lancar(x, { kg: 20, sobra: 8, data: '2027-06-10', anterior: n1.evento, fechar: false });
      // Dado antigo: o fechamento gravado direto (sem fechado_por_*) com o AuditLog do PATCH de antes.
      const fechado = { ...antes, sobra_kg: 8, dias_periodo: 5, consumo_diario_grupo_kg: 4, custo_unitario_kg: 2.5 };
      await prisma().suplementacaoEvento.update({ where: { id: n1.evento.id }, data: { dados: fechado } });
      const criacao = await prisma().auditLog.findFirst({ where: { cliente_id: x.c, entidade: 'SuplementacaoEvento', entidade_id: n.evento.id, acao: 'create' } });
      const outro = usuarioOutro ? await conta(x) : null;
      await prisma().auditLog.create({
        data: {
          cliente_id: x.c, usuario_id: outro ? outro.usuarioId : criacao.usuario_id, acao: 'update', entidade: 'SuplementacaoEvento', entidade_id: n1.evento.id,
          dados_anteriores: { ...antes, id: n1.evento.id }, dados_novos: { ...fechado, sobra_kg: sobraAudit, id: n1.evento.id }, request_id: 'legado',
          createdAt: new Date(criacao.createdAt.getTime() + atrasoMs),
        },
      });
      return { x, n1, n, antes };
    };
    const ok1 = await montar();
    const r = ok(await cancelar(ok1.x, ok1.n.evento.id));
    assert.equal(r.periodo_reaberto.evento_id, ok1.n1.evento.id);
    assert.deepEqual(semMeta((await evento(ok1.n1.evento.id)).dados), ok1.antes);

    for (const caso of [{ usuarioOutro: true }, { sobraAudit: 9 }, { atrasoMs: 301_000 }]) {
      const m = await montar(caso);
      const antes = await retrato(m.x);
      assert.deepEqual(recusa(await cancelar(m.x, m.n.evento.id)), [409, 'SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'periodo_anterior_nao_comprovado'], JSON.stringify(caso));
      assert.deepEqual(await retrato(m.x), antes);
    }

    // Update depois do fechamento (deriva) → periodo_anterior_alterado.
    const d = await montar();
    ok(await chamar('PATCH', `/suplementacao-eventos/${d.n1.evento.id}`, d.x.token, { consumo_g_cab_dia: 123 }));
    assert.deepEqual(recusa(await cancelar(d.x, d.n.evento.id)), [409, 'SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'periodo_anterior_alterado']);
  });
});

describe('D-PROD-268 — recusas (nada muda)', () => {
  const exigirRecusa = async (x, id, reason, code = 'SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', status = 409) => {
    const antes = await retrato(x);
    assert.deepEqual(recusa(await cancelar(x, id)), [status, code, reason]);
    const eleg = ok(await elegibilidade(x, id));
    assert.deepEqual([eleg.elegivel, eleg.codigo, eleg.reason], [false, code, reason]);
    assert.deepEqual(await retrato(x), antes);
  };

  test('lancamento_posterior (por data e por cadastro) e periodo_fechado (evento ou lote)', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const b = await lancar(x, { kg: 10, data: '2027-06-08' });
    const a = await lancar(x, { kg: 10, data: '2027-06-02' });
    await exigirRecusa(x, b.evento.id, 'lancamento_posterior');
    await exigirRecusa(x, a.evento.id, 'lancamento_posterior');

    const y = await cenario();
    await entrar(y, '100', '2');
    const u = await lancar(y, { kg: 10, data: '2027-06-02' });
    await fecharAnterior(y, u.evento, null, { sobra: 2, tipo: 'movimentacao_gado' });
    await exigirRecusa(y, u.evento.id, 'periodo_fechado');
  });

  test('gado_movimentado (e passa quando a movimentação está cancelada); sem_recibo; rateio_divergente', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const n = await lancar(x, { kg: 10, data: '2027-06-02' });
    const mm = await prisma().movimentacaoMapa.create({ data: { cliente_id: x.c, empresa_id: x.e.id, dados: { tipo: 'Transferência de Área', area_origem_id: 'area-1', area_destino_id: 'area-9' } } });
    await exigirRecusa(x, n.evento.id, 'gado_movimentado');
    await prisma().movimentacaoMapa.update({ where: { id: mm.id }, data: { dados: { ...mm.dados, situacao: 'cancelado' } } });
    ok(await cancelar(x, n.evento.id));

    const generico = ok(await chamar('POST', '/suplementacao-eventos', x.token, {
      empresa_id: x.e.id, ponto_suplementacao_id: x.ponto, ponto_nome: 'Cocho 1', area_id: 'area-2', data_lancamento: '2027-06-03', quantidade_total_kg: 0, sobra_kg: 3, dias_periodo: null,
    }), 201);
    await exigirRecusa(x, generico.id, 'sem_recibo');

    const y = await cenario();
    await entrar(y, '100', '2');
    const r = await lancar(y, { kg: 10, data: '2027-06-02' });
    ok(await chamar('POST', '/suplementacao-lotes/bulk', y.token, { registros: [{ empresa_id: y.e.id, suplementacao_evento_id: r.evento.id, lote_id: 'lote-b', dias_periodo: null }] }), 201);
    await exigirRecusa(y, r.evento.id, 'rateio_divergente');
  });

  test('saida_nao_comprovada (id forjado, baixa órfã, quantidade divergente, citada por 2 eventos); saida_sem_fatias; movimento_estornado', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    // Uma saída de outro lançamento, citada no corpo do evento deste (sem o recibo da mesma chave).
    const alheia = ok(await chamar('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
      operation_id: op(), empresa_id: x.e.id, produto_id: x.p.id, local_origem_id: x.galpao.id, quantidade: 5, ponto_suplementacao_id: x.ponto,
    }), 201).movimentacao;
    const forjado = ok(await chamar('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, {
      operation_id: op(), evento: { empresa_id: x.e.id, ponto_suplementacao_id: x.ponto, data_lancamento: '2027-06-02', produto_id: x.p.id, quantidade_total_kg: 5, movimentacao_estoque_id: alheia.id }, lotes: [],
    }), 201).evento;
    await exigirRecusa(x, forjado.id, 'saida_nao_comprovada');

    const y = await cenario();
    await entrar(y, '100', '2');
    const orfa = await lancar(y, { kg: 10, data: '2027-06-02' });
    await prisma().suplementacaoEvento.update({ where: { id: orfa.evento.id }, data: { dados: { ...(await evento(orfa.evento.id)).dados, movimentacao_estoque_id: null } } });
    await exigirRecusa(y, orfa.evento.id, 'saida_nao_comprovada');

    const z = await cenario();
    await entrar(z, '100', '2');
    const q = await lancar(z, { kg: 10, data: '2027-06-02' });
    await prisma().suplementacaoEvento.update({ where: { id: q.evento.id }, data: { dados: { ...(await evento(q.evento.id)).dados, quantidade_total_kg: 11 } } });
    await exigirRecusa(z, q.evento.id, 'saida_nao_comprovada');
    await prisma().suplementacaoEvento.update({ where: { id: q.evento.id }, data: { dados: { ...(await evento(q.evento.id)).dados, quantidade_total_kg: 10 } } });
    const dupla = await prisma().suplementacaoEvento.create({ data: { cliente_id: z.c, empresa_id: z.e.id, dados: { ponto_suplementacao_id: 'outro', movimentacao_estoque_id: q.mov.id } } });
    await exigirRecusa(z, q.evento.id, 'saida_nao_comprovada');
    await prisma().suplementacaoEvento.update({ where: { id: dupla.id }, data: { dados: { ponto_suplementacao_id: 'outro', movimentacao_estoque_id: null } } });

    const fatias = (await mov(q.mov.id)).lotes_consumidos;
    await prisma().movimentacaoEstoque.update({ where: { id: q.mov.id }, data: { lotes_consumidos: [] } });
    await exigirRecusa(z, q.evento.id, 'saida_sem_fatias');
    await prisma().movimentacaoEstoque.update({ where: { id: q.mov.id }, data: { lotes_consumidos: fatias, status: 'Estornada' } });
    await exigirRecusa(z, q.evento.id, 'movimento_estornado');
    await prisma().movimentacaoEstoque.update({ where: { id: q.mov.id }, data: { status: 'Ativa' } });
    ok(await cancelar(z, q.evento.id));
  });

  test('D-PROD-313: compra ou baixa de outro cocho depois → 409 registro posterior (nada muda); excluído o mais recente, o cancelamento passa pelo estorno exato; camada estornada → lote_indisponivel_para_devolucao', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const n = await lancar(x, { kg: 10, data: '2027-06-02' });
    const compra = await entrar(x, '10', '3');
    const movCompra = compra.itens[0].movimentacao_estoque_id;
    await exigirRecusa(x, n.evento.id, 'registro_posterior', 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR');
    const jx = (await cancelar(x, n.evento.id)).json();
    assert.deepEqual([jx.details.posterior_id, jx.details.local_estoque_id], [movCompra, x.galpao.id], JSON.stringify(jx.details));
    assert.equal(ok(await elegibilidade(x, n.evento.id)).detalhes.posterior_id, movCompra);
    // exclui primeiro a compra (a mais recente); o cocho sai depois: o poço volta a 100 a R$ 2
    ok(await chamar('POST', `/estoque/entradas/${compra.id}/excluir`, x.token, { empresa_id: x.e.id, versao: compra.versao, motivo: 'lançada errada', operation_id: op('ex') }));
    ok(await cancelar(x, n.evento.id));
    assert.equal(await estoqueAtual(x), '100');
    proximo((await poco(x)).quantidade, 100);
    proximo((await poco(x)).valor, 200);
    await reconciliacaoLimpa(x);

    const y = await cenario();
    await entrar(y, '100', '2');
    const m = await lancar(y, { kg: 10, data: '2027-06-02' });
    const outro = await lancar(y, { kg: 5, data: '2027-06-02', ponto: 'outro-cocho' });
    await exigirRecusa(y, m.evento.id, 'registro_posterior', 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR');
    assert.equal((await cancelar(y, m.evento.id)).json().details.posterior_id, outro.mov.id);
    // exclui primeiro a baixa do outro cocho (a mais recente); depois o primeiro sai
    ok(await cancelar(y, outro.evento.id));
    ok(await cancelar(y, m.evento.id));
    assert.equal(await estoqueAtual(y), '100');
    proximo((await poco(y)).valor, 200);
    await reconciliacaoLimpa(y);

    const z = await cenario();
    await entrar(z, '100', '2');
    const k = await lancar(z, { kg: 10, data: '2027-06-02' });
    const camadas = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: z.c } });
    await prisma().estoqueLoteNota.updateMany({ where: { cliente_id: z.c }, data: { status: 'Estornado' } });
    await exigirRecusa(z, k.evento.id, 'lote_indisponivel_para_devolucao');
    for (const c of camadas) await prisma().estoqueLoteNota.update({ where: { id: c.id }, data: { status: c.status } });
  });

  test('lançamento sem depósito (só sobra) cancela sem tocar no estoque', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const antes = { poco: await poco(x), estoque: await estoqueAtual(x) };
    const s = await lancar(x, { kg: 0, sobra: 5, data: '2027-06-02' });
    const r = ok(await cancelar(x, s.evento.id));
    assert.equal(r.estorno, null);
    assert.deepEqual({ poco: await poco(x), estoque: await estoqueAtual(x) }, antes);
  });
});

describe('D-PROD-268 — elegibilidade, permissão e tenancy', () => {
  test('elegibilidade: efeitos do ensaio e NADA gravado', async () => {
    const x = await cenario();
    const { n } = await tresLancamentos(x);
    const antes = await retrato(x);
    const e = ok(await elegibilidade(x, n.evento.id));
    assert.deepEqual([e.elegivel, e.pode_cancelar_permissao, e.codigo], [true, true, null]);
    assert.equal(e.efeitos.estorno.quantidade, '20.0000');
    assert.equal(e.efeitos.estorno.local_nome, 'Galpão');
    assert.equal(e.efeitos.periodo_reaberto.sobra_inicial_restaurada_kg, 10);
    assert.equal(e.efeitos.lotes_a_cancelar, 1);
    assert.deepEqual(await retrato(x), antes);
  });

  test('permissão: operador sem a chave 403 nas duas rotas; com a chave ou is_admin passa; revogada antes da transação 403', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const a = await lancar(x, { kg: 5, data: '2027-06-01' });
    const sem = await conta(x, { mapa: { lancar_suplementacao: true } });
    assert.equal((await cancelar(x, a.evento.id, { token: sem.token })).statusCode, 403);
    assert.equal((await elegibilidade(x, a.evento.id, sem.token)).statusCode, 403);
    const com = await conta(x, { mapa: { cancelar_lancamentos_estoque: true } });
    assert.equal(ok(await elegibilidade(x, a.evento.id, com.token)).elegivel, true);
    ok(await cancelar(x, a.evento.id, { token: com.token }));

    const b = await lancar(x, { kg: 5, data: '2027-06-02' });
    const adminConcessao = await conta(x, { isAdmin: true });
    ok(await cancelar(x, b.evento.id, { token: adminConcessao.token }));

    // Revogada entre o preHandler e a transação: o serviço relê a regra dentro dela.
    const c = await lancar(x, { kg: 5, data: '2027-06-03' });
    await prisma().permissao.updateMany({ where: { cliente_id: x.c, user_email: com.login }, data: { mapa_geral_permissoes: {} } });
    const ctx = { requestId: 'r', auth: { clienteId: x.c, usuarioId: com.usuarioId, login: com.login } };
    await assert.rejects(cancelarLancamentoCocho(ctx, c.evento.id, { empresa_id: x.e.id, operation_id: op(), motivo: 'teste' }), (e) => e.code === 'ACAO_NAO_PERMITIDA');
  });

  test('tenancy: evento de outro tenant 404; empresa de outro tenant 404 EMPRESA_NOT_FOUND; corpo fechado (cliente_id) 400; motivo curto 400', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const a = await lancar(x, { kg: 5, data: '2027-06-01' });
    const y = await cenario();
    assert.deepEqual(recusa(await cancelar(y, a.evento.id)), [404, 'SUPLEMENTACAOEVENTO_NOT_FOUND', null]);
    assert.equal((await cancelar(x, a.evento.id, { empresa: y.e.id })).json().code, 'EMPRESA_NOT_FOUND');
    const comTenant = await chamar('POST', `/suplementacao-eventos/${a.evento.id}/cancelamento`, x.token, { empresa_id: x.e.id, operation_id: op(), motivo: 'teste', cliente_id: y.c });
    assert.equal(comTenant.statusCode, 400);
    assert.equal((await cancelar(x, a.evento.id, { motivo: '  a ' })).statusCode, 400);
    assert.equal((await evento(a.evento.id)).dados.situacao, undefined);
  });
});

describe('D-PROD-268 — escritores endurecidos', () => {
  test('PATCH de fechamento confere quem fechou; cancelado não aceita PATCH; lote só fecha com o evento fechado', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const a = await lancar(x, { kg: 10, data: '2027-06-01' });
    const b = await lancar(x, { kg: 10, sobra: 3, data: '2027-06-02', anterior: a.evento, fechar: false });
    const patchA = (extra) => chamar('PATCH', `/suplementacao-eventos/${a.evento.id}`, x.token, { sobra_kg: 3, dias_periodo: 1, ...extra });
    assert.deepEqual(recusa(await patchA({})), [409, 'LANCAMENTO_DESATUALIZADO', 'fechado_por_ausente']);
    assert.deepEqual(recusa(await patchA({ fechado_por_tipo: 'lancamento', fechado_por_evento_id: a.evento.id })), [409, 'LANCAMENTO_DESATUALIZADO', 'nao_e_o_predecessor']);
    assert.deepEqual(recusa(await patchA({ fechado_por_tipo: 'lancamento', fechado_por_evento_id: 'nao-existe' })), [409, 'LANCAMENTO_DESATUALIZADO', 'lancamento_inexistente_ou_cancelado']);
    assert.deepEqual(recusa(await patchA({ fechado_por_tipo: 'lancamento', fechado_por_evento_id: b.evento.id, sobra_kg: 4 })), [409, 'LANCAMENTO_DESATUALIZADO', 'sobra_divergente']);
    assert.deepEqual(recusa(await patchA({ fechado_por_tipo: 'movimentacao_gado' })), [409, 'LANCAMENTO_DESATUALIZADO', 'nao_e_o_ultimo']);
    assert.equal((await patchA({ fechado_por_tipo: 'qualquer' })).statusCode, 400);
    const [loteA] = await lotesDoEvento(x, a.evento.id);
    assert.deepEqual(recusa(await chamar('PATCH', `/suplementacao-lotes/${loteA.id}`, x.token, { dias_periodo: 1 })), [409, 'LANCAMENTO_DESATUALIZADO', 'evento_aberto']);

    // b cancelado: o fechamento atrasado de a em nome de b é recusado; PATCH em b e no lote de b também.
    ok(await cancelar(x, b.evento.id));
    assert.deepEqual(recusa(await patchA({ fechado_por_tipo: 'lancamento', fechado_por_evento_id: b.evento.id })), [409, 'LANCAMENTO_DESATUALIZADO', 'lancamento_inexistente_ou_cancelado']);
    assert.deepEqual(recusa(await chamar('PATCH', `/suplementacao-eventos/${b.evento.id}`, x.token, { consumo_g_cab_dia: 1 })), [409, 'SUPLEMENTACAO_REGISTRO_CANCELADO', null]);
    const [loteB] = await lotesDoEvento(x, b.evento.id);
    assert.deepEqual(recusa(await chamar('PATCH', `/suplementacao-lotes/${loteB.id}`, x.token, { dias_periodo: null })), [409, 'SUPLEMENTACAO_REGISTRO_CANCELADO', null]);
    assert.deepEqual(recusa(await chamar('POST', '/suplementacao-lotes', x.token, { empresa_id: x.e.id, suplementacao_evento_id: b.evento.id, lote_id: 'z' })), [409, 'SUPLEMENTACAO_REGISTRO_CANCELADO', null]);
    // DELETE continua morto.
    assert.equal((await chamar('DELETE', `/suplementacao-eventos/${a.evento.id}`, x.token)).json().code, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO');
  });

  test('campos reservados recusados (400) no POST, no bulk e no comando; payloads atuais aceitos', async () => {
    const x = await cenario();
    for (const campo of ['situacao', 'cancelamento', 'reaberto_por_cancelamento', 'fechado_por_tipo', 'fechado_por_evento_id']) {
      assert.deepEqual(recusa(await chamar('POST', '/suplementacao-eventos', x.token, { empresa_id: x.e.id, ponto_suplementacao_id: x.ponto, [campo]: 'x' })), [400, 'CAMPO_RESERVADO_CANCELAMENTO', null], campo);
      assert.equal((await chamar('POST', '/suplementacao-lotes/bulk', x.token, { registros: [{ empresa_id: x.e.id, lote_id: 'l', [campo]: 'x' }] })).statusCode, 400, campo);
      const cmd = await chamar('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, { operation_id: op(), evento: { empresa_id: x.e.id, ponto_suplementacao_id: x.ponto, [campo]: 'x' }, lotes: [] });
      assert.equal(cmd.json().code, 'CAMPO_RESERVADO_CANCELAMENTO', campo);
    }
    ok(await chamar('POST', '/suplementacao-eventos', x.token, { empresa_id: x.e.id, ponto_suplementacao_id: x.ponto, quantidade_total_kg: 0, sobra_kg: 2, dias_periodo: null }), 201);
  });

  test('lançamento com evento_anterior_id desatualizado: 409 sem gravar nada; o reenvio com a MESMA chave e o anterior certo passa', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const a = await lancar(x, { kg: 10, data: '2027-06-01' });
    const b = await lancar(x, { kg: 10, data: '2027-06-02', anterior: a.evento });
    ok(await cancelar(x, b.evento.id));
    const chave = op('lanc');
    const corpo = (anterior) => ({ operation_id: chave, evento: { empresa_id: x.e.id, ponto_suplementacao_id: x.ponto, data_lancamento: '2027-06-03', quantidade_total_kg: 0, sobra_kg: 1 }, lotes: [], evento_anterior_id: anterior });
    const antes = await retrato(x);
    const r1 = await chamar('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, corpo(b.evento.id));
    assert.deepEqual([r1.statusCode, r1.json().code, r1.json().details.evento_anterior_id], [409, 'LANCAMENTO_DESATUALIZADO', a.evento.id]);
    assert.deepEqual(await retrato(x), antes);
    ok(await chamar('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, corpo(a.evento.id)), 201);
    // Sem evento_anterior_id (aba antiga) continua aceito.
    ok(await chamar('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, { ...corpo(null), operation_id: op(), evento_anterior_id: undefined }), 201);
  });
});

describe('D-PROD-268 — concorrência', () => {
  test('dois cancelamentos com chaves diferentes: um passa, o outro CANCELAMENTO_JA_REALIZADO; um estorno só', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const a = await lancar(x, { kg: 10, data: '2027-06-01' });
    const [r1, r2] = await Promise.all([cancelar(x, a.evento.id), cancelar(x, a.evento.id)]);
    assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409]);
    assert.equal([r1, r2].find((r) => r.statusCode === 409).json().code, 'CANCELAMENTO_JA_REALIZADO');
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c, tipo_detalhado: 'estorno_suplementacao' } }), 1);
    await reconciliacaoLimpa(x);
  });

  test('cancelar × fechamento atrasado do anterior: em qualquer ordem o anterior termina aberto e o estoque fecha', async () => {
    const x = await cenario();
    await entrar(x, '100', '2');
    const a = await lancar(x, { kg: 10, data: '2027-06-01' });
    const b = await lancar(x, { kg: 10, sobra: 3, data: '2027-06-02', anterior: a.evento, fechar: false });
    const [canc, patch] = await Promise.all([
      cancelar(x, b.evento.id),
      chamar('PATCH', `/suplementacao-eventos/${a.evento.id}`, x.token, { sobra_kg: 3, dias_periodo: 1, fechado_por_tipo: 'lancamento', fechado_por_evento_id: b.evento.id }),
    ]);
    assert.equal(canc.statusCode, 200, canc.body);
    assert.ok([200, 409].includes(patch.statusCode), patch.body);
    assert.equal((await evento(a.evento.id)).dados.dias_periodo, null);
    assert.equal(await estoqueAtual(x), '90');
    await reconciliacaoLimpa(x);
  });
});

// ─── Revisão: replay de lançamento cancelado, corrida com o gado, concorrência real ─────────

/**
 * Abre uma transação no cliente do teste, roda `passo` (que toma travas) e a segura aberta até
 * `soltar()`. Um erro em `passo` rejeita na hora (não pendura o teste).
 * @param {(t: any) => Promise<unknown>} passo
 */
const segurar = async (passo, cliente = aux) => {
  /** @type {() => void} */
  let liberar = () => {};
  const liberado = new Promise((r) => { liberar = () => r(undefined); });
  /** @type {(v?: unknown) => void} */
  let pronto = () => {};
  const comTrava = new Promise((r) => { pronto = r; });
  const fim = cliente.$transaction(async (t) => { await passo(t); pronto(); await liberado; }, { timeout: 60000, maxWait: 10000 });
  await Promise.race([comTrava, fim]);
  return { soltar: async () => { liberar(); await fim; } };
};
/** Espera até haver `n` pedidos de trava parados no banco (o portão determinístico, sem sono fixo). */
const esperarNaFila = async (n = 1) => {
  for (let i = 0; i < 400; i++) {
    const [{ c }] = /** @type {any[]} */ (await prisma().$queryRaw`SELECT count(*)::int AS c FROM pg_locks WHERE NOT granted`);
    if (c >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`esperava ${n} pedido(s) de trava na fila`);
};
const travaDoProduto = (x) => (t) => t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`estoque:produto:${x.c}:${x.e.id}:${x.p.id}`}, 0))`;
const travaDoCocho = (x, ponto = x.ponto) => (t) => t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supl-ponto:${x.c}:${x.e.id}:${ponto}`}, 0))`;
/** Pasto real (AreaPastagem) para a trava das áreas valer. */
const pastoReal = async (x, nome = 'PASTO A') => {
  const setor = await prisma().setor.create({ data: { cliente_id: x.c, empresa_id: x.e.id, numero_setor: String(++seq), nome: `Setor ${seq}` } });
  return prisma().areaPastagem.create({ data: { cliente_id: x.c, empresa_id: x.e.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: `A${++seq}`, nome, tamanho_hectares: 10 } });
};
const comando = (x, corpo) => chamar('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, corpo);

describe('D-PROD-268 — revisão: replay do lançamento depois do cancelamento', () => {
  test('o reenvio com a chave original do lançamento cancelado é 409 SUPLEMENTACAO_REGISTRO_CANCELADO e não grava nada; o replay de um ativo continua 201', async () => {
    const x = await cenario();
    const { n1, n } = await tresLancamentos(x);
    ok(await cancelar(x, n.evento.id));
    const antes = await retrato(x);
    const r = await comando(x, n.corpo);
    assert.deepEqual([r.statusCode, r.json().code, r.json().details?.evento_id], [409, 'SUPLEMENTACAO_REGISTRO_CANCELADO', n.evento.id], r.body);
    assert.deepEqual(await retrato(x), antes, 'nada gravado');
    assert.equal((await evento(n.evento.id)).dados.situacao, 'cancelado');
    // O lançamento N-1 (ativo) continua com o replay de sempre.
    const replay = ok(await comando(x, n1.corpo), 200);
    assert.deepEqual([replay.replay, replay.evento.id], [true, n1.evento.id]);
    assert.deepEqual(await retrato(x), antes);
  });
});

describe('D-PROD-268 — revisão: gado × cancelamento (trava das áreas)', () => {
  test('quem grava a movimentação com a trava do pasto primeiro: o cancelamento espera, vê o gado e recusa gado_movimentado', async () => {
    const x = await cenario();
    const pasto = await pastoReal(x);
    const { n1, n } = await tresLancamentos(x, { area: pasto.id });
    const antes = await retrato(x);
    const escritor = await segurar(async (t) => {
      await t.$queryRaw`SELECT id FROM "AreaPastagem" WHERE cliente_id = ${x.c} AND id = ${pasto.id} FOR UPDATE`;
      await t.movimentacaoMapa.create({ data: { cliente_id: x.c, empresa_id: x.e.id, dados: { tipo: 'Transferência de Área', area_origem_id: pasto.id, area_destino_id: 'outro-pasto' } } });
    });
    const pendente = cancelar(x, n.evento.id);
    await esperarNaFila(1);
    await escritor.soltar();
    assert.deepEqual(recusa(await pendente), [409, 'SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'gado_movimentado']);
    assert.deepEqual(await retrato(x), antes);
    assert.notEqual((await evento(n1.evento.id)).dados.dias_periodo, null, 'N-1 continua fechado');
  });

  test('o cancelamento primeiro: ele segura o pasto até o commit (quem trava o pasto espera)', async () => {
    const x = await cenario();
    const pasto = await pastoReal(x);
    const { n } = await tresLancamentos(x, { area: pasto.id });
    const produto = await segurar(travaDoProduto(x));
    const pendente = cancelar(x, n.evento.id);
    await esperarNaFila(1); // o cancelamento já passou pelas áreas e parou na trava do produto
    await assert.rejects(
      aux.$transaction(async (t) => t.$queryRaw`SELECT id FROM "AreaPastagem" WHERE cliente_id = ${x.c} AND id = ${pasto.id} FOR UPDATE NOWAIT`),
      (e) => /55P03|could not obtain lock|lock_not_available/i.test(String(e?.message ?? e) + String(e?.meta?.code ?? '')),
    );
    await produto.soltar();
    ok(await pendente);
    assert.equal((await evento(n.evento.id)).dados.situacao, 'cancelado');
  });

  test('a movimentação gravada SEM trava durante o trabalho do motor também é vista (checagem no fim): recusa e nada muda', async () => {
    const x = await cenario();
    const { n1, n } = await tresLancamentos(x);
    const antes = await retrato(x);
    const produto = await segurar(travaDoProduto(x));
    const pendente = cancelar(x, n.evento.id);
    await esperarNaFila(1);
    await prisma().movimentacaoMapa.create({ data: { cliente_id: x.c, empresa_id: x.e.id, dados: { tipo: 'Transferência de Área', area_origem_id: 'area-1', area_destino_id: 'area-9' } } });
    await produto.soltar();
    assert.deepEqual(recusa(await pendente), [409, 'SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'gado_movimentado']);
    assert.deepEqual(await retrato(x), antes);
    assert.notEqual((await evento(n1.evento.id)).dados.dias_periodo, null, 'N-1 não foi reaberto');
  });
});

describe('D-PROD-268 — revisão: concorrência real com duas conexões', () => {
  const corpoNovo = (x, anteriorId, chave = op('lanc')) => ({
    operation_id: chave,
    evento: { empresa_id: x.e.id, ponto_suplementacao_id: x.ponto, ponto_nome: 'Cocho 1', area_id: 'area-1', area_ids: ['area-1'], data_lancamento: '2027-06-12', quantidade_total_kg: 0, sobra_kg: 2, dias_periodo: null },
    lotes: [],
    evento_anterior_id: anteriorId,
  });

  test('cancelar N × lançar N′ com evento_anterior_id = N: cancelamento primeiro → N′ é 409 LANCAMENTO_DESATUALIZADO (aponta N-1) e nada dele fica', async () => {
    const x = await cenario();
    const { n1, n } = await tresLancamentos(x);
    const produto = await segurar(travaDoProduto(x));
    const canc = cancelar(x, n.evento.id); // segura o cocho e espera o produto
    await esperarNaFila(1);
    const novo = comando(x, corpoNovo(x, n.evento.id)); // espera o cocho
    await esperarNaFila(2);
    await produto.soltar();
    ok(await canc);
    const r = await novo;
    assert.deepEqual([r.statusCode, r.json().code, r.json().details?.evento_anterior_id], [409, 'LANCAMENTO_DESATUALIZADO', n1.evento.id], r.body);
    const ativos = ok(await chamar('GET', `/suplementacao-eventos${qs({ empresa_id: x.e.id })}`, x.token));
    assert.equal(ativos.length, 2, 'só N-2 e N-1');
    assert.equal(await prisma().operacaoIdempotente.count({ where: { cliente_id: x.c, tipo_operacao: 'lancamento_suplementacao' } }), 3, 'a reserva do recibo de N′ foi desfeita');
    await reconciliacaoLimpa(x);
  });

  test('cancelar N × lançar N′ com evento_anterior_id = N: lançamento primeiro → N′ grava e o cancelamento de N é lancamento_posterior', async () => {
    const x = await cenario();
    const { n } = await tresLancamentos(x);
    const antesMov = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
    const cocho = await segurar(travaDoCocho(x));
    const novo = comando(x, corpoNovo(x, n.evento.id));
    await esperarNaFila(1);
    const canc = cancelar(x, n.evento.id);
    await esperarNaFila(2);
    await cocho.soltar();
    const criado = ok(await novo, 201);
    const r = await canc;
    assert.deepEqual(recusa(r), [409, 'SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO', 'lancamento_posterior']);
    assert.equal(r.json().details.evento_posterior_id, criado.evento.id);
    assert.equal((await evento(n.evento.id)).dados.situacao, undefined);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }), antesMov, 'nenhum estorno');
  });

  const saidaOutroCocho = (x, kg = 5, chave = op('outro')) => chamar('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
    operation_id: chave, empresa_id: x.e.id, produto_id: x.p.id, local_origem_id: x.galpao.id, quantidade: kg, ponto_suplementacao_id: 'outro-cocho', data_movimentacao: '2027-06-12',
  });

  test('cancelar × saída de outro cocho no mesmo depósito: cancelamento primeiro → os dois passam e o estoque fecha', async () => {
    const x = await cenario();
    const { n } = await tresLancamentos(x);
    const produto = await segurar(travaDoProduto(x));
    const canc = cancelar(x, n.evento.id);
    await esperarNaFila(1);
    const saida = saidaOutroCocho(x);
    await esperarNaFila(2);
    await produto.soltar();
    ok(await canc);
    ok(await saida, 201);
    // 100 − 30 − 30 − 20 + 20 (estorno) − 5 = 35
    assert.equal(await estoqueAtual(x), '35');
    proximo((await poco(x)).quantidade, 35);
    await reconciliacaoLimpa(x);
  });

  test('cancelar × saída de outro cocho no mesmo depósito: saída primeiro → o cancelamento espera, vê a saída e recusa 409 registro posterior (D-PROD-313), nada muda; cancelado o outro cocho, o N sai', async () => {
    const x = await cenario();
    const { n1, n } = await tresLancamentos(x);
    const chaveOutro = op('outro');
    const produto = await segurar(travaDoProduto(x));
    const saida = saidaOutroCocho(x, 5, chaveOutro);
    await esperarNaFila(1);
    const canc = cancelar(x, n.evento.id);
    await esperarNaFila(2);
    await produto.soltar();
    const s = ok(await saida, 201).movimentacao;
    const r = await canc;
    assert.deepEqual(recusa(r), [409, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior'], r.body);
    assert.equal(r.json().details.posterior_id, s.id);
    assert.equal((await evento(n.evento.id)).dados.situacao, undefined);
    assert.notEqual((await evento(n1.evento.id)).dados.dias_periodo, null, 'N-1 não foi reaberto');
    // 100 − 30 − 30 − 20 − 5 = 15; nenhum estorno
    assert.equal(await estoqueAtual(x), '15');
    assert.equal((await mov(n.mov.id)).status, 'Ativa');
    // Do mais recente para o mais antigo: o lançamento do outro cocho (com a mesma chave da baixa) é cancelado, e o N sai.
    const outro = ok(await comando(x, {
      operation_id: chaveOutro,
      evento: {
        empresa_id: x.e.id, ponto_suplementacao_id: 'outro-cocho', ponto_nome: 'Cocho 2', area_id: 'area-2', area_ids: ['area-2'], data_lancamento: '2027-06-12',
        produto: 'Sal mineral', produto_id: x.p.id, quantidade_total_kg: 5, sobra_kg: 0, dias_periodo: null, consumo_diario_grupo_kg: null,
        total_cabecas_afetadas: 10, movimentacao_estoque_id: s.id, custo_unitario_kg: Number(s.valor_unitario),
      },
      lotes: [{ empresa_id: x.e.id, lote_id: 'lote-b', lote_nome: 'B', data_lancamento: '2027-06-12', percentual_consumo_lote: 1, dias_periodo: null, dias_ativos_periodo: null, animal_dias_periodo: null, consumo_unitario_dia: null, consumo_por_cabeca_dia_kg: null, consumo_total_lote_periodo_kg: null }],
    }), 201).evento;
    ok(await cancelar(x, outro.id));
    ok(await cancelar(x, n.evento.id));
    assert.equal((await evento(n.evento.id)).dados.situacao, 'cancelado');
    assert.equal((await evento(n1.evento.id)).dados.dias_periodo, null, 'o período anterior reabre');
    // 100 − 30 − 30 = 40
    assert.equal(await estoqueAtual(x), '40');
    await reconciliacaoLimpa(x);
  });
});

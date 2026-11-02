/**
 * R2B-P1 (D-PROD-101) — Nascimento, Pesagem e Mudança de Categoria como UM
 * comando atômico por confirmação, com cancelamento causal.
 *
 * PostgreSQL real, HTTP autenticado. Sem fake de banco: cada prova de "nada
 * gravado" conta lotes, movimentos, auditorias e reservas de idempotência.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaR2B } from '../src/modules/movimentacoesMapa/manejoRebanhoComandoService.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

before(async () => {
  process.env.NODE_ENV = 'test';
  app = await criarApp();
  await app.ready();
});
after(async () => {
  definirFalhaInjetadaR2B(0);
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  definirFalhaInjetadaR2B(0);
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const DATA = '2026-10-30T12:00:00.000Z';

const VACA = 'Vaca + 36 meses';
const BEZERRO = 'Bezerro 0 a 12 meses';
const BEZERRA = 'Bezerra 0 a 12 meses';
const GARROTE = 'Garrote 13 a 24 meses';
const BOI = 'Boi 25 a 36 meses';
const NOVILHA = 'Novilha 13 a 24 meses';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const setorOutra = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: outraEmpresa.id, numero_setor: '9', nome: 'Setor 9' } });
  const area = async (n, nome, emp = empresa, st = setor) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: st.id, setor_nome: st.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return {
    cliente: adm.cliente,
    tok,
    empresa,
    outraEmpresa,
    setor,
    A: await area(1, 'PASTO A'),
    B: await area(2, 'PASTO B'),
    X: await area(9, 'PASTO OUTRA', outraEmpresa, setorOutra),
  };
};

const criarLote = async (c, { nome = 'NELORE', qtd, area, categoria, sexo, peso = null, motivo = 'Compra' }) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id,
    area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-10-01', motivo_entrada: motivo, status: 'Ativo',
    ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const rebanho = (c, corpo, token = c.tok) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', token, {
    operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: DATA, ...corpo,
  });
const ok = async (resposta) => {
  const r = await resposta;
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const lote = (id) => prisma().lote.findUnique({ where: { id } });
const mov = (id) => prisma().movimentacaoMapa.findUnique({ where: { id } });
const peso = (l) => (l.peso_medio_kg === null ? null : Number(l.peso_medio_kg));
const patch = (c, id, corpo) => req('PATCH', `/lotes/${id}`, c.tok, corpo);
const elegivel = async (c, id) => (await req('GET', `/movimentacoes-mapa/${id}/elegibilidade-cancelamento`, c.tok)).json();
const cancelar = (c, id, operation_id = opId()) =>
  req('POST', `/movimentacoes-mapa/${id}/cancelamento`, c.tok, { operation_id, motivo: 'lançado por engano' });
const cancelarOk = async (c, id) => {
  const r = await cancelar(c, id);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const morte = async (c, l, q) => {
  const r = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, {
    operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, lote_id: l.id, quantidade_animais: q, data_movimentacao: DATA,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().movimentacao;
};

/** Contagem global do tenant: prova de "nada gravado". */
const contagem = async (c) => {
  const p = prisma();
  const lotes = await p.lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } });
  return {
    lotes: lotes.map((l) => [l.id, l.quantidade_cabecas, l.status, l.categoria, l.sexo, peso(l), l.categoria_manejo_id]),
    movs: await p.movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }),
    audits: await p.auditLog.count({ where: { cliente_id: c.cliente.id } }),
    ops: await p.operacaoIdempotente.count({ where: { cliente_id: c.cliente.id } }),
  };
};
const cabecas = async (c) =>
  (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, status: 'Ativo' } })).reduce((t, l) => t + l.quantidade_cabecas, 0);

const exigirNadaGravado = async (c, acao, status, codigo) => {
  const antes = await contagem(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await contagem(c), antes, 'nenhum lote, movimento, auditoria ou reserva pode mudar');
  return r;
};

/** Recusa de cancelamento: elegibilidade false + POST 409 + nada muda. */
const exigirRecusaCancelamento = async (c, movId, codigos) => {
  const e = await elegivel(c, movId);
  assert.equal(e.elegivel, false, JSON.stringify(e));
  assert.ok(codigos.includes(e.codigo), `elegibilidade ${e.codigo}`);
  const antes = await contagem(c);
  const r = await cancelar(c, movId);
  assert.equal(r.statusCode, 409, r.body);
  assert.ok(codigos.includes(r.json().code), `POST ${r.json().code}`);
  assert.deepEqual(await contagem(c), antes, 'recusa não muda nada');
  if (!codigos.includes('CANCELAMENTO_JA_REALIZADO')) assert.notEqual((await mov(movId)).dados.situacao, 'cancelado');
};

// ═══ NASCIMENTO ════════════════════════════════════════════════════════════

describe('R2B Nascimento — uma confirmação, várias linhas, uma transação', () => {
  test('N1: 2 linhas (M 10 / F 8) sem lote de filhotes → cria 2 lotes, 1 movimento, mães intactas, rebanho +18', async () => {
    const c = await cenario();
    const vacas = await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    const total0 = await cabecas(c);
    const r = await ok(rebanho(c, {
      tipo: 'Nascimento',
      linhas: [
        { sexo: 'Macho', categoria_mae: VACA, quantidade: 10, peso_medio_kg: 30 },
        { sexo: 'Fêmea', categoria_mae: VACA, quantidade: 8, peso_medio_kg: 28 },
      ],
    }));
    const m = r.movimentacao;
    assert.equal(m.tipo, 'Nascimento');
    assert.equal(m.lote_ids.length, 2);
    assert.equal(m.efeito_servidor.comando, 'manejo_mapa_rebanho');
    assert.equal(m.efeito_servidor.registrado_por_usuario_id.length > 0, true);
    assert.equal(m.quantidade_animais, 18);
    assert.equal(m.linhas.length, 2);
    const machos = await lote(m.linhas[0].lote_id);
    const femeas = await lote(m.linhas[1].lote_id);
    assert.deepEqual([machos.categoria, machos.quantidade_cabecas, machos.sexo, peso(machos), machos.origem], [BEZERRO, 10, 'Macho', 30, 'Nascimento']);
    assert.deepEqual([femeas.categoria, femeas.quantidade_cabecas, femeas.sexo, peso(femeas)], [BEZERRA, 8, 'Fêmea', 28]);
    assert.equal(machos.area_atual_id, c.A.id);
    assert.equal(machos.nome, 'BEZERRO - PASTO A');
    assert.equal((await lote(vacas.id)).quantidade_cabecas, 100, 'nascimento não reduz mães');
    assert.equal(await cabecas(c), total0 + 18);
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
  });

  test('N2: lote de bezerros existente 20 @100kg + 10 @40kg → 30 @80kg (média ponderada); entrada e área de entrada intactas', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    const bz = await criarLote(c, { nome: 'BZ', qtd: 20, area: c.A, categoria: BEZERRO, sexo: 'Macho', peso: 100 });
    const r = await ok(rebanho(c, { tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 10, peso_medio_kg: 40 }] }));
    const depois = await lote(bz.id);
    assert.deepEqual([depois.quantidade_cabecas, peso(depois), depois.quantidade_entrada, depois.area_entrada_id], [30, 80, 20, c.A.id]);
    assert.equal(r.movimentacao.linhas[0].lote_criado, false);
  });

  test('N3: duas linhas do mesmo sexo vão para o MESMO lote novo (sem peso numa delas → peso desconhecido)', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    const r = await ok(rebanho(c, { tipo: 'Nascimento', linhas: [
      { sexo: 'Macho', categoria_mae: VACA, quantidade: 3, peso_medio_kg: 30 },
      { sexo: 'Macho', categoria_mae: VACA, quantidade: 4 },
    ] }));
    assert.equal(r.movimentacao.lote_ids.length, 1);
    const l = await lote(r.movimentacao.lote_ids[0]);
    assert.deepEqual([l.quantidade_cabecas, peso(l)], [7, null]);
  });

  test('N4: 2ª linha inválida (categoria de mãe ausente na área) → 409 e NADA gravado', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Nascimento', linhas: [
      { sexo: 'Macho', categoria_mae: VACA, quantidade: 10 },
      { sexo: 'Fêmea', categoria_mae: NOVILHA, quantidade: 5 },
    ] }), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
  });

  test('N5: falha injetada no 2º efeito → 500 e NADA gravado (0 lotes, movimentos, auditorias, idempotência)', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    definirFalhaInjetadaR2B(2);
    const corpo = { operation_id: opId(), tipo: 'Nascimento', linhas: [
      { sexo: 'Macho', categoria_mae: VACA, quantidade: 10 },
      { sexo: 'Fêmea', categoria_mae: VACA, quantidade: 5 },
    ] };
    await exigirNadaGravado(c, () => rebanho(c, corpo), 500);
    definirFalhaInjetadaR2B(0);
    // Mesma chave depois da falha: executa uma vez (a reserva também foi desfeita).
    await ok(rebanho(c, corpo));
    const r2 = await rebanho(c, corpo);
    assert.equal(r2.statusCode, 201);
    assert.equal(r2.json().replay, true);
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
  });

  test('N6: replay da mesma chave não duplica; mesma chave com conteúdo diferente → 409 IDEMPOTENCY_CONFLICT', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    const corpo = { operation_id: opId(), tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 10 }] };
    const a = await ok(rebanho(c, corpo));
    const b = await ok(rebanho(c, corpo));
    assert.equal(b.replay, true);
    assert.equal(b.movimentacao.id, a.movimentacao.id);
    await exigirNadaGravado(c, () => rebanho(c, { ...corpo, linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 11 }] }), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await lote(a.movimentacao.lote_id)).quantidade_cabecas, 10);
  });

  test('N7: validação de forma → 400 sem gravar (sexo, quantidade, peso, data impossível, campo reservado, linhas vazias)', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    const base = { sexo: 'Macho', categoria_mae: VACA, quantidade: 10 };
    for (const corpo of [
      { tipo: 'Nascimento', linhas: [{ ...base, sexo: 'M' }] },
      { tipo: 'Nascimento', linhas: [{ ...base, quantidade: 0 }] },
      { tipo: 'Nascimento', linhas: [{ ...base, quantidade: 2.5 }] },
      { tipo: 'Nascimento', linhas: [{ ...base, peso_medio_kg: -1 }] },
      { tipo: 'Nascimento', linhas: [base], data_movimentacao: '2026-02-30' },
      { tipo: 'Nascimento', linhas: [base], efeito_servidor: { comando: 'manejo_mapa_rebanho' } },
      { tipo: 'Nascimento', linhas: [base], usuario_responsavel: 'outro' },
      { tipo: 'Nascimento', linhas: [{ ...base, lote_ids: ['x'] }] },
      { tipo: 'Nascimento', linhas: [] },
      { tipo: 'Morte', linhas: [base] },
    ]) {
      await exigirNadaGravado(c, () => rebanho(c, corpo), 400);
    }
  });

  test('N8: área de outra empresa, área inexistente, outro tenant → 404 sem gravar', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    const linhas = [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 1 }];
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Nascimento', area_id: c.X.id, linhas }), 404, 'AREA_NOT_FOUND');
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Nascimento', area_id: 'nao-existe', linhas }), 404, 'AREA_NOT_FOUND');
    const outro = await cenario();
    await exigirNadaGravado(c, () => rebanho(outro, { tipo: 'Nascimento', area_id: c.A.id, empresa_id: c.empresa.id, linhas }), 404);
  });

  test('N9: cancelar — lote criado fica 0/Inativo (não apagado); lote existente volta a quantidade e peso anteriores', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    const bz = await criarLote(c, { nome: 'BZ', qtd: 20, area: c.A, categoria: BEZERRO, sexo: 'Macho', peso: 100 });
    const total0 = await cabecas(c);
    const r = await ok(rebanho(c, { tipo: 'Nascimento', linhas: [
      { sexo: 'Macho', categoria_mae: VACA, quantidade: 10, peso_medio_kg: 40 },
      { sexo: 'Fêmea', categoria_mae: VACA, quantidade: 6, peso_medio_kg: 35 },
    ] }));
    const femeas = r.movimentacao.linhas[1].lote_id;
    assert.equal((await elegivel(c, r.movimentacao.id)).elegivel, true);
    const cancelado = await cancelarOk(c, r.movimentacao.id);
    assert.equal(cancelado.movimentacao.situacao, 'cancelado');
    assert.equal(cancelado.movimentacao.cancelamento.efeitos.length, 2);
    const bzDepois = await lote(bz.id);
    assert.deepEqual([bzDepois.quantidade_cabecas, peso(bzDepois)], [20, 100]);
    const fDepois = await lote(femeas);
    assert.ok(fDepois, 'lote de filhotes não é apagado');
    assert.deepEqual([fDepois.quantidade_cabecas, fDepois.status], [0, 'Inativo']);
    assert.equal(await cabecas(c), total0);
    await exigirRecusaCancelamento(c, r.movimentacao.id, ['CANCELAMENTO_JA_REALIZADO']);
  });

  test('N10: morte posterior no lote de filhotes bloqueia; cancelar a morte primeiro libera (mais nova → mais antiga)', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    const r = await ok(rebanho(c, { tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 10 }] }));
    const filhotes = await lote(r.movimentacao.lote_id);
    const m = await morte(c, filhotes, 2);
    await exigirRecusaCancelamento(c, r.movimentacao.id, ['CANCELAMENTO_DEPENDENCIA_POSTERIOR']);
    await cancelarOk(c, m.id);
    await cancelarOk(c, r.movimentacao.id);
    assert.deepEqual([(await lote(filhotes.id)).quantidade_cabecas, (await lote(filhotes.id)).status], [0, 'Inativo']);
  });

  test('N11: PATCH direto de peso no lote incrementado depois do nascimento bloqueia (inclusive ida e volta)', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    const bz = await criarLote(c, { nome: 'BZ', qtd: 20, area: c.A, categoria: BEZERRO, sexo: 'Macho', peso: 100 });
    const r = await ok(rebanho(c, { tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 10, peso_medio_kg: 40 }] }));
    assert.equal((await patch(c, bz.id, { peso_medio_kg: 90 })).statusCode, 200);
    assert.equal((await patch(c, bz.id, { peso_medio_kg: 80 })).statusCode, 200);
    await exigirRecusaCancelamento(c, r.movimentacao.id, ['CANCELAMENTO_ALTERACAO_POSTERIOR']);
    assert.deepEqual([(await lote(bz.id)).quantidade_cabecas, peso(await lote(bz.id))], [30, 80]);
  });

  test('N12: lote excluído do Cadastro não serve de lote de filhotes nem de mãe', async () => {
    const c = await cenario();
    const vacas = await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
    await prisma().lote.update({ where: { id: vacas.id }, data: { excluido_em: new Date() } });
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 1 }] }), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
  });
});

// ═══ PESAGEM ═══════════════════════════════════════════════════════════════

const tresLotes = async (c) => [
  await criarLote(c, { nome: 'L1', qtd: 50, area: c.A, categoria: BOI, sexo: 'Macho', peso: 400 }),
  await criarLote(c, { nome: 'L2', qtd: 40, area: c.A, categoria: BOI, sexo: 'Macho', peso: 380 }),
  await criarLote(c, { nome: 'L3', qtd: 30, area: c.A, categoria: GARROTE, sexo: 'Macho' }),
];

describe('R2B Pesagem — muda peso, nunca cabeças; todos ou nenhum', () => {
  test('P1: 3 lotes (dois da mesma categoria, tratados individualmente) → todos com peso novo, cabeças intactas, 1 movimento', async () => {
    const c = await cenario();
    const [l1, l2, l3] = await tresLotes(c);
    const r = await ok(rebanho(c, { tipo: 'Pesagem', modo_pesagem: 'por_categoria', linhas: [
      { lote_id: l1.id, categoria: BOI, peso_medio_kg: 420 },
      { lote_id: l2.id, categoria: BOI, peso_medio_kg: 420 },
      { lote_id: l3.id, categoria: GARROTE, peso_medio_kg: 300.5 },
    ] }));
    const m = r.movimentacao;
    assert.equal(m.lote_ids.length, 3);
    assert.equal(m.quantidade_animais, 120);
    assert.deepEqual(m.linhas.map((l) => [l.peso_anterior_kg, l.peso_novo_kg, l.ganho_kg]), [[400, 420, 20], [380, 420, 40], [null, 300.5, null]]);
    for (const [l, q, p] of [[l1, 50, 420], [l2, 40, 420], [l3, 30, 300.5]]) {
      const d = await lote(l.id);
      assert.deepEqual([d.quantidade_cabecas, peso(d), d.status, d.categoria, d.area_atual_id], [q, p, 'Ativo', l.categoria, c.A.id]);
    }
  });

  test('P2: falha injetada no 3º efeito → NADA gravado; nenhum dos 3 pesos muda', async () => {
    const c = await cenario();
    const [l1, l2, l3] = await tresLotes(c);
    definirFalhaInjetadaR2B(3);
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Pesagem', linhas: [l1, l2, l3].map((l) => ({ lote_id: l.id, peso_medio_kg: 500 })) }), 500);
  });

  test('P3: lote de outra área, repetido, peso inválido ou categoria divergente → recusa sem gravar', async () => {
    const c = await cenario();
    const [l1, l2] = await tresLotes(c);
    const fora = await criarLote(c, { nome: 'FORA', qtd: 10, area: c.B, categoria: BOI, sexo: 'Macho' });
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 410 }, { lote_id: fora.id, peso_medio_kg: 410 }] }), 404, 'LOTE_NOT_FOUND');
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 410 }, { lote_id: l1.id, peso_medio_kg: 411 }] }), 400);
    for (const p of [0, -5, 3001, null]) {
      await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: p }] }), 400);
    }
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l2.id, categoria: GARROTE, peso_medio_kg: 410 }] }), 409, 'MANEJO_ESTADO_INVALIDO');
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 410, quantidade_cabecas: 1 }] }), 400);
  });

  test('P4: cancelar devolve os 3 pesos anteriores e não toca nas cabeças', async () => {
    const c = await cenario();
    const [l1, l2, l3] = await tresLotes(c);
    const r = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [l1, l2, l3].map((l) => ({ lote_id: l.id, peso_medio_kg: 450 })) }));
    await cancelarOk(c, r.movimentacao.id);
    assert.deepEqual(
      await Promise.all([l1, l2, l3].map(async (l) => { const d = await lote(l.id); return [d.quantidade_cabecas, peso(d)]; })),
      [[50, 400], [40, 380], [30, null]]
    );
  });

  test('P5: pesagem posterior bloqueia a anterior; cancelar da mais nova para a mais antiga funciona', async () => {
    const c = await cenario();
    const [l1] = await tresLotes(c);
    const a = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 410 }] }));
    const b = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 430 }] }));
    await exigirRecusaCancelamento(c, a.movimentacao.id, ['CANCELAMENTO_DEPENDENCIA_POSTERIOR']);
    await cancelarOk(c, b.movimentacao.id);
    assert.equal(peso(await lote(l1.id)), 410);
    await cancelarOk(c, a.movimentacao.id);
    assert.equal(peso(await lote(l1.id)), 400);
  });

  test('P6: ida e volta de peso por PATCH (410 → 400 → 410) bloqueia o cancelamento', async () => {
    const c = await cenario();
    const [l1] = await tresLotes(c);
    const a = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 410 }] }));
    assert.equal((await patch(c, l1.id, { peso_medio_kg: 400 })).statusCode, 200);
    assert.equal((await patch(c, l1.id, { peso_medio_kg: 410 })).statusCode, 200);
    await exigirRecusaCancelamento(c, a.movimentacao.id, ['CANCELAMENTO_ALTERACAO_POSTERIOR']);
  });

  test('P7: PATCH só de nome depois da pesagem não bloqueia (não é campo de efeito)', async () => {
    const c = await cenario();
    const [l1] = await tresLotes(c);
    const a = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 410 }] }));
    assert.equal((await patch(c, l1.id, { nome: 'L1 RENOMEADO' })).statusCode, 200);
    await cancelarOk(c, a.movimentacao.id);
    assert.equal(peso(await lote(l1.id)), 400);
  });
});

// ═══ MUDANÇA DE CATEGORIA ══════════════════════════════════════════════════

describe('R2B Mudança de Categoria — conserva cabeças; total no lugar, parcial gera derivado', () => {
  test('M1: total → mesmo lote muda categoria, sexo e categoria de manejo; cabeças e entrada intactas', async () => {
    const c = await cenario();
    const cm = await prisma().categoriaManejo.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome: 'BOI MAGRO', categoria_oficial: BOI, sexo: 'Macho' } });
    const g = await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho', peso: 300 });
    const total0 = await cabecas(c);
    const r = await ok(rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 50, peso_medio_kg: 320 }] }));
    const d = await lote(g.id);
    assert.deepEqual([d.quantidade_cabecas, d.categoria, d.categoria_manejo_id, d.categoria_manejo_nome, d.sexo, peso(d), d.quantidade_entrada, d.categoria_entrada],
      [50, BOI, cm.id, 'BOI MAGRO', 'Macho', 320, 50, GARROTE]);
    assert.equal(r.movimentacao.linhas[0].partes[0].modo, 'total');
    assert.equal(await cabecas(c), total0);
  });

  test('M2: parcial 20 de 50 → origem 30, derivado 20 (origem "Mudança de Categoria", não é compra); soma conservada', async () => {
    const c = await cenario();
    const g = await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho', peso: 300 });
    const r = await ok(rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 20 }] }));
    const parte = r.movimentacao.linhas[0].partes[0];
    assert.equal(parte.modo, 'parcial');
    const deriv = await lote(parte.lote_destino_id);
    assert.deepEqual([(await lote(g.id)).quantidade_cabecas, deriv.quantidade_cabecas, deriv.categoria, deriv.origem, deriv.motivo_entrada, peso(deriv)],
      [30, 20, BOI, 'Mudança de Categoria', 'Outros', 300]);
    assert.deepEqual(r.movimentacao.lote_ids.sort(), [g.id, deriv.id].sort());
  });

  test('M3: duas linhas disputando o mesmo saldo (30 + 30 de 50) → 409 e NADA gravado', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho' });
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Mudança de Categoria', linhas: [
      { categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 30 },
      { categoria_atual: GARROTE, categoria_nova: 'Touro + 36 meses', quantidade: 30 },
    ] }), 409, 'MANEJO_SALDO_INSUFICIENTE');
  });

  test('M4: uma linha de 50 sobre dois lotes (30 + 40) → 1º total, 2º parcial 20; conserva 70', async () => {
    const c = await cenario();
    const ids = [
      (await criarLote(c, { nome: 'G1', qtd: 30, area: c.A, categoria: GARROTE, sexo: 'Macho' })).id,
      (await criarLote(c, { nome: 'G2', qtd: 40, area: c.A, categoria: GARROTE, sexo: 'Macho' })).id,
    ].sort();
    const total0 = await cabecas(c);
    const r = await ok(rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 50 }] }));
    const partes = r.movimentacao.linhas[0].partes;
    assert.equal(partes.length, 2);
    assert.equal(partes.reduce((t, p) => t + p.quantidade, 0), 50);
    assert.equal(await cabecas(c), total0);
    const somaBoi = (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, categoria: BOI, status: 'Ativo' } })).reduce((t, l) => t + l.quantidade_cabecas, 0);
    assert.equal(somaBoi, 50);
    assert.ok(ids.length === 2);
  });

  test('M5: incompatível com sexo, categoria fora do oficial, igual à atual, manejo de outra oficial, ambígua → recusa sem gravar', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho' });
    const cmVaca = await prisma().categoriaManejo.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome: 'VACA X', categoria_oficial: VACA, sexo: 'Fêmea' } });
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: NOVILHA, quantidade: 10 }] }), 409, 'MANEJO_CATEGORIA_INCOMPATIVEL');
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: 'BOI GORDO', quantidade: 10 }] }), 400);
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: GARROTE, quantidade: 10 }] }), 400);
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 10, categoria_manejo_id_novo: cmVaca.id }] }), 409, 'MANEJO_CATEGORIA_INVALIDA');
    for (const nome of ['BOI A', 'BOI B']) {
      await prisma().categoriaManejo.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome, categoria_oficial: BOI, sexo: 'Macho' } });
    }
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 10 }] }), 409, 'MANEJO_CATEGORIA_AMBIGUA');
  });

  test('M6: falha injetada no 2º efeito (linha 1 parcial + linha 2) → NADA gravado', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho' });
    await criarLote(c, { nome: 'B', qtd: 30, area: c.A, categoria: BEZERRO, sexo: 'Macho' });
    definirFalhaInjetadaR2B(2);
    await exigirNadaGravado(c, () => rebanho(c, { tipo: 'Mudança de Categoria', linhas: [
      { categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 20 },
      { categoria_atual: BEZERRO, categoria_nova: GARROTE, quantidade: 30 },
    ] }), 500);
  });

  test('M7: cancelar parcial → origem volta a 50, derivado 0/Inativo; cancelar total → classificação inteira restaurada', async () => {
    const c = await cenario();
    const cm = await prisma().categoriaManejo.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, nome: 'GARROTE ERA', categoria_oficial: GARROTE, sexo: 'Macho' } });
    const g = await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho', peso: 300 });
    await prisma().lote.update({ where: { id: g.id }, data: { categoria_manejo_id: cm.id, categoria_manejo_nome: cm.nome } });
    const parcial = await ok(rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 20, peso_medio_kg: 330 }] }));
    const deriv = parcial.movimentacao.linhas[0].partes[0].lote_destino_id;
    await cancelarOk(c, parcial.movimentacao.id);
    assert.deepEqual([(await lote(g.id)).quantidade_cabecas, (await lote(deriv)).quantidade_cabecas, (await lote(deriv)).status], [50, 0, 'Inativo']);
    assert.ok(await lote(deriv), 'derivado não é apagado');

    const total = await ok(rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 50, peso_medio_kg: 340 }] }));
    assert.equal((await lote(g.id)).categoria, BOI);
    await cancelarOk(c, total.movimentacao.id);
    const d = await lote(g.id);
    assert.deepEqual([d.quantidade_cabecas, d.categoria, d.categoria_manejo_id, d.categoria_manejo_nome, d.sexo, peso(d)], [50, GARROTE, cm.id, 'GARROTE ERA', 'Macho', 300]);
  });

  test('M8: operação dependente na categoria nova (pesagem do derivado) bloqueia o cancelamento da mudança', async () => {
    const c = await cenario();
    await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho' });
    const r = await ok(rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 20 }] }));
    const deriv = r.movimentacao.linhas[0].partes[0].lote_destino_id;
    const p = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: deriv, peso_medio_kg: 410 }] }));
    await exigirRecusaCancelamento(c, r.movimentacao.id, ['CANCELAMENTO_DEPENDENCIA_POSTERIOR']);
    await cancelarOk(c, p.movimentacao.id);
    await cancelarOk(c, r.movimentacao.id);
  });

  test('M9: PATCH direto de categoria depois da mudança total → recusa (estado divergente ou alteração posterior)', async () => {
    const c = await cenario();
    const g = await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho' });
    const r = await ok(rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 50 }] }));
    assert.equal((await patch(c, g.id, { categoria: 'Touro + 36 meses', estado_esperado: { categoria: BOI } })).statusCode, 200);
    await exigirRecusaCancelamento(c, r.movimentacao.id, ['CANCELAMENTO_ESTADO_DIVERGENTE', 'CANCELAMENTO_ALTERACAO_POSTERIOR']);
  });
});

// ═══ CONCORRÊNCIA REAL (3 rodadas cada) ════════════════════════════════════

describe('R2B concorrência real', () => {
  for (let rodada = 1; rodada <= 3; rodada += 1) {
    test(`C1.${rodada}: dois nascimentos com a MESMA chave em paralelo → um efeito`, async () => {
      const c = await cenario();
      await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
      const corpo = { operation_id: opId(), tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 10 }] };
      const rs = await Promise.all([rebanho(c, corpo), rebanho(c, corpo)]);
      assert.ok(rs.every((r) => [201, 409].includes(r.statusCode)), rs.map((r) => r.body).join(' | '));
      assert.ok(rs.some((r) => r.statusCode === 201));
      assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
      const bz = await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, categoria: BEZERRO } });
      assert.deepEqual(bz.map((l) => l.quantidade_cabecas), [10]);
    });

    test(`C2.${rodada}: dois nascimentos DISTINTOS em paralelo → ambos contados, num só lote de filhotes (área serializa)`, async () => {
      const c = await cenario();
      await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
      const rs = await Promise.all([
        rebanho(c, { tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 10 }] }),
        rebanho(c, { tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 7 }] }),
      ]);
      assert.deepEqual(rs.map((r) => r.statusCode), [201, 201], rs.map((r) => r.body).join(' | '));
      const bz = await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, categoria: BEZERRO } });
      assert.deepEqual(bz.map((l) => l.quantidade_cabecas), [17]);
    });

    test(`C3.${rodada}: duas mudanças competindo pelo mesmo saldo (30 + 30 de 50) → uma aceita, outra recusada`, async () => {
      const c = await cenario();
      await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho' });
      const rs = await Promise.all([
        rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 30 }] }),
        rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: 'Touro + 36 meses', quantidade: 30 }] }),
      ]);
      assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409], rs.map((r) => r.body).join(' | '));
      assert.equal(await cabecas(c), 50);
      assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
    });

    test(`C4.${rodada}: pesagem com a mesma chave em paralelo → um efeito; chaves distintas → as duas, em série`, async () => {
      const c = await cenario();
      const [l1] = await tresLotes(c);
      const corpo = { operation_id: opId(), tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 410 }] };
      const rs = await Promise.all([rebanho(c, corpo), rebanho(c, corpo)]);
      assert.ok(rs.some((r) => r.statusCode === 201));
      assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
      const [a, b] = await Promise.all([
        rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 420 }] }),
        rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 430 }] }),
      ]);
      assert.deepEqual([a.statusCode, b.statusCode], [201, 201]);
      // Em série: o peso anterior da segunda é o peso novo da primeira (sem leitura obsoleta).
      const linhas = [a.json().movimentacao.linhas[0], b.json().movimentacao.linhas[0]].sort((x) => (x.peso_anterior_kg === 410 ? -1 : 1));
      assert.equal(linhas[0].peso_anterior_kg, 410);
      assert.equal(linhas[1].peso_anterior_kg, linhas[0].peso_novo_kg);
    });

    test(`C5.${rodada}: cancelar × registrar pesagem posterior em paralelo → nunca reverte por cima da nova`, async () => {
      const c = await cenario();
      const [l1] = await tresLotes(c);
      const a = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 410 }] }));
      const [canc, nova] = await Promise.all([cancelar(c, a.movimentacao.id), rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 450 }] })]);
      assert.equal(nova.statusCode, 201, nova.body);
      const final = peso(await lote(l1.id));
      if (canc.statusCode === 200) {
        // Cancelou antes: a nova pesagem leu o peso restaurado (400) e ficou por cima.
        assert.equal(nova.json().movimentacao.linhas[0].peso_anterior_kg, 400);
        assert.equal(final, 450);
      } else {
        assert.equal(canc.statusCode, 409, canc.body);
        assert.equal(canc.json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
        assert.equal(final, 450);
        assert.notEqual((await mov(a.movimentacao.id)).dados.situacao, 'cancelado');
      }
    });

    test(`C6.${rodada}: dois cancelamentos simultâneos (chaves distintas) → um reverte, o outro recusa; reversão única`, async () => {
      const c = await cenario();
      await criarLote(c, { nome: 'MATRIZES', qtd: 100, area: c.A, categoria: VACA, sexo: 'Fêmea' });
      const bz = await criarLote(c, { nome: 'BZ', qtd: 20, area: c.A, categoria: BEZERRO, sexo: 'Macho' });
      const r = await ok(rebanho(c, { tipo: 'Nascimento', linhas: [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 10 }] }));
      const rs = await Promise.all([cancelar(c, r.movimentacao.id), cancelar(c, r.movimentacao.id)]);
      assert.deepEqual(rs.map((x) => x.statusCode).sort(), [200, 409], rs.map((x) => x.body).join(' | '));
      assert.equal((await lote(bz.id)).quantidade_cabecas, 20, 'devolvido uma única vez');
    });
  }
});

// ═══ HISTÓRICO, EXCLUSÃO (#167), R2A, CAMPOS RESERVADOS ═════════════════════

describe('R2B integração — histórico, exclusão lógica, R2A e superfície genérica', () => {
  test('X1: histórico por lote acha o movimento agregado por QUALQUER participante; por área também', async () => {
    const c = await cenario();
    const [l1, l2, l3] = await tresLotes(c);
    const r = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [l1, l2, l3].map((l) => ({ lote_id: l.id, peso_medio_kg: 450 })) }));
    for (const l of [l1, l2, l3]) {
      const h = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${l.id}`, c.tok);
      assert.equal(h.statusCode, 200, h.body);
      assert.deepEqual(h.json().items.map((m) => m.id), [r.movimentacao.id], `participante ${l.nome}`);
    }
    const porArea = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&area_id=${c.A.id}`, c.tok);
    assert.deepEqual(porArea.json().items.map((m) => m.id), [r.movimentacao.id]);
  });

  test('X2: #167 — lote de compra pesado (R2B ativo) não sai do Cadastro; com a pesagem cancelada, sai por exclusão lógica', async () => {
    const c = await cenario();
    const [l1] = await tresLotes(c);
    const r = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 450 }] }));
    const bloqueado = await req('DELETE', `/lotes/${l1.id}`, c.tok);
    assert.equal(bloqueado.statusCode, 409, bloqueado.body);
    assert.equal(bloqueado.json().details?.motivo, 'movimentacao_ativa');
    await cancelarOk(c, r.movimentacao.id);
    const excl = await req('DELETE', `/lotes/${l1.id}`, c.tok);
    assert.equal(excl.statusCode, 204, excl.body);
    assert.ok((await lote(l1.id)).excluido_em, 'exclusão LÓGICA (histórico preservado)');
  });

  test('X3: #167 — participante de mudança parcial ATIVA não é excluído (referência em efeitos[].lote_id)', async () => {
    const c = await cenario();
    const g = await criarLote(c, { nome: 'G', qtd: 50, area: c.A, categoria: GARROTE, sexo: 'Macho' });
    await ok(rebanho(c, { tipo: 'Mudança de Categoria', linhas: [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 20 }] }));
    const r = await req('DELETE', `/lotes/${g.id}`, c.tok);
    assert.equal(r.statusCode, 409, r.body);
  });

  test('X4: R2A intacto — morte registra e cancela; pesagem R2B ativa posterior bloqueia o cancelamento da morte', async () => {
    const c = await cenario();
    const [l1] = await tresLotes(c);
    const m = await morte(c, l1, 5);
    assert.equal((await lote(l1.id)).quantidade_cabecas, 45);
    const p = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 450 }] }));
    await exigirRecusaCancelamento(c, m.id, ['CANCELAMENTO_DEPENDENCIA_POSTERIOR']);
    await cancelarOk(c, p.movimentacao.id);
    await cancelarOk(c, m.id);
    assert.equal((await lote(l1.id)).quantidade_cabecas, 50);
  });

  test('X5: POST genérico não forja movimento agregado nem cancelável', async () => {
    const c = await cenario();
    const [l1] = await tresLotes(c);
    for (const campo of ['lote_ids', 'linhas', 'modo_pesagem', 'efeito_servidor', 'situacao', 'cancelamento']) {
      const r = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Pesagem', lote_id: l1.id, [campo]: [] });
      assert.equal(r.statusCode, 400, `${campo}: ${r.body}`);
      assert.equal(r.json().code, 'CAMPO_RESERVADO_CANCELAMENTO');
    }
    // Pesagem pelo caminho legado (sem proveniência) não é cancelável.
    const legado = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Pesagem', lote_id: l1.id, lote: l1.nome, peso_medio: 999 });
    assert.equal(legado.statusCode, 201, legado.body);
    await exigirRecusaCancelamento(c, legado.json().id, ['CANCELAMENTO_EFEITO_NAO_COMPROVADO']);
  });

  test('X6: proveniência forjada direto no banco (operação de outro movimento) → cancelamento recusado', async () => {
    const c = await cenario();
    const [l1, l2] = await tresLotes(c);
    const a = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l1.id, peso_medio_kg: 450 }] }));
    const b = await ok(rebanho(c, { tipo: 'Pesagem', linhas: [{ lote_id: l2.id, peso_medio_kg: 450 }] }));
    const dadosB = (await mov(b.movimentacao.id)).dados;
    const dadosA = (await mov(a.movimentacao.id)).dados;
    // Movimento B passa a citar a operação de A: a âncora não confere.
    await prisma().movimentacaoMapa.update({
      where: { id: b.movimentacao.id },
      data: { dados: { ...dadosB, efeito_servidor: { ...dadosB.efeito_servidor, operation_id: dadosA.efeito_servidor.operation_id } } },
    });
    await exigirRecusaCancelamento(c, b.movimentacao.id, ['CANCELAMENTO_EFEITO_NAO_COMPROVADO']);
  });
});

/**
 * R2A-R2 (D-PROD-97b) — estado causal completo e fail-closed no cancelamento.
 *
 * O CAS de `PATCH /lotes` (R2A-R1) impede escrita OBSOLETA, mas permite uma
 * escrita VÁLIDA (com `estado_esperado` correto) depois do movimento. Antes
 * desta correção, o cancelamento somava `antes − depois` sobre a quantidade
 * atual e devolvia animais sem prova. Aqui: PostgreSQL real, HTTP, auth.
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

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = async (n, nome, emp = empresa) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tokAdm, empresa, outraEmpresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), C: await area(3, 'PASTO C') };
};

const criarLote = async (c, { nome = 'NELORE', qtd = 500, area, categoria = 'BOI' }) => {
  const r = await req('POST', '/lotes', c.tokAdm, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo: 'Macho', setor_id: c.setor.id,
    area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo',
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const lote = (id) => prisma().lote.findUnique({ where: { id } });
const mov = (id) => prisma().movimentacaoMapa.findUnique({ where: { id } });
const patch = (c, id, corpo) => req('PATCH', `/lotes/${id}`, c.tokAdm, corpo);
const manejo = (c, corpo) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tokAdm, {
    operation_id: opId(), empresa_id: c.empresa.id, data_movimentacao: '2026-10-30T12:00:00.000Z', ...corpo,
  });
const morte = async (c, l, q, tipo = 'Morte') => {
  const r = await manejo(c, { tipo, lote_id: l.id, quantidade_animais: q });
  assert.equal(r.statusCode, 201, r.body);
  return r.json().movimentacao;
};
const transferir = async (c, l, q, area, loteDestinoId) => {
  const r = await manejo(c, {
    tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: q, area_destino_id: area.id,
    ...(loteDestinoId ? { lote_destino_id: loteDestinoId } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const elegivel = async (c, id) => (await req('GET', `/movimentacoes-mapa/${id}/elegibilidade-cancelamento`, c.tokAdm)).json();
const cancelar = (c, id, operation_id = opId()) =>
  req('POST', `/movimentacoes-mapa/${id}/cancelamento`, c.tokAdm, { operation_id, motivo: 'lançado por engano' });

/** Prova de "nada mudou": lotes, movimento, reserva de idempotência e auditoria de cancelamento. */
const fotografar = async (c, movId, loteIds) => ({
  lotes: await Promise.all(loteIds.map(async (id) => {
    const l = await lote(id);
    return [l.quantidade_cabecas, l.status, l.area_atual_id, l.categoria];
  })),
  dados: (await mov(movId)).dados,
  reservas: await prisma().operacaoIdempotente.count({ where: { cliente_id: c.cliente.id, tipo_operacao: 'cancelamento_movimentacao_mapa' } }),
  auditCancel: await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, acao: 'cancelamento', entidade_id: movId } }),
});

/** Recusa completa: elegibilidade false + POST 409 com código esperado + nada muda. */
const exigirRecusa = async (c, movId, loteIds, codigos) => {
  const antes = await fotografar(c, movId, loteIds);
  const e = await elegivel(c, movId);
  assert.equal(e.elegivel, false, JSON.stringify(e));
  assert.ok(codigos.includes(e.codigo), `elegibilidade ${e.codigo}`);
  const opKey = opId();
  const r = await cancelar(c, movId, opKey);
  assert.equal(r.statusCode, 409, r.body);
  assert.ok(codigos.includes(r.json().code), `POST ${r.json().code}`);
  const depois = await fotografar(c, movId, loteIds);
  assert.deepEqual(depois, antes, 'recusa não pode mudar lote, movimento, reserva nem auditoria');
  assert.notEqual((await mov(movId)).dados.situacao, 'cancelado');
  assert.equal(await prisma().operacaoIdempotente.count({ where: { operation_key: opKey } }), 0, 'recusa não reserva idempotência');
  return r.json();
};

const INTERVENCAO = ['CANCELAMENTO_ESTADO_DIVERGENTE', 'CANCELAMENTO_ALTERACAO_POSTERIOR'];

describe('R2A-R2 a1/a2 — PATCH material válido depois do movimento bloqueia o cancelamento', () => {
  test('a1: 500 → morte 50 → 450 → PATCH 400 (CAS ok) → cancelar é 409 e o saldo continua 400', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    const r = await patch(c, l.id, { quantidade_cabecas: 400, estado_esperado: { quantidade_cabecas: 450 } });
    assert.equal(r.statusCode, 200, r.body);
    await exigirRecusa(c, m.id, [l.id], INTERVENCAO);
    assert.equal((await lote(l.id)).quantidade_cabecas, 400, 'nenhum crédito de 50');
  });

  test('a2: 500 → morte 50 → 450 → PATCH 550 → cancelar NÃO credita (600 seria crédito sem prova); continua 550', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    assert.equal((await patch(c, l.id, { quantidade_cabecas: 550, estado_esperado: { quantidade_cabecas: 450 } })).statusCode, 200);
    await exigirRecusa(c, m.id, [l.id], INTERVENCAO);
    assert.equal((await lote(l.id)).quantidade_cabecas, 550);
  });
});

describe('R2A-R2 a3 — status, área ou categoria mudados depois do movimento', () => {
  for (const [nome, corpo] of [
    ['status', () => ({ status: 'Inativo', estado_esperado: { status: 'Ativo' } })],
    ['área', (c) => ({ area_atual_id: c.B.id, estado_esperado: { area_atual_id: c.A.id } })],
    ['categoria', () => ({ categoria: 'VACA', estado_esperado: { categoria: 'BOI' } })],
  ]) {
    test(`a3 ${nome}: PATCH válido depois da morte → cancelamento recusado sem efeito`, async () => {
      const c = await cenario();
      const l = await criarLote(c, { area: c.A });
      const m = await morte(c, l, 50);
      assert.equal((await patch(c, l.id, corpo(c))).statusCode, 200);
      await exigirRecusa(c, m.id, [l.id], INTERVENCAO);
      assert.equal((await lote(l.id)).quantidade_cabecas, 450);
    });
  }
});

describe('R2A-R2 a4 — transferência: mudança posterior na ORIGEM ou no DESTINO bloqueia os dois', () => {
  test('parcial unificada: PATCH no destino (150 → 140) → 409; origem e destino intactos', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500 });
    const d = await criarLote(c, { area: c.B, qtd: 100 });
    const t = await transferir(c, o, 50, c.B, d.id);
    assert.equal((await patch(c, d.id, { quantidade_cabecas: 140, estado_esperado: { quantidade_cabecas: 150 } })).statusCode, 200);
    await exigirRecusa(c, t.movimentacao.id, [o.id, d.id], INTERVENCAO);
    assert.deepEqual([(await lote(o.id)).quantidade_cabecas, (await lote(d.id)).quantidade_cabecas], [450, 140]);
  });

  test('parcial unificada: PATCH na origem (área A → C) → 409', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500 });
    const d = await criarLote(c, { area: c.B, qtd: 100 });
    const t = await transferir(c, o, 50, c.B, d.id);
    assert.equal((await patch(c, o.id, { area_atual_id: c.C.id, estado_esperado: { area_atual_id: c.A.id } })).statusCode, 200);
    await exigirRecusa(c, t.movimentacao.id, [o.id, d.id], INTERVENCAO);
  });

  test('parcial com lote novo: categoria do derivado mudada → 409; derivado continua Ativo com 50', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500 });
    const t = await transferir(c, o, 50, c.B);
    const derivado = t.lotes.find((x) => x.id !== o.id);
    assert.equal((await patch(c, derivado.id, { categoria: 'VACA', estado_esperado: { categoria: 'BOI' } })).statusCode, 200);
    await exigirRecusa(c, t.movimentacao.id, [o.id, derivado.id], INTERVENCAO);
    const dv = await lote(derivado.id);
    assert.deepEqual([dv.quantidade_cabecas, dv.status], [50, 'Ativo']);
  });

  test('total unificada: status do destino mudado → 409', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500 });
    const d = await criarLote(c, { area: c.B, qtd: 100 });
    const t = await transferir(c, o, 500, c.B, d.id);
    assert.equal((await patch(c, d.id, { status: 'Inativo', estado_esperado: { status: 'Ativo' } })).statusCode, 200);
    await exigirRecusa(c, t.movimentacao.id, [o.id, d.id], INTERVENCAO);
  });
});

describe('R2A-R2 a5 — alteração compensatória (450 → 400 → 450) também bloqueia', () => {
  test('o saldo volta ao número do pós-estado, mas a auditoria prova intervenção não comprovada → 409', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    assert.equal((await patch(c, l.id, { quantidade_cabecas: 400, estado_esperado: { quantidade_cabecas: 450 } })).statusCode, 200);
    assert.equal((await patch(c, l.id, { quantidade_cabecas: 450, estado_esperado: { quantidade_cabecas: 400 } })).statusCode, 200);
    const recusa = await exigirRecusa(c, m.id, [l.id], ['CANCELAMENTO_ALTERACAO_POSTERIOR']);
    assert.equal(recusa.code, 'CANCELAMENTO_ALTERACAO_POSTERIOR');
    assert.equal((await lote(l.id)).quantidade_cabecas, 450);
  });

  test('status ida e volta (Ativo → Inativo → Ativo) também é intervenção', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    assert.equal((await patch(c, l.id, { status: 'Inativo', estado_esperado: { status: 'Ativo' } })).statusCode, 200);
    assert.equal((await patch(c, l.id, { status: 'Ativo', estado_esperado: { status: 'Inativo' } })).statusCode, 200);
    await exigirRecusa(c, m.id, [l.id], ['CANCELAMENTO_ALTERACAO_POSTERIOR']);
  });
});

describe('R2A-R2 a6 — sem intervenção material: tudo continua cancelável, sem crédito duplo', () => {
  test('edição sem saldo (peso, nome) não é intervenção material: morte cancela 450 → 500', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    assert.equal((await patch(c, l.id, { peso_medio_kg: 420 })).statusCode, 200);
    const r = await cancelar(c, m.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('morte, abate, transferência (no lugar, parcial novo, parcial unificada, total unificada) cancelam; replay não credita duas vezes', async () => {
    const c = await cenario();
    const l1 = await criarLote(c, { nome: 'L1', area: c.A });
    const m1 = await morte(c, l1, 50);
    const k1 = opId();
    assert.equal((await cancelar(c, m1.id, k1)).statusCode, 200);
    const replay = await cancelar(c, m1.id, k1);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replay, true);
    assert.equal((await lote(l1.id)).quantidade_cabecas, 500);

    const l2 = await criarLote(c, { nome: 'L2', area: c.A, qtd: 30 });
    const a2 = await morte(c, l2, 30, 'Abate');
    assert.equal((await cancelar(c, a2.id)).statusCode, 200);
    assert.deepEqual([(await lote(l2.id)).quantidade_cabecas, (await lote(l2.id)).status], [30, 'Ativo']);

    const l3 = await criarLote(c, { nome: 'L3', area: c.A, qtd: 40 });
    const t3 = await transferir(c, l3, 40, c.B);
    assert.equal((await cancelar(c, t3.movimentacao.id)).statusCode, 200);
    assert.equal((await lote(l3.id)).area_atual_id, c.A.id);

    const l4 = await criarLote(c, { nome: 'L4', area: c.A, qtd: 100 });
    const t4 = await transferir(c, l4, 30, c.C);
    const deriv = t4.lotes.find((x) => x.id !== l4.id);
    assert.equal((await cancelar(c, t4.movimentacao.id)).statusCode, 200);
    assert.deepEqual([(await lote(l4.id)).quantidade_cabecas, (await lote(deriv.id)).quantidade_cabecas, (await lote(deriv.id)).status], [100, 0, 'Inativo']);

    const o5 = await criarLote(c, { nome: 'L5', area: c.A, qtd: 100 });
    const d5 = await criarLote(c, { nome: 'L5', area: c.B, qtd: 20 });
    const t5 = await transferir(c, o5, 10, c.B, d5.id);
    assert.equal((await cancelar(c, t5.movimentacao.id)).statusCode, 200);
    assert.deepEqual([(await lote(o5.id)).quantidade_cabecas, (await lote(d5.id)).quantidade_cabecas], [100, 20]);

    const o6 = await criarLote(c, { nome: 'L6', area: c.A, qtd: 60 });
    const d6 = await criarLote(c, { nome: 'L6', area: c.B, qtd: 40 });
    const t6 = await transferir(c, o6, 60, c.B, d6.id);
    assert.equal((await cancelar(c, t6.movimentacao.id)).statusCode, 200);
    assert.deepEqual(
      [(await lote(o6.id)).quantidade_cabecas, (await lote(o6.id)).status, (await lote(d6.id)).quantidade_cabecas],
      [60, 'Ativo', 40]
    );
  });

  test('manejo posterior comprovado e já cancelado não bloqueia o anterior (500 → 450 → 400 → 450 → 500)', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m1 = await morte(c, l, 50);
    const m2 = await morte(c, l, 50);
    assert.equal((await cancelar(c, m1.id)).json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
    assert.equal((await cancelar(c, m2.id)).statusCode, 200);
    assert.equal((await cancelar(c, m1.id)).statusCode, 200);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });
});

describe('R2A-R2 P0-C — o comando não confia no formulário', () => {
  test('categoria_animal divergente da categoria real da origem → recusada; nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A, categoria: 'BOI' });
    const r = await manejo(c, { tipo: 'Morte', lote_id: l.id, quantidade_animais: 5, categoria_animal: 'VACA' });
    assert.ok([400, 409].includes(r.statusCode), r.body);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
    assert.equal(await prisma().movimentacaoMapa.count(), 0);
  });

  test('categoria_animal ausente: o movimento grava a categoria AUTORITATIVA do lote', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A, categoria: 'BOI' });
    const m = await morte(c, l, 5);
    assert.equal(m.categoria_animal, 'BOI');
  });

  for (const data of ['ontem', '2026-13-45', '2026-02-30T12:00:00.000Z', '']) {
    test(`data_movimentacao inválida (${JSON.stringify(data)}) → 400 e nada é criado`, async () => {
      const c = await cenario();
      const l = await criarLote(c, { area: c.A });
      const r = await manejo(c, { tipo: 'Morte', lote_id: l.id, quantidade_animais: 5, data_movimentacao: data });
      assert.equal(r.statusCode, 400, r.body);
      assert.equal((await lote(l.id)).quantidade_cabecas, 500);
      assert.equal(await prisma().movimentacaoMapa.count(), 0);
    });
  }

  test('área de destino de OUTRA empresa do mesmo tenant → 404; lote intacto', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const setorAlheio = await prisma().setor.create({ data: { cliente_id: c.cliente.id, empresa_id: c.outraEmpresa.id, numero_setor: '99', nome: 'S' } });
    const alheia = await prisma().areaPastagem.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.outraEmpresa.id, setor_id: setorAlheio.id, setor_nome: 'S', numero_area: '9', nome: 'ALHEIA', tamanho_hectares: 1 },
    });
    const r = await manejo(c, { tipo: 'Transferência de Área', lote_id: l.id, quantidade_animais: 5, area_destino_id: alheia.id });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('POST genérico não injeta efeito_servidor, modo_transferencia, lote_destino_id nem estado de cancelamento', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    for (const campo of [
      { efeito_servidor: { comando: 'manejo_mapa_lote', operation_id: 'x', efeitos: [] } },
      { modo_transferencia: 'total_no_lugar' }, { lote_destino_id: l.id }, { situacao: 'cancelado' }, { cancelamento: {} },
    ]) {
      const r = await req('POST', '/movimentacoes-mapa', c.tokAdm, {
        empresa_id: c.empresa.id, tipo: 'Morte', lote: l.nome, lote_id: l.id, quantidade_animais: 1, data_movimentacao: '2026-10-30T12:00:00.000Z', ...campo,
      });
      assert.equal(r.statusCode, 400, `${Object.keys(campo)[0]} ${r.body}`);
    }
  });
});

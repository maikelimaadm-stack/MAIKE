/**
 * R2D-P1 (D-PROD-105) — baixa multi-lote (Morte/Abate) por comando atômico,
 * cancelável como unidade. PostgreSQL real, HTTP autenticado, dados
 * sintéticos. Toda prova de "nada gravado" compara lotes (saldo, status,
 * peso, entrada), movimentos, auditorias e reservas de idempotência.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaR2B } from '../src/modules/movimentacoesMapa/manejoRebanhoComandoService.js';
import { distribuirBaixa, ordemDeAlocacao } from '../src/modules/movimentacoesMapa/manejoBaixaComandoService.js';

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
const BOI = 'Boi 25 a 36 meses';
const VACA = 'Vaca + 36 meses';
const URL_BAIXA = '/movimentacoes-mapa/comandos/baixa-rebanho';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const comum = await p.usuario.create({
    data: {
      cliente_id: adm.cliente.id, nome: 'Comum', login: `comum-${randomUUID().slice(0, 8)}`,
      senha_hash: (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash, papel_tenant: 'usuario',
    },
  });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const tokComum = (await autenticarNoApp(app, { login: comum.login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const setor2 = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: outraEmpresa.id, numero_setor: '2', nome: 'Setor 2' } });
  const area = (n, nome, emp = empresa, st = setor) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: st.id, setor_nome: st.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tok, tokComum, empresa, outraEmpresa, setor, setor2, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), X: await area(9, 'PASTO X', outraEmpresa, setor2) };
};

const criarLote = async (c, { nome, qtd, area = c.A, categoria = BOI, sexo = 'Macho', peso = 400, empresa = c.empresa, setor = c.setor }) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: empresa.id, nome, quantidade_cabecas: qtd, categoria, ...(sexo ? { sexo } : {}), setor_id: setor.id,
    area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo',
    ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
/** 40 + 30 + 20 da mesma categoria, criados nessa ordem (numero_lote crescente). */
const tres = async (c, pesos = [400, 380, null]) => ({
  l40: await criarLote(c, { nome: 'L40', qtd: 40, peso: pesos[0] }),
  l30: await criarLote(c, { nome: 'L30', qtd: 30, peso: pesos[1] }),
  l20: await criarLote(c, { nome: 'L20', qtd: 20, peso: pesos[2] }),
});
const corpo = (c, tipo, linhas, extra = {}) => ({ operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: DATA, linhas, ...extra });
const morte = (categoria, quantidade, causa_morte = 'Doença') => ({ categoria, quantidade, causa_morte });
const abate = (categoria, quantidade, extra = {}) => ({ categoria, quantidade, ...extra });
const baixar = (c, tipo, linhas, extra = {}, token = c.tok) => req('POST', URL_BAIXA, token, corpo(c, tipo, linhas, extra));
const ok = async (r) => {
  const x = await r;
  assert.equal(x.statusCode, 201, x.body);
  return x.json();
};
const lote = (id) => prisma().lote.findUnique({ where: { id } });
const peso = (l) => (l.peso_medio_kg === null ? null : Number(l.peso_medio_kg));
const saldos = async (...ls) => Promise.all(ls.map(async (l) => { const x = await lote(l.id); return `${x.quantidade_cabecas}/${x.status}`; }));
const cancelar = (c, id, token = c.tok, operation_id = opId()) => req('POST', `/movimentacoes-mapa/${id}/cancelamento`, token, { operation_id, motivo: 'baixa por engano' });
const cancelarOk = async (c, id) => {
  const r = await cancelar(c, id);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const totalAtivo = async (c) => (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, status: 'Ativo', excluido_em: null } })).reduce((t, l) => t + l.quantidade_cabecas, 0);
const contagem = async (c) => {
  const p = prisma();
  const lotes = await p.lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } });
  return {
    lotes: lotes.map((l) => [l.id, l.quantidade_cabecas, l.status, peso(l), l.quantidade_entrada, l.excluido_em ? 'X' : '']),
    movs: await p.movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }),
    audits: await p.auditLog.count({ where: { cliente_id: c.cliente.id } }),
    ops: await p.operacaoIdempotente.count({ where: { cliente_id: c.cliente.id } }),
  };
};
const exigirNadaGravado = async (c, acao, status, codigo) => {
  const antes = await contagem(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await contagem(c), antes, 'nada pode ser gravado');
  return r;
};
const exigirRecusaCancelamento = async (c, movId, codigos) => {
  const e = (await req('GET', `/movimentacoes-mapa/${movId}/elegibilidade-cancelamento`, c.tok)).json();
  assert.equal(e.elegivel, false, JSON.stringify(e));
  assert.ok(codigos.includes(e.codigo), `elegibilidade ${e.codigo}`);
  const antes = await contagem(c);
  const r = await cancelar(c, movId);
  assert.equal(r.statusCode, 409, r.body);
  assert.ok(codigos.includes(r.json().code), `POST ${r.json().code}`);
  assert.deepEqual(await contagem(c), antes, 'recusa não muda nada');
};

// ═══ Saldos, alocação e cancelamento ═══════════════════════════════════════

describe('R2D baixa — saldos, alocação, metadados e cancelamento do conjunto', () => {
  test('B1: MORTE 60 em 40+30+20 → 0/Inativo, 10, 20 (total 30); 1 movimento, 1 auditoria por participante; cancelar → 40/30/20', async () => {
    const c = await cenario();
    const { l40, l30, l20 } = await tres(c);
    const antes = await contagem(c);
    const r = await ok(baixar(c, 'Morte', [morte(BOI, 60, 'Predador')]));
    assert.deepEqual(await saldos(l40, l30, l20), ['0/Inativo', '10/Ativo', '20/Ativo']);
    assert.equal(await totalAtivo(c), 30);
    const m = r.movimentacao;
    assert.equal(m.tipo, 'Morte');
    assert.equal(m.quantidade_animais, 60);
    assert.deepEqual(m.lote_ids, [l40.id, l30.id]);
    assert.equal(m.lote_id, l40.id);
    assert.equal(m.linhas.length, 1);
    assert.equal(m.linhas[0].causa_morte, 'Predador');
    assert.deepEqual(m.linhas[0].distribuicao.map((d) => [d.lote_id, d.quantidade]), [[l40.id, 40], [l30.id, 20]]);
    assert.deepEqual(m.baixa.lotes.map((x) => [x.nome, x.saldo_antes, x.saldo_depois, x.status_depois]), [['L40', 40, 0, 'Inativo'], ['L30', 30, 10, 'Ativo']]);
    assert.equal(m.baixa.politica_alocacao, 'numero_lote_crescente_depois_id');
    assert.equal(m.efeito_servidor.comando, 'manejo_mapa_baixa_rebanho');
    assert.equal(m.efeito_servidor.efeitos.length, 2);
    const depois = await contagem(c);
    assert.equal(depois.movs - antes.movs, 1);
    assert.equal(depois.audits - antes.audits, 3, '2 lotes + 1 movimento');
    assert.equal(depois.ops - antes.ops, 1);
    const linhasAud = await prisma().auditLog.findMany({ where: { cliente_id: c.cliente.id, entidade: 'Lote', acao: 'update' } });
    assert.deepEqual(linhasAud.map((a) => a.entidade_id).sort(), [l40.id, l30.id].sort(), 'uma auditoria por participante');
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 3, 'nenhum lote criado');

    const can = await cancelarOk(c, m.id);
    assert.equal(can.efeitos.length, 2);
    assert.deepEqual(await saldos(l40, l30, l20), ['40/Ativo', '30/Ativo', '20/Ativo']);
    assert.deepEqual([peso(await lote(l40.id)), peso(await lote(l30.id)), peso(await lote(l20.id))], [400, 380, null], 'peso intocado');
    assert.equal((await lote(l40.id)).quantidade_entrada, 40, 'entrada intocada');
    assert.equal(await totalAtivo(c), 90);
  });

  test('B2: ABATE 60 — metadados são TOTAIS da linha (não multiplicados por lote); peso médio dos lotes não muda; cancelar volta', async () => {
    const c = await cenario();
    const { l40, l30, l20 } = await tres(c);
    const r = await ok(baixar(c, 'Abate', [abate(BOI, 60, { peso_vivo_total_kg: 27000, peso_carcaca_total_kg: 14000.5, destino: 'Frigorífico', destino_nome: 'frigo sintético' })]));
    const m = r.movimentacao;
    assert.equal(m.tipo, 'Abate');
    assert.deepEqual(
      [m.linhas[0].peso_vivo_total_kg, m.linhas[0].peso_carcaca_total_kg, m.linhas[0].destino, m.linhas[0].destino_nome],
      [27000, 14000.5, 'Frigorífico', 'FRIGO SINTÉTICO']
    );
    for (const d of m.linhas[0].distribuicao) assert.equal(d.peso_vivo_total_kg, undefined, 'peso não rateado por lote');
    assert.deepEqual(await saldos(l40, l30, l20), ['0/Inativo', '10/Ativo', '20/Ativo']);
    assert.deepEqual([peso(await lote(l40.id)), peso(await lote(l30.id))], [400, 380]);
    await cancelarOk(c, m.id);
    assert.deepEqual(await saldos(l40, l30, l20), ['40/Ativo', '30/Ativo', '20/Ativo']);
  });

  test('B3: 1, 2 e 3 lotes — 10 só no 1º; 50 em dois; 90 zera os três (todos Inativo, nenhum apagado)', async () => {
    for (const [q, esperado, nLotes] of [[10, ['30/Ativo', '30/Ativo', '20/Ativo'], 1], [50, ['0/Inativo', '20/Ativo', '20/Ativo'], 2], [90, ['0/Inativo', '0/Inativo', '0/Inativo'], 3]]) {
      await limparBanco();
      const c = await cenario();
      const { l40, l30, l20 } = await tres(c);
      const r = await ok(baixar(c, 'Morte', [morte(BOI, q)]));
      assert.deepEqual(await saldos(l40, l30, l20), esperado, `baixa ${q}`);
      assert.equal(r.movimentacao.lote_ids.length, nLotes);
      assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 3);
    }
  });

  test('B4: excedente (100 em 90), categoria sem lote, outra categoria → 409 BAIXA_SALDO_INSUFICIENTE com disponível; nada gravado', async () => {
    const c = await cenario();
    await tres(c);
    const r = await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 100)]), 409, 'BAIXA_SALDO_INSUFICIENTE');
    assert.deepEqual([r.json().details.disponivel, r.json().details.pedido], [90, 100]);
    await exigirNadaGravado(c, () => baixar(c, 'Abate', [abate(VACA, 1)]), 409, 'BAIXA_SALDO_INSUFICIENTE');
    // Duas linhas da mesma categoria somando mais que o disponível.
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 60, 'Doença'), morte(BOI, 31, 'Predador')]), 409, 'BAIXA_SALDO_INSUFICIENTE');
  });

  test('B5: lote inativo, zerado, excluído (#167), de outra área, outra empresa ou outro tenant não entra na conta', async () => {
    const c = await cenario();
    const { l40, l30, l20 } = await tres(c);
    await prisma().lote.update({ where: { id: l30.id }, data: { excluido_em: new Date() } });
    await prisma().lote.update({ where: { id: l20.id }, data: { status: 'Inativo' } });
    await criarLote(c, { nome: 'EM B', qtd: 50, area: c.B });
    await criarLote(c, { nome: 'OUTRA EMP', qtd: 50, area: c.X, empresa: c.outraEmpresa, setor: c.setor2 });
    const x = await cenario();
    await criarLote(x, { nome: 'OUTRO TENANT', qtd: 50 });
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 41)]), 409, 'BAIXA_SALDO_INSUFICIENTE');
    const r = await ok(baixar(c, 'Morte', [morte(BOI, 40)]));
    assert.deepEqual(r.movimentacao.lote_ids, [l40.id]);
    assert.deepEqual(await saldos(l40, l30, l20), ['0/Inativo', '30/Ativo', '20/Inativo']);
  });

  test('B5b: lotes_selecionados é só filtro — lote fora da seleção não é baixado; selecionado inelegível não entra; id de outro tenant → 404', async () => {
    const c = await cenario();
    const { l40, l30, l20 } = await tres(c);
    const r = await ok(baixar(c, 'Morte', [morte(BOI, 35)], { lotes_selecionados: [l30.id, l20.id] }));
    assert.deepEqual(r.movimentacao.lote_ids, [l30.id, l20.id]);
    assert.deepEqual(await saldos(l40, l30, l20), ['40/Ativo', '0/Inativo', '15/Ativo']);
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 16)], { lotes_selecionados: [l30.id, l20.id] }), 409, 'BAIXA_SALDO_INSUFICIENTE');
    const x = await cenario();
    const alheio = await criarLote(x, { nome: 'ALHEIO', qtd: 50 });
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 5)], { lotes_selecionados: [l40.id, alheio.id] }), 404, 'LOTE_NOT_FOUND');
    assert.equal((await lote(alheio.id)).quantidade_cabecas, 50);
  });

  test('B6: categoria oficial com lote de sexo contrário → 409 BAIXA_CLASSIFICACAO_DIVERGENTE; nada gravado', async () => {
    const c = await cenario();
    await tres(c);
    await criarLote(c, { nome: 'BOI FEMEA', qtd: 5, sexo: 'Fêmea' });
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 10)]), 409, 'BAIXA_CLASSIFICACAO_DIVERGENTE');
  });

  test('B7: mesma categoria em duas linhas (Doença 30 + Predador 20) → cada lote baixado UMA vez, distribuição por linha', async () => {
    const c = await cenario();
    const { l40, l30, l20 } = await tres(c);
    const r = await ok(baixar(c, 'Morte', [morte(BOI, 30, 'Doença'), morte(BOI, 20, 'Predador')]));
    const m = r.movimentacao;
    assert.deepEqual(m.linhas.map((l) => l.distribuicao.map((d) => [d.nome, d.quantidade])), [[['L40', 30]], [['L40', 10], ['L30', 10]]]);
    assert.deepEqual(m.lote_ids, [l40.id, l30.id]);
    assert.equal(m.efeito_servidor.efeitos.length, 2);
    assert.deepEqual(await saldos(l40, l30, l20), ['0/Inativo', '20/Ativo', '20/Ativo']);
    assert.equal((await prisma().auditLog.findMany({ where: { cliente_id: c.cliente.id, entidade: 'Lote', acao: 'update' } })).length, 2);
  });

  test('B8: duas categorias numa confirmação → UM movimento, UMA transação; cancelar devolve tudo', async () => {
    const c = await cenario();
    const { l40 } = await tres(c);
    const v1 = await criarLote(c, { nome: 'V1', qtd: 8, categoria: VACA, sexo: 'Fêmea' });
    const v2 = await criarLote(c, { nome: 'V2', qtd: 4, categoria: VACA, sexo: 'Fêmea' });
    const r = await ok(baixar(c, 'Abate', [abate(BOI, 5, { destino: 'Consumo Próprio' }), abate(VACA, 10)]));
    assert.equal(r.movimentacao.quantidade_animais, 15);
    assert.deepEqual(r.movimentacao.lote_ids, [l40.id, v1.id, v2.id]);
    assert.equal(r.movimentacao.categoria_animal, `${BOI}, ${VACA}`);
    assert.deepEqual(await saldos(l40, v1, v2), ['35/Ativo', '0/Inativo', '2/Ativo']);
    await cancelarOk(c, r.movimentacao.id);
    assert.deepEqual(await saldos(l40, v1, v2), ['40/Ativo', '8/Ativo', '4/Ativo']);
  });

  test('B9: política determinística — numero_lote crescente (numérico antes de texto), depois id; independe da ordem de criação', async () => {
    const lotes = [
      { id: 'c', numero_lote: '10', categoria: BOI, quantidade_cabecas: 5 },
      { id: 'b', numero_lote: '2', categoria: BOI, quantidade_cabecas: 5 },
      { id: 'a', numero_lote: 'X1', categoria: BOI, quantidade_cabecas: 5 },
      { id: 'd', numero_lote: null, categoria: BOI, quantidade_cabecas: 5 },
      { id: 'e', numero_lote: '2', categoria: BOI, quantidade_cabecas: 5 },
    ];
    assert.deepEqual([...lotes].sort(ordemDeAlocacao).map((l) => l.id), ['b', 'e', 'c', 'd', 'a']);
    const [linha] = distribuirBaixa(lotes, [{ categoria: BOI, quantidade: 12 }]);
    assert.deepEqual(linha.distribuicao, [{ lote_id: 'b', quantidade: 5 }, { lote_id: 'e', quantidade: 5 }, { lote_id: 'c', quantidade: 2 }]);
  });
});

// ═══ Atomicidade, idempotência, validação, isolamento ══════════════════════

describe('R2D baixa — atomicidade, idempotência e contrato', () => {
  test('A1: falha injetada no 1º, 2º, 3º efeito e antes do movimento → rollback total (inclusive reserva idempotente)', async () => {
    for (const n of [1, 2, 3, 4]) {
      await limparBanco();
      const c = await cenario();
      await tres(c);
      definirFalhaInjetadaR2B(n);
      const antes = await contagem(c);
      const r = await baixar(c, 'Morte', [morte(BOI, 85)]);
      definirFalhaInjetadaR2B(0);
      assert.equal(r.statusCode, 500, `falha ${n}: ${r.body}`);
      assert.deepEqual(await contagem(c), antes, `falha no passo ${n}`);
      assert.equal(await totalAtivo(c), 90);
    }
  });

  test('A2: replay da mesma chave → mesma resposta, uma baixa; mesma chave com conteúdo diferente → 409 IDEMPOTENCY_CONFLICT', async () => {
    const c = await cenario();
    const { l40 } = await tres(c);
    const b = corpo(c, 'Morte', [morte(BOI, 50)]);
    const r1 = await req('POST', URL_BAIXA, c.tok, b);
    assert.equal(r1.statusCode, 201, r1.body);
    const antes = await contagem(c);
    const r2 = await req('POST', URL_BAIXA, c.tok, b);
    assert.ok([200, 201].includes(r2.statusCode), r2.body);
    assert.equal(r2.json().replay, true);
    assert.equal(r2.json().movimentacao.id, r1.json().movimentacao.id);
    assert.deepEqual(await contagem(c), antes, 'replay não grava nada');
    await exigirNadaGravado(c, () => req('POST', URL_BAIXA, c.tok, { ...b, linhas: [morte(BOI, 51)] }), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await lote(l40.id)).quantidade_cabecas, 0);
  });

  test('A3: contrato estrito — campos reservados, saldo/lote do cliente e formas inválidas → 400; nada gravado', async () => {
    const c = await cenario();
    const { l40 } = await tres(c);
    const casos = [
      { efeito_servidor: {} }, { lote_ids: [l40.id] }, { cliente_id: 'x' }, { situacao: 'cancelado' }, { usuario_responsavel: 'x' },
      { tipo: 'Transferência de Área' }, { tipo: 'Entrada' }, { data_movimentacao: '2026-02-30' }, { data_movimentacao: '2026-10-30texto' },
      { linhas: [] }, { linhas: [morte(BOI, 0)] }, { linhas: [morte(BOI, 1.5)] }, { linhas: [{ categoria: BOI, quantidade: 2 }] },
      { linhas: [{ ...morte(BOI, 2), lote_id: l40.id }] }, { linhas: [{ ...morte(BOI, 2), quantidade_cabecas: 1 }] },
      { linhas: [{ ...morte(BOI, 2), destino: 'Frigorífico', destino_nome: 'X' }] }, { linhas: [{ ...morte(BOI, 2), causa_morte: 'Veneno' }] },
    ];
    for (const extra of casos) await exigirNadaGravado(c, () => req('POST', URL_BAIXA, c.tok, { ...corpo(c, 'Morte', [morte(BOI, 2)]), ...extra }), 400);
    const casosAbate = [
      [abate(BOI, 2, { causa_morte: 'Doença' })],
      [abate(BOI, 2, { peso_vivo_total_kg: 800, peso_carcaca_total_kg: 900 })],
      [abate(BOI, 2, { peso_vivo_total_kg: 7000 })],
      [abate(BOI, 2, { destino: 'Frigorífico' })],
      [abate(BOI, 2, { destino_nome: 'SEM DESTINO' })],
      [abate(BOI, 2, { destino: 'Lua' })],
    ];
    for (const linhas of casosAbate) await exigirNadaGravado(c, () => req('POST', URL_BAIXA, c.tok, corpo(c, 'Abate', linhas)), 400);
  });

  test('A4: outro tenant, área de outra empresa ou inexistente → 404 sem vazamento; sem token → 401', async () => {
    const c = await cenario();
    await tres(c);
    const x = await cenario();
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 5)], {}, x.tok), 404);
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 5)], { area_id: c.X.id }), 404, 'AREA_NOT_FOUND');
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 5)], { empresa_id: x.empresa.id, area_id: x.A.id }), 404);
    await exigirNadaGravado(c, () => req('POST', URL_BAIXA, null, corpo(c, 'Morte', [morte(BOI, 5)])), 401);
  });

  test('A5: POST genérico com lote_ids/linhas/efeito_servidor continua recusado; usuário comum pode registrar baixa (permissão de manejo)', async () => {
    const c = await cenario();
    const { l40 } = await tres(c);
    for (const extra of [{ lote_ids: [l40.id] }, { linhas: [] }, { efeito_servidor: { comando: 'manejo_mapa_baixa_rebanho' } }]) {
      const r = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Morte', lote: 'L40', lote_id: l40.id, quantidade_animais: 1, ...extra });
      assert.equal(r.statusCode, 400, r.body);
    }
    await ok(baixar(c, 'Morte', [morte(BOI, 1)], {}, c.tokComum));
  });
});

// ═══ Data operacional (guarda de comando novo) ═════════════════════════════

describe('R2D baixa — data operacional', () => {
  test('D1: registro ATIVO posterior num participante → 409 BAIXA_DATA_RETROATIVA; mesmo dia e anterior passam; cancelado não bloqueia', async () => {
    const c = await cenario();
    const { l40, l30 } = await tres(c);
    const mapa = (dados) => prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Observação', ...dados } } });
    await mapa({ lote_id: l30.id, data_movimentacao: '2026-10-31' });
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 60)]), 409, 'BAIXA_DATA_RETROATIVA');
    // Só L40 participa (baixa de 40): o posterior em L30 não importa.
    await ok(baixar(c, 'Morte', [morte(BOI, 10)]));
    await prisma().movimentacaoMapa.updateMany({ where: { cliente_id: c.cliente.id, empresa_id: c.empresa.id }, data: { dados: { tipo: 'Observação', lote_id: l30.id, data_movimentacao: '2026-10-31', situacao: 'cancelado' } } });
    await mapa({ lote_id: l30.id, data_movimentacao: '2026-10-30T23:00:00-03:00' });
    await ok(baixar(c, 'Morte', [morte(BOI, 40)]));
    // 10 (só L40) + 40 (30 restantes de L40 + 10 de L30).
    assert.deepEqual(await saldos(l40, l30), ['0/Inativo', '20/Ativo']);
  });

  test('D2: data impossível e sem data, registradas depois → bloqueiam (createdAt); tarefa só prevista não', async () => {
    const c = await cenario();
    const { l40 } = await tres(c);
    await prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: l40.id, data_evento: '2026-02-30' } } });
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 5)]), 409, 'BAIXA_DATA_RETROATIVA');
    await ok(baixar(c, 'Morte', [morte(BOI, 5)], { data_movimentacao: '2026-11-02T12:00:00.000Z' }));
  });

  test('D3: 610 movimentos cancelados posteriores + 1 ativo → bloqueia; só cancelados → passa', async () => {
    const c = await cenario();
    const { l40 } = await tres(c);
    await prisma().movimentacaoMapa.createMany({
      data: Array.from({ length: 611 }, (_, i) => ({ cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Pesagem', lote_id: l40.id, data_movimentacao: '2026-10-31', ...(i === 600 ? {} : { situacao: 'cancelado' }) } })),
    });
    await exigirNadaGravado(c, () => baixar(c, 'Morte', [morte(BOI, 5)]), 409, 'BAIXA_DATA_RETROATIVA');
    await prisma().movimentacaoMapa.updateMany({ where: { cliente_id: c.cliente.id }, data: { dados: { tipo: 'Pesagem', lote_id: l40.id, data_movimentacao: '2026-10-31', situacao: 'cancelado' } } });
    await ok(baixar(c, 'Morte', [morte(BOI, 5)]));
  });
});

// ═══ Cancelamento causal, histórico e #167 ═════════════════════════════════

describe('R2D baixa — cancelamento, histórico e exclusão (#167)', () => {
  test('X1: só administrador cancela; replay do cancelamento não duplica; segundo cancelamento → CANCELAMENTO_JA_REALIZADO', async () => {
    const c = await cenario();
    const { l40, l30 } = await tres(c);
    const m = (await ok(baixar(c, 'Morte', [morte(BOI, 60)]))).movimentacao;
    const antes = await contagem(c);
    const r = await cancelar(c, m.id, c.tokComum);
    assert.equal(r.statusCode, 403, r.body);
    assert.deepEqual(await contagem(c), antes);
    const chave = opId();
    const c1 = await cancelar(c, m.id, c.tok, chave);
    assert.equal(c1.statusCode, 200, c1.body);
    const meio = await contagem(c);
    const c2 = await cancelar(c, m.id, c.tok, chave);
    assert.equal(c2.json().replay, true);
    assert.deepEqual(await contagem(c), meio);
    const c3 = await cancelar(c, m.id);
    assert.equal(c3.statusCode, 409);
    assert.equal(c3.json().code, 'CANCELAMENTO_JA_REALIZADO');
    assert.deepEqual(await saldos(l40, l30), ['40/Ativo', '30/Ativo']);
  });

  test('X2: manejo posterior comprovado num participante bloqueia; cancelado ele, a baixa cancela', async () => {
    const c = await cenario();
    const { l40, l30 } = await tres(c);
    const m = (await ok(baixar(c, 'Morte', [morte(BOI, 50)]))).movimentacao;
    const pes = await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-31T12:00:00.000Z', linhas: [{ lote_id: l30.id, peso_medio_kg: 410 }] }));
    await exigirRecusaCancelamento(c, m.id, ['CANCELAMENTO_DEPENDENCIA_POSTERIOR']);
    await cancelarOk(c, pes.movimentacao.id);
    await cancelarOk(c, m.id);
    assert.deepEqual(await saldos(l40, l30), ['40/Ativo', '30/Ativo']);
    assert.equal(peso(await lote(l30.id)), 380);
  });

  test('X3: alteração direta (ida e volta) num participante → CANCELAMENTO_ALTERACAO_POSTERIOR; estado divergente → recusa; nada muda', async () => {
    const c = await cenario();
    const { l30 } = await tres(c);
    const m = (await ok(baixar(c, 'Morte', [morte(BOI, 50)]))).movimentacao;
    for (const v of [395, 380]) {
      const r = await req('PATCH', `/lotes/${l30.id}`, c.tok, { peso_medio_kg: v });
      assert.equal(r.statusCode, 200, r.body);
    }
    await exigirRecusaCancelamento(c, m.id, ['CANCELAMENTO_ALTERACAO_POSTERIOR']);
    const d = await cenario();
    const t = await tres(d);
    const m2 = (await ok(baixar(d, 'Morte', [morte(BOI, 50)]))).movimentacao;
    await prisma().lote.update({ where: { id: t.l30.id }, data: { quantidade_cabecas: 19 } });
    await exigirRecusaCancelamento(d, m2.id, ['CANCELAMENTO_ESTADO_DIVERGENTE', 'CANCELAMENTO_ALTERACAO_POSTERIOR']);
  });

  test('X4: Morte legada (POST genérico) e Morte individual R2A seguem pelos caminhos antigos', async () => {
    const c = await cenario();
    const { l40, l30 } = await tres(c);
    const leg = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Morte', lote: 'L40', lote_id: l40.id, quantidade_animais: 1, data_movimentacao: '2026-09-01' });
    assert.equal(leg.statusCode, 201, leg.body);
    await exigirRecusaCancelamento(c, leg.json().id, ['CANCELAMENTO_EFEITO_NAO_COMPROVADO']);
    const ind = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), tipo: 'Abate', empresa_id: c.empresa.id, lote_id: l30.id, quantidade_animais: 3, data_movimentacao: DATA });
    assert.equal(ind.statusCode, 201, ind.body);
    await cancelarOk(c, ind.json().movimentacao.id);
    assert.equal((await lote(l30.id)).quantidade_cabecas, 30);
  });

  test('H1: histórico por lote e por área acha a baixa em cada participante (não no lote que não participou), com total íntegro', async () => {
    const c = await cenario();
    const { l40, l30, l20 } = await tres(c);
    const m = (await ok(baixar(c, 'Abate', [abate(BOI, 50)]))).movimentacao;
    for (const l of [l40, l30]) {
      const h = (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${l.id}`, c.tok)).json();
      assert.deepEqual([h.items.map((x) => x.id), h.total], [[m.id], 1], l.nome);
    }
    assert.equal((await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${l20.id}`, c.tok)).json().total, 0);
    const area = (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&area_id=${c.A.id}&limit=1`, c.tok)).json();
    assert.deepEqual(area.items.map((x) => x.id), [m.id]);
  });

  test('H2: #167 — participante de baixa ativa não sai do Cadastro; depois do cancelamento, exclusão lógica e histórico preservado', async () => {
    const c = await cenario();
    const { l40, l30 } = await tres(c);
    const m = (await ok(baixar(c, 'Morte', [morte(BOI, 50)]))).movimentacao;
    for (const l of [l40, l30]) {
      const e = (await req('GET', `/lotes/${l.id}/elegibilidade-exclusao`, c.tok)).json();
      assert.deepEqual([e.tipo, e.motivo], ['bloqueado', 'movimentacao_ativa'], JSON.stringify(e));
      assert.equal((await req('DELETE', `/lotes/${l.id}`, c.tok)).statusCode, 409);
    }
    await cancelarOk(c, m.id);
    for (const l of [l40, l30]) {
      assert.equal((await req('GET', `/lotes/${l.id}/elegibilidade-exclusao`, c.tok)).json().tipo, 'exclusao_logica');
      assert.equal((await req('DELETE', `/lotes/${l.id}`, c.tok)).statusCode, 204);
    }
    const h = (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${l30.id}`, c.tok)).json();
    assert.deepEqual(h.items.map((x) => [x.id, x.situacao]), [[m.id, 'cancelado']]);
  });
});

// ═══ Concorrência real (3 rodadas) ═════════════════════════════════════════

describe('R2D baixa — concorrência real (3 rodadas)', () => {
  for (let rodada = 1; rodada <= 3; rodada += 1) {
    test(`K1.${rodada}: duas baixas disputando o saldo (60 + 60 em 90) → uma 201, outra 409; sem cabeça fantasma`, async () => {
      const c = await cenario();
      await tres(c);
      const rs = await Promise.all([baixar(c, 'Morte', [morte(BOI, 60)]), baixar(c, 'Abate', [abate(BOI, 60)])]);
      assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409], rs.map((r) => r.body).join(' | '));
      assert.equal(await totalAtivo(c), 30);
      assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
    });

    test(`K2.${rodada}: baixa × transferência do participante → conservação exata`, async () => {
      const c = await cenario();
      const { l30 } = await tres(c);
      const [b, t] = await Promise.all([
        baixar(c, 'Morte', [morte(BOI, 60)]),
        req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: l30.id, quantidade_animais: 30, area_destino_id: c.B.id, data_movimentacao: '2026-10-29T12:00:00.000Z' }),
      ]);
      assert.ok([201, 409].includes(b.statusCode), b.body);
      assert.ok([201, 409].includes(t.statusCode), t.body);
      assert.equal(await totalAtivo(c), 90 - (b.statusCode === 201 ? 60 : 0));
      const emA = (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, area_atual_id: c.A.id, status: 'Ativo' } })).reduce((s, l) => s + l.quantidade_cabecas, 0);
      const emB = (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, area_atual_id: c.B.id, status: 'Ativo' } })).reduce((s, l) => s + l.quantidade_cabecas, 0);
      assert.equal(emA + emB, await totalAtivo(c));
      for (const l of await prisma().lote.findMany({ where: { cliente_id: c.cliente.id } })) assert.ok(l.quantidade_cabecas >= 0);
    });

    test(`K3.${rodada}: baixa × junção dos mesmos lotes → total = 90 − baixa efetivada`, async () => {
      const c = await cenario();
      const { l40, l30, l20 } = await tres(c);
      const [b, j] = await Promise.all([
        baixar(c, 'Morte', [morte(BOI, 50)]),
        req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: l20.id, lote_origem_ids: [l40.id, l30.id], data_movimentacao: '2026-10-29T12:00:00.000Z' }),
      ]);
      assert.ok([201, 409].includes(b.statusCode), b.body);
      assert.ok([201, 409].includes(j.statusCode), j.body);
      assert.equal(await totalAtivo(c), 90 - (b.statusCode === 201 ? 50 : 0));
    });

    test(`K4.${rodada}: baixa × DELETE de participante → nunca baixa em lote excluído nem exclusão órfã`, async () => {
      const c = await cenario();
      const { l40 } = await tres(c);
      const [b, d] = await Promise.all([baixar(c, 'Morte', [morte(BOI, 50)]), req('DELETE', `/lotes/${l40.id}`, c.tok)]);
      assert.ok([201, 409].includes(b.statusCode), b.body);
      assert.ok([204, 409].includes(d.statusCode), d.body);
      const l = await lote(l40.id);
      if (d.statusCode === 204) {
        // Exclusão primeiro (#167: lote sem histórico sai fisicamente; senão, tombstone): some da conta e a baixa (se houve) usou os outros.
        assert.ok(!l || (l.excluido_em && l.quantidade_cabecas === 40));
        if (b.statusCode === 201) assert.ok(!b.json().movimentacao.lote_ids.includes(l40.id), 'lote excluído não participa');
      } else {
        // Baixa primeiro: o participante ficou com movimento ativo e não pode ser excluído.
        assert.equal(b.statusCode, 201, b.body);
        assert.ok(!l.excluido_em);
        assert.ok(b.json().movimentacao.lote_ids.includes(l40.id));
      }
      assert.equal(await totalAtivo(c), 90 - (b.statusCode === 201 ? 50 : 0) - (d.statusCode === 204 ? 40 : 0));
    });

    test(`K5.${rodada}: cancelar baixa × pesagem do participante → nunca reverte por cima`, async () => {
      const c = await cenario();
      const { l30 } = await tres(c);
      const m = (await ok(baixar(c, 'Morte', [morte(BOI, 50)]))).movimentacao;
      const [canc, pes] = await Promise.all([
        cancelar(c, m.id),
        req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-31T12:00:00.000Z', linhas: [{ lote_id: l30.id, peso_medio_kg: 450 }] }),
      ]);
      assert.ok([200, 409].includes(canc.statusCode), canc.body);
      assert.equal(pes.statusCode, 201, pes.body);
      assert.equal(peso(await lote(l30.id)), 450);
      if (canc.statusCode === 200) assert.equal((await lote(l30.id)).quantidade_cabecas, 30);
      else {
        assert.equal(canc.json().code, 'CANCELAMENTO_DEPENDENCIA_POSTERIOR');
        assert.equal((await lote(l30.id)).quantidade_cabecas, 20);
      }
    });

    test(`K6.${rodada}: confirmação duplicada em paralelo (mesma chave) → uma baixa, um movimento`, async () => {
      const c = await cenario();
      await tres(c);
      const b = corpo(c, 'Morte', [morte(BOI, 60)]);
      const rs = await Promise.all([req('POST', URL_BAIXA, c.tok, b), req('POST', URL_BAIXA, c.tok, b), req('POST', URL_BAIXA, c.tok, b)]);
      for (const r of rs) assert.ok([200, 201, 409].includes(r.statusCode), r.body);
      assert.ok(rs.some((r) => r.statusCode === 201));
      assert.equal(await totalAtivo(c), 30);
      assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), 1);
    });
  }
});

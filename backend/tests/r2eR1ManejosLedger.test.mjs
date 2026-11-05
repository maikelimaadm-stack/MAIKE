/**
 * PR174-R1 (D-PROD-107) — TODOS os manejos do mapa numa empresa no ledger:
 * Morte/Abate (R2D/R2A), Nascimento, Pesagem, Mudança de Categoria (R2B),
 * Junção (R2C) e transferência, com cancelamento, retroatividade, série de
 * peso, composição de linhagem, rollback, tenant e concorrência.
 * Cada prova confere o BANCO: Lote intacto, posições, eventos, partidas,
 * pesos, ponte de histórico e verificação de integridade/conservação.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaLedger } from '../src/modules/rebanhoLedger/rebanhoLedgerService.js';

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
  definirFalhaInjetadaLedger(null);
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  definirFalhaInjetadaLedger(null);
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const BOI = 'Boi 25 a 36 meses';
const GARROTE = 'Garrote 13 a 24 meses';
const VACA = 'Vaca + 36 meses';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tok, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
};
const entrada = async (c, { nome = 'LOTE', qtd = 40, area = c.A, data = '2026-10-25', categoria = BOI, sexo = 'Macho', peso = 400 } = {}) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
/** Empresa reconstruída pelas entradas (linha do tempo completa desde cada entrada). */
const ativar = async (c) => {
  const r = await req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const posicoes = async (c) => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}&incluir_vazias=true`, c.tok)).json().itens;
const pos = async (c, filtro) => (await posicoes(c)).find(filtro);
const daEntrada = (lote, area) => (p) => p.lote_entrada_id === lote.id && p.area_atual_id === area.id;
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const totalPorArea = async (c) => {
  const m = {};
  for (const p of await posicoes(c)) if (p.quantidade_cabecas > 0) m[p.area_atual_nome] = (m[p.area_atual_nome] ?? 0) + p.quantidade_cabecas;
  return m;
};
const verificar = async (c) => {
  const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
  assert.equal(v.integro, true, JSON.stringify(v));
  return v;
};
const loteFixo = async (c) => (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.quantidade_entrada, l.status, l.area_atual_id, l.categoria, l.origem]);
const contagem = async (c) => {
  const p = prisma();
  const w = { cliente_id: c.cliente.id };
  return {
    lotes: await loteFixo(c),
    posicoes: (await p.posicaoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.quantidade_cabecas, x.peso_medio_kg === null ? null : Number(x.peso_medio_kg), JSON.stringify(x.linhagem)]),
    eventos: await p.eventoRebanho.count({ where: w }),
    partidas: await p.partidaRebanho.count({ where: w }),
    pesos: await p.pesoRebanho.count({ where: w }),
    movs: await p.movimentacaoMapa.count({ where: w }),
    audits: await p.auditLog.count({ where: w }),
    ops: await p.operacaoIdempotente.count({ where: w }),
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
const cancelar = (c, movId, operation_id = opId()) => req('POST', `/movimentacoes-mapa/${movId}/cancelamento`, c.tok, { operation_id, motivo: 'teste do ledger' });
const baixa = (c, tipo, linhas, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas, ...extra });
const rebanho = (c, tipo, linhas, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas, ...extra });
const juntar = (c, principal, origens, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: principal.id, lote_origem_ids: origens.map((o) => o.id), data_movimentacao: '2026-11-02', ...extra });
const transferir = (c, itens, destino, dia) =>
  req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: destino.id, data_movimentacao: `2026-11-${dia}`, itens });
const saldoEm = async (c, data) => (await req('GET', `/rebanho/saldos?empresa_id=${c.empresa.id}&data=${data}`, c.tok)).json();

// ═══ B1: Morte e Abate ═════════════════════════════════════════════════════

describe('R1 B1 — Morte e Abate no ledger', () => {
  test('M1: morte em duas categorias numa confirmação → 1 evento, posições baixadas, Lote intacto; cancelar restaura; conservação', async () => {
    const c = await cenario();
    const l40 = await entrada(c, { nome: 'L40', qtd: 40 });
    const l30 = await entrada(c, { nome: 'L30', qtd: 30 });
    await entrada(c, { nome: 'VACAS', qtd: 10, categoria: VACA, sexo: 'Fêmea' });
    await ativar(c);
    const lotesAntes = await loteFixo(c);
    const r = await ok(baixa(c, 'Morte', [{ categoria: BOI, quantidade: 50, causa_morte: 'Doença' }, { categoria: VACA, quantidade: 3, causa_morte: 'Predador' }]));
    assert.equal(r.movimentacao.tipo, 'Morte');
    assert.equal(r.movimentacao.quantidade_animais, 53);
    assert.equal(r.movimentacao.efeito_servidor.comando, 'rebanho_ledger');
    assert.deepEqual([(await pos(c, daEntrada(l40, c.A))).quantidade_cabecas, (await pos(c, daEntrada(l30, c.A))).quantidade_cabecas], [0, 20]);
    assert.deepEqual(await totalPorArea(c), { 'PASTO A': 27 });
    assert.deepEqual(await loteFixo(c), lotesAntes, 'Lote intacto (cadastro de entrada)');
    assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id, tipo: 'MORTE' } }), 1);
    const v = await verificar(c);
    assert.deepEqual([v.conservacao.entradas, v.conservacao.saidas, v.conservacao.saldo], [80, -53, 27]);
    await ok(cancelar(c, r.movimentacao.id), 200);
    assert.deepEqual(await totalPorArea(c), { 'PASTO A': 80 });
    await verificar(c);
  });

  test('M2: abate retroativo cabe na linha do tempo; retroativo que quebra a transferência futura → 409 com data; acima do saldo → 409; nada gravado', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 500 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '02'));
    await ok(baixa(c, 'Abate', [{ categoria: BOI, quantidade: 50, destino: 'Consumo Próprio' }], { data_movimentacao: '2026-11-01' }));
    assert.deepEqual(await totalPorArea(c), { 'PASTO A': 350, 'PASTO B': 100 });
    const r = await exigirNadaGravado(c, () => baixa(c, 'Abate', [{ categoria: BOI, quantidade: 401 }], { data_movimentacao: '2026-11-01' }), 409, 'REBANHO_SALDO_HISTORICO_NEGATIVO');
    assert.deepEqual([r.json().details.data, r.json().details.area_nome], ['2026-11-02', 'PASTO A']);
    await exigirNadaGravado(c, () => baixa(c, 'Morte', [{ categoria: BOI, quantidade: 351, causa_morte: 'Doença' }]), 409, 'BAIXA_SALDO_INSUFICIENTE');
    assert.deepEqual((await saldoEm(c, '2026-11-01')).areas.map((a) => [a.area_nome, a.total]), [['PASTO A', 450]]);
    await verificar(c);
  });

  test('M3: falha injetada após 1ª partida, após validar e antes da auditoria → ZERO mudança (inclusive reserva idempotente)', async () => {
    for (const passo of ['apos_primeira_partida', 'apos_validar_manejo', 'antes_auditoria_manejo']) {
      await limparBanco();
      const c = await cenario();
      await entrada(c, { nome: 'L1', qtd: 40 });
      await entrada(c, { nome: 'L2', qtd: 30 });
      await ativar(c);
      definirFalhaInjetadaLedger(passo);
      const antes = await contagem(c);
      const r = await baixa(c, 'Morte', [{ categoria: BOI, quantidade: 60, causa_morte: 'Doença' }]);
      definirFalhaInjetadaLedger(null);
      assert.equal(r.statusCode, 500, `${passo}: ${r.body}`);
      assert.deepEqual(await contagem(c), antes, passo);
    }
  });

  test('M4: R2A manejo-lote (Morte de UMA posição) e replay da mesma chave; id de CADASTRO não é posição (404)', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 40 });
    await ativar(c);
    const p = await pos(c, daEntrada(l, c.A));
    const corpo = { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, lote_id: p.id, quantidade_animais: 4, data_movimentacao: '2026-11-02T12:00:00.000Z' };
    const r1 = await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, corpo));
    const antes = await contagem(c);
    const r2 = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, corpo);
    assert.equal(r2.json().replay, true);
    assert.equal(r2.json().movimentacao.id, r1.movimentacao.id);
    assert.deepEqual(await contagem(c), antes);
    assert.equal((await pos(c, daEntrada(l, c.A))).quantidade_cabecas, 36);
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { ...corpo, operation_id: opId(), lote_id: l.id }), 404, 'POSICAO_REBANHO_NOT_FOUND');
  });
});

// ═══ B2–B4: Nascimento, Pesagem, Mudança ═══════════════════════════════════

describe('R1 B2–B4 — Nascimento, Pesagem, Mudança de Categoria no ledger', () => {
  test('N1: nascimento = cabeças NOVAS (origem nascimento, sem cadastro/compra); crias transferidas → cancelar nascimento bloqueia; mãe inválida → 409', async () => {
    const c = await cenario();
    await entrada(c, { nome: 'MATRIZES', qtd: 20, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    await ativar(c);
    const lotesAntes = await loteFixo(c);
    const r = await ok(rebanho(c, 'Nascimento', [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 8, peso_medio_kg: 35 }]));
    const crias = await pos(c, (p) => p.categoria === 'Bezerro 0 a 12 meses');
    assert.deepEqual([crias.quantidade_cabecas, crias.lote_entrada_id, crias.origem, crias.peso_medio_kg, crias.sexo], [8, null, 'nascimento', 35, 'Macho']);
    assert.deepEqual(await loteFixo(c), lotesAntes, 'nascimento não cria cadastro de compra');
    assert.equal(r.movimentacao.linhas[0].maes_posicao_ids.length, 1);
    const v = await verificar(c);
    assert.deepEqual([v.conservacao.entradas, v.conservacao.nascimentos, v.conservacao.saldo], [20, 8, 28]);
    const t = await ok(transferir(c, [{ posicao_id: crias.id, quantidade: 8 }], c.B, '03'));
    const e = (await req('GET', `/movimentacoes-mapa/${r.movimentacao.id}/elegibilidade-cancelamento`, c.tok)).json();
    assert.deepEqual([e.elegivel, e.codigo], [false, 'CANCELAMENTO_SALDO_HISTORICO_NEGATIVO']);
    await ok(cancelar(c, t.movimentacao.id), 200);
    await ok(cancelar(c, r.movimentacao.id), 200);
    assert.deepEqual(await totalPorArea(c), { 'PASTO A': 20 });
    await exigirNadaGravado(c, () => rebanho(c, 'Nascimento', [{ sexo: 'Fêmea', categoria_mae: BOI, quantidade: 2 }]), 409, 'MANEJO_CATEGORIA_MAE_INVALIDA');
    await verificar(c);
  });

  test('P1: pesagem — série histórica: retroativa não sobrescreve a medição posterior; saldo/peso em data; cancelar recompõe; desconhecido continua null', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 40, peso: 400 });
    const s = await entrada(c, { nome: 'SEM PESO', qtd: 10, peso: null });
    await ativar(c);
    const p = await pos(c, daEntrada(l, c.A));
    const r05 = await ok(rebanho(c, 'Pesagem', [{ lote_id: p.id, peso_medio_kg: 450 }], { data_movimentacao: '2026-11-05' }));
    await ok(rebanho(c, 'Pesagem', [{ lote_id: p.id, peso_medio_kg: 420 }], { data_movimentacao: '2026-11-01' }));
    assert.equal((await pos(c, daEntrada(l, c.A))).peso_medio_kg, 450, 'a medição mais recente continua valendo');
    const pesoEm = async (d) => (await saldoEm(c, d)).posicoes.find((x) => x.posicao_id === p.id).peso_medio_kg;
    assert.deepEqual([await pesoEm('2026-10-30'), await pesoEm('2026-11-02'), await pesoEm('2026-11-06')], [400, 420, 450]);
    await ok(cancelar(c, r05.movimentacao.id), 200);
    assert.equal((await pos(c, daEntrada(l, c.A))).peso_medio_kg, 420);
    assert.equal((await pos(c, daEntrada(s, c.A))).peso_medio_kg, null, 'desconhecido não vira zero');
    const ps = await pos(c, daEntrada(s, c.A));
    await ok(transferir(c, [{ posicao_id: ps.id, quantidade: 5 }], c.B, '03'));
    assert.equal((await pos(c, daEntrada(s, c.B))).peso_medio_kg, null);
    await verificar(c);
  });

  test('C1: mudança de categoria parcial/total na mesma linhagem, sem novo Lote; sexo incompatível → 409; cancelar restaura', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 50, categoria: GARROTE, peso: 300 });
    await ativar(c);
    const lotesAntes = await loteFixo(c);
    const r = await ok(rebanho(c, 'Mudança de Categoria', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 20 }]));
    const g = await pos(c, (x) => x.categoria === GARROTE);
    const b = await pos(c, (x) => x.categoria === BOI);
    assert.deepEqual([g.quantidade_cabecas, b.quantidade_cabecas, b.lote_entrada_id, b.peso_medio_kg], [30, 20, l.id, 300]);
    assert.deepEqual(await loteFixo(c), lotesAntes, 'nenhum Lote criado/alterado');
    assert.deepEqual(r.movimentacao.linhas[0].partes.map((x) => x.quantidade), [20]);
    await exigirNadaGravado(c, () => rebanho(c, 'Mudança de Categoria', [{ categoria_atual: GARROTE, categoria_nova: VACA, quantidade: 5 }]), 409, 'MANEJO_CATEGORIA_INCOMPATIVEL');
    await exigirNadaGravado(c, () => rebanho(c, 'Mudança de Categoria', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 31 }]), 409, 'MANEJO_SALDO_INSUFICIENTE');
    await ok(cancelar(c, r.movimentacao.id), 200);
    assert.equal((await pos(c, (x) => x.categoria === GARROTE)).quantidade_cabecas, 50);
    await verificar(c);
  });
});

// ═══ B5: Junção ════════════════════════════════════════════════════════════

describe('R1 B5 — Junção de posições no ledger', () => {
  test('J1: 3 entradas (uma sem peso) → principal com tudo, origens 0, composição de linhagens, peso desconhecido; Lote intacto; histórico por origem; cancelar desfaz composição', async () => {
    const c = await cenario();
    const p = await entrada(c, { nome: 'P', qtd: 40, peso: 400 });
    const o1 = await entrada(c, { nome: 'O1', qtd: 30, peso: 380 });
    const o2 = await entrada(c, { nome: 'O2', qtd: 20, peso: null });
    await ativar(c);
    const lotesAntes = await loteFixo(c);
    const [pp, po1, po2] = [await pos(c, daEntrada(p, c.A)), await pos(c, daEntrada(o1, c.A)), await pos(c, daEntrada(o2, c.A))];
    const r = await ok(juntar(c, pp, [po1, po2]));
    const depois = await pos(c, daEntrada(p, c.A));
    assert.deepEqual([depois.quantidade_cabecas, depois.peso_medio_kg], [90, null]);
    const contrib = depois.linhagem.filter((x) => x.classe === 'contribuicao_juncao');
    assert.deepEqual(contrib.map((x) => [x.lote_id, x.quantidade]).sort(), [[o1.id, 30], [o2.id, 20]].sort());
    assert.deepEqual(await loteFixo(c), lotesAntes, 'entradas intactas');
    for (const l of [o1, o2]) {
      const h = (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${l.id}`, c.tok)).json();
      assert.deepEqual(h.items.map((m) => m.id), [r.movimentacao.id]);
    }
    await ok(cancelar(c, r.movimentacao.id), 200);
    const volta = await pos(c, daEntrada(p, c.A));
    assert.deepEqual([volta.quantidade_cabecas, volta.peso_medio_kg, volta.linhagem.filter((x) => x.classe === 'contribuicao_juncao').length], [40, 400, 0]);
    assert.equal((await pos(c, daEntrada(o1, c.A))).quantidade_cabecas, 30);
    await verificar(c);
  });

  test('J2: 5 origens com peso conhecido → média ponderada; 20 origens → aceita; classificação divergente → 409', async () => {
    const c = await cenario();
    const p = await entrada(c, { nome: 'P', qtd: 10, peso: 300 });
    const os = [];
    for (let i = 0; i < 5; i += 1) os.push(await entrada(c, { nome: `O${i}`, qtd: i + 1, peso: 300 + i * 10 }));
    const vaca = await entrada(c, { nome: 'V', qtd: 3, categoria: VACA, sexo: 'Fêmea' });
    await ativar(c);
    const pp = await pos(c, daEntrada(p, c.A));
    const pos5 = [];
    for (const o of os) pos5.push(await pos(c, daEntrada(o, c.A)));
    await exigirNadaGravado(c, async () => juntar(c, pp, [await pos(c, daEntrada(vaca, c.A))]), 409, 'JUNCAO_CLASSIFICACAO_DIVERGENTE');
    await ok(juntar(c, pp, pos5));
    const esperado = Number(((10 * 300 + os.reduce((t, _o, i) => t + (i + 1) * (300 + i * 10), 0)) / 25).toFixed(4));
    assert.deepEqual([(await pos(c, daEntrada(p, c.A))).quantidade_cabecas, (await pos(c, daEntrada(p, c.A))).peso_medio_kg], [25, esperado]);
    const d = await cenario();
    const p2 = await entrada(d, { nome: 'P', qtd: 1 });
    const vinte = [];
    for (let i = 0; i < 20; i += 1) vinte.push(await entrada(d, { nome: `X${i}`, qtd: 1 }));
    await ativar(d);
    const pv = [];
    for (const o of vinte) pv.push(await pos(d, daEntrada(o, d.A)));
    await ok(juntar(d, await pos(d, daEntrada(p2, d.A)), pv));
    assert.equal((await pos(d, daEntrada(p2, d.A))).quantidade_cabecas, 21);
    await verificar(c);
    await verificar(d);
  });
});

// ═══ Tenant e concorrência ═════════════════════════════════════════════════

describe('R1 — tenant e concorrência (3 rodadas)', () => {
  test('T1: posição/área de outro tenant em baixa, pesagem, junção e nascimento → 404 sem gravar', async () => {
    const c = await cenario();
    const l = await entrada(c);
    await ativar(c);
    const x = await cenario();
    const lx = await entrada(x);
    await ativar(x);
    const px = await pos(x, daEntrada(lx, x.A));
    const p = await pos(c, daEntrada(l, c.A));
    await exigirNadaGravado(c, () => baixa(c, 'Morte', [{ categoria: BOI, quantidade: 1, causa_morte: 'Doença' }], { lotes_selecionados: [px.id] }), 404);
    await exigirNadaGravado(c, () => rebanho(c, 'Pesagem', [{ lote_id: px.id, peso_medio_kg: 400 }]), 404);
    await exigirNadaGravado(c, () => juntar(c, p, [px]), 404);
    await exigirNadaGravado(c, () => rebanho(c, 'Nascimento', [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 1 }], { area_id: x.A.id }), 404);
  });

  for (let rodada = 1; rodada <= 3; rodada += 1) {
    test(`K1.${rodada}: morte × transferência da mesma posição; junção × transferência; cancelar × morte → conservação, sem 500, sem deadlock`, async () => {
      const c = await cenario();
      const l = await entrada(c, { qtd: 100 });
      const o = await entrada(c, { nome: 'O', qtd: 30 });
      await ativar(c);
      const p = await pos(c, daEntrada(l, c.A));
      const po = await pos(c, daEntrada(o, c.A));
      const [m, t] = await Promise.all([baixa(c, 'Morte', [{ categoria: BOI, quantidade: 80, causa_morte: 'Doença' }]), transferir(c, [{ posicao_id: p.id, quantidade: 90 }], c.B, '02')]);
      for (const r of [m, t]) assert.ok([201, 409].includes(r.statusCode), r.body);
      const [j, t2] = await Promise.all([juntar(c, p, [po]), transferir(c, [{ posicao_id: po.id, quantidade: 30 }], c.B, '02')]);
      for (const r of [j, t2]) assert.ok([201, 404, 409].includes(r.statusCode), r.body);
      if (m.statusCode === 201) {
        const [canc, m2] = await Promise.all([cancelar(c, m.json().movimentacao.id), baixa(c, 'Abate', [{ categoria: BOI, quantidade: 5 }])]);
        assert.ok([200, 409].includes(canc.statusCode), canc.body);
        assert.ok([201, 409].includes(m2.statusCode), m2.body);
      }
      const v = await verificar(c);
      assert.equal(v.conservacao.entradas + v.conservacao.nascimentos + v.conservacao.saidas, v.conservacao.saldo);
    });
  }
});

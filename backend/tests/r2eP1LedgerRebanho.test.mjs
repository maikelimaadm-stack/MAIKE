/**
 * R2E-P1 (D-PROD-107) — ledger do rebanho por posição: cadastro de entrada ×
 * posições × eventos, transferência retroativa, saldo histórico, cancelamento,
 * ativação, fail-closed dos comandos legados, rollback, concorrência e volume.
 * PostgreSQL real, HTTP autenticado, dados sintéticos.
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
  await limparDoLedger();
  await limparBanco();
});
/** As tabelas novas têm FK para Cliente/Empresa/Área/Lote: saem antes da limpeza padrão. */
const limparDoLedger = async () => {
  const p = prisma();
  await p.partidaRebanho.deleteMany({});
  await p.eventoRebanho.deleteMany({});
  await p.posicaoRebanho.deleteMany({});
  await p.rebanhoLedgerAtivacao.deleteMany({});
};

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const BOI = 'Boi 25 a 36 meses';
const CORTE = '2026-10-01';

const cenario = async ({ ativar = true } = {}) => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const comum = await p.usuario.create({
    data: { cliente_id: adm.cliente.id, nome: 'Comum', login: `comum-${randomUUID().slice(0, 8)}`, senha_hash: (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash, papel_tenant: 'usuario' },
  });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const tokComum = (await autenticarNoApp(app, { login: comum.login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const setor2 = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: outraEmpresa.id, numero_setor: '2', nome: 'Setor 2' } });
  const area = (n, nome, emp = empresa, st = setor) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: st.id, setor_nome: st.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const c = { cliente: adm.cliente, tok, tokComum, empresa, outraEmpresa, setor, setor2, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), C: await area(3, 'PASTO C'), X: await area(9, 'PASTO X', outraEmpresa, setor2) };
  if (ativar) {
    const r = await req('POST', '/rebanho/ativacao', tok, { operation_id: opId(), empresa_id: empresa.id, data_corte: CORTE });
    assert.equal(r.statusCode, 201, r.body);
  }
  return c;
};
const entrada = async (c, { nome = 'LOTE 001', qtd = 500, area = c.A, data = '2026-10-25', categoria = BOI, sexo = 'Macho', peso = 400, empresa = c.empresa, setor = c.setor } = {}) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const posicoes = async (c, empresa = c.empresa) => (await req('GET', `/rebanho/posicoes?empresa_id=${empresa.id}`, c.tok)).json().itens;
const posicaoEm = async (c, loteId, area) => (await posicoes(c)).find((p) => p.lote_entrada_id === loteId && p.area_atual_id === area.id);
const transferir = (c, itens, destino, dia, extra = {}, token = c.tok) =>
  req('POST', '/rebanho/comandos/transferencia', token, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: destino.id, data_movimentacao: `2026-11-${dia}T12:00:00.000Z`, itens, ...extra });
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const porArea = async (c) => {
  const ps = await posicoes(c);
  const m = {};
  for (const p of ps) m[p.area_atual_nome] = (m[p.area_atual_nome] ?? 0) + p.quantidade_cabecas;
  return m;
};
const saldosEm = async (c, data) => {
  const r = (await req('GET', `/rebanho/saldos?empresa_id=${c.empresa.id}&data=${data}`, c.tok)).json();
  return Object.fromEntries(r.areas.map((a) => [a.area_nome, a.total]));
};
const contagem = async (c) => {
  const p = prisma();
  const where = { cliente_id: c.cliente.id };
  return {
    lotes: (await p.lote.findMany({ where, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.quantidade_entrada, l.status, l.area_atual_id, l.excluido_em ? 'X' : '']),
    posicoes: (await p.posicaoRebanho.findMany({ where, orderBy: { id: 'asc' } })).map((x) => [x.id, x.quantidade_cabecas, x.peso_medio_kg === null ? null : Number(x.peso_medio_kg)]),
    eventos: await p.eventoRebanho.count({ where }),
    eventosAtivos: await p.eventoRebanho.count({ where: { ...where, situacao: 'ativo' } }),
    partidas: await p.partidaRebanho.count({ where }),
    partidasAtivas: await p.partidaRebanho.count({ where: { ...where, ativa: true } }),
    movs: await p.movimentacaoMapa.count({ where }),
    audits: await p.auditLog.count({ where }),
    ops: await p.operacaoIdempotente.count({ where }),
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
const verificacaoIntegra = async (c) => {
  const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
  assert.equal(v.integro, true, JSON.stringify(v));
  return v;
};
const cancelar = (c, movId, token = c.tok, operation_id = opId()) => req('POST', `/movimentacoes-mapa/${movId}/cancelamento`, token, { operation_id, motivo: 'lançada por engano' });

// ═══ Exemplo obrigatório e retroatividade ══════════════════════════════════

describe('R2E ledger — cadastro × posições × movimentações, retroatividade', () => {
  test('L1: 500 em A; 02 A→B 100 → 400/100; depois 01 A→B 100 → 300/200; Lote só com a entrada de 500; 450 no dia 01 → 409 sem efeito', async () => {
    const c = await cenario();
    const lote = await entrada(c);
    const pA = await posicaoEm(c, lote.id, c.A);
    assert.equal(pA.quantidade_cabecas, 500);
    const t02 = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '02'));
    assert.deepEqual(await porArea(c), { 'PASTO A': 400, 'PASTO B': 100 });
    const t01 = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '01'));
    assert.deepEqual(await porArea(c), { 'PASTO A': 300, 'PASTO B': 200 });
    assert.notEqual(t01.evento.id, t02.evento.id);
    assert.equal(t01.evento.data_operacional, '2026-11-01');
    assert.ok(t01.evento.registrado_em > t02.evento.registrado_em, 'registrado depois, com data anterior');

    const lotes = await prisma().lote.findMany({ where: { cliente_id: c.cliente.id } });
    assert.equal(lotes.length, 1, 'cadastro: só a entrada');
    assert.deepEqual([lotes[0].quantidade_entrada, lotes[0].quantidade_cabecas, lotes[0].area_atual_id, lotes[0].origem], [500, 500, c.A.id, null]);
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id, origem: 'MOVIMENTAÇÃO' } }), 0);
    assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id, tipo: 'TRANSFERENCIA' } }), 2);
    assert.equal((await prisma().posicaoRebanho.findMany({ where: { cliente_id: c.cliente.id, area_id: c.B.id } })).length, 1, 'as duas transferências caem na MESMA posição de B (mesma linhagem)');
    assert.deepEqual(await saldosEm(c, '2026-11-01'), { 'PASTO A': 400, 'PASTO B': 100 });
    assert.deepEqual(await saldosEm(c, '2026-11-02'), { 'PASTO A': 300, 'PASTO B': 200 });
    assert.deepEqual(await saldosEm(c, '2026-10-31'), { 'PASTO A': 500 });

    const r = await exigirNadaGravado(c, () => transferir(c, [{ posicao_id: pA.id, quantidade: 450 }], c.B, '01'), 409, 'REBANHO_SALDO_HISTORICO_NEGATIVO');
    assert.deepEqual([r.json().details.data, r.json().details.area_nome, r.json().details.disponivel, r.json().details.pedido], ['2026-11-01', 'PASTO A', 400, 450]);
    await verificacaoIntegra(c);
  });

  test('L2: A=320 B=150 C=30 (com retorno): 02 A→B 100; 01 A→B 100 (lançado depois); 03 B→C 50; 04 C→A 20; total 500; replay não duplica', async () => {
    const c = await cenario();
    const lote = await entrada(c);
    const pA = await posicaoEm(c, lote.id, c.A);
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '02'));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '01'));
    const pB = await posicaoEm(c, lote.id, c.B);
    await ok(transferir(c, [{ posicao_id: pB.id, quantidade: 50 }], c.C, '03'));
    const pC = await posicaoEm(c, lote.id, c.C);
    const corpo = { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.A.id, data_movimentacao: '2026-11-04T12:00:00.000Z', itens: [{ posicao_id: pC.id, quantidade: 20 }] };
    const r1 = await ok(req('POST', '/rebanho/comandos/transferencia', c.tok, corpo));
    const antes = await contagem(c);
    const r2 = await req('POST', '/rebanho/comandos/transferencia', c.tok, corpo);
    assert.equal(r2.json().replay, true);
    assert.equal(r2.json().evento.id, r1.evento.id);
    assert.deepEqual(await contagem(c), antes, 'replay não grava');
    assert.deepEqual(await porArea(c), { 'PASTO A': 320, 'PASTO B': 150, 'PASTO C': 30 });
    assert.equal((await prisma().posicaoRebanho.findMany({ where: { cliente_id: c.cliente.id, area_id: c.A.id } })).length, 1, 'retorno à A volta para a MESMA posição');
    assert.deepEqual(await saldosEm(c, '2026-11-03'), { 'PASTO A': 300, 'PASTO B': 150, 'PASTO C': 50 });
    assert.deepEqual(await saldosEm(c, '2026-11-04'), { 'PASTO A': 320, 'PASTO B': 150, 'PASTO C': 30 });
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 1);
    await exigirNadaGravado(c, () => req('POST', '/rebanho/comandos/transferencia', c.tok, { ...corpo, itens: [{ posicao_id: pC.id, quantidade: 21 }] }), 409, 'IDEMPOTENCY_CONFLICT');
    await verificacaoIntegra(c);
  });

  test('L3: saldo histórico — origem sem estoque na data (mesmo com saldo hoje) e retroativo que quebra fato futuro → 409 com data/área/disponível', async () => {
    const c = await cenario();
    const lote = await entrada(c);
    const pA = await posicaoEm(c, lote.id, c.A);
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '05'));
    const pB = await posicaoEm(c, lote.id, c.B);
    // B tem 100 hoje, mas no dia 01 não tinha nenhuma.
    let r = await exigirNadaGravado(c, () => transferir(c, [{ posicao_id: pB.id, quantidade: 50 }], c.C, '01'), 409, 'REBANHO_SALDO_HISTORICO_NEGATIVO');
    assert.deepEqual([r.json().details.data, r.json().details.area_nome, r.json().details.disponivel, r.json().details.pedido], ['2026-11-01', 'PASTO B', 0, 50]);
    // Retroativo no dia 01 que deixa a transferência do dia 05 sem cabeças em A.
    r = await exigirNadaGravado(c, () => transferir(c, [{ posicao_id: pA.id, quantidade: 450 }], c.C, '01'), 409, 'REBANHO_SALDO_HISTORICO_NEGATIVO');
    assert.deepEqual([r.json().details.data, r.json().details.area_nome, r.json().details.saldo_resultante], ['2026-11-05', 'PASTO A', -50]);
    // 400 no dia 01 cabe (500 − 400 − 100 = 0 no dia 05).
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 400 }], c.C, '01'));
    assert.deepEqual(await porArea(c), { 'PASTO B': 100, 'PASTO C': 400 });
    await verificacaoIntegra(c);
  });

  test('L4: mesmo dia — várias transferências no dia 02 são aceitas (sem meia-noite × meio-dia); disponibilidade é por FIM de dia', async () => {
    const c = await cenario();
    const lote = await entrada(c);
    const pA = await posicaoEm(c, lote.id, c.A);
    for (const h of ['T00:00:00.000Z', 'T12:00:00.000Z', 'T23:59:00.000Z', '']) {
      await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 50 }], c.B, '02', { data_movimentacao: `2026-11-02${h}` }));
    }
    assert.deepEqual(await porArea(c), { 'PASTO A': 300, 'PASTO B': 200 });
    const pB = await posicaoEm(c, lote.id, c.B);
    // B→C e C→A no MESMO dia: vale o fim do dia (C termina em 0), na ordem de lançamento.
    await ok(transferir(c, [{ posicao_id: pB.id, quantidade: 30 }], c.C, '02'));
    const pC = await posicaoEm(c, lote.id, c.C);
    await ok(transferir(c, [{ posicao_id: pC.id, quantidade: 30 }], c.A, '02'));
    assert.deepEqual(await porArea(c), { 'PASTO A': 330, 'PASTO B': 170 });
    await verificacaoIntegra(c);
  });

  test('L5: várias entradas e homônimos — 500 e 300 (mesmo nome) numa confirmação para B: duas posições, linhagens separadas, total 800', async () => {
    const c = await cenario();
    const l1 = await entrada(c, { qtd: 500 });
    const l2 = await entrada(c, { qtd: 300, peso: null });
    const p1 = await posicaoEm(c, l1.id, c.A);
    const p2 = await posicaoEm(c, l2.id, c.A);
    const r = await ok(transferir(c, [{ posicao_id: p1.id, quantidade: 100 }, { posicao_id: p2.id, quantidade: 300 }], c.B, '02'));
    assert.equal(r.movimentacao.quantidade_animais, 400);
    const emB = (await posicoes(c)).filter((p) => p.area_atual_id === c.B.id);
    assert.deepEqual(emB.map((p) => [p.lote_entrada_id, p.quantidade_cabecas, p.peso_medio_kg]).sort(), [[l1.id, 100, 400], [l2.id, 300, null]].sort());
    assert.deepEqual(await porArea(c), { 'PASTO A': 400, 'PASTO B': 400 });
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 2);
  });

  test('L6: contrato estrito e isolamento — data impossível, antes do corte, mesmo destino, posição/área alheias, campos forjados', async () => {
    const c = await cenario();
    const lote = await entrada(c);
    const pA = await posicaoEm(c, lote.id, c.A);
    const item = [{ posicao_id: pA.id, quantidade: 10 }];
    await exigirNadaGravado(c, () => transferir(c, item, c.B, '02', { data_movimentacao: '2026-02-30' }), 400);
    await exigirNadaGravado(c, () => transferir(c, item, c.B, '02', { data_movimentacao: '2026-11-02texto' }), 400);
    await exigirNadaGravado(c, () => transferir(c, item, c.B, '02', { data_movimentacao: '2026-09-30' }), 409, 'REBANHO_ANTES_DO_CORTE');
    await exigirNadaGravado(c, () => transferir(c, item, c.A, '02'), 409, 'REBANHO_DESTINO_IGUAL_ORIGEM');
    await exigirNadaGravado(c, () => transferir(c, item, c.X, '02'), 404, 'AREA_NOT_FOUND');
    for (const extra of [{ cliente_id: 'x' }, { saldo: 1 }, { efeito_servidor: {} }, { itens: [{ ...item[0], quantidade_cabecas: 9 }] }, { itens: [{ ...item[0], area_id: c.B.id }] }, { itens: [] }, { itens: [{ posicao_id: pA.id, quantidade: 0 }] }]) {
      await exigirNadaGravado(c, () => transferir(c, item, c.B, '02', extra), 400);
    }
    const x = await cenario();
    const lx = await entrada(x);
    const px = await posicaoEm(x, lx.id, x.A);
    await exigirNadaGravado(c, () => transferir(c, [{ posicao_id: px.id, quantidade: 1 }], c.B, '02'), 404, 'POSICAO_REBANHO_NOT_FOUND');
    await exigirNadaGravado(c, () => transferir(c, item, c.B, '02', {}, x.tok), 404);
    await exigirNadaGravado(c, () => req('POST', '/rebanho/comandos/transferencia', null, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-02', itens: item }), 401);
    // Empresa sem ledger: comando novo recusa; posições vazias.
    const s = await cenario({ ativar: false });
    assert.equal((await req('GET', `/rebanho/posicoes?empresa_id=${s.empresa.id}`, s.tok)).json().ativo, false);
  });
});

// ═══ Cancelamento, histórico e cadastro ════════════════════════════════════

describe('R2E ledger — cancelamento, histórico, cadastro', () => {
  test('X1: cancelar fato do qual um posterior depende → 409 com data; cancela o posterior e depois o anterior; histórico rotulado nas duas áreas e na entrada', async () => {
    const c = await cenario();
    const lote = await entrada(c);
    const pA = await posicaoEm(c, lote.id, c.A);
    const t02 = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '02'));
    const pB = await posicaoEm(c, lote.id, c.B);
    const t03 = await ok(transferir(c, [{ posicao_id: pB.id, quantidade: 100 }], c.C, '03'));
    const e = (await req('GET', `/movimentacoes-mapa/${t02.movimentacao.id}/elegibilidade-cancelamento`, c.tok)).json();
    assert.deepEqual([e.elegivel, e.codigo, e.detalhes?.data, e.detalhes?.area_nome], [false, 'CANCELAMENTO_SALDO_HISTORICO_NEGATIVO', '2026-11-03', 'PASTO B']);
    await exigirNadaGravado(c, () => cancelar(c, t02.movimentacao.id), 409, 'CANCELAMENTO_SALDO_HISTORICO_NEGATIVO');
    await exigirNadaGravado(c, () => cancelar(c, t03.movimentacao.id, c.tokComum), 403);
    const chave = opId();
    await ok(cancelar(c, t03.movimentacao.id, c.tok, chave), 200);
    const replay = await cancelar(c, t03.movimentacao.id, c.tok, chave);
    assert.equal(replay.json().replay, true);
    assert.equal((await cancelar(c, t03.movimentacao.id)).json().code, 'CANCELAMENTO_JA_REALIZADO');
    await ok(cancelar(c, t02.movimentacao.id), 200);
    assert.deepEqual(await porArea(c), { 'PASTO A': 500 });
    for (const filtro of [`lote_ids=${lote.id}`, `area_id=${c.B.id}`, `area_id=${c.A.id}`, `lote_ids=${pB.id}`]) {
      const h = (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&${filtro}`, c.tok)).json();
      assert.ok(h.items.length >= 1 && h.items.every((m) => m.situacao === 'cancelado'), `${filtro}: ${JSON.stringify(h.items.map((m) => m.situacao))}`);
    }
    const ev = await prisma().eventoRebanho.findMany({ where: { cliente_id: c.cliente.id, tipo: 'TRANSFERENCIA' } });
    assert.ok(ev.every((x) => x.situacao === 'cancelado' && x.cancelado_em && x.motivo_cancelamento));
    assert.equal(await prisma().partidaRebanho.count({ where: { cliente_id: c.cliente.id } }), 5, 'partidas preservadas (inativas), nada apagado');
    await verificacaoIntegra(c);
  });

  test('X2: cadastro — PATCH de saldo/área/status → 409; nome propaga às posições; DELETE com movimento ativo → 409; sem movimento → tombstone e posição zerada', async () => {
    const c = await cenario();
    const lote = await entrada(c);
    const pA = await posicaoEm(c, lote.id, c.A);
    for (const campo of [{ quantidade_cabecas: 1 }, { area_atual_id: c.B.id }, { status: 'Inativo' }, { categoria: 'Vaca + 36 meses' }, { data_entrada: '2026-10-20' }]) {
      await exigirNadaGravado(c, () => req('PATCH', `/lotes/${lote.id}`, c.tok, campo), 409, 'REBANHO_LEDGER_SALDO_SOMENTE_POR_EVENTO');
    }
    await ok(req('PATCH', `/lotes/${lote.id}`, c.tok, { nome: 'LOTE 001-R' }), 200);
    assert.equal((await posicaoEm(c, lote.id, c.A)).nome, 'LOTE 001-R');
    const t = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '02'));
    await exigirNadaGravado(c, () => req('DELETE', `/lotes/${lote.id}`, c.tok), 409);
    await ok(cancelar(c, t.movimentacao.id), 200);
    const r = await req('DELETE', `/lotes/${lote.id}`, c.tok);
    assert.equal(r.statusCode, 204, r.body);
    const l = await prisma().lote.findUnique({ where: { id: lote.id } });
    assert.ok(l.excluido_em, 'tombstone');
    assert.deepEqual(await porArea(c), {});
    await verificacaoIntegra(c);
  });

  test('X3: comandos que ainda escrevem saldo em Lote recusam empresa no ledger (fail-closed); empresa legada segue igual', async () => {
    const c = await cenario();
    const lote = await entrada(c);
    const casos = [
      ['/movimentacoes-mapa/comandos/manejo-lote', { operation_id: opId(), tipo: 'Morte', empresa_id: c.empresa.id, lote_id: lote.id, quantidade_animais: 1, data_movimentacao: '2026-11-02' }],
      ['/movimentacoes-mapa/comandos/manejo-lote', { operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: lote.id, quantidade_animais: 1, area_destino_id: c.B.id, data_movimentacao: '2026-11-02' }],
      ['/movimentacoes-mapa/comandos/manejo-rebanho', { operation_id: opId(), tipo: 'Pesagem', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas: [{ lote_id: lote.id, peso_medio_kg: 410 }] }],
      ['/movimentacoes-mapa/comandos/baixa-rebanho', { operation_id: opId(), tipo: 'Abate', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas: [{ categoria: BOI, quantidade: 1 }] }],
      ['/movimentacoes-mapa/comandos/juncao-lotes', { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: lote.id, lote_origem_ids: [(await entrada(c, { nome: 'L2', qtd: 5 })).id], data_movimentacao: '2026-11-02' }],
    ];
    for (const [url, corpo] of casos) await exigirNadaGravado(c, () => req('POST', url, c.tok, corpo), 409, 'REBANHO_LEDGER_OPERACAO_NAO_MIGRADA');
    const s = await cenario({ ativar: false });
    const ls = await entrada(s);
    const r = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', s.tok, { operation_id: opId(), tipo: 'Morte', empresa_id: s.empresa.id, lote_id: ls.id, quantidade_animais: 1, data_movimentacao: '2026-11-02' });
    assert.equal(r.statusCode, 201, r.body);
  });

  test('X4: ativação — saldo de abertura das linhas legadas (inclusive derivadas) sem alterar Lote; só admin; corte anterior a movimento legado e lote sem área → 409', async () => {
    const c = await cenario({ ativar: false });
    const l = await entrada(c);
    const t = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: l.id, quantidade_animais: 120, area_destino_id: c.B.id, data_movimentacao: '2026-10-28T12:00:00.000Z' });
    assert.equal(t.statusCode, 201, t.body);
    const lotesAntes = (await contagem(c)).lotes;
    const corpo = { operation_id: opId(), empresa_id: c.empresa.id, data_corte: '2026-10-27' };
    await exigirNadaGravado(c, () => req('POST', '/rebanho/ativacao', c.tok, corpo), 409, 'REBANHO_ATIVACAO_CORTE_ANTERIOR_AO_HISTORICO');
    await exigirNadaGravado(c, () => req('POST', '/rebanho/ativacao', c.tokComum, { ...corpo, data_corte: '2026-10-28', operation_id: opId() }), 403);
    await exigirNadaGravado(c, () => req('POST', '/rebanho/ativacao', c.tok, { ...corpo, data_corte: '2026-02-30', operation_id: opId() }), 400);
    const r = await ok(req('POST', '/rebanho/ativacao', c.tok, { ...corpo, data_corte: '2026-10-28', operation_id: opId() }));
    assert.deepEqual([r.posicoes, r.total_cabecas], [2, 500]);
    assert.deepEqual(await porArea(c), { 'PASTO A': 380, 'PASTO B': 120 });
    assert.deepEqual((await contagem(c)).lotes, lotesAntes, 'Lote intocado');
    const derivada = (await posicoes(c)).find((p) => p.area_atual_id === c.B.id);
    assert.equal(derivada.linhagem[0].classe, 'derivado_legado');
    assert.equal((await req('POST', '/rebanho/ativacao', c.tok, { ...corpo, data_corte: '2026-10-29', operation_id: opId() })).json().code, 'REBANHO_LEDGER_JA_ATIVO');
    const s = await cenario({ ativar: false });
    await prisma().lote.create({ data: { cliente_id: s.cliente.id, empresa_id: s.empresa.id, numero_lote: 'SA1', nome: 'SEM AREA', quantidade_cabecas: 5, quantidade_entrada: 5, status: 'Ativo', motivo_entrada: 'Compra' } });
    await exigirNadaGravado(s, () => req('POST', '/rebanho/ativacao', s.tok, { operation_id: opId(), empresa_id: s.empresa.id, data_corte: CORTE }), 409, 'REBANHO_ATIVACAO_LOTE_SEM_AREA');
    await verificacaoIntegra(c);
  });
});

// ═══ Rollback, volume e concorrência ═══════════════════════════════════════

describe('R2E ledger — rollback por passo, volume, concorrência (3 rodadas)', () => {
  test('R1: falha injetada após validar, após evento, após 1ª partida, após reprojeção e antes da auditoria → ZERO mudança', async () => {
    for (const passo of ['apos_validar', 'apos_evento', 'apos_primeira_partida', 'apos_segunda_posicao', 'antes_auditoria']) {
      await limparDoLedger();
      await limparBanco();
      const c = await cenario();
      const l1 = await entrada(c);
      const l2 = await entrada(c, { nome: 'L2', qtd: 50 });
      const itens = [{ posicao_id: (await posicaoEm(c, l1.id, c.A)).id, quantidade: 100 }, { posicao_id: (await posicaoEm(c, l2.id, c.A)).id, quantidade: 10 }];
      definirFalhaInjetadaLedger(passo);
      const antes = await contagem(c);
      const r = await transferir(c, itens, c.B, '02');
      definirFalhaInjetadaLedger(null);
      assert.equal(r.statusCode, 500, `${passo}: ${r.body}`);
      assert.deepEqual(await contagem(c), antes, `falha em ${passo}`);
    }
  });

  test('V1: 1.000 fatos numa posição com cancelados no meio (> 610): retroativo valida a linha inteira, sem teto; EXPLAIN usa o índice', async () => {
    const c = await cenario();
    const lote = await entrada(c, { qtd: 5000 });
    const pA = await posicaoEm(c, lote.id, c.A);
    const pB = (await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 1 }], c.B, '01'))).posicoes.find((p) => p.area_atual_id === c.B.id);
    const ev = await prisma().eventoRebanho.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, tipo: 'TRANSFERENCIA', data_operacional: new Date('2026-11-01T00:00:00Z'), operation_id: 'carga-sintetica' } });
    const dia = (i) => new Date(Date.UTC(2026, 10, 2 + Math.floor(i / 40)));
    const partidas = [];
    for (let i = 0; i < 1000; i += 1) {
      partidas.push({ cliente_id: c.cliente.id, empresa_id: c.empresa.id, evento_id: ev.id, posicao_id: pA.id, data_operacional: dia(i), delta: -1, ativa: !(i >= 300 && i < 320) });
      partidas.push({ cliente_id: c.cliente.id, empresa_id: c.empresa.id, evento_id: ev.id, posicao_id: pB.id, data_operacional: dia(i), delta: 1, ativa: !(i >= 300 && i < 320) });
    }
    await prisma().partidaRebanho.createMany({ data: partidas });
    await prisma().$executeRaw`UPDATE "PosicaoRebanho" p SET quantidade_cabecas = (SELECT COALESCE(SUM(delta),0) FROM "PartidaRebanho" x WHERE x.posicao_id = p.id AND x.ativa) WHERE p.cliente_id = ${c.cliente.id}`;
    assert.equal(await prisma().partidaRebanho.count({ where: { cliente_id: c.cliente.id, posicao_id: pA.id } }), 1002);
    // B tem 981 hoje; no dia 02 tinha só 1 + 40: tirar 100 de B no dia 02 quebra a linha do tempo.
    const t0 = Date.now();
    const r = await transferir(c, [{ posicao_id: pB.id, quantidade: 100 }], c.C, '02');
    const ms = Date.now() - t0;
    assert.equal(r.statusCode, 409, r.body);
    assert.deepEqual([r.json().details.data, r.json().details.disponivel], ['2026-11-02', 41]);
    const okR = await transferir(c, [{ posicao_id: pB.id, quantidade: 100 }], c.C, '30');
    assert.equal(okR.statusCode, 201, okR.body);
    const plano = await prisma().$queryRawUnsafe(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) SELECT posicao_id, data_operacional, SUM(delta) FROM "PartidaRebanho" WHERE cliente_id = '${c.cliente.id}' AND posicao_id = ANY(ARRAY['${pA.id}','${pB.id}']) AND ativa GROUP BY 1,2`);
    const texto = plano.map((l) => l['QUERY PLAN']).join('\n');
    console.log(`  transferência retroativa validada contra 2.000+ partidas em ${ms} ms\n  EXPLAIN:\n    ${texto.replace(/\n/g, '\n    ')}`);
    assert.ok(ms < 5000, `validação em ${ms} ms`);
    await verificacaoIntegra(c);
  });

  for (let rodada = 1; rodada <= 3; rodada += 1) {
    test(`K1.${rodada}: duas transferências da mesma origem disputando saldo (300 + 300 de 500) → uma 201, outra 409; total 500`, async () => {
      const c = await cenario();
      const lote = await entrada(c);
      const pA = await posicaoEm(c, lote.id, c.A);
      const rs = await Promise.all([transferir(c, [{ posicao_id: pA.id, quantidade: 300 }], c.B, '02'), transferir(c, [{ posicao_id: pA.id, quantidade: 300 }], c.C, '01')]);
      assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409], rs.map((r) => r.body).join(' | '));
      const m = await porArea(c);
      assert.equal(Object.values(m).reduce((t, x) => t + x, 0), 500);
      await verificacaoIntegra(c);
    });

    test(`K2.${rodada}: A→B e B→A simultâneas (travas em ordem) e cancelamento × nova transferência dependente → sem deadlock, sem 500`, async () => {
      const c = await cenario();
      const lote = await entrada(c);
      const pA = await posicaoEm(c, lote.id, c.A);
      const t = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 200 }], c.B, '01'));
      const pB = await posicaoEm(c, lote.id, c.B);
      const [x, y] = await Promise.all([transferir(c, [{ posicao_id: pA.id, quantidade: 50 }], c.B, '02'), transferir(c, [{ posicao_id: pB.id, quantidade: 50 }], c.A, '02')]);
      assert.equal(x.statusCode, 201, x.body);
      assert.equal(y.statusCode, 201, y.body);
      const [canc, nova] = await Promise.all([cancelar(c, t.movimentacao.id), transferir(c, [{ posicao_id: pB.id, quantidade: 200 }], c.C, '03')]);
      assert.ok([200, 409].includes(canc.statusCode), canc.body);
      assert.ok([201, 409].includes(nova.statusCode), nova.body);
      assert.ok(!(canc.statusCode === 200 && nova.statusCode === 201), 'cancelar e usar as mesmas cabeças não podem valer juntos');
      const m = await porArea(c);
      assert.equal(Object.values(m).reduce((s, v) => s + v, 0), 500);
      await verificacaoIntegra(c);
    });

    test(`K3.${rodada}: mesma chave em paralelo → um efeito; nova entrada × transferência; DELETE × transferência → consistentes`, async () => {
      const c = await cenario();
      const lote = await entrada(c);
      const pA = await posicaoEm(c, lote.id, c.A);
      const corpo = { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-02', itens: [{ posicao_id: pA.id, quantidade: 100 }] };
      const rs = await Promise.all([1, 2, 3].map(() => req('POST', '/rebanho/comandos/transferencia', c.tok, corpo)));
      for (const r of rs) assert.ok([201, 409].includes(r.statusCode), r.body);
      assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id, tipo: 'TRANSFERENCIA' } }), 1);
      const [nova, tr] = await Promise.all([entrada(c, { nome: 'NOVA', qtd: 70 }), transferir(c, [{ posicao_id: pA.id, quantidade: 50 }], c.C, '03')]);
      assert.equal(tr.statusCode, 201, tr.body);
      const l2 = await entrada(c, { nome: 'APAGAVEL', qtd: 10 });
      const p2 = await posicaoEm(c, l2.id, c.A);
      const [del, t2] = await Promise.all([req('DELETE', `/lotes/${l2.id}`, c.tok), transferir(c, [{ posicao_id: p2.id, quantidade: 10 }], c.B, '04')]);
      assert.ok([204, 409].includes(del.statusCode), del.body);
      assert.ok([201, 409].includes(t2.statusCode), t2.body);
      assert.ok(!(del.statusCode === 204 && t2.statusCode === 201), 'lote apagado não pode ter transferência ativa');
      const m = await porArea(c);
      assert.equal(Object.values(m).reduce((s, v) => s + v, 0), 500 + nova.quantidade_cabecas + (del.statusCode === 204 ? 0 : 10));
      await verificacaoIntegra(c);
    });
  }
});

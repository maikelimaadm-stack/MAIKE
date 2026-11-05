/**
 * R1 — correção atômica da ENTRADA ORIGINAL do Cadastro de Lotes.
 * PostgreSQL real descartável, HTTP autenticado, dados sintéticos.
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
before(async () => {
  app = await criarApp();
  await app.ready();
});
after(async () => {
  definirFalhaInjetadaLedger(null);
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  definirFalhaInjetadaLedger(null);
  const p = prisma();
  await p.pesoRebanho.deleteMany({});
  await p.lancamentoTarefa.updateMany({ where: { posicao_id: { not: null } }, data: { posicao_id: null } });
  await p.partidaRebanho.deleteMany({});
  await p.eventoRebanho.deleteMany({});
  await p.posicaoRebanho.deleteMany({});
  await p.rebanhoLedgerAtivacao.deleteMany({});
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const opId = () => `op-${randomUUID()}`;
const BOI = 'Boi 25 a 36 meses';
const VACA = 'Vaca';

const cenario = async ({ ativacao = { modo: 'saldo_abertura', data_corte: '2026-10-01' } } = {}) => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const setorB = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '2', nome: 'Setor 2' } });
  const setorX = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: outraEmpresa.id, numero_setor: '9', nome: 'Setor X' } });
  const area = (n, nome, emp = empresa, st = setor) =>
    p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: emp.id, setor_id: st.id, setor_nome: st.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const cm = await p.categoriaManejo.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, nome: 'ENGORDA' } });
  const c = { cliente: adm.cliente, tok, empresa, outraEmpresa, setor, setorB, cm, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), S2: await area(3, 'PASTO S2', empresa, setorB), X: await area(9, 'PASTO X', outraEmpresa, setorX) };
  c.ativar = async (corpo = ativacao) => {
    const r = await req('POST', '/rebanho/ativacao', tok, { operation_id: opId(), empresa_id: empresa.id, ...corpo });
    assert.equal(r.statusCode, 201, r.body);
  };
  if (ativacao) await c.ativar();
  return c;
};

const novoLote = async (c, { nome = 'LOTE 001', qtd = 100, area = c.A, data = '2026-10-25', categoria = BOI, sexo = 'Macho', peso = 300 } = {}) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

const elegibilidade = async (c, lote, token = c.tok) => (await req('GET', `/lotes/${lote.id}/elegibilidade-correcao-entrada`, token)).json();
const corrigir = async (c, lote, campos, { motivo = 'digitação errada', updated = null, operation_id = opId(), token = c.tok } = {}) => {
  const atual = updated ?? (await req('GET', `/lotes/${lote.id}`, c.tok)).json().updated_date;
  return req('POST', `/lotes/${lote.id}/correcao-entrada`, token, { operation_id, motivo, estado_esperado: { updated_date: atual }, campos });
};

/** Retrato do fato em todas as superfícies. */
const fato = async (c, loteId) => {
  const p = prisma();
  const lote = await p.lote.findUnique({ where: { id: loteId } });
  const posicoes = await p.posicaoRebanho.findMany({ where: { cliente_id: c.cliente.id, lote_entrada_id: loteId } });
  const partidas = await p.partidaRebanho.findMany({ where: { cliente_id: c.cliente.id, posicao_id: { in: posicoes.map((x) => x.id) } } });
  const eventos = await p.eventoRebanho.findMany({ where: { cliente_id: c.cliente.id, id: { in: partidas.map((x) => x.evento_id) } } });
  const pesos = await p.pesoRebanho.findMany({ where: { cliente_id: c.cliente.id, posicao_id: { in: posicoes.map((x) => x.id) } } });
  return { lote, posicoes, partidas, eventos, pesos };
};
const contagem = async (c) => {
  const p = prisma();
  const where = { cliente_id: c.cliente.id };
  return JSON.stringify({
    lotes: (await p.lote.findMany({ where, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.quantidade_entrada, String(l.peso_entrada_kg), l.data_entrada?.toISOString(), l.area_entrada_id, l.categoria, l.sexo, l.updatedAt.toISOString()]),
    posicoes: (await p.posicaoRebanho.findMany({ where, orderBy: { id: 'asc' } })).map((x) => [x.id, x.area_id, x.quantidade_cabecas, String(x.peso_medio_kg), x.chave_identidade]),
    partidas: (await p.partidaRebanho.findMany({ where, orderBy: { id: 'asc' } })).map((x) => [x.id, x.delta, x.data_operacional.toISOString(), x.ativa]),
    pesos: (await p.pesoRebanho.findMany({ where, orderBy: { id: 'asc' } })).map((x) => [x.id, String(x.peso_medio_kg), x.ativa]),
    eventos: (await p.eventoRebanho.findMany({ where, orderBy: { id: 'asc' } })).map((x) => [x.id, x.data_operacional.toISOString(), x.situacao]),
    audits: await p.auditLog.count({ where }),
    ops: await p.operacaoIdempotente.count({ where: { ...where, status: 'committed' } }),
  });
};
const nadaGravado = async (c, acao, status, codigo) => {
  const antes = await contagem(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.equal(await contagem(c), antes, 'nada gravado');
  return r;
};

describe('R1 — PATCH genérico continua sem reescrever a entrada no ledger (contrato preservado)', () => {
  test('PATCH de quantidade/data/área numa empresa no ledger → 409 REBANHO_LEDGER_SALDO_SOMENTE_POR_EVENTO', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    await nadaGravado(c, () => req('PATCH', `/lotes/${lote.id}`, c.tok, { quantidade_cabecas: 120, estado_esperado: { quantidade_cabecas: 100 } }), 409, 'REBANHO_LEDGER_SALDO_SOMENTE_POR_EVENTO');
    await nadaGravado(c, () => req('PATCH', `/lotes/${lote.id}`, c.tok, { data_entrada: '2026-10-20' }), 409, 'REBANHO_LEDGER_SALDO_SOMENTE_POR_EVENTO');
  });
});

describe('R1 — correção elegível: o MESMO fato em todas as superfícies', () => {
  test('(a) quantidade 100 → 120: lote, evento, partida e posição com 120; sem segunda entrada; ids preservados', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const antes = await fato(c, lote.id);
    const e = await elegibilidade(c, lote);
    assert.equal(e.elegivel, true, JSON.stringify(e));
    const r = await corrigir(c, lote, { quantidade: 120 });
    assert.equal(r.statusCode, 200, r.body);
    const depois = await fato(c, lote.id);
    assert.equal(depois.lote.quantidade_entrada, 120);
    assert.equal(depois.lote.quantidade_cabecas, 120);
    assert.equal(depois.posicoes.length, 1);
    assert.equal(depois.posicoes[0].id, antes.posicoes[0].id);
    assert.equal(depois.posicoes[0].quantidade_cabecas, 120);
    assert.deepEqual(depois.partidas.map((x) => [x.id, x.delta, x.ativa]), [[antes.partidas[0].id, 120, true]]);
    assert.equal(depois.eventos.length, 1);
    assert.equal(depois.eventos[0].id, antes.eventos[0].id);
    assert.equal(depois.eventos[0].dados.quantidade, 120);
    assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id, tipo: 'ENTRADA' } }), 1);
    const audit = await prisma().auditLog.findFirst({ where: { cliente_id: c.cliente.id, entidade: 'Lote', entidade_id: lote.id, acao: 'correcao_entrada' } });
    assert.equal(audit.dados_anteriores.quantidade_entrada, 100);
    assert.equal(audit.dados_novos.quantidade_entrada, 120);
    assert.equal(audit.dados_novos.motivo_correcao, 'digitação errada');
    assert.ok(audit.usuario_id);
    assert.ok(await prisma().auditLog.findFirst({ where: { cliente_id: c.cliente.id, entidade: 'EventoRebanho', entidade_id: antes.eventos[0].id, acao: 'correcao_entrada' } }));
    // Saldo pelo endpoint do rebanho
    const ps = (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}`, c.tok)).json().itens;
    assert.equal(ps.find((x) => x.lote_entrada_id === lote.id).quantidade_cabecas, 120);
  });

  test('(b) peso 300 → 310 (mesmo registro de peso) e depois peso removido (null) sem apagar a série', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const antes = await fato(c, lote.id);
    assert.equal((await corrigir(c, lote, { peso_entrada_kg: 310 })).statusCode, 200);
    let d = await fato(c, lote.id);
    assert.equal(Number(d.lote.peso_entrada_kg), 310);
    assert.equal(Number(d.lote.peso_medio_kg), 310);
    assert.equal(Number(d.posicoes[0].peso_medio_kg), 310);
    assert.deepEqual(d.pesos.map((w) => [w.id, Number(w.peso_medio_kg), w.ativa]), [[antes.pesos[0].id, 310, true]]);
    assert.equal((await corrigir(c, lote, { peso_entrada_kg: null })).statusCode, 200);
    d = await fato(c, lote.id);
    assert.equal(d.lote.peso_entrada_kg, null);
    assert.equal(d.posicoes[0].peso_medio_kg, null);
    assert.deepEqual(d.pesos.map((w) => [w.id, w.ativa]), [[antes.pesos[0].id, false]]);
  });

  test('(c) data retroativa válida corrige evento/partida/peso/lote; futura (fuso da fazenda) e antes do corte → recusa sem gravar', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    assert.equal((await corrigir(c, lote, { data_entrada: '2026-10-05' })).statusCode, 200);
    const d = await fato(c, lote.id);
    for (const x of [d.lote.data_entrada, d.eventos[0].data_operacional, d.partidas[0].data_operacional, d.pesos[0].data_operacional]) {
      assert.equal(x.toISOString().slice(0, 10), '2026-10-05');
    }
    await nadaGravado(c, () => corrigir(c, lote, { data_entrada: '2027-07-01' }), 409, 'REBANHO_DATA_FUTURA');
    await nadaGravado(c, () => corrigir(c, lote, { data_entrada: '2026-09-15' }), 409, 'REBANHO_ANTES_DO_CORTE');
    await nadaGravado(c, () => corrigir(c, lote, { data_entrada: '2026-02-30' }), 400);
  });

  test('(d) área/setor de entrada: posição muda de área sem gerar transferência; área de outra empresa ou fora do setor → recusa', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const movsAntes = await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } });
    assert.equal((await corrigir(c, lote, { area_entrada_id: c.B.id })).statusCode, 200);
    const d = await fato(c, lote.id);
    assert.equal(d.lote.area_entrada_id, c.B.id);
    assert.equal(d.lote.area_atual_id, c.B.id);
    assert.equal(d.lote.area_entrada_nome, 'PASTO B');
    assert.equal(d.posicoes[0].area_id, c.B.id);
    assert.equal(d.eventos[0].dados.area_id, c.B.id);
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }), movsAntes, 'sem transferência');
    assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id, tipo: 'TRANSFERENCIA' } }), 0);
    await nadaGravado(c, () => corrigir(c, lote, { area_entrada_id: c.X.id }), 404, 'AREA_NOT_FOUND');
    await nadaGravado(c, () => corrigir(c, lote, { area_entrada_id: c.S2.id }), 400);
    assert.equal((await corrigir(c, lote, { setor_id: c.setorB.id, area_entrada_id: c.S2.id })).statusCode, 200);
    const d2 = await fato(c, lote.id);
    assert.equal(d2.lote.setor_id, c.setorB.id);
    assert.equal(d2.lote.setor_nome, 'Setor 2');
    assert.equal(d2.posicoes[0].area_id, c.S2.id);
  });

  test('(e) categoria/sexo/categoria de manejo: identidade da posição recalculada, peso e quantidade intactos', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const r = await corrigir(c, lote, { categoria: VACA, sexo: 'Fêmea', categoria_manejo_id: c.cm.id });
    assert.equal(r.statusCode, 200, r.body);
    const d = await fato(c, lote.id);
    assert.equal(d.lote.categoria, VACA);
    assert.equal(d.lote.categoria_entrada, VACA);
    assert.equal(d.lote.sexo, 'Fêmea');
    assert.equal(d.lote.categoria_manejo_nome, 'ENGORDA', 'nome vem do banco, não do corpo');
    assert.equal(d.lote.categoria_manejo_entrada_id, c.cm.id);
    assert.equal(d.posicoes[0].categoria, VACA);
    assert.equal(d.posicoes[0].sexo, 'Fêmea');
    assert.equal(d.posicoes[0].categoria_manejo_id, c.cm.id);
    assert.deepEqual(JSON.parse(d.posicoes[0].chave_identidade), [lote.id, 'VACA', 'FEMEA', c.cm.id]);
    assert.equal(d.posicoes[0].quantidade_cabecas, 100);
    assert.equal(Number(d.posicoes[0].peso_medio_kg), 300);
    // Categoria de manejo de outra empresa → recusa
    const cmX = await prisma().categoriaManejo.create({ data: { cliente_id: c.cliente.id, empresa_id: c.outraEmpresa.id, nome: 'OUTRA' } });
    await nadaGravado(c, () => corrigir(c, lote, { categoria_manejo_id: cmX.id }), 400);
  });

  test('(f) metadados (PATCH de nome/raça) seguem pelo PATCH e não tiram a elegibilidade', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const p = await req('PATCH', `/lotes/${lote.id}`, c.tok, { nome: 'LOTE RENOMEADO', raca_predominante: 'Nelore' });
    assert.equal(p.statusCode, 200, p.body);
    assert.equal((await elegibilidade(c, lote)).elegivel, true);
    assert.equal((await corrigir(c, lote, { quantidade: 90 })).statusCode, 200);
    assert.equal((await elegibilidade(c, lote)).elegivel, true, 'correção anterior não bloqueia nova correção');
  });
});

describe('R1 — dependências bloqueiam (checadas no banco), nada gravado', () => {
  const transferir = (c, posicaoId, qtd, destino, dia = '01') =>
    req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: destino.id, data_movimentacao: `2026-11-${dia}T12:00:00.000Z`, itens: [{ posicao_id: posicaoId, quantidade: qtd }] });

  test('(g) evento posterior ativo (transferência parcial) → bloqueado', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const [pos] = (await fato(c, lote.id)).posicoes;
    assert.equal((await transferir(c, pos.id, 10, c.B)).statusCode, 201);
    const e = await elegibilidade(c, lote);
    assert.equal(e.elegivel, false);
    assert.equal(e.motivo, 'movimentacao_ativa');
    await nadaGravado(c, () => corrigir(c, lote, { quantidade: 120 }), 409, 'LOTE_CORRECAO_ENTRADA_BLOQUEADA');
  });

  test('(h) movimento cancelado e ida-e-volta (saldo igual ao da entrada) → bloqueado', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const [pos] = (await fato(c, lote.id)).posicoes;
    const t = (await transferir(c, pos.id, 10, c.B)).json();
    const canc = await req('POST', `/movimentacoes-mapa/${t.movimentacao.id}/cancelamento`, c.tok, { operation_id: opId(), motivo: 'engano' });
    assert.equal(canc.statusCode, 200, canc.body);
    const e = await elegibilidade(c, lote);
    assert.equal(e.elegivel, false);
    assert.equal(e.motivo, 'movimentacao_cancelada');
    await nadaGravado(c, () => corrigir(c, lote, { quantidade: 120 }), 409, 'LOTE_CORRECAO_ENTRADA_BLOQUEADA');

    const c2 = await cenario();
    const l2 = await novoLote(c2);
    const [p2] = (await fato(c2, l2.id)).posicoes;
    assert.equal((await transferir(c2, p2.id, 100, c2.B, '01')).statusCode, 201);
    const emB = (await prisma().posicaoRebanho.findMany({ where: { cliente_id: c2.cliente.id, area_id: c2.B.id } }))[0];
    assert.equal((await transferir(c2, emB.id, 100, c2.A, '02')).statusCode, 201);
    assert.equal((await prisma().lote.findUnique({ where: { id: l2.id } })).quantidade_cabecas, 100, 'saldo igual ao da entrada');
    const e2 = await elegibilidade(c2, l2);
    assert.equal(e2.elegivel, false);
    await nadaGravado(c2, () => corrigir(c2, l2, { quantidade: 120 }), 409, 'LOTE_CORRECAO_ENTRADA_BLOQUEADA');
  });

  test('(i) registro de outro módulo (suplementação) → bloqueado', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    await prisma().suplementacaoLote.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: lote.id, produto: 'Sal' } } });
    const e = await elegibilidade(c, lote);
    assert.deepEqual([e.elegivel, e.motivo], [false, 'suplementacao_lote']);
    await nadaGravado(c, () => corrigir(c, lote, { quantidade: 120 }), 409, 'LOTE_CORRECAO_ENTRADA_BLOQUEADA');
  });

  test('(j) outro tenant: 404 sem revelar existência; nada gravado em nenhum dos dois', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const outro = await cenario();
    assert.equal((await req('GET', `/lotes/${lote.id}/elegibilidade-correcao-entrada`, outro.tok)).statusCode, 404);
    const updated = (await req('GET', `/lotes/${lote.id}`, c.tok)).json().updated_date;
    await nadaGravado(c, () => corrigir(c, lote, { quantidade: 1 }, { token: outro.tok, updated }), 404, 'LOTE_NOT_FOUND');
  });

  test('corpo não aceita tenant, saldo calculado nem campo fora do contrato', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const updated = (await req('GET', `/lotes/${lote.id}`, c.tok)).json().updated_date;
    for (const corpo of [
      { operation_id: opId(), motivo: 'x', estado_esperado: { updated_date: updated }, campos: { quantidade_cabecas: 5 } },
      { operation_id: opId(), motivo: 'x', estado_esperado: { updated_date: updated }, campos: { quantidade: 5 }, cliente_id: 'zzz' },
      { operation_id: opId(), motivo: '   ', estado_esperado: { updated_date: updated }, campos: { quantidade: 5 } },
      { operation_id: opId(), motivo: 'x', campos: { quantidade: 5 } },
    ]) {
      await nadaGravado(c, () => req('POST', `/lotes/${lote.id}/correcao-entrada`, c.tok, corpo), 400);
    }
  });
});

describe('R1 — concorrência, rollback, idempotência', () => {
  test('(k) leitura obsoleta (compare-and-swap) e duas correções simultâneas: só uma vence', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const updated = (await req('GET', `/lotes/${lote.id}`, c.tok)).json().updated_date;
    const [r1, r2] = await Promise.all([corrigir(c, lote, { quantidade: 110 }, { updated }), corrigir(c, lote, { quantidade: 130 }, { updated })]);
    const st = [r1.statusCode, r2.statusCode].sort();
    assert.deepEqual(st, [200, 409], `${r1.body} | ${r2.body}`);
    assert.equal([r1, r2].find((r) => r.statusCode === 409).json().code, 'LOTE_ESTADO_CONFLITO');
    const vencedor = [r1, r2].find((r) => r.statusCode === 200).json().lote.quantidade_entrada;
    const d = await fato(c, lote.id);
    assert.equal(d.partidas[0].delta, vencedor);
    assert.equal(d.posicoes[0].quantidade_cabecas, vencedor);
    await nadaGravado(c, () => corrigir(c, lote, { quantidade: 140 }, { updated }), 409, 'LOTE_ESTADO_CONFLITO');
  });

  test('(l) falha injetada no meio (após partida / após projeção) → rollback integral', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    for (const passo of ['correcao_entrada:apos_partida', 'correcao_entrada:apos_projecao']) {
      definirFalhaInjetadaLedger(passo);
      await nadaGravado(c, () => corrigir(c, lote, { quantidade: 150, peso_entrada_kg: 320, area_entrada_id: c.B.id }), 500);
    }
    definirFalhaInjetadaLedger(null);
    assert.equal((await corrigir(c, lote, { quantidade: 150 })).statusCode, 200);
  });

  test('(m) retentativa com a mesma operation_id: replay sem duplicar; payload diferente → IDEMPOTENCY_CONFLICT', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    const updated = (await req('GET', `/lotes/${lote.id}`, c.tok)).json().updated_date;
    const operation_id = opId();
    const r1 = await corrigir(c, lote, { quantidade: 120 }, { updated, operation_id });
    assert.equal(r1.statusCode, 200, r1.body);
    const antes = await contagem(c);
    const r2 = await corrigir(c, lote, { quantidade: 120 }, { updated, operation_id });
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.json().replay, true);
    assert.equal(await contagem(c), antes, 'replay não grava');
    await nadaGravado(c, () => corrigir(c, lote, { quantidade: 999 }, { updated, operation_id }), 409, 'IDEMPOTENCY_CONFLICT');
  });
});

describe('R1 — modos de ativação e efeitos colaterais', () => {
  test('(n) entrada vinda da ativação (modo entradas = evento agregado; saldo_abertura = abertura) → recusa explícita', async () => {
    for (const modo of [{ modo: 'entradas' }, { modo: 'saldo_abertura', data_corte: '2026-10-30' }]) {
      const c = await cenario({ ativacao: null });
      const l1 = await novoLote(c, { nome: 'L1' });
      const l2 = await novoLote(c, { nome: 'L2', area: c.B });
      await c.ativar(modo);
      for (const l of [l1, l2]) {
        const e = await elegibilidade(c, l);
        assert.deepEqual([e.elegivel, e.motivo], [false, 'entrada_por_ativacao_agregada'], `${modo.modo}: ${JSON.stringify(e)}`);
        await nadaGravado(c, () => corrigir(c, l, { quantidade: 120 }), 409, 'LOTE_CORRECAO_ENTRADA_BLOQUEADA');
      }
      // Lote cadastrado DEPOIS da ativação tem ENTRADA própria → corrigível.
      const l3 = await novoLote(c, { nome: 'L3', data: '2026-11-02' });
      assert.equal((await corrigir(c, l3, { quantidade: 80 })).statusCode, 200, modo.modo);
    }
  });

  test('(o) dois lotes: corrigir um não toca o outro', async () => {
    const c = await cenario();
    const l1 = await novoLote(c, { nome: 'L1' });
    const l2 = await novoLote(c, { nome: 'L2', qtd: 50, peso: 250 });
    const antes2 = await fato(c, l2.id);
    assert.equal((await corrigir(c, l1, { quantidade: 120, peso_entrada_kg: 330, area_entrada_id: c.B.id, data_entrada: '2026-10-10' })).statusCode, 200);
    const depois2 = await fato(c, l2.id);
    assert.deepEqual(
      JSON.stringify([depois2.lote, depois2.posicoes, depois2.partidas, depois2.eventos, depois2.pesos]),
      JSON.stringify([antes2.lote, antes2.posicoes, antes2.partidas, antes2.eventos, antes2.pesos])
    );
  });

  test('empresa fora do ledger (modelo legado): corrige só o cadastro da entrada', async () => {
    const c = await cenario({ ativacao: null });
    const lote = await novoLote(c);
    const r = await corrigir(c, lote, { quantidade: 120, peso_entrada_kg: 310, data_entrada: '2026-10-20' });
    assert.equal(r.statusCode, 200, r.body);
    const l = await prisma().lote.findUnique({ where: { id: lote.id } });
    assert.deepEqual([l.quantidade_entrada, l.quantidade_cabecas, Number(l.peso_entrada_kg), l.data_entrada.toISOString().slice(0, 10)], [120, 120, 310, '2026-10-20']);
    assert.equal(await prisma().eventoRebanho.count({ where: { cliente_id: c.cliente.id } }), 0);
  });

  test('exclusão continua possível depois de uma correção (auditoria de correção é explicada)', async () => {
    const c = await cenario();
    const lote = await novoLote(c);
    assert.equal((await corrigir(c, lote, { quantidade: 120 })).statusCode, 200);
    const el = (await req('GET', `/lotes/${lote.id}/elegibilidade-exclusao`, c.tok)).json();
    assert.notEqual(el.tipo, 'bloqueado', JSON.stringify(el));
  });
});

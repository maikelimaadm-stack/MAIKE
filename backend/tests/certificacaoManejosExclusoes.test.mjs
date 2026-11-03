/**
 * D-PROD-113 — certificação transversal: todos os manejos do ledger em
 * CADEIAS (2–5 fatos), exclusão em ordem causal, desbloqueio após excluir o
 * dependente, independência por posição, retroativo/mesmo dia, conservação de
 * cabeças, GET sem escrita e projeção exata restaurada.
 *
 * Só PostgreSQL LOCAL isolado (o `before` recusa qualquer alvo que não seja
 * localhost). Dados 100% sintéticos.
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
  // Prova do alvo ANTES de qualquer escrita: só banco local.
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'suite só roda contra PostgreSQL local');
  // O IP que o servidor vê pode ser o da rede Docker (CI): a prova é a URL local + banco sem
  // as roles que todo projeto Supabase tem.
  const [{ db, supabase }] = await prisma().$queryRaw`SELECT current_database() AS db, EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('supabase_admin', 'supabase_auth_admin')) AS supabase`;
  assert.equal(supabase, false, 'alvo não pode ser um banco Supabase');
  assert.ok(!/prod|supabase/i.test(db), `banco de teste (${db})`);
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
const BOI = 'Boi 25 a 36 meses';
const GARROTE = 'Garrote 13 a 24 meses';
const VACA = 'Vaca + 36 meses';

const base = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, tok, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), C: await area(3, 'PASTO C') };
};
const entrada = async (c, { nome, qtd, area = c.A, categoria = BOI, sexo = 'Macho', peso = 400, data = '2026-10-01' }) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: data, motivo_entrada: 'Compra', status: 'Ativo', ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const ativar = async (c) => {
  const r = await req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' });
  assert.equal(r.statusCode, 201, r.body);
};
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const posDe = (c, lote, area) => prisma().posicaoRebanho.findFirst({ where: { cliente_id: c.cliente.id, lote_entrada_id: lote.id, area_id: area.id } });
const posQuery = (c, where) => prisma().posicaoRebanho.findFirst({ where: { cliente_id: c.cliente.id, ...where } });

// ── comandos reais do backend ───────────────────────────────────────────────
const manejoLote = (c, corpo) => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, ...corpo });
const transferir = (c, pos, q, destino, dia) => manejoLote(c, { tipo: 'Transferência de Área', lote_id: pos.id, quantidade_animais: q, area_destino_id: destino.id, data_movimentacao: `2026-10-${dia}` });
const morteLote = (c, pos, q, dia) => manejoLote(c, { tipo: 'Morte', lote_id: pos.id, quantidade_animais: q, data_movimentacao: `2026-10-${dia}` });
const abateLote = (c, pos, q, dia) => manejoLote(c, { tipo: 'Abate', lote_id: pos.id, quantidade_animais: q, data_movimentacao: `2026-10-${dia}` });
const rebanho = (c, tipo, area, dia, linhas) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: area.id, data_movimentacao: `2026-10-${dia}`, linhas });
const baixa = (c, tipo, area, dia, linhas) =>
  req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: area.id, data_movimentacao: `2026-10-${dia}`, linhas });
const juntar = (c, area, principal, origens, dia) =>
  req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: area.id, lote_principal_id: principal.id, lote_origem_ids: origens.map((o) => o.id), data_movimentacao: `2026-10-${dia}` });
const transferenciaLedger = (c, itens, destino, dia) =>
  req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: destino.id, data_movimentacao: `2026-10-${dia}`, itens });

const elegibilidade = async (c, id) => (await req('GET', `/movimentacoes-mapa/${id}/elegibilidade-exclusao`, c.tok)).json();
const excluir = (c, id) => req('POST', `/movimentacoes-mapa/${id}/exclusao`, c.tok, { operation_id: opId(), motivo: 'certificação D-PROD-113' });

// ── fotografias e invariantes ───────────────────────────────────────────────
const projecao = async (c) => (await prisma().posicaoRebanho.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } }))
  .map((x) => [x.id, x.area_id, x.categoria, x.quantidade_cabecas, x.peso_medio_kg === null ? null : Number(x.peso_medio_kg), JSON.stringify(x.linhagem)]);
const lotes = async (c) => (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } }))
  .map((l) => [l.id, l.quantidade_cabecas, l.quantidade_entrada, l.status, l.area_atual_id, l.categoria, l.peso_medio_kg === null ? null : Number(l.peso_medio_kg)]);
const foto = async (c) => {
  const w = { cliente_id: c.cliente.id };
  const p = prisma();
  return {
    lotes: await lotes(c),
    posicoes: await projecao(c),
    eventos: (await p.eventoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((e) => [e.id, e.situacao]),
    partidas: (await p.partidaRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.ativa, x.delta]),
    pesos: (await p.pesoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.ativa]),
    movs: (await p.movimentacaoMapa.findMany({ where: w, orderBy: { id: 'asc' } })).map((m) => [m.id, m.dados.situacao ?? null]),
    ops: (await p.operacaoIdempotente.findMany({ where: w, orderBy: { id: 'asc' } })).map((o) => [o.id, o.status]),
    audits: await p.auditLog.count({ where: w }),
  };
};
/** GET de elegibilidade não grava NADA (eventos, partidas, pesos, posições, recibos, auditoria). */
const elegibilidadeSemEscrita = async (c, id) => {
  const antes = await foto(c);
  const e = await elegibilidade(c, id);
  assert.deepEqual(await foto(c), antes, `GET elegibilidade de ${id} não pode gravar`);
  return e;
};
const verificar = async (c) => {
  const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
  assert.equal(v.integro, true, JSON.stringify(v));
};
/**
 * Conservação: Σ cabeças atuais = Σ quantidade_entrada do cadastro + nascimentos − mortes − abates;
 * transferência, pesagem, junção e mudança de categoria somam zero por evento. Nenhum órfão.
 */
const conservacao = async (c) => {
  const p = prisma();
  const w = { cliente_id: c.cliente.id };
  const eventos = await p.eventoRebanho.findMany({ where: { ...w, situacao: 'ativo' }, include: { partidas: true } });
  const soma = (tipo) => eventos.filter((e) => e.tipo === tipo).flatMap((e) => e.partidas.filter((x) => x.ativa)).reduce((t, x) => t + x.delta, 0);
  for (const e of eventos.filter((x) => ['TRANSFERENCIA', 'PESAGEM', 'JUNCAO', 'MUDANCA_CATEGORIA'].includes(x.tipo))) {
    assert.equal(e.partidas.filter((x) => x.ativa).reduce((t, x) => t + x.delta, 0), 0, `${e.tipo} ${e.id} não cria nem destrói cabeças`);
  }
  const entradas = (await p.lote.findMany({ where: { ...w, empresa_id: c.empresa.id, excluido_em: null } })).reduce((t, l) => t + l.quantidade_entrada, 0);
  const atuais = (await p.posicaoRebanho.findMany({ where: { ...w, empresa_id: c.empresa.id } })).reduce((t, x) => t + x.quantidade_cabecas, 0);
  assert.equal(soma('ENTRADA'), entradas, 'ENTRADA do ledger = cadastro');
  assert.equal(atuais, entradas + soma('NASCIMENTO') + soma('MORTE') + soma('ABATE'), 'conservação de cabeças');
  // Nenhum órfão: partida/peso sem evento, evento sem movimento (exceto entradas), movimento do ledger sem evento.
  const [o] = await p.$queryRaw`
    SELECT (SELECT count(*) FROM "PartidaRebanho" x WHERE x.cliente_id = ${c.cliente.id} AND NOT EXISTS (SELECT 1 FROM "EventoRebanho" e WHERE e.id = x.evento_id))::int AS partidas,
           (SELECT count(*) FROM "PesoRebanho" x WHERE x.cliente_id = ${c.cliente.id} AND NOT EXISTS (SELECT 1 FROM "EventoRebanho" e WHERE e.id = x.evento_id))::int AS pesos,
           (SELECT count(*) FROM "EventoRebanho" e WHERE e.cliente_id = ${c.cliente.id} AND e.movimentacao_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "MovimentacaoMapa" m WHERE m.id = e.movimentacao_id))::int AS eventos,
           (SELECT count(*) FROM "MovimentacaoMapa" m WHERE m.cliente_id = ${c.cliente.id} AND m.dados->'efeito_servidor'->>'comando' = 'rebanho_ledger'
               AND NOT EXISTS (SELECT 1 FROM "EventoRebanho" e WHERE e.id = m.dados->'efeito_servidor'->>'evento_id'))::int AS movs`;
  assert.deepEqual(o, { partidas: 0, pesos: 0, eventos: 0, movs: 0 }, 'nenhuma referência órfã');
  await verificar(c);
};
/** Exclui com GET prévio sem escrita, confere apagamento físico + recibo original marcado + histórico. */
const excluirCertificado = async (c, mov) => {
  const ev = await prisma().eventoRebanho.findFirst({ where: { cliente_id: c.cliente.id, movimentacao_id: mov.id } });
  const e = await elegibilidadeSemEscrita(c, mov.id);
  assert.equal(e.elegivel, true, `esperado elegível: ${JSON.stringify(e)}`);
  const r = await ok(excluir(c, mov.id), 200);
  assert.equal(r.excluida, true);
  const p = prisma();
  assert.equal(await p.movimentacaoMapa.count({ where: { id: mov.id } }), 0);
  assert.equal(await p.eventoRebanho.count({ where: { id: ev.id } }), 0);
  assert.equal(await p.partidaRebanho.count({ where: { evento_id: ev.id } }), 0);
  assert.equal(await p.pesoRebanho.count({ where: { evento_id: ev.id } }), 0);
  const recibos = await p.operacaoIdempotente.findMany({ where: { cliente_id: c.cliente.id, operation_key: ev.operation_id } });
  assert.equal(recibos.filter((x) => x.status === 'excluido').length, 1, 'exatamente o recibo original marcado');
  await conservacao(c);
  return r;
};
/** Bloqueio com código esperado: GET recusa (sem escrita) e POST 409 sem nenhuma mutação. */
const exigirBloqueio = async (c, mov, codigos) => {
  const e = await elegibilidadeSemEscrita(c, mov.id);
  assert.equal(e.elegivel, false, `esperado bloqueado: ${JSON.stringify(e)}`);
  assert.ok(codigos.includes(e.codigo), `código ${e.codigo} ∉ ${codigos}`);
  const antes = await foto(c);
  const r = await excluir(c, mov.id);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, e.codigo, 'GET e POST concordam no código');
  assert.deepEqual(await foto(c), antes, '409 sem mutação (inclusive recibos e auditoria)');
  return e;
};
const SALDO = ['CANCELAMENTO_SALDO_HISTORICO_NEGATIVO'];
const DEP = ['CANCELAMENTO_SALDO_HISTORICO_NEGATIVO', 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO', 'REBANHO_PESO_DEPENDENCIA_CAUSAL'];

// ═══ Cadeias ════════════════════════════════════════════════════════════════

describe('CERT-1 — entrada → transferência → pesagem → mudança de categoria → morte', () => {
  test('cada nó do meio bloqueia; exclusão na ordem causal inversa libera o antecessor; projeção final = só a entrada', async () => {
    const c = await base();
    const g = await entrada(c, { nome: 'GAR', qtd: 40, categoria: GARROTE, peso: 300 });
    await ativar(c);
    const posA = await posDe(c, g, c.A);
    const inicial = await foto(c);
    const t = (await ok(transferir(c, posA, 20, c.B, '10'))).movimentacao;
    const pes = (await ok(rebanho(c, 'Pesagem', c.B, '12', [{ lote_id: (await posDe(c, g, c.B)).id, peso_medio_kg: 330 }]))).movimentacao;
    const mc = (await ok(rebanho(c, 'Mudança de Categoria', c.B, '14', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 10 }]))).movimentacao;
    const boiB = await posQuery(c, { area_id: c.B.id, categoria: BOI });
    assert.equal(boiB.quantidade_cabecas, 10);
    const m = (await ok(morteLote(c, boiB, 4, '16'))).movimentacao;
    assert.deepEqual(await lotes(c), inicial.lotes, 'Cadastro de Lotes nunca muda por manejo');
    await conservacao(c);

    // Nós do meio e o mais antigo: bloqueados (com a causa certa).
    await exigirBloqueio(c, t, DEP);
    await exigirBloqueio(c, pes, DEP);
    await exigirBloqueio(c, mc, SALDO);
    // Mais recente: livre. Depois cada antecessor só libera quando o dependente sai.
    await excluirCertificado(c, m);
    await excluirCertificado(c, mc);
    await excluirCertificado(c, pes);
    await excluirCertificado(c, t);
    assert.deepEqual(await projecao(c), inicial.posicoes, 'projeção idêntica à de antes da cadeia');
    assert.deepEqual(await lotes(c), inicial.lotes);
  });
});

describe('CERT-2 — entrada → nascimento → transferência dos bezerros → pesagem', () => {
  test('nascimento bloqueado enquanto os nascidos são usados; desbloqueia na ordem inversa; matrizes intactas', async () => {
    const c = await base();
    const v = await entrada(c, { nome: 'VACAS', qtd: 10, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    await ativar(c);
    const inicial = await foto(c);
    const n = (await ok(rebanho(c, 'Nascimento', c.A, '10', [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 4, peso_medio_kg: 35 }]))).movimentacao;
    const nasc = await posQuery(c, { area_id: c.A.id, lote_entrada_id: null });
    assert.equal(nasc.quantidade_cabecas, 4);
    const t = (await ok(transferir(c, nasc, 3, c.B, '12'))).movimentacao;
    const nascB = await posQuery(c, { area_id: c.B.id });
    const pes = (await ok(rebanho(c, 'Pesagem', c.B, '14', [{ lote_id: nascB.id, peso_medio_kg: 60 }]))).movimentacao;
    await conservacao(c);
    await exigirBloqueio(c, n, DEP);
    await exigirBloqueio(c, t, DEP);
    await excluirCertificado(c, pes);
    await exigirBloqueio(c, n, DEP); // a transferência ainda usa os nascidos
    await excluirCertificado(c, t);
    await excluirCertificado(c, n);
    assert.deepEqual(await projecao(c), inicial.posicoes);
    assert.equal((await posDe(c, v, c.A)).quantidade_cabecas, 10, 'matrizes intactas');
  });

  test('morte das matrizes antes do nascimento (retroativa) bloqueia pela pré-condição; nascimento independente de outra área não bloqueia', async () => {
    const c = await base();
    const v = await entrada(c, { nome: 'VACAS', qtd: 2, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    const v2 = await entrada(c, { nome: 'VACAS B', qtd: 5, categoria: VACA, sexo: 'Fêmea', peso: 450, area: c.B });
    await ativar(c);
    const nB = (await ok(rebanho(c, 'Nascimento', c.B, '11', [{ sexo: 'Fêmea', categoria_mae: VACA, quantidade: 2 }]))).movimentacao;
    const n = (await ok(rebanho(c, 'Nascimento', c.A, '10', [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 1 }]))).movimentacao;
    // Matança retroativa das 2 matrizes de A ANTES do nascimento: recusada na criação (nascimento perderia as matrizes).
    const r = await morteLote(c, await posDe(c, v, c.A), 2, '05');
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO');
    // Nascimento de B (outra área, outras matrizes) não depende de A.
    await excluirCertificado(c, n);
    await excluirCertificado(c, nB);
    assert.equal((await posDe(c, v2, c.B)).quantidade_cabecas, 5);
    await conservacao(c);
  });
});

describe('CERT-3 — entradas A+B → junção → abate', () => {
  test('junção bloqueada enquanto o resultado é abatido; exclusão inversa restaura linhagem e pesos ponderados', async () => {
    const c = await base();
    const a = await entrada(c, { nome: 'PRINC', qtd: 30, peso: 400 });
    const b = await entrada(c, { nome: 'ORIG', qtd: 20, peso: 350 });
    await ativar(c);
    const inicial = await foto(c);
    const pa = await posDe(c, a, c.A);
    const pb = await posDe(c, b, c.A);
    const j = (await ok(juntar(c, c.A, pa, [pb], '10'))).movimentacao;
    const pos = await posDe(c, a, c.A);
    assert.deepEqual([pos.quantidade_cabecas, Number(pos.peso_medio_kg)], [50, 380], 'peso ponderado no servidor');
    const ab = (await ok(abateLote(c, pos, 45, '12'))).movimentacao;
    await conservacao(c);
    await exigirBloqueio(c, j, SALDO);
    await excluirCertificado(c, ab);
    await excluirCertificado(c, j);
    assert.deepEqual(await projecao(c), inicial.posicoes, 'linhagem, pesos e cabeças de volta');
  });

  test('abate e morte pelo comando de BAIXA (multi-categoria) e pelo manejo de lote — mesma reversão', async () => {
    const c = await base();
    await entrada(c, { nome: 'B1', qtd: 30 });
    await entrada(c, { nome: 'V1', qtd: 10, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    await ativar(c);
    const inicial = await foto(c);
    const ab = (await ok(baixa(c, 'Abate', c.A, '10', [{ categoria: BOI, quantidade: 5, destino: 'Consumo Próprio' }, { categoria: VACA, quantidade: 2, destino: 'Consumo Próprio' }]))).movimentacao;
    const mo = (await ok(baixa(c, 'Morte', c.A, '11', [{ categoria: BOI, quantidade: 25, causa_morte: 'Doença' }]))).movimentacao;
    await conservacao(c);
    // Morte total do BOI depois do abate: o abate (anterior) é independente da morte? Não: abater 5 e matar 25 = 30 → excluir o abate só DEVOLVE cabeças; livre.
    await excluirCertificado(c, ab);
    await excluirCertificado(c, mo);
    assert.deepEqual(await projecao(c), inicial.posicoes);
  });
});

describe('CERT-4 — independência causal e ordem no mesmo dia', () => {
  test('transferências e baixas posteriores INDEPENDENTES não bloqueiam; dependente no mesmo dia (registrado depois) bloqueia', async () => {
    const c = await base();
    const l = await entrada(c, { nome: 'L', qtd: 40 });
    await ativar(c);
    const inicial = await foto(c);
    const posA = await posDe(c, l, c.A);
    const t1 = (await ok(transferir(c, posA, 10, c.B, '10'))).movimentacao; // A→B
    const t2 = (await ok(transferir(c, posA, 5, c.C, '12'))).movimentacao; // A→C, independe de t1
    await ok(rebanho(c, 'Pesagem', c.A, '13', [{ lote_id: posA.id, peso_medio_kg: 410 }]));
    const m = (await ok(morteLote(c, posA, 3, '14'))).movimentacao;
    // Mesmo dia de t1, registrado depois, usando as cabeças que t1 levou para B.
    const t3 = (await ok(transferir(c, await posDe(c, l, c.B), 10, c.C, '10'))).movimentacao;
    await exigirBloqueio(c, t1, SALDO);
    const e2 = await elegibilidadeSemEscrita(c, t2.id);
    assert.equal(e2.elegivel, true, 'posterior independente não bloqueia');
    assert.equal((await elegibilidadeSemEscrita(c, m.id)).elegivel, true);
    await excluirCertificado(c, t3);
    await excluirCertificado(c, t1); // agora livre (t2, pesagem e morte em A não dependem dele)
    assert.deepEqual([(await posDe(c, l, c.A)).quantidade_cabecas, (await posDe(c, l, c.C)).quantidade_cabecas], [32, 5]);
    await excluirCertificado(c, m);
    await excluirCertificado(c, t2);
    const fim = await projecao(c);
    // Só restam a posição da entrada (com o peso da pesagem) e nada órfão.
    assert.equal(fim.length, inicial.posicoes.length, 'posições criadas pelas transferências sumiram');
  });

  test('retroativo: morte em data ANTERIOR a uma transferência já lançada; excluir a morte devolve; excluir a transferência por último restaura', async () => {
    const c = await base();
    const l = await entrada(c, { nome: 'L', qtd: 40 });
    await ativar(c);
    const inicial = await foto(c);
    const posA = await posDe(c, l, c.A);
    const t = (await ok(transferir(c, posA, 20, c.B, '20'))).movimentacao;
    const m = (await ok(morteLote(c, posA, 15, '05'))).movimentacao; // 40-15=25 ≥ 20 em 20/10
    const r = await morteLote(c, posA, 10, '06'); // 25-10=15 < 20 em 20/10 → recusada
    assert.equal(r.statusCode, 409, r.body);
    assert.equal((await elegibilidadeSemEscrita(c, t.id)).elegivel, true);
    await excluirCertificado(c, m);
    await excluirCertificado(c, t);
    assert.deepEqual(await projecao(c), inicial.posicoes);
  });
});

describe('CERT-5 — pesagens sucessivas e peso causal', () => {
  test('excluir pesagem intermediária e final restaura a série; transferência derivada do peso bloqueia a pesagem que a alimentou', async () => {
    const c = await base();
    const l = await entrada(c, { nome: 'L', qtd: 20, peso: 400 });
    await ativar(c);
    const posA = await posDe(c, l, c.A);
    const p1 = (await ok(rebanho(c, 'Pesagem', c.A, '10', [{ lote_id: posA.id, peso_medio_kg: 420 }]))).movimentacao;
    const p2 = (await ok(rebanho(c, 'Pesagem', c.A, '12', [{ lote_id: posA.id, peso_medio_kg: 440 }]))).movimentacao;
    const p3 = (await ok(rebanho(c, 'Pesagem', c.A, '14', [{ lote_id: posA.id, peso_medio_kg: 460 }]))).movimentacao;
    const peso = async () => Number((await posDe(c, l, c.A)).peso_medio_kg);
    assert.equal(await peso(), 460);
    await excluirCertificado(c, p2); // intermediária: medida, sem derivados posteriores
    assert.equal(await peso(), 460);
    await excluirCertificado(c, p3);
    assert.equal(await peso(), 420, 'volta à pesagem anterior');
    // Transferência depois de p1 leva o peso 420 para B; excluir p1 mudaria o peso derivado → bloqueia.
    const t = (await ok(transferir(c, await posDe(c, l, c.A), 5, c.B, '15'))).movimentacao;
    assert.equal(Number((await posDe(c, l, c.B)).peso_medio_kg), 420);
    await exigirBloqueio(c, p1, ['REBANHO_PESO_DEPENDENCIA_CAUSAL']);
    await excluirCertificado(c, t);
    await excluirCertificado(c, p1);
    assert.equal(await peso(), 400, 'peso da entrada');
  });
});

describe('CERT-6 — transferência para posição de destino JÁ existente e transferência multi-item', () => {
  test('segunda transferência para B (posição já existe) não remove a posição; multi-item (2 entradas) reverte as duas origens', async () => {
    const c = await base();
    const l = await entrada(c, { nome: 'L', qtd: 30, peso: 400 });
    const k = await entrada(c, { nome: 'K', qtd: 20, peso: 380 });
    await ativar(c);
    const inicial = await foto(c);
    const posA = await posDe(c, l, c.A);
    const t1 = (await ok(transferir(c, posA, 10, c.B, '10'))).movimentacao;
    const t2 = (await ok(transferir(c, posA, 5, c.B, '11'))).movimentacao;
    const idB = (await posDe(c, l, c.B)).id;
    await excluirCertificado(c, t2);
    assert.equal((await posDe(c, l, c.B))?.id, idB, 'posição B continua (ainda usada por t1)');
    assert.equal((await posDe(c, l, c.B)).quantidade_cabecas, 10);
    const multi = (await ok(transferenciaLedger(c, [{ posicao_id: posA.id, quantidade: 5 }, { posicao_id: (await posDe(c, k, c.A)).id, quantidade: 7 }], c.C, '12'))).movimentacao;
    assert.deepEqual([(await posDe(c, l, c.C)).quantidade_cabecas, (await posDe(c, k, c.C)).quantidade_cabecas], [5, 7]);
    await excluirCertificado(c, multi);
    assert.deepEqual([await posDe(c, l, c.C), await posDe(c, k, c.C)], [null, null], 'posições de C criadas só pela multi saem');
    await excluirCertificado(c, t1);
    assert.deepEqual(await projecao(c), inicial.posicoes);
  });

  test('transferência TOTAL (zera a origem) e morte TOTAL no destino: exclusão inversa restaura; origem zerada não é removida (tem a entrada)', async () => {
    const c = await base();
    const l = await entrada(c, { nome: 'L', qtd: 12 });
    await ativar(c);
    const inicial = await foto(c);
    const t = (await ok(transferir(c, await posDe(c, l, c.A), 12, c.B, '10'))).movimentacao;
    assert.equal((await posDe(c, l, c.A)).quantidade_cabecas, 0);
    const m = (await ok(morteLote(c, await posDe(c, l, c.B), 12, '11'))).movimentacao;
    await exigirBloqueio(c, t, SALDO);
    await excluirCertificado(c, m);
    await excluirCertificado(c, t);
    assert.deepEqual(await projecao(c), inicial.posicoes);
  });
});

describe('CERT-7 — mudança de categoria com operações no destino', () => {
  test('pesagem na nova categoria bloqueia a mudança; total (todas as cabeças) reverte categoria original', async () => {
    const c = await base();
    const g = await entrada(c, { nome: 'G', qtd: 15, categoria: GARROTE, peso: 310 });
    await ativar(c);
    const inicial = await foto(c);
    const mc = (await ok(rebanho(c, 'Mudança de Categoria', c.A, '10', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 15 }]))).movimentacao;
    const boi = await posQuery(c, { area_id: c.A.id, categoria: BOI });
    assert.equal(boi.quantidade_cabecas, 15);
    assert.equal((await posDe(c, g, c.A)).quantidade_cabecas, 0, 'origem zerada (mesma entrada, outra categoria)');
    const p = (await ok(rebanho(c, 'Pesagem', c.A, '12', [{ lote_id: boi.id, peso_medio_kg: 350 }]))).movimentacao;
    await exigirBloqueio(c, mc, DEP);
    await excluirCertificado(c, p);
    await excluirCertificado(c, mc);
    assert.deepEqual(await projecao(c), inicial.posicoes);
  });
});

describe('CERT-8 — nascimentos que compartilham a posição dos nascidos', () => {
  test('dois nascimentos na mesma área somam na MESMA posição; excluir o primeiro respeita o peso derivado do segundo; posição só some sem nenhum uso', async () => {
    const c = await base();
    await entrada(c, { nome: 'VACAS', qtd: 10, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    await ativar(c);
    const inicial = await foto(c);
    const n1 = (await ok(rebanho(c, 'Nascimento', c.A, '10', [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 2, peso_medio_kg: 30 }]))).movimentacao;
    const n2 = (await ok(rebanho(c, 'Nascimento', c.A, '12', [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 2, peso_medio_kg: 50 }]))).movimentacao;
    const nasc = await posQuery(c, { area_id: c.A.id, lote_entrada_id: null });
    assert.deepEqual([nasc.quantidade_cabecas, Number(nasc.peso_medio_kg)], [4, 40], 'mesma posição, peso ponderado');
    const e1 = await elegibilidadeSemEscrita(c, n1.id);
    if (e1.elegivel) {
      // Se o servidor libera, o resultado tem de ser exato: só o segundo nascimento, peso 50.
      await excluirCertificado(c, n1);
      const depois = await posQuery(c, { area_id: c.A.id, lote_entrada_id: null });
      assert.deepEqual([depois.id, depois.quantidade_cabecas, Number(depois.peso_medio_kg)], [nasc.id, 2, 50]);
    } else {
      assert.equal(e1.codigo, 'REBANHO_PESO_DEPENDENCIA_CAUSAL', JSON.stringify(e1));
      await excluirCertificado(c, n2);
      await excluirCertificado(c, n1);
    }
    if (await prisma().movimentacaoMapa.count({ where: { id: n2.id } })) await excluirCertificado(c, n2);
    assert.deepEqual(await projecao(c), inicial.posicoes, 'posição dos nascidos removida quando não há mais uso');
  });
});

describe('CERT-9 — concorrência real', () => {
  test('excluir a transferência × criar morte DEPENDENTE dela ao mesmo tempo: no máximo um vence; ledger íntegro (sem TOCTOU)', async () => {
    for (let i = 0; i < 4; i += 1) {
      const c = await base();
      const l = await entrada(c, { nome: 'L', qtd: 20 });
      await ativar(c);
      const t = (await ok(transferir(c, await posDe(c, l, c.A), 10, c.B, '10'))).movimentacao;
      const posB = await posDe(c, l, c.B);
      const [x, y] = await Promise.all([excluir(c, t.id), morteLote(c, posB, 6, '12')]);
      const venceu = [x.statusCode === 200, y.statusCode === 201];
      assert.ok(!(venceu[0] && venceu[1]), `os dois não podem vencer: ${x.body} | ${y.body}`);
      assert.ok(venceu[0] || venceu[1], `um deles vence: ${x.body} | ${y.body}`);
      await conservacao(c);
    }
  });

  test('duas exclusões INDEPENDENTES na mesma origem ao mesmo tempo: ambas passam, sem deadlock', async () => {
    for (let i = 0; i < 4; i += 1) {
      const c = await base();
      const l = await entrada(c, { nome: 'L', qtd: 30 });
      await ativar(c);
      const inicial = await foto(c);
      const posA = await posDe(c, l, c.A);
      const t1 = (await ok(transferir(c, posA, 5, c.B, '10'))).movimentacao;
      const t2 = (await ok(transferir(c, posA, 7, c.C, '11'))).movimentacao;
      const rs = await Promise.all([excluir(c, t1.id), excluir(c, t2.id)]);
      assert.deepEqual(rs.map((r) => r.statusCode), [200, 200], rs.map((r) => r.body).join(' | '));
      assert.deepEqual(await projecao(c), inicial.posicoes);
      await conservacao(c);
    }
  });
});

describe('CERT-10 — compatibilidade e recusas seguras', () => {
  test('movimento sem prova do ledger, cancelado pelo endpoint antigo e entrada do cadastro: nenhum é excluível; DELETE/PATCH genéricos seguem recusados', async () => {
    const c = await base();
    const l = await entrada(c, { nome: 'L', qtd: 20 });
    await ativar(c);
    const legado = await prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Morte', lote_id: l.id, quantidade_animais: 1, data_movimentacao: '2026-09-01' } } });
    const t = (await ok(transferir(c, await posDe(c, l, c.A), 5, c.B, '10'))).movimentacao;
    await ok(req('POST', `/movimentacoes-mapa/${t.id}/cancelamento`, c.tok, { operation_id: opId(), motivo: 'cancelado pelo caminho antigo' }), 200);
    for (const [mov, codigo] of [[legado, 'EXCLUSAO_MOVIMENTO_LEGADO'], [t, 'EXCLUSAO_MOVIMENTO_CANCELADO']]) {
      const e = await elegibilidadeSemEscrita(c, mov.id);
      assert.deepEqual([e.elegivel, e.codigo], [false, codigo]);
      const antes = await foto(c);
      const r = await excluir(c, mov.id);
      assert.deepEqual([r.statusCode, r.json().code], [409, codigo]);
      assert.deepEqual(await foto(c), antes);
    }
    for (const [m, corpo] of [['DELETE', undefined], ['PATCH', { quantidade_animais: 1 }]]) {
      const antes = await foto(c);
      const r = await req(m, `/movimentacoes-mapa/${t.id}`, c.tok, corpo);
      assert.ok(r.statusCode >= 400, `${m} genérico recusado (${r.statusCode})`);
      assert.deepEqual(await foto(c), antes);
    }
    // A ENTRADA (cadastro) não é movimento do mapa: não há id de exclusão para ela.
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id, dados: { path: ['tipo'], equals: 'Entrada' } } }), 0);
    await conservacao(c);
  });
});

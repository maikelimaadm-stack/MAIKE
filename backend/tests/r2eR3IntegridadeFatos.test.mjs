/**
 * PR174-R3 (D-PROD-107) — integridade temporal de fatos SEM delta de cabeças
 * (pesagem e nascimento) e formato fechado da renomeação informativa no POST
 * genérico. PostgreSQL real + HTTP autenticado; cada recusa confere ZERO mudança.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { definirFalhaInjetadaLedger } from '../src/modules/rebanhoLedger/rebanhoLedgerService.js';
import { criarEmLote as criarMovMapaEmLote } from '../src/modules/movimentacoesMapa/movimentacaoMapaService.js';

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
const rebanho = (c, tipo, linhas, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas, ...extra });
const transferir = (c, itens, destino, dia) =>
  req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: destino.id, data_movimentacao: `2026-11-${dia}`, itens });



const VACA = 'Vaca + 36 meses';
const pesagem = (c, posicao, peso, dia, area = c.A) => rebanho(c, 'Pesagem', [{ lote_id: posicao.id, peso_medio_kg: peso }], { area_id: area.id, data_movimentacao: `2026-11-${dia}` });
const nascimento = (c, quantidade, dia, area = c.A) => rebanho(c, 'Nascimento', [{ categoria_mae: VACA, sexo: 'Macho', quantidade }], { area_id: area.id, data_movimentacao: `2026-11-${dia}` });
const baixaEm = (c, tipo, quantidade, dia, categoria = BOI, area = c.A) =>
  req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: area.id, data_movimentacao: `2026-11-${dia}`, linhas: [{ categoria, quantidade, ...(tipo === 'Morte' ? { causa_morte: 'Doença' } : { destino: 'Consumo Próprio' }) }] });
const SEM_SALDO = 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO';
const posDb = (id) => prisma().posicaoRebanho.findUnique({ where: { id } });
const vacas = (c, qtd = 20, area = c.A) => entrada(c, { nome: 'VACAS', qtd, categoria: VACA, sexo: 'Fêmea', area, peso: 450 });

// ═══ 1: pesagem futura × posição esvaziada no passado ═══════════════════════

describe('R3 P1 — pesagem não fica numa posição sem cabeças', () => {
  test('P1.1 (hipótese): pesagem dia 05; depois transferência TOTAL retroativa dia 01 → 409 com evento/posição/área/data; nada gravado', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    const pes = await ok(pesagem(c, pA, 430, '05'));
    const r = await exigirNadaGravado(c, () => transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '01'), 409, SEM_SALDO);
    const d = r.json().details;
    assert.deepEqual([d.evento_id, d.tipo, d.data, d.posicao_id, d.area_id, d.saldo_no_fato], [pes.evento.id, 'PESAGEM', '2026-11-05', pA.id, c.A.id, 0]);
    await verificar(c);
  });

  test('P1.2 controles: parcial deixando cabeças (201); retirada de outra posição sem pesagem (201); pesagem de outra área não bloqueia', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100, peso: 400 });
    const l2 = await entrada(c, { nome: 'OUTRO', qtd: 30, peso: 380 });
    const lb = await entrada(c, { nome: 'EM B', qtd: 10, peso: 300, area: c.B });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    await ok(pesagem(c, pA, 430, '05'));
    await ok(pesagem(c, await pos(c, daEntrada(lb, c.B)), 310, '05', c.B));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 60 }], c.B, '01'));
    await ok(transferir(c, [{ posicao_id: (await pos(c, daEntrada(l2, c.A))).id, quantidade: 30 }], c.B, '01'));
    await verificar(c);
  });

  test('P1.3 morte, abate e mudança de categoria retroativos que zeram a posição pesada → 409; cancelada a pesagem, passam', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 20, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    const pes = await ok(pesagem(c, pA, 430, '05'));
    await exigirNadaGravado(c, () => baixaEm(c, 'Morte', 20, '01'), 409, SEM_SALDO);
    await exigirNadaGravado(c, () => baixaEm(c, 'Abate', 20, '02'), 409, SEM_SALDO);
    await exigirNadaGravado(c, () => rebanho(c, 'Mudança de Categoria', [{ categoria_atual: BOI, categoria_nova: 'Touro + 36 meses', quantidade: 20 }], { data_movimentacao: '2026-11-03' }), 409, SEM_SALDO);
    await ok(cancelar(c, pes.movimentacao.id), 200);
    await ok(baixaEm(c, 'Morte', 20, '01'));
    await verificar(c);
  });

  test('P1.4 mesmo dia: pesagem registrada ANTES da transferência total do dia (ordem de registro) → aceita; pesagem registrada DEPOIS na posição vazia → recusa na criação', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 50, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    await ok(pesagem(c, pA, 420, '05'));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 50 }], c.B, '05'));
    const r = await exigirNadaGravado(c, () => pesagem(c, pA, 425, '05'), 409, 'MANEJO_ESTADO_INVALIDO');
    assert.ok(r.json().details.data === '2026-11-05');
    await verificar(c);
  });

  test('P1.5 cancelar a transferência de VOLTA que sustentava a pesagem posterior → 409 (cancelamento também é guardado)', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 40, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    // transferência que traz cabeças de volta a A no dia 03 sustenta a pesagem do dia 05
    const ida = await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 40 }], c.B, '01'));
    const pB = await pos(c, daEntrada(l, c.B));
    const volta = await ok(transferir(c, [{ posicao_id: pB.id, quantidade: 40 }], c.A, '03'));
    await ok(pesagem(c, pA, 430, '05'));
    const r = await exigirNadaGravado(c, () => cancelar(c, volta.movimentacao.id), 409, SEM_SALDO);
    assert.equal(r.json().details.tipo, 'PESAGEM');
    void ida;
    await verificar(c);
  });
});

// ═══ 2: nascimento × matrizes certificadas ═════════════════════════════════

describe('R3 P2 — nascimento conserva as matrizes certificadas', () => {
  test('P2.1 (hipótese): nascimento dia 05; depois transferência retroativa de TODAS as vacas dia 01 → 409 com posições maternas/área/data', async () => {
    const c = await cenario();
    const v = await vacas(c, 20);
    await ativar(c);
    const pv = await pos(c, daEntrada(v, c.A));
    const nas = await ok(nascimento(c, 4, '05'));
    const r = await exigirNadaGravado(c, () => transferir(c, [{ posicao_id: pv.id, quantidade: 20 }], c.B, '01'), 409, SEM_SALDO);
    const d = r.json().details;
    assert.deepEqual([d.evento_id, d.tipo, d.data, d.area_id, d.posicao_ids], [nas.evento.id, 'NASCIMENTO', '2026-11-05', c.A.id, [pv.id]]);
    await verificar(c);
  });

  test('P2.2 várias posições maternas: remover UMA (outra certificada segue com cabeças) → 201; remover todas → 409; nascimento cancelado não bloqueia', async () => {
    const c = await cenario();
    const v1 = await vacas(c, 10);
    const v2 = await entrada(c, { nome: 'VACAS2', qtd: 8, categoria: VACA, sexo: 'Fêmea', peso: 440 });
    await ativar(c);
    const p1 = await pos(c, daEntrada(v1, c.A));
    const p2 = await pos(c, daEntrada(v2, c.A));
    const nas = await ok(nascimento(c, 3, '05'));
    await ok(transferir(c, [{ posicao_id: p1.id, quantidade: 10 }], c.B, '01'));
    await exigirNadaGravado(c, () => transferir(c, [{ posicao_id: p2.id, quantidade: 8 }], c.B, '02'), 409, SEM_SALDO);
    await exigirNadaGravado(c, () => baixaEm(c, 'Morte', 8, '02', VACA), 409, SEM_SALDO);
    await ok(cancelar(c, nas.movimentacao.id), 200);
    await ok(transferir(c, [{ posicao_id: p2.id, quantidade: 8 }], c.B, '02'));
    await verificar(c);
  });

  test('P2.3 controles: retirada parcial que mantém matrizes (201); vacas que CHEGAM depois não “salvam” nascimento sem as certificadas', async () => {
    const c = await cenario();
    const v = await vacas(c, 20);
    await ativar(c);
    const pv = await pos(c, daEntrada(v, c.A));
    await ok(nascimento(c, 2, '05'));
    await ok(transferir(c, [{ posicao_id: pv.id, quantidade: 15 }], c.B, '01'));
    // Outras vacas (outra linhagem, outra posição) chegam a A no dia 03: não são as certificadas do nascimento.
    const v2 = await entrada(c, { nome: 'VACAS NOVAS', qtd: 9, categoria: VACA, sexo: 'Fêmea', peso: 430, area: c.B });
    await ok(transferir(c, [{ posicao_id: (await pos(c, daEntrada(v2, c.B))).id, quantidade: 9 }], c.A, '03'));
    await exigirNadaGravado(c, () => transferir(c, [{ posicao_id: pv.id, quantidade: 5 }], c.B, '02'), 409, SEM_SALDO);
    await verificar(c);
  });
});

// ═══ 3: whitelist de renomeação ════════════════════════════════════════════

describe('R3 P3 — renomeação informativa tem formato fechado', () => {
  test('P3.1 (hipótese): Entrada + Renomear Lote com campos materiais → 409, nada gravado; renomeação real passa; posição no lugar do cadastro → 409', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100 });
    await ativar(c);
    const p = await pos(c, daEntrada(l, c.A));
    const ren = { empresa_id: c.empresa.id, tipo: 'Entrada', motivo: 'Renomear Lote', lote_id: l.id, lote: 'NOVO', observacoes: 'Renomear Lote: "LOTE" → "NOVO"', data_movimentacao: '2026-11-02' };
    for (const extra of [{ quantidade_animais: 100 }, { quantidade_animais: 100, area_destino_id: c.B.id }, { area_origem_id: c.A.id }, { quantidade: 5 }, { quantidade_cabecas: 1 }, { categoria_animal: BOI }, { peso_medio_kg: 400 }]) {
      await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa', c.tok, { ...ren, ...extra }), 409, 'REBANHO_LEDGER_SOMENTE_POR_COMANDO');
    }
    await exigirNadaGravado(c, () => req('POST', '/movimentacoes-mapa', c.tok, { ...ren, lote_id: p.id }), 409, 'REBANHO_LEDGER_SOMENTE_POR_COMANDO');
    const real = await req('POST', '/movimentacoes-mapa', c.tok, ren);
    assert.equal(real.statusCode, 201, real.body);
    assert.equal(await prisma().partidaRebanho.count({ where: { cliente_id: c.cliente.id, NOT: { evento: { tipo: 'ENTRADA' } } } }), 0);
    const contexto = { auth: { clienteId: c.cliente.id, usuarioId: (await prisma().usuario.findFirst({ where: { cliente_id: c.cliente.id } })).id }, requestId: 'r3' };
    const antes = await contagem(c);
    await assert.rejects(criarMovMapaEmLote(contexto, [{ ...ren, quantidade_animais: 100 }]), (e) => e.code === 'REBANHO_LEDGER_SOMENTE_POR_COMANDO');
    assert.deepEqual(await contagem(c), antes);
    await verificar(c);
  });

  test('P3.2 empresa LEGADA: renomeação do formulário antigo (com quantidade) segue aceita', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 100 });
    const r = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Entrada', motivo: 'Renomear Lote', lote_id: l.id, lote: 'NOVO', quantidade_animais: 100, area_origem_id: c.A.id });
    assert.equal(r.statusCode, 201, r.body);
  });
});

// ═══ Verificação, proprietário, concorrência, idempotência, tenant ═════════

describe('R3 — verificação, caso do proprietário, concorrência 3×, idempotência e tenant', () => {
  test('V1: fato inconsistente gravado por fora (banco descartável) → GET /rebanho/verificacao integro:false e aponta o fato, sem alterar nada', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 30, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    const pes = await ok(pesagem(c, pA, 420, '05'));
    // Simula um estado legado/corrompido: a partida de entrada desativada por fora do motor.
    await prisma().partidaRebanho.updateMany({ where: { cliente_id: c.cliente.id, posicao_id: pA.id }, data: { ativa: false } });
    const antes = await contagem(c);
    const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
    assert.equal(v.integro, false);
    assert.ok(v.precondicoes_violadas.some((x) => x.evento_id === pes.evento.id && x.tipo === 'PESAGEM' && x.posicao_id === pA.id), JSON.stringify(v.precondicoes_violadas));
    assert.deepEqual(await contagem(c), antes, 'verificação só lê');
  });

  test('D2 (caso do proprietário): 500 em A; A→B 100 dia 02; depois A→B 100 dia 01 → 300/200, sem Lote derivado, conservação e peso', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 500, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '02'));
    await ok(transferir(c, [{ posicao_id: pA.id, quantidade: 100 }], c.B, '01'));
    const pB = await pos(c, daEntrada(l, c.B));
    assert.deepEqual([(await posDb(pA.id)).quantidade_cabecas, (await posDb(pB.id)).quantidade_cabecas], [300, 200]);
    assert.equal(await prisma().lote.count({ where: { cliente_id: c.cliente.id } }), 1, 'nenhum Lote derivado');
    assert.equal(Number((await posDb(pB.id)).peso_medio_kg), 400);
    const v = await verificar(c);
    assert.deepEqual([v.conservacao.entradas, v.conservacao.saldo], [500, 500]);
  });

  test('K1: concorrência 3× — transferência retroativa total × pesagem futura: nunca as duas aceitas, sem 500, sem fato órfão', async () => {
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await limparBanco();
      const c = await cenario();
      const l = await entrada(c, { qtd: 40, peso: 400 });
      await ativar(c);
      const pA = await pos(c, daEntrada(l, c.A));
      const [rt, rp] = await Promise.all([transferir(c, [{ posicao_id: pA.id, quantidade: 40 }], c.B, '01'), pesagem(c, pA, 430, '05')]);
      assert.ok(![rt.statusCode, rp.statusCode].includes(500), `${rt.body} / ${rp.body}`);
      assert.ok(!(rt.statusCode === 201 && rp.statusCode === 201), `rodada ${rodada}: as duas aceitas`);
      assert.ok(rt.statusCode === 201 || rp.statusCode === 201, `rodada ${rodada}: nenhuma aceita`);
      await verificar(c);
    }
  });

  test('K2: concorrência 3× — transferência retroativa de todas as matrizes × nascimento futuro: nunca as duas aceitas', async () => {
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await limparBanco();
      const c = await cenario();
      const v = await vacas(c, 12);
      await ativar(c);
      const pv = await pos(c, daEntrada(v, c.A));
      const [rt, rn] = await Promise.all([transferir(c, [{ posicao_id: pv.id, quantidade: 12 }], c.B, '01'), nascimento(c, 3, '05')]);
      assert.ok(![rt.statusCode, rn.statusCode].includes(500), `${rt.body} / ${rn.body}`);
      assert.ok(!(rt.statusCode === 201 && rn.statusCode === 201), `rodada ${rodada}: as duas aceitas`);
      await verificar(c);
    }
  });

  test('I1: recusa não reserva chave — reenvio da MESMA chave recusada → mesma recusa, sem duplicar; tenant: lote de outro tenant não vira renomeação', async () => {
    const c = await cenario();
    const l = await entrada(c, { qtd: 40, peso: 400 });
    await ativar(c);
    const pA = await pos(c, daEntrada(l, c.A));
    await ok(pesagem(c, pA, 430, '05'));
    const corpo = { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-01', itens: [{ posicao_id: pA.id, quantidade: 40 }] };
    for (let i = 0; i < 2; i += 1) await exigirNadaGravado(c, () => req('POST', '/rebanho/comandos/transferencia', c.tok, corpo), 409, SEM_SALDO);
    const viz = await cenario();
    const lv = await entrada(viz, { qtd: 10 });
    const antes = await contagem(c);
    const r = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Entrada', motivo: 'Renomear Lote', lote_id: lv.id, lote: 'X' });
    assert.ok(r.statusCode >= 400 && r.statusCode < 500, `${r.statusCode} ${r.body}`);
    assert.deepEqual(await contagem(c), antes);
  });
});


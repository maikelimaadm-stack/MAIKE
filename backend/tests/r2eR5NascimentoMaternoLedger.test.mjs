/**
 * PR174-R5 (D-PROD-107) — integridade materna do Nascimento no ledger.
 *
 * Conversão dos riscos da R2B-R2 (política materna, elo matriz ↔ nascimento
 * na exclusão #167, no histórico, no cancelamento e sob concorrência) do motor
 * legado (que escrevia em Lote) para as POSIÇÕES. Lote nunca muda.
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
const BOI = 'Boi 25 a 36 meses';
const VACA = 'Vaca + 36 meses';
const VACA_25 = 'Vaca 25 a 36 meses';
const NOVILHA = 'Novilha 13 a 24 meses';
const BEZERRA = 'Bezerra 0 a 12 meses';

const cenario = async ({ ativar = true } = {}) => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const c = { cliente: adm.cliente, tok, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
  if (ativar) await ativarLedger(c);
  return c;
};
const ativarLedger = async (c) => {
  const a = await req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, modo: 'entradas' });
  assert.equal(a.statusCode, 201, a.body);
};
const entrada = async (c, { nome = 'VACAS', qtd = 20, area = c.A, categoria = VACA, sexo = 'Fêmea' } = {}) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo, setor_id: c.setor.id, area_entrada_id: area.id, area_atual_id: area.id,
    data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 450,
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const posicoes = async (c) => (await req('GET', `/rebanho/posicoes?empresa_id=${c.empresa.id}&incluir_vazias=true`, c.tok)).json().itens;
const pos = async (c, lote, area = c.A) => (await posicoes(c)).find((p) => p.lote_entrada_id === lote.id && p.area_atual_id === area.id);
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const nascer = (c, linhas, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo: 'Nascimento', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-02', linhas, ...extra });
const macho = (categoria_mae = VACA, quantidade = 2) => [{ categoria_mae, sexo: 'Macho', quantidade }];
const transferir = (c, itens, destino, dia) =>
  req('POST', '/rebanho/comandos/transferencia', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: destino.id, data_movimentacao: `2026-11-${dia}`, itens });
const cancelar = (c, movId) => req('POST', `/movimentacoes-mapa/${movId}/cancelamento`, c.tok, { operation_id: opId(), motivo: 'teste materno' });
const foto = async (c) => {
  const w = { cliente_id: c.cliente.id };
  return {
    lotes: (await prisma().lote.findMany({ where: w, orderBy: { id: 'asc' } })).map((l) => [l.id, l.quantidade_cabecas, l.status, l.excluido_em ? 'X' : '-']),
    posicoes: (await prisma().posicaoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.quantidade_cabecas]),
    partidas: await prisma().partidaRebanho.count({ where: w }),
    movs: await prisma().movimentacaoMapa.count({ where: w }),
    ops: await prisma().operacaoIdempotente.count({ where: w }),
    audits: await prisma().auditLog.count({ where: w }),
  };
};
const exigirNadaGravado = async (c, acao, status, codigo) => {
  const antes = await foto(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await foto(c), antes, 'nada pode ser gravado');
  return r;
};
const MAE_INVALIDA = 'MANEJO_CATEGORIA_MAE_INVALIDA';

describe('R5 materno — quem é mãe', () => {
  test('MA1: categoria mãe masculina (Boi), não materna (Bezerra) ou inexistente → 409 sem gravar, mesmo com posição dessa categoria na área', async () => {
    const c = await cenario();
    await entrada(c, { nome: 'BOIS', categoria: BOI, sexo: 'Macho' });
    await entrada(c, { nome: 'BEZERRAS', categoria: BEZERRA, sexo: 'Fêmea' });
    for (const categoria of [BOI, BEZERRA, 'Vaca Imaginária']) await exigirNadaGravado(c, () => nascer(c, macho(categoria)), 409, MAE_INVALIDA);
  });

  test('MA2: posição de categoria Vaca cadastrada com sexo Macho não é mãe → 409; uma linha válida + uma de mãe masculina → NADA gravado', async () => {
    const c = await cenario();
    await entrada(c, { nome: 'VACA MACHO', categoria: VACA, sexo: 'Macho' });
    await exigirNadaGravado(c, () => nascer(c, macho(VACA)), 409, MAE_INVALIDA);
    await entrada(c, { nome: 'NOVILHAS', categoria: NOVILHA, sexo: 'Fêmea' });
    await exigirNadaGravado(c, () => nascer(c, [...macho(NOVILHA), ...macho(VACA)]), 409, MAE_INVALIDA);
  });

  test('MA3: matriz em OUTRA área, de OUTRA empresa, de OUTRO tenant ou excluída do Cadastro não vale', async () => {
    const c = await cenario();
    await entrada(c, { nome: 'VACAS B', area: c.B });
    await exigirNadaGravado(c, () => nascer(c, macho()), 409, MAE_INVALIDA);
    const outra = await prisma().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
    const s2 = await prisma().setor.create({ data: { cliente_id: c.cliente.id, empresa_id: outra.id, numero_setor: '9', nome: 'S9' } });
    const a2 = await prisma().areaPastagem.create({ data: { cliente_id: c.cliente.id, empresa_id: outra.id, setor_id: s2.id, setor_nome: 'S9', numero_area: '9', nome: 'PASTO X', tamanho_hectares: 5 } });
    await ok(req('POST', '/rebanho/ativacao', c.tok, { operation_id: opId(), empresa_id: outra.id, modo: 'entradas' }));
    await entrada({ ...c, empresa: outra, setor: s2 }, { nome: 'VACAS OUTRA', area: a2 });
    await exigirNadaGravado(c, () => nascer(c, macho()), 409, MAE_INVALIDA);
    // Área da outra empresa no corpo: 404 (não vira "mãe emprestada").
    await exigirNadaGravado(c, () => nascer(c, macho(), { area_id: a2.id }), 404);
    const viz = await cenario();
    await entrada(viz, { nome: 'VACAS VIZ' });
    await exigirNadaGravado(c, () => nascer(c, macho()), 409, MAE_INVALIDA);
    await exigirNadaGravado(c, () => nascer(c, macho(), { area_id: viz.A.id }), 404);
    // Matriz excluída do Cadastro (sem fato além da entrada): posição zerada, não é mãe.
    const v = await entrada(c, { nome: 'VACAS EXCLUIDAS' });
    assert.equal((await req('DELETE', `/lotes/${v.id}`, c.tok)).statusCode, 204);
    await exigirNadaGravado(c, () => nascer(c, macho()), 409, MAE_INVALIDA);
  });

  test('MA4: Vaca 25-36, Vaca +36 e Novilha 13-24 (fêmeas) são mães válidas; as posições das mães e o cadastro ficam intactos; crias em posição de NASCIMENTO (sem Lote)', async () => {
    const c = await cenario();
    const maes = [];
    for (const categoria of [VACA_25, VACA, NOVILHA]) maes.push(await entrada(c, { nome: `MAES ${categoria}`, categoria }));
    const lotesAntes = await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } });
    const antes = await Promise.all(maes.map(async (m) => (await pos(c, m)).quantidade_cabecas));
    const n = await ok(nascer(c, [{ categoria_mae: VACA_25, sexo: 'Macho', quantidade: 1 }, { categoria_mae: VACA, sexo: 'Fêmea', quantidade: 2 }, { categoria_mae: NOVILHA, sexo: 'Macho', quantidade: 3 }]));
    assert.deepEqual(await Promise.all(maes.map(async (m) => (await pos(c, m)).quantidade_cabecas)), antes, 'mães intactas');
    assert.deepEqual(await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } }), lotesAntes, 'nenhum Lote criado ou alterado');
    const nascidas = (await posicoes(c)).filter((p) => !p.lote_entrada_id);
    assert.equal(nascidas.reduce((t, p) => t + p.quantidade_cabecas, 0), 6);
    assert.deepEqual(n.movimentacao.linhas.map((l) => l.maes_lote_ids.length), [1, 1, 1], 'cada linha certifica as matrizes da categoria');
  });
});

describe('R5 materno — elo matriz ↔ nascimento (#167, histórico, cancelamento)', () => {
  test('MC1: nascimento ATIVO que cita a matriz bloqueia a exclusão dela (movimentacao_ativa); cancelado com prova → exclusão LÓGICA (linha preservada)', async () => {
    const c = await cenario();
    const v = await entrada(c);
    const n = await ok(nascer(c, macho()));
    const e = (await req('GET', `/lotes/${v.id}/elegibilidade-exclusao`, c.tok)).json();
    assert.deepEqual([e.tipo, e.motivo], ['bloqueado', 'movimentacao_ativa']);
    await exigirNadaGravado(c, () => req('DELETE', `/lotes/${v.id}`, c.tok), 409, 'LOTE_DELETE_BLOCKED');
    assert.equal((await cancelar(c, n.movimentacao.id)).statusCode, 200);
    assert.equal((await req('GET', `/lotes/${v.id}/elegibilidade-exclusao`, c.tok)).json().tipo, 'exclusao_logica');
    assert.equal((await req('DELETE', `/lotes/${v.id}`, c.tok)).statusCode, 204);
    assert.ok((await prisma().lote.findUnique({ where: { id: v.id } })).excluido_em);
  });

  test('MC2: histórico pela matriz acha o nascimento; homônimo (outro id), outra empresa e outro tenant não', async () => {
    const c = await cenario();
    const v = await entrada(c);
    const homonimo = await entrada(c, { area: c.B });
    const n = await ok(nascer(c, macho()));
    const hist = async (cc, lote) => (await req('GET', `/movimentacoes-mapa/historico?empresa_id=${cc.empresa.id}&lote_ids=${lote.id}&limit=50`, cc.tok)).json().items?.map((x) => x.id) ?? [];
    assert.ok((await hist(c, v)).includes(n.movimentacao.id));
    assert.ok(!(await hist(c, homonimo)).includes(n.movimentacao.id), 'homônimo com outro id');
    const viz = await cenario();
    const r = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&lote_ids=${v.id}&limit=50`, viz.tok);
    assert.ok(![...(r.json().items ?? [])].some((x) => x.id === n.movimentacao.id), 'outro tenant não enxerga');
  });

  test('MC3: nascimento ATIVO posterior bloqueia cancelar a transferência que trouxe as matrizes; cancelado o nascimento, a transferência cancela', async () => {
    const c = await cenario();
    const v = await entrada(c);
    const t = await ok(transferir(c, [{ posicao_id: (await pos(c, v)).id, quantidade: 20 }], c.B, '01'));
    const n = await ok(nascer(c, macho(), { area_id: c.B.id }));
    await exigirNadaGravado(c, () => cancelar(c, t.movimentacao.id), 409);
    assert.equal((await cancelar(c, n.movimentacao.id)).statusCode, 200);
    assert.equal((await cancelar(c, t.movimentacao.id)).statusCode, 200);
    assert.equal((await pos(c, v)).quantidade_cabecas, 20);
  });

  test('MC4: mudança Novilha → Vaca e depois nascimento usando a vaca → cancelar a mudança é BLOQUEADO; cancelado o nascimento, a mudança cancela', async () => {
    const c = await cenario();
    await entrada(c, { nome: 'NOVILHAS', categoria: NOVILHA });
    const m = await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, {
      operation_id: opId(), tipo: 'Mudança de Categoria', empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-11-01', linhas: [{ categoria_atual: NOVILHA, categoria_nova: VACA, quantidade: 20 }],
    }));
    const n = await ok(nascer(c, macho(VACA)));
    await exigirNadaGravado(c, () => cancelar(c, m.movimentacao.id), 409);
    assert.equal((await cancelar(c, n.movimentacao.id)).statusCode, 200);
    assert.equal((await cancelar(c, m.movimentacao.id)).statusCode, 200);
  });
});

describe('R5 materno — concorrência real (3 rodadas)', () => {
  for (let rodada = 1; rodada <= 3; rodada += 1) {
    test(`MK1.${rodada}: DELETE da matriz × nascimento → nunca nascimento ativo certificado por matriz excluída; sem 500`, async () => {
      const c = await cenario();
      const v = await entrada(c);
      const [d, n] = await Promise.all([req('DELETE', `/lotes/${v.id}`, c.tok), nascer(c, macho())]);
      assert.ok(![d.statusCode, n.statusCode].includes(500), `${d.body} / ${n.body}`);
      assert.ok(!(d.statusCode === 204 && n.statusCode === 201), `rodada ${rodada}: matriz excluída e nascimento aceito`);
      assert.ok(d.statusCode === 204 || n.statusCode === 201, 'um dos dois vale');
    });

    test(`MK2.${rodada}: cancelar a transferência da matriz × nascimento nela → nunca os dois; sem 500`, async () => {
      const c = await cenario();
      const v = await entrada(c);
      const t = await ok(transferir(c, [{ posicao_id: (await pos(c, v)).id, quantidade: 20 }], c.B, '01'));
      const [rc, rn] = await Promise.all([cancelar(c, t.movimentacao.id), nascer(c, macho(), { area_id: c.B.id })]);
      assert.ok(![rc.statusCode, rn.statusCode].includes(500), `${rc.body} / ${rn.body}`);
      assert.ok(!(rc.statusCode === 200 && rn.statusCode === 201), `rodada ${rodada}: transferência cancelada e nascimento aceito sem matrizes`);
      const v2 = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
      assert.equal(v2.integro, true, JSON.stringify(v2));
    });
  }
});

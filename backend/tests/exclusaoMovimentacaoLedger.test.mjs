/**
 * Exclusão DEFINITIVA segura de movimentação do rebanho (D-PROD-110).
 *
 * Contrato: GET /movimentacoes-mapa/:id/elegibilidade-exclusao (informativa)
 * e POST /movimentacoes-mapa/:id/exclusao {operation_id, motivo}. Reaproveita
 * o motor certificado de reversão do ledger e, na MESMA transação, apaga
 * fisicamente MovimentacaoMapa + EventoRebanho + PartidaRebanho + PesoRebanho
 * do fato (e a posição que só existia por ele, se nada a cita). Auditoria
 * administrativa fica; histórico operacional não.
 *
 * PostgreSQL real e isolado (DATABASE_URL de teste) + HTTP autenticado.
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

/** Tenant com admin + usuário comum, empresa, três áreas. */
const base = async () => {
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
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  return { cliente: adm.cliente, usuario: adm.usuario, tok, tokComum, empresa, setor, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B'), C: await area(3, 'PASTO C') };
};
const entrada = async (c, { nome = 'LOTE', qtd = 10, area = c.A, data = '2026-10-01', categoria = BOI, sexo = 'Macho', peso = 400 } = {}) => {
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
/** B6: 10 cabeças em A, empresa ativada. */
const cenario = async () => {
  const c = await base();
  c.lote = await entrada(c);
  await ativar(c);
  c.posA = await posDe(c, c.lote, c.A);
  return c;
};
// Posição DA ENTRADA (a primeira criada): ordem explícita, como no CERT (ver D-PROD-122).
const posDe = (c, lote, area) => prisma().posicaoRebanho.findFirst({ where: { cliente_id: c.cliente.id, lote_entrada_id: lote.id, area_id: area.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const saldo = async (c, lote, area) => (await posDe(c, lote, area))?.quantidade_cabecas ?? 0;
const ok = async (r, status = 201) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const manejoLote = (c, corpo) => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, ...corpo });
const transferencia = (c, posicao, qtd, destino, data = '2026-10-10') =>
  manejoLote(c, { tipo: 'Transferência de Área', lote_id: posicao.id, quantidade_animais: qtd, area_destino_id: destino.id, data_movimentacao: data });
const rebanho = (c, tipo, linhas, extra = {}) =>
  req('POST', '/movimentacoes-mapa/comandos/manejo-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-20', linhas, ...extra });
const baixa = (c, tipo, linhas) =>
  req('POST', '/movimentacoes-mapa/comandos/baixa-rebanho', c.tok, { operation_id: opId(), tipo, empresa_id: c.empresa.id, area_id: c.A.id, data_movimentacao: '2026-10-20', linhas });
const juntar = (c, principal, origens) =>
  req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', c.tok, { operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: principal.id, lote_origem_ids: origens.map((o) => o.id), data_movimentacao: '2026-10-20' });

const excluir = (c, id, token = c.tok, body = { operation_id: opId(), motivo: 'lançado errado' }) => req('POST', `/movimentacoes-mapa/${id}/exclusao`, token, body);
const elegibilidade = async (c, id, token = c.tok) => (await req('GET', `/movimentacoes-mapa/${id}/elegibilidade-exclusao`, token)).json();
const cancelar = (c, id) => req('POST', `/movimentacoes-mapa/${id}/cancelamento`, c.tok, { operation_id: opId(), motivo: 'cancelado antes' });
const historico = async (c, loteIds) => {
  const r = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}${loteIds.map((l) => `&lote_ids=${l}`).join('')}`, c.tok);
  assert.equal(r.statusCode, 200, r.body);
  return r.json().items.map((m) => m.id);
};
const listagem = async (c) => (await req('GET', `/movimentacoes-mapa?empresa_id=${c.empresa.id}`, c.tok)).json();
const verificar = async (c) => {
  const v = (await req('GET', `/rebanho/verificacao?empresa_id=${c.empresa.id}`, c.tok)).json();
  assert.equal(v.integro, true, JSON.stringify(v));
};
const lotesFixos = async (c) => (await prisma().lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } }))
  .map((l) => [l.id, l.quantidade_cabecas, l.quantidade_entrada, l.status, l.area_atual_id, l.categoria, l.excluido_em]);
/** Estado das posições (projeção completa). */
const posicoes = async (c) => (await prisma().posicaoRebanho.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { id: 'asc' } }))
  .map((x) => [x.id, x.area_id, x.quantidade_cabecas, x.peso_medio_kg === null ? null : Number(x.peso_medio_kg), JSON.stringify(x.linhagem)]);
/** Fotografia de tudo que a exclusão poderia tocar. */
const foto = async (c) => {
  const w = { cliente_id: c.cliente.id };
  const p = prisma();
  return {
    lotes: await lotesFixos(c),
    posicoes: await posicoes(c),
    eventos: (await p.eventoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((e) => [e.id, e.situacao]),
    partidas: (await p.partidaRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.ativa]),
    pesos: (await p.pesoRebanho.findMany({ where: w, orderBy: { id: 'asc' } })).map((x) => [x.id, x.ativa]),
    movs: (await p.movimentacaoMapa.findMany({ where: w, orderBy: { id: 'asc' } })).map((m) => [m.id, m.dados.situacao ?? null]),
    ops: (await p.operacaoIdempotente.findMany({ where: w, orderBy: { id: 'asc' } })).map((o) => [o.id, o.status]),
    audits: await p.auditLog.count({ where: w }),
  };
};
const exigirNadaMuda = async (c, acao, status, codigo) => {
  const antes = await foto(c);
  const r = await acao();
  assert.equal(r.statusCode, status, r.body);
  if (codigo) assert.equal(r.json().code, codigo, r.body);
  assert.deepEqual(await foto(c), antes, 'nada pode mudar');
  return r;
};
/** Nada do fato sobra no histórico operacional; a auditoria administrativa sim. */
const exigirFatoApagado = async (c, movId, eventoId) => {
  const p = prisma();
  assert.equal(await p.movimentacaoMapa.count({ where: { id: movId } }), 0, 'MovimentacaoMapa apagada');
  assert.equal(await p.eventoRebanho.count({ where: { id: eventoId } }), 0, 'EventoRebanho apagado');
  assert.equal(await p.partidaRebanho.count({ where: { evento_id: eventoId } }), 0, 'partidas apagadas');
  assert.equal(await p.pesoRebanho.count({ where: { evento_id: eventoId } }), 0, 'pesos apagados');
  assert.equal(await p.eventoRebanho.count({ where: { cliente_id: c.cliente.id, situacao: 'cancelado' } }), 0, 'nenhum evento "cancelado" sobra');
  const aud = await p.auditLog.findMany({ where: { cliente_id: c.cliente.id, entidade: 'MovimentacaoMapa', entidade_id: movId, acao: 'exclusao_definitiva' } });
  assert.equal(aud.length, 1, 'uma auditoria da exclusão');
  const texto = JSON.stringify(aud[0]);
  for (const proibido of ['senha', 'token', 'password', 'DATABASE_URL']) assert.ok(!texto.includes(proibido), `auditoria sem ${proibido}`);
  assert.equal(aud[0].dados_anteriores.evento_id, eventoId);
  assert.equal(aud[0].dados_novos.motivo.length > 0, true);
  assert.ok(aud[0].request_id, 'correlação (request id)');
};
const eventoDe = async (movId) => (await prisma().movimentacaoMapa.findUnique({ where: { id: movId } })).dados.efeito_servidor.evento_id;

// ═══ (a) + B6 + (i) + (j) ══════════════════════════════════════════════════

describe('EX-A — exclusão simples (B6)', () => {
  test('B6: 10 em A → transferência de 3 para B → EXCLUIR → A=10, B=0, cadastro 10, some do histórico; posição B (só dela) removida; auditoria mantida', async () => {
    const c = await cenario();
    const lotesAntes = await lotesFixos(c);
    const posAntes = await posicoes(c);
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const eventoId = await eventoDe(t.id);
    assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B)], [7, 3]);
    assert.deepEqual(await historico(c, [c.lote.id]), [t.id]);

    const antesDaElegibilidade = await foto(c);
    const e = await elegibilidade(c, t.id);
    assert.deepEqual(await foto(c), antesDaElegibilidade, 'elegibilidade não grava nada');
    assert.deepEqual([e.elegivel, e.codigo, e.pode_excluir, e.modo], [true, null, true, 'exclusao_definitiva'], JSON.stringify(e));
    assert.ok(e.efeitos.length === 2 && e.posicoes_removidas.length === 1, JSON.stringify(e));

    const r = await ok(excluir(c, t.id), 200);
    assert.deepEqual([r.excluida, r.movimentacao_id, r.evento_tipo, r.replay], [true, t.id, 'TRANSFERENCIA', false]);
    assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B)], [10, 0]);
    assert.equal(await posDe(c, c.lote, c.B), null, 'posição que só existia pela transferência foi removida');
    assert.deepEqual(await posicoes(c), posAntes, 'projeção idêntica à de antes da transferência');
    assert.deepEqual(await lotesFixos(c), lotesAntes, 'cadastro de entrada intacto (10)');
    assert.deepEqual(await historico(c, [c.lote.id]), [], 'some do histórico');
    assert.ok(!(await listagem(c)).some((m) => m.id === t.id), 'some da listagem');
    await exigirFatoApagado(c, t.id, eventoId);
    await verificar(c);
    // Depois da exclusão, a elegibilidade/command do id apagado: 404/409 estável.
    assert.equal((await req('GET', `/movimentacoes-mapa/${t.id}/elegibilidade-exclusao`, c.tok)).statusCode, 404);
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'EXCLUSAO_JA_REALIZADA');
    // Lançar a operação correta depois funciona normalmente.
    await ok(transferencia(c, (await posDe(c, c.lote, c.A)), 4, c.B));
    assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B)], [6, 4]);
    await verificar(c);
  });

  test('transferência TOTAL para área nova e de volta para posição pré-existente: excluir a volta restaura sem remover a posição de origem', async () => {
    const c = await cenario();
    const ida = (await ok(transferencia(c, c.posA, 10, c.B, '2026-10-10'))).movimentacao;
    const posB = await posDe(c, c.lote, c.B);
    const antes = await posicoes(c);
    const volta = (await ok(transferencia(c, posB, 10, c.A, '2026-10-11'))).movimentacao;
    await ok(excluir(c, volta.id), 200);
    assert.deepEqual(await posicoes(c), antes, 'A volta a 0 (posição continua: tem partidas da entrada), B volta a 10');
    await ok(excluir(c, ida.id), 200);
    assert.deepEqual([await saldo(c, c.lote, c.A), await posDe(c, c.lote, c.B)], [10, null]);
    await verificar(c);
  });
});

// ═══ (b) dependência causal bloqueia com 0 escrita ═════════════════════════

describe('EX-B — fato posterior DEPENDENTE bloqueia sem gravar nada', () => {
  test('morte posterior na posição criada → 409 CANCELAMENTO_SALDO_HISTORICO_NEGATIVO; elegibilidade igual; 0 escrita', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    await ok(manejoLote(c, { tipo: 'Morte', lote_id: (await posDe(c, c.lote, c.B)).id, quantidade_animais: 2, data_movimentacao: '2026-10-12' }));
    const e = await elegibilidade(c, t.id);
    assert.deepEqual([e.elegivel, e.codigo], [false, 'CANCELAMENTO_SALDO_HISTORICO_NEGATIVO'], JSON.stringify(e));
    assert.equal(e.detalhes.data, '2026-10-12');
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'CANCELAMENTO_SALDO_HISTORICO_NEGATIVO');
  });

  test('pesagem posterior na posição criada → 409 REBANHO_DEPENDENCIA_FATO_SEM_SALDO; tarefa ligada à posição → 409 REBANHO_CANCELAMENTO_VINCULO_POSTERIOR', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const posB = await posDe(c, c.lote, c.B);
    const pes = (await ok(rebanho(c, 'Pesagem', [{ lote_id: posB.id, peso_medio_kg: 450 }], { area_id: c.B.id, data_movimentacao: '2026-10-12' }))).movimentacao;
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO');
    // Exclui o posterior primeiro (ordem inversa) → depois o anterior passa.
    await ok(excluir(c, pes.id), 200);
    const g = await prisma().grupoAtividade.create({ data: { cliente_id: c.cliente.id, nome_grupo: 'G' } });
    const tt = await prisma().tipoTarefa.create({ data: { cliente_id: c.cliente.id, nome_tipo: 'T', grupo_atividade_id: g.id, grupo_atividade_nome: 'G' } });
    const tarefa = await prisma().lancamentoTarefa.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, titulo: 'T', tipo: 'Geral', tipo_tarefa_id: tt.id, tipo_tarefa_nome: 'T', posicao_id: posB.id },
    });
    const r = await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'REBANHO_CANCELAMENTO_VINCULO_POSTERIOR');
    assert.deepEqual(r.json().details.bloqueadores.map((b) => [b.tipo, b.id]), [['LancamentoTarefa', tarefa.id]]);
    await prisma().lancamentoTarefa.delete({ where: { id: tarefa.id } });
    await ok(excluir(c, t.id), 200);
    assert.deepEqual([await saldo(c, c.lote, c.A), await posDe(c, c.lote, c.B)], [10, null]);
    await verificar(c);
  });

  test('documento de outro módulo que cita o movimento (mesmo CANCELADO) bloqueia: EXCLUSAO_REFERENCIA_DOCUMENTAL / vínculo posterior', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const ativo = await prisma().manejoTecnicoRebanho.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { movimentacao_id: t.id } } });
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'REBANHO_CANCELAMENTO_VINCULO_POSTERIOR');
    await prisma().manejoTecnicoRebanho.update({ where: { id: ativo.id }, data: { dados: { movimentacao_id: t.id, situacao: 'cancelado' } } });
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'EXCLUSAO_REFERENCIA_DOCUMENTAL');
    await prisma().manejoTecnicoRebanho.delete({ where: { id: ativo.id } });
    await ok(excluir(c, t.id), 200);
  });
});

// ═══ (c) posterior INDEPENDENTE não bloqueia ═══════════════════════════════

describe('EX-C — fato posterior independente não bloqueia (causal, não cronológico)', () => {
  test('T1 (3 A→B) e depois T2 (2 A→C) + pesagem em A: excluir T1 passa; A=8, C=2, B some', async () => {
    const c = await cenario();
    const t1 = (await ok(transferencia(c, c.posA, 3, c.B, '2026-10-10'))).movimentacao;
    await ok(transferencia(c, c.posA, 2, c.C, '2026-10-12'));
    await ok(rebanho(c, 'Pesagem', [{ lote_id: c.posA.id, peso_medio_kg: 410 }], { data_movimentacao: '2026-10-13' }));
    const e = await elegibilidade(c, t1.id);
    assert.equal(e.elegivel, true, JSON.stringify(e));
    await ok(excluir(c, t1.id), 200);
    assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B), await saldo(c, c.lote, c.C)], [8, 0, 2]);
    assert.equal(Number((await posDe(c, c.lote, c.A)).peso_medio_kg), 410, 'pesagem posterior independente preservada');
    assert.equal((await historico(c, [c.lote.id])).length, 2);
    await verificar(c);
  });
});

// ═══ (d) concorrência e retry ══════════════════════════════════════════════

describe('EX-D — concorrência: cancelar × excluir, dois excluir, retry', () => {
  test('cancelar e excluir ao mesmo tempo: exatamente um vence; estado coerente', async () => {
    for (let i = 0; i < 3; i += 1) {
      const c = await cenario();
      const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
      const [x, y] = await Promise.all([excluir(c, t.id), cancelar(c, t.id)]);
      const sucessos = [x, y].filter((r) => r.statusCode === 200).length;
      assert.equal(sucessos, 1, `${x.body} | ${y.body}`);
      if (x.statusCode === 200) {
        assert.equal(y.statusCode, 404, y.body);
        assert.equal(await prisma().movimentacaoMapa.count({ where: { id: t.id } }), 0);
      } else {
        assert.equal(x.json().code, 'EXCLUSAO_MOVIMENTO_CANCELADO', x.body);
        assert.equal((await prisma().movimentacaoMapa.findUnique({ where: { id: t.id } })).dados.situacao, 'cancelado');
      }
      assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B)], [10, 0]);
      await verificar(c);
    }
  });

  test('duas exclusões simultâneas (chaves diferentes): uma 200, a outra 409 EXCLUSAO_JA_REALIZADA; um único estorno', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const rs = await Promise.all([excluir(c, t.id), excluir(c, t.id)]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409], rs.map((r) => r.body).join(' | '));
    assert.equal(rs.find((r) => r.statusCode === 409).json().code, 'EXCLUSAO_JA_REALIZADA');
    assert.equal(await saldo(c, c.lote, c.A), 10, 'estorno único');
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: c.cliente.id, acao: 'exclusao_definitiva' } }), 1);
    await verificar(c);
  });

  test('retry com a MESMA operation_id (resposta perdida) → replay idêntico, sem segundo estorno; mesma chave com outro motivo → 409 IDEMPOTENCY_CONFLICT', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const corpo = { operation_id: opId(), motivo: 'lançado errado' };
    const [r1, r2] = await Promise.all([excluir(c, t.id, c.tok, corpo), excluir(c, t.id, c.tok, corpo)]);
    const status = [r1.statusCode, r2.statusCode].sort();
    assert.ok(status[0] === 200 && [200, 409].includes(status[1]), `${r1.body} | ${r2.body}`);
    const depois = await foto(c);
    const r3 = await ok(excluir(c, t.id, c.tok, corpo), 200);
    assert.equal(r3.replay, true);
    assert.equal(r3.movimentacao_id, t.id);
    assert.deepEqual(await foto(c), depois, 'replay não grava');
    await exigirNadaMuda(c, () => excluir(c, t.id, c.tok, { ...corpo, motivo: 'outro motivo' }), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await saldo(c, c.lote, c.A), 10);
  });
});

// ═══ (e) falha injetada → rollback total ═══════════════════════════════════

describe('EX-E — falha injetada → ROLLBACK total', () => {
  for (const passo of ['exclusao_apos_reversao', 'exclusao_apos_delete']) {
    test(`falha em ${passo} → 500 e nada muda (movimento, evento, partidas, pesos, posições, auditoria, operações)`, async () => {
      const c = await cenario();
      const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
      const antes = await foto(c);
      definirFalhaInjetadaLedger(passo);
      const r = await excluir(c, t.id);
      definirFalhaInjetadaLedger(null);
      assert.equal(r.statusCode, 500, r.body);
      assert.deepEqual(await foto(c), antes, 'rollback total');
      await ok(excluir(c, t.id), 200);
      assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B)], [10, 0]);
    });
  }
});

// ═══ (f) replay do comando ORIGINAL não ressuscita ═════════════════════════

describe('EX-F — idempotência: replay do comando original não ressuscita', () => {
  test('reenvio exato da transferência original (fila antiga/timeout) → 409 IDEMPOTENCY_EFEITO_EXCLUIDO; nada recriado', async () => {
    const c = await cenario();
    const corpo = { operation_id: opId(), tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: c.posA.id, quantidade_animais: 3, area_destino_id: c.B.id, data_movimentacao: '2026-10-10' };
    const t = (await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, corpo))).movimentacao;
    await ok(excluir(c, t.id), 200);
    const op = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: c.cliente.id, operation_key: corpo.operation_id } });
    assert.equal(op.status, 'excluido', 'marcador estável de operação eliminada (recibo não apagado)');
    await exigirNadaMuda(c, () => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, corpo), 409, 'IDEMPOTENCY_EFEITO_EXCLUIDO');
    assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B)], [10, 0]);
    // Nova operação (chave nova) é aceita normalmente.
    await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { ...corpo, operation_id: opId() }));
    assert.equal(await saldo(c, c.lote, c.B), 3);
  });
});

// ═══ (g) autorização, tenant, contrato ═════════════════════════════════════

describe('EX-G — comum, outro tenant, sem token, corpo com delta → recusados sem gravar', () => {
  test('comum 403; tenant B 404 (comando e elegibilidade); sem token 401; delta/saldo/cliente_id no corpo 400; admin revogado 403', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const outro = await cenario();
    await exigirNadaMuda(c, () => excluir(c, t.id, c.tokComum), 403, 'TENANT_ADMIN_REQUIRED');
    await exigirNadaMuda(c, () => excluir(c, t.id, outro.tok), 404, 'MOVIMENTACAOMAPA_NOT_FOUND');
    assert.equal((await req('GET', `/movimentacoes-mapa/${t.id}/elegibilidade-exclusao`, outro.tok)).statusCode, 404);
    await exigirNadaMuda(c, () => req('POST', `/movimentacoes-mapa/${t.id}/exclusao`, null, { operation_id: opId(), motivo: 'x x x' }), 401);
    for (const extra of [{ delta: 3 }, { quantidade_cabecas: 10 }, { saldo: 10 }, { cliente_id: outro.cliente.id }, { empresa_id: outro.empresa.id }]) {
      await exigirNadaMuda(c, () => excluir(c, t.id, c.tok, { operation_id: opId(), motivo: 'ok ok', ...extra }), 400);
    }
    await exigirNadaMuda(c, () => excluir(c, t.id, c.tok, { operation_id: opId() }), 400);
    const e = await elegibilidade(c, t.id, c.tokComum);
    assert.deepEqual([e.elegivel, e.pode_excluir], [true, false], JSON.stringify(e));
    await prisma().usuario.updateMany({ where: { cliente_id: c.cliente.id, papel_tenant: 'administrador' }, data: { papel_tenant: 'usuario' } });
    await exigirNadaMuda(c, () => excluir(c, t.id), 403, 'TENANT_ADMIN_REQUIRED');
    // DELETE/PATCH genéricos seguem recusados (não viram atalho da exclusão).
    assert.equal((await req('DELETE', `/movimentacoes-mapa/${t.id}`, outro.tok)).statusCode, 404);
    assert.equal(await prisma().movimentacaoMapa.count({ where: { id: t.id } }), 1);
  });
});

// ═══ (h) proveniência/FK inconsistente, legado, cancelado ══════════════════

describe('EX-H — proveniência inconsistente, legado e já cancelado → bloqueio sem gravar', () => {
  test('evento adulterado/forjado → CANCELAMENTO_EFEITO_NAO_COMPROVADO; operação de origem não confirmada → idem', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const original = await prisma().movimentacaoMapa.findUnique({ where: { id: t.id } });
    const forjado = await prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { ...original.dados } } });
    await exigirNadaMuda(c, () => excluir(c, forjado.id), 409, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    await prisma().movimentacaoMapa.delete({ where: { id: forjado.id } });
    const ev = await prisma().eventoRebanho.findUnique({ where: { id: original.dados.efeito_servidor.evento_id } });
    await prisma().operacaoIdempotente.updateMany({ where: { cliente_id: c.cliente.id, operation_key: ev.operation_id }, data: { status: 'processing' } });
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
  });

  test('movimento legado (sem evento do ledger) → EXCLUSAO_MOVIMENTO_LEGADO; já cancelado → EXCLUSAO_MOVIMENTO_CANCELADO (sem limpeza retroativa)', async () => {
    const c = await cenario();
    const legado = await prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Transferência de Área', lote_id: c.lote.id, quantidade_animais: 2, data_movimentacao: '2026-09-28' } } });
    await exigirNadaMuda(c, () => excluir(c, legado.id), 409, 'EXCLUSAO_MOVIMENTO_LEGADO');
    assert.equal((await elegibilidade(c, legado.id)).codigo, 'EXCLUSAO_MOVIMENTO_LEGADO');
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    await ok(cancelar(c, t.id), 200);
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'EXCLUSAO_MOVIMENTO_CANCELADO');
    assert.equal((await elegibilidade(c, t.id)).codigo, 'EXCLUSAO_MOVIMENTO_CANCELADO');
  });
});

// ═══ Cobertura de todos os manejos do ledger ═══════════════════════════════

describe('EX-T — cada manejo: excluir devolve a projeção exata de antes; Lote intacto; nada do fato sobra', () => {
  const montar = async () => {
    const c = await base();
    c.l1 = await entrada(c, { nome: 'L1', qtd: 40, peso: 400 });
    c.l2 = await entrada(c, { nome: 'L2', qtd: 30, peso: 380 });
    c.vacas = await entrada(c, { nome: 'VACAS', qtd: 10, categoria: VACA, sexo: 'Fêmea', peso: 450 });
    c.garrotes = await entrada(c, { nome: 'GARROTES', qtd: 20, categoria: GARROTE, peso: 300 });
    await ativar(c);
    c.p1 = await posDe(c, c.l1, c.A);
    c.p2 = await posDe(c, c.l2, c.A);
    return c;
  };
  const casos = {
    Morte: (c) => baixa(c, 'Morte', [{ categoria: BOI, quantidade: 5, causa_morte: 'Doença' }]),
    Abate: (c) => baixa(c, 'Abate', [{ categoria: BOI, quantidade: 4, destino: 'Consumo Próprio' }]),
    'Morte (manejo-lote)': (c) => manejoLote(c, { tipo: 'Morte', lote_id: c.p1.id, quantidade_animais: 2, data_movimentacao: '2026-10-20' }),
    Nascimento: (c) => rebanho(c, 'Nascimento', [{ sexo: 'Macho', categoria_mae: VACA, quantidade: 3, peso_medio_kg: 35 }]),
    Pesagem: (c) => rebanho(c, 'Pesagem', [{ lote_id: c.p1.id, peso_medio_kg: 455 }]),
    'Mudança de Categoria': (c) => rebanho(c, 'Mudança de Categoria', [{ categoria_atual: GARROTE, categoria_nova: BOI, quantidade: 5 }]),
    Junção: (c) => juntar(c, c.p1, [c.p2]),
    'Transferência parcial retroativa': (c) => transferencia(c, c.p1, 7, c.B, '2026-10-05'),
  };
  for (const [nome, fazer] of Object.entries(casos)) {
    test(`${nome}`, async () => {
      const c = await montar();
      const lotesAntes = await lotesFixos(c);
      const antes = await posicoes(c);
      const m = (await ok(fazer(c))).movimentacao;
      const eventoId = await eventoDe(m.id);
      assert.notDeepEqual(await posicoes(c), antes, 'o manejo mudou a projeção');
      const e = await elegibilidade(c, m.id);
      assert.equal(e.elegivel, true, JSON.stringify(e));
      await ok(excluir(c, m.id), 200);
      assert.deepEqual(await posicoes(c), antes, 'projeção exata de antes (cabeças, peso, linhagem; posições criadas removidas)');
      assert.deepEqual(await lotesFixos(c), lotesAntes, 'Lote intacto');
      await exigirFatoApagado(c, m.id, eventoId);
      assert.deepEqual(await historico(c, [c.l1.id, c.l2.id, c.vacas.id, c.garrotes.id]), []);
      await verificar(c);
    });
  }
});

// ═══ PR178-R2 — recibo idempotente EXATO (mesma chave, tipos diferentes) ═══

describe('EX-R2 — recibo de origem exato por (cliente, chave, tipo)', () => {
  const morteCom = (c, operation_id) =>
    req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, { operation_id, tipo: 'Morte', empresa_id: c.empresa.id, lote_id: c.posA.id, quantidade_animais: 1, data_movimentacao: '2026-10-05' });
  const recibos = async (c, chave) => (await prisma().operacaoIdempotente.findMany({ where: { cliente_id: c.cliente.id, operation_key: chave }, orderBy: { createdAt: 'asc' } })).map((o) => [o.tipo_operacao, o.status]);

  test('constantes: os tipos de origem do ledger são exatamente os dos comandos', async () => {
    const { TIPOS_OPERACAO_ORIGEM_LEDGER, TIPO_OPERACAO_TRANSFERENCIA } = await import('../src/modules/rebanhoLedger/rebanhoLedgerService.js');
    const { TIPO_OPERACAO_MANEJO } = await import('../src/modules/movimentacoesMapa/manejoMapaComandoService.js');
    const { TIPO_OPERACAO_REBANHO } = await import('../src/modules/movimentacoesMapa/manejoRebanhoComandoService.js');
    const { TIPO_OPERACAO_JUNCAO } = await import('../src/modules/movimentacoesMapa/juncaoConstantes.js');
    const { TIPO_OPERACAO_BAIXA } = await import('../src/modules/movimentacoesMapa/baixaConstantes.js');
    assert.deepEqual([...TIPOS_OPERACAO_ORIGEM_LEDGER].sort(), [TIPO_OPERACAO_TRANSFERENCIA, TIPO_OPERACAO_MANEJO, TIPO_OPERACAO_REBANHO, TIPO_OPERACAO_JUNCAO, TIPO_OPERACAO_BAIXA].sort());
  });

  test('mesma operation_key em DOIS tipos (o homônimo gravado ANTES): excluir marca só o recibo de origem; o outro segue committed e com replay', async () => {
    const c = await cenario();
    const K = opId();
    // 1º: um cancelamento real com a chave K (recibo cancelamento_movimentacao_mapa, gravado primeiro).
    const m = (await ok(morteCom(c, opId()))).movimentacao;
    const corpoCancel = { operation_id: K, motivo: 'chave homônima' };
    await ok(req('POST', `/movimentacoes-mapa/${m.id}/cancelamento`, c.tok, corpoCancel), 200);
    // 2º: a transferência com a MESMA chave K (recibo manejo_mapa_lote).
    const corpoT = { operation_id: K, tipo: 'Transferência de Área', empresa_id: c.empresa.id, lote_id: c.posA.id, quantidade_animais: 3, area_destino_id: c.B.id, data_movimentacao: '2026-10-10' };
    const t = (await ok(req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, corpoT))).movimentacao;
    assert.deepEqual(await recibos(c, K), [['cancelamento_movimentacao_mapa', 'committed'], ['manejo_mapa_lote', 'committed']]);

    await ok(excluir(c, t.id), 200);
    assert.deepEqual(await recibos(c, K), [['cancelamento_movimentacao_mapa', 'committed'], ['manejo_mapa_lote', 'excluido']], 'só o recibo de origem muda');
    const replayCancel = await ok(req('POST', `/movimentacoes-mapa/${m.id}/cancelamento`, c.tok, corpoCancel), 200);
    assert.equal(replayCancel.replay, true, 'o homônimo de outro tipo continua com replay');
    await exigirNadaMuda(c, () => req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tok, corpoT), 409, 'IDEMPOTENCY_EFEITO_EXCLUIDO');
    assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B)], [10, 0]);
    await verificar(c);
  });

  test('proveniência ausente (recibo não cita o evento/movimento) ou ambígua (dois recibos citam) → 409, zero escrita', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const ev = await prisma().eventoRebanho.findUnique({ where: { id: await eventoDe(t.id) } });
    const original = await prisma().operacaoIdempotente.findFirst({ where: { cliente_id: c.cliente.id, operation_key: ev.operation_id, tipo_operacao: 'manejo_mapa_lote' } });
    // Ambígua: um segundo recibo committed, de outro tipo de origem, citando o mesmo fato.
    const forjado = await prisma().operacaoIdempotente.create({ data: { cliente_id: c.cliente.id, operation_key: ev.operation_id, tipo_operacao: 'manejo_mapa_rebanho', fingerprint: 'x', status: 'committed', http_status: 201, response_json: original.response_json } });
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    assert.equal((await elegibilidade(c, t.id)).codigo, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    await prisma().operacaoIdempotente.delete({ where: { id: forjado.id } });
    // Ausente: o único recibo não cita este evento.
    await prisma().operacaoIdempotente.update({ where: { id: original.id }, data: { response_json: { ...original.response_json, evento: { id: 'outro-evento' } } } });
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'CANCELAMENTO_EFEITO_NAO_COMPROVADO');
    await prisma().operacaoIdempotente.update({ where: { id: original.id }, data: { response_json: original.response_json } });
    await ok(excluir(c, t.id), 200);
  });

  test('elegibilidade repetida (elegível e recusada) não persiste nada: recibos, auditoria, posições, eventos', async () => {
    const c = await cenario();
    const t = (await ok(transferencia(c, c.posA, 3, c.B))).movimentacao;
    const antes = await foto(c);
    for (let i = 0; i < 3; i += 1) assert.equal((await elegibilidade(c, t.id)).elegivel, true);
    assert.deepEqual(await foto(c), antes);
    await ok(manejoLote(c, { tipo: 'Morte', lote_id: (await posDe(c, c.lote, c.B)).id, quantidade_animais: 1, data_movimentacao: '2026-10-12' }));
    const antes2 = await foto(c);
    for (let i = 0; i < 3; i += 1) assert.equal((await elegibilidade(c, t.id)).elegivel, false);
    assert.deepEqual(await foto(c), antes2);
  });
});

// ═══ MAIKE-POS178-UX — pré-validação: o GET de elegibilidade é a fonte do card ═══

describe('EX-UX — elegibilidade da transferência × pesagem posterior (cenário de aceite, sintético)', () => {
  test('50 de A→B e pesagem posterior em B (320→350): GET recusa a transferência e permite a pesagem; excluída a pesagem, a transferência fica elegível; POST revalida', async () => {
    const c = await base();
    c.lote = await entrada(c, { nome: 'KM', qtd: 80, peso: 320 });
    await ativar(c);
    const posA = await posDe(c, c.lote, c.A);
    const t = (await ok(transferencia(c, posA, 50, c.B, '2026-10-10'))).movimentacao;
    const posB = await posDe(c, c.lote, c.B);
    const pes = (await ok(rebanho(c, 'Pesagem', [{ lote_id: posB.id, peso_medio_kg: 350 }], { area_id: c.B.id, data_movimentacao: '2026-10-15' }))).movimentacao;

    const antes = await foto(c);
    const eT = await elegibilidade(c, t.id);
    assert.deepEqual([eT.elegivel, eT.codigo, eT.pode_excluir], [false, 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO', true], JSON.stringify(eT));
    assert.deepEqual([eT.detalhes.tipo, eT.detalhes.data, eT.detalhes.area_id], ['PESAGEM', '2026-10-15', c.B.id], 'card mostra tipo, data e área do bloqueador');
    const eP = await elegibilidade(c, pes.id);
    assert.deepEqual([eP.elegivel, eP.pode_excluir], [true, true], JSON.stringify(eP));
    assert.deepEqual(await foto(c), antes, 'GETs não gravam nada');
    // O POST revalida na transação (não confia no card).
    await exigirNadaMuda(c, () => excluir(c, t.id), 409, 'REBANHO_DEPENDENCIA_FATO_SEM_SALDO');

    await ok(excluir(c, pes.id), 200);
    assert.equal(Number((await posDe(c, c.lote, c.B)).peso_medio_kg), 320, 'peso volta ao derivado da transferência');
    const eT2 = await elegibilidade(c, t.id);
    assert.deepEqual([eT2.elegivel, eT2.codigo], [true, null], JSON.stringify(eT2));
    await ok(excluir(c, t.id), 200);
    assert.deepEqual([await saldo(c, c.lote, c.A), await saldo(c, c.lote, c.B)], [80, 0]);
    await verificar(c);
  });
});

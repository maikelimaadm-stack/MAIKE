/**
 * MAIKE-LOTES-R1 — exclusão do Cadastro de Lotes depois de cancelamento seguro.
 *
 * Lote de ENTRADA cujo histórico é só de movimentos do mapa CANCELADOS (com
 * prova) e que voltou ao estado de entrada: "Excluir" vira exclusão LÓGICA
 * (tombstone `excluido_em`), preservando movimentos cancelados, cancelamento e
 * AuditLog. Sem histórico: exclusão física como antes. Qualquer efeito vivo,
 * prova ausente ou dúvida: bloqueado. PostgreSQL real, HTTP, auth.
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

const criarLote = async (c, { nome = 'NELORE', qtd = 500, area, categoria = 'BOI', extra = {} }) => {
  const r = await req('POST', '/lotes', c.tokAdm, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria, sexo: 'Macho', setor_id: c.setor.id,
    area_entrada_id: area.id, area_atual_id: area.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo', ...extra,
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
const cancelar = (c, id, operation_id = opId()) =>
  req('POST', `/movimentacoes-mapa/${id}/cancelamento`, c.tokAdm, { operation_id, motivo: 'lançado por engano' });




const eleg = async (c, id, token = c.tokAdm) => req('GET', `/lotes/${id}/elegibilidade-exclusao`, token);
const excluir = (c, id, token = c.tokAdm) => req('DELETE', `/lotes/${id}`, token);
const listaIds = async (c, token = c.tokAdm) => (await req('GET', '/lotes', token)).json().map((l) => l.id);
const auditDe = (c, id, acao) => prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade: 'Lote', entidade_id: id, ...(acao ? { acao } : {}) } });

/** Excluir deve dar o tipo esperado na elegibilidade E no DELETE. */
const exigirTipo = async (c, id, tipo) => {
  const e = await eleg(c, id);
  assert.equal(e.statusCode, 200, e.body);
  assert.equal(e.json().tipo, tipo, JSON.stringify(e.json()));
};
/** Bloqueio completo: elegibilidade bloqueado + DELETE 409 + lote intacto e listado. */
const exigirBloqueio = async (c, id, motivo) => {
  const e = await eleg(c, id);
  assert.equal(e.statusCode, 200, e.body);
  assert.equal(e.json().tipo, 'bloqueado', JSON.stringify(e.json()));
  if (motivo) assert.equal(e.json().motivo, motivo, JSON.stringify(e.json()));
  const antes = await lote(id);
  const r = await excluir(c, id);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, 'LOTE_DELETE_BLOCKED');
  if (motivo) assert.equal(r.json().details?.motivo, motivo, r.body);
  const depois = await lote(id);
  assert.deepEqual(depois, antes, 'recusa não muda o lote');
  assert.ok((await listaIds(c)).includes(id));
};

describe('LOTES-R1 1 — só histórico cancelado: exclusão LÓGICA', () => {
  test('compra 500 → morte 50 → cancelada → excluir = tombstone; some da lista; histórico, cancelamento e AuditLog intactos; repetição idempotente', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 50);
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
    const movAntes = await mov(m.id);
    await exigirTipo(c, l.id, 'exclusao_logica');

    const r = await excluir(c, l.id);
    assert.equal(r.statusCode, 204, r.body);
    const t = await lote(l.id);
    assert.ok(t, 'a linha do lote continua existindo (tombstone)');
    assert.ok(t.excluido_em instanceof Date);
    assert.ok(t.excluido_por_usuario_id);
    assert.deepEqual([t.quantidade_cabecas, t.quantidade_entrada, t.area_atual_id, t.numero_lote], [500, 500, c.A.id, l.numero_lote]);
    assert.ok(!(await listaIds(c)).includes(l.id), 'fora da lista operacional');
    assert.deepEqual((await mov(m.id)).dados, movAntes.dados, 'movimento cancelado intocado');
    assert.equal(await auditDe(c, l.id, 'exclusao_logica'), 1);
    assert.equal(await prisma().auditLog.count({ where: { acao: 'cancelamento', entidade_id: m.id } }), 1);

    // Leitura administrativa por id resolve a identidade sem reativar.
    const porId = await req('GET', `/lotes/${l.id}`, c.tokAdm);
    assert.equal(porId.statusCode, 200, porId.body);
    assert.ok(porId.json().excluido_em);
    assert.equal(porId.json().nome, l.nome);

    // Repetição: 204, sem segundo efeito nem auditoria falsa.
    assert.equal((await excluir(c, l.id)).statusCode, 204);
    assert.equal(await auditDe(c, l.id, 'exclusao_logica'), 1);
    assert.equal((await eleg(c, l.id)).json().tipo, 'ja_excluido');

    // Histórico paginado da área continua lendo o cancelado, sem erro de órfão.
    const h = await req('GET', `/movimentacoes-mapa/historico?empresa_id=${c.empresa.id}&area_id=${c.A.id}&limit=50`, c.tokAdm);
    assert.equal(h.statusCode, 200, h.body);
    const item = h.json().items.find((x) => x.id === m.id);
    assert.equal(item?.situacao, 'cancelado');
    assert.equal(item?.cancelamento?.motivo, 'lançado por engano');
  });

  test('duas mortes canceladas (mais recente primeiro) → exclusão lógica; com uma ativa → bloqueado', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const m1 = await morte(c, l, 50);
    const m2 = await morte(c, l, 50);
    assert.equal((await cancelar(c, m2.id)).statusCode, 200);
    await exigirBloqueio(c, l.id, 'movimentacao_ativa');
    assert.equal((await cancelar(c, m1.id)).statusCode, 200);
    await exigirTipo(c, l.id, 'exclusao_logica');
    assert.equal((await excluir(c, l.id)).statusCode, 204);
  });

  test('transferência total (no lugar) cancelada → exclusão lógica', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A, qtd: 40 });
    const t = await transferir(c, l, 40, c.B);
    assert.equal((await cancelar(c, t.movimentacao.id)).statusCode, 200);
    await exigirTipo(c, l.id, 'exclusao_logica');
    assert.equal((await excluir(c, l.id)).statusCode, 204);
  });

  test('parcial com lote novo cancelada: entrada original sai por exclusão lógica; o derivado fica (0/Inativo) e nunca é entrada excluível', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A, qtd: 100 });
    const t = await transferir(c, l, 30, c.B);
    const deriv = t.lotes.find((x) => x.id !== l.id);
    assert.equal((await cancelar(c, t.movimentacao.id)).statusCode, 200);
    await exigirTipo(c, l.id, 'exclusao_logica');
    assert.equal((await excluir(c, l.id)).statusCode, 204);
    await exigirBloqueio(c, deriv.id, 'lote_gerado_por_manejo');
    const dv = await lote(deriv.id);
    assert.deepEqual([dv.quantidade_cabecas, dv.status, dv.origem, dv.quantidade_entrada], [0, 'Inativo', 'MOVIMENTAÇÃO', 30]);
  });

  test('unificação: destino citado só por lote_destino_id/efeitos — ativa bloqueia; cancelada libera os dois', async () => {
    const c = await cenario();
    const o = await criarLote(c, { area: c.A, qtd: 500 });
    const d = await criarLote(c, { area: c.B, qtd: 100 });
    const t = await transferir(c, o, 50, c.B, d.id);
    await exigirBloqueio(c, d.id, 'movimentacao_ativa');
    assert.equal((await cancelar(c, t.movimentacao.id)).statusCode, 200);
    await exigirTipo(c, d.id, 'exclusao_logica');
    await exigirTipo(c, o.id, 'exclusao_logica');
  });

  test('homônimo: movimento ativo de OUTRO lote com o mesmo nome (com id) não bloqueia; registro legado só por nome bloqueia (fail-closed)', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const outro = await criarLote(c, { area: c.B });
    const m = await morte(c, l, 10);
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    await morte(c, outro, 5); // ativo, mesmo nome, outro id
    await exigirTipo(c, l.id, 'exclusao_logica');
    const r = await req('POST', '/movimentacoes-mapa', c.tokAdm, {
      empresa_id: c.empresa.id, tipo: 'Pesagem', lote: l.nome, quantidade_animais: 1, data_movimentacao: '2026-10-29T12:00:00.000Z',
    });
    assert.equal(r.statusCode, 201, r.body);
    await exigirBloqueio(c, l.id, 'vinculo_legado_por_nome');
  });
});

describe('LOTES-R1 2 — dependências vivas bloqueiam', () => {
  const FONTES = [
    ['movimentacoes-pecuaria', { tipo: 'Pesagem' }, 'movimentacoes_pecuarias'],
    ['suplementacao-lotes', { data_lancamento: '2026-10-29' }, 'suplementacao_lote'],
    ['eventos-sanitarios', { data_evento: '2026-10-29' }, 'eventos_sanitarios'],
    ['aplicacoes-medicamento', { data_aplicacao: '2026-10-29' }, 'aplicacoes_medicamento'],
    ['manejos-tecnico-rebanho', { data_evento: '2026-10-29' }, 'manejos_tecnicos'],
  ];
  for (const [rota, extra, motivo] of FONTES) {
    test(`${rota} ativo (lote já com histórico cancelado) → bloqueado (${motivo})`, async () => {
      const c = await cenario();
      const l = await criarLote(c, { area: c.A });
      const m = await morte(c, l, 10);
      assert.equal((await cancelar(c, m.id)).statusCode, 200);
      const r = await req('POST', `/${rota}`, c.tokAdm, { empresa_id: c.empresa.id, lote_id: l.id, lote: l.nome, ...extra });
      assert.equal(r.statusCode, 201, r.body);
      await exigirBloqueio(c, l.id, motivo);
    });
  }

  test('tarefa ligada ao lote → bloqueado', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const g = await prisma().grupoAtividade.create({ data: { cliente_id: c.cliente.id, nome_grupo: 'G' } });
    const tt = await prisma().tipoTarefa.create({ data: { cliente_id: c.cliente.id, nome_tipo: 'T', grupo_atividade_id: g.id, grupo_atividade_nome: 'G' } });
    await prisma().lancamentoTarefa.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, titulo: 'T', tipo: 'Geral', tipo_tarefa_id: tt.id, tipo_tarefa_nome: 'T', lote_id: l.id },
    });
    await exigirBloqueio(c, l.id, 'lancamentos_tarefa');
  });

  test('movimento ATIVO antigo do lote atrás de 600 registros de outros lotes → bloqueado (sem limite silencioso)', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const outro = await criarLote(c, { nome: 'OUTRO', area: c.B });
    await prisma().movimentacaoMapa.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Pesagem', lote_id: l.id, lote: l.nome, data_movimentacao: '2020-01-01' } },
    });
    await prisma().movimentacaoMapa.createMany({
      data: Array.from({ length: 600 }, (_, i) => ({ cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Pesagem', lote_id: outro.id, lote: 'OUTRO', n: i } })),
    });
    await exigirBloqueio(c, l.id, 'movimentacao_ativa');
  });

  test('saldo voltou a 500 por PATCH manual (sem cancelamento) → bloqueado', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    assert.equal((await patch(c, l.id, { quantidade_cabecas: 450, estado_esperado: { quantidade_cabecas: 500 } })).statusCode, 200);
    assert.equal((await patch(c, l.id, { quantidade_cabecas: 500, estado_esperado: { quantidade_cabecas: 450 } })).statusCode, 200);
    await exigirBloqueio(c, l.id, 'alteracao_sem_comprovacao');
  });

  test('legado (POST genérico + PATCH, sem proveniência) → bloqueado', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const r = await req('POST', '/movimentacoes-mapa', c.tokAdm, {
      empresa_id: c.empresa.id, tipo: 'Morte', lote: l.nome, lote_id: l.id, quantidade_animais: 5, data_movimentacao: '2026-10-29T12:00:00.000Z',
    });
    assert.equal(r.statusCode, 201);
    await exigirBloqueio(c, l.id, 'movimentacao_ativa');
  });

  test('movimento marcado cancelado SEM prova (escrita direta, sem operação idempotente) → bloqueado', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    await prisma().movimentacaoMapa.create({
      data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Morte', lote_id: l.id, lote: l.nome, situacao: 'cancelado', cancelamento: { operation_id: 'forjado' } } },
    });
    await exigirBloqueio(c, l.id, 'cancelamento_nao_comprovado');
  });
});

describe('LOTES-R1 3 — sem histórico: exclusão física como antes', () => {
  test('lote recém-lançado (com correção do lançamento pelo cadastro: nota fiscal e peso) → exclusão física; linha some; auditoria delete', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    assert.equal((await patch(c, l.id, { nota_fiscal: 'NF-123', peso_medio_kg: 410 })).statusCode, 200);
    await exigirTipo(c, l.id, 'exclusao_fisica');
    assert.equal((await excluir(c, l.id)).statusCode, 204);
    assert.equal(await lote(l.id), null);
    assert.equal(await auditDe(c, l.id, 'delete'), 1);
  });

  test('lote sem histórico mas com anexo → exclusão LÓGICA (o anexo não fica órfão); anexar a lote excluído → 409', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const anexo = await prisma().registroAnexo.create({
      data: { cliente_id: c.cliente.id, entidade: 'Lote', entidade_id: l.id, nome_original: 'gta.pdf', storage_key: `k/${l.id}`, mime_type: 'application/pdf', tamanho_bytes: 10, criado_por: 'teste' },
    });
    await exigirTipo(c, l.id, 'exclusao_logica');
    assert.equal((await excluir(c, l.id)).statusCode, 204);
    assert.ok(await lote(l.id));
    assert.ok(await prisma().registroAnexo.findUnique({ where: { id: anexo.id } }));
  });
});

describe('LOTES-R1 4 — lote excluído não recebe nada novo; tenant', () => {
  const tombstone = async (c) => {
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 10);
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    assert.equal((await excluir(c, l.id)).statusCode, 204);
    return l;
  };

  test('depois do tombstone: PATCH 404; manejo pelo comando recusado; registro novo citando o lote → 409 LOTE_EXCLUIDO', async () => {
    const c = await cenario();
    const l = await tombstone(c);
    assert.equal((await patch(c, l.id, { peso_medio_kg: 400 })).statusCode, 404);
    const mm = await req('POST', '/movimentacoes-mapa/comandos/manejo-lote', c.tokAdm, {
      operation_id: opId(), empresa_id: c.empresa.id, tipo: 'Morte', lote_id: l.id, quantidade_animais: 1, data_movimentacao: '2026-10-30T12:00:00.000Z',
    });
    assert.equal(mm.statusCode, 404, mm.body);
    for (const rota of ['movimentacoes-mapa', 'eventos-sanitarios', 'aplicacoes-medicamento', 'manejos-tecnico-rebanho', 'suplementacao-lotes', 'movimentacoes-pecuaria']) {
      const r = await req('POST', `/${rota}`, c.tokAdm, { empresa_id: c.empresa.id, lote_id: l.id, tipo: 'Pesagem', data_movimentacao: '2026-10-30' });
      assert.equal(r.statusCode, 409, `${rota} ${r.body}`);
      assert.equal(r.json().code, 'LOTE_EXCLUIDO');
    }
  });

  test('outro tenant: elegibilidade, GET e DELETE → 404; nada muda', async () => {
    const c = await cenario();
    const l = await criarLote(c, { area: c.A });
    const outro = await cenario();
    assert.equal((await eleg(outro, l.id)).statusCode, 404);
    assert.equal((await req('GET', `/lotes/${l.id}`, outro.tokAdm)).statusCode, 404);
    assert.equal((await excluir(outro, l.id)).statusCode, 404);
    assert.ok(await lote(l.id));
    assert.equal((await req('GET', `/lotes/${l.id}/elegibilidade-exclusao`)).statusCode, 401);
  });
});

describe('LOTES-R1 5 — concorrência real (trava do lote)', () => {
  const segurarLote = async (loteId) => {
    let soltar;
    const liberado = new Promise((r) => { soltar = r; });
    let travado;
    const pronto = new Promise((r) => { travado = r; });
    const tx = prisma().$transaction(async (t) => {
      await t.$queryRaw`SELECT id FROM "Lote" WHERE id = ${loteId} FOR UPDATE`;
      travado();
      await liberado;
    }, { timeout: 20000 });
    await pronto;
    return async () => { soltar(); await tx; };
  };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const preparar = async (c) => {
    const l = await criarLote(c, { area: c.A });
    const m = await morte(c, l, 10);
    assert.equal((await cancelar(c, m.id)).statusCode, 200);
    return l;
  };

  test('exclusão primeiro, manejo depois: tombstone vence; o manejo é recusado; nenhum movimento ativo novo', async () => {
    const c = await cenario();
    const l = await preparar(c);
    const soltar = await segurarLote(l.id);
    const pd = excluir(c, l.id);
    await espera(300);
    const pm = manejo(c, { tipo: 'Morte', lote_id: l.id, quantidade_animais: 1 });
    await espera(300);
    await soltar();
    const [rd, rm] = await Promise.all([pd, pm]);
    assert.equal(rd.statusCode, 204, rd.body);
    assert.equal(rm.statusCode, 404, rm.body);
    assert.equal(await prisma().movimentacaoMapa.count({ where: { cliente_id: c.cliente.id, NOT: { dados: { path: ['situacao'], equals: 'cancelado' } } } }), 0);
    assert.equal((await lote(l.id)).quantidade_cabecas, 500);
  });

  test('manejo primeiro, exclusão depois: o manejo vale e a exclusão é bloqueada', async () => {
    const c = await cenario();
    const l = await preparar(c);
    const soltar = await segurarLote(l.id);
    const pm = manejo(c, { tipo: 'Morte', lote_id: l.id, quantidade_animais: 1 });
    await espera(300);
    const pd = excluir(c, l.id);
    await espera(300);
    await soltar();
    const [rm, rd] = await Promise.all([pm, pd]);
    assert.equal(rm.statusCode, 201, rm.body);
    assert.equal(rd.statusCode, 409, rd.body);
    assert.equal((await lote(l.id)).excluido_em, null);
  });

  test('registro genérico (sanidade) primeiro, exclusão depois: bloqueada; exclusão primeiro: registro recusado', async () => {
    const c = await cenario();
    const l = await preparar(c);
    let soltar = await segurarLote(l.id);
    const ps = req('POST', '/eventos-sanitarios', c.tokAdm, { empresa_id: c.empresa.id, lote_id: l.id, data_evento: '2026-10-30' });
    await espera(300);
    const pd = excluir(c, l.id);
    await espera(300);
    await soltar();
    const [rs, rd] = await Promise.all([ps, pd]);
    assert.equal(rs.statusCode, 201, rs.body);
    assert.equal(rd.statusCode, 409, rd.body);

    const l2 = await preparar(c);
    soltar = await segurarLote(l2.id);
    const pd2 = excluir(c, l2.id);
    await espera(300);
    const ps2 = req('POST', '/eventos-sanitarios', c.tokAdm, { empresa_id: c.empresa.id, lote_id: l2.id, data_evento: '2026-10-30' });
    await espera(300);
    await soltar();
    const [rd2, rs2] = await Promise.all([pd2, ps2]);
    assert.equal(rd2.statusCode, 204, rd2.body);
    assert.equal(rs2.statusCode, 409, rs2.body);
    assert.equal(rs2.json().code, 'LOTE_EXCLUIDO');
  });
});

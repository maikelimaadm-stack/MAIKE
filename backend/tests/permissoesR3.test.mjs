/**
 * PR #199 / R3 — desvio de privilégio por `porQualquer` em rotas genéricas.
 * PostgreSQL descartável, HTTP autenticado, prova por persistência (tabelas do
 * tenant, AuditLog e ledger), não só por status.
 *
 *  R3-SUP  "mover lotes" NÃO é "lançar suplementação": POST/bulk livres de
 *          suplementação exigem `lancar_suplementacao`. Com "mover", o PATCH só
 *          vale como FECHAMENTO do período (campos do fechamento, registro ainda
 *          aberto — conferido no banco).
 *  R3-SOB  sobras após a transferência: sem `lancar_suplementacao` não gravam
 *          (fail-closed; a transferência continua gravada e o cliente avisa).
 *  R3-POR  demais `porQualquer` de tela cruzada: só os campos do fluxo cruzado.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

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
const acoes = (v) => ({ visualizar: v, novo: v, salvar: v, editar: v, excluir: v, importar: v, exportar: v });
const linha = (modulo, tela, a) => ({ modulo_id: modulo, tela_id: tela, ...acoes(false), ...a });
const VER_MAPA = [linha('mapa', 'pec-mapa-geral', { visualizar: true })];
const SO_MOVER = { modulos_permitidos: ['mapa'], permissoes_telas: VER_MAPA, mapa_geral_permissoes: { mover_lotes: true, lancar_suplementacao: false } };
const SO_LANCAR = { modulos_permitidos: ['mapa'], permissoes_telas: VER_MAPA, mapa_geral_permissoes: { mover_lotes: false, lancar_suplementacao: true } };

const MODELOS = Prisma.dmmf.datamodel.models.filter((m) => m.fields.some((f) => f.name === 'cliente_id')).map((m) => m.name[0].toLowerCase() + m.name.slice(1));
/** Contagem de todas as tabelas do tenant + conteúdo dos registros de suplementação. */
const fotografia = async (clienteId) => {
  const p = prisma();
  const where = { cliente_id: clienteId };
  const out = [];
  for (const m of MODELOS) out.push(`${m}:${await p[m].count({ where })}`);
  out.push(JSON.stringify((await p.suplementacaoEvento.findMany({ where, orderBy: { id: 'asc' } })).map((e) => [e.id, e.dados, e.updatedAt.toISOString()])));
  out.push(JSON.stringify((await p.suplementacaoLote.findMany({ where, orderBy: { id: 'asc' } })).map((e) => [e.id, e.dados, e.updatedAt.toISOString()])));
  out.push(JSON.stringify((await p.pontoSuplementacao.findMany({ where, orderBy: { id: 'asc' } })).map((e) => [e.id, e.updatedAt.toISOString()])));
  return out.join('|');
};
const negado = async (c, tok, metodo, url, corpo) => {
  const antes = await fotografia(c.cliente.id);
  const r = await req(metodo, url, tok, corpo);
  assert.equal(r.statusCode, 403, `${metodo} ${url}: ${r.body}`);
  assert.equal(r.json().code, 'ACAO_NAO_PERMITIDA', r.body);
  assert.equal(await fotografia(c.cliente.id), antes, `${metodo} ${url}: nada gravado, nada auditado`);
};

/** Fazenda em ledger com um lote em A; um evento e um lote de suplementação ABERTOS criados pelo admin. */
const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador', semPermissao: true });
  const tokAdm = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const senhaHash = (await p.usuario.findUnique({ where: { id: adm.usuario.id } })).senha_hash;
  const login = `oper-${randomUUID().slice(0, 8)}`;
  await p.usuario.create({ data: { cliente_id: adm.cliente.id, nome: 'Operador', login, senha_hash: senhaHash, papel_tenant: 'usuario' } });
  const tokOp = (await autenticarNoApp(app, { login, senha: adm.credenciais.senha })).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, fuso_horario: 'America/Sao_Paulo', apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const area = (n, nome) => p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(n), nome, tamanho_hectares: 10 } });
  const c = { cliente: adm.cliente, tokAdm, tokOp, login, empresa, A: await area(1, 'PASTO A'), B: await area(2, 'PASTO B') };
  const at = await req('POST', '/rebanho/ativacao', tokAdm, { operation_id: opId(), empresa_id: empresa.id, data_corte: '2026-10-01' });
  assert.equal(at.statusCode, 201, at.body);
  const lote = await req('POST', '/lotes', tokAdm, { empresa_id: empresa.id, nome: 'BASE', quantidade_cabecas: 100, categoria: 'Boi 25 a 36 meses', sexo: 'Macho', setor_id: setor.id, area_entrada_id: c.A.id, area_atual_id: c.A.id, data_entrada: '2026-10-25', motivo_entrada: 'Compra', status: 'Ativo', peso_medio_kg: 300 });
  assert.equal(lote.statusCode, 201, lote.body);
  c.lote = lote.json();
  c.posicao = await p.posicaoRebanho.findFirst({ where: { cliente_id: adm.cliente.id, lote_entrada_id: c.lote.id } });
  const ev = await req('POST', '/suplementacao-eventos', tokAdm, { empresa_id: empresa.id, area_id: c.A.id, produto: 'SAL', quantidade_total_kg: 100, sobra_kg: 0, data_lancamento: '2026-10-26', dias_periodo: null });
  assert.equal(ev.statusCode, 201, ev.body);
  c.evento = ev.json();
  const ls = await req('POST', '/suplementacao-lotes', tokAdm, { empresa_id: empresa.id, suplementacao_evento_id: c.evento.id, lote_id: c.lote.id, cabecas_na_area: 100, dias_periodo: null });
  assert.equal(ls.statusCode, 201, ls.body);
  c.loteSupl = ls.json();
  c.permitir = (dados) =>
    p.permissao.upsert({
      where: { cliente_id_user_email: { cliente_id: adm.cliente.id, user_email: login } },
      create: { cliente_id: adm.cliente.id, user_email: login, user_nome: 'Operador', ...dados },
      update: dados,
    });
  return c;
};

const transferir = (c, tok) =>
  req('POST', '/rebanho/comandos/transferencia', tok, { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-01T12:00:00.000Z', itens: [{ posicao_id: c.posicao.id, quantidade: 10 }] });
const SOBRA_EVENTO = (c) => ({ empresa_id: c.empresa.id, area_id: c.B.id, produto: 'SAL', quantidade_total_kg: 0, sobra_kg: 12, data_lancamento: '2026-11-01', observacoes: 'aberto automaticamente após movimentação' });

describe('R3-SUP — só "mover lotes": suplementação livre por HTTP é negada', () => {
  test('POST evento, POST lote, bulk, PATCH arbitrário de evento e de lote → 403, nada gravado', async () => {
    const c = await cenario();
    await c.permitir(SO_MOVER);
    await negado(c, c.tokOp, 'POST', '/suplementacao-eventos', { ...SOBRA_EVENTO(c), quantidade_total_kg: 5000 });
    await negado(c, c.tokOp, 'POST', '/suplementacao-lotes', { empresa_id: c.empresa.id, suplementacao_evento_id: c.evento.id, lote_id: c.lote.id, cabecas_na_area: 999 });
    await negado(c, c.tokOp, 'POST', '/suplementacao-lotes/bulk', { registros: [{ empresa_id: c.empresa.id, suplementacao_evento_id: c.evento.id, lote_id: c.lote.id }] });
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-eventos/${c.evento.id}`, { quantidade_total_kg: 9999 }); // (o service também recusaria: 409)
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-eventos/${c.evento.id}`, { sobra_kg: 1, produto: 'OUTRO' });
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-lotes/${c.loteSupl.id}`, { cabecas_na_area: 1 });
    await negado(c, c.tokOp, 'POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', { operation_id: opId(), evento: SOBRA_EVENTO(c) });
  });

  test('com "mover": o fechamento do período (campos do fechamento, registro aberto) passa; repetir em período já fechado → 403', async () => {
    const c = await cenario();
    await c.permitir(SO_MOVER);
    const fechaEv = await req('PATCH', `/suplementacao-eventos/${c.evento.id}`, c.tokOp, { sobra_kg: 4, dias_periodo: 6, consumo_diario_grupo_kg: 16 });
    assert.equal(fechaEv.statusCode, 200, fechaEv.body);
    const fechaLote = await req('PATCH', `/suplementacao-lotes/${c.loteSupl.id}`, c.tokOp, { dias_periodo: 6, consumo_por_cabeca_dia_kg: 0.16, consumo_total_lote_periodo_kg: 96, percentual_consumo_lote: 1 });
    assert.equal(fechaLote.statusCode, 200, fechaLote.body);
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-eventos/${c.evento.id}`, { sobra_kg: 99, dias_periodo: 6 });
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-lotes/${c.loteSupl.id}`, { dias_periodo: 1 });
    await negado(c, c.tokOp, 'PATCH', '/suplementacao-eventos/nao-existe', { sobra_kg: 1 });
  });

  test('"lançar suplementação": POST, bulk e PATCH livres passam; admin real passa; sem linha e is_admin coerentes', async () => {
    const c = await cenario();
    await c.permitir(SO_LANCAR);
    assert.equal((await req('POST', '/suplementacao-eventos', c.tokOp, SOBRA_EVENTO(c))).statusCode, 201);
    assert.equal((await req('POST', '/suplementacao-lotes/bulk', c.tokOp, { registros: [{ empresa_id: c.empresa.id, suplementacao_evento_id: c.evento.id, lote_id: c.lote.id }] })).statusCode, 201);
    const livre = await req('PATCH', `/suplementacao-eventos/${c.evento.id}`, c.tokOp, { sobra_kg: 2, dias_periodo: 3, consumo_diario_grupo_kg: 5 });
    assert.equal(livre.statusCode, 200, livre.body);
    // o lançamento só com "lançar" NÃO dá "mover"
    await negado(c, c.tokOp, 'POST', '/rebanho/comandos/transferencia', { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-01T12:00:00.000Z', itens: [{ posicao_id: c.posicao.id, quantidade: 1 }] });
    assert.equal((await req('POST', '/suplementacao-eventos', c.tokAdm, SOBRA_EVENTO(c))).statusCode, 201);
    await c.permitir({ is_admin: true });
    assert.equal((await req('POST', '/suplementacao-eventos', c.tokOp, SOBRA_EVENTO(c))).statusCode, 201);
    await prisma().permissao.deleteMany({ where: { cliente_id: c.cliente.id } });
    await negado(c, c.tokOp, 'POST', '/suplementacao-eventos', SOBRA_EVENTO(c));
  });

  test('revogação vale na próxima requisição; outro tenant não fecha período alheio', async () => {
    const c = await cenario();
    await c.permitir(SO_LANCAR);
    assert.equal((await req('POST', '/suplementacao-eventos', c.tokOp, SOBRA_EVENTO(c))).statusCode, 201);
    await c.permitir(SO_MOVER);
    await negado(c, c.tokOp, 'POST', '/suplementacao-eventos', SOBRA_EVENTO(c));
    const outro = await criarTenant({ papelTenant: 'administrador', semPermissao: true });
    const tokOutro = (await autenticarNoApp(app, outro.credenciais)).corpo.token;
    const antes = await fotografia(c.cliente.id);
    const r = await req('PATCH', `/suplementacao-eventos/${c.evento.id}`, tokOutro, { sobra_kg: 1, dias_periodo: 1 });
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(await fotografia(c.cliente.id), antes);
  });
});

describe('R3-SOB — sobras do cocho no destino após a transferência (sequência real do cliente)', () => {
  test('só "mover": transferência 201 (ledger gravado); evento e lotes de sobra 403 — nada de suplementação gravado', async () => {
    const c = await cenario();
    await c.permitir(SO_MOVER);
    const p = prisma();
    const eventosAntes = await p.eventoRebanho.count({ where: { cliente_id: c.cliente.id } });
    const t = await transferir(c, c.tokOp);
    assert.equal(t.statusCode, 201, t.body);
    assert.ok((await p.eventoRebanho.count({ where: { cliente_id: c.cliente.id } })) > eventosAntes, 'transferência no ledger');
    // passo 2 do DetalhesLote (registrarSobrasNoDestino): criarEventoSuplementacao + registrarSuplementacaoEmLote
    await negado(c, c.tokOp, 'POST', '/suplementacao-eventos', SOBRA_EVENTO(c));
    await negado(c, c.tokOp, 'POST', '/suplementacao-lotes/bulk', { registros: [{ empresa_id: c.empresa.id, suplementacao_evento_id: c.evento.id, lote_id: c.lote.id }] });
  });

  test('"mover" + "lançar": transferência e sobras gravam (fluxo completo preservado)', async () => {
    const c = await cenario();
    await c.permitir({ ...SO_MOVER, mapa_geral_permissoes: { mover_lotes: true, lancar_suplementacao: true } });
    assert.equal((await transferir(c, c.tokOp)).statusCode, 201);
    const ev = await req('POST', '/suplementacao-eventos', c.tokOp, SOBRA_EVENTO(c));
    assert.equal(ev.statusCode, 201, ev.body);
    const bulk = await req('POST', '/suplementacao-lotes/bulk', c.tokOp, { registros: [{ empresa_id: c.empresa.id, suplementacao_evento_id: ev.json().id, lote_id: c.lote.id }] });
    assert.equal(bulk.statusCode, 201, bulk.body);
  });
});

describe('R3-POR — tela cruzada só nos campos do fluxo cruzado', () => {
  test('locais de estoque: renomear o depósito passa; mover/reescrever o ponto → 403', async () => {
    const c = await cenario();
    const ponto = await req('POST', '/pontos-suplementacao', c.tokAdm, { empresa_id: c.empresa.id, nome_ponto: 'DEP 1', categoria_ponto: 'DEPOSITO' });
    assert.equal(ponto.statusCode, 201, ponto.body);
    await c.permitir({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'sup-locais', { visualizar: true, editar: true, salvar: true })] });
    assert.equal((await req('PATCH', `/pontos-suplementacao/${ponto.json().id}`, c.tokOp, { nome_ponto: 'DEP NOVO', local_estoque_nome: 'DEP NOVO' })).statusCode, 200);
    await negado(c, c.tokOp, 'PATCH', `/pontos-suplementacao/${ponto.json().id}`, { coordenadas: { lat: 0, lng: 0 } });
    await negado(c, c.tokOp, 'PATCH', `/pontos-suplementacao/${ponto.json().id}`, { nome_ponto: 'X', ativo: false });
  });

  test('referências: sincronizar exige a tela da PRÓPRIA entidade (tipo de tarefa não renomeia lotes)', async () => {
    const c = await cenario();
    await c.permitir({ modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'sup-tipos-tarefa', { visualizar: true, editar: true })] });
    const corpo = (entity) => ({ event: { type: 'update', entity_name: entity }, data: { id: c.lote.id, nome: 'HACK', empresa_id: c.empresa.id }, old_data: { id: c.lote.id, nome: 'BASE', empresa_id: c.empresa.id } });
    await negado(c, c.tokOp, 'POST', '/referencias/sincronizar', corpo('Lote'));
    await negado(c, c.tokOp, 'POST', '/referencias/sincronizar', corpo('MovimentacaoMapa'));
    assert.notEqual((await req('POST', '/referencias/sincronizar', c.tokOp, corpo('TipoTarefa'))).statusCode, 403);
  });

  test('anexo: remover exige "excluir" em pec-lotes ("editar" não basta)', async () => {
    const c = await cenario();
    await c.permitir({ modulos_permitidos: ['manejo'], permissoes_telas: [linha('manejo', 'pec-lotes', { visualizar: true, editar: true })] });
    await negado(c, c.tokOp, 'DELETE', '/registros-anexo/qualquer-id');
  });
});

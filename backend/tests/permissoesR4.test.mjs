/**
 * PR #199 / R4 — "mover lotes" NÃO fecha período de suplementação.
 * (cabeçalho e cenário herdados da R3)
 *
 * R3 permitia, com só `mover_lotes`, PATCH de QUALQUER período ABERTO do
 * tenant com os campos do fechamento — sem vínculo com transferência, lote,
 * área ou operação: encerrava o consumo de outro grupo. R4: todo PATCH de
 * suplementação exige `lancar_suplementacao`.
 *
 * Original R3 — desvio de privilégio por `porQualquer` em rotas genéricas.
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


/** Segundo período ABERTO, de OUTRO grupo (área B), criado pelo admin. */
const outroPeriodo = async (c) => {
  const ev = await req('POST', '/suplementacao-eventos', c.tokAdm, { empresa_id: c.empresa.id, area_id: c.B.id, produto: 'PROTEINADO', quantidade_total_kg: 300, sobra_kg: 0, data_lancamento: '2026-10-20', dias_periodo: null });
  assert.equal(ev.statusCode, 201, ev.body);
  const ls = await req('POST', '/suplementacao-lotes', c.tokAdm, { empresa_id: c.empresa.id, suplementacao_evento_id: ev.json().id, lote_id: 'outro-grupo', cabecas_na_area: 40, dias_periodo: null });
  assert.equal(ls.statusCode, 201, ls.body);
  return { evento: ev.json(), lote: ls.json() };
};
const FECHA_EVENTO = { sobra_kg: 4, dias_periodo: 6, consumo_diario_grupo_kg: 16 };
const FECHA_LOTE = { dias_periodo: 6, consumo_por_cabeca_dia_kg: 0.16, consumo_total_lote_periodo_kg: 96, percentual_consumo_lote: 1 };
const dadosDe = async (modelo, id) => (await prisma()[modelo].findUnique({ where: { id } }))?.dados;
const auditoriasDe = (c, id) => prisma().auditLog.count({ where: { cliente_id: c.cliente.id, entidade_id: id } });

describe('R4-FEC — só "mover lotes" não fecha nenhum período', () => {
  test('PATCH de fechamento em período ABERTO de outro grupo (evento e lote) → 403; conteúdo e auditoria intactos', async () => {
    const c = await cenario();
    const outro = await outroPeriodo(c);
    await c.permitir(SO_MOVER);
    const antesEv = await dadosDe('suplementacaoEvento', outro.evento.id);
    const antesLote = await dadosDe('suplementacaoLote', outro.lote.id);
    const audEv = await auditoriasDe(c, outro.evento.id);
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-eventos/${outro.evento.id}`, FECHA_EVENTO);
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-lotes/${outro.lote.id}`, FECHA_LOTE);
    assert.deepEqual(await dadosDe('suplementacaoEvento', outro.evento.id), antesEv, 'evento do outro grupo inalterado');
    assert.deepEqual(await dadosDe('suplementacaoLote', outro.lote.id), antesLote, 'lote do outro grupo inalterado');
    assert.equal(await auditoriasDe(c, outro.evento.id), audEv, 'sem auditoria de sucesso');
  });

  test('o PRÓPRIO grupo, payload misto e período já fechado também → 403', async () => {
    const c = await cenario();
    await c.permitir(SO_MOVER);
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-eventos/${c.evento.id}`, FECHA_EVENTO);
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-eventos/${c.evento.id}`, { ...FECHA_EVENTO, produto: 'X' });
    assert.equal((await req('PATCH', `/suplementacao-eventos/${c.evento.id}`, c.tokAdm, FECHA_EVENTO)).statusCode, 200);
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-eventos/${c.evento.id}`, { sobra_kg: 99, dias_periodo: 6 });
  });

  test('"falha no meio": fechar dois períodos em sequência (como o formulário) — o 1º já é 403, nada parcial', async () => {
    const c = await cenario();
    const outro = await outroPeriodo(c);
    await c.permitir(SO_MOVER);
    const antes = await fotografia(c.cliente.id);
    for (const id of [c.evento.id, outro.evento.id]) {
      const r = await req('PATCH', `/suplementacao-eventos/${id}`, c.tokOp, FECHA_EVENTO);
      assert.equal(r.statusCode, 403, r.body);
    }
    assert.equal(await fotografia(c.cliente.id), antes, 'nenhum período fechado parcialmente');
  });

  test('transferência com período ABERTO na origem e sem "lançar": a transferência grava; o período continua aberto e intacto', async () => {
    const c = await cenario();
    await c.permitir(SO_MOVER);
    const antesEv = await dadosDe('suplementacaoEvento', c.evento.id);
    const t = await transferir(c, c.tokOp);
    assert.equal(t.statusCode, 201, t.body);
    assert.ok((await prisma().partidaRebanho.count({ where: { cliente_id: c.cliente.id } })) > 0, 'ledger gravado');
    assert.deepEqual(await dadosDe('suplementacaoEvento', c.evento.id), antesEv);
    assert.equal((await dadosDe('suplementacaoEvento', c.evento.id)).dias_periodo ?? null, null, 'período segue aberto');
  });
});

describe('R4-FEC — quem pode fechar', () => {
  test('só "lançar": fecha evento e lote (efeito gravado + auditoria); não move gado', async () => {
    const c = await cenario();
    await c.permitir(SO_LANCAR);
    const audEv = await auditoriasDe(c, c.evento.id);
    assert.equal((await req('PATCH', `/suplementacao-eventos/${c.evento.id}`, c.tokOp, FECHA_EVENTO)).statusCode, 200);
    assert.equal((await req('PATCH', `/suplementacao-lotes/${c.loteSupl.id}`, c.tokOp, FECHA_LOTE)).statusCode, 200);
    assert.equal((await dadosDe('suplementacaoEvento', c.evento.id)).dias_periodo, 6);
    assert.equal((await dadosDe('suplementacaoLote', c.loteSupl.id)).dias_periodo, 6);
    assert.equal(await auditoriasDe(c, c.evento.id), audEv + 1);
    await negado(c, c.tokOp, 'POST', '/rebanho/comandos/transferencia', { operation_id: opId(), empresa_id: c.empresa.id, area_destino_id: c.B.id, data_movimentacao: '2026-11-01T12:00:00.000Z', itens: [{ posicao_id: c.posicao.id, quantidade: 1 }] });
  });

  test('"mover"+"lançar", linha is_admin e administrador real fecham; revogação vale na próxima requisição', async () => {
    const c = await cenario();
    const outro = await outroPeriodo(c);
    await c.permitir({ ...SO_MOVER, mapa_geral_permissoes: { mover_lotes: true, lancar_suplementacao: true } });
    assert.equal((await req('PATCH', `/suplementacao-eventos/${c.evento.id}`, c.tokOp, FECHA_EVENTO)).statusCode, 200);
    await c.permitir(SO_MOVER);
    await negado(c, c.tokOp, 'PATCH', `/suplementacao-eventos/${outro.evento.id}`, FECHA_EVENTO);
    await c.permitir({ is_admin: true });
    assert.equal((await req('PATCH', `/suplementacao-lotes/${outro.lote.id}`, c.tokOp, FECHA_LOTE)).statusCode, 200);
    assert.equal((await req('PATCH', `/suplementacao-eventos/${outro.evento.id}`, c.tokAdm, FECHA_EVENTO)).statusCode, 200);
  });

  test('outro tenant (admin real de lá) não fecha período daqui: 404, nada muda', async () => {
    const c = await cenario();
    const outroTenant = await criarTenant({ papelTenant: 'administrador', semPermissao: true });
    const tok = (await autenticarNoApp(app, outroTenant.credenciais)).corpo.token;
    const antes = await fotografia(c.cliente.id);
    const r = await req('PATCH', `/suplementacao-eventos/${c.evento.id}`, tok, FECHA_EVENTO);
    assert.equal(r.statusCode, 404, r.body);
    assert.equal(await fotografia(c.cliente.id), antes);
  });
});

describe('R4-POR — tela cruzada também confere o REGISTRO alcançado', () => {
  const pontos = async (c) => {
    const dep = await req('POST', '/pontos-suplementacao', c.tokAdm, { empresa_id: c.empresa.id, nome_ponto: 'DEP 1', categoria_ponto: 'DEPOSITO', local_estoque_id: 'local-1', local_estoque_nome: 'DEP 1' });
    assert.equal(dep.statusCode, 201, dep.body);
    const cocho = await req('POST', '/pontos-suplementacao', c.tokAdm, { empresa_id: c.empresa.id, nome_ponto: 'COCHO 1', categoria_ponto: 'COCHO', deposito_origem_id: dep.json().id, deposito_origem_nome: 'DEP 1' });
    assert.equal(cocho.statusCode, 201, cocho.body);
    const solto = await req('POST', '/pontos-suplementacao', c.tokAdm, { empresa_id: c.empresa.id, nome_ponto: 'COCHO SOLTO', categoria_ponto: 'COCHO' });
    assert.equal(solto.statusCode, 201, solto.body);
    return { dep: dep.json(), cocho: cocho.json(), solto: solto.json() };
  };
  const LOCAIS = { modulos_permitidos: ['suporte-mapa'], permissoes_telas: [linha('suporte-mapa', 'sup-locais', { visualizar: true, editar: true, salvar: true })] };
  const MC_EXCLUIR = { modulos_permitidos: ['mapa'], permissoes_telas: [linha('mapa', 'pec-mapa-cadastro', { visualizar: true, excluir: true })] };

  test('Locais: renomear o depósito do local e o nome de origem do cocho vinculado passam; renomear um cocho qualquer → 403', async () => {
    const c = await cenario();
    const p = await pontos(c);
    await c.permitir(LOCAIS);
    assert.equal((await req('PATCH', `/pontos-suplementacao/${p.dep.id}`, c.tokOp, { nome_ponto: 'DEP NOVO', local_estoque_nome: 'DEP NOVO' })).statusCode, 200);
    assert.equal((await req('PATCH', `/pontos-suplementacao/${p.cocho.id}`, c.tokOp, { deposito_origem_nome: 'DEP NOVO' })).statusCode, 200);
    await negado(c, c.tokOp, 'PATCH', `/pontos-suplementacao/${p.cocho.id}`, { nome_ponto: 'RENOMEADO' });
    await negado(c, c.tokOp, 'PATCH', `/pontos-suplementacao/${p.solto.id}`, { deposito_origem_nome: 'X' });
  });

  test('Mapa Cadastro "excluir": só DESVINCULAR cocho vinculado; religar a outro depósito → 403', async () => {
    const c = await cenario();
    const p = await pontos(c);
    await c.permitir(MC_EXCLUIR);
    await negado(c, c.tokOp, 'PATCH', `/pontos-suplementacao/${p.solto.id}`, { deposito_origem_id: p.dep.id, deposito_origem_nome: 'DEP 1' });
    await negado(c, c.tokOp, 'PATCH', `/pontos-suplementacao/${p.solto.id}`, { deposito_origem_id: null, deposito_origem_nome: null });
    assert.equal((await req('PATCH', `/pontos-suplementacao/${p.cocho.id}`, c.tokOp, { deposito_origem_id: null, deposito_origem_nome: null })).statusCode, 200);
  });
});

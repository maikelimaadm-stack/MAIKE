/**
 * PR169-R2 (D-PROD-104, complemento) — guarda temporal REAL da Junção de Lotes.
 *
 * A junção usava `dependenciasPosteriores` do cancelamento com um movimento
 * fictício (createdAt 9999-12-31): a condição "createdAt > mov.createdAt"
 * nunca casava, então tarefas (LancamentoTarefa compara só createdAt) e
 * registros sem data operacional nunca bloqueavam uma junção retroativa.
 *
 * Semântica adotada (comando novo, sem createdAt próprio):
 *  - data efetiva do registro = data operacional confiável (AAAA-MM-DD válido
 *    no prefixo do campo de data da fonte); sem ela, a data de REGISTRO
 *    (createdAt, UTC). Bloqueia quando data efetiva > data da junção.
 *    Mesmo dia não bloqueia (o comando é gravado agora, depois deles).
 *  - LancamentoTarefa: data_conclusao (realizado) › data_inicio (iniciado) ›
 *    createdAt (registrado). data_prevista NÃO conta como evento. Cancelada
 *    não bloqueia.
 *  - MovimentacaoMapa cancelada não bloqueia.
 *
 * PostgreSQL real, HTTP autenticado, dados sintéticos.
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
/** Data da junção bem no passado: tudo criado agora tem createdAt POSTERIOR a ela. */
const DATA_JUNCAO = '2026-10-20T12:00:00.000Z';

const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const tok = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const empresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const outraEmpresa = await p.empresa.create({ data: { cliente_id: adm.cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
  const setor = await p.setor.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const A = await p.areaPastagem.create({ data: { cliente_id: adm.cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: '1', nome: 'PASTO A', tamanho_hectares: 10 } });
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: adm.cliente.id, nome_grupo: 'Manejo' } });
  const tipo = await p.tipoTarefa.create({ data: { cliente_id: adm.cliente.id, nome_tipo: 'Vistoria', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo } });
  return { cliente: adm.cliente, tok, empresa, outraEmpresa, setor, A, tipo };
};
const criarLote = async (c, nome, qtd, peso = 400) => {
  const r = await req('POST', '/lotes', c.tok, {
    empresa_id: c.empresa.id, nome, quantidade_cabecas: qtd, categoria: BOI, sexo: 'Macho', setor_id: c.setor.id,
    area_entrada_id: c.A.id, area_atual_id: c.A.id, data_entrada: '2026-10-01', motivo_entrada: 'Compra', status: 'Ativo',
    ...(peso !== null ? { peso_medio_kg: peso } : {}),
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};
const par = async (c) => ({ p: await criarLote(c, 'PRINCIPAL', 40), o: await criarLote(c, 'ORIGEM', 30) });
const juntar = (c, p, origens, data = DATA_JUNCAO, token = c.tok) =>
  req('POST', '/movimentacoes-mapa/comandos/juncao-lotes', token, {
    operation_id: opId(), empresa_id: c.empresa.id, area_id: c.A.id, lote_principal_id: p.id, lote_origem_ids: origens.map((x) => x.id), data_movimentacao: data,
  });
const tarefa = (c, loteId, campos = {}, empresaId = c.empresa.id, clienteId = c.cliente.id, tipoId = c.tipo.id) =>
  prisma().lancamentoTarefa.create({
    data: { cliente_id: clienteId, empresa_id: empresaId, titulo: 'T', tipo: 'Manejo', tipo_tarefa_id: tipoId, tipo_tarefa_nome: 'Vistoria', lote_id: loteId, ...campos },
  });
const d = (s) => new Date(`${s}T00:00:00.000Z`);

/** Fotografia: saldos, status, movimentos, auditoria e reservas. */
const foto = async (c) => {
  const p = prisma();
  const lotes = await p.lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: { nome: 'asc' } });
  return {
    lotes: lotes.map((l) => [l.nome, l.quantidade_cabecas, l.status, l.peso_medio_kg === null ? null : Number(l.peso_medio_kg)]),
    movs: await p.movimentacaoMapa.count({ where: { cliente_id: c.cliente.id } }),
    audits: await p.auditLog.count({ where: { cliente_id: c.cliente.id } }),
    ops: await p.operacaoIdempotente.count({ where: { cliente_id: c.cliente.id } }),
  };
};
const exigirBloqueio = async (c, acao) => {
  const antes = await foto(c);
  const r = await acao();
  const depois = await foto(c);
  console.log(`  ANTES  ${JSON.stringify(antes)}\n  DEPOIS ${JSON.stringify(depois)}\n  HTTP ${r.statusCode} ${r.json().code ?? ''}`);
  assert.equal(r.statusCode, 409, r.body);
  assert.equal(r.json().code, 'JUNCAO_DATA_RETROATIVA');
  assert.deepEqual(depois, antes, 'recusa não muda saldo, status, movimento, auditoria nem reserva');
};
const exigirAceite = async (c, acao, total) => {
  const r = await acao();
  assert.equal(r.statusCode, 201, r.body);
  const l = await prisma().lote.findMany({ where: { cliente_id: c.cliente.id, status: 'Ativo' } });
  assert.equal(l.reduce((t, x) => t + x.quantidade_cabecas, 0), total);
  return r.json();
};

// ═══ RED (T1–T3): reproduzidos no HEAD 729cedc ═════════════════════════════

describe('PR169-R2 RED — registro posterior ignorado pela guarda temporal', () => {
  test('T1: tarefa da ORIGEM concluída depois da data da junção → 409 JUNCAO_DATA_RETROATIVA', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await tarefa(c, o.id, { status: 'Concluída', data_inicio: new Date('2026-10-25T08:00:00Z'), data_conclusao: d('2026-10-25') });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('T1b: tarefa em andamento (iniciada depois da data) → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await tarefa(c, o.id, { status: 'Em Andamento', data_inicio: new Date('2026-10-28T08:00:00Z') });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('T2: movimentação ATIVA sem data operacional, registrada depois da data → 409 (data de registro vale)', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    const r = await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Observação', lote: o.nome, lote_id: o.id, quantidade_animais: 0 });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().data_movimentacao, undefined, 'registro sem data operacional');
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('T3: evento sanitário da ORIGEM com data malformada ("25/10/2026"), registrado depois → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: o.id, data_evento: '25/10/2026' } } });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('T3c: data malformada "01/11/2026" (posterior, mas perde na comparação de texto) → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: o.id, data_evento: '01/11/2026' } } });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('T3b: evento sanitário sem data, registrado depois → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: o.id } } });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });
});

// ═══ GREEN — semântica completa ════════════════════════════════════════════

describe('PR169-R2 GREEN — anteriores passam, cancelados não bloqueiam, sem vazamento', () => {
  test('G1: registros comprovadamente ANTERIORES (data operacional ≤ data da junção) não bloqueiam, mesmo registrados agora', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await tarefa(c, o.id, { status: 'Concluída', data_conclusao: d('2026-10-10') });
    await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Observação', lote: o.nome, lote_id: o.id, data_movimentacao: '2026-10-15T12:00:00.000Z' });
    await prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: o.id, data_evento: '2026-10-19' } } });
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
  });

  test('G2: mesmo dia não bloqueia (ISO com hora e AAAA-MM-DD); dia seguinte bloqueia', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Observação', lote: o.nome, lote_id: o.id, data_movimentacao: '2026-10-20T23:59:00.000Z' });
    await prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { lote_id: o.id, data_evento: '2026-10-20' } } });
    await exigirAceite(c, () => juntar(c, p, [o], '2026-10-20'), 70);
    const e = await cenario();
    const t = await par(e);
    await prisma().eventoSanitario.create({ data: { cliente_id: e.cliente.id, empresa_id: e.empresa.id, dados: { lote_id: t.o.id, data_evento: '2026-10-21' } } });
    await exigirBloqueio(e, () => juntar(e, t.p, [t.o], '2026-10-20'));
  });

  test('G3: data com fuso: o dia operacional é o do próprio registro (prefixo), não convertido para UTC', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    // 20/10 às 23h em -03:00 = 21/10 02h UTC; o dia operacional registrado é 20/10.
    await req('POST', '/movimentacoes-mapa', c.tok, { empresa_id: c.empresa.id, tipo: 'Observação', lote: o.nome, lote_id: o.id, data_movimentacao: '2026-10-20T23:00:00-03:00' });
    await exigirAceite(c, () => juntar(c, p, [o], '2026-10-20T12:00:00-03:00'), 70);
  });

  test('G4: tarefa só com previsão futura NÃO é evento realizado; registrada antes da data não bloqueia', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    const t = await tarefa(c, o.id, { status: 'Pendente', data_prevista: d('2026-12-01') });
    // registrada (createdAt) em 15/10: anterior à junção; previsão em dezembro não conta.
    await prisma().lancamentoTarefa.update({ where: { id: t.id }, data: { createdAt: new Date('2026-10-15T10:00:00Z') } });
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
  });

  test('G5: tarefa CANCELADA e movimento CANCELADO posteriores não bloqueiam', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await tarefa(c, o.id, { status: 'Cancelada', data_inicio: new Date('2026-10-25T08:00:00Z') });
    await prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Pesagem', lote_id: o.id, data_movimentacao: '2026-10-25', situacao: 'cancelado' } } });
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
  });

  test('G6: 610 cancelados posteriores + 1 ativo → bloqueia; só os 610 → permite', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    const linhas = (ativo) =>
      Array.from({ length: 611 }, (_, i) => ({
        cliente_id: c.cliente.id, empresa_id: c.empresa.id,
        dados: { tipo: 'Pesagem', lote_id: o.id, data_movimentacao: '2026-10-30', ...(ativo && i === 600 ? {} : { situacao: 'cancelado' }) },
      }));
    await prisma().movimentacaoMapa.createMany({ data: linhas(true) });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
    await prisma().movimentacaoMapa.updateMany({ where: { cliente_id: c.cliente.id }, data: { dados: { tipo: 'Pesagem', lote_id: o.id, data_movimentacao: '2026-10-30', situacao: 'cancelado' } } });
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
  });

  test('G7: tarefa de OUTRO lote, de OUTRA empresa e de OUTRO tenant não bloqueiam; homônimo com outro id também não', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    const outro = await criarLote(c, 'OUTRO', 5);
    const homonimo = await criarLote(c, 'ORIGEM', 7);
    await tarefa(c, outro.id, { status: 'Concluída', data_conclusao: d('2026-10-25') });
    await tarefa(c, homonimo.id, { status: 'Concluída', data_conclusao: d('2026-10-25') });
    await tarefa(c, o.id, { status: 'Concluída', data_conclusao: d('2026-10-25') }, c.outraEmpresa.id);
    const x = await cenario();
    await tarefa(x, o.id, { status: 'Concluída', data_conclusao: d('2026-10-25') }, x.empresa.id, x.cliente.id, x.tipo.id).catch(() => null);
    await exigirAceite(c, () => juntar(c, p, [o]), 82);
  });

  test('G8: registro posterior no PRINCIPAL também bloqueia; junção de 6 lotes com tudo anterior conserva e pondera', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await tarefa(c, p.id, { status: 'Concluída', data_conclusao: d('2026-10-22') });
    await exigirBloqueio(c, () => juntar(c, p, [o]));

    const e = await cenario();
    const pr = await criarLote(e, 'P', 10, 300);
    const os = [];
    for (let i = 0; i < 5; i += 1) os.push(await criarLote(e, `O${i}`, i + 1, 300 + i * 10));
    const r = await exigirAceite(e, () => juntar(e, pr, os), 25);
    const esperado = Number(((10 * 300 + os.reduce((t, x, i) => t + (i + 1) * (300 + i * 10), 0)) / 25).toFixed(4));
    const final = await prisma().lote.findUnique({ where: { id: pr.id } });
    assert.equal(Number(final.peso_medio_kg), esperado);
    assert.equal(r.movimentacao.tipo, 'Junção de Lotes');
    assert.equal(await prisma().lote.count({ where: { cliente_id: e.cliente.id } }), 6, 'nenhum lote criado');
  });
});

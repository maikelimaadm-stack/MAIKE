/**
 * PR169-R3 (D-PROD-104, complemento) — datas IMPOSSÍVEIS e campos de data
 * CONFLITANTES na guarda temporal da Junção de Lotes.
 *
 * No HEAD b63b294 `dataConfiavel` aceitava qualquer texto que COMEÇASSE com
 * AAAA-MM-DD (regex sem âncora final e sem calendário): 2026-00-00,
 * 2026-02-30 e "2026-10-19texto" viravam "datas confiáveis", eram
 * comparadas como texto e, por ordenarem ANTES da data da junção, escondiam
 * um registro feito depois dela (o fallback createdAt era pulado).
 * Fontes com duas datas (MovimentacaoPecuaria: data_movimentacao,
 * data_evento) usavam COALESCE: a primeira, se anterior, escondia a segunda.
 *
 * PostgreSQL real, HTTP autenticado, dados sintéticos.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { dataConfiavel } from '../src/modules/movimentacoesMapa/guardaTemporalComando.js';
import { dataOperacionalValida } from '../src/modules/movimentacoesMapa/manejoRebanhoComandoService.js';
import { Prisma } from '@prisma/client';

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
  const lotes = await p.lote.findMany({ where: { cliente_id: c.cliente.id }, orderBy: [{ nome: 'asc' }, { id: 'asc' }] });
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

const evento = (c, dados, extra = {}) =>
  prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados, ...extra } });
const pecuaria = (c, dados, extra = {}) =>
  prisma().movimentacaoPecuaria.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados, ...extra } });
const mapa = (c, dados, extra = {}) =>
  prisma().movimentacaoMapa.create({ data: { cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Observação', ...dados }, ...extra } });
/** createdAt ANTERIOR à data da junção: o registro entrou no sistema antes dela. */
const ANTIGO = { createdAt: new Date('2026-10-01T10:00:00Z') };

// ═══ RED (A–D): reproduzidos no HEAD b63b294 ═══════════════════════════════
// Todos os registros abaixo foram gravados AGORA (createdAt > 20/10).

describe('PR169-R3 RED — data impossível ou conflitante escondia registro posterior', () => {
  test('A: evento sanitário com data_evento 2026-00-00, registrado depois da junção → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-00-00' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('B1: data impossível 2026-02-30 → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-02-30' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('B2: lixo depois da data ("2026-10-19texto") → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-10-19texto' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('B3: data impossível de ano anterior (2025-13-45) → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2025-13-45' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('B4: MovimentacaoMapa ativa com data_movimentacao 2026-02-30 → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await mapa(c, { lote_id: o.id, data_movimentacao: '2026-02-30' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('C1: data inválida lexicamente POSTERIOR (2026-13-01) continua bloqueando → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-13-01' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('C2: data inválida lexicamente ANTERIOR (2026-10-00) não prova anterioridade → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-10-00' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('D1: MovimentacaoPecuaria data_movimentacao ANTERIOR e data_evento POSTERIOR → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await pecuaria(c, { lote_id: o.id, data_movimentacao: '2026-10-10', data_evento: '2026-10-25' }, ANTIGO);
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('D2: inverso — data_movimentacao POSTERIOR e data_evento ANTERIOR → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await pecuaria(c, { lote_id: o.id, data_movimentacao: '2026-10-25', data_evento: '2026-10-10' }, ANTIGO);
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('D3: data_movimentacao válida ANTERIOR + data_evento IMPOSSÍVEL, registrado depois → 409', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await pecuaria(c, { lote_id: o.id, data_movimentacao: '2026-10-10', data_evento: '2026-00-00' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });
});

// ═══ GREEN — calendário real, sem exceção, sem bloqueio indevido ════════════

describe('PR169-R3 GREEN — validação de calendário no SQL (nunca lança)', () => {
  test('V1: só data de calendário REAL é confiável; o dia é o prefixo escrito; mesma regra do comando', async () => {
    const casos = [
      ['2026-10-20', '2026-10-20'],
      ['2026-10-20T23:59:00.000Z', '2026-10-20'],
      ['2026-10-20T23:00:00-03:00', '2026-10-20'],
      ['2026-10-20T08:30', '2026-10-20'],
      ['2024-02-29', '2024-02-29'],
      ['2000-02-29', '2000-02-29'],
      ['2026-12-31', '2026-12-31'],
      ['2026-00-00', null],
      ['2026-02-30', null],
      ['2025-02-29', null],
      ['1900-02-29', null],
      ['2026-04-31', null],
      ['2026-13-01', null],
      ['2026-10-00', null],
      ['0000-01-01', null],
      ['2026-10-19texto', null],
      ['2026-10-19 ', null],
      ['2026-10-19T25:00', null],
      ['2026-10-19T10:00+99:00', null],
      ['25/10/2026', null],
      ['', null],
      [null, null],
      ['abcd-ef-gh', null],
      ['9999-99-99', null],
      ['2026-1-5', null],
    ];
    for (const [valor, esperado] of casos) {
      const [linha] = await prisma().$queryRaw`SELECT ${dataConfiavel(Prisma.sql`${valor}::text`)} AS dia`;
      assert.equal(linha.dia, esperado, `SQL ${JSON.stringify(valor)}`);
      if (esperado !== null) assert.equal(dataOperacionalValida(valor), true, `JS aceita ${valor}`);
      if (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) && esperado === null) assert.equal(dataOperacionalValida(valor), false, `JS recusa ${valor}`);
    }
  });

  test('V2: valores esdrúxulos nos campos de data (número JSON, objeto, espaços, texto longo) não geram 500', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    for (const v of [20261020, { a: 1 }, '   ', 'x'.repeat(5000), '2026-02-30T10:00:00Z', true]) {
      await evento(c, { lote_id: o.id, data_evento: v }, ANTIGO);
    }
    await pecuaria(c, { lote_id: o.id, data_movimentacao: [1, 2], data_evento: '9999-99-99' }, ANTIGO);
    // Todos registrados ANTES da junção e sem data confiável: createdAt (01/10) vale → não bloqueia.
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
  });
});

describe('PR169-R3 GREEN — semântica preservada (anteriores passam, posteriores bloqueiam)', () => {
  test('G1: datas REAIS anteriores (AAAA-MM-DD, ISO, ISO com fuso, bissexto) não bloqueiam, mesmo registradas agora', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-10-19' });
    await evento(c, { lote_id: o.id, data_evento: '2024-02-29' });
    await mapa(c, { lote_id: o.id, data_movimentacao: '2026-10-15T12:00:00.000Z' });
    await mapa(c, { lote_id: o.id, data_movimentacao: '2026-10-19T22:00:00-03:00' });
    await pecuaria(c, { lote_id: o.id, data_movimentacao: '2026-10-10', data_evento: '2026-10-12' });
    await pecuaria(c, { lote_id: o.id, data_evento: '2026-10-11' });
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
  });

  test('G2: mesmo dia não bloqueia; dia seguinte bloqueia; ISO com fuso usa o dia escrito', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-10-20' });
    await mapa(c, { lote_id: o.id, data_movimentacao: '2026-10-20T23:00:00-03:00' });
    await exigirAceite(c, () => juntar(c, p, [o], '2026-10-20'), 70);
    const e = await cenario();
    const t = await par(e);
    await evento(e, { lote_id: t.o.id, data_evento: '2026-10-21T00:30:00+03:00' });
    await exigirBloqueio(e, () => juntar(e, t.p, [t.o], '2026-10-20'));
  });

  test('G3: data impossível com registro ANTERIOR à junção: createdAt (fallback) decide → não bloqueia', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-00-00' }, ANTIGO);
    await evento(c, { lote_id: o.id, data_evento: '2026-13-01' }, ANTIGO);
    await pecuaria(c, { lote_id: o.id, data_movimentacao: '2026-10-05', data_evento: '2026-02-30' }, ANTIGO);
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
  });

  test('G4: sem data: registrado antes passa; registrado depois bloqueia', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id }, ANTIGO);
    await pecuaria(c, { lote_id: o.id }, ANTIGO);
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
    const e = await cenario();
    const t = await par(e);
    await pecuaria(e, { lote_id: t.o.id });
    await exigirBloqueio(e, () => juntar(e, t.p, [t.o]));
  });

  test('G5: data REAL posterior bloqueia mesmo com createdAt antigo (agendado antes, evento depois)', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote_id: o.id, data_evento: '2026-10-21' }, ANTIGO);
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('G6: tarefa — início posterior com conclusão anterior (inconsistente) bloqueia; só previsão não; Cancelada não', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    const prev = await tarefa(c, o.id, { status: 'Pendente', data_prevista: d('2026-12-01') });
    await prisma().lancamentoTarefa.update({ where: { id: prev.id }, data: ANTIGO });
    await tarefa(c, o.id, { status: 'Cancelada', data_inicio: new Date('2026-10-25T08:00:00Z') });
    await tarefa(c, o.id, { status: 'Concluída', data_inicio: new Date('2026-10-05T08:00:00Z'), data_conclusao: d('2026-10-06') });
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
    const e = await cenario();
    const t = await par(e);
    await tarefa(e, t.o.id, { status: 'Concluída', data_inicio: new Date('2026-10-25T08:00:00Z'), data_conclusao: d('2026-10-10') });
    await exigirBloqueio(e, () => juntar(e, t.p, [t.o]));
    const f = await cenario();
    const u = await par(f);
    await tarefa(f, u.o.id, { status: 'Em Andamento', data_inicio: new Date('2026-10-22T08:00:00Z') });
    await exigirBloqueio(f, () => juntar(f, u.p, [u.o]));
  });

  test('G7: data impossível em movimento CANCELADO, em OUTRA empresa, OUTRO tenant ou lote homônimo com id não bloqueia', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    const homonimo = await criarLote(c, 'ORIGEM', 7);
    await mapa(c, { lote_id: o.id, data_movimentacao: '2026-02-30', situacao: 'cancelado' });
    await prisma().eventoSanitario.create({ data: { cliente_id: c.cliente.id, empresa_id: c.outraEmpresa.id, dados: { lote_id: o.id, data_evento: '2026-00-00' } } });
    await evento(c, { lote_id: homonimo.id, data_evento: '2026-00-00' });
    const x = await cenario();
    await evento(x, { lote_id: o.id, lote: 'ORIGEM', data_evento: '2026-00-00' });
    await exigirAceite(c, () => juntar(c, p, [o]), 77);
  });

  test('G8: legado SEM lote_id, só pelo nome, com data impossível registrada depois → bloqueia', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    await evento(c, { lote: 'origem ', data_evento: '2026-02-30' });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
  });

  test('G9: 610 movimentos cancelados com data impossível + 1 ativo com data impossível → bloqueia; só cancelados → permite', async () => {
    const c = await cenario();
    const { p, o } = await par(c);
    const linhas = Array.from({ length: 611 }, (_, i) => ({
      cliente_id: c.cliente.id, empresa_id: c.empresa.id,
      dados: { tipo: 'Pesagem', lote_id: o.id, data_movimentacao: '2026-02-30', ...(i === 600 ? {} : { situacao: 'cancelado' }) },
    }));
    await prisma().movimentacaoMapa.createMany({ data: linhas });
    await exigirBloqueio(c, () => juntar(c, p, [o]));
    await prisma().movimentacaoMapa.updateMany({ where: { cliente_id: c.cliente.id }, data: { dados: { tipo: 'Pesagem', lote_id: o.id, data_movimentacao: '2026-02-30', situacao: 'cancelado' } } });
    await exigirAceite(c, () => juntar(c, p, [o]), 70);
  });
});

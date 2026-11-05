/**
 * D-PROD-123 (H2) — histórico cronológico por OCORRÊNCIA, PostgreSQL real.
 *
 * Dados sintéticos, inseridos direto nas tabelas como fixture de leitura
 * (nenhum saldo é gravado). O esperado é calculado por uma implementação
 * independente da tupla (tem_ocorrencia, ocorrência, registrado, createdAt, id).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { codificarCursor } from '../src/shared/pagination/keysetCursor.js';

/** @type {import('fastify').FastifyInstance} */
let app;

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

const auth = (token) => ({ authorization: `Bearer ${token}` });

const cenario = async (numeroEmpresa = 1) => {
  const prisma = getPrismaClient();
  const { cliente, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  const empresa = await prisma.empresa.create({
    data: { cliente_id: cliente.id, numero_empresa: numeroEmpresa, fuso_horario: 'America/Sao_Paulo', apelido: `FAZ${numeroEmpresa}`, nome: `Fazenda ${numeroEmpresa}` },
  });
  return { token: corpo.token, cliente, empresa };
};

const historico = async (token, query) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item));
  return app.inject({ method: 'GET', url: `/movimentacoes-mapa/historico?${qs}`, headers: auth(token) });
};

/** Percorre todas as páginas; devolve os itens na ordem servida e o nº de páginas. */
const todasAsPaginas = async (token, query) => {
  const itens = [];
  let cursor;
  let paginas = 0;
  do {
    const r = await historico(token, { ...query, ...(cursor ? { cursor } : {}) });
    assert.equal(r.statusCode, 200, r.body);
    itens.push(...r.json().items);
    cursor = r.json().next_cursor;
    paginas += 1;
    if (!cursor) assert.equal(r.json().has_more, false, 'fim: sem cursor e has_more=false');
  } while (cursor);
  return { itens, paginas };
};

/** Comparador de referência, escrito à parte do SQL. */
const esperadoDesc = (a, b) => {
  const ta = a.oc ? 1 : 0;
  const tb = b.oc ? 1 : 0;
  if (ta !== tb) return tb - ta;
  if (a.oc !== b.oc) return a.oc < b.oc ? 1 : -1;
  if (a.reg !== b.reg) return b.reg - a.reg;
  if (a.criado !== b.criado) return b.criado - a.criado;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

const pad = (n, w = 4) => String(n).padStart(w, '0');

/**
 * Monta a massa: eventos do ledger (com vínculo inequívoco), legados com
 * data válida (inclusive com hora e fuso), futuro legado, retroativo tardio,
 * empates exatos, data ausente e inválida, vínculo ambíguo.
 */
const montarMassa = async ({ cliente, empresa }, { quantidade = 270 } = {}) => {
  const prisma = getPrismaClient();
  const movs = [];
  const eventos = [];
  const esperado = [];
  const base = Date.parse('2026-01-10T10:00:00.000Z');
  const empate = new Date('2026-05-05T05:05:05.505Z');
  for (let i = 0; i < quantidade; i += 1) {
    const id = `h2mov${pad(i)}`;
    let createdAt = new Date(base + i * 60_000);
    const dados = { tipo: 'Pesagem', lote: 'L', lote_id: 'lote-L', area_origem_id: 'area-A', quantidade_animais: 1, seq: i };
    let oc = null;
    let reg = createdAt.getTime();
    const tipo = i % 9;
    if (tipo === 0 || tipo === 1) {
      // Ledger: data_operacional manda, mesmo com data_movimentacao divergente.
      const evId = `h2ev${pad(i)}`;
      const dia = `2026-0${1 + (i % 6)}-${pad(1 + (i % 27), 2)}`;
      const registrado = new Date(createdAt.getTime() - 5000);
      eventos.push({ id: evId, cliente_id: cliente.id, empresa_id: empresa.id, tipo: 'TRANSFERENCIA', data_operacional: new Date(`${dia}T00:00:00.000Z`), registrado_em: registrado, operation_id: `op-${i}`, movimentacao_id: id, situacao: tipo === 1 ? 'cancelado' : 'ativo', cancelado_em: tipo === 1 ? new Date('2026-06-01T00:00:00.000Z') : null });
      dados.data_movimentacao = '2020-01-01';
      dados.efeito_servidor = { comando: 'rebanho_ledger', evento_id: evId, registrado_em: registrado.toISOString() };
      oc = dia;
      reg = registrado.getTime();
    } else if (tipo === 2) {
      // Legado com hora e offset: dia literal, sem conversão UTC.
      dados.data_movimentacao = `2026-03-${pad(1 + (i % 28), 2)}T23:30:00-04:00`;
      oc = dados.data_movimentacao.slice(0, 10);
    } else if (tipo === 3) {
      dados.data_movimentacao = `2025-12-${pad(1 + (i % 28), 2)}`;
      oc = dados.data_movimentacao;
    } else if (tipo === 4) {
      // Data ausente ou inválida → "não informada" (fim da ordem).
      const invalidas = [undefined, '', '2026-02-30', 'abc', '31/12/2025', 20260101, '0000-01-01'];
      const v = invalidas[i % invalidas.length];
      if (v !== undefined) dados.data_movimentacao = v;
    } else if (tipo === 5) {
      // Vínculo AMBÍGUO: evento_id aponta para evento de OUTRO movimento → usa o legado.
      dados.data_movimentacao = '2026-02-14';
      dados.efeito_servidor = { comando: 'rebanho_ledger', evento_id: `h2ev${pad(i - 5)}` };
      oc = '2026-02-14';
    } else if (tipo === 6) {
      // Empate exato de ocorrência, registro e createdAt → desempate por id.
      dados.data_movimentacao = '2026-04-04';
      createdAt = empate;
      reg = empate.getTime();
      oc = '2026-04-04';
    } else {
      dados.data_movimentacao = `2026-0${1 + (i % 9)}-15`;
      oc = dados.data_movimentacao;
    }
    movs.push({ id, cliente_id: cliente.id, empresa_id: empresa.id, dados, createdAt });
    esperado.push({ id, oc, reg, criado: createdAt.getTime() });
  }
  // Fato legado FUTURO (não é corrigido, só ordenado) e retroativo TARDIO.
  const futuro = new Date(base + 999 * 60_000);
  movs.push({ id: 'h2futuro', cliente_id: cliente.id, empresa_id: empresa.id, dados: { tipo: 'Pesagem', lote_id: 'lote-L', area_origem_id: 'area-A', data_movimentacao: '2031-12-31' }, createdAt: futuro });
  esperado.push({ id: 'h2futuro', oc: '2031-12-31', reg: futuro.getTime(), criado: futuro.getTime() });
  const tardio = new Date('2026-12-01T00:00:00.000Z');
  movs.push({ id: 'h2tardio', cliente_id: cliente.id, empresa_id: empresa.id, dados: { tipo: 'Pesagem', lote_id: 'lote-L', area_origem_id: 'area-A', data_movimentacao: '2024-01-02' }, createdAt: tardio });
  esperado.push({ id: 'h2tardio', oc: '2024-01-02', reg: tardio.getTime(), criado: tardio.getTime() });

  await prisma.movimentacaoMapa.createMany({ data: movs });
  await prisma.eventoRebanho.createMany({ data: eventos });
  return esperado.sort(esperadoDesc);
};

describe('H2 — ordem global por ocorrência em 3 páginas (> 250 movimentos)', () => {
  test('a sequência servida = ordem de referência; sem repetir nem pular; datas expostas', async () => {
    const c = await cenario();
    const esperado = await montarMassa(c);
    const { itens, paginas } = await todasAsPaginas(c.token, { empresa_id: c.empresa.id, area_id: 'area-A', limit: 100 });
    assert.equal(paginas, 3);
    assert.equal(itens.length, esperado.length);
    assert.equal(new Set(itens.map((m) => m.id)).size, itens.length, 'sem repetição');
    assert.deepEqual(itens.map((m) => m.id), esperado.map((e) => e.id), 'ordem global determinística');

    const porId = new Map(itens.map((m) => [m.id, m]));
    assert.equal(itens[0].id, 'h2futuro', 'fato futuro legado aparece no topo, sem correção automática');
    assert.equal(porId.get('h2futuro').data_movimentacao, '2031-12-31', 'dado gravado intacto');
    const posTardio = itens.findIndex((m) => m.id === 'h2tardio');
    const primeiroSemData = itens.findIndex((m) => m.historico_ocorrencia === null);
    assert.ok(posTardio > 200 && posTardio < primeiroSemData, 'retroativo tardio entra na data do fato, não no topo');
    assert.ok(itens.slice(primeiroSemData).every((m) => m.historico_ocorrencia === null), 'não informada só no fim');

    const ledger = porId.get(`h2mov${pad(0)}`);
    assert.equal(ledger.historico_ocorrencia_origem, 'evento');
    assert.equal(ledger.historico_ocorrencia, '2026-01-01', 'data_operacional vence data_movimentacao divergente');
    assert.equal(ledger.data_movimentacao, '2020-01-01', 'documento não reinterpretado');
    const cancelado = porId.get(`h2mov${pad(1)}`);
    assert.equal(cancelado.historico_ocorrencia_origem, 'evento', 'evento cancelado mantém a data do fato');
    const comFuso = porId.get(`h2mov${pad(2)}`);
    assert.equal(comFuso.historico_ocorrencia, '2026-03-03', 'dia literal, sem converter 23:30-04:00 para UTC');
    const ambiguo = porId.get(`h2mov${pad(5)}`);
    assert.equal(ambiguo.historico_ocorrencia_origem, 'data_movimentacao', 'vínculo ambíguo não usa o evento');
    assert.equal(ambiguo.historico_ocorrencia, '2026-02-14');
    for (const m of itens) {
      assert.match(m.historico_registrado_em, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      if (m.historico_ocorrencia !== null) assert.match(m.historico_ocorrencia, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.equal(porId.get(`h2mov${pad(0)}`).historico_registrado_em, new Date(Date.parse('2026-01-10T10:00:00.000Z') - 5000).toISOString(), 'registro = registrado_em do evento');
  });

  test('empates exatos: desempate binário por id, estável entre páginas de tamanho 7', async () => {
    const c = await cenario();
    const esperado = await montarMassa(c, { quantidade: 63 });
    const { itens } = await todasAsPaginas(c.token, { empresa_id: c.empresa.id, area_id: 'area-A', limit: 7 });
    assert.deepEqual(itens.map((m) => m.id), esperado.map((e) => e.id));
  });

  test('COUNT e filtros inalterados: total = conjunto filtrado; filtro de lote por id idêntico', async () => {
    const c = await cenario();
    const esperado = await montarMassa(c, { quantidade: 40 });
    const r = await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-A' });
    assert.equal(r.json().total, esperado.length);
    assert.equal(r.json().ordem, 'ocorrencia_desc_v2');
    const porLote = await historico(c.token, { empresa_id: c.empresa.id, lote_ids: 'lote-L' });
    assert.equal(porLote.json().total, esperado.length);
    assert.equal(new Set(porLote.json().items.map((m) => m.id)).size, porLote.json().items.length, 'JOIN não multiplica');
  });
});

describe('H2 — cursor v2', () => {
  const primeiraPagina = async (c, extra = {}) => {
    const r = await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-A', limit: 5, ...extra });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const motivo = (r) => {
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(r.json().code ?? r.json().error?.code, 'HISTORICO_CURSOR_INVALIDO', r.body);
    return (r.json().details ?? r.json().error?.details)?.motivo;
  };

  test('cursor v1 (createdAt+id) → 400 estável versao_antiga', async () => {
    const c = await cenario();
    await montarMassa(c, { quantidade: 20 });
    const v1 = codificarCursor({ createdAt: new Date(), id: 'h2mov0001' });
    assert.equal(motivo(await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-A', cursor: v1 })), 'versao_antiga');
  });

  test('cursor malformado e adulterado → 400', async () => {
    const c = await cenario();
    await montarMassa(c, { quantidade: 20 });
    const p = await primeiraPagina(c);
    assert.equal(motivo(await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-A', cursor: 'nao-e-cursor' })), 'malformado');
    const obj = JSON.parse(Buffer.from(p.next_cursor, 'base64url').toString('utf8'));
    const adulterado = Buffer.from(JSON.stringify({ ...obj, i: 'h2mov0000' }), 'utf8').toString('base64url');
    assert.equal(motivo(await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-A', cursor: adulterado })), 'adulterado');
    const versaoFutura = Buffer.from(JSON.stringify({ ...obj, v: 3 }), 'utf8').toString('base64url');
    assert.equal(motivo(await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-A', cursor: versaoFutura })), 'malformado');
  });

  test('mudança de escopo (área, lotes, empresa, tenant) → 400 escopo_divergente / sem vazamento', async () => {
    const c = await cenario();
    await montarMassa(c, { quantidade: 20 });
    const p = await primeiraPagina(c);
    assert.equal(motivo(await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-B', cursor: p.next_cursor })), 'escopo_divergente');
    assert.equal(motivo(await historico(c.token, { empresa_id: c.empresa.id, lote_ids: 'lote-L', cursor: p.next_cursor })), 'escopo_divergente');
    const empresa2 = await getPrismaClient().empresa.create({ data: { cliente_id: c.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'E2', nome: 'E2' } });
    assert.equal(motivo(await historico(c.token, { empresa_id: empresa2.id, area_id: 'area-A', cursor: p.next_cursor })), 'escopo_divergente');
    const outro = await cenario(1);
    assert.equal(motivo(await historico(outro.token, { empresa_id: c.empresa.id, area_id: 'area-A', cursor: p.next_cursor })), 'escopo_divergente');
  });

  test('fim da paginação: última página sem cursor; página vazia fica vazia', async () => {
    const c = await cenario();
    await montarMassa(c, { quantidade: 10 });
    const { itens, paginas } = await todasAsPaginas(c.token, { empresa_id: c.empresa.id, area_id: 'area-A', limit: 4 });
    assert.equal(itens.length, 12);
    assert.equal(paginas, 3);
    const vazio = await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-Z' });
    assert.deepEqual([vazio.json().items.length, vazio.json().next_cursor, vazio.json().has_more, vazio.json().total], [0, null, false, 0]);
  });
});

describe('H2 — isolamento tenant/empresa e evento de outro escopo', () => {
  test('evento de outra empresa ou outro tenant nunca empresta a data; itens só do escopo', async () => {
    const a = await cenario(1);
    const b = await cenario(1);
    const prisma = getPrismaClient();
    const empresa2 = await prisma.empresa.create({ data: { cliente_id: a.cliente.id, numero_empresa: 2, fuso_horario: 'America/Sao_Paulo', apelido: 'E2', nome: 'E2' } });
    await prisma.eventoRebanho.createMany({
      data: [
        { id: 'evOutraEmpresa', cliente_id: a.cliente.id, empresa_id: empresa2.id, tipo: 'TRANSFERENCIA', data_operacional: new Date('2030-01-01T00:00:00.000Z'), operation_id: 'x1', movimentacao_id: 'movA1' },
        { id: 'evOutroTenant', cliente_id: b.cliente.id, empresa_id: b.empresa.id, tipo: 'TRANSFERENCIA', data_operacional: new Date('2030-01-01T00:00:00.000Z'), operation_id: 'x2', movimentacao_id: 'movA2' },
      ],
    });
    await prisma.movimentacaoMapa.createMany({
      data: [
        { id: 'movA1', cliente_id: a.cliente.id, empresa_id: a.empresa.id, dados: { tipo: 'Pesagem', area_origem_id: 'area-A', data_movimentacao: '2026-01-01', efeito_servidor: { evento_id: 'evOutraEmpresa' } } },
        { id: 'movA2', cliente_id: a.cliente.id, empresa_id: a.empresa.id, dados: { tipo: 'Pesagem', area_origem_id: 'area-A', data_movimentacao: '2026-01-02', efeito_servidor: { evento_id: 'evOutroTenant' } } },
        { id: 'movE2', cliente_id: a.cliente.id, empresa_id: empresa2.id, dados: { tipo: 'Pesagem', area_origem_id: 'area-A', data_movimentacao: '2026-01-03' } },
        { id: 'movB1', cliente_id: b.cliente.id, empresa_id: b.empresa.id, dados: { tipo: 'Pesagem', area_origem_id: 'area-A', data_movimentacao: '2026-01-04' } },
      ],
    });
    const r = await historico(a.token, { empresa_id: a.empresa.id, area_id: 'area-A' });
    assert.equal(r.json().total, 2);
    assert.deepEqual(r.json().items.map((m) => [m.id, m.historico_ocorrencia, m.historico_ocorrencia_origem]), [
      ['movA2', '2026-01-02', 'data_movimentacao'],
      ['movA1', '2026-01-01', 'data_movimentacao'],
    ]);
    const cruzado = await historico(a.token, { empresa_id: b.empresa.id, area_id: 'area-A' });
    assert.equal(cruzado.json().total, 0);
  });

  test('valor homônimo gravado em dados não vence o calculado pelo servidor', async () => {
    const c = await cenario();
    await getPrismaClient().movimentacaoMapa.create({
      data: { id: 'movSpoof', cliente_id: c.cliente.id, empresa_id: c.empresa.id, dados: { tipo: 'Pesagem', area_origem_id: 'area-A', historico_ocorrencia: '2099-01-01', historico_registrado_em: 'x' } },
    });
    const item = (await historico(c.token, { empresa_id: c.empresa.id, area_id: 'area-A' })).json().items[0];
    assert.equal(item.historico_ocorrencia, null);
    assert.match(item.historico_registrado_em, /^\d{4}-/);
  });
});

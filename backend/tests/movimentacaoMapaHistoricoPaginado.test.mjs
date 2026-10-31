/**
 * GET /movimentacoes-mapa/historico — leitura paginada (D-PROD-94), PostgreSQL real.
 *
 * Dados sintéticos. Nenhum teste aqui grava saldo de lote: os movimentos são
 * inseridos direto na tabela, como fixture de leitura.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

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
    data: { cliente_id: cliente.id, numero_empresa: numeroEmpresa, apelido: `FAZ${numeroEmpresa}`, nome: `Fazenda ${numeroEmpresa}` },
  });
  return { token: corpo.token, cliente, empresa };
};

let relogio = Date.parse('2026-01-01T12:00:00.000Z');
/** createdAt crescente e explícito: a ordem do teste não depende do relógio. */
const mov = (cliente, empresa, dados, createdAt) => ({
  cliente_id: cliente.id,
  empresa_id: empresa.id,
  dados,
  createdAt: createdAt ?? new Date((relogio += 1000)),
});

const historico = async (token, query) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item));
  }
  return app.inject({ method: 'GET', url: `/movimentacoes-mapa/historico?${qs}`, headers: auth(token) });
};

describe('histórico — cenário 500 cabeças (transferência parcial, pesagem, transferência total)', () => {
  test('área A mostra as saídas e a pesagem; área B as entradas; cabeças não duplicam', async () => {
    const { token, cliente, empresa } = await cenario();
    const prisma = getPrismaClient();
    // Lote L (500) na área A. 50 vão para B (lote derivado em B); pesagem na
    // origem com os 450; depois os 450 vão para B. Nenhum saldo é gravado.
    await prisma.movimentacaoMapa.createMany({
      data: [
        mov(cliente, empresa, { tipo: 'Transferência de Área', lote: 'L', lote_id: 'lote-L', quantidade_animais: 50, area_origem_id: 'area-A', area_destino_id: 'area-B', data_movimentacao: '2026-02-01T12:00:00.000Z' }),
        mov(cliente, empresa, { tipo: 'Pesagem', lote: 'L', lote_id: 'lote-L', quantidade_animais: 450, area_origem_id: 'area-A', data_movimentacao: '2026-02-01T12:00:00.000Z' }),
        mov(cliente, empresa, { tipo: 'Transferência de Área', lote: 'L', lote_id: 'lote-L', quantidade_animais: 450, area_origem_id: 'area-A', area_destino_id: 'area-B', data_movimentacao: '2026-02-03T12:00:00.000Z' }),
      ],
    });

    const a = await historico(token, { empresa_id: empresa.id, area_id: 'area-A' });
    const b = await historico(token, { empresa_id: empresa.id, area_id: 'area-B' });
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(a.json().total, 3);
    assert.equal(b.json().total, 2);

    const saidasA = a.json().items.filter((m) => m.tipo === 'Transferência de Área' && m.area_origem_id === 'area-A');
    const entradasB = b.json().items.filter((m) => m.area_destino_id === 'area-B');
    const soma = (lista) => lista.reduce((s, m) => s + m.quantidade_animais, 0);
    assert.equal(soma(saidasA), 500, 'saídas de A = 50 + 450');
    assert.equal(soma(entradasB), 500, 'entradas em B = 50 + 450, sem duplicar');
    assert.equal(new Set([...a.json().items, ...b.json().items].map((m) => m.id)).size, 3, 'o mesmo fato tem um só id');
    // Área A ficou vazia, mas não perde nada: o filtro é pela área, não pela lotação atual.
    assert.ok(a.json().items.some((m) => m.tipo === 'Pesagem'));
    assert.equal(a.json().has_more, false);
  });
});

describe('histórico — paginação keyset com total (sem truncar em silêncio)', () => {
  test('520 movimentos: páginas de 200 cobrem tudo, sem repetir nem pular, com createdAt empatado', async () => {
    const { token, cliente, empresa } = await cenario();
    const empatado = new Date('2026-03-01T12:00:00.000Z');
    const linhas = Array.from({ length: 520 }, (_, i) =>
      mov(
        cliente,
        empresa,
        { tipo: 'Pesagem', lote: 'L', lote_id: 'lote-L', area_origem_id: 'area-A', quantidade_animais: 1, seq: i },
        i < 30 ? empatado : undefined
      )
    );
    await getPrismaClient().movimentacaoMapa.createMany({ data: linhas });

    const vistos = new Set();
    let cursor;
    let paginas = 0;
    do {
      const r = await historico(token, { empresa_id: empresa.id, area_id: 'area-A', limit: 200, ...(cursor ? { cursor } : {}) });
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().total, 520, 'total é do conjunto filtrado, em toda página');
      for (const item of r.json().items) {
        assert.equal(vistos.has(item.id), false, 'sem repetição entre páginas');
        vistos.add(item.id);
      }
      cursor = r.json().next_cursor;
      paginas += 1;
    } while (cursor);
    assert.equal(vistos.size, 520);
    assert.equal(paginas, 3);
  });

  test('limit acima do teto é recusado; padrão é 100', async () => {
    const { token, empresa } = await cenario();
    assert.equal((await historico(token, { empresa_id: empresa.id, limit: 201 })).statusCode, 400);
    const r = await historico(token, { empresa_id: empresa.id });
    assert.equal(r.json().limit, 100);
  });

  test('cursor adulterado → 400', async () => {
    const { token, empresa } = await cenario();
    const r = await historico(token, { empresa_id: empresa.id, cursor: 'nao-e-cursor' });
    assert.equal(r.statusCode, 400);
  });
});

describe('histórico — vínculo de lote por ID; nome só para legado sem id', () => {
  test('homônimo com outro lote_id nunca entra; legado sem lote_id entra pelo nome', async () => {
    const { token, cliente, empresa } = await cenario();
    await getPrismaClient().movimentacaoMapa.createMany({
      data: [
        mov(cliente, empresa, { tipo: 'Pesagem', lote: 'NELORE', lote_id: 'lote-1', area_origem_id: 'area-A' }),
        mov(cliente, empresa, { tipo: 'Pesagem', lote: 'NELORE', lote_id: 'lote-2-homonimo', area_origem_id: 'area-C' }),
        mov(cliente, empresa, { tipo: 'Morte', lote: ' Nelore ', area_origem_id: 'area-A' }),
      ],
    });
    const r = await historico(token, { empresa_id: empresa.id, lote_ids: 'lote-1', lote_nomes: 'NELORE' });
    assert.equal(r.statusCode, 200, r.body);
    const ids = r.json().items.map((m) => m.lote_id ?? 'legado');
    assert.deepEqual(ids.sort(), ['legado', 'lote-1']);
  });
});

describe('histórico — isolamento', () => {
  test('outra empresa do mesmo tenant e outro tenant não aparecem; empresa alheia devolve vazio', async () => {
    const a = await cenario(1);
    const prisma = getPrismaClient();
    const empresa2 = await prisma.empresa.create({ data: { cliente_id: a.cliente.id, numero_empresa: 2, apelido: 'OUTRA', nome: 'Outra' } });
    const b = await cenario(1);
    await prisma.movimentacaoMapa.createMany({
      data: [
        mov(a.cliente, a.empresa, { tipo: 'Pesagem', lote: 'L', lote_id: 'x', area_origem_id: 'area-A' }),
        mov(a.cliente, empresa2, { tipo: 'Pesagem', lote: 'L', lote_id: 'x', area_origem_id: 'area-A' }),
        mov(b.cliente, b.empresa, { tipo: 'Pesagem', lote: 'L', lote_id: 'x', area_origem_id: 'area-A' }),
      ],
    });
    const r = await historico(a.token, { empresa_id: a.empresa.id, area_id: 'area-A' });
    assert.equal(r.json().total, 1);
    assert.equal(r.json().items[0].empresa_id, a.empresa.id);
    assert.equal(r.json().items[0].cliente_id, undefined);

    // Empresa do tenant B pedida com o token de A: o tenant vem do token (R11).
    const cruzado = await historico(a.token, { empresa_id: b.empresa.id });
    assert.equal(cruzado.statusCode, 200);
    assert.equal(cruzado.json().total, 0);
  });

  test('cliente_id na query → 400; sem token → 401; sem empresa_id → 400', async () => {
    const { token, cliente, empresa } = await cenario();
    assert.equal((await historico(token, { empresa_id: empresa.id, cliente_id: cliente.id })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: `/movimentacoes-mapa/historico?empresa_id=${empresa.id}` })).statusCode, 401);
    assert.equal((await historico(token, {})).statusCode, 400);
  });
});

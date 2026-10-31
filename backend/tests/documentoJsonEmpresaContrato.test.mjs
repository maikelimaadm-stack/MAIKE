/**
 * Contrato de leitura dos documentos JSON tenant-scoped (MAIKE-MAPA-HISTORICO-
 * MOVIMENTACOES-R1, D-PROD-94) — PostgreSQL real.
 *
 * Causa raiz do histórico vazio: `montarDocumento` tira `empresa_id` do corpo e
 * grava só na COLUNA; `documentoComoPublico` devolvia apenas `dados`, então
 * nenhum documento lido trazia `empresa_id`. Todo consumidor que filtra
 * `item.empresa_id === empresaSelecionada` (histórico do lote, cache do mapa)
 * descartava 100% dos registros.
 *
 * O contrato fixado aqui: `empresa_id` público = coluna autoritativa, nunca o
 * que estiver dentro de `dados`; `cliente_id` nunca sai.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { documentoComoPublico } from '../src/shared/jsonDocument/jsonDocumentPublic.js';

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

/** Todas as rotas que servem documentos pela função compartilhada. */
const ROTAS_JSON = Object.freeze([
  '/movimentacoes-mapa',
  '/movimentacoes-pecuaria',
  '/suplementacao-eventos',
  '/suplementacao-lotes',
  '/aplicacoes-medicamento',
  '/eventos-sanitarios',
  '/manejos-tecnico-rebanho',
  '/bebedouros-historico',
  '/bebedouros-alertas',
  '/bebedouros-sanidade',
]);

const cenario = async () => {
  const prisma = getPrismaClient();
  const { cliente, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  const empresa = await prisma.empresa.create({ data: { cliente_id: cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  return { token: corpo.token, cliente, empresa };
};

describe('documentoComoPublico — unidade', () => {
  test('empresa_id vem da coluna; dados.empresa_id conflitante e cliente_id não vazam', () => {
    const publico = documentoComoPublico({
      id: 'm1',
      cliente_id: 'cli-A',
      empresa_id: 'emp-coluna',
      dados: { tipo: 'Pesagem', empresa_id: 'emp-forjada', cliente_id: 'cli-B', id: 'outro', created_date: 'x' },
      createdAt: new Date('2026-10-31T12:00:00.000Z'),
      updatedAt: new Date('2026-10-31T12:00:01.000Z'),
    });
    assert.equal(publico.empresa_id, 'emp-coluna');
    assert.equal(publico.id, 'm1');
    assert.equal(publico.tipo, 'Pesagem');
    assert.equal(publico.created_date, '2026-10-31T12:00:00.000Z');
    assert.equal(Object.prototype.hasOwnProperty.call(publico, 'cliente_id'), false);
  });
});

describe('rotas JSON — empresa_id na leitura (todas as consumidoras do serializador)', () => {
  for (const rota of ROTAS_JSON) {
    test(`${rota}: POST e GET devolvem empresa_id da coluna, sem cliente_id`, async () => {
      const { token, empresa } = await cenario();
      const criado = await app.inject({
        method: 'POST',
        url: rota,
        headers: auth(token),
        payload: { empresa_id: empresa.id, observacoes: 'sintético' },
      });
      assert.equal(criado.statusCode, 201, criado.body);
      assert.equal(criado.json().empresa_id, empresa.id, 'resposta do POST');
      assert.equal(criado.json().cliente_id, undefined);

      const lista = await app.inject({ method: 'GET', url: rota, headers: auth(token) });
      assert.equal(lista.statusCode, 200);
      assert.equal(lista.json().length, 1);
      assert.equal(lista.json()[0].empresa_id, empresa.id, 'resposta do GET');
      assert.equal(lista.json()[0].cliente_id, undefined);
      assert.equal(lista.json()[0].observacoes, 'sintético');
    });
  }
});

describe('MovimentacaoMapa — registros reais sem empresa_id em dados', () => {
  test('linha gravada só com a coluna (formato real de produção) é lida com empresa_id', async () => {
    const { token, cliente, empresa } = await cenario();
    await getPrismaClient().movimentacaoMapa.create({
      data: {
        cliente_id: cliente.id,
        empresa_id: empresa.id,
        dados: { tipo: 'Transferência de Área', lote: 'L1', lote_id: 'lote-1', quantidade_animais: 50, area_origem_id: 'a1', area_destino_id: 'a2' },
      },
    });
    const r = await app.inject({ method: 'GET', url: '/movimentacoes-mapa', headers: auth(token) });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json()[0].empresa_id, empresa.id);
  });

  test('dados.empresa_id forjado de outra empresa não sobrescreve a coluna', async () => {
    const { token, cliente, empresa } = await cenario();
    await getPrismaClient().movimentacaoMapa.create({
      data: { cliente_id: cliente.id, empresa_id: empresa.id, dados: { tipo: 'Pesagem', empresa_id: 'empresa-de-outro', cliente_id: 'outro-tenant' } },
    });
    const r = await app.inject({ method: 'GET', url: '/movimentacoes-mapa', headers: auth(token) });
    assert.equal(r.json()[0].empresa_id, empresa.id);
    assert.equal(r.json()[0].cliente_id, undefined);
  });

  test('PATCH sem empresa_id no corpo preserva a coluna (antes: 400 empresa_id é obrigatório)', async () => {
    const { token, empresa } = await cenario();
    const criado = await app.inject({
      method: 'POST',
      url: '/movimentacoes-mapa',
      headers: auth(token),
      payload: { empresa_id: empresa.id, tipo: 'Pesagem', lote: 'L1', observacoes: 'antes' },
    });
    const id = criado.json().id;
    const r = await app.inject({ method: 'PATCH', url: `/movimentacoes-mapa/${id}`, headers: auth(token), payload: { observacoes: 'depois' } });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().empresa_id, empresa.id);
    assert.equal(r.json().observacoes, 'depois');
    const linha = await getPrismaClient().movimentacaoMapa.findFirst({ where: { id } });
    assert.equal(linha.empresa_id, empresa.id);
    assert.equal(/** @type {any} */ (linha.dados).empresa_id, undefined, 'empresa_id continua só na coluna');
  });

  test('outro tenant não lê os documentos', async () => {
    const a = await cenario();
    const b = await cenario();
    await app.inject({ method: 'POST', url: '/movimentacoes-mapa', headers: auth(a.token), payload: { empresa_id: a.empresa.id, tipo: 'Pesagem' } });
    const r = await app.inject({ method: 'GET', url: '/movimentacoes-mapa', headers: auth(b.token) });
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json(), []);
  });
});

/**
 * Lote gerado por manejo — integridade no servidor (PostgreSQL real).
 *
 * Caso real: lote 1 (AJUSTE) entrou com 500; transferência parcial de 50 criou
 * o lote 2 (origem MOVIMENTAÇÃO). A MovimentacaoMapa referencia SÓ o lote 1.
 * Antes: DELETE /lotes/<lote 2> passava (nenhum vínculo próprio) e sumia com
 * 50 cabeças; PATCH podia trocar a origem e mudar a conta histórica em silêncio.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { origemDerivadaDeManejo } from '../src/modules/lotes/loteOrigem.js';
import { ehLoteDerivadoDeManejo } from '../../src/domain/lotes/saldoLote.js';

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

const tenant = async () => {
  const { cliente, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, token: corpo.token };
};

const criarLote = async (token, payload) => {
  const r = await app.inject({
    method: 'POST',
    url: '/lotes',
    headers: auth(token),
    payload: { empresa_id: 'emp-1', nome: 'TESTE', motivo_entrada: 'Ajuste', ...payload },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
};

/** Lote 1 (500 → 450) + lote 2 derivado (50) + transferência que cita só o lote 1. */
const casoReal = async (token, clienteId, origemDerivado = 'MOVIMENTAÇÃO') => {
  const lote1 = await criarLote(token, { quantidade_cabecas: 500, origem: 'AJUSTE' });
  const lote2 = await criarLote(token, { quantidade_cabecas: 50, origem: origemDerivado, motivo_entrada: 'Outros' });
  // Escrita real do mapa: debita a origem com PATCH de quantidade_cabecas.
  const debito = await app.inject({ method: 'PATCH', url: `/lotes/${lote1.id}`, headers: auth(token), payload: { quantidade_cabecas: 450, estado_esperado: { quantidade_cabecas: 500 } } });
  assert.equal(debito.statusCode, 200, 'PATCH de saldo do mapa continua permitido');
  await getPrismaClient().movimentacaoMapa.create({
    data: {
      cliente_id: clienteId,
      empresa_id: 'emp-1',
      dados: { tipo: 'Transferência de Área', lote_id: lote1.id, quantidade_animais: 50 },
    },
  });
  return { lote1, lote2 };
};

const cabecasDoTenant = async (clienteId) => {
  const lotes = await getPrismaClient().lote.findMany({ where: { cliente_id: clienteId }, select: { quantidade_cabecas: true } });
  return lotes.reduce((t, l) => t + l.quantidade_cabecas, 0);
};

describe('Lote gerado por manejo — exclusão bloqueada no servidor', () => {
  test('caso real: DELETE do lote 2 (sem vínculo próprio) → 409 LOTE_DELETE_BLOCKED; 500 cabeças e registros preservados', async () => {
    const { cliente, token } = await tenant();
    const { lote2 } = await casoReal(token, cliente.id);
    assert.equal(await cabecasDoTenant(cliente.id), 500);

    const del = await app.inject({ method: 'DELETE', url: `/lotes/${lote2.id}`, headers: auth(token) });
    assert.equal(del.statusCode, 409);
    assert.equal(del.json().code, 'LOTE_DELETE_BLOCKED');
    assert.equal(del.json().details?.vinculo, 'lote_gerado_por_manejo');

    const prisma = getPrismaClient();
    assert.equal(await cabecasDoTenant(cliente.id), 500, 'nenhuma cabeça some');
    assert.equal(await prisma.lote.count({ where: { cliente_id: cliente.id } }), 2);
    assert.equal(await prisma.movimentacaoMapa.count({ where: { cliente_id: cliente.id } }), 1);
  });

  test('todas as origens derivadas, com e sem acento/caixa, são bloqueadas', async () => {
    const { cliente, token } = await tenant();
    for (const origem of ['movimentacao', 'REVERSÃO MOVIMENTAÇÃO', 'Mudança de Categoria', 'EDIÇÃO MOVIMENTAÇÃO', ' Movimentação ']) {
      const lote = await criarLote(token, { quantidade_cabecas: 5, origem, motivo_entrada: 'Outros' });
      const del = await app.inject({ method: 'DELETE', url: `/lotes/${lote.id}`, headers: auth(token) });
      assert.equal(del.statusCode, 409, origem);
      assert.equal(del.json().details?.vinculo, 'lote_gerado_por_manejo', origem);
    }
    assert.equal(await getPrismaClient().lote.count({ where: { cliente_id: cliente.id } }), 5);
  });

  test('controles: lote manual sem vínculo e lote de Nascimento continuam excluíveis; lote manual com vínculo segue bloqueado pelo vínculo', async () => {
    const { cliente, token } = await tenant();
    const manual = await criarLote(token, { quantidade_cabecas: 10, origem: 'COMPRA', motivo_entrada: 'Compra' });
    const nascimento = await criarLote(token, { quantidade_cabecas: 3, origem: 'Nascimento', motivo_entrada: 'Outros' });
    for (const lote of [manual, nascimento]) {
      const del = await app.inject({ method: 'DELETE', url: `/lotes/${lote.id}`, headers: auth(token) });
      assert.equal(del.statusCode, 204, lote.origem);
    }
    const { lote1 } = await casoReal(token, cliente.id);
    const delOrigem = await app.inject({ method: 'DELETE', url: `/lotes/${lote1.id}`, headers: auth(token) });
    assert.equal(delOrigem.statusCode, 409);
    assert.equal(delOrigem.json().details?.vinculo, 'movimentacoes_mapa');
  });

  test('tenant: outro cliente não exclui nem descobre o lote derivado (404, não 409)', async () => {
    const a = await tenant();
    const b = await tenant();
    const { lote2 } = await casoReal(a.token, a.cliente.id);
    const del = await app.inject({ method: 'DELETE', url: `/lotes/${lote2.id}`, headers: auth(b.token) });
    assert.equal(del.statusCode, 404);
    assert.equal(await cabecasDoTenant(a.cliente.id), 500);
  });
});

describe('PATCH /lotes — classe da origem e entrada histórica imutáveis', () => {
  test('lote sem histórico: trocar a classe da origem (entrada ↔ gerado por manejo) → 400; dentro da mesma classe → 200', async () => {
    const { token } = await tenant();
    const livre = await criarLote(token, { quantidade_cabecas: 10, origem: 'AJUSTE' });
    const p1 = await app.inject({ method: 'PATCH', url: `/lotes/${livre.id}`, headers: auth(token), payload: { origem: 'MOVIMENTAÇÃO' } });
    assert.equal(p1.statusCode, 400);
    assert.equal(p1.json().code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(p1.json().field, 'origem');
    const p2 = await app.inject({ method: 'PATCH', url: `/lotes/${livre.id}`, headers: auth(token), payload: { origem: 'COMPRA', motivo_entrada: 'Compra' } });
    assert.equal(p2.statusCode, 200);
    assert.equal(p2.json().origem, 'COMPRA');
  });

  test('entrada histórica fora do schema de PATCH (400): quantidade_entrada e area_entrada_id', async () => {
    const { token } = await tenant();
    const livre = await criarLote(token, { quantidade_cabecas: 500, origem: 'AJUSTE' });
    for (const payload of [{ quantidade_entrada: 9999, nome: 'TESTE' }, { area_entrada_id: 'qualquer' }]) {
      const r = await app.inject({ method: 'PATCH', url: `/lotes/${livre.id}`, headers: auth(token), payload });
      assert.equal(r.statusCode, 400, JSON.stringify(payload));
      assert.equal(r.json().code, 'REQUEST_VALIDATION_FAILED');
    }
    assert.equal((await getPrismaClient().lote.findFirst({ where: { id: livre.id } })).quantidade_entrada, 500);
  });
});

describe('Editar/excluir o lançamento só sem nada depois da entrada (D-PROD-87)', () => {
  const CAMPOS_CADASTRO = [
    { observacoes: 'NOTA' }, { raca_predominante: 'NELORE' }, { origem: 'COMPRA' }, { motivo_entrada: 'Compra' },
    { data_entrada: '2026-10-01T12:00:00' }, { numero_gta: '123' }, { idade_media_meses: 12 }, { sistema_produtivo: 'Cria' },
  ];

  test('lote 1 (com movimentação): PATCH de campo do cadastro → 409 LOTE_UPDATE_BLOCKED, nada muda', async () => {
    const { cliente, token } = await tenant();
    const { lote1 } = await casoReal(token, cliente.id);
    const prisma = getPrismaClient();
    const antes = await prisma.lote.findFirst({ where: { id: lote1.id } });
    for (const payload of CAMPOS_CADASTRO) {
      const r = await app.inject({ method: 'PATCH', url: `/lotes/${lote1.id}`, headers: auth(token), payload });
      assert.equal(r.statusCode, 409, JSON.stringify(payload));
      assert.equal(r.json().code, 'LOTE_UPDATE_BLOCKED');
      assert.equal(r.json().details?.vinculo, 'movimentacoes_mapa');
    }
    assert.deepEqual(await prisma.lote.findFirst({ where: { id: lote1.id } }), antes);
  });

  test('lote 2 (gerado por manejo): editar → 409 (lote_gerado_por_manejo); excluir → 409', async () => {
    const { cliente, token } = await tenant();
    const { lote2 } = await casoReal(token, cliente.id);
    const r = await app.inject({ method: 'PATCH', url: `/lotes/${lote2.id}`, headers: auth(token), payload: { origem: 'OUTROS' } });
    assert.equal(r.statusCode, 409);
    assert.equal(r.json().code, 'LOTE_UPDATE_BLOCKED');
    assert.equal(r.json().details?.vinculo, 'lote_gerado_por_manejo');
    assert.equal((await getPrismaClient().lote.findFirst({ where: { id: lote2.id } })).origem, 'MOVIMENTAÇÃO');
  });

  test('destino de unificação (recebeu cabeças, nenhum registro o cita): editar e excluir → 409 lote_com_manejo', async () => {
    const { token } = await tenant();
    const destino = await criarLote(token, { quantidade_cabecas: 30, origem: 'COMPRA', motivo_entrada: 'Compra' });
    // Escrita real do mapa ao unificar: só soma o saldo do destino.
    const soma = await app.inject({ method: 'PATCH', url: `/lotes/${destino.id}`, headers: auth(token), payload: { quantidade_cabecas: 80, estado_esperado: { quantidade_cabecas: 30 } } });
    assert.equal(soma.statusCode, 200);
    const ed = await app.inject({ method: 'PATCH', url: `/lotes/${destino.id}`, headers: auth(token), payload: { observacoes: 'X' } });
    assert.equal(ed.statusCode, 409);
    assert.equal(ed.json().details?.vinculo, 'lote_com_manejo');
    const del = await app.inject({ method: 'DELETE', url: `/lotes/${destino.id}`, headers: auth(token) });
    assert.equal(del.statusCode, 409);
    assert.equal(del.json().code, 'LOTE_DELETE_BLOCKED');
    assert.equal(del.json().details?.vinculo, 'lote_com_manejo');
  });

  test('lote sem nada depois da entrada: editar o lançamento → 200; excluir → 204', async () => {
    const { token } = await tenant();
    const livre = await criarLote(token, { quantidade_cabecas: 40, origem: 'COMPRA', motivo_entrada: 'Compra' });
    for (const payload of CAMPOS_CADASTRO) {
      const r = await app.inject({ method: 'PATCH', url: `/lotes/${livre.id}`, headers: auth(token), payload });
      assert.equal(r.statusCode, 200, JSON.stringify(payload));
    }
    const del = await app.inject({ method: 'DELETE', url: `/lotes/${livre.id}`, headers: auth(token) });
    assert.equal(del.statusCode, 204);
  });

  test('manejos do mapa continuam gravando no lote com histórico (saldo, status, nome) e o histórico fica intacto', async () => {
    const { cliente, token } = await tenant();
    const { lote1, lote2 } = await casoReal(token, cliente.id);
    const prisma = getPrismaClient();
    const movAntes = await prisma.movimentacaoMapa.count({ where: { cliente_id: cliente.id } });
    const r1 = await app.inject({ method: 'PATCH', url: `/lotes/${lote2.id}`, headers: auth(token), payload: { quantidade_cabecas: 0, status: 'Inativo', estado_esperado: { quantidade_cabecas: 50, status: 'Ativo' } } });
    assert.equal(r1.statusCode, 200);
    const r2 = await app.inject({ method: 'PATCH', url: `/lotes/${lote1.id}`, headers: auth(token), payload: { quantidade_cabecas: 500, nome: 'TESTE RENOMEADO', estado_esperado: { quantidade_cabecas: 450 } } });
    assert.equal(r2.statusCode, 200);
    assert.equal(r2.json().quantidade_entrada, 500);
    assert.equal(await prisma.movimentacaoMapa.count({ where: { cliente_id: cliente.id } }), movAntes);
  });
});

describe('Cadastro = entrada (D-PROD-85): POST não gera manejo', () => {
  test('POST de entrada cria exatamente um lote e nenhuma movimentação, transferência ou lote derivado', async () => {
    const { cliente, token } = await tenant();
    const prisma = getPrismaClient();
    const antes = {
      lotes: await prisma.lote.count({ where: { cliente_id: cliente.id } }),
      mapa: await prisma.movimentacaoMapa.count({ where: { cliente_id: cliente.id } }),
      pecuaria: await prisma.movimentacaoPecuaria.count({ where: { cliente_id: cliente.id } }),
    };
    const lote = await criarLote(token, { quantidade_cabecas: 500, origem: 'COMPRA', motivo_entrada: 'Compra' });
    assert.equal(lote.quantidade_entrada, 500);
    assert.equal(lote.quantidade_cabecas, 500);
    assert.equal(await prisma.lote.count({ where: { cliente_id: cliente.id } }), antes.lotes + 1);
    assert.equal(await prisma.movimentacaoMapa.count({ where: { cliente_id: cliente.id } }), antes.mapa);
    assert.equal(await prisma.movimentacaoPecuaria.count({ where: { cliente_id: cliente.id } }), antes.pecuaria);
  });
});

describe('paridade da regra de origem: servidor × frontend', () => {
  test('mesma classificação para a tabela de origens', () => {
    const origens = [
      'MOVIMENTAÇÃO', 'Movimentacao', ' movimentação ', 'REVERSÃO MOVIMENTAÇÃO', 'Reversao Movimentacao',
      'Mudança de Categoria', 'MUDANCA DE CATEGORIA', 'EDIÇÃO MOVIMENTAÇÃO', 'Edicao Movimentacao',
      'Nascimento', 'NASCIMENTO', 'COMPRA', 'AJUSTE', 'INVENTÁRIO', 'OUTROS', '', null, undefined,
    ];
    for (const origem of origens) {
      assert.equal(origemDerivadaDeManejo(origem), ehLoteDerivadoDeManejo({ origem }), String(origem));
    }
    assert.equal(origemDerivadaDeManejo('Nascimento'), false);
    assert.equal(origemDerivadaDeManejo('MOVIMENTAÇÃO'), true);
  });
});

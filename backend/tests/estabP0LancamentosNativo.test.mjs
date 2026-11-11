/**
 * ESTAB-P0-01 — comandos transacionais, idempotência, limit SQL, GET lote por id.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

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

const tenantAutenticado = async () => {
  const { credenciais, cliente } = await criarTenant({ papelTenant: 'administrador' }); // R2: o preparo usa rotas legadas só do administrador real
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { token: corpo.token, clienteId: cliente.id };
};

/**
 * D-PROD-161 (MAIKE-ESTOQUE-P0-01, F3): o cadastro de produto não credita
 * estoque e o POST genérico de lote foi cortado (409). O saldo inicial do
 * cenário vira FIXTURE DE BANCO coerente — lote + `estoque_atual` —, como os
 * demais cenários da P3 (`loteLegado`).
 */
const seedMinimoEstoque = async (token, clienteId) => {
  const emp = await app.inject({
    method: 'POST',
    url: '/empresas',
    headers: auth(token),
    payload: { apelido: 'F1', nome: 'FAZENDA ESTAB', tipo_pessoa: 'Jurídica' },
  });
  assert.equal(emp.statusCode, 201);
  const empresaId = emp.json().id;

  const local = await app.inject({
    method: 'POST',
    url: '/locais-estoque',
    headers: auth(token),
    payload: { nome: 'DEPOSITO A', ativo: true },
  });
  assert.equal(local.statusCode, 201);
  const localId = local.json().id;

  const prod = await app.inject({
    method: 'POST',
    url: '/produtos',
    headers: auth(token),
    payload: {
      empresa_id: empresaId,
      nome_produto: 'SAL MINERAL',
      estoque_minimo: 0,
      unidade_principal_estoque: 'KG',
      ativo: true,
    },
  });
  assert.equal(prod.statusCode, 201);
  const produtoId = prod.json().id;

  const prisma = getPrismaClient();
  const lote = await prisma.estoqueLoteNota.create({
    data: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      produto_id: produtoId,
      produto_nome: 'SAL MINERAL',
      local_estoque_id: localId,
      local_estoque_nome: 'DEPOSITO A',
      numero_documento: 'NF-1',
      data_documento: new Date('2026-01-15T00:00:00.000Z'),
      custo_unitario: '2.5',
      quantidade_entrada: '100',
      quantidade_disponivel: '100',
      status: 'Disponivel',
    },
  });
  await prisma.produto.update({ where: { cliente_id_id: { cliente_id: clienteId, id: produtoId } }, data: { estoque_atual: '100' } });

  return { empresaId, localId, produtoId, loteId: lote.id };
};

describe('ESTAB-P0 — contratos HTTP', () => {
  test('GET /estoque-lotes-nota?id= reprova 400 (campo não autorizado)', async () => {
    const { token } = await tenantAutenticado();
    const r = await app.inject({
      method: 'GET',
      url: '/estoque-lotes-nota?id=abc',
      headers: auth(token),
    });
    assert.equal(r.statusCode, 400);
    const corpo = r.json();
    assert.equal(corpo.code, 'REQUEST_VALIDATION_FAILED');
  });

  test('GET /estoque-lotes-nota/:id retorna lote do tenant', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const { loteId } = await seedMinimoEstoque(token, clienteId);
    const r = await app.inject({
      method: 'GET',
      url: `/estoque-lotes-nota/${loteId}`,
      headers: auth(token),
    });
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().id, loteId);
  });

  test('GET /movimentacoes-estoque?limit=1 aplica take no SQL', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const base = await seedMinimoEstoque(token, clienteId);
    const op = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque/comandos/saida-suplementacao',
      headers: auth(token),
      payload: {
        operation_id: op,
        empresa_id: base.empresaId,
        produto_id: base.produtoId,
        local_origem_id: base.localId,
        quantidade: 5,
      },
    });
    const lista = await app.inject({
      method: 'GET',
      url: '/movimentacoes-estoque?limit=1',
      headers: auth(token),
    });
    assert.equal(lista.statusCode, 200);
    assert.equal(lista.json().length, 1);
  });
});

describe('ESTAB-P0 — comando saída suplementação', () => {
  test('commit atômico + replay idempotente', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const base = await seedMinimoEstoque(token, clienteId);
    const operationId = randomUUID();
    const payload = {
      operation_id: operationId,
      empresa_id: base.empresaId,
      produto_id: base.produtoId,
      local_origem_id: base.localId,
      local_origem_nome: 'DEPOSITO A',
      quantidade: 10,
    };

    const primeiro = await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque/comandos/saida-suplementacao',
      headers: auth(token),
      payload,
    });
    assert.equal(primeiro.statusCode, 201);
    const corpo1 = primeiro.json();
    assert.equal(corpo1.committed, true);
    assert.ok(corpo1.movimentacao?.id);

    const prisma = getPrismaClient();
    const loteDepois = await prisma.estoqueLoteNota.findUnique({
      where: { cliente_id_id: { cliente_id: clienteId, id: base.loteId } },
    });
    assert.equal(Number(loteDepois.quantidade_disponivel), 90);

    const segundo = await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque/comandos/saida-suplementacao',
      headers: auth(token),
      payload,
    });
    assert.equal(segundo.statusCode, 200);
    assert.equal(segundo.json().replay, true);
    assert.equal(segundo.json().movimentacao.id, corpo1.movimentacao.id);

    const totalMov = await prisma.movimentacaoEstoque.count();
    assert.equal(totalMov, 1);
  });

  test('R1 D-PROD-90: corrida com a mesma operation_id não vira 500 nem baixa estoque duas vezes', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const base = await seedMinimoEstoque(token, clienteId);
    const payload = {
      operation_id: randomUUID(),
      empresa_id: base.empresaId,
      produto_id: base.produtoId,
      local_origem_id: base.localId,
      local_origem_nome: 'DEPOSITO A',
      quantidade: 10,
    };
    const enviar = () =>
      app.inject({
        method: 'POST',
        url: '/movimentacoes-estoque/comandos/saida-suplementacao',
        headers: auth(token),
        payload,
      });
    const respostas = await Promise.all([enviar(), enviar(), enviar()]);
    for (const r of respostas) {
      assert.ok(
        [200, 201].includes(r.statusCode) || (r.statusCode === 409 && r.json().code === 'IDEMPOTENCY_IN_PROGRESS'),
        `resposta não tipada: ${r.statusCode} ${r.body}`
      );
    }
    const prisma = getPrismaClient();
    assert.equal(await prisma.movimentacaoEstoque.count(), 1);
    const lote = await prisma.estoqueLoteNota.findUnique({
      where: { cliente_id_id: { cliente_id: clienteId, id: base.loteId } },
    });
    assert.equal(Number(lote.quantidade_disponivel), 90);
  });

  // D-PROD-161 (F3): o POST legado não grava mais nada — nem o número do
  // cliente nem um número da sequência. A numeração continua íntegra: o
  // primeiro movimento real do tenant (comando) recebe o PRIMEIRO número.
  test('POST legado recusado (409 ESTOQUE_ESCRITA_DIRETA_RECUSADA) com numero_movimentacao do cliente; sequência intacta', async () => {
    const { token, clienteId } = await tenantAutenticado();
    const base = await seedMinimoEstoque(token, clienteId);
    const r = await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque',
      headers: auth(token),
      payload: {
        empresa_id: base.empresaId,
        numero_movimentacao: '99999',
        tipo_movimentacao: 'Entrada',
        data_movimentacao: new Date().toISOString(),
        produto_id: base.produtoId,
        quantidade: 1,
        unidade_medida: 'KG',
      },
    });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ESTOQUE_ESCRITA_DIRETA_RECUSADA');
    const prisma = getPrismaClient();
    assert.equal(await prisma.movimentacaoEstoque.count({ where: { cliente_id: clienteId } }), 0, 'nenhum movimento');
    assert.equal(await prisma.entidadeCodigoSequencia.count({ where: { cliente_id: clienteId, entidade: 'MovimentacaoEstoque' } }), 0, 'sequência não reservada');
    const sup = await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque/comandos/saida-suplementacao',
      headers: auth(token),
      payload: { operation_id: randomUUID(), empresa_id: base.empresaId, produto_id: base.produtoId, local_origem_id: base.localId, quantidade: 1 },
    });
    assert.equal(sup.statusCode, 201, sup.body);
    assert.equal(sup.json().movimentacao.numero_movimentacao, '1', 'o primeiro movimento real recebe o primeiro número');
    assert.equal(await prisma.movimentacaoEstoque.count({ where: { cliente_id: clienteId, numero_movimentacao: '99999' } }), 0);
  });
});

describe('ESTAB-P0 — tarefa + histórico na mesma transação', () => {
  test('PATCH com historico_evento grava histórico sem segundo POST', async () => {
    const { token } = await tenantAutenticado();
    const grupo = await app.inject({
      method: 'POST',
      url: '/grupos-atividade',
      headers: auth(token),
      payload: { nome_grupo: 'G', ativo: true },
    });
    const tipo = await app.inject({
      method: 'POST',
      url: '/tipos-tarefa',
      headers: auth(token),
      payload: { nome_tipo: 'T', grupo_atividade_id: grupo.json().id, ativo: true },
    });

    const emp = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(token),
      payload: { apelido: 'E', nome: 'EMP', tipo_pessoa: 'Jurídica' },
    });
    const empresaId = emp.json().id;

    const criar = await app.inject({
      method: 'POST',
      url: '/lancamentos-tarefa',
      headers: auth(token),
      payload: {
        empresa_id: empresaId,
        titulo: 'Tarefa',
        tipo: 'Manejo',
        tipo_tarefa_id: tipo.json().id,
        data_pedido: '2026-10-27',
      },
    });
    const tarefaId = criar.json().id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/lancamentos-tarefa/${tarefaId}`,
      headers: auth(token),
      payload: {
        status: 'Em Andamento',
        historico_evento: 'Mudança de Status',
        historico_descricao: 'Iniciada',
        historico_data_evento: new Date().toISOString(),
      },
    });
    assert.equal(patch.statusCode, 200);

    const hist = await app.inject({
      method: 'GET',
      url: '/historicos-lancamento-tarefa?limite=10',
      headers: auth(token),
    });
    assert.equal(hist.statusCode, 200);
    assert.equal(hist.json().length, 1);
    assert.equal(hist.json()[0].evento, 'Mudança de Status');
  });
});

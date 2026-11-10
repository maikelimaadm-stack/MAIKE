/**
 * P5.4 — Empresa e MovimentacaoEstoque nativos (amostra).
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

describe('P5.4 — Empresa', () => {
  test('BE-P54-01 cria empresa tenant-scoped', async () => {
    const { credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);
    const r = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(corpo.token),
      payload: { apelido: 'Fazenda', nome: 'FAZENDA TESTE', tipo_pessoa: 'Jurídica' },
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().nome, 'FAZENDA TESTE');
  });

  test('BE-P54-01b PATCH recusa metadados de leitura no corpo', async () => {
    const { credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);
    const criado = await app.inject({
      method: 'POST',
      url: '/empresas',
      headers: auth(corpo.token),
      payload: { apelido: 'F1', nome: 'FAZENDA PATCH', tipo_pessoa: 'Jurídica' },
    });
    const id = criado.json().id;
    const patch = await app.inject({
      method: 'PATCH',
      url: `/empresas/${id}`,
      headers: auth(corpo.token),
      payload: {
        nome: 'FAZENDA PATCH OK',
        id: 'outro-id',
        created_date: '2020-01-01T00:00:00.000Z',
        cliente_id: 'tenant-injetado',
      },
    });
    assert.equal(patch.statusCode, 400);
  });

  test('BE-P54-01c /api/native/empresas exige autenticação como /empresas', async () => {
    const rNativo = await app.inject({ method: 'GET', url: '/api/native/empresas' });
    const rLegado = await app.inject({ method: 'GET', url: '/empresas' });
    assert.equal(rNativo.statusCode, 401);
    assert.equal(rLegado.statusCode, 401);
  });
});

describe('P5.4 — MovimentacaoEstoque', () => {
  // D-PROD-161 (MAIKE-ESTOQUE-P0-01, F3): o POST genérico não insere mais fato
  // de estoque — movimento só nasce pelos comandos do motor físico. A rota
  // continua registrada (gate P5.4); a numeração passa a ser provada pelo
  // comando de suplementação, que usa a MESMA sequência do tenant.
  test('BE-P54-02 POST legado de movimentação → 409 ESTOQUE_ESCRITA_DIRETA_RECUSADA; nenhuma linha, sequência intacta', async () => {
    const { credenciais, cliente } = await criarTenant({ papelTenant: 'administrador' }); // R2: POST legado de movimentação de estoque é só do administrador real
    const { corpo } = await autenticarNoApp(app, credenciais);
    const r = await app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque',
      headers: auth(corpo.token),
      payload: {
        empresa_id: 'emp-1',
        tipo_movimentacao: 'Entrada',
        data_movimentacao: new Date().toISOString(),
        produto_id: 'prod-1',
        quantidade: 10,
        unidade_medida: 'KG',
      },
    });
    assert.equal(r.statusCode, 409, r.body);
    assert.equal(r.json().code, 'ESTOQUE_ESCRITA_DIRETA_RECUSADA');
    assert.deepEqual(r.json().details, { entidade: 'MovimentacaoEstoque', operacao: 'criar' });
    const prisma = getPrismaClient();
    assert.equal(await prisma.movimentacaoEstoque.count({ where: { cliente_id: cliente.id } }), 0);
    assert.equal(await prisma.entidadeCodigoSequencia.count({ where: { cliente_id: cliente.id, entidade: 'MovimentacaoEstoque' } }), 0, 'a sequência de movimentos nem foi aberta');
  });

  test('BE-P54-02b numera movimentação na criação (comando de suplementação): números da sequência, crescentes', async () => {
    const { credenciais, cliente } = await criarTenant({ papelTenant: 'administrador' });
    const { corpo } = await autenticarNoApp(app, credenciais);
    const token = corpo.token;
    const emp = await app.inject({ method: 'POST', url: '/empresas', headers: auth(token), payload: { apelido: 'F1', nome: 'FAZENDA NUMERACAO', tipo_pessoa: 'Jurídica' } });
    assert.equal(emp.statusCode, 201, emp.body);
    const local = await app.inject({ method: 'POST', url: '/locais-estoque', headers: auth(token), payload: { nome: 'DEPOSITO A', ativo: true } });
    assert.equal(local.statusCode, 201, local.body);
    const prod = await app.inject({ method: 'POST', url: '/produtos', headers: auth(token), payload: { empresa_id: emp.json().id, nome_produto: 'SAL MINERAL', unidade_principal_estoque: 'KG', ativo: true } });
    assert.equal(prod.statusCode, 201, prod.body);
    // fixture de banco: saldo coerente (lote + cache), sem passar por escritor genérico
    const prisma = getPrismaClient();
    await prisma.estoqueLoteNota.create({
      data: {
        cliente_id: cliente.id, empresa_id: emp.json().id, produto_id: prod.json().id, produto_nome: 'SAL MINERAL', local_estoque_id: local.json().id, local_estoque_nome: 'DEPOSITO A',
        numero_documento: 'NF-1', data_documento: new Date('2026-01-15T00:00:00.000Z'), custo_unitario: '2.5', quantidade_entrada: '100', quantidade_disponivel: '100', status: 'Disponivel',
      },
    });
    await prisma.produto.update({ where: { cliente_id_id: { cliente_id: cliente.id, id: prod.json().id } }, data: { estoque_atual: '100' } });
    const suplementar = () => app.inject({
      method: 'POST',
      url: '/movimentacoes-estoque/comandos/saida-suplementacao',
      headers: auth(token),
      payload: { operation_id: randomUUID(), empresa_id: emp.json().id, produto_id: prod.json().id, local_origem_id: local.json().id, quantidade: 5 },
    });
    const r1 = await suplementar();
    assert.equal(r1.statusCode, 201, r1.body);
    const r2 = await suplementar();
    assert.equal(r2.statusCode, 201, r2.body);
    const [n1, n2] = [r1.json().movimentacao.numero_movimentacao, r2.json().movimentacao.numero_movimentacao];
    assert.match(n1, /^\d+$/);
    assert.match(n2, /^\d+$/);
    assert.equal(Number(n2), Number(n1) + 1);
  });
});

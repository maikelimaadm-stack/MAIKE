/**
 * MovimentacaoMapa — nome de área resolvido pelo ID no servidor (PostgreSQL real).
 *
 * Caso real (30/10/2026, só leitura): a área TET foi criada 43 s antes da
 * transferência; o cliente montou o documento com um cache de áreas que ainda
 * não a tinha e gravou `area_destino_nome: ""` com `area_destino_id` correto.
 * O id é a fonte de verdade: o nome passa a vir do banco, no mesmo tenant e
 * empresa, sem recusar o registro quando o id não resolve.
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

/** Tenant autenticado com uma empresa, um setor e as áreas pedidas. */
const cenario = async (nomesAreas = ['TESTE', 'TET']) => {
  const prisma = getPrismaClient();
  const { cliente, credenciais } = await criarTenant();
  const { corpo } = await autenticarNoApp(app, credenciais);
  const empresa = await prisma.empresa.create({ data: { cliente_id: cliente.id, numero_empresa: 1, apelido: 'FAZ', nome: 'Fazenda' } });
  const setor = await prisma.setor.create({ data: { cliente_id: cliente.id, empresa_id: empresa.id, numero_setor: '1', nome: 'Setor 1' } });
  const areas = [];
  for (const [i, nome] of nomesAreas.entries()) {
    areas.push(
      await prisma.areaPastagem.create({
        data: { cliente_id: cliente.id, empresa_id: empresa.id, setor_id: setor.id, setor_nome: setor.nome, numero_area: String(i + 1), nome, tamanho_hectares: 10 },
      })
    );
  }
  return { token: corpo.token, cliente, empresa, setor, areas };
};

const transferencia = (empresaId, origem, destino, extra = {}) => ({
  empresa_id: empresaId,
  tipo: 'Transferência de Área',
  lote: 'TESTE',
  lote_id: 'lote-1',
  quantidade_animais: 50,
  area_origem_id: origem.id,
  area_origem_nome: origem.nome,
  area_destino_id: destino.id,
  area_destino_nome: '',
  ...extra,
});

describe('MovimentacaoMapa — nome de área pelo ID', () => {
  test('destino gravado com nome vazio e id certo → nome vem do banco', async () => {
    const { token, empresa, areas } = await cenario();
    const [teste, tet] = areas;
    const r = await app.inject({ method: 'POST', url: '/movimentacoes-mapa', headers: auth(token), payload: transferencia(empresa.id, teste, tet) });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().area_destino_nome, 'TET');
    assert.equal(r.json().area_destino_id, tet.id);
    assert.equal(r.json().area_origem_nome, 'TESTE');
    assert.equal(r.json().quantidade_animais, 50);

    const gravado = await getPrismaClient().movimentacaoMapa.findFirst({ where: { id: r.json().id } });
    assert.equal(/** @type {any} */ (gravado.dados).area_destino_nome, 'TET', 'persistido, não só na resposta');
  });

  test('nome divergente do cliente é corrigido pelo do banco (id manda)', async () => {
    const { token, empresa, areas } = await cenario();
    const [teste, tet] = areas;
    const r = await app.inject({
      method: 'POST',
      url: '/movimentacoes-mapa',
      headers: auth(token),
      payload: transferencia(empresa.id, teste, tet, { area_destino_nome: 'NOME VELHO DO CACHE' }),
    });
    assert.equal(r.json().area_destino_nome, 'TET');
  });

  test('id que não resolve (outra empresa / inexistente): registro aceito, nome não inventado', async () => {
    const { token, cliente, empresa, setor, areas } = await cenario();
    const prisma = getPrismaClient();
    const outraEmpresa = await prisma.empresa.create({ data: { cliente_id: cliente.id, numero_empresa: 2, apelido: 'OUT', nome: 'Outra' } });
    const setorOutra = await prisma.setor.create({ data: { cliente_id: cliente.id, empresa_id: outraEmpresa.id, numero_setor: '9', nome: 'S9' } });
    const areaOutra = await prisma.areaPastagem.create({
      data: { cliente_id: cliente.id, empresa_id: outraEmpresa.id, setor_id: setorOutra.id, setor_nome: 'S9', numero_area: '9', nome: 'DE OUTRA EMPRESA', tamanho_hectares: 1 },
    });
    assert.ok(setor);
    const r1 = await app.inject({ method: 'POST', url: '/movimentacoes-mapa', headers: auth(token), payload: transferencia(empresa.id, areas[0], areaOutra) });
    assert.equal(r1.statusCode, 201);
    assert.equal(r1.json().area_destino_nome, '', 'área de outra empresa não empresta o nome');
    const r2 = await app.inject({
      method: 'POST',
      url: '/movimentacoes-mapa',
      headers: auth(token),
      payload: transferencia(empresa.id, areas[0], { id: 'area-que-nao-existe', nome: '' }),
    });
    assert.equal(r2.statusCode, 201);
    assert.equal(r2.json().area_destino_nome, '');
  });

  test('isolamento de tenant: área de outro cliente nunca resolve', async () => {
    const a = await cenario(['DO A']);
    const b = await cenario(['ORIGEM B']);
    const r = await app.inject({
      method: 'POST',
      url: '/movimentacoes-mapa',
      headers: auth(b.token),
      payload: transferencia(b.empresa.id, b.areas[0], a.areas[0]),
    });
    assert.equal(r.statusCode, 201);
    assert.equal(r.json().area_destino_nome, '', 'nome do tenant A não vaza para o B');
  });

  test('PATCH também resolve; movimento sem área segue intacto', async () => {
    const { token, empresa, areas } = await cenario();
    const [teste, tet] = areas;
    const criado = await app.inject({
      method: 'POST',
      url: '/movimentacoes-mapa',
      headers: auth(token),
      payload: { empresa_id: empresa.id, tipo: 'Pesagem', lote: 'TESTE', peso_medio: 300 },
    });
    assert.equal(criado.statusCode, 201);
    assert.equal(criado.json().area_destino_nome, undefined);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/movimentacoes-mapa/${criado.json().id}`,
      headers: auth(token),
      payload: { empresa_id: empresa.id, area_origem_id: teste.id, area_destino_id: tet.id, area_destino_nome: '' },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.json().area_destino_nome, 'TET');
    assert.equal(patch.json().area_origem_nome, 'TESTE');
    assert.equal(patch.json().peso_medio, 300);
  });
});

/**
 * HOTFIX D-PROD-182 — grupo de atividade continua funcionando quando o código
 * do Tipo de Atividade está no ar mas a tabela ainda não existe (migration
 * pendente). Simula a ausência renomeando a tabela e a devolve no fim.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

const prisma = () => getPrismaClient();

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

const semTabelaTipoAtividade = async (fn) => {
  await prisma().$executeRawUnsafe('ALTER TABLE "TipoAtividade" RENAME TO "TipoAtividade_hotfix_tmp"');
  try {
    await fn();
  } finally {
    await prisma().$executeRawUnsafe('ALTER TABLE "TipoAtividade_hotfix_tmp" RENAME TO "TipoAtividade"');
  }
};

describe('HOTFIX — GrupoAtividade sem a tabela TipoAtividade', () => {
  test('renomear, sincronizar referências e excluir grupo seguem funcionando; o bloqueio por tipo de tarefa continua', async () => {
    const { credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);
    const h = auth(corpo.token);

    const g1 = (await app.inject({ method: 'POST', url: '/grupos-atividade', headers: h, payload: { nome_grupo: 'G1' } })).json();
    const g2 = (await app.inject({ method: 'POST', url: '/grupos-atividade', headers: h, payload: { nome_grupo: 'G2' } })).json();
    const tipo = await app.inject({ method: 'POST', url: '/tipos-tarefa', headers: h, payload: { nome_tipo: 'T', grupo_atividade_id: g1.id } });
    assert.equal(tipo.statusCode, 201, tipo.body);

    await semTabelaTipoAtividade(async () => {
      const ren = await app.inject({ method: 'PATCH', url: `/grupos-atividade/${g1.id}`, headers: h, payload: { nome_grupo: 'G1 NOVO' } });
      assert.equal(ren.statusCode, 200, ren.body);
      const tipos = (await app.inject({ method: 'GET', url: '/tipos-tarefa', headers: h })).json();
      assert.equal(tipos[0].grupo_atividade_nome, 'G1 NOVO');

      const sync = await app.inject({
        method: 'POST',
        url: '/referencias/sincronizar',
        headers: h,
        payload: { event: { type: 'update', entity_name: 'GrupoAtividade' }, data: { id: g1.id } },
      });
      assert.equal(sync.statusCode, 200, sync.body);

      const bloqueado = await app.inject({ method: 'DELETE', url: `/grupos-atividade/${g1.id}`, headers: h });
      assert.equal(bloqueado.statusCode, 409, bloqueado.body);

      const del = await app.inject({ method: 'DELETE', url: `/grupos-atividade/${g2.id}`, headers: h });
      assert.equal(del.statusCode, 204, del.body);
    });
  });
});

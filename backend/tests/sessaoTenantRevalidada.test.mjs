/**
 * PR145-G4 — o JWT de tenant só vale enquanto a conta existe, está ativa e
 * pertence ao mesmo cliente. Antes, `app.autenticar` só conferia a assinatura:
 * o token de um usuário apagado ou desativado seguia abrindo rotas não
 * privilegiadas até expirar (8 h).
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarTenant, criarApp, autenticarNoApp, limparBanco, encerrar } from './helpers.mjs';

let app;
before(async () => {
  app = await criarApp();
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => limparBanco());

const get = (url, token) => app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('sessão de tenant revalidada no banco', () => {
  test('SR-01 conta ativa: o token abre as rotas', async () => {
    const t = await criarTenant();
    const token = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    assert.ok(token, "login deve devolver token");
    assert.equal((await get('/lotes', token)).statusCode, 200);
    assert.equal((await get('/auth/contexto', token)).statusCode, 200);
  });

  test('SR-02 conta apagada (junto com o cliente): o token antigo vira 401', async () => {
    const t = await criarTenant();
    const token = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    assert.ok(token, "login deve devolver token");
    const db = getPrismaClient();
    await db.usuario.delete({ where: { id: t.usuario.id } });
    await db.cliente.delete({ where: { id: t.cliente.id } });
    for (const url of ['/lotes', '/auth/contexto', '/usuarios', '/categorias-manejo']) {
      const r = await get(url, token);
      assert.equal(r.statusCode, 401, url);
      assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED', url);
    }
  });

  test('SR-03 conta desativada: o token antigo vira 401 na hora', async () => {
    const t = await criarTenant();
    const token = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    assert.ok(token, "login deve devolver token");
    await getPrismaClient().usuario.update({ where: { id: t.usuario.id }, data: { ativo: false } });
    assert.equal((await get('/lotes', token)).statusCode, 401);
  });

  test('SR-04 token cujo cliente_id não é o da conta: 401', async () => {
    const a = await criarTenant();
    const b = await criarTenant();
    const forjado = app.jwt.sign({ cliente_id: b.cliente.id, usuario_id: a.usuario.id, login: a.usuario.login });
    const r = await get('/lotes', forjado);
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().message.includes(b.cliente.id), false, 'não ecoa ids');
  });

  test('SR-05 (G4-R1) cliente desativado depois do login: o token vira 401 na hora; reativado, volta', async () => {
    const t = await criarTenant();
    const outro = await criarTenant();
    const token = (await autenticarNoApp(app, t.credenciais)).corpo.token;
    const tokenOutro = (await autenticarNoApp(app, outro.credenciais)).corpo.token;
    assert.equal((await get('/lotes', token)).statusCode, 200);
    const db = getPrismaClient();
    await db.cliente.update({ where: { id: t.cliente.id }, data: { ativo: false } });
    const r = await get('/lotes', token);
    assert.equal(r.statusCode, 401);
    assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
    assert.equal((await get('/lotes', tokenOutro)).statusCode, 200, 'cliente ativo não é afetado');
    await db.cliente.update({ where: { id: t.cliente.id }, data: { ativo: true } });
    assert.equal((await get('/lotes', token)).statusCode, 200);
  });
});

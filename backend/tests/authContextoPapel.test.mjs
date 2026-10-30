/**
 * D-PROD-77 — `/auth/contexto` informa se a conta é administradora da fazenda,
 * relendo `Usuario.papel_tenant` no banco a cada chamada (nunca do token).
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
beforeEach(async () => {
  await limparBanco();
});

const contexto = async (token) =>
  app.inject({ method: 'GET', url: '/auth/contexto', headers: { authorization: `Bearer ${token}` } });

describe('auth/contexto — papel da fazenda', () => {
  test('ACP-01 administrador = true; usuário comum = false', async () => {
    const admin = await criarTenant({ papelTenant: 'administrador' });
    const comum = await criarTenant();
    const rA = await contexto((await autenticarNoApp(app, admin.credenciais)).corpo.token);
    const rC = await contexto((await autenticarNoApp(app, comum.credenciais)).corpo.token);
    assert.equal(rA.statusCode, 200);
    assert.equal(rA.json().administrador_fazenda, true);
    assert.equal(rC.json().administrador_fazenda, false);
  });

  test('ACP-02 rebaixada no banco: a mesma sessão passa a ver false (relido a cada chamada)', async () => {
    const admin = await criarTenant({ papelTenant: 'administrador' });
    const token = (await autenticarNoApp(app, admin.credenciais)).corpo.token;
    assert.equal((await contexto(token)).json().administrador_fazenda, true);
    await getPrismaClient().usuario.update({ where: { id: admin.usuario.id }, data: { papel_tenant: 'usuario' } });
    assert.equal((await contexto(token)).json().administrador_fazenda, false);
  });
});

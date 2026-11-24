/**
 * D-PROD-287 — renovação da sessão (`POST /auth/renovar`).
 *
 * O app fica conectado até a pessoa sair: com internet, troca o token por um
 * novo. Prova: só renova sessão válida AGORA; o token novo leva as MESMAS
 * épocas (revogação continua valendo); o tenant vem do token, nunca do corpo;
 * a validade segue o opt-in `lembrar`, como no login.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarApp, criarTenant, limparBanco, encerrar } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();

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

const login = (credenciais, extra = {}) => app.inject({ method: 'POST', url: '/auth/login', payload: { ...credenciais, ...extra } });
const renovar = (token, payload = { lembrar: true }) =>
  app.inject({ method: 'POST', url: '/auth/renovar', headers: token ? { authorization: `Bearer ${token}` } : {}, payload });
const contexto = (token) => app.inject({ method: 'GET', url: '/auth/contexto', headers: { authorization: `Bearer ${token}` } });
const payloadDe = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
const ttl = (token) => payloadDe(token).exp - payloadDe(token).iat;

describe('D-PROD-287 renovação da sessão', () => {
  test('RN-01 sessão válida renova: token novo de 30 dias, mesma conta, mesmo tenant, mesmas épocas', async () => {
    const t = await criarTenant();
    await prisma().cliente.update({ where: { id: t.cliente.id }, data: { sessao_epoca: 2 } });
    await prisma().usuario.update({ where: { id: t.usuario.id }, data: { sessao_epoca: 5 } });
    const antigo = (await login(t.credenciais, { lembrar: true })).json().token;

    const r = await renovar(antigo);
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(r.json()), ['token']);
    const novo = r.json().token;
    const p = payloadDe(novo);
    assert.equal(p.cliente_id, t.cliente.id);
    assert.equal(p.usuario_id, t.usuario.id);
    assert.equal(p.cliente_sessao_epoca, 2);
    assert.equal(p.usuario_sessao_epoca, 5);
    assert.equal(ttl(novo), 30 * 24 * 3600);
    assert.equal((await contexto(novo)).statusCode, 200);
  });

  test('RN-02 sem lembrar a renovação dura o TTL comum (8 h), como no login', async () => {
    const t = await criarTenant();
    const token = (await login(t.credenciais)).json().token;
    const r = await renovar(token, {});
    assert.equal(r.statusCode, 200);
    assert.equal(ttl(r.json().token), 8 * 3600);
  });

  test('RN-03 sem token, token alterado ou de outra chave: 401 e nenhum token', async () => {
    const t = await criarTenant();
    const token = (await login(t.credenciais, { lembrar: true })).json().token;
    const [h, , s] = token.split('.');
    const forjado = `${h}.${Buffer.from(JSON.stringify({ ...payloadDe(token), usuario_id: 'outro' })).toString('base64url')}.${s}`;
    for (const tk of [null, forjado, 'abc.def.ghi']) {
      const r = await renovar(tk);
      assert.equal(r.statusCode, 401);
      assert.equal(r.json().token, undefined);
    }
  });

  test('RN-04 revogação continua valendo: depois de trocar a época, o token velho não renova', async () => {
    const t = await criarTenant();
    const token = (await login(t.credenciais, { lembrar: true })).json().token;
    const renovado = (await renovar(token)).json().token;
    await prisma().usuario.update({ where: { id: t.usuario.id }, data: { sessao_epoca: 9 } });
    assert.equal((await renovar(token)).statusCode, 401);
    assert.equal((await renovar(renovado)).statusCode, 401, 'o token renovado também cai: leva a época antiga');
    assert.equal((await contexto(renovado)).statusCode, 401);
  });

  test('RN-05 conta ou cliente desativados não renovam', async () => {
    const t = await criarTenant();
    const token = (await login(t.credenciais, { lembrar: true })).json().token;
    await prisma().usuario.update({ where: { id: t.usuario.id }, data: { ativo: false } });
    assert.equal((await renovar(token)).statusCode, 401);
    await prisma().usuario.update({ where: { id: t.usuario.id }, data: { ativo: true } });
    await prisma().cliente.update({ where: { id: t.cliente.id }, data: { ativo: false } });
    assert.equal((await renovar(token)).statusCode, 401);
  });

  test('RN-06 o corpo não escolhe tenant nem conta: campo extra = 400', async () => {
    const t = await criarTenant();
    const outro = await criarTenant();
    const token = (await login(t.credenciais, { lembrar: true })).json().token;
    for (const extra of [{ cliente_id: outro.cliente.id }, { usuario_id: outro.usuario.id }, { login: 'x' }]) {
      const r = await renovar(token, { lembrar: true, ...extra });
      assert.equal(r.statusCode, 400);
      assert.equal(r.json().token, undefined);
    }
  });
});

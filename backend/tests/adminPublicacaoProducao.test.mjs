/**
 * MAIKE-ADMIN-S02 — o backend como ficará publicado para `admmakgestao.vercel.app`
 * (atalho `makgestao.com/admmakgestao` → redirect).
 *
 * Reproduz a configuração de produção planejada (NODE_ENV=production,
 * ADMIN_MAIKE_CHAVE presente, ADMIN_ORIGINS=https://admmakgestao.vercel.app) e a
 * requisição como o rewrite do projeto admin a entrega (Host = domínio da API,
 * Origin = admin). PostgreSQL local descartável; nenhum valor real de segredo.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { env } from '../src/config/env.js';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { criarProprietarioInicial } from '../src/modules/adminMaike/adminService.js';
import { codigoTotp, passoTotpAtual } from '../src/modules/adminMaike/adminCrypto.js';
import { zerarLimitadorAdmin } from '../src/modules/adminMaike/adminSessao.js';
import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
const ADMIN = 'https://admmakgestao.vercel.app';
const HOST_API = 'www.makgestao.com';
const LOGIN = 'dono.maike';
const SENHA = 'senha-forte-do-dono-1';
let original;

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
  zerarLimitadorAdmin();
  original = { nodeEnv: env.nodeEnv, chave: env.adminMaikeChave, origins: env.adminOrigins };
  env.nodeEnv = 'production';
  // Valor sintético de teste (32 bytes), nunca o de produção.
  env.adminMaikeChave = Buffer.alloc(32, 9).toString('base64');
  env.adminOrigins = [ADMIN];
});
const restaurar = () => {
  env.nodeEnv = original.nodeEnv;
  env.adminMaikeChave = original.chave;
  env.adminOrigins = original.origins;
};

const req = (method, url, { origin = ADMIN, cookie, csrf, payload, authorization } = {}) =>
  app.inject({
    method,
    url: `/api/native${url}`,
    headers: {
      host: HOST_API,
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-maike-admin-csrf': csrf } : {}),
      ...(authorization ? { authorization } : {}),
    },
    ...(payload !== undefined ? { payload } : {}),
  });

/** @returns {{ par: string|null, atributos: string }} */
const cookieDe = (r) => {
  const bruto = r.headers['set-cookie'];
  const linha = (Array.isArray(bruto) ? bruto : bruto ? [String(bruto)] : []).find((c) => c.startsWith('__Host-maike_admin='));
  return { par: linha ? linha.split(';')[0] : null, atributos: linha ?? '' };
};

/** Login → inscrição do TOTP → sessão verificada, com o Origin do admin publicado. */
const sessaoVerificada = async () => {
  await criarProprietarioInicial({ login: LOGIN, senha: SENHA });
  const r1 = await req('POST', '/admin-maike/auth/login', { payload: { login: LOGIN, senha: SENHA } });
  assert.equal(r1.statusCode, 200, r1.body);
  const pre = { cookie: cookieDe(r1).par, csrf: r1.json().csrf_token };
  const insc = await req('POST', '/admin-maike/mfa/inscricao', { ...pre, payload: {} });
  assert.equal(insc.statusCode, 200, insc.body);
  const r2 = await req('POST', '/admin-maike/mfa/confirmar', { ...pre, payload: { codigo: codigoTotp(insc.json().segredo, passoTotpAtual()) } });
  assert.equal(r2.statusCode, 200, r2.body);
  return { r1, r2, cookie: cookieDe(r2).par, csrf: r2.json().csrf_token };
};

describe('admin publicado (produção simulada)', () => {
  test('PUB-01 cookie de sessão __Host-, Secure, HttpOnly, SameSite=Strict, Path=/ e sem Domain', async () => {
    try {
      const { r1, r2 } = await sessaoVerificada();
      for (const r of [r1, r2]) {
        const { par, atributos } = cookieDe(r);
        assert.ok(par, 'cookie __Host- emitido');
        assert.match(atributos, /; Secure/);
        assert.match(atributos, /; HttpOnly/);
        assert.match(atributos, /; SameSite=Strict/);
        assert.match(atributos, /; Path=\//);
        assert.doesNotMatch(atributos, /Domain=/i, 'host-only: vale só em admmakgestao.vercel.app');
        assert.equal(r.body.includes(par.split('=')[1]), false, 'token só no cookie');
      }
    } finally {
      restaurar();
    }
  });

  test('PUB-02 login só com Origin do admin: SPA dos clientes, outro *.vercel.app (inclusive prévia), http e ausente são recusados', async () => {
    try {
      await criarProprietarioInicial({ login: LOGIN, senha: SENHA });
      for (const origin of ['https://www.makgestao.com', 'https://maike-five.vercel.app', 'https://admin.makgestao.com', 'http://admmakgestao.vercel.app', 'https://admmakgestao-git-x.vercel.app', 'https://admmakgestao.vercel.app.evil.example', null]) {
        const r = await req('POST', '/admin-maike/auth/login', { origin, payload: { login: LOGIN, senha: SENHA } });
        assert.equal(r.statusCode, 403, String(origin));
        assert.equal(r.json().code, 'ADMIN_ORIGEM_RECUSADA');
        assert.equal(cookieDe(r).par, null);
      }
      assert.equal(await getPrismaClient().sessaoAdminMaike.count(), 0);
    } finally {
      restaurar();
    }
  });

  test('PUB-03 sessão verificada lê Clientes; mutação sem CSRF ou de outra origem é recusada; JWT de fazenda não entra', async () => {
    try {
      const t = await criarTenant({ codigo: 'fazenda-publicada' });
      const { cookie, csrf } = await sessaoVerificada();
      const lista = await req('GET', '/admin-maike/clientes', { cookie });
      assert.equal(lista.statusCode, 200, lista.body);
      assert.deepEqual(lista.json().items.map((c) => c.codigo), ['fazenda-publicada']);
      assert.equal((await req('GET', `/admin-maike/clientes/${t.cliente.id}`, { cookie })).statusCode, 200);

      const semCsrf = await req('POST', '/admin-maike/conta/sessoes/revogar-outras', { cookie, payload: {} });
      assert.equal(semCsrf.statusCode, 403);
      const outraOrigem = await req('POST', '/admin-maike/conta/sessoes/revogar-outras', { cookie, csrf, origin: 'https://www.makgestao.com', payload: {} });
      assert.equal(outraOrigem.statusCode, 403);
      const ok = await req('POST', '/admin-maike/conta/sessoes/revogar-outras', { cookie, csrf, payload: {} });
      assert.equal(ok.statusCode, 200, ok.body);

      const { corpo } = await autenticarNoApp(app, t.credenciais);
      const jwt = await req('GET', '/admin-maike/clientes', { authorization: `Bearer ${corpo.token}` });
      assert.equal(jwt.statusCode, 403);
      assert.equal(jwt.json().code, 'ADMIN_PRINCIPAL_REQUIRED');
      // Cookie sem o prefixo __Host- (o nome de desenvolvimento) não vale em produção.
      const nomeDev = await req('GET', '/admin-maike/clientes', { cookie: cookie.replace('__Host-maike_admin', 'maike_admin') });
      assert.equal(nomeDev.statusCode, 401);
    } finally {
      restaurar();
    }
  });
});

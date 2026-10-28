/**
 * Handler real `api/fastify.js` — normalização de ingresso antes do Fastify (PR #107).
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

/** @type {import('fastify').FastifyInstance} */
let appReferencia;

before(async () => {
  appReferencia = await criarApp();
  await appReferencia.ready();
});

after(async () => {
  await appReferencia.close();
  await encerrar();
});

/** @returns {{ req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, body: () => string, statusCode: () => number }} */
const criarParHttpMock = () => {
  /** @type {Buffer[]} */
  const chunks = [];
  let code = 200;

  const req = new EventEmitter();
  /** @type {import('node:http').IncomingMessage} */
  const reqAsHttp = Object.assign(req, {
    headers: {},
    method: 'GET',
    url: '/',
    socket: { remoteAddress: '127.0.0.1' },
  });

  const res = new EventEmitter();
  /** @type {import('node:http').ServerResponse} */
  const resAsHttp = Object.assign(res, {
    setHeader() {},
    getHeader() {
      return undefined;
    },
    removeHeader() {},
    writeHead(nextCode) {
      code = nextCode;
    },
    write(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      queueMicrotask(() => res.emit('finish'));
    },
  });
  Object.defineProperty(resAsHttp, 'statusCode', {
    get: () => code,
    set: (v) => {
      code = v;
    },
    enumerable: true,
    configurable: true,
  });

  return {
    req: reqAsHttp,
    res: resAsHttp,
    statusCode: () => code,
    body: () => Buffer.concat(chunks).toString('utf8'),
  };
};

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, body?: string }} [opcoes]
 */
const invocarHandlerServerless = async (url, opcoes = {}) => {
  const { default: handler } = await import('../../api/fastify.js');
  const par = criarParHttpMock();
  par.req.url = url;
  par.req.method = opcoes.method ?? 'GET';
  par.req.headers = { ...opcoes.headers };

  const finished = new Promise((resolve) => {
    par.res.on('finish', resolve);
  });

  const run = handler(par.req, par.res);
  if (opcoes.body != null) {
    par.req.emit('data', opcoes.body);
  }
  par.req.emit('end');
  await run;
  await finished;

  const raw = par.body();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = raw;
  }
  return { statusCode: par.statusCode(), json, raw };
};

describe('api/fastify.js — ingresso Vercel', () => {
  test('GET /api/native/health público', async () => {
    await limparBanco();
    const r = await invocarHandlerServerless('/api/native/health');
    assert.equal(r.statusCode, 200);
    assert.equal(r.json?.status, 'ok');
  });

  test('PR #107 — pathname nativo + __native_route autenticado 200', async () => {
    await limparBanco();
    const { credenciais } = await criarTenant();
    const { corpo: login } = await autenticarNoApp(appReferencia, credenciais);
    const entrada =
      '/api/native/movimentacoes-mapa?__native_route=movimentacoes-mapa&limit=200';
    const r = await invocarHandlerServerless(entrada, {
      headers: { authorization: `Bearer ${login.token}` },
    });
    assert.equal(r.statusCode, 200, r.raw?.slice?.(0, 240));
    assert.ok(Array.isArray(r.json));
  });

  test('rota contraditória → 400 INVALID_NATIVE_ROUTE', async () => {
    const r = await invocarHandlerServerless(
      '/api/native/empresas?__native_route=fornecedores',
    );
    assert.equal(r.statusCode, 400);
    assert.equal(r.json?.code, 'INVALID_NATIVE_ROUTE');
  });
});

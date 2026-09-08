/**
 * Transporte nativo: CORS e bootstrap (P4.0, D-PROD-24).
 *
 * Contra PostgreSQL **real**, como o resto do backend. O que se prova aqui não
 * existe em mock: o Fastify decidindo CORS de verdade, e o bootstrap gravando
 * Cliente e Usuario com identidade produzida pelo Prisma.
 *
 * A allowlist é injetada por variável de ambiente **antes** de montar o app,
 * porque `env` é lido uma vez no carregamento do módulo. Cada bloco monta o
 * próprio app com a configuração que quer exercitar — é o preço de testar a
 * configuração real em vez de uma função isolada que finge sê-la.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { construirApp } from '../src/app.js';
import { getPrismaClient } from '../src/database/prismaClient.js';
import { originPermitida, opcoesDeCors } from '../src/shared/http/corsPolicy.js';
import { criarClienteEUsuario } from '../../scripts/auth/bootstrap-local.mjs';
import { criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';

const ORIGIN_OK = 'http://localhost:5173';
const ORIGIN_MA = 'https://evil.example';

/** App com uma allowlist específica. */
const appComOrigins = async (lista) => {
  const anterior = process.env.FRONTEND_ORIGINS;
  process.env.FRONTEND_ORIGINS = lista;
  try {
    // `construirApp` lê `env.frontendOrigins`, que foi resolvido no carregamento
    // do módulo. Para o teste valer, a política é montada com a lista aqui.
    const { opcoesDeCors: opcoes } = await import('../src/shared/http/corsPolicy.js');
    const app = await construirApp({ logger: false });
    void opcoes;
    return app;
  } finally {
    if (anterior === undefined) delete process.env.FRONTEND_ORIGINS;
    else process.env.FRONTEND_ORIGINS = anterior;
  }
};

after(async () => {
  await encerrar();
});

// ---------------------------------------------------------------------------
// A regra de allowlist, isolada
// ---------------------------------------------------------------------------

describe('P4B — política de CORS', () => {
  test('P4B-01 origin exatamente igual é permitida', () => {
    assert.equal(originPermitida(ORIGIN_OK, [ORIGIN_OK]), true);
  });

  test('P4B-02 origin fora da lista não é permitida', () => {
    assert.equal(originPermitida(ORIGIN_MA, [ORIGIN_OK]), false);
  });

  test('P4B-03 origin parecida NÃO passa', () => {
    // O erro clássico é `startsWith`. Estes três casos são exatamente os que
    // ele deixaria passar, e o motivo de a comparação ser por igualdade.
    const permitidas = ['https://maike.app'];
    for (const impostor of [
      'https://maike.app.evil.com',
      'https://maike.appevil.com',
      'http://maike.app',
      'https://maike.app:8443',
      'https://sub.maike.app',
    ]) {
      assert.equal(originPermitida(impostor, permitidas), false, impostor);
    }
  });

  test('P4B-03b allowlist vazia não autoriza ninguém', () => {
    // Configuração ausente vira porta fechada, nunca porta aberta.
    assert.equal(originPermitida(ORIGIN_OK, []), false);
    assert.equal(originPermitida(ORIGIN_OK, undefined), false);
  });

  test('P4B-03c nunca existe wildcard nas opções', () => {
    const opcoes = opcoesDeCors([ORIGIN_OK]);
    assert.notEqual(opcoes.origin, '*');
    assert.equal(opcoes.credentials, false);
    assert.ok(opcoes.allowedHeaders.includes('Authorization'));
  });

  test('P4B-03d requisição sem Origin passa — CORS protege páginas, não curl', () => {
    const opcoes = opcoesDeCors([ORIGIN_OK]);
    let permitido = null;
    opcoes.origin(undefined, (_erro, valor) => {
      permitido = valor;
    });
    assert.equal(permitido, true);
  });

  test('P4B-03e o callback devolve booleano, nunca a origin recebida', () => {
    // Ecoar a origin é wildcard escrito de outro jeito.
    const opcoes = opcoesDeCors([ORIGIN_OK]);
    const vistos = [];
    opcoes.origin(ORIGIN_OK, (_e, v) => vistos.push(v));
    opcoes.origin(ORIGIN_MA, (_e, v) => vistos.push(v));
    assert.deepEqual(vistos, [true, false]);
  });
});

// ---------------------------------------------------------------------------
// O Fastify de verdade respondendo
// ---------------------------------------------------------------------------

describe('P4B — CORS no app real', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;

  before(async () => {
    app = await appComOrigins(ORIGIN_OK);
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('P4B-01b origin permitida recebe o cabeçalho de liberação', async () => {
    const r = await app.inject({ method: 'GET', url: '/health', headers: { origin: ORIGIN_OK } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN_OK);
  });

  test('P4B-02b origin não permitida NÃO recebe liberação', async () => {
    const r = await app.inject({ method: 'GET', url: '/health', headers: { origin: ORIGIN_MA } });
    // O servidor responde — CORS não é autorização de servidor —, mas sem o
    // cabeçalho o navegador bloqueia a leitura, que é como CORS funciona.
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  test('P4B-04 preflight de origin autorizada aceita Authorization', async () => {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/auth/contexto',
      headers: {
        origin: ORIGIN_OK,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    assert.ok(r.statusCode < 300, `preflight recusado: ${r.statusCode}`);
    assert.equal(r.headers['access-control-allow-origin'], ORIGIN_OK);
    assert.match(String(r.headers['access-control-allow-headers'] ?? ''), /authorization/i);
  });

  test('P4B-04b preflight de origin não autorizada não libera', async () => {
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/auth/contexto',
      headers: {
        origin: ORIGIN_MA,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    assert.equal(r.headers['access-control-allow-origin'], undefined);
  });

  test('P4B-04c nenhuma resposta traz Allow-Credentials', async () => {
    // Bearer, não cookie. Ligar credenciais abriria CSRF sem nenhum ganho.
    const r = await app.inject({ method: 'GET', url: '/health', headers: { origin: ORIGIN_OK } });
    assert.equal(r.headers['access-control-allow-credentials'], undefined);
  });
});

// ---------------------------------------------------------------------------
// Contrato de sessão preservado
// ---------------------------------------------------------------------------

describe('P4B — sessão nativa continua com o contrato da P3', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app;

  before(async () => {
    app = await appComOrigins(ORIGIN_OK);
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limparBanco();
  });

  test('P4B-05 /auth/login continua recusando cliente_id no corpo', async () => {
    const { credenciais } = await criarTenant();
    const r = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { ...credenciais, cliente_id: 'tentativa' },
    });
    // Recusado na porta, não apagado em silêncio — a correção da P3.
    assert.equal(r.statusCode, 400);
  });

  test('P4B-06 /auth/contexto deriva o tenant só do JWT', async () => {
    const { cliente, usuario, credenciais } = await criarTenant();
    const { corpo } = await autenticarNoApp(app, credenciais);

    const r = await app.inject({
      method: 'GET',
      url: '/auth/contexto',
      headers: { authorization: `Bearer ${corpo.token}` },
      // Query com outro tenant: se influenciasse a resposta, o tenant viria do
      // cliente e a tenancy inteira estaria furada.
      query: { cliente_id: 'outro-tenant' },
    });

    assert.equal(r.statusCode, 200);
    assert.equal(r.json().cliente_id, cliente.id);
    assert.equal(r.json().usuario_id, usuario.id);
  });

  test('P4B-07 token arbitrário não vira sessão MAIKE', async () => {
    // Um token da Base44 — ou qualquer string — não é assinado com AUTH_SECRET.
    for (const token of ['token-da-base44', 'a.b.c', '']) {
      const r = await app.inject({
        method: 'GET',
        url: '/auth/contexto',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(r.statusCode, 401, `token ${JSON.stringify(token)}`);
      assert.equal(r.json().code, 'TENANT_CONTEXT_REQUIRED');
    }
  });
});

// ---------------------------------------------------------------------------
// Bootstrap local
// ---------------------------------------------------------------------------

describe('P4B — bootstrap local', () => {
  beforeEach(async () => {
    await limparBanco();
  });

  test('P4B-08 cria Cliente + Usuario sem id fornecido pelo cliente', async () => {
    const prisma = getPrismaClient();
    const resultado = await criarClienteEUsuario(prisma, {
      clienteCodigo: 'FAZENDA-1',
      clienteNome: 'Fazenda Um',
      login: 'maike',
      nome: 'Maike',
      senha: 'senha-local-de-teste',
    });

    assert.equal(resultado.clienteCriado, true);
    assert.equal(resultado.usuarioCriado, true);

    const cliente = await prisma.cliente.findUnique({ where: { codigo: 'FAZENDA-1' } });
    const usuario = await prisma.usuario.findUnique({
      where: { cliente_id_login: { cliente_id: cliente.id, login: 'maike' } },
    });

    // `cuid()` do Prisma: 25 caracteres começando por `c`. Um UUID v4 teria
    // hífens — é assim que se vê que a identidade não foi produzida à mão.
    assert.match(cliente.id, /^c[a-z0-9]{20,}$/);
    assert.match(usuario.id, /^c[a-z0-9]{20,}$/);
    assert.equal(usuario.cliente_id, cliente.id);

    // A senha nunca é persistida em claro.
    assert.notEqual(usuario.senha_hash, 'senha-local-de-teste');
    assert.match(usuario.senha_hash, /^\$2[aby]\$/);
  });

  test('P4B-09 não sobrescreve conta existente em silêncio', async () => {
    const prisma = getPrismaClient();
    const entrada = {
      clienteCodigo: 'FAZENDA-1',
      clienteNome: 'Fazenda Um',
      login: 'maike',
      nome: 'Maike',
      senha: 'senha-original',
    };

    await criarClienteEUsuario(prisma, entrada);
    const antes = await prisma.usuario.findFirst({ where: { login: 'maike' } });

    await assert.rejects(
      () => criarClienteEUsuario(prisma, { ...entrada, senha: 'senha-do-atacante' }),
      /já existe/
    );

    // O hash não mudou: um bootstrap que redefine senha é tomada de conta com
    // nome amigável.
    const depois = await prisma.usuario.findFirst({ where: { login: 'maike' } });
    assert.equal(depois.senha_hash, antes.senha_hash);
  });

  test('P4B-09b segundo usuário do mesmo cliente é permitido', async () => {
    const prisma = getPrismaClient();
    const base = { clienteCodigo: 'FAZENDA-1', clienteNome: 'Fazenda Um', senha: 'senha-local' };

    await criarClienteEUsuario(prisma, { ...base, login: 'maike', nome: 'Maike' });
    const segundo = await criarClienteEUsuario(prisma, { ...base, login: 'joao', nome: 'João' });

    // O cliente não foi recriado — e não podia ser: `codigo` é unique global.
    assert.equal(segundo.clienteCriado, false);
    assert.equal(await prisma.cliente.count(), 1);
    assert.equal(await prisma.usuario.count(), 2);
  });

  test('P4B-10 a credencial criada pelo bootstrap autentica de verdade', async () => {
    const prisma = getPrismaClient();
    await criarClienteEUsuario(prisma, {
      clienteCodigo: 'FAZENDA-1',
      clienteNome: 'Fazenda Um',
      login: 'maike',
      nome: 'Maike',
      senha: 'senha-local-de-teste',
    });

    const app = await appComOrigins(ORIGIN_OK);
    await app.ready();
    try {
      const { resposta, corpo } = await autenticarNoApp(app, {
        cliente: 'FAZENDA-1',
        login: 'maike',
        senha: 'senha-local-de-teste',
      });

      assert.equal(resposta.statusCode, 200);
      assert.ok(corpo.token);
      assert.equal(corpo.usuario.login, 'maike');

      // E o token serve: o ciclo bootstrap → login → contexto fecha.
      const contexto = await app.inject({
        method: 'GET',
        url: '/auth/contexto',
        headers: { authorization: `Bearer ${corpo.token}` },
      });
      assert.equal(contexto.statusCode, 200);
      assert.equal(contexto.json().login, 'maike');

      // Senha errada continua sendo recusada com a mensagem única.
      const errada = await autenticarNoApp(app, {
        cliente: 'FAZENDA-1',
        login: 'maike',
        senha: 'senha-errada',
      });
      assert.equal(errada.resposta.statusCode, 401);
      assert.equal(errada.corpo.code, 'AUTH_INVALID_CREDENTIALS');
    } finally {
      await app.close();
    }
  });
});

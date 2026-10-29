/**
 * SCALE-01 — `GET /usuarios/page` (keyset `createdAt DESC, id DESC`).
 *
 * PostgreSQL real descartável. Prova fronteira de tenant, limites, cursor
 * opaco, ordem estável sem duplicata/omissão (inclusive com inserção no meio
 * da paginação), busca `q` e filtro `ativo` no servidor, ausência de
 * `senha_hash` e que o `GET /usuarios` legado continua igual.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { codificarCursor } from '../src/shared/pagination/keysetCursor.js';
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

const tenantAutenticado = async (opcoes) => {
  const { cliente, usuario, credenciais } = await criarTenant(opcoes);
  const { corpo } = await autenticarNoApp(app, credenciais);
  return { cliente, usuario, token: corpo.token };
};

/** Hash inerte: estes usuários sintéticos nunca fazem login. */
const HASH_INERTE = 'sintetico-sem-login';

/**
 * Semeia `n` usuários sintéticos (sem dado pessoal), com `createdAt` em
 * blocos repetidos para exercitar o desempate por `id`.
 */
const semear = async (clienteId, prefixo, n, { inativosACada = 0 } = {}) => {
  const base = Date.UTC(2026, 0, 1);
  const data = Array.from({ length: n }, (_, i) => ({
    cliente_id: clienteId,
    nome: `${prefixo} Sintetico ${String(i).padStart(4, '0')}`,
    login: `${prefixo}.sint.${String(i).padStart(4, '0')}`,
    senha_hash: HASH_INERTE,
    ativo: inativosACada ? i % inativosACada !== 0 : true,
    // 10 registros por instante: empates em createdAt são a regra, não exceção.
    createdAt: new Date(base + Math.floor(i / 10) * 1000),
  }));
  await getPrismaClient().usuario.createMany({ data });
};

const pagina = (token, qs = '') =>
  app.inject({ method: 'GET', url: `/usuarios/page${qs ? `?${qs}` : ''}`, headers: auth(token) });

/** Percorre todas as páginas; devolve ids na ordem e o total da página 0. */
const percorrer = async (token, { limit, extra = '' }) => {
  const ids = [];
  let cursor = null;
  let total = null;
  let paginas = 0;
  for (;;) {
    const qs = [`limit=${limit}`, extra, cursor ? `cursor=${encodeURIComponent(cursor)}` : '']
      .filter(Boolean)
      .join('&');
    const r = await pagina(token, qs);
    assert.equal(r.statusCode, 200, r.body);
    const corpo = r.json();
    if (paginas === 0) total = corpo.total;
    else assert.equal(corpo.total, null, 'páginas seguintes não recontam');
    assert.ok(corpo.items.length <= limit);
    ids.push(...corpo.items.map((u) => u.id));
    paginas += 1;
    if (!corpo.has_more) {
      assert.equal(corpo.next_cursor, null);
      break;
    }
    assert.equal(typeof corpo.next_cursor, 'string');
    cursor = corpo.next_cursor;
  }
  return { ids, total, paginas };
};

describe('SCALE-01 — sessão e validação', () => {
  test('US-PG-01 sem token → 401', async () => {
    const r = await app.inject({ method: 'GET', url: '/usuarios/page' });
    assert.equal(r.statusCode, 401);
  });

  test('US-PG-02 cursor adulterado → 400; limit fora do contrato → 400', async () => {
    const { token } = await tenantAutenticado();
    for (const qs of ['cursor=nao-e-cursor', 'cursor=' + Buffer.from('{"t":"x","i":""}').toString('base64url')]) {
      const r = await pagina(token, qs);
      assert.equal(r.statusCode, 400, qs);
    }
    for (const qs of ['limit=0', 'limit=501', 'limit=abc', 'cliente_id=outro', 'q=' + 'x'.repeat(201)]) {
      const r = await pagina(token, qs);
      assert.equal(r.statusCode, 400, qs);
    }
  });
});

describe('SCALE-01 — paginação keyset', () => {
  test('US-PG-03 limites 1, 100 e 500 percorrem tudo sem duplicata/omissão, ordem estável', async () => {
    const { cliente, token } = await tenantAutenticado({ codigo: 'pg-a' });
    await semear(cliente.id, 'a', 1203);
    const esperado = (
      await getPrismaClient().usuario.findMany({
        where: { cliente_id: cliente.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })
    ).map((u) => u.id);
    assert.equal(esperado.length, 1204); // 1203 sintéticos + operador do tenant

    for (const limit of [100, 500]) {
      const { ids, total, paginas } = await percorrer(token, { limit });
      assert.equal(total, 1204);
      assert.equal(new Set(ids).size, ids.length, `duplicata com limit=${limit}`);
      assert.deepEqual(ids, esperado, `ordem/omissão com limit=${limit}`);
      assert.equal(paginas, Math.ceil(1204 / limit));
    }

    const r1 = await pagina(token, 'limit=1');
    assert.equal(r1.json().items.length, 1);
    assert.equal(r1.json().items[0].id, esperado[0]);
    assert.equal(r1.json().has_more, true);

    const padrao = await pagina(token);
    assert.equal(padrao.json().limit, 100);
    assert.equal(padrao.json().items.length, 100);
  });

  test('US-PG-04 inserção durante a paginação não duplica nem pula registros antigos', async () => {
    const { cliente, token } = await tenantAutenticado({ codigo: 'pg-ins' });
    await semear(cliente.id, 'ins', 250);
    const p1 = (await pagina(token, 'limit=100')).json();

    // Novo usuário entra no topo (createdAt = agora) após a página 1.
    await getPrismaClient().usuario.create({
      data: { cliente_id: cliente.id, nome: 'Novo Topo', login: 'ins.novo', senha_hash: HASH_INERTE },
    });

    const ids = p1.items.map((u) => u.id);
    let cursor = p1.next_cursor;
    while (cursor) {
      const p = (await pagina(token, `limit=100&cursor=${encodeURIComponent(cursor)}`)).json();
      ids.push(...p.items.map((u) => u.id));
      cursor = p.next_cursor;
    }
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 251); // 250 + operador; o novo fica para o próximo refresh
  });
});

describe('SCALE-01 — tenant, busca e filtros', () => {
  test('US-PG-05 nunca devolve usuário de outro tenant, nem com cursor forjado', async () => {
    const a = await tenantAutenticado({ codigo: 'ten-a' });
    const b = await tenantAutenticado({ codigo: 'ten-b' });
    await semear(a.cliente.id, 'ta', 300);
    await semear(b.cliente.id, 'tb', 300);

    const { ids, total } = await percorrer(a.token, { limit: 500 });
    assert.equal(total, 301);
    const deB = await getPrismaClient().usuario.findMany({
      where: { cliente_id: b.cliente.id },
      select: { id: true, createdAt: true },
    });
    const idsB = new Set(deB.map((u) => u.id));
    assert.equal(ids.filter((id) => idsB.has(id)).length, 0);

    // Cursor apontando para um registro de B só posiciona; o filtro continua o tenant de A.
    const forjado = codificarCursor(deB[0]);
    const r = await pagina(a.token, `limit=500&cursor=${encodeURIComponent(forjado)}`);
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().items.filter((u) => idsB.has(u.id)).length, 0);

    // Busca pelo prefixo de B a partir de A: zero.
    const busca = (await pagina(a.token, 'q=tb.sint')).json();
    assert.equal(busca.total, 0);
    assert.deepEqual(busca.items, []);
  });

  test('US-PG-06 q no servidor (nome/login, case-insensitive, caracteres especiais) e ativo', async () => {
    const { cliente, token } = await tenantAutenticado({ codigo: 'busca' });
    await semear(cliente.id, 'bq', 400, { inativosACada: 4 });

    const exato = (await pagina(token, 'q=BQ.SINT.0377')).json();
    assert.equal(exato.total, 1);
    assert.equal(exato.items[0].login, 'bq.sint.0377');

    const porNome = (await pagina(token, `q=${encodeURIComponent('sintetico 039')}`)).json();
    assert.equal(porNome.total, 10); // 0390..0399

    for (const especial of ['%', '_', "'; drop table", '\\']) {
      const r = await pagina(token, `q=${encodeURIComponent(especial)}`);
      assert.equal(r.statusCode, 200, especial);
      assert.equal(r.json().total, 0, `"${especial}" é literal, não curinga`);
    }

    // Curinga escapado continua achando o caractere literal quando ele existe.
    await getPrismaClient().usuario.create({
      data: { cliente_id: cliente.id, nome: 'Taxa 100% ok', login: 'bq.under_score', senha_hash: HASH_INERTE },
    });
    assert.equal((await pagina(token, `q=${encodeURIComponent('100%')}`)).json().total, 1);
    assert.equal((await pagina(token, 'q=under_score')).json().total, 1);
    await getPrismaClient().usuario.deleteMany({ where: { login: 'bq.under_score' } });

    const vazio = (await pagina(token, 'q=%20%20')).json();
    assert.equal(vazio.total, 401, 'q só com espaços = sem filtro');

    const inativos = (await pagina(token, 'ativo=false&limit=500')).json();
    assert.equal(inativos.total, 100);
    assert.ok(inativos.items.every((u) => u.ativo === false));
    const ativos = (await pagina(token, 'ativo=true&limit=500')).json();
    assert.equal(ativos.total, 301);
  });

  test('US-PG-07 resposta não expõe senha_hash nem cliente_id', async () => {
    const { cliente, token } = await tenantAutenticado({ codigo: 'priv' });
    await semear(cliente.id, 'pv', 5);
    const corpo = (await pagina(token)).json();
    for (const u of corpo.items) {
      assert.deepEqual(Object.keys(u).sort(), ['ativo', 'created_date', 'id', 'login', 'nome', 'updated_date']);
    }
    assert.ok(!JSON.stringify(corpo).includes(HASH_INERTE));
  });
});

describe('SCALE-01 — compatibilidade', () => {
  test('US-PG-08 GET /usuarios legado inalterado (array completo, ordem createdAt ASC)', async () => {
    const { cliente, token } = await tenantAutenticado({ codigo: 'leg' });
    await semear(cliente.id, 'lg', 120);
    const r = await app.inject({ method: 'GET', url: '/usuarios', headers: auth(token) });
    assert.equal(r.statusCode, 200);
    const lista = r.json();
    assert.ok(Array.isArray(lista));
    assert.equal(lista.length, 121);
    const datas = lista.map((u) => u.created_date);
    assert.deepEqual(datas, [...datas].sort());
  });

  test('US-PG-09 criar e desativar via API aparecem na página seguinte com filtros', async () => {
    const { token } = await tenantAutenticado({ codigo: 'fluxo' });
    const criado = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: auth(token),
      payload: { nome: 'Conta Fluxo', login: 'fluxo.nova', senha: 'senha-segura-1' },
    });
    assert.equal(criado.statusCode, 201);
    const id = criado.json().id;

    const topo = (await pagina(token, 'limit=1')).json();
    assert.equal(topo.items[0].id, id);

    const off = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${id}`,
      headers: auth(token),
      payload: { ativo: false },
    });
    assert.equal(off.statusCode, 200);
    const inativos = (await pagina(token, 'ativo=false')).json();
    assert.deepEqual(inativos.items.map((u) => u.id), [id]);
  });
});

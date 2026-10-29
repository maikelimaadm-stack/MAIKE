/**
 * SCALE-01 R3 — escopo de limpeza e exclusão mútua do benchmark de usuários.
 *
 * PostgreSQL real descartável. Prova que a limpeza de uma execução apaga só
 * os tenants que ELA criou (nem outra execução, nem tenant preexistente com
 * `perf-scale01-`), e que uma segunda execução concorrente é recusada antes
 * de qualquer DDL ou inserção (advisory lock, entre processos).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { limparBanco, encerrar } from './helpers.mjs';
import {
  adquirirLockBench,
  limparClientesDaExecucao,
  novoIdExecucao,
  prefixoDaExecucao,
  PREFIXO_BASE,
} from '../../scripts/performance/benchEscopo.mjs';

const prisma = () => getPrismaClient();

before(async () => {
  await prisma().$connect();
});

after(async () => {
  await encerrar();
});

beforeEach(async () => {
  await limparBanco();
});

/** Tenant sintético com 3 usuários e 1 AuditLog. */
const tenant = async (codigo) => {
  const cliente = await prisma().cliente.create({ data: { codigo, nome: codigo } });
  const usuarios = await Promise.all(
    [1, 2, 3].map((i) =>
      prisma().usuario.create({
        data: { cliente_id: cliente.id, nome: `U${i}`, login: `${codigo}.u${i}`, senha_hash: 'x' },
      })
    )
  );
  await prisma().auditLog.create({
    data: { cliente_id: cliente.id, usuario_id: usuarios[0].id, acao: 'create', entidade: 'Usuario', request_id: 'r' },
  });
  return cliente;
};

const existe = async (id) => {
  const c = await prisma().cliente.findUnique({ where: { id } });
  const u = await prisma().usuario.count({ where: { cliente_id: id } });
  return Boolean(c) && u === 3;
};

describe('SCALE-01 R3 — escopo de limpeza', () => {
  test('BE-01 limpar a execução A não toca execução B nem sentinelas com perf-scale01-', async () => {
    const idA = novoIdExecucao();
    const idB = novoIdExecucao();
    const a1 = await tenant(`${prefixoDaExecucao(idA)}1000`);
    const a2 = await tenant(`${prefixoDaExecucao(idA)}10000`);
    const b1 = await tenant(`${prefixoDaExecucao(idB)}1000`);
    const sentinelaManual = await tenant(`${PREFIXO_BASE}sentinela-manual`);
    const sentinelaFormatoAntigo = await tenant(`${PREFIXO_BASE}1000-1761740000000`);

    const r = await limparClientesDaExecucao(prisma(), {
      prefixo: prefixoDaExecucao(idA),
      clienteIds: [a1.id, a2.id],
    });
    assert.deepEqual(r, { clientes: 2, usuarios: 6, auditLogs: 2 });
    assert.equal(await prisma().cliente.count({ where: { id: { in: [a1.id, a2.id] } } }), 0);
    for (const t of [b1, sentinelaManual, sentinelaFormatoAntigo]) {
      assert.equal(await existe(t.id), true, `${t.codigo} deveria permanecer`);
    }
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: b1.id } }), 1);
  });

  test('BE-02 id de outra execução ou sentinela passado por engano não é apagado (prefixo é 2ª trava)', async () => {
    const idA = novoIdExecucao();
    const b1 = await tenant(`${prefixoDaExecucao(novoIdExecucao())}1000`);
    const sentinela = await tenant(`${PREFIXO_BASE}sentinela`);
    const r = await limparClientesDaExecucao(prisma(), {
      prefixo: prefixoDaExecucao(idA),
      clienteIds: [b1.id, sentinela.id],
    });
    assert.deepEqual(r, { clientes: 0, usuarios: 0, auditLogs: 0 });
    assert.equal(await existe(b1.id), true);
    assert.equal(await existe(sentinela.id), true);
  });

  test('BE-03 prefixo genérico ou id inválido é recusado; conjunto vazio não apaga nada', async () => {
    const sentinela = await tenant(`${PREFIXO_BASE}sentinela-vazio`);
    await assert.rejects(() =>
      limparClientesDaExecucao(prisma(), { prefixo: PREFIXO_BASE, clienteIds: [sentinela.id] })
    );
    assert.throws(() => prefixoDaExecucao('../../x'));
    const r = await limparClientesDaExecucao(prisma(), { prefixo: prefixoDaExecucao(novoIdExecucao()), clienteIds: [] });
    assert.deepEqual(r, { clientes: 0, usuarios: 0, auditLogs: 0 });
    assert.equal(await existe(sentinela.id), true);
  });
});

describe('SCALE-01 R3 — exclusão mútua entre processos', () => {
  test('BE-04 segunda execução é recusada antes de DDL/inserção; lock liberado depois', async () => {
    const base = new URL(process.env.DATABASE_URL);
    const nome = `maike_perf_lock_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    await prisma().$executeRawUnsafe(`CREATE DATABASE "${nome}"`);
    const url = new URL(base);
    url.pathname = `/${nome}`;
    url.search = '';
    const tempUrl = url.toString();
    const temp = new PrismaClient({ datasources: { db: { url: tempUrl } }, log: ['error'] });
    const dir = mkdtempSync(join(tmpdir(), 'bench-lock-'));
    try {
      const primeiro = await adquirirLockBench(tempUrl);
      assert.equal(primeiro.ok, true);
      const segundoNoMesmoProcesso = await adquirirLockBench(tempUrl);
      assert.equal(segundoNoMesmoProcesso.ok, false, 'lock é por sessão, não por processo');

      // Em container (CI), o servidor responde com o IP da bridge Docker; o
      // opt-in exato é o mesmo que um operador usaria localmente.
      const [{ servidor }] = await temp.$queryRawUnsafe(
        `SELECT host(inet_server_addr()) AS servidor`
      );
      const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/performance/usuarios-bench.mjs', import.meta.url))], {
        cwd: dir,
        env: {
          PATH: process.env.PATH,
          HOME: dir,
          PERF_TEST_LOCAL: 'sim',
          PERF_GUARD_TRACE: '1',
          DATABASE_URL: tempUrl,
          ...(servidor ? { PERF_SERVIDOR_PERMITIDO: servidor } : {}),
        },
        encoding: 'utf8',
        timeout: 60000,
      });
      const saida = `${r.stdout}\n${r.stderr}`;
      assert.equal(r.status, 2, saida);
      assert.match(saida, /outra execução do usuarios-bench está ativa/);
      assert.match(saida, /TRACE IDENTIDADE_OK/);
      assert.doesNotMatch(saida, /TRACE LOCK_OK/);
      assert.doesNotMatch(saida, /índice .* na origem/, 'chegou na fase de índice');
      assert.doesNotMatch(saida, new RegExp(base.password || '\\u0000'), 'credencial no log');

      // Nada foi criado no banco: nenhuma tabela, nenhum índice.
      const [{ n }] = await temp.$queryRawUnsafe(
        `SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
                 WHERE s.nspname = 'public')::int AS n`
      );
      assert.equal(n, 0);

      await primeiro.liberar();
      const depois = await adquirirLockBench(tempUrl);
      assert.equal(depois.ok, true, 'lock liberado ao final');
      await depois.liberar();
    } finally {
      await temp.$disconnect();
      rmSync(dir, { recursive: true, force: true });
      await prisma().$executeRawUnsafe(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
    }
  });
});

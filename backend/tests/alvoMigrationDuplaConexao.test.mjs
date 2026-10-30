/**
 * PR145-G4-R1 — `deploy:migrate` só migra se runtime e migration forem o MESMO
 * banco lógico do cluster esperado. Roda o runner REAL contra PostgreSQL real.
 */

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { encerrar } from './helpers.mjs';

const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../../scripts/deploy/run-migrations.mjs', import.meta.url));
const BANCO_B = 'maike_alvo_b_teste';
const A = process.env.DATABASE_URL;
const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
const outroHost = (url) => {
  const u = new URL(url);
  u.hostname = u.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  u.searchParams.set('application_name', 'migration-g4');
  return u.toString();
};
let SID;
let B;

const rodar = (env) => {
  const base = { ...process.env };
  delete base.POSTGRES_PRISMA_URL;
  delete base.POSTGRES_URL;
  delete base.MIGRATION_DATABASE_URL;
  return spawnSync(process.execPath, [SCRIPT], { cwd: RAIZ, encoding: 'utf8', env: { ...base, MIGRATION_EXIGIR_CONFERENCIA: 'sim', ...env } });
};
const historicoEm = async (url) => {
  const c = new PrismaClient({ datasourceUrl: url });
  try {
    return (await c.$queryRawUnsafe(`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS tem`))[0].tem;
  } finally {
    await c.$disconnect();
  }
};

before(async () => {
  const p = getPrismaClient();
  SID = (await p.$queryRawUnsafe(`SELECT system_identifier::text AS sid FROM pg_control_system()`))[0].sid;
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_B}`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_B}`);
  B = comBanco(A, BANCO_B);
});
after(async () => {
  await getPrismaClient().$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_B}`);
  await encerrar();
});

describe('barreira de alvo do deploy:migrate (duas conexões)', () => {
  test('DC-N1 runtime no banco A, migration no B (mesmo cluster, outro banco lógico) → nenhuma migration', async () => {
    const r = rodar({ DATABASE_URL: A, MIGRATION_DATABASE_URL: B, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /DEPLOY-MIGRATION-TARGET-UNVERIFIED/);
    assert.match(r.stderr, /current_database difere|OID do banco difere/);
    assert.match(r.stderr, /Nenhuma migration foi executada/);
    assert.equal(await historicoEm(B), false, 'o banco B continua sem nenhuma migration');
    assert.equal(`${r.stdout}${r.stderr}`.includes(B) || `${r.stdout}${r.stderr}`.includes(A), false, 'URLs nunca impressas');
  });

  test('DC-N2 POSTGRES_PRISMA_URL herdada aponta para outro banco → recusa (vale o runtime RESOLVIDO)', async () => {
    const r = rodar({ DATABASE_URL: A, POSTGRES_PRISMA_URL: B, MIGRATION_DATABASE_URL: A, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /DEPLOY-MIGRATION-TARGET-UNVERIFIED/);
    assert.match(r.stderr, /runtime: public\._prisma_migrations ausente|current_database difere/);
  });

  test('DC-N3 cluster diferente do esperado ou identificador ausente → recusa', () => {
    const errado = rodar({ DATABASE_URL: A, MIGRATION_DATABASE_URL: A, MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '1234567' });
    assert.equal(errado.status, 1);
    assert.match(errado.stderr, /system_identifier difere do esperado/);
    const ausente = rodar({ DATABASE_URL: A, MIGRATION_DATABASE_URL: A });
    assert.equal(ausente.status, 1);
    assert.match(ausente.stderr, /MIGRATION_EXPECTED_SYSTEM_IDENTIFIER ausente/);
  });

  test('DC-P1 URLs diferentes (host e parâmetros) para o MESMO banco → aceita e migra', () => {
    const r = rodar({ DATABASE_URL: A, MIGRATION_DATABASE_URL: outroHost(A), MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /alvo conferido nas duas conexões/);
    assert.match(r.stdout, /No pending migrations|migrations aplicadas/);
  });
});

/**
 * SCALE-01 R2 — o benchmark local recusa banco errado ANTES de importar Prisma.
 *
 * Falha original: o script validava só DATABASE_URL, mas o backend conecta em
 * `POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL` (com `.env`). Estes
 * testes rodam o script real em processo filho, com ambiente limpo e `.env`
 * de fixture num diretório temporário, e provam: exit 2, mensagem RECUSADO e
 * nenhum marcador `TRACE ENV_OK`/`TRACE IMPORT_PRISMA` — ou seja, recusa antes
 * de qualquer import de banco, conexão, carga ou DDL. Nenhum banco é usado.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  validarAmbienteBench,
  validarIdentidadeConexao,
  servidoresPermitidos,
  urlEfetivaDoBackend,
  descreverUrl,
} from '../../performance/benchGuard.mjs';

const SCRIPT = resolve('scripts/performance/usuarios-bench.mjs');
const LOCAL = 'postgresql://perf:segredo-local@localhost:5433/maike_perf';
const REMOTO = 'postgresql://postgres.abc:segredo-remoto@aws-0-sa-east-1.pooler.supabase.com:6543/postgres';
const REMOTO_DIRETO = 'postgresql://postgres:segredo-remoto@db.abcdefgh.supabase.co:5432/postgres';

/** Roda o script num cwd temporário com `.env` opcional e ambiente mínimo. */
const rodar = (vars, dotenv = null) => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-guard-'));
  try {
    if (dotenv) writeFileSync(join(dir, '.env'), dotenv);
    const r = spawnSync(process.execPath, [SCRIPT], {
      cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, PERF_GUARD_TRACE: '1', ...vars },
      encoding: 'utf8',
      timeout: 20000,
    });
    return { status: r.status, saida: `${r.stdout}\n${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const assertRecusaPreConexao = (r, trecho) => {
  assert.equal(r.status, 2, r.saida);
  assert.match(r.saida, /RECUSADO/);
  if (trecho) assert.match(r.saida, trecho);
  assert.doesNotMatch(r.saida, /TRACE ENV_OK/, 'passou do guard de ambiente');
  assert.doesNotMatch(r.saida, /TRACE IMPORT_PRISMA/, 'chegou a importar Prisma');
  assert.doesNotMatch(r.saida, /segredo-(local|remoto)/, 'vazou credencial no log');
};

describe('usuarios-bench — recusa em processo real, antes de importar Prisma', () => {
  test('BG-01 sem PERF_TEST_LOCAL=sim', () => {
    assertRecusaPreConexao(rodar({ DATABASE_URL: LOCAL }), /PERF_TEST_LOCAL/);
  });

  test('BG-02 DATABASE_URL remoto (Supabase direto e pooler)', () => {
    assertRecusaPreConexao(rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: REMOTO_DIRETO }));
    assertRecusaPreConexao(rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: REMOTO }));
  });

  test('BG-03 (falha original) DATABASE_URL local + POSTGRES_PRISMA_URL remoto no processo', () => {
    assertRecusaPreConexao(
      rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL, POSTGRES_PRISMA_URL: REMOTO }),
      /POSTGRES_PRISMA_URL/
    );
  });

  test('BG-04 (falha original via .env) POSTGRES_PRISMA_URL remoto só no .env', () => {
    assertRecusaPreConexao(
      rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL }, `POSTGRES_PRISMA_URL=${REMOTO}\n`),
      /POSTGRES_PRISMA_URL/
    );
  });

  test('BG-05 POSTGRES_URL remoto (processo e .env)', () => {
    assertRecusaPreConexao(rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL, POSTGRES_URL: REMOTO_DIRETO }), /POSTGRES_URL/);
    assertRecusaPreConexao(rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL }, `POSTGRES_URL=${REMOTO_DIRETO}\n`), /POSTGRES_URL/);
  });

  test('BG-06 MIGRATION_DATABASE_URL / DIRECT_URL diferentes', () => {
    const outroLocal = 'postgresql://perf@localhost:5433/maike_test_outro';
    assertRecusaPreConexao(
      rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL, MIGRATION_DATABASE_URL: outroLocal }),
      /MIGRATION_DATABASE_URL/
    );
    assertRecusaPreConexao(rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL, DIRECT_URL: REMOTO_DIRETO }), /DIRECT_URL/);
  });

  test('BG-07 NODE_ENV=production no processo e via .env', () => {
    assertRecusaPreConexao(rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL, NODE_ENV: 'production' }), /production/);
    assertRecusaPreConexao(rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL }, 'NODE_ENV=production\n'), /production/);
  });

  test('BG-08 porta 6543 local e banco não descartável', () => {
    assertRecusaPreConexao(
      rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: 'postgresql://p@localhost:6543/maike_perf' }),
      /6543/
    );
    assertRecusaPreConexao(
      rodar({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: 'postgresql://p@localhost:5432/maike_prod' }),
      /maike_prod/
    );
  });

  test('BG-09 sem DATABASE_URL explícita (mesmo com alias local)', () => {
    assertRecusaPreConexao(rodar({ PERF_TEST_LOCAL: 'sim', POSTGRES_PRISMA_URL: LOCAL }), /DATABASE_URL/);
  });
});

describe('benchGuard — função pura', () => {
  test('BG-10 aceita só DATABASE_URL local de teste, com aliases ausentes ou idênticos', () => {
    const ok = validarAmbienteBench({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL });
    assert.equal(ok.ok, true);
    assert.equal(ok.banco, 'maike_perf');
    const idem = validarAmbienteBench({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL, POSTGRES_PRISMA_URL: LOCAL, MIGRATION_DATABASE_URL: LOCAL });
    assert.equal(idem.ok, true);
  });

  test('BG-11 precedência igual à do backend e outros vetores remotos', () => {
    assert.equal(urlEfetivaDoBackend({ DATABASE_URL: LOCAL, POSTGRES_PRISMA_URL: REMOTO }), REMOTO);
    assert.equal(urlEfetivaDoBackend({ DATABASE_URL: LOCAL, POSTGRES_URL: REMOTO }), LOCAL);
    for (const url of [
      'postgresql://p@10.0.0.5:5432/maike_perf',
      'postgresql://p@localhost:5432/maike_perf?host=db.remoto.com',
      'postgresql://p@localhost:5432/maike_perf?pgbouncer=true',
      'mysql://p@localhost:3306/maike_perf',
    ]) {
      assert.equal(validarAmbienteBench({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: url }).ok, false, url);
    }
    assert.equal(validarAmbienteBench({ PERF_TEST_LOCAL: 'sim', DATABASE_URL: LOCAL, POSTGRES_URL_NON_POOLING: REMOTO }).ok, false);
  });

  test('BG-12 identidade da conexão aberta e log sem credencial', () => {
    assert.equal(validarIdentidadeConexao({ banco: 'maike_perf', servidor: '127.0.0.1/32', rolesSupabase: 0 }, 'maike_perf').ok, true);
    assert.equal(validarIdentidadeConexao({ banco: 'maike_perf', servidor: null, rolesSupabase: 0 }, 'maike_perf').ok, true);
    assert.equal(validarIdentidadeConexao({ banco: 'postgres', servidor: '127.0.0.1', rolesSupabase: 0 }, 'maike_perf').ok, false);
    assert.equal(validarIdentidadeConexao({ banco: 'maike_perf', servidor: '10.1.2.3', rolesSupabase: 0 }, 'maike_perf').ok, false);
    assert.equal(validarIdentidadeConexao({ banco: 'maike_perf', servidor: '127.0.0.1', rolesSupabase: 2 }, 'maike_perf').ok, false);
    assert.doesNotMatch(descreverUrl(LOCAL), /segredo/);
  });

  test('BG-13 PERF_SERVIDOR_PERMITIDO aceita só IP privado exato (container local)', () => {
    const id = (servidor) => ({ banco: 'maike_perf', servidor, rolesSupabase: 0 });
    const extras = servidoresPermitidos('172.18.0.2, 8.8.8.8, 10.0.0.9, abc, 172.32.0.1');
    assert.deepEqual([...extras].sort(), ['10.0.0.9', '172.18.0.2']);
    assert.equal(validarIdentidadeConexao(id('172.18.0.2/32'), 'maike_perf', extras).ok, true);
    assert.equal(validarIdentidadeConexao(id('172.18.0.3'), 'maike_perf', extras).ok, false, 'outro IP privado');
    assert.equal(validarIdentidadeConexao(id('8.8.8.8'), 'maike_perf', extras).ok, false, 'público nunca');
    assert.equal(validarIdentidadeConexao(id('172.18.0.2'), 'maike_perf').ok, false, 'sem opt-in');
    const comRoles = { banco: 'maike_perf', servidor: '172.18.0.2', rolesSupabase: 1 };
    assert.equal(validarIdentidadeConexao(comRoles, 'maike_perf', extras).ok, false, 'Supabase mesmo permitido');
  });
});

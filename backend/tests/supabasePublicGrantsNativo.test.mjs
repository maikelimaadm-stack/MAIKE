/**
 * Lab: após a migration P8, papéis anon/authenticated não leem domínio;
 * o Prisma (papel da aplicação) continua lendo/escrevendo.
 *
 * Roda no PostgreSQL descartável da suíte backend — nunca no Supabase remoto.
 * Usa `psql` para SET ROLE (sem dependência `pg` no package).
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { limparBanco, encerrar, criarTenant } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL ausente — lab de grants exige PostgreSQL real');
}

const psql = (sql, { expectFail = false } = {}) => {
  const r = spawnSync(
    'psql',
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8' }
  );
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  if (expectFail) {
    assert.notEqual(r.status, 0, `esperava falha SQL, passou:\n${output}`);
    return output;
  }
  assert.equal(r.status, 0, `psql falhou:\n${output}`);
  return (r.stdout || '').trim();
};

const papelExiste = (nome) =>
  psql(`SELECT 1 FROM pg_roles WHERE rolname = '${nome}'`) === '1';

const garantirPapeisLab = () => {
  const criar = spawnSync(
    'psql',
    [
      databaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-tAc',
      `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
`,
    ],
    { encoding: 'utf8' }
  );

  if (criar.status !== 0) {
    const out = `${criar.stdout || ''}${criar.stderr || ''}`;
    if (!papelExiste('anon') || !papelExiste('authenticated')) {
      assert.fail(
        'papéis anon/authenticated ausentes e o usuário do DATABASE_URL não tem CREATEROLE.\n' +
          '  Aplique como superuser: scripts/db/lab-supabase-api-roles.sql\n' +
          `  detalhe: ${out}`
      );
    }
  }

  // SET ROLE exige membership (no Docker maike é superuser; no host precisa GRANT).
  const grant = spawnSync(
    'psql',
    [
      databaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-tAc',
      `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
    BEGIN
      EXECUTE format('GRANT anon TO %I', current_user);
      EXECUTE format('GRANT authenticated TO %I', current_user);
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END IF;
END $$;
`,
    ],
    { encoding: 'utf8' }
  );
  if (grant.status !== 0) {
    // Membership pode já existir via bootstrap superuser; SET ROLE dirá a verdade.
  }

  // Simula estado pré-correção: grants amplos (como no Supabase auditado).
  psql(`
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
`);
};

const aplicarCorrecaoComoNaMigration = () => {
  psql(`
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
`);
  psql(`
DO $$
DECLARE tbl record;
BEGIN
  FOR tbl IN
    SELECT c.relname AS nome
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.nome);
  END LOOP;
END $$;
`);
};

describe('P8 — supabase public grants / RLS (lab)', () => {
  before(() => {
    garantirPapeisLab();
    aplicarCorrecaoComoNaMigration();
  });

  beforeEach(async () => {
    await limparBanco();
  });

  after(async () => {
    await encerrar();
  });

  test('BE-P8-GRANTS-01 anon não SELECT em Usuario após REVOKE+RLS', async () => {
    await criarTenant({ login: 'lab_anon_block' });
    const out = psql(`SET ROLE anon; SELECT id FROM public."Usuario" LIMIT 1;`, {
      expectFail: true,
    });
    assert.match(out, /permission denied|row-level security/i);
  });

  test('BE-P8-GRANTS-02 authenticated não SELECT em AreaPastagem', () => {
    const out = psql(
      `SET ROLE authenticated; SELECT id FROM public."AreaPastagem" LIMIT 1;`,
      { expectFail: true }
    );
    assert.match(out, /permission denied|row-level security/i);
  });

  test('BE-P8-GRANTS-03 Prisma ainda lê/escreve Cliente/Usuario', async () => {
    const { cliente, usuario } = await criarTenant({ login: 'lab_prisma_ok' });
    const prisma = getPrismaClient();
    const lido = await prisma.usuario.findFirst({
      where: { id: usuario.id, cliente_id: cliente.id },
    });
    assert.ok(lido);
    assert.equal(lido.login, 'lab_prisma_ok');
  });

  test('BE-P8-GRANTS-04 todas as tabelas public têm RLS ligado', () => {
    const out = psql(`
SELECT coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false;
`);
    assert.equal(out, '', `tabelas sem RLS: ${out}`);
  });
});

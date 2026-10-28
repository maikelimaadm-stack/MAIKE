/**
 * Provas do `gate:supabase-public-grants` (P8 / D-PROD-56).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { makeTempDir, cleanup, writeFile, runGate, REPO_ROOT } from './helpers.mjs';

const GATE = 'gate-supabase-public-grants.mjs';
const DIR = '20261028240000_p8_supabase_public_revoke_rls';
const FILE = `backend/prisma/migrations/${DIR}/migration.sql`;

const realSql = () => readFileSync(join(REPO_ROOT, FILE), 'utf8');

const rodar = (dir) => runGate(GATE, { env: { SUPABASE_GRANTS_ROOT: dir } });

const passa = (dir) => {
  const r = rodar(dir);
  assert.equal(r.status, 0, r.output);
};

const falhaCom = (dir, codigo) => {
  const r = rodar(dir);
  assert.equal(r.status, 1, `esperava reprovação, saiu 0:\n${r.output}`);
  assert.match(r.output, new RegExp(codigo), r.output);
};

const SQL_OK = `
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
END $$;
DO $$ BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', 'Cliente');
END $$;
DO $$ BEGIN
  EXECUTE 'CREATE POLICY maike_backend_all ON public."Cliente" FOR ALL TO maike_vercel USING (true) WITH CHECK (true)';
END $$;
`;

describe('gate:supabase-public-grants', () => {
  test('P56-T01 repositório real passa', () => {
    const r = runGate(GATE);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /PASSOU/);
  });

  test('P56-T02 SQL mínimo válido passa', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, FILE, SQL_OK);
      passa(dir);
    } finally {
      cleanup(dir);
    }
  });

  test('P56-T03 migration ausente reprova P56-SUPABASE-MIGRATION', () => {
    const dir = makeTempDir();
    try {
      writeFile(dir, 'backend/prisma/migrations/.keep', '');
      falhaCom(dir, 'P56-SUPABASE-MIGRATION');
    } finally {
      cleanup(dir);
    }
  });

  test('P56-T04 sem REVOKE anon reprova P56-SUPABASE-REVOKE', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        FILE,
        `
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
        ALTER TABLE public."Cliente" ENABLE ROW LEVEL SECURITY;
        `
      );
      falhaCom(dir, 'P56-SUPABASE-REVOKE');
    } finally {
      cleanup(dir);
    }
  });

  test('P56-T05 FORCE RLS reprova P56-SUPABASE-NO-FORCE', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        FILE,
        `
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
        ALTER TABLE public."Cliente" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public."Cliente" FORCE ROW LEVEL SECURITY;
        `
      );
      falhaCom(dir, 'P56-SUPABASE-NO-FORCE');
    } finally {
      cleanup(dir);
    }
  });

  test('P56-T06 política aberta para anon reprova P56-SUPABASE-NO-OPEN-POLICY', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        FILE,
        `
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
        ALTER TABLE public."Cliente" ENABLE ROW LEVEL SECURITY;
        CREATE POLICY open_all ON public."Cliente" FOR ALL TO anon USING (true) WITH CHECK (true);
        `
      );
      falhaCom(dir, 'P56-SUPABASE-NO-OPEN-POLICY');
    } finally {
      cleanup(dir);
    }
  });

  test('P56-T07 comentário citando FORCE não reprova (controle positivo)', () => {
    const dir = makeTempDir();
    try {
      writeFile(
        dir,
        FILE,
        `
        -- NÃO use FORCE ROW LEVEL SECURITY
        -- nem CREATE POLICY ... TO anon USING (true)
        ${SQL_OK}
        `
      );
      passa(dir);
    } finally {
      cleanup(dir);
    }
  });

  test('P56-T08 SQL real do repositório contém maike_vercel e não mira anon', () => {
    const sql = realSql();
    assert.match(sql, /maike_vercel/);
    assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/i);
    assert.doesNotMatch(
      sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' '),
      /CREATE\s+POLICY[^;]*\bTO\s+anon\b/i
    );
  });
});

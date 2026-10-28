#!/usr/bin/env node
/**
 * Gate: P8 / D-PROD-56 — migration versionada que revoga grants Data API
 * (anon/authenticated) em `public` e habilita RLS sem políticas abertas para
 * esses papéis.
 *
 * Absoluto: sem `--update`, sem baseline, sem correção automática.
 *
 * Ele existe porque a correção vive em SQL de migration — e SQL de migration
 * apodrece em silêncio se alguém:
 *   - apaga o REVOKE "porque o RLS já basta";
 *   - coloca FORCE ROW LEVEL SECURITY e derruba o papel de backend;
 *   - cria política `USING (true)` para `anon`/`authenticated` só para
 *     silenciar o linter do Supabase (falso isolamento).
 *
 * Códigos:
 *   P56-SUPABASE-MIGRATION · P56-SUPABASE-REVOKE · P56-SUPABASE-RLS
 *   P56-SUPABASE-NO-FORCE · P56-SUPABASE-NO-OPEN-POLICY
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.SUPABASE_GRANTS_ROOT || process.cwd();
const MIGRATIONS_DIR = 'backend/prisma/migrations';
const MIGRATION_DIR_NAME = '20261028240000_p8_supabase_public_revoke_rls';
const MIGRATION_FILE = join(MIGRATIONS_DIR, MIGRATION_DIR_NAME, 'migration.sql');

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push({ codigo, mensagem });

const caminho = (rel) => join(ROOT, rel);
const ler = (rel) => readFileSync(caminho(rel), 'utf8');

const semComentariosSql = (fonte) =>
  fonte
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');

if (!existsSync(caminho(MIGRATIONS_DIR))) {
  registrar('P56-SUPABASE-MIGRATION', `diretório ausente: ${MIGRATIONS_DIR}`);
} else {
  const dirs = readdirSync(caminho(MIGRATIONS_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (!dirs.includes(MIGRATION_DIR_NAME)) {
    registrar(
      'P56-SUPABASE-MIGRATION',
      `migration versionada ausente: ${MIGRATION_DIR_NAME}`
    );
  }
}

if (!existsSync(caminho(MIGRATION_FILE))) {
  registrar('P56-SUPABASE-MIGRATION', `arquivo ausente: ${MIGRATION_FILE}`);
} else {
  const bruto = ler(MIGRATION_FILE);
  const sql = semComentariosSql(bruto);
  const sqlCompacto = sql.replace(/\s+/g, ' ');

  const temRevokeAnon =
    /REVOKE\s+ALL\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+FROM\s+anon/i.test(
      sqlCompacto
    );
  const temRevokeAuth =
    /REVOKE\s+ALL\s+ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+FROM\s+authenticated/i.test(
      sqlCompacto
    );

  if (!temRevokeAnon) {
    registrar(
      'P56-SUPABASE-REVOKE',
      'migration não revoga ALL ON ALL TABLES IN SCHEMA public FROM anon'
    );
  }
  if (!temRevokeAuth) {
    registrar(
      'P56-SUPABASE-REVOKE',
      'migration não revoga ALL ON ALL TABLES IN SCHEMA public FROM authenticated'
    );
  }

  if (!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sqlCompacto)) {
    registrar(
      'P56-SUPABASE-RLS',
      'migration não habilita ROW LEVEL SECURITY nas tabelas public'
    );
  }

  if (/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(sqlCompacto)) {
    registrar(
      'P56-SUPABASE-NO-FORCE',
      'migration usa FORCE ROW LEVEL SECURITY — proibido (quebra owner/backend)'
    );
  }

  // Políticas abertas para papéis da Data API = falso isolamento.
  const politicas = [...sqlCompacto.matchAll(/CREATE\s+POLICY\b[^;]*/gi)].map(
    (m) => m[0]
  );
  for (const pol of politicas) {
    const alvoAnon = /\bTO\s+anon\b/i.test(pol);
    const alvoAuth = /\bTO\s+authenticated\b/i.test(pol);
    const usingTrue = /USING\s*\(\s*true\s*\)/i.test(pol);
    if ((alvoAnon || alvoAuth) && usingTrue) {
      registrar(
        'P56-SUPABASE-NO-OPEN-POLICY',
        `política aberta para Data API proibida: ${pol.slice(0, 120)}…`
      );
    }
    if (alvoAnon || alvoAuth) {
      registrar(
        'P56-SUPABASE-NO-OPEN-POLICY',
        `CREATE POLICY não pode mirar anon/authenticated nesta missão: ${pol.slice(0, 120)}…`
      );
    }
  }
}

if (falhas.length) {
  console.error('gate:supabase-public-grants — FALHOU\n');
  for (const f of falhas) {
    console.error(`  - [${f.codigo}] ${f.mensagem}`);
  }
  process.exit(1);
}

console.log(
  'gate:supabase-public-grants — PASSOU (REVOKE anon/authenticated + RLS sem FORCE nem política aberta Data API)'
);

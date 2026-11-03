/**
 * PR174-R6 — classificação EXPAND (provada pelo SQL) e barreiras do runner
 * pré-merge `scripts/deploy/premerge-migrate.mjs`. Sem banco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';

import { classificarMigrations } from '../../deploy/premergeMigrateLib.mjs';

const ler = (n) => ({ nome: n, sql: readFileSync(`backend/prisma/migrations/${n}/migration.sql`, 'utf8') });

test('as migrations da PR #174 são EXPAND comprovado (só tabelas novas + coluna anulável/FK em LancamentoTarefa)', () => {
  const c = classificarMigrations([ler('20261102200000_rebanho_ledger_posicoes'), ler('20261103100000_rebanho_ledger_r1_manejos')]);
  assert.deepEqual(c.violacoes, []);
  assert.equal(c.expand, true);
  assert.deepEqual(c.tabelas_novas, ['EventoRebanho', 'PartidaRebanho', 'PesoRebanho', 'PosicaoRebanho', 'RebanhoLedgerAtivacao']);
});

test('instruções destrutivas/incompatíveis em tabela pré-existente são violação', () => {
  const casos = [
    'DROP TABLE "Lote";',
    'ALTER TABLE "Lote" DROP COLUMN "x";',
    'ALTER TABLE "Lote" RENAME COLUMN "a" TO "b";',
    'ALTER TABLE "Lote" ALTER COLUMN "a" SET NOT NULL;',
    'ALTER TABLE "Lote" ADD COLUMN "z" INTEGER NOT NULL;',
    'ALTER TABLE "Lote" ADD CONSTRAINT "c" CHECK ("x" > 0);',
    'CREATE UNIQUE INDEX "u" ON "Lote"("x");',
    'UPDATE "Lote" SET x = 1;',
    'DELETE FROM "Lote";',
    'TRUNCATE "Lote";',
    "DO $$ BEGIN EXECUTE 'ALTER TABLE public.\"Lote\" ENABLE ROW LEVEL SECURITY'; END $$;",
  ];
  for (const sql of casos) assert.equal(classificarMigrations([{ nome: 'x', sql }]).expand, false, sql);
});

test('o que é compatível com o backend antigo passa', () => {
  const sql = `CREATE TABLE "Nova" ("id" TEXT NOT NULL);
ALTER TABLE "Nova" DROP CONSTRAINT "a";
ALTER TABLE "Lote" ADD COLUMN "n" VARCHAR(10);
ALTER TABLE "Lote" ADD COLUMN "d" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Lote" ADD CONSTRAINT "f" FOREIGN KEY ("n") REFERENCES "Nova"("id");
CREATE INDEX "i" ON "Lote"("n");
-- DROP TABLE "Lote"; (comentário não conta)`;
  assert.deepEqual(classificarMigrations([{ nome: 'ok', sql }]).violacoes, []);
});

test('runner pré-merge: SHA errado/inválido → exit 3 sem aplicar; nunca imprime URL', () => {
  const env = { ...process.env, MIGRATION_DATABASE_URL: 'postgresql://u:SEGREDO@h:5432/d', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '1' };
  const invalido = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', 'abc', '--aplicar'], { encoding: 'utf8', env });
  assert.equal(invalido.status, 3);
  const outro = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', '0'.repeat(40), '--aplicar'], { encoding: 'utf8', env });
  assert.equal(outro.status, 3);
  assert.match(outro.stderr, /HEAD não é o SHA aprovado/);
  for (const r of [invalido, outro]) assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\//);
});

test('runner pré-merge: no SHA atual, árvore limpa → plano (dry-run) sem aplicar; árvore suja → recusa', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sujo = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  const r = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', head], { encoding: 'utf8', env: { ...process.env, MIGRATION_DATABASE_URL: '', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '' } });
  if (sujo) {
    assert.equal(r.status, 3);
    assert.match(r.stderr, /árvore suja/);
  } else if (/base origin\/main indisponível/.test(r.stderr)) {
    assert.equal(r.status, 3); // checkout raso sem origin/main: recusa fechada
  } else {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /PLANO OK \(dry-run\)/);
  }
});

test('cutover: barreira "backend novo em produção" (pura) e CLI remoto sem prova → recusa sem conectar', async () => {
  const { conferirBackendNovo } = await import('../../ops/cutoverRebanhoLib.mjs');
  const sha = 'a'.repeat(40);
  const novo = { status: 'ok', release: sha, capacidades: ['rebanho-ledger-cutover-r6'] };
  assert.deepEqual(conferirBackendNovo({ health: novo, releaseSha: sha, shaNaMain: true }), { ok: true, motivo: null });
  assert.equal(conferirBackendNovo({ health: { status: 'ok', processo: 'up' }, releaseSha: sha, shaNaMain: true }).motivo, 'BACKEND_ANTIGO_EM_PRODUCAO');
  assert.equal(conferirBackendNovo({ health: { ...novo, release: 'b'.repeat(40) }, releaseSha: sha, shaNaMain: true }).motivo, 'BACKEND_EM_OUTRO_SHA');
  assert.equal(conferirBackendNovo({ health: novo, releaseSha: sha, shaNaMain: false }).motivo, 'RELEASE_FORA_DA_MAIN');
  assert.equal(conferirBackendNovo({ health: null, releaseSha: sha, shaNaMain: true }).motivo, 'BACKEND_ANTIGO_EM_PRODUCAO');
  const r = spawnSync('node', ['scripts/ops/cutover-rebanho.mjs', '--cliente-id', 'c', '--empresa-id', 'e', '--executar', '--estrategia', 'entradas', '--confirmar-empresa', 'F', '--usuario-admin-id', 'u'], {
    encoding: 'utf8', env: { ...process.env, CUTOVER_DATABASE_URL: 'postgresql://u:SEGREDO@banco.exemplo.invalid:5432/d', CUTOVER_EXPECTED_SYSTEM_IDENTIFIER: '1' },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--backend-url/);
  assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\//);
});

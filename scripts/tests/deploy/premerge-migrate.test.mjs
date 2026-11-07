/**
 * PR174-R6/R7 — allowlist EXPAND fechada (manifesto pinado + conferência
 * estrutural), conferência do histórico do alvo, barreiras do runner
 * pré-merge e da identidade de produção do cutover. Sem banco.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';

import { classificarMigrations, conferirHistoricoRemoto, sha256, MIGRATIONS_APROVADAS, migrationsDoManifestoFaltando } from '../../deploy/premergeMigrateLib.mjs';
import { conferirBackendNovo, validarOrigemProducao } from '../../ops/cutoverRebanhoLib.mjs';

const NOMES = Object.keys(MIGRATIONS_APROVADAS);
const ler = (n) => ({ nome: n, sql: readFileSync(`backend/prisma/migrations/${n}/migration.sql`, 'utf8') });
const BASE = `CREATE TABLE "Nova" ("id" TEXT NOT NULL, "cliente_id" VARCHAR(64) NOT NULL);\n`;
/** Classifica SQL sintético com manifesto próprio (só para testar a conferência estrutural). */
const classificar = (sql, extra = {}) => classificarMigrations([{ nome: 'x', sql }], { manifesto: { x: sha256(sql) }, ...extra });

test('B1: as migrations do manifesto passam (pinadas + estrutura): só tabelas novas, LancamentoTarefa.posicao_id, Empresa.fuso_horario (D-PROD-122) e as épocas de sessão (D-PROD-143) anuláveis; Gestão P1 só com tabelas novas (D-PROD-145)', () => {
  const c = classificarMigrations(NOMES.map(ler));
  assert.deepEqual(c.violacoes, []);
  assert.deepEqual(c.tabelas_novas, ['CentroCusto', 'CentroCustoResultado', 'CentroResultado', 'EventoRebanho', 'PartidaRebanho', 'PesoRebanho', 'PosicaoRebanho', 'RebanhoLedgerAtivacao']);
  assert.deepEqual([...c.colunas_novas_em_tabelas_antigas].sort(), ['Cliente.sessao_epoca', 'Empresa.fuso_horario', 'LancamentoTarefa.posicao_id', 'Usuario.sessao_epoca']);
});

test('B2: padrão = RECUSAR — cada caso negativo é violação com código estável', () => {
  const casos = {
    'CREATE OR REPLACE FUNCTION f() RETURNS int AS $f$ SELECT 1 $f$ LANGUAGE sql;': 'SQL_NAO_RECONHECIDO',
    'CREATE OR REPLACE VIEW "v" AS SELECT 1;': 'SQL_NAO_RECONHECIDO',
    'GRANT ALL ON TABLE "Lote" TO anon;': 'SQL_NAO_RECONHECIDO',
    'REVOKE ALL ON TABLE "Usuario" FROM maike_vercel;': 'SQL_NAO_RECONHECIDO',
    'CREATE TRIGGER t AFTER INSERT ON "Lote" FOR EACH ROW EXECUTE FUNCTION f();': 'SQL_NAO_RECONHECIDO',
    'COPY "Lote" FROM \'/tmp/x\';': 'SQL_NAO_RECONHECIDO',
    'INSERT INTO "Lote" ("id") VALUES (\'x\');': 'SQL_NAO_RECONHECIDO',
    'SELECT pg_terminate_backend(1);': 'SQL_NAO_RECONHECIDO',
    "DO $$ BEGIN EXECUTE 'DELETE FROM \"Lote\"'; END $$;": 'DO_NAO_RECONHECIDO',
    'ALTER TABLE "Lote" DROP COLUMN "x";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ALTER COLUMN "a" SET NOT NULL;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" RENAME COLUMN "a" TO "b";': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ADD COLUMN "z" INTEGER NOT NULL DEFAULT 0;': 'ALTER_EM_TABELA_ANTIGA',
    'ALTER TABLE "Lote" ADD CONSTRAINT "c" CHECK ("x" > 0);': 'ALTER_EM_TABELA_ANTIGA',
    'TRUNCATE "Lote";': 'SQL_NAO_RECONHECIDO',
    'DROP TABLE "Lote";': 'SQL_NAO_RECONHECIDO',
    'UPDATE "Lote" SET x = 1;': 'SQL_NAO_RECONHECIDO',
    'DELETE FROM "Lote";': 'SQL_NAO_RECONHECIDO',
    'CREATE UNIQUE INDEX "u" ON "Lote"("x");': 'UNIQUE_EM_TABELA_ANTIGA',
  };
  for (const [sql, codigo] of Object.entries(casos)) {
    const c = classificar(BASE + sql);
    assert.equal(c.expand, false, sql);
    assert.ok(c.violacoes.some((v) => v.codigo === codigo), `${sql} → ${JSON.stringify(c.violacoes)}`);
  }
});

test('B3: manifesto — migration fora da lista ou com 1 byte diferente é recusada; DO de RLS só com hash auditado e tabela nova', () => {
  const [a] = NOMES.map(ler);
  assert.equal(classificarMigrations([{ ...a, sql: `${a.sql}\n` }]).violacoes[0].codigo, 'MIGRATION_CHECKSUM_DIVERGENTE');
  assert.equal(classificarMigrations([{ nome: '29990101000000_x', sql: BASE }]).violacoes[0].codigo, 'MIGRATION_NAO_APROVADA');
  const doNovo = `${BASE}DO $$ BEGIN EXECUTE 'ALTER TABLE public."Nova" ENABLE ROW LEVEL SECURITY'; END $$;`;
  assert.ok(classificar(doNovo).violacoes.some((v) => v.codigo === 'DO_NAO_RECONHECIDO'), 'DO não auditado é recusado mesmo sobre tabela nova');
});

test('B4: compatível com o backend antigo passa (tabela nova, coluna anulável + FK para tabela nova, índice não-único)', () => {
  const sql = `${BASE}ALTER TABLE "Nova" ADD CONSTRAINT "n_ok" CHECK ("id" <> '');
ALTER TABLE "Lote" ADD COLUMN "nova_id" VARCHAR(64);
ALTER TABLE "Lote" ADD CONSTRAINT "f" FOREIGN KEY ("cliente_id", "nova_id") REFERENCES "Nova"("cliente_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "i" ON "Lote"("cliente_id", "nova_id");
-- DROP TABLE "Lote"; (comentário não conta)`;
  assert.deepEqual(classificar(sql).violacoes, []);
});

test('B5: histórico do alvo — extra, checksum divergente, parcial ou pendência fora do manifesto → PREMERGE_MIGRATIONS_NAO_COMPROVADAS', () => {
  const locais = [{ nome: '20250101000000_base', checksum: 'b' }, ...NOMES.map((n) => ({ nome: n, checksum: MIGRATIONS_APROVADAS[n] }))];
  const ok = (n, c = 'b') => ({ migration_name: n, checksum: c, finished_at: new Date(), rolled_back_at: null });
  assert.deepEqual(conferirHistoricoRemoto({ locais, linhas: [ok('20250101000000_base')] }), { ok: true, codigo: null, pendentes: NOMES, falhas: [] });
  const casos = [
    [ok('20250101000000_base'), ok('29990101000000_extra')],
    [ok('20250101000000_base', 'outro')],
    [ok('20250101000000_base'), { migration_name: NOMES[0], checksum: MIGRATIONS_APROVADAS[NOMES[0]], finished_at: null, rolled_back_at: null }],
    [],
  ];
  for (const linhas of casos) assert.equal(conferirHistoricoRemoto({ locais, linhas }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS', JSON.stringify(linhas));
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok('20250101000000_base'), ok(NOMES[0], MIGRATIONS_APROVADAS[NOMES[0]])] }).ok, true, 'aplicação parcial do manifesto ainda é retomável');
});

test('B5b: checksum histórico "manual" só é aceito para as 4 migrations documentadas; em qualquer outra é divergência', () => {
  const hist = '20260908174141_p3_foundation';
  const locais = [{ nome: hist, checksum: 'x' }, { nome: '20250101000000_base', checksum: 'b' }, ...NOMES.map((n) => ({ nome: n, checksum: MIGRATIONS_APROVADAS[n] }))];
  const ok = (n, c) => ({ migration_name: n, checksum: c, finished_at: new Date(), rolled_back_at: null });
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'manual'), ok('20250101000000_base', 'b')] }).ok, true);
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'manual'), ok('20250101000000_base', 'manual')] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
  assert.equal(conferirHistoricoRemoto({ locais, linhas: [ok(hist, 'outro'), ok('20250101000000_base', 'b')] }).codigo, 'PREMERGE_MIGRATIONS_NAO_COMPROVADAS');
});

test('B6: runner — --base proibido, SHA inválido/errado → exit 3; nunca imprime URL', () => {
  const env = { ...process.env, MIGRATION_DATABASE_URL: 'postgresql://u:SEGREDO@h:5432/d', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '1' };
  const run = (...a) => spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', ...a], { encoding: 'utf8', env });
  const r1 = run('--sha', 'a'.repeat(40), '--base', 'HEAD~1');
  assert.equal(r1.status, 3);
  assert.match(r1.stderr, /BASE_FIXA/);
  assert.equal(run('--sha', 'abc', '--aplicar').status, 3);
  const r3 = run('--sha', '0'.repeat(40), '--aplicar');
  assert.equal(r3.status, 3);
  assert.match(r3.stderr, /HEAD_DIVERGENTE/);
  for (const r of [r1, r3]) assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\//);
});

test('B7: runner no HEAD atual — sem credenciais só há análise local declarada "alvo remoto NÃO verificado"', () => {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sujo = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  const env = { ...process.env, MIGRATION_DATABASE_URL: '', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: '' };
  const r = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', head], { encoding: 'utf8', env });
  if (sujo) return assert.match(r.stderr, /ARVORE_SUJA/);
  if (/MAIN_INDISPONIVEL|MAIN_DEFASADA/.test(r.stderr)) return assert.equal(r.status, 3); // CI sem remoto/defasado: fecha
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /alvo remoto NÃO verificado/);
  const a = spawnSync('node', ['scripts/deploy/premerge-migrate.mjs', '--sha', head, '--aplicar'], { encoding: 'utf8', env });
  assert.equal(a.status, 3);
  assert.match(a.stderr, /ALVO_SEM_CONFIGURACAO/);
});

const SHA = 'a'.repeat(40);
const ORIGIN = 'https://maike.exemplo.com.br';
const healthOk = { status: 'ok', release: SHA, capacidades: ['rebanho-ledger-cutover-r6'], implantacao: { ambiente: 'production', repositorio: 'maikelimaadm-stack/MAIKE', dominio_producao: 'maike.exemplo.com.br' } };

test('C1: origin de produção — só o configurado; preview, host arbitrário, caminho/query, http, localhost e credenciais recusados', () => {
  assert.equal(validarOrigemProducao({ informada: ORIGIN, configurada: ORIGIN }).ok, true);
  const casos = {
    [`${ORIGIN}/`]: null,
    'https://maike-git-claude-r2e-x.vercel.app': 'URL_DE_PREVIEW',
    'https://outro.exemplo.com': 'URL_FORA_DA_PRODUCAO',
    [`${ORIGIN}/api/native`]: 'URL_COM_CAMINHO',
    [`${ORIGIN}?x=1`]: 'URL_COM_CAMINHO',
    'http://maike.exemplo.com.br': 'URL_NAO_HTTPS',
    'https://localhost': 'URL_LOCAL',
    'https://u:p@maike.exemplo.com.br': 'URL_COM_CREDENCIAIS',
  };
  for (const [u, motivo] of Object.entries(casos)) assert.equal(validarOrigemProducao({ informada: u, configurada: ORIGIN }).motivo, motivo, u);
  assert.equal(validarOrigemProducao({ informada: ORIGIN, configurada: undefined }).motivo, 'ORIGEM_PRODUCAO_NAO_CONFIGURADA');
  assert.equal(validarOrigemProducao({ informada: 'https://maike-git-x.vercel.app', configurada: 'https://maike-git-x.vercel.app' }).motivo, 'ORIGEM_PRODUCAO_INVALIDA');
});

test('C2: identidade do backend — redirect, preview, outro repositório/domínio, main obsoleta e SHA divergente recusam', () => {
  const base = { health: healthOk, releaseSha: SHA, mainRemota: SHA, hostProducao: 'maike.exemplo.com.br' };
  assert.deepEqual(conferirBackendNovo(base), { ok: true, motivo: null });
  const casos = [
    [{ redirecionou: true, httpStatus: 308 }, 'HEALTH_REDIRECIONADO'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, ambiente: 'preview' } } }, 'IMPLANTACAO_NAO_E_PRODUCAO'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, repositorio: 'outro/repo' } } }, 'REPOSITORIO_DIVERGENTE'],
    [{ health: { ...healthOk, implantacao: { ...healthOk.implantacao, dominio_producao: 'x.vercel.app' } } }, 'DOMINIO_PRODUCAO_DIVERGENTE'],
    [{ mainRemota: 'b'.repeat(40) }, 'RELEASE_NAO_E_MAIN_ATUAL'],
    [{ mainRemota: null }, 'MAIN_REMOTA_INDISPONIVEL'],
    [{ health: { ...healthOk, release: 'c'.repeat(40) } }, 'BACKEND_EM_OUTRO_SHA'],
    [{ health: { status: 'ok', processo: 'up' } }, 'BACKEND_ANTIGO_EM_PRODUCAO'],
    [{ health: { ...healthOk, status: 'degraded' } }, 'BACKEND_DEGRADADO'],
    [{ httpStatus: 503, health: null }, 'HEALTH_INDISPONIVEL'],
  ];
  for (const [mut, motivo] of casos) assert.equal(conferirBackendNovo({ ...base, ...mut }).motivo, motivo, motivo);
});

test('C3: CLI remoto + --executar com URL de preview/sem origin configurado → exit 3 ANTES de conectar ao banco; sem segredo na saída', () => {
  const comum = ['scripts/ops/cutover-rebanho.mjs', '--cliente-id', 'c', '--empresa-id', 'e', '--executar', '--estrategia', 'entradas', '--confirmar-empresa', 'F', '--usuario-admin-id', 'u', '--release-sha', SHA];
  const env = { ...process.env, CUTOVER_DATABASE_URL: 'postgresql://u:SEGREDO@banco.exemplo.invalid:5432/d', CUTOVER_EXPECTED_SYSTEM_IDENTIFIER: '1', MAIKE_PRODUCAO_ORIGIN: ORIGIN };
  const sem = spawnSync('node', comum.filter((x) => x !== '--release-sha' && x !== SHA), { encoding: 'utf8', env });
  assert.equal(sem.status, 2);
  const preview = spawnSync('node', [...comum, '--backend-url', 'https://maike-git-claude-x.vercel.app'], { encoding: 'utf8', env });
  assert.equal(preview.status, 3);
  assert.match(preview.stderr, /URL_DE_PREVIEW/);
  const semConfig = spawnSync('node', [...comum, '--backend-url', ORIGIN], { encoding: 'utf8', env: { ...env, MAIKE_PRODUCAO_ORIGIN: '' } });
  assert.equal(semConfig.status, 3);
  assert.match(semConfig.stderr, /ORIGEM_PRODUCAO_NAO_CONFIGURADA/);
  for (const r of [sem, preview, semConfig]) assert.doesNotMatch(r.stdout + r.stderr, /SEGREDO|postgresql:\/\//);
});

test('B8 (D-PROD-113): migration aprovada que já está na main não "falta"; a que não está nem na main nem na release continua recusada', () => {
  const manifesto = { m_antiga: 'h1', m_nova: 'h2', m_sumida: 'h3' };
  const naMain = (n) => n === 'm_antiga';
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, ['m_nova'], naMain), ['m_sumida']);
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, ['m_nova', 'm_sumida'], naMain), []);
  assert.deepEqual(migrationsDoManifestoFaltando(manifesto, [], () => false), ['m_antiga', 'm_nova', 'm_sumida'], 'sem main: tudo falta (fail-closed)');
  // Cada migration aprovada ou já está na main ou é nova NESTA árvore (a release a
  // traz): nada do manifesto "falta". Na main (sem migration nova) a release vazia passa.
  const naMainReal = (n) => { try { execFileSync('git', ['cat-file', '-e', `origin/main:backend/prisma/migrations/${n}/migration.sql`], { stdio: 'ignore' }); return true; } catch { return false; } };
  const temMain = (() => { try { execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  if (temMain) {
    const novasNaArvore = NOMES.filter((n) => !naMainReal(n) && existsSync(`backend/prisma/migrations/${n}/migration.sql`));
    assert.deepEqual(migrationsDoManifestoFaltando(MIGRATIONS_APROVADAS, novasNaArvore, naMainReal), []);
  }
});

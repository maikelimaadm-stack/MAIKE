import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT, cleanup, makeTempDir, runGate, writeFile } from './helpers.mjs';

const ROOT = join(import.meta.dirname, '../../..');

test('gate:tarefa-cadastro-native passa no repositório', () => {
  const r = spawnSync('node', ['scripts/gates/gate-tarefa-cadastro-native.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

/**
 * D-PROD-196 — o gate roda sobre uma cópia dos arquivos que ele lê (TAREFA_CADASTRO_NATIVE_ROOT), com UMA mudança por
 * caso: o TipoAtividade tem as 8 flags `Boolean @default(false)` e nenhum nome aposentado (`pode_ter_*`) no model, nas
 * migrations, na porta e nas rotas; o TipoTarefa não tem flag nenhuma (nem as 4 antigas nem as 8 novas).
 */
const ARQUIVOS = Object.freeze([
  'backend/prisma/schema.prisma',
  'src/apis/_providers/base44Provider.js',
  'src/apis/tarefas/tarefasApi.js',
  'src/apis/tarefas/grupoAtividadeNativePort.js',
  'src/apis/tarefas/tipoTarefaNativePort.js',
  'src/apis/atividades/tipoAtividadePort.js',
  'backend/src/modules/gruposAtividade/grupoAtividadeRoutes.js',
  'backend/src/modules/tiposTarefa/tipoTarefaRoutes.js',
  'backend/src/modules/tiposAtividade/tipoAtividadeRoutes.js',
  'backend/src/modules/tiposAtividade/tipoAtividadePadroes.js',
]);
const SCHEMA = 'backend/prisma/schema.prisma';
const PORTA = 'src/apis/atividades/tipoAtividadePort.js';
const ROTAS = 'backend/src/modules/tiposAtividade/tipoAtividadeRoutes.js';
const PADROES = 'backend/src/modules/tiposAtividade/tipoAtividadePadroes.js';
const MIGRATION_195 = 'backend/prisma/migrations/20261114300000_tipo_atividade_defaults';
const real = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** Troca por regex que TEM de casar exatamente uma vez (senão o caso não prova o que diz). */
const trocar = (texto, re, para) => {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  assert.equal([...texto.matchAll(global)].length, 1, `deveria casar 1 vez: ${re}`);
  return texto.replace(re, para);
};

/** Projeto descartável: os arquivos que o gate lê + as migrations do repositório; `mudar` ajusta um deles. */
const projeto = (mudar = () => {}) => {
  const dir = makeTempDir('maike-gate-tarefa-');
  for (const rel of ARQUIVOS) writeFile(dir, rel, real(rel));
  cpSync(join(REPO_ROOT, 'backend/prisma/migrations'), join(dir, 'backend/prisma/migrations'), { recursive: true });
  mudar(dir);
  return dir;
};
const rodar = (dir) => runGate('gate-tarefa-cadastro-native.mjs', { env: { TAREFA_CADASTRO_NATIVE_ROOT: dir } });
const reescrever = (dir, rel, fn) => writeFile(dir, rel, fn(readFileSync(join(dir, rel), 'utf8')));

test('D-PROD-196 controle: a cópia sem mudança passa (comentário citando pode_ter_* na porta e nas rotas não conta)', () => {
  const dir = projeto((d) => {
    reescrever(d, PORTA, (s) => `${s}\n// legado recusado: pode_ter_produto, pode_ter_maquina, pode_ter_implemento\n`);
    reescrever(d, ROTAS, (s) => `${s}\n/* pode_ter_implemento continua fora do schema (400) */\n`);
  });
  try {
    const r = rodar(dir);
    assert.equal(r.status, 0, r.output);
  } finally {
    cleanup(dir);
  }
});

const CASOS = Object.freeze([
  ['TipoAtividade com nome aposentado no model', (d) => reescrever(d, SCHEMA, (s) => trocar(s, /^(\s*exige_producao\s+Boolean\s+@default\(false\)\s*)$/m, '$1\n  pode_ter_produto           Boolean  @default(false)')),
    /TipoAtividade não pode ter o nome aposentado pode_ter_produto/],
  ['TipoAtividade sem uma das 8 flags', (d) => reescrever(d, SCHEMA, (s) => trocar(s, /^\s*exige_safra\s+Boolean\s+@default\(false\)\s*\n/m, '')),
    /TipoAtividade sem a flag exige_safra/],
  ['flag opcional', (d) => reescrever(d, SCHEMA, (s) => trocar(s, /^(\s*exige_area\s+)Boolean(\s+@default\(false\))/m, '$1Boolean?$2')),
    /TipoAtividade\.exige_area tem de ser Boolean @default\(false\)/],
  ['flag com DEFAULT true', (d) => reescrever(d, SCHEMA, (s) => trocar(s, /^(\s*permite_servico\s+Boolean\s+)@default\(false\)/m, '$1@default(true)')),
    /TipoAtividade\.permite_servico tem de ser Boolean @default\(false\)/],
  ['flag do TipoAtividade no TipoTarefa', (d) => reescrever(d, SCHEMA, (s) => trocar(s, /^(model TipoTarefa \{\n)/m, '$1  permite_produto      Boolean  @default(false)\n')),
    /TipoTarefa não pode ter a flag permite_produto/],
  ['flag antiga de volta no TipoTarefa', (d) => reescrever(d, SCHEMA, (s) => trocar(s, /^(model TipoTarefa \{\n)/m, '$1  exige_area           Boolean  @default(false)\n')),
    /TipoTarefa não pode ter a flag exige_area/],
  ['porta com nome aposentado no código', (d) => reescrever(d, PORTA, (s) => `${s}\nexport const LEGADO = Object.freeze(['pode_ter_maquina']);\n`),
    /tipoAtividadePort\.js cita o nome aposentado pode_ter_maquina/],
  ['porta sem uma das flags', (d) => reescrever(d, PORTA, (s) => s.replace(/['"]exige_producao['"]/g, "'exige_producao_x'")),
    /tipoAtividadePort\.js sem as flags do TipoAtividade exige_producao/],
  ['rotas com nome aposentado no código', (d) => reescrever(d, ROTAS, (s) => `${s}\nexport const ACEITAS = Object.freeze({ pode_ter_implemento: {} });\n`),
    /tipoAtividadeRoutes\.js cita o nome aposentado pode_ter_implemento/],
  ['módulo puro sem uma das flags (as rotas tiram as 8 dele)', (d) => reescrever(d, PADROES, (s) => s.replace(/['"]exige_maquina['"]/g, "'exige_maquina_x'")),
    /tipoAtividadeRoutes\.js sem as flags do TipoAtividade exige_maquina/],
  ['migration nova criando nome aposentado em TipoAtividade', (d) => writeFile(d, 'backend/prisma/migrations/29990101000000_x/migration.sql', 'ALTER TABLE "TipoAtividade" ADD COLUMN "pode_ter_produto" BOOLEAN;\n'),
    /29990101000000_x cria em TipoAtividade o nome aposentado pode_ter_produto/],
  ['migration nova devolvendo flag ao TipoTarefa', (d) => writeFile(d, 'backend/prisma/migrations/29990101000000_x/migration.sql', 'ALTER TABLE "TipoTarefa" ADD COLUMN "permite_produto" BOOLEAN NOT NULL DEFAULT false;\n'),
    /29990101000000_x devolve ao TipoTarefa a flag permite_produto/],
  ['sem a migration das flags', (d) => rmSync(join(d, MIGRATION_195), { recursive: true, force: true }),
    /esperada exatamente 1 migration com ALTER TABLE "TipoAtividade" ADD COLUMN "exige_area" BOOLEAN NOT NULL DEFAULT false \(achadas 0/],
  ['flag com DEFAULT diferente na migration', (d) => writeFile(d, `${MIGRATION_195}/migration.sql`, real(`${MIGRATION_195}/migration.sql`).replace('ADD COLUMN "exige_safra" BOOLEAN NOT NULL DEFAULT false', 'ADD COLUMN "exige_safra" BOOLEAN NOT NULL DEFAULT true')),
    /esperada exatamente 1 migration com ALTER TABLE "TipoAtividade" ADD COLUMN "exige_safra" BOOLEAN NOT NULL DEFAULT false \(achadas 0/],
  ['segundo CREATE TABLE "TipoAtividade"', (d) => writeFile(d, 'backend/prisma/migrations/29990101000000_x/migration.sql', 'CREATE TABLE "TipoAtividade" ("id" TEXT NOT NULL);\n'),
    /esperada exatamente 1 migration versionada com CREATE TABLE "TipoAtividade" \(achadas 2\)/],
]);

for (const [rotulo, mudar, esperado] of CASOS) {
  test(`D-PROD-196 reprova: ${rotulo}`, () => {
    const dir = projeto(mudar);
    try {
      const r = rodar(dir);
      assert.equal(r.status, 1, r.output);
      assert.match(r.output, /gate:tarefa-cadastro-native — FALHOU/);
      assert.match(r.output, esperado);
    } finally {
      cleanup(dir);
    }
  });
}

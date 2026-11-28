import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync } from 'node:fs';
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
 * D-PROD-197/383 — o gate roda sobre uma cópia dos arquivos que ele lê (TAREFA_CADASTRO_NATIVE_ROOT), com UMA mudança
 * por caso: o TipoTarefa não tem flag nenhuma (nem as 4 antigas nem as 8 do antigo TipoAtividade) e o TipoAtividade
 * não volta ao schema (D-PROD-383: saiu com as atividades).
 */
const ARQUIVOS = Object.freeze([
  'backend/prisma/schema.prisma',
  'src/apis/_providers/base44Provider.js',
  'src/apis/tarefas/tarefasApi.js',
  'src/apis/tarefas/grupoAtividadeNativePort.js',
  'src/apis/tarefas/tipoTarefaNativePort.js',
  'backend/src/modules/gruposAtividade/grupoAtividadeRoutes.js',
  'backend/src/modules/tiposTarefa/tipoTarefaRoutes.js',
]);
const SCHEMA = 'backend/prisma/schema.prisma';
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

test('D-PROD-383 controle: a cópia sem mudança passa', () => {
  const dir = projeto();
  try {
    const r = rodar(dir);
    assert.equal(r.status, 0, r.output);
  } finally {
    cleanup(dir);
  }
});

const CASOS = Object.freeze([
  ['flag do antigo TipoAtividade no TipoTarefa', (d) => reescrever(d, SCHEMA, (s) => trocar(s, /^(model TipoTarefa \{\n)/m, '$1  permite_produto      Boolean  @default(false)\n')),
    /TipoTarefa não pode ter a flag permite_produto/],
  ['flag antiga de volta no TipoTarefa', (d) => reescrever(d, SCHEMA, (s) => trocar(s, /^(model TipoTarefa \{\n)/m, '$1  exige_area           Boolean  @default(false)\n')),
    /TipoTarefa não pode ter a flag exige_area/],
  ['migration nova devolvendo flag ao TipoTarefa', (d) => writeFile(d, 'backend/prisma/migrations/29990101000000_x/migration.sql', 'ALTER TABLE "TipoTarefa" ADD COLUMN "permite_produto" BOOLEAN NOT NULL DEFAULT false;\n'),
    /29990101000000_x devolve ao TipoTarefa a flag permite_produto/],
  ['TipoAtividade de volta no schema', (d) => reescrever(d, SCHEMA, (s) => `${s}\nmodel TipoAtividade {\n  id         String @id @default(uuid())\n  cliente_id String\n}\n`),
    /o schema voltou a ter o model TipoAtividade/],
]);

for (const [rotulo, mudar, esperado] of CASOS) {
  test(`D-PROD-383 reprova: ${rotulo}`, () => {
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

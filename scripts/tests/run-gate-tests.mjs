#!/usr/bin/env node
/**
 * Runner dos testes de gate.
 *
 * Enumera os arquivos e passa cada caminho explicitamente para `node --test`.
 * Não depende de expansão de glob pelo Node — `node --test "dir/*.test.mjs"`
 * só resolve o padrão a partir do Node 22, e a CI roda a versão do `.nvmrc`.
 *
 * Desde a DEPLOY-MIGRATION-01 há um segundo diretório: `scripts/tests/deploy`,
 * com as provas do runner de migrations. Elas não são testes de gate, mas são
 * do mesmo tipo — Node puro, sem DOM, sem banco — e precisavam entrar na
 * cadeia. Deixá-las num script próprio criaria uma etapa a mais no
 * `verify:all` para quatro dezenas de asserções.
 */

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DIRS = ['scripts/tests/gates', 'scripts/tests/deploy'];

const ausente = DIRS.find((dir) => !existsSync(dir));
if (ausente) {
  console.error(`diretório de testes não encontrado: ${ausente}`);
  process.exit(1);
}

const arquivos = DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((nome) => nome.endsWith('.test.mjs'))
    .sort()
    .map((nome) => join(dir, nome))
);

if (arquivos.length === 0) {
  console.error(`nenhum teste encontrado em ${DIRS.join(', ')}`);
  process.exit(1);
}

console.log(`test:gates — ${arquivos.length} arquivo(s): ${arquivos.map((f) => f.split('/').pop()).join(', ')}`);

const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);

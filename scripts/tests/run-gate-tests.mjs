#!/usr/bin/env node
/**
 * Runner dos testes de gate.
 *
 * Enumera os arquivos e passa cada caminho explicitamente para `node --test`.
 * Não depende de expansão de glob pelo Node — `node --test "dir/*.test.mjs"`
 * só resolve o padrão a partir do Node 22, e a CI roda a versão do `.nvmrc`.
 */

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = 'scripts/tests/gates';

if (!existsSync(DIR)) {
  console.error(`diretório de testes não encontrado: ${DIR}`);
  process.exit(1);
}

const arquivos = readdirSync(DIR)
  .filter((nome) => nome.endsWith('.test.mjs'))
  .sort()
  .map((nome) => join(DIR, nome));

if (arquivos.length === 0) {
  console.error(`nenhum teste encontrado em ${DIR}`);
  process.exit(1);
}

console.log(`test:gates — ${arquivos.length} arquivo(s): ${arquivos.map((f) => f.split('/').pop()).join(', ')}`);

const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);

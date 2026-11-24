#!/usr/bin/env node
/**
 * D-PROD-291 — grava `app-versao.json` no pacote web do app (pasta indicada).
 *
 * É a identidade do pacote que o app carrega: a atualização automática compara
 * esta versão com a publicada (`/app-atualizacao/ultima.json`). Versão = commit
 * (curto) do build; `nativoMinimo` = `versionCode` de `app-version.json`.
 *
 * Uso: node scripts/app/versao-do-pacote.mjs <pasta>
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const versaoDoCommit = () => {
  const doAmbiente = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '';
  if (doAmbiente) return doAmbiente.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return `local-${Date.now()}`;
  }
};

export const nativoMinimo = () => Number(JSON.parse(readFileSync('app-version.json', 'utf8')).versionCode) || 1;

if (import.meta.url === `file://${process.argv[1]}`) {
  const pasta = process.argv[2];
  if (!pasta) {
    console.error('uso: node scripts/app/versao-do-pacote.mjs <pasta>');
    process.exit(2);
  }
  const conteudo = { versao: versaoDoCommit(), nativoMinimo: nativoMinimo() };
  writeFileSync(join(pasta, 'app-versao.json'), `${JSON.stringify(conteudo)}\n`);
  console.log(`app-versao.json: ${JSON.stringify(conteudo)}`);
}

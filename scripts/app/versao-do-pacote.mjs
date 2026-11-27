#!/usr/bin/env node
/**
 * D-PROD-294 — grava `app-versao.json` no pacote web do app (pasta indicada).
 *
 * É a identidade do pacote que o app carrega: a atualização automática compara
 * esta versão com a publicada (`/app-atualizacao/ultima.json`). Versão = commit
 * (curto) do build; `nativoMinimo` = `nativoMinimo` de `app-version.json` (D-PROD-346) ou, sem ele, o `versionCode`.
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

/**
 * O APK mais antigo que roda este pacote. D-PROD-346: `nativoMinimo` em `app-version.json` quando o pacote novo
 * também roda no APK anterior (o código novo confere se o plugin nativo existe); sem ele, o `versionCode`.
 */
export const nativoMinimo = () => {
  const versao = JSON.parse(readFileSync('app-version.json', 'utf8'));
  return Number(versao.nativoMinimo ?? versao.versionCode) || 1;
};

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

#!/usr/bin/env node
/**
 * D-PROD-290 — atualização automática do app (sem baixar APK de novo).
 *
 * Roda no build da Vercel, DEPOIS do build do site. Gera o pacote web do app
 * (o mesmo frontend, com a URL da API fixa, como no APK) e publica junto do
 * site, em `dist/app-atualizacao/`:
 *   - `<versao>.zip`  — o pacote (index.html na raiz);
 *   - `ultima.json`   — { versao, url, checksum (sha256), nativoMinimo, criadoEm }.
 *
 * O app confere `ultima.json` ao abrir e ao voltar para a frente; versão nova
 * com `nativoMinimo` <= versionCode instalado é baixada e aplicada na próxima
 * abertura (rollback automático se não abrir). Mudança nativa (plugin novo,
 * permissão) sobe `versionCode` em app-version.json: aí só APK novo aplica.
 *
 * Variáveis: APP_MAIKE_API_URL (padrão https://www.makgestao.com);
 * VITE_GOOGLE_MAPS_API_KEY vem do ambiente do build (a mesma do site).
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { nativoMinimo, versaoDoCommit } from './versao-do-pacote.mjs';

const SAIDA_APP = 'dist-app';
const PUBLICACAO = join('dist', 'app-atualizacao');
const API = (process.env.APP_MAIKE_API_URL || 'https://www.makgestao.com').replace(/\/+$/, '');

const versao = versaoDoCommit();
rmSync(SAIDA_APP, { recursive: true, force: true });
execSync(`npx vite build --outDir ${SAIDA_APP} --emptyOutDir`, {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', VITE_MAIKE_API_URL: API },
});
writeFileSync(join(SAIDA_APP, 'app-versao.json'), `${JSON.stringify({ versao, nativoMinimo: nativoMinimo() })}\n`);

/** @type {Record<string, Uint8Array>} */
const arquivos = {};
const juntar = (pasta) => {
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) juntar(caminho);
    else arquivos[relative(SAIDA_APP, caminho).split('\\').join('/')] = new Uint8Array(readFileSync(caminho));
  }
};
juntar(SAIDA_APP);
const zip = zipSync(arquivos, { level: 6 });
const checksum = createHash('sha256').update(zip).digest('hex');

mkdirSync(PUBLICACAO, { recursive: true });
writeFileSync(join(PUBLICACAO, `${versao}.zip`), zip);
const ultima = { versao, url: `/app-atualizacao/${versao}.zip`, checksum, nativoMinimo: nativoMinimo(), criadoEm: new Date().toISOString() };
writeFileSync(join(PUBLICACAO, 'ultima.json'), `${JSON.stringify(ultima)}\n`);
rmSync(SAIDA_APP, { recursive: true, force: true });
console.log(`pacote do app: ${versao} (${(zip.length / 1024 / 1024).toFixed(1)} MB, nativo >= ${ultima.nativoMinimo})`);

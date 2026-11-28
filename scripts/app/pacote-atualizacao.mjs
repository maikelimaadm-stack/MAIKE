#!/usr/bin/env node
/**
 * D-PROD-294 — atualização automática do app (sem baixar APK de novo).
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
 * permissão) sobe `versionCode` em app-version.json: aí só APK novo aplica — a não ser que o pacote rode também no APK
 * anterior: aí `nativoMinimo` fica no código anterior (D-PROD-346).
 *
 * Variáveis: APP_MAIKE_API_URL (padrão https://www.makgestao.com);
 * VITE_GOOGLE_MAPS_API_KEY vem do ambiente do build (a mesma do site).
 *
 * D-PROD-381 (canal de teste, workflow `app-teste`): PACOTE_PUBLICACAO (pasta de saída), PACOTE_URL_BASE (endereço
 * onde o zip fica; padrão `/app-atualizacao`), PACOTE_VERSAO (versão; padrão o commit) e PACOTE_MANTER_APP=1 (deixa a
 * pasta `dist-app`, para o APK de teste levar o mesmo pacote). Com VITE_CANAL_APP=teste no ambiente, o pacote é o do
 * canal de teste.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { nativoMinimo, versaoDoCommit } from './versao-do-pacote.mjs';

const SAIDA_APP = 'dist-app';
const PUBLICACAO = process.env.PACOTE_PUBLICACAO || join('dist', 'app-atualizacao');
const URL_BASE = (process.env.PACOTE_URL_BASE || '/app-atualizacao').replace(/\/+$/, '');
const API = (process.env.APP_MAIKE_API_URL || 'https://www.makgestao.com').replace(/\/+$/, '');

const versao = process.env.PACOTE_VERSAO || versaoDoCommit();
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
const ultima = { versao, url: `${URL_BASE}/${versao}.zip`, checksum, nativoMinimo: nativoMinimo(), criadoEm: new Date().toISOString() };
writeFileSync(join(PUBLICACAO, 'ultima.json'), `${JSON.stringify(ultima)}\n`);
if (process.env.PACOTE_MANTER_APP !== '1') rmSync(SAIDA_APP, { recursive: true, force: true });
console.log(`pacote do app: ${versao} (${(zip.length / 1024 / 1024).toFixed(1)} MB, nativo >= ${ultima.nativoMinimo})`);

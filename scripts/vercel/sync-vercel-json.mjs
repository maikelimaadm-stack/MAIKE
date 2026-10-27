#!/usr/bin/env node
/**
 * Sincroniza `vercel.json` → rewrites nativos a partir do SSOT em
 * `nativeApiRewriteRules.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNativeApiRewrites } from './nativeApiRewriteRules.mjs';

const ROOT = process.cwd();
const alvo = join(ROOT, 'vercel.json');
const atual = JSON.parse(readFileSync(alvo, 'utf8'));

const proximo = {
  ...atual,
  rewrites: buildNativeApiRewrites(),
};

writeFileSync(alvo, `${JSON.stringify(proximo, null, 2)}\n`);
console.log(`vercel.json: ${proximo.rewrites.length} rewrites`);

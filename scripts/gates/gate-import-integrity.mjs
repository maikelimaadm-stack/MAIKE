#!/usr/bin/env node
// Gate: integridade de imports — nenhum import estático dentro de src/ pode
// apontar para arquivo inexistente. Código: P01-IMPORT-BROKEN

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const EXTS = ['.js', '.jsx', '.ts', '.tsx'];

if (!existsSync(SRC)) {
  console.error('[P01-IMPORT-BROKEN] diretório src/ não encontrado');
  process.exit(1);
}

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};

const arquivos = walk(SRC).filter((f) => EXTS.some((e) => f.endsWith(e)));

const IMPORT_RE = /(?:^|[\s;{(=])import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

const resolveEspecificador = (spec, deArquivo) => {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(deArquivo), spec);
  else return true; // pacote npm — fora do escopo deste gate

  const candidatos = [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => join(base, 'index' + e)),
  ];
  return candidatos.some((c) => existsSync(c) && statSync(c).isFile());
};

const quebrados = [];

for (const arquivo of arquivos) {
  const src = readFileSync(arquivo, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    if (!resolveEspecificador(spec, arquivo)) {
      quebrados.push(`${relative(ROOT, arquivo)} -> ${spec}`);
    }
  }
}

if (quebrados.length) {
  console.error('gate:import-integrity — FALHOU\n');
  quebrados.forEach((q) => console.error(`  - [P01-IMPORT-BROKEN] ${q}`));
  console.error(`\n${quebrados.length} import(s) quebrado(s).`);
  process.exit(1);
}

console.log(`gate:import-integrity — PASSOU (${arquivos.length} arquivos verificados, 0 imports quebrados)`);

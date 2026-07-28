#!/usr/bin/env node
/**
 * Gate: fechamento real de código.
 *
 * `gate:import-integrity` prova que os imports existentes resolvem.
 * Este gate prova o contrário: que todo arquivo executável em `src/` é
 * alcançável a partir das entradas reais do produto. Numa missão de limpeza
 * destrutiva, arquivo órfão é dívida.
 *
 * Códigos: P01-SCOPE-ORPHAN · P01-SCOPE-DYNAMIC-ALLOWLIST
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildGraph, closureFrom, toRelative, CODE_EXTS } from './lib/source-graph.mjs';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const MANIFESTO = process.env.SCOPE_MANIFEST || 'config/mapa-manejo-scope.json';

/** Entradas fixas do runtime: o bundler começa por aqui. */
const ENTRY_POINTS = [
  'src/main.jsx',
  'src/App.jsx',
  'src/pages.config.js',
  'src/Layout.jsx',
];

const falhas = [];
const registrar = (codigo, mensagem) => falhas.push(`[${codigo}] ${mensagem}`);

if (!existsSync(SRC)) {
  console.error('[P01-SCOPE-ORPHAN] diretório src/ não encontrado');
  process.exit(1);
}
if (!existsSync(MANIFESTO)) {
  console.error(`[P01-SCOPE-ORPHAN] manifesto ausente: ${MANIFESTO}`);
  process.exit(1);
}

const scope = JSON.parse(readFileSync(MANIFESTO, 'utf8'));

// ── Raízes ────────────────────────────────────────────────────────────────
const roots = [];
const pushRoot = (rel) => {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    registrar('P01-SCOPE-ORPHAN', `entrada declarada não existe: ${rel}`);
    return;
  }
  roots.push(abs);
};

ENTRY_POINTS.forEach(pushRoot);
(scope.requiredRoots || []).forEach(pushRoot);
(scope.allowedPages || []).forEach((page) => {
  const candidates = CODE_EXTS.map((e) => join(SRC, 'pages', page + e));
  const found = candidates.find((c) => existsSync(c));
  if (!found) registrar('P01-SCOPE-ORPHAN', `página permitida não existe em src/pages: ${page}`);
  else roots.push(found);
});

// ── Allowlist de consumidores dinâmicos ───────────────────────────────────
const allowlist = new Map();
for (const [index, entry] of (scope.orphanAllowlist || []).entries()) {
  if (!entry || typeof entry !== 'object') {
    registrar('P01-SCOPE-DYNAMIC-ALLOWLIST', `orphanAllowlist[${index}] não é um objeto`);
    continue;
  }
  const { path: rel, justification, dynamicConsumer, decision } = entry;
  if (!rel || typeof rel !== 'string') {
    registrar('P01-SCOPE-DYNAMIC-ALLOWLIST', `orphanAllowlist[${index}] sem "path"`);
    continue;
  }
  if (rel.endsWith('/') || rel.includes('*')) {
    registrar('P01-SCOPE-DYNAMIC-ALLOWLIST', `${rel}: allowlist por diretório ou padrão não é aceita`);
    continue;
  }
  if (!justification || !dynamicConsumer || !decision) {
    registrar(
      'P01-SCOPE-DYNAMIC-ALLOWLIST',
      `${rel}: exige "justification", "dynamicConsumer" e "decision"`
    );
    continue;
  }
  if (!existsSync(resolve(ROOT, rel))) {
    registrar('P01-SCOPE-DYNAMIC-ALLOWLIST', `${rel}: allowlist aponta para arquivo inexistente`);
    continue;
  }
  allowlist.set(rel, entry);
}

// ── Fechamento ────────────────────────────────────────────────────────────
const { files, graph } = buildGraph(SRC);
const reachable = closureFrom(graph, roots);

const orfaos = files
  .filter((f) => !reachable.has(f))
  .map((f) => toRelative(ROOT, f))
  .sort();

const usados = new Set();
for (const rel of orfaos) {
  if (allowlist.has(rel)) {
    usados.add(rel);
    continue;
  }
  registrar('P01-SCOPE-ORPHAN', `arquivo executável inalcançável: ${rel}`);
}

for (const rel of allowlist.keys()) {
  if (!usados.has(rel)) {
    registrar(
      'P01-SCOPE-DYNAMIC-ALLOWLIST',
      `${rel}: está na allowlist mas já é alcançável — remova a entrada`
    );
  }
}

if (falhas.length) {
  console.error('gate:source-closure — FALHOU\n');
  falhas.forEach((f) => console.error(`  - ${f}`));
  console.error(`\n${falhas.length} problema(s). Remova o arquivo ou justifique em ${MANIFESTO} → orphanAllowlist.`);
  process.exit(1);
}

console.log(
  `gate:source-closure — PASSOU (${files.length} arquivos, ${reachable.size} alcançáveis, ${allowlist.size} na allowlist)`
);

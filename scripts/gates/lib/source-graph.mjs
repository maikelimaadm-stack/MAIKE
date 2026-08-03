/**
 * Grafo de dependências de `src/`.
 *
 * Usado por `gate:import-integrity` (imports resolvem) e por
 * `gate:source-closure` (todo arquivo executável é alcançável).
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

export const CODE_EXTS = ['.js', '.jsx', '.ts', '.tsx'];

const IMPORT_RE =
  /(?:^|[\s;{(=])import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

export const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

export const walkFiles = (dir, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
};

/**
 * Resolve um especificador de import.
 * @returns {{resolved: string}|{missing: true, spec: string}|null} null = pacote npm
 */
export const resolveSpecifier = (spec, fromFile, srcDir) => {
  let base;
  if (spec.startsWith('@/')) base = join(srcDir, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;

  const candidates = [
    base,
    ...CODE_EXTS.map((e) => base + e),
    ...CODE_EXTS.map((e) => join(base, 'index' + e)),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return { resolved: c };
  }
  // Assets e CSS importados por caminho literal contam como resolvidos quando existem.
  if (existsSync(base) && statSync(base).isFile()) return { resolved: base };
  return { missing: true, spec };
};

/**
 * Constrói o grafo de imports de um diretório de código.
 * @param {string} srcDir
 * @returns {{files: string[], graph: Map<string, Set<string>>, broken: Array<{file: string, spec: string}>}}
 */
export const buildGraph = (srcDir) => {
  const files = walkFiles(srcDir).filter((f) => CODE_EXTS.some((e) => f.endsWith(e)));
  const graph = new Map();
  const broken = [];

  for (const file of files) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const deps = new Set();
    for (const m of source.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3] || m[4];
      if (!spec) continue;
      const r = resolveSpecifier(spec, file, srcDir);
      if (r === null) continue;
      if (r.missing) broken.push({ file, spec: r.spec });
      else deps.add(r.resolved);
    }
    graph.set(file, deps);
  }

  return { files, graph, broken };
};

/**
 * Fechamento transitivo a partir das raízes.
 * @param {Map<string, Set<string>>} graph
 * @param {string[]} roots caminhos absolutos
 * @returns {Set<string>}
 */
export const closureFrom = (graph, roots) => {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !graph.has(file)) continue;
    seen.add(file);
    for (const dep of graph.get(file)) stack.push(dep);
  }
  return seen;
};

export const toRelative = (root, file) => relative(root, file).split('\\').join('/');

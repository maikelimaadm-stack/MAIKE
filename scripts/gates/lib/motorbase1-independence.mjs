/**
 * Scanner: Motor Base1 compartilhado não importa domínio (Mapa, Marcas, páginas, services, apis).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

import { scriptKindOf } from './api-boundary.mjs';

const REPO = process.cwd();

/** @param {string} dir */
const listFilesRecursive = (dir, acc = []) => {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) listFilesRecursive(abs, acc);
    else if (/\.(jsx?|tsx?|mjs|cjs)$/.test(ent.name)) acc.push(abs);
  }
  return acc;
};

export const SCAN_ROOTS = [
  { dir: 'src/components/cadastro/base1', all: true },
  { dir: 'src/hooks', prefix: 'useCadastro' },
  { dir: 'src/lib', prefix: 'cadastro' },
];

const ALLOWED_COMPONENT_PREFIXES = [
  'components/cadastro/',
  'components/common/',
  'components/ui/',
];

/**
 * @param {string} spec módulo resolvido relativo a src/ ou pacote externo
 */
export const classifyImport = (spec) => {
  if (!spec || typeof spec !== 'string') return 'external';
  if (spec.startsWith('.') || spec.startsWith('/')) return 'relative';
  if (!spec.startsWith('@/')) return 'external';

  const path = spec.slice(2);
  if (path.startsWith('components/')) {
    if (ALLOWED_COMPONENT_PREFIXES.some((p) => path.startsWith(p))) return 'allowed';
    return 'forbidden-domain-component';
  }
  if (path.startsWith('pages/')) return 'forbidden-pages';
  if (path.startsWith('services/')) return 'forbidden-services';
  if (path.startsWith('apis/')) return 'forbidden-apis';
  if (path.startsWith('lib/') || path.startsWith('hooks/')) return 'allowed';
  return 'forbidden-other';
};

const parse = (source, fileName) =>
  ts.createSourceFile(
    fileName,
    String(source).replace(/\r\n/g, '\n'),
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(fileName),
  );

const walk = (node, visit) => {
  visit(node);
  node.forEachChild((filho) => walk(filho, visit));
};

const moduleSpec = (node) => {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    if (!node.moduleSpecifier) return null;
    const lit = node.moduleSpecifier;
    if (ts.isStringLiteral(lit)) return lit.text;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [arg] = node.arguments;
    if (arg && ts.isStringLiteral(arg)) return arg.text;
  }
  return null;
};

/**
 * @param {{ roots?: typeof SCAN_ROOTS, repoRoot?: string }} [opts]
 * @returns {{ violations: { file: string, line: number, spec: string, reason: string }[] }}
 */
export const scanMotorBase1Independence = (opts = {}) => {
  const repoRoot = opts.repoRoot || REPO;
  const roots = opts.roots || SCAN_ROOTS;
  const violations = [];

  /** @type {string[]} */
  const files = [];
  for (const { dir, all, prefix } of roots) {
    const absDir = join(repoRoot, dir);
    try {
      if (!statSync(absDir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (all) {
      listFilesRecursive(absDir, files);
    } else {
      for (const ent of readdirSync(absDir)) {
        if (prefix && !ent.startsWith(prefix)) continue;
        if (!/\.(jsx?|tsx?|mjs|cjs)$/.test(ent)) continue;
        files.push(join(absDir, ent));
      }
    }
  }

  for (const abs of files.sort()) {
    const rel = relative(repoRoot, abs).replace(/\\/g, '/');
    const source = readFileSync(abs, 'utf8');
    const sf = parse(source, rel);

    walk(sf, (node) => {
      const spec = moduleSpec(node);
      if (!spec) return;
      const kind = classifyImport(spec);
      if (kind === 'relative' || kind === 'external' || kind === 'allowed') return;

      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push({
        file: rel,
        line: line + 1,
        spec,
        reason: kind,
      });
    });
  }

  return { violations };
};

/**
 * Analisador estático das functions Base44 preservadas.
 *
 * Extrai as entidades citadas por uma function para que `gate:product-scope`
 * possa provar que ela não referencia schema fora de
 * `config/mapa-manejo-scope.json`.
 *
 * Código de erro: P01-SCOPE-FUNCTION-ENTITY
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const FUNCTIONS_DIR = 'base44/functions';

/** Remove comentários de bloco e de linha para não gerar falso positivo. */
export const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * Lista os diretórios de function existentes.
 * @param {string} dir
 * @returns {string[]} nomes de function, ordenados
 */
export const listFunctionNames = (dir = FUNCTIONS_DIR) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
};

/** Lê e concatena todos os arquivos de código de uma function. */
export const readFunctionSource = (name, dir = FUNCTIONS_DIR) => {
  const base = join(dir, name);
  if (!existsSync(base)) return '';
  const parts = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const p = join(current, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) parts.push(readFileSync(p, 'utf8'));
    }
  };
  walk(base);
  return parts.join('\n');
};

/**
 * Extrai as entidades citadas por uma function.
 *
 * Cobre três formas:
 *  - chaves-fonte de `PROPAGATION_RULES` (o objeto no topo do arquivo)
 *  - destinos `entity: 'X'`
 *  - acessos dinâmicos `entities.X` / `entities?.['X']`
 *
 * @param {string} source código já concatenado da function
 * @returns {{sources: string[], targets: string[], dynamic: string[], all: string[]}}
 */
export const extractFunctionEntities = (source) => {
  const clean = stripComments(source);

  const targets = new Set();
  for (const m of clean.matchAll(/\bentity:\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g)) {
    targets.add(m[1]);
  }

  const sources = new Set();
  const rulesStart = clean.indexOf('PROPAGATION_RULES');
  if (rulesStart !== -1) {
    const open = clean.indexOf('{', rulesStart);
    if (open !== -1) {
      // Percorre o objeto contando chaves para achar seu fim exato.
      let depth = 0;
      let end = -1;
      for (let i = open; i < clean.length; i += 1) {
        const ch = clean[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end !== -1) {
        const body = clean.slice(open + 1, end);
        // Chaves de primeiro nível: identificador seguido de ": [" na coluna 2.
        for (const m of body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[/gm)) {
          sources.add(m[1]);
        }
      }
    }
  }

  const dynamic = new Set();
  for (const m of clean.matchAll(/\bentities\s*\??\.\s*([A-Z][A-Za-z0-9_]*)\b/g)) {
    dynamic.add(m[1]);
  }
  for (const m of clean.matchAll(/\bentities\s*\??\.?\[\s*['"`]([A-Z][A-Za-z0-9_]*)['"`]\s*\]/g)) {
    dynamic.add(m[1]);
  }

  const all = [...new Set([...sources, ...targets, ...dynamic])].sort();
  return {
    sources: [...sources].sort(),
    targets: [...targets].sort(),
    dynamic: [...dynamic].sort(),
    all,
  };
};

/**
 * Procura nomes de entidade proibidos citados como string em código executável.
 * @param {string} source
 * @param {string[]} forbiddenEntities
 * @returns {string[]}
 */
export const findForbiddenEntityStrings = (source, forbiddenEntities = []) => {
  const clean = stripComments(source);
  const found = new Set();
  for (const name of forbiddenEntities) {
    const re = new RegExp(`['"\`]${name}['"\`]|\\bentity:\\s*['"\`]${name}['"\`]|\\bentities\\s*\\??\\.\\s*${name}\\b`);
    if (re.test(clean)) found.add(name);
  }
  return [...found].sort();
};

/**
 * Procura invocações de outras functions Base44 dentro do código.
 * @param {string} source
 * @returns {string[]}
 */
export const findInvokedFunctions = (source) => {
  const clean = stripComments(source);
  const found = new Set();
  for (const m of clean.matchAll(/\bfunctions\s*\??\.\s*invoke\s*\(\s*['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]/g)) {
    found.add(m[1]);
  }
  for (const m of clean.matchAll(/\bfunctions\s*\??\.\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (m[1] !== 'invoke') found.add(m[1]);
  }
  return [...found].sort();
};

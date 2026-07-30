/**
 * Utilidades compartilhadas pelas catracas (Base44 e TypeScript).
 *
 * Regras comuns:
 *  - baseline ausente ou malformado é falha dura, nunca criação automática;
 *  - execução normal jamais escreve arquivo;
 *  - `--update` só grava sem regressão, com pelo menos uma redução, de forma atômica.
 */

import { writeFileSync, renameSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';

/** Escrita atômica: grava em arquivo temporário e renomeia. */
export const writeJsonAtomic = (path, data) => {
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    renameSync(tmp, path);
  } finally {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        /* o rename já consumiu o temporário */
      }
    }
  }
};

/**
 * Lê e valida um baseline JSON versionado.
 * @returns {{ok: true, data: object} | {ok: false, code: string, message: string}}
 */
export const readBaseline = (path, { expectedVersion, code }) => {
  if (!existsSync(path)) {
    return {
      ok: false,
      missing: true,
      code,
      message: `baseline ausente: ${path}. Ele é versionado e obrigatório — restaure-o do Git.`,
    };
  }

  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return { ok: false, code, message: `baseline ilegível: ${path} (${error.message})` };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return { ok: false, code, message: `baseline não é JSON válido: ${path} (${error.message})` };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, code, message: `baseline não é um objeto: ${path}` };
  }

  if (data.version !== expectedVersion) {
    return {
      ok: false,
      code,
      message: `versão de baseline desconhecida em ${path}: esperado ${JSON.stringify(expectedVersion)}, encontrado ${JSON.stringify(data.version)}`,
    };
  }

  return { ok: true, data };
};

/** Inteiro finito e não negativo? */
export const isCount = (value) =>
  typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value) && value >= 0;

/**
 * Compara dois multiconjuntos {chave: quantidade}.
 * @returns {{novos: string[], aumentos: string[], reducoes: string[]}}
 */
export const compareMultisets = (baseline, atual) => {
  const novos = [];
  const aumentos = [];
  const reducoes = [];

  for (const [chave, quantidade] of Object.entries(atual)) {
    const antes = baseline[chave] ?? 0;
    if (antes === 0) novos.push(`${chave} (x${quantidade})`);
    else if (quantidade > antes) aumentos.push(`${chave}: ${antes} -> ${quantidade}`);
    else if (quantidade < antes) reducoes.push(`${chave}: ${antes} -> ${quantidade}`);
  }
  for (const [chave, antes] of Object.entries(baseline)) {
    if (!(chave in atual) && antes > 0) reducoes.push(`${chave}: ${antes} -> 0`);
  }

  return { novos, aumentos, reducoes };
};

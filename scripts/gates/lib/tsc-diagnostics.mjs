/**
 * Execução e normalização dos diagnósticos do TypeScript.
 *
 * O fingerprint de um diagnóstico é deliberadamente independente de linha e
 * coluna: deslocar código não pode transformar dívida antiga em erro novo.
 *
 *   fingerprint = caminho relativo | código TS | mensagem normalizada
 *
 * A multiplicidade é preservada: se o mesmo fingerprint aparece três vezes,
 * baseline e atual comparam três.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `path(line,col): error TSxxxx: message` */
const DIAGNOSTIC_RE = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;

/** Normaliza a mensagem para comparação estável entre execuções. */
export const normalizeMessage = (message) =>
  message
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizePath = (filePath) => filePath.split('\\').join('/').replace(/^\.\//, '');

/**
 * Converte a saída bruta do `tsc` em diagnósticos estruturados.
 * Linhas indentadas de continuação são anexadas ao diagnóstico anterior.
 *
 * @param {string} stdout
 * @returns {Array<{file: string, code: string, message: string, fingerprint: string}>}
 */
export const parseDiagnostics = (stdout) => {
  const diagnostics = [];
  for (const rawLine of String(stdout).split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;

    const match = line.match(DIAGNOSTIC_RE);
    if (match) {
      const [, file, , , code, message] = match;
      diagnostics.push({
        file: normalizePath(file),
        code,
        messageParts: [message],
      });
      continue;
    }

    // Continuação (indentada) do diagnóstico anterior.
    if (/^\s/.test(line) && diagnostics.length) {
      diagnostics[diagnostics.length - 1].messageParts.push(line.trim());
    }
  }

  return diagnostics.map((d) => {
    const message = normalizeMessage(d.messageParts.join(' '));
    return {
      file: d.file,
      code: d.code,
      message,
      fingerprint: `${d.file}|${d.code}|${message}`,
    };
  });
};

/** Agrupa em multiconjunto {fingerprint: quantidade}. */
export const toFingerprintCounts = (diagnostics) => {
  const counts = {};
  for (const d of diagnostics) counts[d.fingerprint] = (counts[d.fingerprint] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

/** Agrupa em {arquivo: quantidade}. */
export const toFileCounts = (diagnostics) => {
  const counts = {};
  for (const d of diagnostics) counts[d.file] = (counts[d.file] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
};

/** Argumentos exatos do compilador. Versionados no baseline como `effectiveCommand`. */
export const tscArgs = (project) => ['-p', project, '--pretty', 'false', '--noEmit'];

/** Comando textual equivalente, gravado e comparado pelo contrato de tipos. */
export const tscCommand = (project) => `tsc ${tscArgs(project).join(' ')}`;

/**
 * Versão do TypeScript efetivamente usada.
 * @returns {{ok: true, version: string} | {ok: false, detail: string}}
 */
export const getTypescriptVersion = (cwd = process.cwd()) => {
  let tscBin;
  try {
    tscBin = require_resolve_tsc(cwd);
  } catch (error) {
    return { ok: false, detail: error.message };
  }
  const r = spawnSync(process.execPath, [tscBin, '--version'], { cwd, encoding: 'utf8' });
  if (r.error) return { ok: false, detail: r.error.message };
  const m = String(r.stdout || '').match(/Version\s+([0-9][^\s]*)/);
  if (!m) return { ok: false, detail: `saída inesperada de "tsc --version": ${String(r.stdout).trim().slice(0, 200)}` };
  return { ok: true, version: m[1] };
};

/**
 * Roda o compilador e devolve os diagnósticos.
 *
 * Falha de execução sem diagnóstico parseável é erro de runner, não dívida.
 *
 * @param {{project: string, cwd?: string}} options
 * @returns {{ok: true, diagnostics: Array} | {ok: false, reason: string, detail: string}}
 */
export const runTypecheck = ({ project, cwd = process.cwd() }) => {
  let tscBin;
  try {
    tscBin = require_resolve_tsc(cwd);
  } catch (error) {
    return { ok: false, reason: 'runner', detail: error.message };
  }

  const result = spawnSync(
    process.execPath,
    [tscBin, ...tscArgs(project)],
    { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 128 }
  );

  if (result.error) {
    return { ok: false, reason: 'spawn', detail: result.error.message };
  }
  if (result.signal) {
    return { ok: false, reason: 'signal', detail: `processo encerrado por sinal ${result.signal}` };
  }

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const diagnostics = parseDiagnostics(stdout);

  // Exit != 0 sem nenhum diagnóstico parseável = falha do runner.
  if (result.status !== 0 && diagnostics.length === 0) {
    return {
      ok: false,
      reason: 'runner',
      detail: (stderr.trim() || stdout.trim() || `tsc terminou com código ${result.status} sem diagnóstico parseável`).slice(0, 2000),
    };
  }

  return { ok: true, diagnostics, exitCode: result.status };
};

/**
 * Localiza o binário do `tsc` sem depender do PATH.
 * Procura no projeto e, se não achar, no `node_modules` deste repositório.
 */
function require_resolve_tsc(cwd) {
  if (process.env.TSC_BIN) return process.env.TSC_BIN;

  const candidatos = [
    join(cwd, 'node_modules/typescript/bin/tsc'),
    fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)),
  ];
  const encontrado = candidatos.find((c) => existsSync(c));
  if (!encontrado) {
    throw new Error(
      `binário do TypeScript não encontrado. Procurado em:\n  ${candidatos.join('\n  ')}`
    );
  }
  return encontrado;
}

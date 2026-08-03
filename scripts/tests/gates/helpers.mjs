/**
 * Utilidades para os testes de gate.
 *
 * Cada teste roda o gate real num diretório temporário, com fixtures próprias.
 * Nada toca o repositório de trabalho.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const GATES_DIR = join(REPO_ROOT, 'scripts/gates');

export const makeTempDir = (prefix = 'maike-gate-') => mkdtempSync(join(tmpdir(), prefix));

export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

/** Escreve um arquivo criando os diretórios necessários. */
export const writeFile = (dir, relPath, content) => {
  const abs = join(dir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  return abs;
};

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export const fileExists = (path) => existsSync(path);

/**
 * Roda um gate e devolve exit code + saída.
 * @param {string} gateFile nome do arquivo em scripts/gates
 * @param {{cwd?: string, env?: object, args?: string[]}} options
 */
export const runGate = (gateFile, { cwd = REPO_ROOT, env = {}, args = [] } = {}) => {
  const result = spawnSync(process.execPath, [join(GATES_DIR, gateFile), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 64,
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: (result.stdout || '') + (result.stderr || ''),
  };
};

/** Inicializa um repositório Git mínimo (necessário para o gate de segredos). */
export const initGitRepo = (dir) => {
  const run = (...args) =>
    spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  run('init', '-q');
  run('config', 'user.email', 'gate-test@local');
  run('config', 'user.name', 'Gate Test');
  run('add', '-A');
  return run;
};

/** Manifesto mínimo válido, sobrescrevível campo a campo. */
export const baseManifest = (overrides = {}) => ({
  version: '1.0.0',
  primarySurface: 'MapaGeral',
  allowedPages: ['MapaGeral'],
  allowedManualRoutes: [],
  allowedBase44Entities: ['Lote', 'Setor', 'AreaPastagem'],
  allowedBase44Functions: ['syncEntityReferences'],
  forbiddenBase44Entities: ['CustoSafra', 'Safra', 'TarefaMapa'],
  requiredRoots: [],
  forbiddenDomains: [],
  orphanAllowlist: [],
  ...overrides,
});

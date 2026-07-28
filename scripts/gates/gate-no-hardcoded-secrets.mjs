#!/usr/bin/env node
/**
 * Gate: segredos.
 *
 * Contrato endurecido (P0.1-R1): a varredura usa a lista real de arquivos
 * versionados no Git — não apenas `src/` e a raiz. Binários, `node_modules`,
 * `dist` e fixtures isoladas ficam de fora.
 *
 * O valor encontrado NUNCA é impresso. O relato é `arquivo:linha + tipo`.
 *
 * Códigos: P01-SECRET-HARDCODED · P01-SECRET-ENV-TRACKED
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';

const ROOT = process.env.SECRETS_ROOT || process.cwd();

/** Templates de ambiente que podem ser versionados, desde que sem valor real. */
export const ENV_TEMPLATES = new Set(['.env.example', '.env.template', '.env.sample']);

/** Diretórios de fixture deste próprio gate — contêm segredos sintéticos de teste. */
const FIXTURE_PREFIXES = ['scripts/tests/gates/fixtures/'];

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.webm', '.wav',
  '.node', '.wasm', '.so', '.dylib', '.dll', '.exe', '.bin',
]);

const IGNORED_PREFIXES = ['node_modules/', 'dist/', 'dist-ssr/', 'coverage/'];

export const SECRET_RULES = [
  { nome: 'Google API key', re: /\bAIza[0-9A-Za-z_\-]{30,}\b/ },
  { nome: 'JWT emitido', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { nome: 'Token Base44 literal', re: /\bbase44[_-]?(token|api[_-]?key|secret)\s*[:=]\s*['"][^'"\s]{12,}['"]/i },
  { nome: 'GitHub PAT', re: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { nome: 'AWS access key id', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { nome: 'AWS secret access key', re: /\baws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/i },
  { nome: 'Cabeçalho de chave privada', re: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP|PRIVATE)[A-Z ]*KEY-----/ },
  { nome: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { nome: 'Bearer token de alta entropia', re: /\bBearer\s+[A-Za-z0-9_\-.=]{40,}\b/ },
  { nome: 'JWT secret literal', re: /\b(jwt[_-]?secret|JWT_SECRET)\s*[:=]\s*['"][^'"\s]{8,}['"]/ },
  {
    nome: 'Segredo atribuído diretamente',
    re: /\b(api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|access[_-]?token|private[_-]?key|password|passwd)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

/** Valores obviamente mascarados/documentais não contam. */
export const MASKED = /(\bxxx+\b|<[^>]+>|\$\{[^}]*\}|SUA_CHAVE|YOUR_[A-Z_]*KEY|CHANGE_?ME|EXEMPLO|EXAMPLE|PLACEHOLDER|REDACTED|\.{3}|\*{3}|process\.env|import\.meta\.env)/i;

/** Lista os arquivos versionados no Git. */
export const listTrackedFiles = (root = ROOT) => {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  return out.split('\0').filter(Boolean);
};

const isIgnored = (rel) =>
  IGNORED_PREFIXES.some((p) => rel.startsWith(p)) || FIXTURE_PREFIXES.some((p) => rel.startsWith(p));

const isBinaryPath = (rel) => BINARY_EXTS.has(extname(rel).toLowerCase());

/** Heurística de conteúdo binário: byte nulo nos primeiros KB. */
const looksBinary = (buffer) => buffer.subarray(0, 8000).includes(0);

const basename = (rel) => rel.split('/').pop();

/** É um arquivo .env (não template)? */
export const isTrackedEnvFile = (rel) => {
  const name = basename(rel);
  if (!/^\.env($|\.)/.test(name)) return false;
  return !ENV_TEMPLATES.has(name);
};

/**
 * Varre os arquivos versionados em busca de segredos.
 * @returns {Array<{file: string, line: number|null, rule: string, code: string}>}
 */
export const scan = (root = ROOT) => {
  const achados = [];

  for (const rel of listTrackedFiles(root)) {
    if (isIgnored(rel)) continue;

    if (isTrackedEnvFile(rel)) {
      achados.push({ file: rel, line: null, rule: 'arquivo .env versionado', code: 'P01-SECRET-ENV-TRACKED' });
      continue;
    }

    if (isBinaryPath(rel)) continue;

    const abs = `${root}/${rel}`;
    if (!existsSync(abs)) continue;

    let buffer;
    try {
      buffer = readFileSync(abs);
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;

    const linhas = buffer.toString('utf8').split('\n');
    linhas.forEach((linha, i) => {
      if (MASKED.test(linha)) return;
      for (const regra of SECRET_RULES) {
        if (regra.re.test(linha)) {
          achados.push({ file: rel, line: i + 1, rule: regra.nome, code: 'P01-SECRET-HARDCODED' });
        }
      }
    });
  }

  return achados;
};

// Execução direta
const executadoDireto = process.argv[1] && process.argv[1].endsWith('gate-no-hardcoded-secrets.mjs');
if (executadoDireto) {
  let achados;
  try {
    achados = scan();
  } catch (error) {
    console.error(`gate:no-secrets — FALHOU\n\n  - [P01-SECRET-HARDCODED] não foi possível listar arquivos versionados: ${error.message}`);
    process.exit(1);
  }

  if (achados.length) {
    console.error('gate:no-secrets — FALHOU\n');
    // Nunca imprimir o valor: apenas arquivo, linha e tipo.
    achados.forEach((a) =>
      console.error(`  - [${a.code}] ${a.file}${a.line ? `:${a.line}` : ''} — ${a.rule}`)
    );
    process.exit(1);
  }

  const total = listTrackedFiles().filter((f) => !isIgnored(f)).length;
  console.log(`gate:no-secrets — PASSOU (${total} arquivos versionados verificados, 0 segredos)`);
}

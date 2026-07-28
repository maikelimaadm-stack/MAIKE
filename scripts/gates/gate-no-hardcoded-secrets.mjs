#!/usr/bin/env node
// Gate: segredos — nenhuma chave literal em src/ nem .env versionado.
// Código: P01-SECRET-HARDCODED

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const EXTS = ['.js', '.jsx', '.ts', '.tsx', '.json'];

const REGRAS = [
  { nome: 'Google Maps API key', re: /\bAIza[0-9A-Za-z_\-]{30,}\b/ },
  { nome: 'Token Base44 literal', re: /\b(base44[_-]?(token|api[_-]?key|secret))\s*[:=]\s*['"][^'"\s]{12,}['"]/i },
  { nome: 'JWT secret literal', re: /\b(jwt[_-]?secret|JWT_SECRET)\s*[:=]\s*['"][^'"\s]{8,}['"]/ },
  { nome: 'JWT emitido literal', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

// Valores obviamente mascarados em exemplo/documentação não contam.
const MASCARADO = /(\bxxx+\b|<[^>]+>|SUA_CHAVE|YOUR_KEY|CHANGE_?ME|EXEMPLO|EXAMPLE|\.{3}|\*{3})/i;

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};

const achados = [];

if (existsSync(SRC)) {
  for (const arquivo of walk(SRC).filter((f) => EXTS.some((e) => f.endsWith(e)))) {
    const linhas = readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((linha, i) => {
      for (const regra of REGRAS) {
        if (regra.re.test(linha) && !MASCARADO.test(linha)) {
          achados.push(`${relative(ROOT, arquivo)}:${i + 1} — ${regra.nome}`);
        }
      }
    });
  }
}

// Arquivos .env versionados (exceto .env.example)
const envVersionados = readdirSync(ROOT)
  .filter((f) => f.startsWith('.env') && f !== '.env.example')
  .filter((f) => statSync(join(ROOT, f)).isFile());

for (const f of envVersionados) {
  achados.push(`${f} — arquivo .env não pode ser versionado (use .env.example)`);
}

if (achados.length) {
  console.error('gate:no-secrets — FALHOU\n');
  achados.forEach((a) => console.error(`  - [P01-SECRET-HARDCODED] ${a}`));
  process.exit(1);
}

console.log('gate:no-secrets — PASSOU (nenhum segredo literal em src/, nenhum .env versionado)');

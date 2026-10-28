#!/usr/bin/env node
/**
 * Gate: Motor Base1 compartilhado independente de entidades (D-PROD-55 extensão visual).
 *
 * Código: P55-MOTORBASE1-DOMAIN-IMPORT
 */

import { scanMotorBase1Independence } from './lib/motorbase1-independence.mjs';

const { violations } = scanMotorBase1Independence();

if (violations.length) {
  console.error('gate:motorbase1-independence — FALHOU\n');
  for (const v of violations) {
    console.error(
      `  - [P55-MOTORBASE1-DOMAIN-IMPORT] ${v.file}:${v.line} importa ${v.spec} (${v.reason})`,
    );
  }
  console.error('');
  process.exit(1);
}

console.log(
  'gate:motorbase1-independence — PASSOU (base1/hooks cadastro/lib cadastro sem import de domínio)',
);

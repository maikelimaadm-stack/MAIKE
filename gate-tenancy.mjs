#!/usr/bin/env node
// Gate: Tenancy — todo model Prisma precisa de cliente_id.
// Regra R1 · Constituição P3 · Do-Not-Do D1

import { readFileSync, existsSync } from 'node:fs';

const SCHEMA = 'backend/prisma/schema.prisma';
const ALLOWLIST = new Set([
  'Cliente',          // raiz do tenant
  'CadCpsTela',       // catálogo global de telas
  'MdpRegistrySchema' // schema global de validação
]);

if (!existsSync(SCHEMA)) {
  console.log('SKIP gate:tenancy — schema.prisma ainda não existe (Fase 1 pendente)');
  process.exit(0);
}

const src = readFileSync(SCHEMA, 'utf8');
const models = [...src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
const falhas = [];

for (const [, nome, corpo] of models) {
  if (ALLOWLIST.has(nome)) continue;
  const temCampo = /^\s*cliente_id\s+/m.test(corpo);
  const ehJoinTable = /@@id\(\[/.test(corpo) && !/^\s*id\s+String\s+@id/m.test(corpo);
  if (!temCampo && !ehJoinTable) {
    falhas.push(nome);
  }
}

console.log(`gate:tenancy — ${models.length} models analisados`);
if (falhas.length) {
  console.error(`\nFALHOU: ${falhas.length} model(s) sem cliente_id\n`);
  falhas.forEach(m => console.error(`  - ${m}`));
  console.error('\nRegra R1: todo model tem cliente_id. Ver docs/constitution/07-DO-NOT-DO.md (D1).');
  process.exit(1);
}
console.log('PASSOU: todos os models têm cliente_id');

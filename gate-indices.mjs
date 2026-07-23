#!/usr/bin/env node
// Gate: Índices — @@index e @@unique devem começar por cliente_id.
// Regra R2/R3 · Do-Not-Do D2/D3

import { readFileSync, existsSync } from 'node:fs';

const SCHEMA = 'backend/prisma/schema.prisma';
const ALLOWLIST = new Set(['Cliente', 'CadCpsTela', 'MdpRegistrySchema']);

if (!existsSync(SCHEMA)) {
  console.log('SKIP gate:indices — schema.prisma ainda não existe');
  process.exit(0);
}

const src = readFileSync(SCHEMA, 'utf8');
const models = [...src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
const falhas = [];
let total = 0;

for (const [, nome, corpo] of models) {
  if (ALLOWLIST.has(nome)) continue;
  if (!/^\s*cliente_id\s+/m.test(corpo)) continue; // sem tenancy, gate:tenancy trata

  for (const m of corpo.matchAll(/@@(index|unique)\(\[([^\]]+)\]/g)) {
    total++;
    const tipo = m[1];
    const cols = m[2].split(',').map(c => c.trim());
    if (cols[0] !== 'cliente_id') {
      falhas.push({ model: nome, tipo, cols: cols.join(', ') });
    }
  }
  // @unique isolado em campo de negócio
  for (const m of corpo.matchAll(/^\s*(\w+)\s+\S+.*@unique/gm)) {
    if (m[1] !== 'id') {
      falhas.push({ model: nome, tipo: 'unique-isolado', cols: m[1] });
    }
  }
}

console.log(`gate:indices — ${total} índices analisados`);
if (falhas.length) {
  console.error(`\nFALHOU: ${falhas.length} índice(s) sem cliente_id como primeira coluna\n`);
  falhas.forEach(f => console.error(`  - ${f.model}: @@${f.tipo}([${f.cols}])`));
  console.error('\nRegra R2/R3. Ver docs/constitution/07-DO-NOT-DO.md (D2, D3).');
  console.error('Se o índice for legitimamente global, adicione o model à ALLOWLIST com justificativa em DECISIONS.md.');
  process.exit(1);
}
console.log('PASSOU: todos os índices começam por cliente_id');

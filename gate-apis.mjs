#!/usr/bin/env node
// Gate: Camada de APIs — componente não acessa provider de dados direto.
// Regra R4 · Do-Not-Do D10

import { execSync } from 'node:child_process';

const PERMITIDOS = ['src/api/', 'src/apis/', 'src/repositories/', 'src/core/repositories/'];

function buscar(padrao) {
  try {
    return execSync(
      `grep -rln "${padrao}" src/components src/pages 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).split('\n').filter(Boolean);
  } catch { return []; }
}

const infratores = new Set([
  ...buscar("from '@base44/sdk'"),
  ...buscar("from '@/api/base44Client'"),
  ...buscar('from "@base44/sdk"')
]);

const filtrados = [...infratores].filter(f => !PERMITIDOS.some(p => f.startsWith(p)));

console.log(`gate:apis — ${filtrados.length} arquivo(s) em components/pages importando SDK direto`);

if (filtrados.length) {
  console.error('\nFALHOU: componentes acessando provider de dados diretamente\n');
  filtrados.slice(0, 30).forEach(f => console.error(`  - ${f}`));
  if (filtrados.length > 30) console.error(`  ... e mais ${filtrados.length - 30}`);
  console.error('\nRegra R4: todo acesso passa por src/apis/. Ver docs/constitution/07-DO-NOT-DO.md (D10).');
  process.exit(1);
}
console.log('PASSOU: nenhum acesso direto em components/pages');

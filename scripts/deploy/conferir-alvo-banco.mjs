#!/usr/bin/env node
/**
 * Confere, SÓ COM LEITURA, que o runtime e a migration apontam para o MESMO
 * banco esperado (PR145-G4-R1). Ver `alvoBancoLib.mjs`.
 *
 * Uso (na mesma sessão de terminal que vai migrar):
 *   MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=<id> node scripts/deploy/conferir-alvo-banco.mjs
 * Saída: 0 = mesmo banco e cluster esperado; 1 = NÃO prossiga.
 * Nunca imprime URL, host, usuário ou mensagem de erro do driver.
 */

import { conferirAlvos } from './alvoBancoLib.mjs';

const { env } = await import('../../backend/src/config/env.js');
const v = await conferirAlvos({
  esperadoSid: (process.env.MIGRATION_EXPECTED_SYSTEM_IDENTIFIER ?? '').trim(),
  urlRuntime: env.databaseUrl,
  urlMigracao: process.env.MIGRATION_DATABASE_URL,
});
if (v.ok) {
  console.log(`ALVO CONFERE: runtime e migration são o mesmo banco esperado (${v.resumo}).`);
} else {
  console.log('ALVO NÃO CONFERE — NÃO prossiga:');
  for (const f of v.falhas) console.log(`  ${f}`);
}
process.exit(v.ok ? 0 : 1);

#!/usr/bin/env node
/**
 * Smoke pós-deploy do MAIKE Admin (PR145-R4). Só leitura, sem credencial.
 *
 *   node scripts/admin/smoke-admin-deploy.mjs --url https://<endereço-do-admin>
 *   node scripts/admin/smoke-admin-deploy.mjs --url http://127.0.0.1:5174 --permitir-http   (local)
 *
 * Sai com código 1 se qualquer verificação falhar; o rollout só segue com tudo PASS.
 */
import { verificarDeployAdmin } from './smokeAdminDeployLib.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--url');
const url = i >= 0 ? args[i + 1] : '';
if (!url) {
  console.error('uso: --url <endereço do MAIKE Admin> [--permitir-http]');
  process.exit(1);
}
const resultado = await verificarDeployAdmin({ url, permitirHttp: args.includes('--permitir-http') });
for (const c of resultado) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.nome}${c.detalhe ? ` — ${c.detalhe}` : ''}`);
const falhas = resultado.filter((c) => !c.ok).length;
console.log(falhas ? `\n${falhas} verificação(ões) falharam: o MAIKE Admin NÃO está pronto neste endereço.` : '\nMAIKE Admin respondeu como esperado neste endereço.');
process.exit(falhas ? 1 : 0);

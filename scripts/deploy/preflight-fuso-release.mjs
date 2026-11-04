#!/usr/bin/env node
/**
 * PR190-R2 (D-PROD-122) — preflight SOMENTE LEITURA da release do fuso.
 *
 * Roda ANTES do merge (que dispara o deploy de produção na Vercel). Lê o banco
 * que o RUNTIME usa — mesma precedência de backend/src/config/env.js:
 *   POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL
 * (o operador exporta no próprio terminal os valores do ambiente PRODUCTION
 * da Vercel; nada vem do repositório).
 *
 * Portões:
 *   TARGET  — alvo remoto exige MIGRATION_EXPECTED_SYSTEM_IDENTIFIER igual ao do
 *             banco lido; com MIGRATION_DATABASE_URL presente, confere também que
 *             runtime e migration são o MESMO banco (alvoBancoLib.conferirAlvos).
 *   SCHEMA  — migration 20261104200000_empresa_fuso_horario aplicada com o checksum
 *             do manifesto e coluna Empresa.fuso_horario conforme.
 *   DATA    — toda empresa ativada no ledger com fuso IANA explícito válido.
 * Saída: JSON (ids crus só com --mostrar-ids). Exit 0 = READY; 3 = BLOCKED;
 * 2 = uso; 1 = falha técnica. Nunca imprime URL, host, usuário ou senha.
 * Transação READ ONLY: nenhuma escrita é possível.
 */

import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
for (const a of args) {
  if (a !== '--mostrar-ids') {
    console.error('uso: node scripts/deploy/preflight-fuso-release.mjs [--mostrar-ids]');
    process.exit(2);
  }
}
const mostrarIds = args.includes('--mostrar-ids');
const env = (n) => (typeof process.env[n] === 'string' && process.env[n].trim() ? process.env[n].trim() : null);
const url = env('POSTGRES_PRISMA_URL') ?? env('DATABASE_URL') ?? env('POSTGRES_URL');
const esperadoSid = env('MIGRATION_EXPECTED_SYSTEM_IDENTIFIER');
const urlMigracao = env('MIGRATION_DATABASE_URL');

const sair = (relatorio, codigo) => {
  console.log(JSON.stringify(relatorio, null, 2));
  process.exit(codigo);
};
if (!url) sair({ estado: 'BLOCKED', TARGET: 'SEM_CONEXAO', motivo: 'nenhuma URL do runtime no ambiente' }, 3);
let host;
try {
  host = new URL(url).hostname.replace(/^\[|\]$/g, '');
} catch {
  sair({ estado: 'BLOCKED', TARGET: 'URL_ILEGIVEL' }, 3);
}
const local = ['localhost', '127.0.0.1', '::1'].includes(host);
if (!local && !/^\d{6,25}$/.test(esperadoSid ?? '')) sair({ estado: 'BLOCKED', TARGET: 'TARGET_UNVERIFIED', motivo: 'alvo remoto exige MIGRATION_EXPECTED_SYSTEM_IDENTIFIER' }, 3);

const { PrismaClient } = await import('@prisma/client');
const { executarSomenteLeitura } = await import('../ops/inventarioFuturosRebanhoLib.mjs');
const { diagnosticarProntidaoFuso } = await import('../ops/fusoReleaseLib.mjs');
const hash = (v) => `h:${createHash('sha256').update(String(v)).digest('hex').slice(0, 12)}`;
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const [{ sid }] = /** @type {Array<{sid: string}>} */ (await prisma.$queryRaw`SELECT system_identifier::text AS sid FROM pg_control_system()`);
  let target = local ? 'LOCAL' : sid === esperadoSid ? 'SID_CONFERE' : 'SID_DIVERGENTE';
  const falhasAlvo = [];
  if (!local && urlMigracao) {
    const { conferirAlvos } = await import('./alvoBancoLib.mjs');
    const v = await conferirAlvos({ esperadoSid, urlRuntime: url, urlMigracao });
    if (!v.ok) {
      target = 'RUNTIME_E_MIGRATION_DIFEREM';
      falhasAlvo.push(...v.falhas);
    }
  }
  const prontidao = await executarSomenteLeitura(prisma, (tx) => diagnosticarProntidaoFuso(tx));
  const pendentes = (prontidao.dados.pendentes ?? []).map((p) => ({ ...p, cliente_id: mostrarIds ? p.cliente_id : hash(p.cliente_id), empresa_id: mostrarIds ? p.empresa_id : hash(p.empresa_id) }));
  const alvoOk = target === 'LOCAL' || target === 'SID_CONFERE';
  const estado = alvoOk && prontidao.estado === 'READY' ? 'READY' : 'BLOCKED';
  sair({
    estado,
    TARGET: target,
    ...(falhasAlvo.length ? { falhas_alvo: falhasAlvo } : {}),
    SCHEMA_READY: prontidao.SCHEMA_READY,
    DATA_READY: prontidao.DATA_READY,
    schema_motivos: prontidao.schema.motivos,
    empresas_ativadas: prontidao.dados.ativadas,
    empresas_sem_fuso: pendentes,
    somente_leitura: true,
  }, estado === 'READY' ? 0 : 3);
} catch (e) {
  console.error(`preflight-fuso-release — FALHA TÉCNICA (${e?.code ?? e?.name ?? 'erro'})`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

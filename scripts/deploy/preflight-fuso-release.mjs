#!/usr/bin/env node
/**
 * PR190-R2/R3 (D-PROD-122) — preflight SOMENTE LEITURA da release do fuso.
 *
 * Roda ANTES do merge (que dispara o deploy de produção na Vercel).
 *
 * ALVO (R3, fail-closed). Fora de banco local, READY exige NA MESMA EXECUÇÃO:
 *   - URL do RUNTIME pela precedência do backend/src/config/env.js
 *     (POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL, valores de PRODUCTION
 *     da Vercel exportados pelo operador no próprio terminal);
 *   - MIGRATION_DATABASE_URL (a conexão que o premerge-migrate usou);
 *   - MIGRATION_EXPECTED_SYSTEM_IDENTIFIER;
 *   - RELEASE_ALVO_ATESTADO: quem obteve esse system_identifier, onde e quando,
 *     no banco AUTORIZADO (ex.: "proprietário, SQL Editor do projeto X, <data>").
 *     O SID informado pelo próprio operador só prova algo amarrado a esse atestado.
 * As duas conexões são lidas e têm de ser o MESMO banco: mesmo system_identifier
 * (= esperado), mesmo OID de banco lógico e mesmo histórico de migrations
 * (alvoBancoLib.compararAlvos). Hostname nunca é usado como prova. Faltou algo,
 * sem permissão para ler a identidade, inalcançável ou divergente →
 * TARGET_UNVERIFIED / BLOCKED. Nunca READY.
 * Banco local descartável (host literal localhost/127.0.0.1/::1): READY_LOCAL_TESTE,
 * que NÃO vale como prova de produção.
 *
 * SCHEMA/DATA: migration 20261104200000_empresa_fuso_horario aplicada com o
 * checksum do manifesto e coluna conforme; toda empresa ATIVADA com fuso IANA.
 *
 * Saída JSON sem URL, host, usuário, senha, SID ou ids crus (hash). `--mostrar-ids`
 * só é aceito em banco local. Exit 0 = READY_*; 3 = BLOCKED; 2 = uso incorreto.
 * Transação READ ONLY: nenhuma escrita é possível.
 */

const args = process.argv.slice(2);
const uso = (m) => {
  console.error(`preflight-fuso-release: ${m}\nuso: node scripts/deploy/preflight-fuso-release.mjs [--mostrar-ids]  (--mostrar-ids só em banco local)`);
  process.exit(2);
};
const vistos = new Set();
for (const a of args) {
  if (a !== '--mostrar-ids') uso(`argumento desconhecido: ${a}`);
  if (vistos.has(a)) uso(`argumento repetido: ${a}`);
  vistos.add(a);
}
const mostrarIds = vistos.has('--mostrar-ids');
const env = (n) => (typeof process.env[n] === 'string' && process.env[n].trim() ? process.env[n].trim() : null);
const urlRuntime = env('POSTGRES_PRISMA_URL') ?? env('DATABASE_URL') ?? env('POSTGRES_URL');
const urlMigracao = env('MIGRATION_DATABASE_URL');

const { avaliarAlvoRelease, diagnosticarProntidaoFuso, hashId, hostEhLocal } = await import('../ops/fusoReleaseLib.mjs');
const sair = (relatorio, codigo) => {
  console.log(JSON.stringify(relatorio, null, 2));
  process.exit(codigo);
};
const localLiteral = !!urlRuntime && hostEhLocal(urlRuntime) && (!urlMigracao || hostEhLocal(urlMigracao));
if (mostrarIds && !localLiteral) uso('--mostrar-ids só é aceito com banco local descartável');
if (!urlRuntime) sair({ estado: 'BLOCKED', TARGET: 'TARGET_UNVERIFIED', motivos_alvo: ['RUNTIME_URL_AUSENTE'], somente_leitura: true }, 3);

const alvo = await avaliarAlvoRelease({
  urlRuntime,
  urlMigracao,
  esperadoSid: env('MIGRATION_EXPECTED_SYSTEM_IDENTIFIER'),
  atestado: env('RELEASE_ALVO_ATESTADO'),
});
const baseRelatorio = {
  TARGET: alvo.TARGET,
  ...(alvo.motivos.length ? { motivos_alvo: alvo.motivos } : {}),
  ...(alvo.falhas.length ? { falhas_alvo: alvo.falhas } : {}),
  ...(alvo.local ? {} : { atestado_alvo: env('RELEASE_ALVO_ATESTADO') ? 'informado' : 'ausente' }),
  somente_leitura: true,
};
if (!alvo.ok) sair({ estado: 'BLOCKED', ...baseRelatorio }, 3);

const { PrismaClient } = await import('@prisma/client');
const { executarSomenteLeitura } = await import('../ops/inventarioFuturosRebanhoLib.mjs');
const prisma = new PrismaClient({ datasources: { db: { url: urlRuntime } } });
let codigo = 3;
try {
  const prontidao = await executarSomenteLeitura(prisma, (tx) => diagnosticarProntidaoFuso(tx));
  const pendentes = (prontidao.dados.pendentes ?? []).map((p) => ({ ...p, cliente_id: mostrarIds ? p.cliente_id : hashId(p.cliente_id), empresa_id: mostrarIds ? p.empresa_id : hashId(p.empresa_id) }));
  const pronto = prontidao.estado === 'READY';
  const estado = pronto ? (alvo.local ? 'READY_LOCAL_TESTE' : 'READY_ALVO_CONFERIDO') : 'BLOCKED';
  codigo = pronto ? 0 : 3;
  console.log(JSON.stringify({
    estado,
    ...baseRelatorio,
    SCHEMA_READY: prontidao.SCHEMA_READY,
    DATA_READY: prontidao.DATA_READY,
    schema_motivos: prontidao.schema.motivos,
    empresas_ativadas: prontidao.dados.ativadas,
    empresas_sem_fuso: pendentes,
  }, null, 2));
} catch (e) {
  // Leitura de schema/dados falhou (permissão, conexão): bloqueia, sem detalhe sensível.
  console.log(JSON.stringify({ estado: 'BLOCKED', ...baseRelatorio, motivo: `LEITURA_FALHOU (${e?.code ?? e?.name ?? 'erro'})` }, null, 2));
  codigo = 3;
} finally {
  await prisma.$disconnect();
}
process.exit(codigo);

#!/usr/bin/env node
/**
 * PR174-R5 (D-PROD-107) — cutover de UMA empresa para o controle por posições
 * (escopo e estratégias em cutoverRebanhoLib.mjs). Ação OPERACIONAL única e
 * separada: nunca roda no build da Vercel, no startup da função nem em request.
 *
 * Diagnóstico (padrão; SOMENTE LEITURA):
 *   CUTOVER_DATABASE_URL='postgresql://…' node scripts/ops/cutover-rebanho.mjs --cliente-id <id> --empresa-id <id>
 * Execução (todas as travas):
 *   … --executar --estrategia entradas|reset_e_entradas|saldo_abertura \
 *     --confirmar-empresa "<nome exato>" --usuario-admin-id <id do administrador do cliente> \
 *     [--backup <arquivo.json>  (obrigatório em reset_e_entradas)] [--data-corte AAAA-MM-DD (saldo_abertura)]
 *
 * Segurança: lê só CUTOVER_DATABASE_URL (nunca DATABASE_URL de runtime) e não a
 * imprime. Se CUTOVER_EXPECTED_SYSTEM_IDENTIFIER estiver definido, ou se o alvo
 * não for local, o system_identifier do banco TEM de conferir (falha fechada).
 * Exit: 0 ok · 1 falha técnica · 2 uso incorreto · 3 recusado (nada alterado)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const uso = (msg) => {
  console.error(`cutover-rebanho: ${msg}`);
  process.exit(2);
};

const url = process.env.CUTOVER_DATABASE_URL;
if (!url) uso('CUTOVER_DATABASE_URL ausente');
const clienteId = valor('--cliente-id');
const empresaId = valor('--empresa-id');
if (!clienteId || !empresaId) uso('--cliente-id e --empresa-id são obrigatórios');
const executar = args.includes('--executar');
const estrategia = valor('--estrategia');
const confirmar = valor('--confirmar-empresa');
const usuarioId = valor('--usuario-admin-id');
const backup = valor('--backup');
const dataCorte = valor('--data-corte');
if (executar && (!estrategia || !confirmar || !usuarioId)) uso('--executar exige --estrategia, --confirmar-empresa e --usuario-admin-id');
if (executar && estrategia === 'reset_e_entradas' && !backup) uso('reset_e_entradas exige --backup');
if (backup && existsSync(backup)) uso('o arquivo de backup já existe (não sobrescreve)');
// PR174-R6: backup FORA do repositório (nunca versionado, nunca artefato de CI).
const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (backup && resolve(backup).startsWith(`${RAIZ_REPO}/`)) uso('o backup tem de ficar fora do repositório');

let host;
try {
  host = new URL(url).hostname;
} catch {
  uso('CUTOVER_DATABASE_URL inválida');
}
const local = ['localhost', '127.0.0.1', '::1'].includes(host);
const esperado = process.env.CUTOVER_EXPECTED_SYSTEM_IDENTIFIER;
if (!local && !esperado) uso('alvo remoto exige CUTOVER_EXPECTED_SYSTEM_IDENTIFIER');

// O núcleo do backend lê DATABASE_URL ao importar: aponta-o para o MESMO alvo conferido.
process.env.DATABASE_URL = url;
const { PrismaClient } = await import('@prisma/client');
const { diagnosticarEmpresa, executarCutover, CutoverRecusado } = await import('./cutoverRebanhoLib.mjs');
const { conferirBackup } = await import('./resetRebanhoEmpresaTesteLib.mjs');
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  if (esperado) {
    const [{ sid }] = await prisma.$queryRaw`SELECT system_identifier::text AS sid FROM pg_control_system()`;
    if (sid !== esperado) {
      console.error('cutover-rebanho: system_identifier do alvo não confere; nada alterado');
      process.exitCode = 3;
      throw new Error('ALVO_DIVERGENTE');
    }
  }
  console.log(JSON.stringify({ modo: executar ? 'EXECUCAO' : 'DIAGNOSTICO', ...(await diagnosticarEmpresa(prisma, { clienteId, empresaId })) }, null, 2));
  if (executar) {
    const { ativarEmpresaNaTransacao } = await import('../../backend/src/modules/rebanhoLedger/rebanhoLedgerService.js');
    const r = await executarCutover(prisma, {
      clienteId, empresaId, estrategia, dataCorte: dataCorte ?? null, usuarioId, confirmarEmpresaNome: confirmar, ativarEmpresaNaTransacao,
      // Grava (exclusivo, 0600), relê e confere o manifesto ANTES de qualquer DELETE; falha = ROLLBACK.
      gravarBackup: (obj) => {
        writeFileSync(backup, `${JSON.stringify(obj, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        return conferirBackup(JSON.parse(readFileSync(backup, 'utf8')));
      },
    });
    console.log(JSON.stringify(r, null, 2));
  }
} catch (e) {
  if (e?.message === 'ALVO_DIVERGENTE') {
    /* já reportado */
  } else if (e instanceof CutoverRecusado || e?.codigo) {
    console.error(`cutover-rebanho: RECUSADO ${e.codigo} — ${e.message}; nada alterado além do relatado`);
    if (e.detalhes && Object.keys(e.detalhes).length) console.error(JSON.stringify(e.detalhes, null, 2));
    process.exitCode = 3;
  } else {
    console.error(`cutover-rebanho: FALHA TÉCNICA (${e?.code ?? e?.name ?? 'erro'})`);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}

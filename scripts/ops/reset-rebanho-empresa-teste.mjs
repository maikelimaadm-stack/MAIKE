#!/usr/bin/env node
/**
 * PR174-R1 (D-PROD-107) — reset CONTROLADO do rebanho de UMA empresa de TESTE
 * (ver resetRebanhoEmpresaTesteLib.mjs para o escopo exato).
 *
 * Uso (padrão = SIMULAÇÃO, nada é alterado):
 *   RESET_DATABASE_URL='postgresql://...' node scripts/ops/reset-rebanho-empresa-teste.mjs \
 *     --cliente-id <id> --empresa-id <id>
 * Execução real (exige as três travas):
 *   ... --executar --confirmar-empresa "<nome exato da empresa>" --backup <arquivo.json>
 *
 * Segurança:
 *   - Só lê RESET_DATABASE_URL (nunca DATABASE_URL, para não apontar sem querer
 *     para o banco da aplicação). Não imprime a URL.
 *   - Alvo fora de localhost exige RESET_EXPECTED_SYSTEM_IDENTIFIER igual ao
 *     system_identifier do banco (mesma trava do runner de migrations).
 *   - O backup é gravado ANTES de qualquer alteração; o arquivo não pode existir.
 *
 * Exit: 0 ok · 1 falha técnica · 2 uso incorreto · 3 recusado (nada alterado)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

import { ResetRecusado, conferirBackup, executarReset, planejarReset } from './resetRebanhoEmpresaTesteLib.mjs';

const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const uso = (msg) => {
  console.error(`reset-rebanho-empresa-teste: ${msg}`);
  process.exit(2);
};

const url = process.env.RESET_DATABASE_URL;
if (!url) uso('RESET_DATABASE_URL ausente');
const clienteId = valor('--cliente-id');
const empresaId = valor('--empresa-id');
if (!clienteId || !empresaId) uso('--cliente-id e --empresa-id são obrigatórios');
const executar = args.includes('--executar');
const confirmar = valor('--confirmar-empresa');
const backup = valor('--backup');
if (executar && (!confirmar || !backup)) uso('--executar exige --confirmar-empresa e --backup');
if (backup && existsSync(backup)) uso('o arquivo de backup já existe (não sobrescreve)');
const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (backup && resolve(backup).startsWith(`${RAIZ_REPO}/`)) uso('o backup tem de ficar fora do repositório');

let host;
try {
  host = new URL(url).hostname;
} catch {
  uso('RESET_DATABASE_URL inválida');
}
const local = ['localhost', '127.0.0.1', '::1'].includes(host);

const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  if (!local) {
    const esperado = process.env.RESET_EXPECTED_SYSTEM_IDENTIFIER;
    if (!esperado) uso('alvo remoto exige RESET_EXPECTED_SYSTEM_IDENTIFIER');
    const [{ sid }] = await prisma.$queryRaw`SELECT system_identifier::text AS sid FROM pg_control_system()`;
    if (sid !== esperado) {
      console.error('reset-rebanho-empresa-teste: system_identifier do alvo não confere; nada alterado');
      process.exit(3);
    }
  }
  const plano = await planejarReset(prisma, { clienteId, empresaId });
  console.log(JSON.stringify({ modo: executar ? 'EXECUCAO' : 'SIMULACAO', ...plano }, null, 2));
  if (executar) {
    const resumo = await executarReset(prisma, {
      clienteId,
      empresaId,
      confirmarEmpresaNome: confirmar,
      gravarBackup: (obj) => {
        writeFileSync(backup, `${JSON.stringify(obj, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        return conferirBackup(JSON.parse(readFileSync(backup, 'utf8')));
      },
    });
    console.log(JSON.stringify({ resultado: resumo.sem_alteracoes ? 'SEM_ALTERACOES' : 'RESET_APLICADO', ...resumo }, null, 2));
  }
} catch (e) {
  if (e instanceof ResetRecusado) {
    console.error(`reset-rebanho-empresa-teste: RECUSADO ${e.codigo} — ${e.message}; nada alterado`);
    if (e.detalhes && Object.keys(e.detalhes).length) console.error(JSON.stringify(e.detalhes, null, 2));
    process.exitCode = 3;
  } else {
    console.error(`reset-rebanho-empresa-teste: FALHA TÉCNICA (${e?.code ?? e?.name ?? 'erro'}); nada alterado`);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}

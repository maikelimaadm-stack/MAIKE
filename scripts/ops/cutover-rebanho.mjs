#!/usr/bin/env node
/**
 * PR174-R5 (D-PROD-107) — cutover de UMA empresa para o controle por posições
 * (escopo e estratégias em cutoverRebanhoLib.mjs). Ação OPERACIONAL única e
 * separada: nunca roda no build da Vercel, no startup da função nem em request.
 *
 * Inventário (SOMENTE LEITURA; funciona ANTES das migrations — informa CUTOVER_SCHEMA_PENDENTE):
 *   CUTOVER_DATABASE_URL='postgresql://…' node scripts/ops/cutover-rebanho.mjs --cliente-id <id> --inventario
 * Diagnóstico (padrão; SOMENTE LEITURA; exige schema R2E, senão CUTOVER_SCHEMA_PENDENTE exit 3):
 *   CUTOVER_DATABASE_URL='postgresql://…' node scripts/ops/cutover-rebanho.mjs --cliente-id <id> --empresa-id <id>
 * Execução (todas as travas):
 *   … --executar --estrategia entradas|reset_e_entradas|saldo_abertura \
 *     --confirmar-empresa "<nome exato>" --usuario-admin-id <id do administrador do cliente> \
 *     [--backup <arquivo.json>  (obrigatório em reset_e_entradas)] [--data-corte AAAA-MM-DD (saldo_abertura)]
 *
 * Segurança: lê só CUTOVER_DATABASE_URL (nunca DATABASE_URL de runtime) e não a
 * imprime. Se CUTOVER_EXPECTED_SYSTEM_IDENTIFIER estiver definido, ou se o alvo
 * não for local, o system_identifier do banco TEM de conferir (falha fechada).
 * PR174-R6/R7: alvo remoto + --executar exige --backend-url (= MAIKE_PRODUCAO_ORIGIN,
 * origin de produção configurado pelo operador) e --release-sha <40hex> = HEAD
 * atual da main REMOTA. O health (sem seguir redirect) tem de provar: produção,
 * repositório maikelimaadm-stack/MAIKE, domínio de produção = origin, release =
 * esse SHA e a capacidade do cutover. Senão, recusa ANTES de conectar ao banco.
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
const inventario = args.includes('--inventario');
if (!clienteId || (!empresaId && !inventario)) uso('--cliente-id e --empresa-id são obrigatórios (ou --cliente-id com --inventario)');
if (inventario && args.includes('--executar')) uso('--inventario é somente leitura');
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
if (!local && executar) {
  // PR174-R7: produção comprovada ANTES de abrir qualquer conexão de escrita.
  const backendUrl = valor('--backend-url');
  const releaseSha = valor('--release-sha');
  if (!backendUrl || !releaseSha) uso('alvo remoto + --executar exige --backend-url <origin de produção> e --release-sha <40hex>');
  const { validarOrigemProducao, conferirBackendNovo: conferir } = await import('./cutoverRebanhoLib.mjs');
  const origem = validarOrigemProducao({ informada: backendUrl, configurada: process.env.MAIKE_PRODUCAO_ORIGIN });
  if (!origem.ok) {
    console.error(`cutover-rebanho: RECUSADO ${origem.motivo} — defina MAIKE_PRODUCAO_ORIGIN (origin de produção do projeto Vercel) e use exatamente ele; nada alterado`);
    process.exit(3);
  }
  const { execFileSync } = await import('node:child_process');
  let mainRemota = null;
  try {
    const remoto = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (/maikelimaadm-stack\/MAIKE(\.git)?\s*$/i.test(remoto.trim())) {
      mainRemota = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\s+/)[0] || null;
    }
  } catch { /* remoto indisponível */ }
  let health = null;
  let httpStatus = 0;
  let redirecionou = false;
  try {
    const r = await fetch(`${origem.origin}/api/native/health`, { redirect: 'manual' });
    httpStatus = r.status;
    redirecionou = r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400);
    if (r.status === 200) health = await r.json();
  } catch { /* indisponível */ }
  const c = conferir({ health, httpStatus, redirecionou, releaseSha, mainRemota, hostProducao: origem.host });
  if (!c.ok) {
    console.error(`cutover-rebanho: RECUSADO ${c.motivo} — produção não está comprovadamente no backend novo da main atual; nada alterado`);
    process.exit(3);
  }
}

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
  if (inventario) {
    // PR174-R7: SOMENTE LEITURA, funciona antes das migrations (nenhuma tabela R2E é consultada).
    const { inventarioSchema } = await import('./cutoverRebanhoLib.mjs');
    const schema = await inventarioSchema(prisma);
    const empresas = await prisma.$queryRaw`SELECT e.id, e.nome,
        (SELECT COUNT(*)::int FROM "Lote" l WHERE l.cliente_id = e.cliente_id AND l.empresa_id = e.id) AS lotes,
        (SELECT COUNT(*)::int FROM "MovimentacaoMapa" m WHERE m.cliente_id = e.cliente_id AND m.empresa_id = e.id) AS movimentacoes
      FROM "Empresa" e WHERE e.cliente_id = ${clienteId} ORDER BY e.id`;
    console.log(JSON.stringify({ modo: 'INVENTARIO', resultado: schema.schema_r2e_pronto ? 'SCHEMA_R2E_PRONTO' : 'CUTOVER_SCHEMA_PENDENTE', ...schema, empresas }, null, 2));
    process.exitCode = 0;
  } else {
    console.log(JSON.stringify({ modo: executar ? 'EXECUCAO' : 'DIAGNOSTICO', ...(await diagnosticarEmpresa(prisma, { clienteId, empresaId })) }, null, 2));
  }
  if (executar && !inventario) {
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

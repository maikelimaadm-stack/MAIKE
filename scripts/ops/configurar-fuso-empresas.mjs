#!/usr/bin/env node
/**
 * PR190-R2 (D-PROD-122) — configuração ONE-SHOT do fuso das fazendas ANTES do
 * deploy do runtime novo (a tela e a rota PUT só existem depois dele).
 *
 * Uso:
 *   FUSO_DATABASE_URL=… [FUSO_EXPECTED_SYSTEM_IDENTIFIER=…] \
 *     node scripts/ops/configurar-fuso-empresas.mjs --plano plano.json             (simulação, padrão)
 *   … --plano plano.json --aplicar --confirmar APLICAR_FUSOS_DAS_FAZENDAS \
 *     [--referencia-backup "<id/horário do backup restaurável conferido>"]
 *
 * plano.json (preenchido e revisado pelo proprietário; nada é inferido):
 *   { "administradores": { "<cliente_id>": "<usuario_id administrador ativo>" },
 *     "empresas": [ { "cliente_id": "…", "empresa_id": "…", "fuso_horario": "America/Cuiaba", "motivo": "opcional; obrigatório para TROCAR um fuso já configurado" } ] }
 *
 * Barreiras (fail-closed; exit 3 = recusado, nada gravado):
 *  - alvo remoto exige FUSO_EXPECTED_SYSTEM_IDENTIFIER, conferido ANTES de qualquer leitura de negócio;
 *  - --aplicar exige a frase de confirmação; em alvo remoto exige --referencia-backup e plano FORA do repositório;
 *  - schema da release pronto (migration com checksum do manifesto + coluna); senão recusa;
 *  - empresa do cliente informado, administrador ativo do mesmo cliente, IANA válido, sem duplicatas;
 *  - troca de fuso existente só com motivo; fuso igual = sem mudança;
 *  - uma transação: Empresa FOR UPDATE, UPDATE + AuditLog por mudança; qualquer recusa → ROLLBACK total.
 * Nunca imprime URL, host, usuário ou senha.
 * Saída: 0 executado | 1 falha técnica | 2 uso | 3 recusado.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const valor = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const uso = (m) => {
  console.error(`configurar-fuso-empresas: ${m}`);
  process.exit(2);
};
const recusar = (codigo, motivo, detalhes) => {
  console.error(`configurar-fuso-empresas: RECUSADO ${codigo} — ${motivo}; nada gravado`);
  if (detalhes) console.error(JSON.stringify(detalhes, null, 2));
  process.exit(3);
};

const conhecidos = new Set(['--plano', '--aplicar', '--confirmar', '--referencia-backup']);
for (let i = 0; i < args.length; i += 1) {
  if (!conhecidos.has(args[i])) uso(`argumento desconhecido: ${args[i]}`);
  if (['--plano', '--confirmar', '--referencia-backup'].includes(args[i])) i += 1;
}
const url = process.env.FUSO_DATABASE_URL;
if (!url) uso('FUSO_DATABASE_URL ausente');
const caminhoPlano = valor('--plano');
if (!caminhoPlano) uso('--plano <arquivo.json> é obrigatório');
const aplicar = args.includes('--aplicar');

let host;
try {
  host = new URL(url).hostname.replace(/^\[|\]$/g, '');
} catch {
  uso('FUSO_DATABASE_URL inválida');
}
const local = ['localhost', '127.0.0.1', '::1'].includes(host);
const esperadoSid = process.env.FUSO_EXPECTED_SYSTEM_IDENTIFIER;
const referenciaBackup = valor('--referencia-backup') ?? null;

const { validarBarreirasCli, planejarFusos, aplicarPlanoFusos, FusoReleaseRecusado } = await import('./fusoReleaseLib.mjs');
const barreiras = validarBarreirasCli({ local, esperadoSid, aplicar, confirmacao: valor('--confirmar'), referenciaBackup });
if (!barreiras.ok) recusar(barreiras.codigo, barreiras.motivo);
const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!local && resolve(caminhoPlano).startsWith(`${RAIZ_REPO}/`)) recusar('PLANO_DENTRO_DO_REPO', 'o plano de produção fica fora do repositório (não versionar ids reais)');

let plano;
try {
  plano = JSON.parse(readFileSync(caminhoPlano, 'utf8'));
} catch (e) {
  uso(`plano ilegível (${e instanceof SyntaxError ? 'JSON inválido' : e?.code ?? 'erro'})`);
}

const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  if (!local || esperadoSid) {
    const [{ sid }] = /** @type {Array<{sid: string}>} */ (await prisma.$queryRaw`SELECT system_identifier::text AS sid FROM pg_control_system()`);
    if (sid !== String(esperadoSid)) recusar('ALVO_DIVERGENTE', 'system_identifier do alvo não confere com FUSO_EXPECTED_SYSTEM_IDENTIFIER');
  }
  const simulacao = await planejarFusos(prisma, plano);
  console.log(JSON.stringify({ modo: 'SIMULACAO', ...simulacao }, null, 2));
  if (simulacao.recusas) recusar('PLANO_COM_RECUSAS', 'corrija o plano (ver itens recusados acima)');
  if (aplicar) {
    const r = await aplicarPlanoFusos(prisma, plano, { referenciaBackup });
    console.log(JSON.stringify({ modo: 'APLICADO', ...r }, null, 2));
  } else {
    console.error('configurar-fuso-empresas: simulação apenas (nada gravado). Para aplicar: --aplicar --confirmar APLICAR_FUSOS_DAS_FAZENDAS');
  }
} catch (e) {
  if (e instanceof FusoReleaseRecusado) recusar(e.codigo, e.message, e.detalhes);
  console.error(`configurar-fuso-empresas: FALHA TÉCNICA (${e?.code ?? e?.name ?? 'erro'})`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

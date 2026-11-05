#!/usr/bin/env node
/**
 * D-PROD-122 (S1/H1) — inventário READ-ONLY de fatos futuros do rebanho.
 *
 * Uso (só banco LOCAL descartável):
 *   node scripts/ops/inventario-futuros-rebanho.mjs [--saida relatorio.json] [--mostrar-ids]
 *
 * O alvo é o MESMO do runtime: POSTGRES_PRISMA_URL ?? DATABASE_URL ?? POSTGRES_URL
 * (backend/src/config/env.js). Antes de abrir a transação o script recusa:
 *  - host que não seja localhost/127.0.0.1/::1;
 *  - nome de banco contendo "prod" ou "supabase";
 *  - servidor com papéis de Supabase (supabase_admin / supabase_auth_admin).
 * Banco remoto (inclusive produção) exige AUTORIZAÇÃO SEPARADA do proprietário
 * e mudança deliberada deste script; não há flag para contornar.
 * A URL nunca é impressa. Nada é escrito no banco (transação READ ONLY).
 *
 * Saída (exit code): 0 executado | 1 falha técnica | 2 uso incorreto | 3 alvo recusado
 */

import { writeFileSync } from 'node:fs';

import { PrismaClient } from '@prisma/client';

import { inventariarFuturosRebanho } from './inventarioFuturosRebanhoLib.mjs';

const USO = 'uso: node scripts/ops/inventario-futuros-rebanho.mjs [--saida relatorio.json] [--mostrar-ids]';
const args = process.argv.slice(2);
const conhecidos = new Set(['--saida', '--mostrar-ids']);
for (let i = 0; i < args.length; i += 1) {
  if (!conhecidos.has(args[i])) {
    console.error(USO);
    process.exit(2);
  }
  if (args[i] === '--saida') i += 1;
}
const iSaida = args.indexOf('--saida');
const saida = iSaida >= 0 ? args[iSaida + 1] : undefined;
if (iSaida >= 0 && (!saida || saida.startsWith('--'))) {
  console.error(USO);
  process.exit(2);
}

const texto = (nome) => (typeof process.env[nome] === 'string' && process.env[nome].trim() ? process.env[nome].trim() : null);
const url = texto('POSTGRES_PRISMA_URL') ?? texto('DATABASE_URL') ?? texto('POSTGRES_URL');
const recusar = (motivo) => {
  console.error(`inventario-futuros-rebanho — ALVO RECUSADO (${motivo}). Só banco local descartável; remoto exige autorização separada.`);
  process.exit(3);
};
if (!url) recusar('nenhuma URL de banco no ambiente');
let alvo;
try {
  alvo = new URL(url);
} catch {
  recusar('URL ilegível');
}
const host = alvo.hostname.replace(/^\[|\]$/g, '');
if (!['localhost', '127.0.0.1', '::1'].includes(host)) recusar('host não local');
const banco = decodeURIComponent(alvo.pathname.replace(/^\//, ''));
if (/prod|supabase/i.test(banco)) recusar('nome de banco suspeito');

const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const papeis = /** @type {Array<{n: number}>} */ (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('supabase_admin', 'supabase_auth_admin')`));
  if (papeis[0]?.n) recusar('servidor com papéis de Supabase');
  const relatorio = await inventariarFuturosRebanho(prisma, { mostrarIds: args.includes('--mostrar-ids') });
  const json = `${JSON.stringify(relatorio, null, 2)}\n`;
  if (saida) writeFileSync(saida, json);
  else process.stdout.write(json);
  console.error(`inventario-futuros-rebanho — OK: ${relatorio.resumo.empresas_ativadas} empresa(s) ativada(s), ${relatorio.resumo.eventos_futuros} evento(s) futuro(s), ${relatorio.resumo.posicoes_divergentes} posição(ões) divergente(s), ${relatorio.resumo.empresas_sem_fuso} sem fuso.`);
} catch (e) {
  // Nunca ecoa URL nem dados: só a classe do erro.
  console.error(`inventario-futuros-rebanho — FALHA TÉCNICA (${e?.code ?? e?.name ?? 'erro'})`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

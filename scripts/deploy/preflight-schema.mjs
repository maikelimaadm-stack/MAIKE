#!/usr/bin/env node
/**
 * Preflight de schema (PR145-R5) — SÓ LEITURA. Ver `preflightSchemaLib.mjs`.
 *
 * Uso (conexão direta ou de sessão do ambiente; nada é gravado):
 *   DATABASE_URL=… node scripts/deploy/preflight-schema.mjs
 *   DATABASE_URL=… node scripts/deploy/preflight-schema.mjs --exigir-admin-por-cliente
 *
 * Saída: 0 = schema pronto para o código desta branch; 1 = NÃO publique;
 * 2 = não foi possível consultar. Nunca imprime URL, host, login ou e-mail.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONSULTAS, TABELAS_PROTEGIDAS, avaliarPreflight } from './preflightSchemaLib.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pastas = readdirSync(join(raiz, 'backend', 'prisma', 'migrations'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{14}_/.test(d.name))
  .map((d) => d.name)
  .sort();

const { env } = await import('../../backend/src/config/env.js');
if (!env.databaseUrl) {
  console.error('preflight-schema: DATABASE_URL ausente');
  process.exit(2);
}
const { getPrismaClient, closePrismaClient } = await import('../../backend/src/database/prismaClient.js');
const db = getPrismaClient();

let codigo = 2;
try {
  const migrations = await db.$queryRawUnsafe(CONSULTAS.migrations);
  const colunas = await db.$queryRawUnsafe(CONSULTAS.colunas);
  const tabelas = await db.$queryRawUnsafe(CONSULTAS.tabelas, TABELAS_PROTEGIDAS);
  const grants = await db.$queryRawUnsafe(CONSULTAS.grants, TABELAS_PROTEGIDAS);
  const temPapel = /** @type {any[]} */ (colunas).some((c) => c.table_name === 'Usuario');
  const papeis = temPapel ? (/** @type {any[]} */ (await db.$queryRawUnsafe(CONSULTAS.papeis)))[0] : null;
  const r = avaliarPreflight({
    pastas,
    migrations: /** @type {any} */ (migrations),
    colunas: /** @type {any} */ (colunas),
    tabelas: /** @type {any} */ (tabelas),
    grants: /** @type {any} */ (grants),
    papeis,
    exigirAdminPorCliente: process.argv.includes('--exigir-admin-por-cliente'),
  });
  console.log(`migrations: ${r.resumo.migrations_aplicadas}/${r.resumo.migrations_no_repositorio} aplicadas`);
  if (papeis) {
    console.log(
      `papéis: ${papeis.clientes_com_usuario_ativo} cliente(s) com usuário ativo, ` +
        `${papeis.administradores_ativos} administrador(es) da fazenda, ${papeis.clientes_sem_administrador} cliente(s) sem administrador`
    );
  }
  for (const f of r.falhas) console.log(`FALHA ${f}`);
  for (const a of r.avisos) console.log(`AVISO ${a}`);
  console.log(r.ok ? 'PREFLIGHT OK: o schema atende o código desta branch.' : 'PREFLIGHT FALHOU: NÃO publique este código neste banco.');
  codigo = r.ok ? 0 : 1;
} catch (erro) {
  console.error(`preflight-schema: consulta falhou (${/** @type {any} */ (erro)?.code ?? 'erro'})`);
} finally {
  await closePrismaClient();
}
process.exit(codigo);

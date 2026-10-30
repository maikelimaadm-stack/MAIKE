/**
 * Identidade do banco-alvo em DUAS conexões (PR145-G4-R1, D-PROD-73).
 *
 * O runtime resolve a conexão por `POSTGRES_PRISMA_URL > DATABASE_URL >
 * POSTGRES_URL` (backend/src/config/env.js); o `deploy:migrate` usa SÓ
 * `MIGRATION_DATABASE_URL`. Conferir uma e migrar com a outra abriria a porta
 * para aprovar o banco A e migrar o B. Esta barreira lê as duas e só aceita se
 * forem o MESMO banco lógico:
 *  - `system_identifier` do cluster (e igual ao esperado);
 *  - `current_database()` e o OID desse banco no cluster (bancos lógicos
 *    diferentes no mesmo cluster têm OIDs diferentes);
 *  - `public._prisma_migrations` presente e a mesma assinatura do histórico.
 * URLs nunca são comparadas como texto (pooler e sessão diferem e apontam ao
 * mesmo banco) e nunca são impressas; erro de conexão vira só o código.
 */

import { createHash } from 'node:crypto';

export const CONSULTA_IDENTIDADE = `SELECT system_identifier::text AS sid, current_database() AS banco,
  (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS banco_oid,
  to_regclass('public._prisma_migrations') IS NOT NULL AS tem_historico
  FROM pg_control_system()`;

export const CONSULTA_HISTORICO = `SELECT migration_name, checksum, finished_at, rolled_back_at
  FROM public."_prisma_migrations" ORDER BY migration_name, started_at`;

/** Assinatura estável do histórico (nomes, checksums, conclusão), sem dado de negócio. */
export const assinaturaHistorico = (linhas) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        linhas.map((l) => [
          l.migration_name,
          l.checksum,
          l.finished_at ? new Date(l.finished_at).toISOString() : null,
          l.rolled_back_at ? new Date(l.rolled_back_at).toISOString() : null,
        ])
      )
    )
    .digest('hex')
    .slice(0, 16);

/**
 * Lê a identidade de UMA conexão. `executar(url, sql)` devolve linhas.
 * @returns {Promise<{ok: true, sid: string, banco: string, banco_oid: string, tem_historico: boolean, historico: string|null, migrations: number} | {ok: false, erro: string}>}
 */
export const lerIdentidade = async (url, executar) => {
  if (!url) return { ok: false, erro: 'conexão ausente' };
  try {
    const [id] = await executar(url, CONSULTA_IDENTIDADE);
    const linhas = id.tem_historico ? await executar(url, CONSULTA_HISTORICO) : [];
    return {
      ok: true,
      sid: String(id.sid),
      banco: String(id.banco),
      banco_oid: String(id.banco_oid),
      tem_historico: Boolean(id.tem_historico),
      historico: id.tem_historico ? assinaturaHistorico(linhas) : null,
      migrations: linhas.length,
    };
  } catch (erro) {
    // Mensagem do driver pode conter host/usuário: só o código sai daqui.
    return { ok: false, erro: `sem acesso (${/** @type {any} */ (erro)?.code ?? /** @type {any} */ (erro)?.errorCode ?? 'erro'})` };
  }
};

/**
 * Veredito puro sobre as duas identidades.
 * @param {{ esperadoSid: string, runtime: any, migracao: any }} e
 */
export const compararAlvos = ({ esperadoSid, runtime, migracao }) => {
  const falhas = [];
  if (!/^\d{6,25}$/.test(String(esperadoSid ?? ''))) falhas.push('identificador esperado ausente ou inválido');
  for (const [nome, id] of [['runtime', runtime], ['migration', migracao]]) {
    if (!id?.ok) {
      falhas.push(`${nome}: ${id?.erro ?? 'não lida'}`);
      continue;
    }
    if (id.sid !== String(esperadoSid)) falhas.push(`${nome}: system_identifier difere do esperado`);
    if (!id.tem_historico) falhas.push(`${nome}: public._prisma_migrations ausente (banco errado ou vazio)`);
  }
  if (runtime?.ok && migracao?.ok) {
    if (runtime.sid !== migracao.sid) falhas.push('runtime e migration estão em clusters diferentes');
    if (runtime.banco !== migracao.banco) falhas.push('runtime e migration: current_database difere');
    if (runtime.banco_oid !== migracao.banco_oid) falhas.push('runtime e migration: OID do banco difere (outro banco lógico)');
    if (runtime.historico !== migracao.historico) falhas.push('runtime e migration: histórico de migrations difere');
  }
  const resumo = runtime?.ok
    ? `banco=${runtime.banco} migrations=${runtime.migrations} historico=${runtime.historico ?? '-'}`
    : 'indisponível';
  return { ok: falhas.length === 0, falhas, resumo };
};

/** Executor real: um PrismaClient efêmero por URL (lazy, para os testes não exigirem banco). */
export const executorPrisma = async (url, sql) => {
  const { PrismaClient } = await import('@prisma/client');
  const cliente = new PrismaClient({ datasourceUrl: url });
  try {
    return await cliente.$queryRawUnsafe(sql);
  } finally {
    await cliente.$disconnect();
  }
};

/**
 * Lê as duas conexões e decide. `urlRuntime` deve ser a resolvida pelo env.js.
 * @param {{ esperadoSid: string, urlRuntime?: string|null, urlMigracao?: string|null, executar?: typeof executorPrisma }} e
 */
export const conferirAlvos = async ({ esperadoSid, urlRuntime, urlMigracao, executar = executorPrisma }) => {
  const runtime = await lerIdentidade(urlRuntime, executar);
  const migracao = await lerIdentidade(urlMigracao, executar);
  return compararAlvos({ esperadoSid, runtime, migracao });
};

/**
 * Escopo de dados e exclusão mútua do benchmark de usuários (SCALE-01 R3).
 *
 * Escopo: cada execução tem um id único; os tenants sintéticos que ela cria
 * usam o prefixo `perf-scale01-<id>-` e seus ids exatos ficam registrados.
 * A limpeza automática apaga SOMENTE esses ids — e ainda exige o prefixo da
 * execução, como segunda trava. Tenants de outras execuções, de execuções
 * interrompidas ou criados à mão com `perf-scale01-` nunca são tocados
 * automaticamente (recuperação manual documentada no relatório).
 *
 * Exclusão mútua: `pg_try_advisory_lock` numa conexão DEDICADA
 * (`connection_limit=1`), mantida aberta durante toda a execução. O lock é
 * por banco, vale entre processos e é liberado pelo servidor se o processo
 * morrer (a sessão cai). Uma segunda execução no mesmo banco falha antes de
 * qualquer DDL ou inserção.
 */

import { randomUUID } from 'node:crypto';

export const PREFIXO_BASE = 'perf-scale01-';

/** Chave fixa do advisory lock deste benchmark (bigint, arbitrária e estável). */
export const CHAVE_LOCK = 710120260129n;

export const novoIdExecucao = () => randomUUID().replace(/-/g, '').slice(0, 16);

/** @param {string} idExecucao */
export const prefixoDaExecucao = (idExecucao) => {
  if (!/^[0-9a-f]{16}$/.test(idExecucao)) throw new Error('id de execução inválido');
  return `${PREFIXO_BASE}${idExecucao}-`;
};

/**
 * Apaga AuditLog/Usuario/Cliente apenas dos clientes indicados que também
 * pertencem ao prefixo desta execução. Nunca seleciona por prefixo genérico.
 *
 * @param {any} prisma
 * @param {{ prefixo: string, clienteIds: Iterable<string> }} escopo
 * @returns {Promise<{ clientes: number, usuarios: number, auditLogs: number }>}
 */
export const limparClientesDaExecucao = async (prisma, { prefixo, clienteIds }) => {
  const pedidos = [...clienteIds];
  if (!prefixo.startsWith(PREFIXO_BASE) || prefixo === PREFIXO_BASE) {
    throw new Error('prefixo de execução obrigatório (o genérico não serve)');
  }
  if (pedidos.length === 0) return { clientes: 0, usuarios: 0, auditLogs: 0 };
  const alvos = (
    await prisma.cliente.findMany({
      where: { id: { in: pedidos }, codigo: { startsWith: prefixo } },
      select: { id: true },
    })
  ).map((c) => c.id);
  if (alvos.length === 0) return { clientes: 0, usuarios: 0, auditLogs: 0 };
  const auditLogs = await prisma.auditLog.deleteMany({ where: { cliente_id: { in: alvos } } });
  const usuarios = await prisma.usuario.deleteMany({ where: { cliente_id: { in: alvos } } });
  const clientes = await prisma.cliente.deleteMany({ where: { id: { in: alvos } } });
  return { clientes: clientes.count, usuarios: usuarios.count, auditLogs: auditLogs.count };
};

/** URL com pool de uma conexão — o lock de sessão precisa ficar nela. */
const urlConexaoUnica = (url) => {
  const u = new URL(url);
  u.searchParams.set('connection_limit', '1');
  return u.toString();
};

/**
 * Tenta adquirir o lock exclusivo do benchmark neste banco.
 *
 * @param {string} url URL já aprovada pelo benchGuard
 * @returns {Promise<{ ok: true, liberar: () => Promise<void> } | { ok: false }>}
 */
export const adquirirLockBench = async (url) => {
  const { PrismaClient } = await import('@prisma/client');
  const conexao = new PrismaClient({ datasources: { db: { url: urlConexaoUnica(url) } }, log: ['error'] });
  const [linha] = /** @type {{ ok: boolean }[]} */ (
    await conexao.$queryRawUnsafe('SELECT pg_try_advisory_lock($1::bigint) AS ok', CHAVE_LOCK.toString())
  );
  if (!linha?.ok) {
    await conexao.$disconnect();
    return { ok: false };
  }
  let liberado = false;
  return {
    ok: true,
    liberar: async () => {
      if (liberado) return;
      liberado = true;
      try {
        await conexao.$queryRawUnsafe('SELECT pg_advisory_unlock($1::bigint)', CHAVE_LOCK.toString());
      } finally {
        await conexao.$disconnect();
      }
    },
  };
};

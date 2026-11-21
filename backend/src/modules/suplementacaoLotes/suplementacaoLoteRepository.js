/**
 * Repositório de SuplementacaoLote (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { opcoesTakeDeFiltros } from '../../shared/http/listQueryLimit.js';

/**
 * D-PROD-268 — a listagem (GET) omite os documentos CANCELADOS (`dados.situacao = 'cancelado'`):
 * último evento do cocho, sobra herdada, nível, alertas, rateio e históricos ignoram o
 * cancelado num só ponto. O documento continua no banco (sem exclusão física) e na auditoria.
 * SQL próprio porque o filtro JSON do Prisma com NOT descartaria também quem não tem a chave.
 */
export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const empresa = typeof filtros.empresa_id === 'string' && filtros.empresa_id ? filtros.empresa_id : null;
  const take = opcoesTakeDeFiltros(filtros).take ?? null;
  return /** @type {Promise<Array<Record<string, any>>>} */ (prisma.$queryRaw`SELECT id, cliente_id, empresa_id, dados, "createdAt", "updatedAt" FROM "SuplementacaoLote"
    WHERE cliente_id = ${clienteId}
      AND (${empresa}::text IS NULL OR empresa_id = ${empresa})
      AND COALESCE(dados->>'situacao', '') <> 'cancelado'
    ORDER BY "createdAt" DESC, id DESC
    LIMIT ${take}`);
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.suplementacaoLote.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.suplementacaoLote.create({ data: dados });

export const inserirRegistros = async (tx, lista) =>
  tx.suplementacaoLote.createMany({ data: lista });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.suplementacaoLote.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.suplementacaoLote.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });

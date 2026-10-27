/**
 * Reserva de `numero_empresa` via EntidadeCodigoSequencia (tenant-scoped).
 */
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';

const ENTIDADE_SEQUENCIA = 'Empresa';

/**
 * Bootstrap único: se a linha de sequência acabou de ser criada, alinha
 * `proximo_valor` ao maior número já migrado + 1 (nunca recalcula se a linha já existia).
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @returns {Promise<number>}
 */
export const reservarNumeroEmpresa = async (tx, clienteId) => {
  const escopoId = clienteId;
  const created = await tx.entidadeCodigoSequencia.createMany({
    data: [
      {
        cliente_id: clienteId,
        entidade: ENTIDADE_SEQUENCIA,
        escopo_tipo: ESCOPO_TENANT,
        escopo_id: escopoId,
        proximo_valor: 1,
      },
    ],
    skipDuplicates: true,
  });

  if (created.count === 1) {
    const agg = await tx.empresa.aggregate({
      where: { cliente_id: clienteId },
      _max: { numero_empresa: true },
    });
    const maxNum = agg._max.numero_empresa ?? 0;
    if (maxNum > 0) {
      await tx.entidadeCodigoSequencia.update({
        where: {
          cliente_id_entidade_escopo_tipo_escopo_id: {
            cliente_id: clienteId,
            entidade: ENTIDADE_SEQUENCIA,
            escopo_tipo: ESCOPO_TENANT,
            escopo_id: escopoId,
          },
        },
        data: { proximo_valor: maxNum + 1 },
      });
    }
  }

  return reservarNumero(tx, {
    clienteId,
    entidade: ENTIDADE_SEQUENCIA,
    escopoTipo: ESCOPO_TENANT,
  });
};

import { concurrencyConflict } from '../../shared/errors/AppError.js';

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number | null | undefined} revisaoEsperada
 * @returns {Promise<number>} revisão atual do catálogo global
 */
export const assertRevisaoCatalogo = async (tx, revisaoEsperada) => {
  const meta = await tx.catalogoMeta.findUnique({ where: { chave: 'global' } });
  const atual = meta?.revisao ?? 0;
  if (revisaoEsperada != null && atual !== revisaoEsperada) {
    throw concurrencyConflict('revisão do catálogo divergente', {
      details: { revisao_atual: atual, revisao_esperada: revisaoEsperada },
    });
  }
  return atual;
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export const incrementarRevisaoCatalogo = async (tx) =>
  tx.catalogoMeta.upsert({
    where: { chave: 'global' },
    create: { chave: 'global', revisao: 1 },
    update: { revisao: { increment: 1 } },
  });

/**
 * Incrementa a revisão e confirma que nenhuma outra transação avançou desde a
 * leitura (CAS sob o lock de linha do UPDATE). Sem isso, duas mutações
 * concorrentes que leram a mesma revisão commitariam ambas.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number} revisaoLida revisão obtida por `assertRevisaoCatalogo`
 */
export const avancarRevisaoCatalogo = async (tx, revisaoLida) => {
  const meta = await incrementarRevisaoCatalogo(tx);
  if (meta.revisao !== revisaoLida + 1) {
    throw concurrencyConflict('revisão do catálogo divergente', {
      details: { revisao_atual: meta.revisao - 1, revisao_esperada: revisaoLida },
    });
  }
  return meta;
};

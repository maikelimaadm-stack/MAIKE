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
 * Contrato único de CAS do catálogo (R3), usado pelas dez mutações.
 *
 * Incrementa a revisão global exatamente uma vez. O UPDATE trava a linha de
 * `CatalogoMeta` e, em READ COMMITTED, reavalia sobre a última versão
 * commitada — então o valor devolvido reflete toda escrita concorrente já
 * confirmada. Com `revisaoEsperada` informada, qualquer valor diferente de
 * `revisaoEsperada + 1` é corrida perdida: 409 e rollback da transação.
 *
 * `revisaoEsperada` omitida (null/undefined) mantém o contrato HTTP antigo:
 * sem CAS, última escrita vence, revisão ainda incrementa uma vez.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {number | null | undefined} revisaoEsperada
 */
export const avancarRevisaoCatalogo = async (tx, revisaoEsperada) => {
  let meta;
  try {
    meta = await incrementarRevisaoCatalogo(tx);
  } catch (erro) {
    // Primeira escrita concorrente com a linha ainda inexistente.
    if (erro?.code === 'P2002') {
      throw concurrencyConflict('revisão do catálogo divergente', {
        details: { revisao_atual: null, revisao_esperada: revisaoEsperada ?? null },
      });
    }
    throw erro;
  }
  if (revisaoEsperada != null && meta.revisao !== revisaoEsperada + 1) {
    throw concurrencyConflict('revisão do catálogo divergente', {
      details: { revisao_atual: meta.revisao - 1, revisao_esperada: revisaoEsperada },
    });
  }
  return meta;
};

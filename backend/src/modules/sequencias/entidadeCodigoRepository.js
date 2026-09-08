/**
 * Repositório da sequência de códigos.
 *
 * A reserva é um único `UPDATE … RETURNING` dentro da transação de quem chama.
 * Não existe `SELECT MAX`, não existe `COUNT(*)`, e não existe leitura seguida
 * de escrita — o incremento e a leitura do valor atribuído são a mesma
 * operação, e é isso que dá atomicidade sob concorrência.
 *
 * O `INSERT … ON CONFLICT DO NOTHING` antes dele cria a linha na primeira vez
 * sem corrida: duas requisições simultâneas para uma sequência inexistente
 * fazem uma inserir e a outra não fazer nada, e as duas seguem para o UPDATE.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * Garante que a linha da sequência existe.
 *
 * `createMany` com `skipDuplicates` compila para
 * `INSERT … ON CONFLICT DO NOTHING`: mantém a criação livre de corrida — duas
 * requisições simultâneas para uma sequência inexistente fazem uma inserir e a
 * outra não fazer nada, e as duas seguem para o UPDATE — **e** deixa a chave
 * primária com o gerador do Prisma.
 *
 * A versão anterior montava o `INSERT` em SQL cru com
 * `replace(gen_random_uuid()::text, '-', '')` no lugar do `id`. O schema
 * declarava `@default(cuid())` e o runtime produzia outra coisa: o contrato de
 * identidade valia no papel e não na linha gravada. `gate:tenancy` lia o schema,
 * via `cuid()` e aprovava — a mesma classe de defeito da P2-R1, agora entre
 * schema e runtime em vez de entre contrato e gate.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{clienteId: string, entidade: string, escopoTipo: string, escopoId: string}} chave
 */
export const garantirLinhaDaSequencia = async (tx, { clienteId, entidade, escopoTipo, escopoId }) => {
  await tx.entidadeCodigoSequencia.createMany({
    data: [
      {
        // `id` é deliberadamente omitido: quem o produz é o @default(cuid()).
        cliente_id: clienteId,
        entidade,
        escopo_tipo: escopoTipo,
        escopo_id: escopoId,
        proximo_valor: 1,
      },
    ],
    skipDuplicates: true,
  });
};

/**
 * Reserva o próximo número, atomicamente.
 *
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {{clienteId: string, entidade: string, escopoTipo: string, escopoId: string}} chave
 * @returns {Promise<number|null>} número atribuído, ou null se a linha sumiu
 */
export const reservarProximoValor = async (tx, { clienteId, entidade, escopoTipo, escopoId }) => {
  const linhas = await tx.$queryRaw`
    UPDATE "EntidadeCodigoSequencia"
       SET "proximo_valor" = "proximo_valor" + 1,
           "updatedAt" = NOW()
     WHERE "cliente_id" = ${clienteId}
       AND "entidade" = ${entidade}
       AND "escopo_tipo" = ${escopoTipo}
       AND "escopo_id" = ${escopoId}
    RETURNING ("proximo_valor" - 1) AS atribuido
  `;

  const atribuido = Number(linhas?.[0]?.atribuido);
  return Number.isFinite(atribuido) && atribuido > 0 ? atribuido : null;
};

/**
 * Leitura da sequência, para inspeção e teste. Tenant-scoped.
 * @param {{clienteId: string, entidade: string, escopoTipo: string, escopoId: string}} chave
 */
export const lerSequencia = async ({ clienteId, entidade, escopoTipo, escopoId }) => {
  const prisma = getPrismaClient();
  return prisma.entidadeCodigoSequencia.findUnique({
    where: {
      cliente_id_entidade_escopo_tipo_escopo_id: {
        cliente_id: clienteId,
        entidade,
        escopo_tipo: escopoTipo,
        escopo_id: escopoId,
      },
    },
  });
};

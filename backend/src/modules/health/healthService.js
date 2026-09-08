/**
 * Health check.
 *
 * Distingue duas coisas que costumam ser confundidas num só booleano:
 *
 *   processo vivo        o Fastify respondeu — sempre verdadeiro se você leu isto
 *   dependência pronta   o PostgreSQL respondeu a uma query trivial
 *
 * Um health que devolve 200 só por o processo estar de pé mente para o
 * orquestrador; um que devolve 503 quando o banco pisca derruba o serviço
 * inteiro por nada. Por isso os dois estados aparecem separados no corpo, e o
 * status HTTP reflete a dependência.
 *
 * A resposta nunca carrega stack trace nem string de conexão.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { variaveisObrigatoriasAusentes } from '../../config/env.js';

/**
 * @returns {Promise<{status: 'ok'|'degraded', processo: 'up', banco: 'up'|'down',
 *                    configuracaoIncompleta: string[]}>}
 */
export const verificarSaude = async () => {
  const configuracaoIncompleta = variaveisObrigatoriasAusentes();

  /** @type {'up' | 'down'} */
  let banco = 'down';
  try {
    const prisma = getPrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    banco = 'up';
  } catch {
    // A causa vai para o log do handler de erro, não para o corpo da resposta.
    banco = 'down';
  }

  return {
    status: banco === 'up' && configuracaoIncompleta.length === 0 ? 'ok' : 'degraded',
    processo: 'up',
    banco,
    configuracaoIncompleta,
  };
};

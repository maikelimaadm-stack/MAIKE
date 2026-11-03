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
 * PR174-R6: `release` (SHA do commit publicado, variável de sistema da Vercel;
 * público, não é segredo) e `capacidades` deixam o cutover provar que o
 * backend em produção já é o novo (o antigo não expõe a capacidade).
 * @returns {Promise<{status: 'ok'|'degraded', processo: 'up', banco: 'up'|'down',
 *                    configuracaoIncompleta: string[], release: string|null, capacidades: string[], implantacao: {ambiente: string|null, repositorio: string|null, dominio_producao: string|null}}>}
 */
export const CAPACIDADE_CUTOVER = 'rebanho-ledger-cutover-r6';
const SEGURO = /^[A-Za-z0-9._/-]{1,200}$/;
const seguro = (v) => (typeof v === 'string' && SEGURO.test(v) ? v : null);
export const identidadeDaImplantacao = (env = process.env) => ({
  ambiente: ['production', 'preview', 'development'].includes(env.VERCEL_ENV ?? '') ? env.VERCEL_ENV : null,
  repositorio: env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? seguro(`${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`) : null,
  dominio_producao: seguro(env.VERCEL_PROJECT_PRODUCTION_URL ?? '') ? (env.VERCEL_PROJECT_PRODUCTION_URL ?? '').toLowerCase() : null,
});
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
    release: /^[0-9a-f]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '') ? process.env.VERCEL_GIT_COMMIT_SHA : null,
    capacidades: [CAPACIDADE_CUTOVER],
    // PR174-R7: identidade do deploy (variáveis de SISTEMA da Vercel, públicas): ambiente,
    // repositório de origem e domínio de produção do projeto — o cutover exige as três.
    implantacao: identidadeDaImplantacao(),
  };
};

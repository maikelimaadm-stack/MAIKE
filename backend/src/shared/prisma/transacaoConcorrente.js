/**
 * Transação com espera longa e tradução da corrida perdida (D-PROD-154, §8.4).
 *
 * Extraído de `operacaoFinanceiraService.js` — o comportamento dos comandos da
 * Central Única de Lançamentos não muda — para os comandos antigos que disputam
 * as MESMAS travas que confirmar/cancelar seguram por até 30 s (trava do
 * produto, sequência de movimentos do tenant, linha do perfil financeiro):
 * suplementação, transferência, POST de movimento, PATCH de produto, PATCH e
 * DELETE de lote e PUT do perfil. Com o timeout padrão do Prisma (5 s) eles
 * respondiam 500 enquanto esperavam essas travas.
 *
 *  - P2028 (timeout da transação), P2034 (deadlock/serialização em operação
 *    de modelo) e P2010 com 40P01/40001 (o mesmo em SQL bruto) → 409
 *    `CONCURRENCY_CONFLICT`: a transação inteira voltou, nada foi gravado;
 *  - P2002 cujo alvo contém um trecho de `unicos` → o erro de negócio dado (a
 *    unique do banco é a rede da corrida);
 *  - `AppError` e qualquer outro erro seguem intactos.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { AppError } from '../errors/AppError.js';

/** Espera longa: a mesma das transações de efeito (confirmar/cancelar, §8.4). */
export const TRANSACAO_LONGA = Object.freeze({ maxWait: 10000, timeout: 30000 });

/** 409 de comando idempotente por `operation_id`: repetir com a MESMA chave é seguro. */
export const MENSAGEM_CONFLITO_IDEMPOTENTE = 'outra operação alterou os mesmos registros; tente de novo com a mesma operation_id';

/**
 * 409 de escrita SEM `operation_id` (PATCH/PUT absolutos, POST antigo de
 * movimento): a tentativa voltou inteira, então reenviar depois do 409 não
 * duplica; a mensagem não promete chave que o endpoint não tem.
 */
export const MENSAGEM_CONFLITO_SEM_CHAVE = 'outra operação alterava os mesmos registros ao mesmo tempo; nada foi gravado; recarregue e tente de novo';

/**
 * Deadlock, serialização ou timeout da transação: a corrida foi perdida e nada
 * foi gravado.
 * @param {unknown} erro
 */
export const ehConflitoTransitorio = (erro) => {
  const e = /** @type {any} */ (erro);
  if (e?.code === 'P2034' || e?.code === 'P2028') return true;
  if (e?.code === 'P2010' && ['40P01', '40001'].includes(String(e?.meta?.code))) return true;
  return /deadlock detected|could not serialize access|code: "(40P01|40001)"/.test(String(e?.message ?? ''));
};

/**
 * Executa a transação traduzindo a corrida perdida (ver cabeçalho).
 * @template T
 * @param {{ maxWait?: number, timeout?: number }} opcoes
 * @param {(tx: any) => Promise<T>} fn
 * @param {Record<string, () => AppError>} [unicos] trecho do alvo do P2002 → erro
 * @param {string} [mensagem] mensagem do 409 CONCURRENCY_CONFLICT
 * @returns {Promise<T>}
 */
export const emTransacao = async (opcoes, fn, unicos = {}, mensagem = MENSAGEM_CONFLITO_IDEMPOTENTE) => {
  try {
    return await getPrismaClient().$transaction(fn, opcoes);
  } catch (erro) {
    if (erro instanceof AppError) throw erro;
    const e = /** @type {any} */ (erro);
    if (e?.code === 'P2002') {
      const alvo = JSON.stringify(e.meta?.target ?? '');
      for (const [trecho, fabrica] of Object.entries(unicos)) if (alvo.includes(trecho)) throw fabrica();
    }
    if (ehConflitoTransitorio(erro)) throw new AppError('CONCURRENCY_CONFLICT', mensagem, { cause: erro });
    throw erro;
  }
};

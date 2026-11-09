/**
 * Transação com espera limitada e tradução da corrida perdida (D-PROD-155, §8.4).
 *
 * Extraído de `operacaoFinanceiraService.js` — o comportamento dos comandos da
 * Central Única de Lançamentos não muda — para os comandos antigos que disputam
 * as MESMAS travas que confirmar/cancelar seguram por até 30 s (trava do
 * produto, sequência de movimentos do tenant, linha do perfil financeiro, linha
 * do movimento original): suplementação, transferência, POST e PATCH de
 * movimento, PATCH de produto, PATCH e DELETE de lote e PUT do perfil. Com o
 * timeout padrão do Prisma (5 s) eles respondiam 500 enquanto esperavam essas
 * travas (rodada 1); com 30 s, commitavam depois de o navegador desistir aos
 * 20 s (rodada 2): agora usam `TRANSACAO_CURTA`.
 *
 *  - P2028 (timeout da transação), P2034 (deadlock/serialização em operação
 *    de modelo) e 40P01/40001/55P03 (deadlock, serialização, lock_timeout;
 *    P2010 em SQL bruto ou erro de conector em operação de modelo) → 409
 *    `CONCURRENCY_CONFLICT`: a transação inteira voltou, nada foi gravado;
 *  - P2002 cujo alvo contém um trecho de `unicos` → o erro de negócio dado (a
 *    unique do banco é a rede da corrida);
 *  - `AppError` e qualquer outro erro seguem intactos.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { AppError } from '../errors/AppError.js';

/**
 * Espera longa: a mesma das transações de efeito (confirmar/cancelar, §8.4).
 * Só para quem o cliente espera 60 s e reenvia com a MESMA `operation_id` (a
 * tela nova: confirmar, cancelar, liquidar, estornar).
 */
export const TRANSACAO_LONGA = Object.freeze({ maxWait: 10000, timeout: 30000 });

/**
 * Espera CURTA (rodada 2, CRITICO-1): comandos chamados com o timeout padrão
 * de 20 s do navegador (`src/apis/_core/nativeHttpClient.js`) — as telas
 * antigas, que geram `operation_id` NOVO a cada envio (suplementação,
 * transferência) ou não têm chave (POST/PATCH de movimento, PATCH de produto,
 * PATCH/DELETE de lote), e o PUT do perfil, que a tela nova também chama com
 * os 20 s padrão. A resposta tem de ser DEFINITIVA antes de o navegador
 * desistir; senão o servidor commita depois do aviso de falha e o reenvio do
 * usuário (com chave nova) baixa o estoque de novo.
 *
 *  - `lock_timeout` (SET LOCAL) de 8 s: a espera por QUALQUER trava (advisory
 *    do produto, linha do produto, do lote, do movimento, do perfil, da
 *    sequência) é cortada pelo próprio PostgreSQL (55P03), a instrução falha e
 *    a transação volta inteira. O timeout do Prisma (P2028) sozinho não basta:
 *    ele só aparece quando a instrução em voo termina, isto é, quando quem
 *    segura a trava solta (até 30 s depois);
 *  - `timeout` 9 s e `maxWait` 2 s (o padrão do Prisma): uma espera longa
 *    responde 409 em ≈ 2 + 8 s; o pior caso teórico (instrução iniciada no
 *    fim do prazo esperando os 8 s inteiros) fica em 2 + 9 + 8 = 19 s, ainda
 *    antes dos 20 s do navegador;
 *  - trava segura por até ~6 s (um efeito curto da tela nova) continua
 *    concluindo com 2xx (correção da rodada 1).
 */
export const TRANSACAO_CURTA = Object.freeze({ maxWait: 2000, timeout: 9000, lockTimeoutMs: 8000 });

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
  // 55P03 = lock_timeout (TRANSACAO_CURTA) ou NOWAIT: a instrução falhou, nada commitou.
  if (e?.code === 'P2010' && ['40P01', '40001', '55P03'].includes(String(e?.meta?.code))) return true;
  return /deadlock detected|could not serialize access|due to lock timeout|code: "(40P01|40001|55P03)"/.test(String(e?.message ?? ''));
};

/**
 * Executa a transação traduzindo a corrida perdida (ver cabeçalho). Com
 * `lockTimeoutMs`, a PRIMEIRA instrução da transação é o `SET LOCAL
 * lock_timeout` (vale só para ela; seguro com pooler em modo transação).
 * @template T
 * @param {{ maxWait?: number, timeout?: number, lockTimeoutMs?: number }} opcoes
 * @param {(tx: any) => Promise<T>} fn
 * @param {Record<string, () => AppError>} [unicos] trecho do alvo do P2002 → erro
 * @param {string} [mensagem] mensagem do 409 CONCURRENCY_CONFLICT
 * @returns {Promise<T>}
 */
export const emTransacao = async (opcoes, fn, unicos = {}, mensagem = MENSAGEM_CONFLITO_IDEMPOTENTE) => {
  const { lockTimeoutMs, ...prazos } = opcoes;
  const corpo = lockTimeoutMs
    ? async (/** @type {any} */ tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${Math.trunc(lockTimeoutMs)}ms`}, true)`;
        return fn(tx);
      }
    : fn;
  try {
    return await getPrismaClient().$transaction(corpo, prazos);
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

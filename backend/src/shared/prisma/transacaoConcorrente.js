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
 *  - P2002 de uma unique de `unicos` → o erro de negócio dado (a unique do
 *    banco é a rede da corrida). Com o alvo do P2002, pelo trecho do alvo,
 *    como sempre; SEM o alvo (produção, D-PROD-252), pela conferência da
 *    chave depois do rollback (`UniqueDeNegocio`);
 *  - `AppError` e qualquer outro erro seguem intactos.
 *
 * D-PROD-252 — por que o alvo não basta. Em produção o runtime (`maike_vercel`)
 * não é dono das tabelas e elas têm RLS: o PostgreSQL omite o DETAIL da
 * violação de unique, e o Prisma 6.19 devolve o P2002 com o alvo (`target`) nulo
 * ("Unique constraint failed on the (not available)"). O nome da constraint
 * também não chega, nem pelo SQL bruto (P2010 com a mensagem vazia); só
 * `meta.modelName` sobra. Sem tradução, o P2002 caía no 409
 * `CONCURRENCY_CONFLICT` genérico, que o cliente repete com a mesma chave para
 * sempre. `alvoDaUnique` é o ÚNICO leitor do alvo no backend (inventário
 * fechado em `backend/tests/p2002SemAlvo.test.mjs`).
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

// ─── unique de negócio sem o alvo do P2002 (D-PROD-252) ─────────────────────

/**
 * Unique de NEGÓCIO de um mapa `unicos` do `emTransacao` (D-PROD-252).
 *
 *  - `erro`: o erro de negócio da unique;
 *  - `conferir(tx)`: a chave que ESTA transação tentou ocupar já está ocupada?
 *    (verdadeiro = sim). Sem o alvo do P2002, roda DEPOIS do rollback, numa
 *    transação de leitura nova (a do P2002 está abortada): quem ocupou a chave
 *    já commitou, porque o PostgreSQL só acusa a unique contra linha
 *    commitada (contra linha em voo ele espera o desfecho). Onde a chave pode
 *    chegar sem recibo, o serviço chama a MESMA função antes de escrever, na
 *    própria transação (pré-conferência da D-PROD-193), e o unique vira só a
 *    última rede;
 *  - `porque`: só nas entradas de `soPeloAlvo`.
 * @typedef {{ erro: () => AppError, conferir: (tx: any) => Promise<unknown>, porque?: string }} UniqueDeNegocio
 */

/** Transação curta das conferências sem o alvo (só leitura). */
const CONFERENCIA = Object.freeze({ maxWait: 2000, timeout: 5000 });

/** Entradas de `soPeloAlvo`: nunca conferidas sem o alvo. @type {WeakSet<object>} */
const SO_PELO_ALVO = new WeakSet();

/**
 * O alvo do P2002 (os campos ou o índice da unique violada) ou `null` quando o
 * Prisma não o sabe (produção: papel não dono + RLS). ÚNICO leitor do alvo
 * (`target`) no backend: todo tradutor de P2002 passa por aqui e tem de ter
 * um caminho para o `null` (inventário em `backend/tests/p2002SemAlvo.test.mjs`).
 * @param {unknown} erro
 * @returns {unknown|null}
 */
export const alvoDaUnique = (erro) => {
  const alvo = /** @type {any} */ (erro)?.meta?.target;
  return alvo === null || alvo === undefined ? null : alvo;
};

/**
 * A chave já está ocupada? Conferência sem o alvo, numa transação de leitura
 * nova. Falha da própria conferência conta como "não": o erro original segue o
 * caminho de antes, nunca é mascarado.
 * @param {(tx: any) => Promise<unknown>} conferir
 * @returns {Promise<boolean>}
 */
export const chaveOcupada = async (conferir) => {
  try {
    return Boolean(await getPrismaClient().$transaction((tx) => conferir(tx), CONFERENCIA));
  } catch {
    return false;
  }
};

/**
 * Entrada reconhecida SÓ pelo alvo (o comportamento de antes da D-PROD-252),
 * para unique cuja chave nasce dentro da transação e que a MESMA transação já
 * confere sob trava antes de escrever: sem o alvo, o P2002 segue o caminho
 * genérico (409 `CONCURRENCY_CONFLICT`) e o reenvio cai na pré-conferência,
 * que responde o erro certo. Lista FECHADA, conferida por teste.
 * @param {() => AppError} erro
 * @param {string} porque a trava que garante a pré-conferência
 * @returns {UniqueDeNegocio}
 */
export const soPeloAlvo = (erro, porque) => {
  const entrada = Object.freeze({ erro, conferir: async () => false, porque });
  SO_PELO_ALVO.add(entrada);
  return entrada;
};

/**
 * P2002 → erro de negócio de `unicos`. Com o alvo: a primeira entrada cujo
 * trecho está no alvo (inalterado). Sem o alvo: a primeira entrada cuja chave
 * a conferência acha ocupada. Nenhuma → `null` (o chamador segue o caminho
 * genérico).
 * @param {unknown} erro P2002
 * @param {Record<string, UniqueDeNegocio>} unicos
 * @returns {Promise<AppError|null>}
 */
export const traduzirUniqueDeNegocio = async (erro, unicos) => {
  const alvo = alvoDaUnique(erro);
  if (alvo !== null) {
    const texto = JSON.stringify(alvo);
    for (const [trecho, unique] of Object.entries(unicos)) if (texto.includes(trecho)) return unique.erro();
    return null;
  }
  for (const unique of new Set(Object.values(unicos))) {
    if (SO_PELO_ALVO.has(unique)) continue;
    if (await chaveOcupada(unique.conferir)) return unique.erro();
  }
  return null;
};

/**
 * Executa a transação traduzindo a corrida perdida (ver cabeçalho). Com
 * `lockTimeoutMs`, a PRIMEIRA instrução da transação é o `SET LOCAL
 * lock_timeout` (vale só para ela; seguro com pooler em modo transação).
 * @template T
 * @param {{ maxWait?: number, timeout?: number, lockTimeoutMs?: number }} opcoes
 * @param {(tx: any) => Promise<T>} fn
 * @param {Record<string, UniqueDeNegocio>} [unicos] trecho do alvo do P2002 → unique de negócio (D-PROD-252)
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
      const traduzido = await traduzirUniqueDeNegocio(e, unicos);
      if (traduzido) throw traduzido;
    }
    if (ehConflitoTransitorio(erro)) throw new AppError('CONCURRENCY_CONFLICT', mensagem, { cause: erro });
    throw erro;
  }
};

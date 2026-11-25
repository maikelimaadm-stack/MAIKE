/**
 * D-PROD-307 — uma coisa de cada vez: enviar (as duas filas) e baixar dados para
 * usar sem internet nunca rodam juntos.
 *
 * Juntos, a baixa podia ler do servidor ANTES de um envio ser gravado e guardar
 * essa resposta DEPOIS dele: o registro recém-enviado sumia do aparelho (não
 * estava mais na fila nem no cache) até a próxima baixa. Aqui cada um espera o
 * anterior terminar. Desde a D-PROD-308 vale também entre abas do navegador.
 */

/** @type {Promise<unknown>} */
let cauda = Promise.resolve();

/**
 * Roda `fazer` quando o que estiver na vez terminar (com sucesso ou erro).
 * @template T
 * @param {() => Promise<T>} fazer
 * @returns {Promise<T>}
 */
export const naVezDaSincronia = (fazer) => {
  const naVez = () => comTravaEntreAbas(fazer);
  const resultado = cauda.then(naVez, naVez);
  cauda = resultado.catch(() => undefined);
  return resultado;
};

/** Nome da trava compartilhada entre as abas do mesmo site (navegador). */
export const TRAVA_ENTRE_ABAS = 'maike-sincronia';

/**
 * D-PROD-308 — no navegador, duas abas abertas não sincronizam ao mesmo tempo: a mesma
 * trava (`navigator.locks`) vale para todas as abas do site. Sem suporte (navegador antigo,
 * testes), roda direto: a ordem dentro da aba já está garantida pela `cauda`.
 * @template T
 * @param {() => Promise<T>} fazer
 * @returns {Promise<T>}
 */
const comTravaEntreAbas = (fazer) => {
  const travas = typeof navigator !== 'undefined' ? /** @type {any} */ (navigator).locks : undefined;
  if (!travas || typeof travas.request !== 'function') return fazer();
  return travas.request(TRAVA_ENTRE_ABAS, { mode: 'exclusive' }, () => fazer());
};

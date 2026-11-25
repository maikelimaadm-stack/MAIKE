/**
 * D-PROD-307 — uma coisa de cada vez: enviar (as duas filas) e baixar dados para
 * usar sem internet nunca rodam juntos.
 *
 * Juntos, a baixa podia ler do servidor ANTES de um envio ser gravado e guardar
 * essa resposta DEPOIS dele: o registro recém-enviado sumia do aparelho (não
 * estava mais na fila nem no cache) até a próxima baixa. Aqui cada um espera o
 * anterior terminar.
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
  const resultado = cauda.then(fazer, fazer);
  cauda = resultado.catch(() => undefined);
  return resultado;
};

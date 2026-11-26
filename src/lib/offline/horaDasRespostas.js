/**
 * D-PROD-318 (Etapa 4, a tela nunca "pisca") — DE QUANDO é a lista que a tela mostra.
 *
 * Para cada leitura (tenant + caminho), a hora em que saiu do aparelho o pedido cuja resposta foi devolvida por
 * último: a do servidor (o início do pedido) ou a da cópia guardada (o início do pedido que a gravou). Tudo no relógio
 * do aparelho, o mesmo de `tentado_em` na fila: comparar os dois nunca sofre com relógio do servidor adiantado.
 *
 * Quem usa: o saldo do estoque. Um registro que já tentou subir só é aplicado por cima da lista se a lista é de ANTES
 * da primeira tentativa (o servidor não podia tê-lo ainda). Hora desconhecida → `null` (quem usa fica no seguro).
 * Só memória: depois de reabrir o app, vale a hora gravada junto da cópia (`respostasOffline`, campo `pedido_em`).
 */

/** @type {Map<string, number>} */
const horas = new Map();
const chave = (/** @type {string} */ tenant, /** @type {string} */ caminho) => `${tenant}\u0000${caminho}`;

/**
 * @param {string|null} tenant @param {string} caminho
 * @param {number|null|undefined} ms hora do pedido (null: desconhecida)
 */
export const registrarHoraDaResposta = (tenant, caminho, ms) => {
  if (!tenant || !caminho) return;
  if (Number.isFinite(ms)) horas.set(chave(tenant, caminho), /** @type {number} */ (ms));
  else horas.delete(chave(tenant, caminho));
};

/** @param {string|null} tenant @param {string} caminho @returns {number|null} */
export const horaDaResposta = (tenant, caminho) => (tenant && caminho ? horas.get(chave(tenant, caminho)) ?? null : null);

/** Testes e troca de conta. */
export const esquecerHorasDasRespostas = () => horas.clear();

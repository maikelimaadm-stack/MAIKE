/**
 * Confirmações e avisos no padrão do sistema (D-PROD-121), no lugar do
 * `window.confirm`/`alert` do navegador — que no celular mostra o endereço do
 * site numa caixa cinza. Quem mostra é o `MaikeAvisosHost`, montado uma vez no
 * App. Sem host montado (testes, SSR), cai no `window.confirm`.
 *
 * @typedef {{ titulo?: string, descricao: string, textoConfirmar?: string, textoCancelar?: string, perigo?: boolean, soInformar?: boolean }} PedidoConfirmacao
 */

/** @type {null | ((pedido: PedidoConfirmacao) => Promise<boolean>)} */
let mostrar = null;

/** @param {null | ((pedido: PedidoConfirmacao) => Promise<boolean>)} fn */
export function registrarHostDeAvisos(fn) {
  mostrar = fn;
  return () => {
    if (mostrar === fn) mostrar = null;
  };
}

/**
 * Pede confirmação; resolve `true` se o usuário confirmou.
 * @param {PedidoConfirmacao} pedido
 * @returns {Promise<boolean>}
 */
export function confirmar(pedido) {
  if (mostrar) return mostrar(pedido);
  if (typeof window !== "undefined" && typeof window.confirm === "function") {
    return Promise.resolve(window.confirm(pedido.descricao));
  }
  return Promise.resolve(false);
}

/** Pedido de exclusão (botão vermelho "Excluir"). @param {string} descricao @param {Partial<PedidoConfirmacao>} [extra] */
export function confirmarExclusao(descricao, extra = {}) {
  return confirmar({ titulo: "Confirme a exclusão", descricao, textoConfirmar: "Excluir", perigo: true, ...extra });
}

/** Aviso com um botão só ("Entendi"). @param {string} titulo @param {string} descricao */
export function avisar(titulo, descricao) {
  return confirmar({ titulo, descricao, textoConfirmar: "Entendi", soInformar: true }).then(() => undefined);
}

/**
 * D-PROD-343 — pede ao sistema que NÃO apague os dados do app quando o celular fica sem espaço.
 *
 * O que foi feito sem internet (filas, fotos, cópias) fica no armazenamento do navegador do app. Sem este pedido, o
 * Android/navegador pode limpá-lo sozinho com o armazenamento cheio, e o que esperava envio se perdia. O pedido é
 * silencioso (no app não aparece pergunta); se o sistema negar, tudo segue como antes.
 */

let pedido = null;

/**
 * Pede uma vez por abertura. Nunca lança.
 * @returns {Promise<boolean>} se o armazenamento ficou protegido
 */
export const pedirArmazenamentoPersistente = () => {
  if (pedido) return pedido;
  pedido = (async () => {
    try {
      const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
      if (!storage || typeof storage.persist !== 'function') return false;
      if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
      return Boolean(await storage.persist());
    } catch {
      return false;
    }
  })();
  return pedido;
};

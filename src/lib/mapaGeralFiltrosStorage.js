/**
 * Preferências locais do Mapa Geral — leitura tolerante a JSON inválido (R3-04).
 */

const chaveLegada = 'mapa_geral_filtros';

const chavePorEmpresa = (empresaId) =>
  `mapa_geral_filtros_${empresaId || 'default'}`;

/**
 * @param {string|null|undefined} empresaId
 * @returns {Record<string, unknown>|null}
 */
export const lerFiltrosMapaGeral = (empresaId) => {
  if (typeof window === 'undefined') return null;
  let bruto = null;
  try {
    bruto =
      window.localStorage.getItem(chavePorEmpresa(empresaId)) ||
      window.localStorage.getItem(chaveLegada);
  } catch {
    return null;
  }
  if (!bruto) return null;
  try {
    const parsed = JSON.parse(bruto);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return /** @type {Record<string, unknown>} */ (parsed);
  } catch {
    return null;
  }
};

/**
 * @param {string|null|undefined} empresaId
 * @param {Record<string, unknown>} state
 */
export const salvarFiltrosMapaGeral = (empresaId, state) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(chavePorEmpresa(empresaId), JSON.stringify(state));
  } catch {
    // storage indisponível — montagem segue com defaults
  }
};

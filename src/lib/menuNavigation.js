/** Evita segundo clique de menu para a mesma rota em sequência rápida (ms). */
export const MENU_NAV_DEDUPE_MS = 400;

/**
 * @param {string} pathnameAtual
 * @param {string} pathnameAlvo
 * @param {{ path: string, at: number } | null} ultimoIntento
 * @param {number} [agora]
 */
export function deveBloquearCliqueMenu(pathnameAtual, pathnameAlvo, ultimoIntento, agora = Date.now()) {
  if (pathnameAtual === pathnameAlvo) return true;
  if (
    ultimoIntento?.path === pathnameAlvo &&
    agora - ultimoIntento.at < MENU_NAV_DEDUPE_MS
  ) {
    return true;
  }
  return false;
}

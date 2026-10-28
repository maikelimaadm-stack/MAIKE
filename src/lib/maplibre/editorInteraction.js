/**
 * Regras puras do editor M1 — testáveis sem MapLibre (R5).
 */

/**
 * @param {{ lat: number, lng: number }[]} before
 * @param {{ lat: number, lng: number }[]} after
 * @returns {boolean}
 */
export function geometryChanged(before, after) {
  if (!before || !after) return before !== after;
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i].lat !== after[i].lat || before[i].lng !== after[i].lng) return true;
  }
  return false;
}

/**
 * Commit de uma transação de drag: um único undo se houve mudança real.
 * @param {{
 *   undo: { lat: number, lng: number }[][],
 *   redo: { lat: number, lng: number }[][],
 *   before: { lat: number, lng: number }[],
 *   after: { lat: number, lng: number }[],
 * }} args
 * @returns {{ undo: { lat: number, lng: number }[][], redo: { lat: number, lng: number }[][], committed: boolean }}
 */
export function commitDragTransaction({ undo, redo, before, after }) {
  /** @type {{ lat: number, lng: number }[][]} */
  const nextUndo = [...(undo || [])];
  /** @type {{ lat: number, lng: number }[][]} */
  let nextRedo = [...(redo || [])];
  let committed = false;
  if (geometryChanged(before, after)) {
    nextUndo.push(before);
    nextRedo = [];
    committed = true;
  }
  return { undo: nextUndo, redo: nextRedo, committed };
}

/**
 * Resolve URL do ícone do ponto (R5-07).
 * @param {{ icone_url?: string | null, tipo?: string } | null | undefined} ponto
 * @param {{ tipo_entidade?: string, categoria?: string, icone_url?: string }[]} iconesConfig
 * @returns {string | null}
 */
export function resolvePontoIconUrl(ponto, iconesConfig = []) {
  if (!ponto) return null;
  if (ponto.icone_url) return ponto.icone_url;
  const tipo = String(ponto.tipo || "").toUpperCase().trim();
  const cfg =
    (iconesConfig || []).find(
      (ic) =>
        ic.tipo_entidade === "Ponto" &&
        String(ic.categoria || "").toUpperCase().trim() === tipo
    ) ||
    (iconesConfig || []).find(
      (ic) => String(ic.categoria || "").toUpperCase().trim() === tipo
    );
  return cfg?.icone_url || null;
}

/**
 * Hit-test de layers de edição a partir de pixel do canvas.
 * @param {{ queryRenderedFeatures: Function, getLayer: Function }} map
 * @param {number} x
 * @param {number} y
 * @param {string[]} layerIds
 * @returns {boolean}
 */
export function hitEditLayers(map, x, y, layerIds) {
  if (!map || typeof map.queryRenderedFeatures !== "function") return false;
  const layers = (layerIds || []).filter((id) => map.getLayer?.(id));
  if (layers.length === 0) return false;
  const feats = map.queryRenderedFeatures([x, y], { layers });
  return Array.isArray(feats) && feats.length > 0;
}

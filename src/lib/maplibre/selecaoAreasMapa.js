/**
 * Helpers puros da seleção de áreas no mapa (M2-B2).
 * Sem Maps JS de terceiros. Coords zero-safe; lote parcial honesto; renumeração fail-fast.
 */
import {
  isValidLatLng,
  parseVertex,
  parseVertices,
  toGeoJsonPolygon,
  toPersistedCoords,
} from "@/lib/geografia/coords.js";
import { corExibidaNoMapa } from "./estiloAreas.js";
import { safeCentroid } from "./taskLocationPicker.js";

export const SELECAO_SOURCE_IDS = Object.freeze({
  AREAS: "m2b2-areas",
});

export const SELECAO_LAYER_IDS = Object.freeze({
  AREAS_FILL: "m2b2-areas-fill",
  AREAS_LINE: "m2b2-areas-line",
});

/** Opacidades: selecionada bem distinta do fill M1 (~0.78) e do não-selecionado. */
export const SELECAO_FILL_OPACITY = Object.freeze({
  IDLE: 0.22,
  SELECTED: 0.62,
});

const EMPTY_FC = Object.freeze({ type: "FeatureCollection", features: [] });

/**
 * Clona coords persistidas [[lat,lng],…] sem `||` (0 válido).
 * Preferência: round-trip parse → toPersistedCoords; fallback cópia superficial segura.
 * @param {unknown} raw
 * @returns {[number, number][]}
 */
export function clonePersistedCoordsExact(raw) {
  if (!Array.isArray(raw)) return [];
  const parsed = parseVertices(raw);
  if (parsed.length === raw.length && parsed.length > 0) {
    return toPersistedCoords(parsed);
  }
  /** @type {[number, number][]} */
  const out = [];
  for (const item of raw) {
    const v = parseVertex(item);
    if (v) {
      out.push([v.lat, v.lng]);
      continue;
    }
    if (Array.isArray(item) && item.length >= 2) {
      const lat = item[0];
      const lng = item[1];
      if (typeof lat === "number" && typeof lng === "number" && isValidLatLng(lat, lng)) {
        out.push([lat, lng]);
      }
    }
  }
  return out;
}

/**
 * Payload de cor em lote: preserva coords; sincroniza `cor` e `coordenadas.cor`.
 * @param {{ coordenadas?: { coords?: unknown, cor?: string }, cor?: string }} area
 * @param {string} novaCor
 * @returns {{ cor: string, coordenadas: { coords: [number, number][], cor: string } }}
 */
export function buildColorBatchPayload(area, novaCor) {
  const coords = clonePersistedCoordsExact(area?.coordenadas?.coords);
  return {
    cor: novaCor,
    coordenadas: { coords, cor: novaCor },
  };
}

/**
 * Planeja renumeração A→Z por nome. Fail-fast se código colidir com área NÃO selecionada.
 * @param {Array<{ id?: string, nome?: string, numero_area?: string|number }>} areas
 * @param {Iterable<string>} selectedIds
 * @param {number} start
 * @returns {{ ok: true, plan: Array<{ id: string, numero_area: string }> } | { ok: false, reason: string }}
 */
export function planRenumeracao(areas, selectedIds, start) {
  const ids = new Set([...selectedIds].map(String));
  if (ids.size === 0) return { ok: false, reason: "Selecione áreas no mapa" };
  if (!Number.isFinite(start) || start < 0) {
    return { ok: false, reason: "Número inicial inválido" };
  }

  const ocupados = new Set(
    (areas || [])
      .filter((a) => a && !ids.has(String(a.id)))
      .map((a) => String(a.numero_area ?? ""))
      .filter((n) => n !== "")
  );

  const selecionadas = (areas || [])
    .filter((a) => a && ids.has(String(a.id)))
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));

  /** @type {Array<{ id: string, numero_area: string }>} */
  const plan = [];
  for (let i = 0; i < selecionadas.length; i += 1) {
    const numero = String(start + i);
    if (ocupados.has(numero)) {
      return {
        ok: false,
        reason: `Conflito: código ${numero} já existe em outra área. Nada foi aplicado.`,
      };
    }
    plan.push({ id: String(selecionadas[i].id), numero_area: numero });
  }
  return { ok: true, plan };
}

/**
 * Resume Promise.allSettled de forma honesta (sem fingir atomicidade).
 * @param {PromiseSettledResult<unknown>[]} results
 * @returns {{ ok: number, fail: number, allOk: boolean, allFail: boolean, partial: boolean }}
 */
export function summarizeBatchResults(results) {
  const list = Array.isArray(results) ? results : [];
  let ok = 0;
  let fail = 0;
  for (const r of list) {
    if (r && r.status === "fulfilled") ok += 1;
    else fail += 1;
  }
  return {
    ok,
    fail,
    allOk: fail === 0 && ok > 0,
    allFail: ok === 0 && fail > 0,
    partial: ok > 0 && fail > 0,
  };
}

/**
 * Sincroniza Set de seleção a partir de props sem apagar toggles da sessão.
 * @param {Set<string>} current
 * @param {unknown} selectedIds
 * @param {{ userTouched: boolean }} flags
 * @returns {{ next: Set<string>, changed: boolean }}
 */
export function syncSelectedIds(current, selectedIds, flags) {
  const incoming = new Set(
    (Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id))
  );
  if (flags?.userTouched) {
    return { next: current instanceof Set ? current : new Set(), changed: false };
  }
  const prev = current instanceof Set ? current : new Set();
  if (prev.size === incoming.size && [...incoming].every((id) => prev.has(id))) {
    return { next: prev, changed: false };
  }
  return { next: incoming, changed: true };
}

/**
 * @param {Array<{ id?: string, nome?: string, numero_area?: string, cor?: string, coordenadas?: { coords?: unknown, cor?: string } }>} areas
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildSelecaoAreasCollection(areas) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const area of areas || []) {
    if (!area) continue;
    const ring = parseVertices(area.coordenadas?.coords);
    const geometry = toGeoJsonPolygon(ring);
    if (!geometry) continue;
    const cor = area.coordenadas?.cor || area.cor || "#10b981";
    const id = String(area.id ?? features.length);
    const center = safeCentroid(ring);
    features.push({
      type: "Feature",
      id,
      properties: {
        id,
        nome: area.nome || area.numero_area || "ÁREA",
        fill: corExibidaNoMapa(cor),
        cor,
        labelLat: center?.lat ?? null,
        labelLng: center?.lng ?? null,
      },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * @param {{ getSource: Function, addSource: Function, getLayer: Function, addLayer: Function }} map
 */
export function ensureSelecaoAreasLayers(map) {
  if (!map.getSource(SELECAO_SOURCE_IDS.AREAS)) {
    map.addSource(SELECAO_SOURCE_IDS.AREAS, {
      type: "geojson",
      data: EMPTY_FC,
      promoteId: "id",
    });
  }
  if (!map.getLayer(SELECAO_LAYER_IDS.AREAS_FILL)) {
    map.addLayer({
      id: SELECAO_LAYER_IDS.AREAS_FILL,
      type: "fill",
      source: SELECAO_SOURCE_IDS.AREAS,
      paint: {
        "fill-color": ["coalesce", ["get", "fill"], "#10b981"],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          SELECAO_FILL_OPACITY.SELECTED,
          SELECAO_FILL_OPACITY.IDLE,
        ],
      },
    });
  }
  if (!map.getLayer(SELECAO_LAYER_IDS.AREAS_LINE)) {
    map.addLayer({
      id: SELECAO_LAYER_IDS.AREAS_LINE,
      type: "line",
      source: SELECAO_SOURCE_IDS.AREAS,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          "#ffffff",
          ["coalesce", ["get", "cor"], "#10b981"],
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "selected"], false],
          3.2,
          1.5,
        ],
        "line-opacity": 0.95,
      },
    });
  }
}

export { safeCentroid };

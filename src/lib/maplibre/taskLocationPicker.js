/**
 * Helpers puros do seletor de local de tarefa (M2-B1).
 * MapLibre/GeoJSON only. Point-in-polygon determinístico; centroide seguro; coords sem `||`.
 */
import {
  isFiniteNumber,
  isValidLatLng,
  parseVertex,
  parseVertices,
  toGeoJsonPolygon,
  latLngToLngLat,
} from "@/lib/geografia/coords.js";
import { corExibidaNoMapa } from "./estiloAreas.js";

export const TASK_PICKER_SOURCE_IDS = Object.freeze({
  AREAS: "m2b1-areas",
  SELECTED: "m2b1-selected",
});

export const TASK_PICKER_LAYER_IDS = Object.freeze({
  AREAS_FILL: "m2b1-areas-fill",
  AREAS_LINE: "m2b1-areas-line",
  AREAS_FILL_HOVER: "m2b1-areas-fill-hover",
  SELECTED: "m2b1-selected",
});

const EMPTY_FC = Object.freeze({ type: "FeatureCollection", features: [] });

/**
 * Ray-casting point-in-polygon (anel aberto LatLng).
 * Fronteira: trata aresta como dentro (inclui perímetro).
 * @param {{ lat: number, lng: number }} point
 * @param {{ lat: number, lng: number }[]} ring
 * @returns {boolean}
 */
export function pointInPolygonRing(point, ring) {
  if (!point || !isValidLatLng(point.lat, point.lng) || !Array.isArray(ring) || ring.length < 3) {
    return false;
  }
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng;
    const yi = ring[i].lat;
    const xj = ring[j].lng;
    const yj = ring[j].lat;
    if (!isValidLatLng(yi, xi) || !isValidLatLng(yj, xj)) continue;
    // On-edge check (tolerância mínima)
    if (pointOnSegment(x, y, xj, yj, xi, yi)) return true;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 */
function pointOnSegment(x, y, x1, y1, x2, y2) {
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-12) return false;
  const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1);
  if (dot < 0) return false;
  const len2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  return dot <= len2;
}

/**
 * Centroide shoelace; fallback = média dos vértices (sem LatLngBounds de terceiros).
 * @param {{ lat: number, lng: number }[]} paths
 * @returns {{ lat: number, lng: number } | null}
 */
export function safeCentroid(paths) {
  const ring = parseVertices(paths);
  if (ring.length === 0) return null;
  if (ring.length === 1) return { lat: ring[0].lat, lng: ring[0].lng };

  let cLat = 0;
  let cLng = 0;
  let sA = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const x0 = ring[i].lat;
    const y0 = ring[i].lng;
    const x1 = ring[(i + 1) % ring.length].lat;
    const y1 = ring[(i + 1) % ring.length].lng;
    const a = x0 * y1 - x1 * y0;
    sA += a;
    cLat += (x0 + x1) * a;
    cLng += (y0 + y1) * a;
  }
  sA *= 0.5;
  if (isFiniteNumber(sA) && Math.abs(sA) > 1e-18) {
    const lat = cLat / (6 * sA);
    const lng = cLng / (6 * sA);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }

  let sumLat = 0;
  let sumLng = 0;
  for (const p of ring) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  const lat = sumLat / ring.length;
  const lng = sumLng / ring.length;
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

/**
 * Regra de sobreposição explícita (M2-B1):
 * percorre `areas` na **ordem do array** e retorna a **primeira** cujo anel contém o ponto.
 * Clique em feature MapLibre com `properties.id` resolve por id (mais específico).
 *
 * @param {{ lat: number, lng: number }} point
 * @param {Array<{ id?: string, coordenadas?: { coords?: unknown } }>} areas
 * @returns {object | null}
 */
export function findContainingArea(point, areas) {
  if (!point || !isValidLatLng(point.lat, point.lng) || !Array.isArray(areas)) return null;
  for (const area of areas) {
    if (!area) continue;
    const ring = parseVertices(area.coordenadas?.coords);
    if (ring.length < 3) continue;
    if (pointInPolygonRing(point, ring)) return area;
  }
  return null;
}

/**
 * @param {unknown} raw
 * @returns {{ lat: number, lng: number } | null}
 */
export function parsePickerCoordinate(raw) {
  return parseVertex(raw);
}

/**
 * FeatureCollection de áreas para o picker (fill + id/nome/cor).
 * @param {Array<{ id?: string, nome?: string, numero_area?: string, cor?: string, coordenadas?: { coords?: unknown, cor?: string }, area_pastejada?: unknown, tamanho_hectares?: unknown }>} areas
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildTaskPickerAreasCollection(areas) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const area of areas || []) {
    if (!area) continue;
    const ring = parseVertices(area.coordenadas?.coords);
    const geometry = toGeoJsonPolygon(ring);
    if (!geometry) continue;
    const cor = area.coordenadas?.cor || area.cor || "#61aad9";
    const id = String(area.id ?? features.length);
    features.push({
      type: "Feature",
      id,
      properties: {
        id,
        nome: area.nome || area.numero_area || "ÁREA",
        fill: corExibidaNoMapa(cor),
        cor,
      },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * @param {{ lat: number, lng: number } | null | undefined} point
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildSelectedPointCollection(point) {
  const v = parseVertex(point);
  if (!v) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "selected",
        properties: { id: "selected" },
        geometry: { type: "Point", coordinates: latLngToLngLat(v) },
      },
    ],
  };
}

/**
 * Sources/layers do picker (idempotente).
 * @param {{ getSource: Function, addSource: Function, getLayer: Function, addLayer: Function }} map
 */
export function ensureTaskPickerLayers(map) {
  const ensureSource = (id) => {
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: EMPTY_FC, promoteId: "id" });
    }
  };
  ensureSource(TASK_PICKER_SOURCE_IDS.AREAS);
  ensureSource(TASK_PICKER_SOURCE_IDS.SELECTED);

  if (!map.getLayer(TASK_PICKER_LAYER_IDS.AREAS_FILL)) {
    map.addLayer({
      id: TASK_PICKER_LAYER_IDS.AREAS_FILL,
      type: "fill",
      source: TASK_PICKER_SOURCE_IDS.AREAS,
      paint: {
        "fill-color": ["coalesce", ["get", "fill"], "#61aad9"],
        "fill-opacity": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          0.55,
          0.45,
        ],
      },
    });
  }
  if (!map.getLayer(TASK_PICKER_LAYER_IDS.AREAS_LINE)) {
    map.addLayer({
      id: TASK_PICKER_LAYER_IDS.AREAS_LINE,
      type: "line",
      source: TASK_PICKER_SOURCE_IDS.AREAS,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          "#ffffff",
          ["coalesce", ["get", "cor"], "#61aad9"],
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          3,
          2,
        ],
        "line-opacity": 0.9,
      },
    });
  }
  if (!map.getLayer(TASK_PICKER_LAYER_IDS.SELECTED)) {
    map.addLayer({
      id: TASK_PICKER_LAYER_IDS.SELECTED,
      type: "circle",
      source: TASK_PICKER_SOURCE_IDS.SELECTED,
      paint: {
        "circle-radius": 8,
        "circle-color": "#059669",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }
}

/**
 * Normaliza texto de prioridade para match com ConfiguracaoIcone da empresa.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizarPrioridade(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

export const PRIORIDADE_CORES = Object.freeze({
  Baixa: "#94a3b8",
  Normal: "#3b82f6",
  Alta: "#f59e0b",
  Urgente: "#ef4444",
  Média: "#3b82f6",
});

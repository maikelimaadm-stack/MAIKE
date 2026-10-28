/**
 * Medidas geodésicas do editor (substitui google.maps.geometry.spherical).
 * Unidades: área em m² / ha; comprimento em metros.
 */
import area from "@turf/area";
import length from "@turf/length";
import { lineString, polygon } from "@turf/helpers";
import {
  isValidPolygonRing,
  parseVertices,
  stripClosingVertex,
  toOpenRingLngLat,
} from "./coords.js";

const M2_POR_HA = 10000;

/**
 * Área geodésica em m². Polígono inválido → 0.
 * @param {import('./coords.js').LatLng[] | unknown[]} points
 * @returns {number}
 */
export function areaMetrosQuadrados(points) {
  const ring = stripClosingVertex(parseVertices(points));
  if (!isValidPolygonRing(ring)) return 0;
  const lngLat = toOpenRingLngLat(ring);
  const closed = [...lngLat, lngLat[0]];
  try {
    return area(polygon([closed]));
  } catch {
    return 0;
  }
}

/**
 * Área em hectares (geodésica). Não arredonda — o caller formata.
 * @param {import('./coords.js').LatLng[] | unknown[]} points
 * @returns {number}
 */
export function areaHectares(points) {
  return areaMetrosQuadrados(points) / M2_POR_HA;
}

/**
 * Comprimento geodésico em metros (LineString aberta).
 * @param {import('./coords.js').LatLng[] | unknown[]} points
 * @returns {number}
 */
export function comprimentoMetros(points) {
  const ring = parseVertices(points);
  if (ring.length < 2) return 0;
  const coords = toOpenRingLngLat(ring);
  try {
    return length(lineString(coords), { units: "meters" });
  } catch {
    return 0;
  }
}

/**
 * Perímetro em metros (anel fechado).
 * @param {import('./coords.js').LatLng[] | unknown[]} points
 * @returns {number}
 */
export function perimetroMetros(points) {
  const ring = stripClosingVertex(parseVertices(points));
  if (ring.length < 2) return 0;
  if (ring.length < 3) return comprimentoMetros(ring);
  const coords = toOpenRingLngLat(ring);
  const closed = [...coords, coords[0]];
  try {
    return length(lineString(closed), { units: "meters" });
  } catch {
    return 0;
  }
}

/**
 * Formata hectares pt-BR com 2 casas.
 * @param {number} ha
 * @returns {string}
 */
export function formatHectaresPt(ha) {
  if (!Number.isFinite(ha)) return "0,00";
  return ha.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Formata metros / km pt-BR.
 * @param {number} meters
 * @returns {string}
 */
export function formatDistanciaPt(meters) {
  if (!Number.isFinite(meters)) return "0 m";
  if (meters < 1000) {
    return `${meters.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m`;
  }
  return `${(meters / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

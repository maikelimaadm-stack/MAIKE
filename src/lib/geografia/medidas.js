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
  dedupeConsecutive,
} from "./coords.js";

const M2_POR_HA = 10000;
/** Área mínima aceitável no editor (m²) — evita polígono degenerado/colinear. */
export const AREA_MINIMA_M2 = 1e-2;

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
 * Polígono salvável: ≥3 vértices distintos e área geodésica > tolerância.
 * @param {import('./coords.js').LatLng[] | unknown[]} points
 * @returns {{ ok: boolean, reason?: string, areaM2?: number }}
 */
export function validatePolygonForSave(points) {
  /** @type {import('./coords.js').LatLng[]} */
  const ring = stripClosingVertex(parseVertices(points));
  if (!isValidPolygonRing(ring)) {
    return { ok: false, reason: "Polígono inválido: precisa de pelo menos 3 vértices distintos." };
  }
  const m2 = areaMetrosQuadrados(ring);
  if (!(m2 > AREA_MINIMA_M2)) {
    return { ok: false, reason: "Área inválida (vértices colineares ou degenerados).", areaM2: m2 };
  }
  return { ok: true, areaM2: m2 };
}

/**
 * Linha salvável: ≥2 pontos sem duplicata consecutiva e comprimento > 0.
 * @param {import('./coords.js').LatLng[] | unknown[]} points
 * @returns {{ ok: boolean, reason?: string, meters?: number, cleaned?: import('./coords.js').LatLng[] }}
 */
export function validateLineForSave(points) {
  /** @type {import('./coords.js').LatLng[]} */
  const cleaned = dedupeConsecutive(points);
  if (cleaned.length < 2) {
    return { ok: false, reason: "Linha inválida: precisa de pelo menos 2 pontos distintos." };
  }
  const meters = comprimentoMetros(cleaned);
  if (!(meters > 0)) {
    return { ok: false, reason: "Comprimento da linha é zero.", meters };
  }
  return { ok: true, meters, cleaned };
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

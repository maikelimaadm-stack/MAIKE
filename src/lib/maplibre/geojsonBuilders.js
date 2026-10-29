/**
 * Constrói FeatureCollections para as sources do editor M1.
 */
import {
  parseVertex,
  parseVertices,
  toGeoJsonLineString,
  toGeoJsonPolygon,
  latLngToLngLat,
} from "@/lib/geografia/coords.js";
import { corExibidaNoMapa } from "./estiloAreas.js";

/**
 * @typedef {{
 *   id?: string,
 *   nome?: string,
 *   numero_area?: string,
 *   cor?: string,
 *   icone_url?: string,
 *   coordenadas?: { coords?: unknown, cor?: string, lat?: number, lng?: number }
 * }} EntidadeMapa
 */

/**
 * @param {EntidadeMapa[]} areas
 * @param {{ excludeId?: string | null, hideFillForId?: string | null }} [opts]
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildAreasCollection(areas, opts = {}) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const area of areas || []) {
    if (!area) continue;
    if (opts.excludeId && area.id === opts.excludeId) continue;
    // Em edição: omitir fill da área sendo editada para não duplicar overlay
    if (opts.hideFillForId && area.id === opts.hideFillForId) continue;
    const ring = parseVertices(area.coordenadas?.coords);
    const geometry = toGeoJsonPolygon(ring);
    if (!geometry) continue;
    const cor = area.coordenadas?.cor || area.cor || "#16a34a";
    features.push({
      type: "Feature",
      id: String(area.id ?? features.length),
      properties: {
        id: String(area.id ?? features.length),
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
 * @param {EntidadeMapa[]} linhas
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildLinhasCollection(linhas) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const linha of linhas || []) {
    if (!linha) continue;
    const ring = parseVertices(linha.coordenadas?.coords);
    const geometry = toGeoJsonLineString(ring);
    if (!geometry) continue;
    const cor = linha.coordenadas?.cor || linha.cor || "#f59e0b";
    features.push({
      type: "Feature",
      id: String(linha.id ?? features.length),
      properties: { id: String(linha.id ?? features.length), cor, nome: linha.nome || "" },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * @param {EntidadeMapa[]} pontos
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildPontosCollection(pontos) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const ponto of pontos || []) {
    if (!ponto) continue;
    const v = parseVertex(ponto.coordenadas);
    if (!v) continue;
    features.push({
      type: "Feature",
      id: String(ponto.id ?? features.length),
      properties: {
        id: String(ponto.id ?? features.length),
        cor: ponto.cor || "#0066ff",
        nome: ponto.nome || "",
        icone_url: ponto.icone_url || null,
      },
      geometry: { type: "Point", coordinates: latLngToLngLat(v) },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * @param {{ lat: number, lng: number }[]} points
 * @param {'area' | 'linha' | 'ponto'} tipo
 * @param {{ lat: number, lng: number } | null} [marker]
 * @param {{ cor?: string | null, fechado?: boolean }} [opts]
 *   `cor`: cor salva da área em edição (preenchimento e contorno na cor real,
 *   +5% branco; sem cor = laranja de rascunho).
 *   `fechado`: false = rascunho aberto — preenchimento sutil sem o lado de fecho,
 *   contorno só na polilinha (referência `camada-desenho.tsx`). Padrão true.
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildDesenhoCollection(points, tipo, marker = null, opts = {}) {
  const fechado = opts.fechado !== false;
  const fill = opts.cor && fechado ? corExibidaNoMapa(opts.cor) : null;
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  if (tipo === "area") {
    const geometry = toGeoJsonPolygon(points);
    if (geometry) {
      /** @type {Record<string, unknown>} */
      const properties = { id: "desenho", fechado, contorno: fechado };
      if (fill) properties.fill = fill;
      features.push({ type: "Feature", id: "desenho", properties, geometry });
    }
    if (!fechado || !geometry) {
      const line = points.length >= 2 ? toGeoJsonLineString(points) : null;
      if (line) {
        features.push({
          type: "Feature",
          id: geometry ? "desenho-contorno" : "desenho",
          properties: { id: geometry ? "desenho-contorno" : "desenho", contorno: true },
          geometry: line,
        });
      }
    }
  } else if (tipo === "linha") {
    const geometry = toGeoJsonLineString(points);
    if (geometry) {
      features.push({
        type: "Feature",
        id: "desenho",
        properties: { id: "desenho", contorno: true },
        geometry,
      });
    }
  } else if (tipo === "ponto" && marker) {
    const v = parseVertex(marker);
    if (v) {
      features.push({
        type: "Feature",
        id: "desenho-ponto",
        properties: { id: "desenho-ponto" },
        geometry: { type: "Point", coordinates: latLngToLngLat(v) },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/**
 * @param {{ lat: number, lng: number }[]} points
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildVerticesCollection(points) {
  return {
    type: "FeatureCollection",
    features: (points || []).map((p, i) => ({
      type: "Feature",
      id: `v-${i}`,
      properties: { id: `v-${i}`, index: i, role: "vertex" },
      geometry: { type: "Point", coordinates: latLngToLngLat(p) },
    })),
  };
}

/**
 * @param {{ lat: number, lng: number }[]} points
 * @param {'area' | 'linha'} tipo
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildMidpointsCollection(points, tipo) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  if (!points || points.length < 2) return { type: "FeatureCollection", features };
  const segCount = tipo === "area" ? points.length : points.length - 1;
  for (let i = 0; i < segCount; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    features.push({
      type: "Feature",
      id: `m-${i}`,
      properties: { id: `m-${i}`, index: i, role: "midpoint" },
      geometry: { type: "Point", coordinates: latLngToLngLat(mid) },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Feições transitórias do cursor no editor (source GUIA), por `tipo`:
 * `elastico` (último ponto → cursor), `shift` (guia adicional do 45°) e
 * `ima-aresta` (lado sob o ímã). Só apresentação — nunca persiste.
 * @param {{ lat: number, lng: number } | null} from
 * @param {{ lat: number, lng: number } | null} to
 * @param {{ shiftAte?: { lat: number, lng: number } | null, imaAresta?: [{ lat: number, lng: number }, { lat: number, lng: number }] | null }} [opts]
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildGuiaCollection(from, to, opts = {}) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  const linha = (id, tipo, a, b) =>
    features.push({
      type: "Feature",
      id,
      properties: { id, tipo },
      geometry: { type: "LineString", coordinates: [latLngToLngLat(a), latLngToLngLat(b)] },
    });
  if (opts.imaAresta && opts.imaAresta[0] && opts.imaAresta[1]) linha("ima-aresta", "ima-aresta", opts.imaAresta[0], opts.imaAresta[1]);
  if (from && to) {
    linha("guia", "elastico", from, to);
    if (opts.shiftAte) linha("guia-shift", "shift", from, opts.shiftAte);
  }
  return { type: "FeatureCollection", features };
}

export {
  buildAccuracyCircleCollection,
  buildUserPointCollection,
} from "./gpsCapture.js";

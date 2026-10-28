/**
 * Adapters de coordenadas do cadastro geográfico (SSOT persistido) ↔ GeoJSON/MapLibre.
 *
 * Persistência: `{ coords: [[lat, lng], ...], cor }` (e variantes históricas `{lat,lng}`).
 * MapLibre/GeoJSON: `[lng, lat]` com anel de Polygon fechado.
 *
 * Nunca use `x || y` para ler coordenadas — 0 é valor geográfico válido.
 */

/** @typedef {{ lat: number, lng: number }} LatLng */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {boolean}
 */
export function isValidLatLng(lat, lng) {
  return isFiniteNumber(lat) && isFiniteNumber(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Aceita `[lat, lng]`, `{ lat, lng }` ou `{ latitude, longitude }`.
 * Distingue 0 de null/undefined — nunca `||`.
 * @param {unknown} raw
 * @returns {LatLng | null}
 */
export function parseVertex(raw) {
  if (raw == null) return null;

  if (Array.isArray(raw)) {
    if (raw.length < 2) return null;
    const lat = raw[0];
    const lng = raw[1];
    if (!isValidLatLng(lat, lng)) return null;
    return { lat, lng };
  }

  if (typeof raw === "object") {
    const obj = /** @type {Record<string, unknown>} */ (raw);
    const lat = obj.lat ?? obj.latitude;
    const lng = obj.lng ?? obj.longitude;
    if (!isValidLatLng(/** @type {number} */ (lat), /** @type {number} */ (lng))) return null;
    return { lat: /** @type {number} */ (lat), lng: /** @type {number} */ (lng) };
  }

  return null;
}

/**
 * @param {unknown} list
 * @returns {LatLng[]}
 */
export function parseVertices(list) {
  if (!Array.isArray(list)) return [];
  /** @type {LatLng[]} */
  const out = [];
  for (const item of list) {
    const v = parseVertex(item);
    if (v) out.push(v);
  }
  return out;
}

/**
 * @param {LatLng} point
 * @returns {[number, number]}
 */
export function latLngToLngLat(point) {
  return [point.lng, point.lat];
}

/**
 * @param {[number, number] | number[]} pair
 * @returns {LatLng | null}
 */
export function lngLatToLatLng(pair) {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const lng = pair[0];
  const lat = pair[1];
  if (!isValidLatLng(lat, lng)) return null;
  return { lat, lng };
}

/**
 * Payload persistido: `[[lat, lng], ...]` sem vértice de fechamento duplicado.
 * @param {LatLng[]} points
 * @returns {[number, number][]}
 */
export function toPersistedCoords(points) {
  const parsed = Array.isArray(points) ? points.map(parseVertex).filter(Boolean) : [];
  /** @type {[number, number][]} */
  const coords = parsed.map((p) => [/** @type {LatLng} */ (p).lat, /** @type {LatLng} */ (p).lng]);
  if (coords.length >= 2) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) {
      coords.pop();
    }
  }
  return coords;
}

/**
 * Anel GeoJSON aberto (sem closing vertex) em `[lng, lat]`.
 * @param {LatLng[]} points
 * @returns {[number, number][]}
 */
export function toOpenRingLngLat(points) {
  return toPersistedCoords(points).map(([lat, lng]) => [lng, lat]);
}

/**
 * Polygon GeoJSON com anel fechado. Requer ≥3 vértices distintos.
 * @param {LatLng[]} points
 * @returns {import('geojson').Polygon | null}
 */
export function toGeoJsonPolygon(points) {
  const ring = toOpenRingLngLat(points);
  if (ring.length < 3) return null;
  const first = ring[0];
  const closed = [...ring, [first[0], first[1]]];
  return { type: "Polygon", coordinates: [closed] };
}

/**
 * LineString GeoJSON. Requer ≥2 vértices.
 * @param {LatLng[]} points
 * @returns {import('geojson').LineString | null}
 */
export function toGeoJsonLineString(points) {
  const coords = toOpenRingLngLat(points);
  if (coords.length < 2) return null;
  return { type: "LineString", coordinates: coords };
}

/**
 * Point GeoJSON.
 * @param {LatLng | null | undefined} point
 * @returns {import('geojson').Point | null}
 */
export function toGeoJsonPoint(point) {
  const v = parseVertex(point);
  if (!v) return null;
  return { type: "Point", coordinates: latLngToLngLat(v) };
}

/**
 * Round-trip: lat/lng → lng/lat → lat/lng sem deriva além da precisão flutuante.
 * @param {LatLng} point
 * @returns {LatLng | null}
 */
export function roundTripLatLng(point) {
  const v = parseVertex(point);
  if (!v) return null;
  return lngLatToLatLng(latLngToLngLat(v));
}

/**
 * Remove closing vertex duplicado se presente; preserva ordem.
 * @param {LatLng[]} points
 * @returns {LatLng[]}
 */
export function stripClosingVertex(points) {
  const parsed = parseVertices(points);
  if (parsed.length < 2) return parsed;
  const a = parsed[0];
  const z = parsed[parsed.length - 1];
  if (a.lat === z.lat && a.lng === z.lng) return parsed.slice(0, -1);
  return parsed;
}

/**
 * Verifica ≥3 vértices distintos (após strip do closing).
 * @param {LatLng[]} points
 * @returns {boolean}
 */
export function isValidPolygonRing(points) {
  const ring = stripClosingVertex(points);
  if (ring.length < 3) return false;
  const key = (p) => `${p.lat},${p.lng}`;
  const unique = new Set(ring.map(key));
  return unique.size >= 3;
}

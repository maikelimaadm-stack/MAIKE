/**
 * Helpers puros da captura GPS (M2-A).
 * Sem dependência de React/MapLibre — testáveis com mock de Geolocation.
 */
import { isFiniteNumber, isValidLatLng } from "@/lib/geografia/coords.js";

/** Precisão acima deste limiar gera aviso (não bloqueia marcar). */
export const PRECISAO_AVISO_METROS = 30;

/** Leitura com age maior que isto é tratada como desatualizada. */
export const MAX_AGE_AVISO_MS = 15_000;

export const GPS_SOURCE_IDS = Object.freeze({
  ACCURACY: "m2a-gps-accuracy",
  USER: "m2a-gps-user",
  DESENHO: "m2a-gps-desenho",
  VERTICES: "m2a-gps-vertices",
});

export const GPS_LAYER_IDS = Object.freeze({
  ACCURACY_FILL: "m2a-gps-accuracy-fill",
  ACCURACY_LINE: "m2a-gps-accuracy-line",
  USER: "m2a-gps-user",
  DESENHO_FILL: "m2a-gps-desenho-fill",
  DESENHO_LINE: "m2a-gps-desenho-line",
  VERTICES: "m2a-gps-vertices",
});

/**
 * clearWatch seguro inclusive quando o id é 0.
 * @param {number | null | undefined} watchId
 * @param {{ clearWatch?: (id: number) => void } | null | undefined} [geo]
 */
export function clearGeolocationWatch(watchId, geo = typeof navigator !== "undefined" ? navigator.geolocation : null) {
  if (watchId === null || watchId === undefined) return false;
  if (!geo || typeof geo.clearWatch !== "function") return false;
  geo.clearWatch(watchId);
  return true;
}

/**
 * @param {GeolocationPosition | { coords?: { latitude?: unknown, longitude?: unknown, accuracy?: unknown }, timestamp?: unknown } | null | undefined} position
 * @param {{ now?: number }} [opts]
 * @returns {{ lat: number, lng: number, accuracy: number | null, timestamp: number, stale: boolean } | null}
 */
export function parseGeolocationPosition(position, opts = {}) {
  if (!position || typeof position !== "object") return null;
  const coords = /** @type {{ latitude?: unknown, longitude?: unknown, accuracy?: unknown }} */ (
    position.coords || {}
  );
  const lat = coords.latitude;
  const lng = coords.longitude;
  if (!isValidLatLng(/** @type {number} */ (lat), /** @type {number} */ (lng))) return null;

  const accuracyRaw = coords.accuracy;
  const accuracy =
    isFiniteNumber(/** @type {number} */ (accuracyRaw)) && /** @type {number} */ (accuracyRaw) >= 0
      ? /** @type {number} */ (accuracyRaw)
      : null;

  const tsRaw = position.timestamp;
  const timestamp = isFiniteNumber(/** @type {number} */ (tsRaw))
    ? /** @type {number} */ (tsRaw)
    : Date.now();
  const now = isFiniteNumber(opts.now) ? /** @type {number} */ (opts.now) : Date.now();
  const stale = now - timestamp > MAX_AGE_AVISO_MS;

  return {
    lat: /** @type {number} */ (lat),
    lng: /** @type {number} */ (lng),
    accuracy,
    timestamp,
    stale,
  };
}

/**
 * Mensagem honesta em português para erros de Geolocation.
 * @param {GeolocationPositionError | { code?: number, message?: string } | null | undefined} error
 * @returns {string}
 */
export function mensagemErroGeolocation(error) {
  if (!error) return "Erro desconhecido no GPS.";
  const code = error.code;
  if (code === 1) return "Permissão de localização negada. Ative o GPS nas configurações do navegador.";
  if (code === 2) return "Localização indisponível no momento. Verifique o sinal do GPS.";
  if (code === 3) return "Tempo esgotado ao obter a localização. Tente novamente.";
  if (typeof error.message === "string" && error.message.trim()) {
    return `Erro no GPS: ${error.message}`;
  }
  return "Erro no GPS.";
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checarSuporteGeolocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ok: false, reason: "GPS não disponível neste dispositivo ou navegador." };
  }
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return {
      ok: false,
      reason: "Geolocalização exige HTTPS (ou localhost). Abra o app em um contexto seguro.",
    };
  }
  return { ok: true };
}

/**
 * @param {number | null | undefined} accuracy
 * @returns {boolean}
 */
export function precisaoRuim(accuracy) {
  return isFiniteNumber(accuracy) && /** @type {number} */ (accuracy) > PRECISAO_AVISO_METROS;
}

/**
 * Círculo aproximado em [lng,lat] a partir de centro + raio em metros.
 * @param {{ lat: number, lng: number }} center
 * @param {number} radiusMeters
 * @param {number} [steps]
 * @returns {[number, number][]}
 */
export function buildAccuracyRingLngLat(center, radiusMeters, steps = 64) {
  if (!center || !isValidLatLng(center.lat, center.lng)) return [];
  if (!isFiniteNumber(radiusMeters) || radiusMeters <= 0) return [];
  const latRad = (center.lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.max(1e-6, 111_320 * Math.cos(latRad));
  /** @type {[number, number][]} */
  const ring = [];
  const n = Math.max(8, Math.min(128, Math.floor(steps)));
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2;
    const dLat = (radiusMeters * Math.cos(a)) / metersPerDegLat;
    const dLng = (radiusMeters * Math.sin(a)) / metersPerDegLng;
    ring.push([center.lng + dLng, center.lat + dLat]);
  }
  return ring;
}

/**
 * @param {{ lat: number, lng: number } | null | undefined} center
 * @param {number | null | undefined} accuracyMeters
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildAccuracyCircleCollection(center, accuracyMeters) {
  if (!center || !isFiniteNumber(accuracyMeters) || /** @type {number} */ (accuracyMeters) <= 0) {
    return { type: "FeatureCollection", features: [] };
  }
  const ring = buildAccuracyRingLngLat(center, /** @type {number} */ (accuracyMeters));
  if (ring.length < 4) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "accuracy",
        properties: { id: "accuracy", meters: accuracyMeters },
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  };
}

/**
 * @param {{ lat: number, lng: number } | null | undefined} center
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildUserPointCollection(center) {
  if (!center || !isValidLatLng(center.lat, center.lng)) {
    return { type: "FeatureCollection", features: [] };
  }
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "user",
        properties: { id: "user" },
        geometry: { type: "Point", coordinates: [center.lng, center.lat] },
      },
    ],
  };
}

const EMPTY_FC = Object.freeze({ type: "FeatureCollection", features: [] });
const COR_AREA_DEFAULT = "#10b981";

/**
 * Sources/layers dedicados à captura GPS (M2-A).
 * Idempotente — seguro após setStyle / retry.
 * @param {{ getSource: (id: string) => unknown, addSource: (id: string, spec: object) => void, getLayer: (id: string) => unknown, addLayer: (layer: object) => void }} map
 * @param {{ corArea?: string, corLinha?: string }} [opts]
 */
export function ensureGpsCaptureLayers(map, opts = {}) {
  const corArea = opts.corArea || COR_AREA_DEFAULT;
  const ensureSource = (id) => {
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: EMPTY_FC });
    }
  };

  ensureSource(GPS_SOURCE_IDS.ACCURACY);
  ensureSource(GPS_SOURCE_IDS.USER);
  ensureSource(GPS_SOURCE_IDS.DESENHO);
  ensureSource(GPS_SOURCE_IDS.VERTICES);

  if (!map.getLayer(GPS_LAYER_IDS.ACCURACY_FILL)) {
    map.addLayer({
      id: GPS_LAYER_IDS.ACCURACY_FILL,
      type: "fill",
      source: GPS_SOURCE_IDS.ACCURACY,
      paint: { "fill-color": "#4285F4", "fill-opacity": 0.15 },
    });
  }
  if (!map.getLayer(GPS_LAYER_IDS.ACCURACY_LINE)) {
    map.addLayer({
      id: GPS_LAYER_IDS.ACCURACY_LINE,
      type: "line",
      source: GPS_SOURCE_IDS.ACCURACY,
      paint: { "line-color": "#4285F4", "line-opacity": 0.35, "line-width": 1 },
    });
  }
  if (!map.getLayer(GPS_LAYER_IDS.DESENHO_FILL)) {
    map.addLayer({
      id: GPS_LAYER_IDS.DESENHO_FILL,
      type: "fill",
      source: GPS_SOURCE_IDS.DESENHO,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": corArea, "fill-opacity": 0.3 },
    });
  }
  if (!map.getLayer(GPS_LAYER_IDS.DESENHO_LINE)) {
    map.addLayer({
      id: GPS_LAYER_IDS.DESENHO_LINE,
      type: "line",
      source: GPS_SOURCE_IDS.DESENHO,
      paint: {
        "line-color": ["coalesce", ["get", "cor"], corArea],
        "line-width": 3,
        "line-opacity": 1,
      },
    });
  }
  if (!map.getLayer(GPS_LAYER_IDS.USER)) {
    map.addLayer({
      id: GPS_LAYER_IDS.USER,
      type: "circle",
      source: GPS_SOURCE_IDS.USER,
      paint: {
        "circle-radius": 10,
        "circle-color": "#4285F4",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
  }
  if (!map.getLayer(GPS_LAYER_IDS.VERTICES)) {
    map.addLayer({
      id: GPS_LAYER_IDS.VERTICES,
      type: "circle",
      source: GPS_SOURCE_IDS.VERTICES,
      paint: {
        "circle-radius": 9,
        "circle-color": ["coalesce", ["get", "cor"], corArea],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 3,
      },
    });
  }
}

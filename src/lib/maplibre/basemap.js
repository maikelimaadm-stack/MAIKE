/**
 * Provider de mapa-base (SSOT) para o editor MapLibre do Cadastro de Áreas (M1).
 *
 * - `ruas`: OpenFreeMap Liberty (público, atribuição OSM/OpenFreeMap).
 * - `satelite`: só ativa com URL de estilo licenciada via env; sem isso o UI
 *   deve informar "satélite não configurado" — nunca fingir satélite.
 *
 * Env `VITE_*` só é lida em `src/config/runtimeConfig.js` (referência estática).
 */
import { getMapSatelliteStyleUrl } from "@/config/runtimeConfig";

export const BASEMAP_IDS = Object.freeze({
  RUAS: "ruas",
  SATELITE: "satelite",
});

/** Style público documentado — OpenFreeMap Liberty. */
export const OPENFREEMAP_LIBERTY_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

const ATRIBUICAO_RUAS =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>';

/**
 * Lê a URL de estilo satélite de build (pública). Vazia = não configurado.
 * @returns {string}
 */
export function getSatelliteStyleUrl() {
  return getMapSatelliteStyleUrl() || "";
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isValidStyleUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * @typedef {{ id: string, label: string, styleUrl: string | null, attribution: string, configured: boolean, unavailableReason: string | null }} BasemapProvider
 */

/** @type {BasemapProvider} */
export const PROVIDER_RUAS = Object.freeze({
  id: BASEMAP_IDS.RUAS,
  label: "Mapa",
  styleUrl: OPENFREEMAP_LIBERTY_STYLE_URL,
  attribution: ATRIBUICAO_RUAS,
  configured: true,
  unavailableReason: null,
});

/**
 * @returns {BasemapProvider}
 */
export function getSatelliteProvider() {
  const styleUrl = getSatelliteStyleUrl();
  const configured = isValidStyleUrl(styleUrl);
  return Object.freeze({
    id: BASEMAP_IDS.SATELITE,
    label: "Satélite",
    styleUrl: configured ? styleUrl : null,
    attribution: configured ? "Satélite (estilo contratado)" : "",
    configured,
    unavailableReason: configured
      ? null
      : "Satélite não configurado. Defina VITE_MAP_SATELLITE_STYLE_URL com um style URL licenciado.",
  });
}

/**
 * Resolve provider por id semântico. Fallback seguro: ruas.
 * @param {string} id
 * @returns {BasemapProvider}
 */
export function resolveBasemapProvider(id) {
  if (id === BASEMAP_IDS.SATELITE) {
    const sat = getSatelliteProvider();
    if (sat.configured) return sat;
    return PROVIDER_RUAS;
  }
  return PROVIDER_RUAS;
}

/**
 * Mensagem honesta quando o usuário pede satélite sem licença.
 * @returns {string}
 */
export function mensagemSateliteNaoConfigurado() {
  return "Satélite não configurado";
}

/** Centro inicial (Brasil central — alinhado ao editor legado). */
export const CENTRO_PADRAO = Object.freeze({ lng: -59.9533, lat: -15.0067 });
export const ZOOM_PADRAO = 17;

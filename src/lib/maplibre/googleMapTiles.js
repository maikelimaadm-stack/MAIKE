/**
 * Satélite via Google Map Tiles API (2D raster) — D-PROD-65.
 *
 * Forma permitida de exibir imagens do Google num renderizador de terceiro
 * (MapLibre): sessão (`createSession`) + tiles `2dtiles/{z}/{x}/{y}`. Padrão
 * portado do Controle de Estoque (`basemap.ts`), adaptado a Vite.
 *
 * - Chave: `VITE_GOOGLE_MAPS_API_KEY` (pública por definição; proteção é
 *   restrição de referrer + API no Google Cloud). Nunca registrada em log.
 * - A chave precisa ter a **Map Tiles API** habilitada; ter Maps JavaScript API
 *   não basta. Falha 403 é reportada como tal — sem fingir satélite.
 * - Sessão só em memória (expira pelo campo `expiry`); nenhum tile/sessão é
 *   persistido (política: sem pre-fetch, cache ou storage).
 * - Atribuição: "Google Maps" + `copyright` do endpoint de viewport.
 */
import { getGoogleMapsApiKey } from "@/config/runtimeConfig";

export const MAP_TILES_ORIGIN = "https://tile.googleapis.com";
export const SAT_SOURCE_ID = "maike-basemap-satelite";
export const SAT_LAYER_ID = "maike-basemap-satelite";
export const ATRIBUICAO_GOOGLE = "Google Maps";

/** Margem antes do `expiry` para renovar a sessão. */
const MARGEM_RENOVACAO_MS = 5 * 60 * 1000;

/** @type {Map<string, { session: string, expiresAt: number, tileSize: number }>} */
const sessoes = new Map();
/** @type {Map<string, Promise<SessaoResultado>>} */
const pendentes = new Map();

/**
 * @typedef {{ ok: boolean, session?: string, key?: string, tileSize?: number, expiresAt?: number,
 *   codigo?: string, status?: number | null, mensagem?: string }} SessaoResultado
 *   `ok: true` traz session/key/tileSize/expiresAt; `ok: false` traz codigo/status/mensagem.
 */

/** @returns {string} */
export function chaveMapTiles() {
  return getGoogleMapsApiKey() || "";
}

/** @returns {boolean} */
export function mapTilesConfigurado() {
  return chaveMapTiles() !== "";
}

/**
 * Mensagem honesta por status HTTP da Map Tiles API.
 * @param {number | null} status
 * @returns {{ codigo: string, mensagem: string }}
 */
export function classificarFalhaMapTiles(status) {
  if (status === 400) return { codigo: "MAP_TILES_BAD_REQUEST", mensagem: "Satélite indisponível: requisição recusada pelo provedor (400)." };
  if (status === 401 || status === 403)
    return {
      codigo: "MAP_TILES_FORBIDDEN",
      mensagem:
        "Satélite indisponível: a chave não tem acesso à Map Tiles API (habilite a API e confira as restrições da chave).",
    };
  if (status === 429) return { codigo: "MAP_TILES_QUOTA", mensagem: "Satélite indisponível: cota do provedor excedida (429). Tente mais tarde." };
  if (status != null && status >= 500) return { codigo: "MAP_TILES_UPSTREAM", mensagem: "Satélite indisponível: falha no provedor de imagens." };
  return { codigo: "MAP_TILES_NETWORK", mensagem: "Satélite indisponível: sem conexão com o provedor de imagens." };
}

/**
 * Converte `expiry` (segundos epoch, string) em ms; inválido → 1h.
 * @param {unknown} expiry
 * @param {number} agora
 */
export function expiryParaMs(expiry, agora = Date.now()) {
  const s = Number(expiry);
  return Number.isFinite(s) && s > 0 ? s * 1000 : agora + 60 * 60 * 1000;
}

/**
 * Cria (ou reaproveita, se válida) a sessão de tiles para `mapType`.
 * @param {{ mapType?: "satellite" | "roadmap", fetchImpl?: typeof fetch, agora?: () => number, forcar?: boolean }} [opts]
 * @returns {Promise<SessaoResultado>}
 */
export async function obterSessaoMapTiles(opts = {}) {
  const mapType = opts.mapType || "satellite";
  const agora = opts.agora || Date.now;
  const key = chaveMapTiles();
  if (!key) {
    return { ok: false, codigo: "MAP_TILES_SEM_CHAVE", status: null, mensagem: "Satélite não configurado: defina VITE_GOOGLE_MAPS_API_KEY com acesso à Map Tiles API." };
  }
  const cacheKey = `${mapType}|${key}`;
  const atual = sessoes.get(cacheKey);
  if (!opts.forcar && atual && atual.expiresAt - MARGEM_RENOVACAO_MS > agora()) {
    return { ok: true, session: atual.session, key, tileSize: atual.tileSize, expiresAt: atual.expiresAt };
  }
  if (!opts.forcar && pendentes.has(cacheKey)) return /** @type {Promise<SessaoResultado>} */ (pendentes.get(cacheKey));

  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const run = (async () => {
    if (!fetchImpl) return { ok: false, ...classificarFalhaMapTiles(null), status: null };
    let resp;
    try {
      resp = await fetchImpl(`${MAP_TILES_ORIGIN}/v1/createSession?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapType, language: "pt-BR", region: "BR" }),
      });
    } catch {
      return { ok: false, ...classificarFalhaMapTiles(null), status: null };
    }
    if (!resp || !resp.ok) {
      const status = resp ? resp.status : null;
      return { ok: false, ...classificarFalhaMapTiles(status), status };
    }
    let json;
    try {
      json = await resp.json();
    } catch {
      return { ok: false, ...classificarFalhaMapTiles(502), status: 502 };
    }
    if (!json || typeof json.session !== "string" || !json.session) {
      return { ok: false, ...classificarFalhaMapTiles(502), status: 502 };
    }
    const tileSize = Number(json.tileWidth) > 0 ? Number(json.tileWidth) : 256;
    const expiresAt = expiryParaMs(json.expiry, agora());
    sessoes.set(cacheKey, { session: json.session, expiresAt, tileSize });
    return { ok: true, session: json.session, key, tileSize, expiresAt };
  })();
  pendentes.set(cacheKey, run);
  try {
    return await run;
  } finally {
    pendentes.delete(cacheKey);
  }
}

/** Descarta sessões em memória (ex.: após 401/403 de tile). Exposto para testes. */
export function descartarSessoesMapTiles() {
  sessoes.clear();
  pendentes.clear();
}

/**
 * Fonte raster MapLibre para a sessão.
 * @param {{ session: string, key: string, tileSize?: number }} s
 */
export function fonteRasterMapTiles(s) {
  return {
    type: "raster",
    tiles: [
      `${MAP_TILES_ORIGIN}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(s.session)}&key=${encodeURIComponent(s.key)}`,
    ],
    tileSize: s.tileSize || 256,
    maxzoom: 22,
    attribution: ATRIBUICAO_GOOGLE,
  };
}

/**
 * URL do endpoint de viewport (copyright dinâmico).
 * @param {{ session: string, key: string }} s
 * @param {{ zoom: number, north: number, south: number, east: number, west: number }} v
 */
export function urlViewportMapTiles(s, v) {
  const clampLat = (n) => Math.max(-89.999, Math.min(89.999, n));
  const clampLng = (n) => Math.max(-179.999, Math.min(179.999, n));
  const p = new URLSearchParams({
    session: s.session,
    key: s.key,
    zoom: String(Math.max(0, Math.min(22, Math.round(v.zoom)))),
    north: String(clampLat(v.north)),
    south: String(clampLat(v.south)),
    east: String(clampLng(v.east)),
    west: String(clampLng(v.west)),
  });
  return `${MAP_TILES_ORIGIN}/tile/v1/viewport?${p.toString()}`;
}

/**
 * Texto de atribuição exibido: "Google Maps" + copyright de terceiros.
 * @param {string | null | undefined} copyright
 */
export function textoAtribuicaoGoogle(copyright) {
  const c = typeof copyright === "string" ? copyright.trim() : "";
  return c ? `${ATRIBUICAO_GOOGLE} · ${c}` : ATRIBUICAO_GOOGLE;
}

/**
 * MapLibre M2-B3 — helpers puros do seletor de depósito (D-PROD-64).
 *
 * Sem DOM e sem SDK de mapa: filtragem de depósitos, associação de ícone,
 * GeoJSON da linha cocho→depósito, distância geodésica (Turf via medidas.js)
 * e dimensionamento de ícone preservando aspecto.
 */
import { parseVertex } from "@/lib/geografia/coords.js";
import { comprimentoMetros } from "@/lib/geografia/medidas.js";
import { normalizeText } from "@/components/suplementacao/estoqueSuplementacaoUtils";

export const DEPOSITO_SOURCE_IDS = Object.freeze({
  LINHA: "maike-deposito-linha",
});

export const DEPOSITO_LAYER_IDS = Object.freeze({
  LINHA_BASE: "maike-deposito-linha-base",
  LINHA_TRACO: "maike-deposito-linha-traco",
});

export const DEPOSITO_CORES = Object.freeze({
  COCHO: "#16a34a",
  DEPOSITO: "#dc2626",
  SELECIONADO: "#2563eb",
  DESTAQUE: "#f59e0b",
});

export const ICONE_TAMANHO = Object.freeze({ BASE: 42, DESTAQUE: 50, MIN: 20 });

/** @typedef {{ lat: number, lng: number }} LatLng */

/**
 * Filtra pontos de suplementação válidos como depósito da empresa atual.
 * Zero é coordenada válida; inválidas são descartadas sem NaN.
 * Duplicatas por id: mantém a primeira ocorrência (ordem da API).
 * @param {any[]} pontosSuplementacao
 * @param {any[]} pontosReferencia
 * @param {string | null | undefined} empresaId
 * @returns {Array<Record<string, any> & { coords: LatLng, icone_url: string | null }>}
 */
export function buildDepositos(pontosSuplementacao, pontosReferencia, empresaId) {
  if (!empresaId || !Array.isArray(pontosSuplementacao)) return [];
  const refs = Array.isArray(pontosReferencia)
    ? pontosReferencia.filter(
        (p) => p && p.empresa_id === empresaId && p.ativo !== false
      )
    : [];

  const vistos = new Set();
  /** @type {Array<Record<string, any> & { coords: LatLng, icone_url: string | null }>} */
  const out = [];
  for (const ponto of pontosSuplementacao) {
    if (!ponto || typeof ponto !== "object") continue;
    const p = /** @type {Record<string, any>} */ (ponto);
    if (p.empresa_id !== empresaId || p.status !== "Ativo") continue;
    if (normalizeText(p.categoria_ponto) !== "DEPOSITO") continue;
    if (p.id == null || vistos.has(p.id)) continue;
    const coords = parseVertex(p.coordenadas);
    if (!coords) continue;
    vistos.add(p.id);
    out.push({ ...p, coords, icone_url: matchIconeReferencia(p, refs) });
  }
  return out;
}

/**
 * Política legada preservada: primeira referência (ordem da API) cujo nome
 * normalizado bate com `nome_ponto` OU cuja sigla bate (só se o depósito tem sigla).
 * @param {Record<string, any>} deposito
 * @param {Array<Record<string, any>>} refs já filtradas por empresa/ativo
 * @returns {string | null}
 */
export function matchIconeReferencia(deposito, refs) {
  const nome = normalizeText(deposito.nome_ponto || "");
  const sigla = deposito.sigla ? normalizeText(deposito.sigla) : "";
  const ref = refs.find((r) => {
    const mesmoNome = normalizeText(r.nome || "") === nome;
    const mesmaSigla = !!sigla && normalizeText(r.sigla || "") === sigla;
    return mesmoNome || mesmaSigla;
  });
  const url = ref?.icone_url;
  return typeof url === "string" && url.trim() ? url : null;
}

/**
 * Distância geodésica em metros entre cocho e depósito, ou null se inválido.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number | null}
 */
export function distanciaCochoDeposito(a, b) {
  const pa = parseVertex(a);
  const pb = parseVertex(b);
  if (!pa || !pb) return null;
  if (pa.lat === pb.lat && pa.lng === pb.lng) return 0;
  const m = comprimentoMetros([pa, pb]);
  return Number.isFinite(m) ? m : null;
}

/**
 * @param {number | null} metros
 * @returns {string}
 */
export function formatDistanciaMetros(metros) {
  if (metros == null || !Number.isFinite(metros)) return "";
  return `${metros.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m`;
}

/**
 * FeatureCollection da linha cocho→depósito ([lng,lat]).
 * @param {unknown} cocho
 * @param {unknown} deposito
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildLinhaCollection(cocho, deposito) {
  const pa = parseVertex(cocho);
  const pb = parseVertex(deposito);
  if (!pa || !pb) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [pa.lng, pa.lat],
            [pb.lng, pb.lat],
          ],
        },
      },
    ],
  };
}

/**
 * Pontos para fitBounds ([lng,lat]).
 * @param {unknown} cocho
 * @param {Array<{ coords: LatLng }>} depositos
 * @returns {[number, number][]}
 */
export function boundsLngLats(cocho, depositos) {
  /** @type {[number, number][]} */
  const out = [];
  const c = parseVertex(cocho);
  if (c) out.push([c.lng, c.lat]);
  for (const d of depositos || []) {
    if (d?.coords) out.push([d.coords.lng, d.coords.lat]);
  }
  return out;
}

/**
 * Dimensão do ícone preservando aspecto (mesma regra do legado).
 * @param {number} naturalWidth
 * @param {number} naturalHeight
 * @param {number} [baseSize]
 * @returns {{ width: number, height: number }}
 */
export function iconSizePreservingAspect(naturalWidth, naturalHeight, baseSize = ICONE_TAMANHO.BASE) {
  const w = naturalWidth > 0 ? naturalWidth : baseSize;
  const h = naturalHeight > 0 ? naturalHeight : baseSize;
  const ratio = w / h;
  if (ratio >= 1) {
    return { width: baseSize, height: Math.max(ICONE_TAMANHO.MIN, Math.round(baseSize / ratio)) };
  }
  return { width: Math.max(ICONE_TAMANHO.MIN, Math.round(baseSize * ratio)), height: baseSize };
}

/**
 * Estado visual de um depósito.
 * @param {unknown} id
 * @param {unknown} selecionadoId
 * @param {unknown} destaqueId
 * @returns {"selecionado" | "destaque" | "normal"}
 */
export function estadoDeposito(id, selecionadoId, destaqueId) {
  if (selecionadoId != null && id === selecionadoId) return "selecionado";
  if (destaqueId != null && id === destaqueId) return "destaque";
  return "normal";
}

/**
 * Garante source/layers da linha (idempotente; reaplicável após setStyle).
 * @param {{ getSource: Function, addSource: Function, getLayer: Function, addLayer: Function }} map
 */
export function ensureDepositoLayers(map) {
  if (!map.getSource(DEPOSITO_SOURCE_IDS.LINHA)) {
    map.addSource(DEPOSITO_SOURCE_IDS.LINHA, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer(DEPOSITO_LAYER_IDS.LINHA_BASE)) {
    map.addLayer({
      id: DEPOSITO_LAYER_IDS.LINHA_BASE,
      type: "line",
      source: DEPOSITO_SOURCE_IDS.LINHA,
      paint: { "line-color": DEPOSITO_CORES.DESTAQUE, "line-width": 3, "line-opacity": 0.9 },
    });
  }
  if (!map.getLayer(DEPOSITO_LAYER_IDS.LINHA_TRACO)) {
    map.addLayer({
      id: DEPOSITO_LAYER_IDS.LINHA_TRACO,
      type: "line",
      source: DEPOSITO_SOURCE_IDS.LINHA,
      paint: { "line-color": "#ffffff", "line-width": 1.5, "line-dasharray": [2, 3] },
    });
  }
}

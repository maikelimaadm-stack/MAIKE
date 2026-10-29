/**
 * Mapa Geral sobre MapLibre — helpers puros (D-PROD-65).
 *
 * Estilo das áreas é o MESMO SSOT do editor (`estiloAreas.js`): cor salva
 * (+5% branco), divisa branca fina por zoom, destaque por feature-state.
 * Coordenadas persistidas `[[lat,lng],…]` → GeoJSON `[lng,lat]` só aqui; zero
 * é coordenada válida (nada de `c[0] || c.lat`).
 */
import { parseVertex, parseVertices, toGeoJsonLineString, toGeoJsonPolygon } from "@/lib/geografia/coords.js";
import { corExibidaNoMapa, paintAreaDestaque, paintAreaDivisa, paintAreaFill } from "./estiloAreas.js";
import { pointInPolygonRing, safeCentroid } from "./taskLocationPicker.js";

export const MG_SOURCE_IDS = Object.freeze({
  AREAS: "mg-areas",
  LINHAS: "mg-linhas",
  USER: "mg-user",
});

export const MG_LAYER_IDS = Object.freeze({
  AREAS_FILL: "mg-areas-fill",
  AREAS_LINE: "mg-areas-line",
  AREAS_DESTAQUE: "mg-areas-destaque",
  LINHAS: "mg-linhas",
  USER_FILL: "mg-user-fill",
  USER_LINE: "mg-user-line",
});

const vazio = () => ({ type: "FeatureCollection", features: [] });

/**
 * Cor da área no Mapa Geral: modo de coloração (se houver) senão a cor salva.
 * @param {any} area
 * @param {((a: any) => string | null) | null | undefined} colorFn
 */
export function corDaAreaNoMapaGeral(area, colorFn) {
  const salva = area?.coordenadas?.cor || area?.cor || "#61aad9";
  const modo = typeof colorFn === "function" ? colorFn(area) : null;
  return modo || salva;
}

/**
 * @param {any[]} areas
 * @param {((a: any) => string | null) | null} [colorFn]
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildMgAreasCollection(areas, colorFn = null) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const area of areas || []) {
    if (!area || area.id == null) continue;
    const geometry = toGeoJsonPolygon(parseVertices(area.coordenadas?.coords));
    if (!geometry) continue;
    const cor = corDaAreaNoMapaGeral(area, colorFn);
    features.push({
      type: "Feature",
      id: String(area.id),
      properties: { id: String(area.id), nome: area.nome || "", cor, fill: corExibidaNoMapa(cor) },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * @param {any[]} linhas
 * @returns {GeoJSON.FeatureCollection}
 */
export function buildMgLinhasCollection(linhas) {
  /** @type {GeoJSON.Feature[]} */
  const features = [];
  for (const linha of linhas || []) {
    if (!linha || linha.id == null) continue;
    const geometry = toGeoJsonLineString(parseVertices(linha.coordenadas?.coords));
    if (!geometry) continue;
    features.push({
      type: "Feature",
      id: String(linha.id),
      properties: { id: String(linha.id), cor: linha.coordenadas?.cor || linha.cor || "#f59e0b" },
      geometry,
    });
  }
  return { type: "FeatureCollection", features };
}

/** Centroide (shoelace) da área; null se geometria inválida. */
export function centroideArea(area) {
  const ring = parseVertices(area?.coordenadas?.coords);
  if (ring.length < 3) return null;
  return pontoRotuloSeguro(ring);
}

/**
 * Ponto para rótulo/ícone SEMPRE dentro do polígono (R1 / GEO-11).
 * Convexo: centroide. Côncavo (U, L…) com centroide fora: varre linhas
 * horizontais e usa o meio do trecho interno mais largo — nunca cai em outro pasto.
 * @param {{ lat: number, lng: number }[]} ring anel aberto válido (≥3)
 * @returns {{ lat: number, lng: number } | null}
 */
export function pontoRotuloSeguro(ring) {
  const c = safeCentroid(ring);
  if (c && pointInPolygonRing(c, ring)) return c;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const p of ring) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  if (!(maxLat > minLat)) return c;
  let melhor = null;
  const FAIXAS = 24;
  for (let k = 1; k < FAIXAS; k += 1) {
    const y = minLat + ((maxLat - minLat) * k) / FAIXAS;
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if ((a.lat > y) !== (b.lat > y)) xs.push(a.lng + ((y - a.lat) * (b.lng - a.lng)) / (b.lat - a.lat));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const largura = xs[i + 1] - xs[i];
      // prefere trechos largos e perto do meio vertical
      const peso = largura * (1 - Math.abs(k / FAIXAS - 0.5));
      if (!melhor || peso > melhor.peso) melhor = { peso, lat: y, lng: (xs[i] + xs[i + 1]) / 2 };
    }
  }
  return melhor ? { lat: melhor.lat, lng: melhor.lng } : c;
}

/** Fonte do rótulo por faixas largas de zoom (sem “pulsar” a cada leve zoom). */
export function fontesRotuloPorZoom(zoom) {
  if (!Number.isFinite(zoom) || zoom < 13) return { nome: 10, ha: 9 };
  if (zoom < 16) return { nome: 11, ha: 10 };
  return { nome: 12, ha: 10.5 };
}

/** "ha 12,34" (área pastejada se houver, senão tamanho); null se ≤ 0. */
export function textoHectares(area) {
  const pastejada = Number(area?.area_pastejada);
  const ha = Number.isFinite(pastejada) && pastejada > 0 ? pastejada : Number(area?.tamanho_hectares);
  if (!Number.isFinite(ha) || ha <= 0) return null;
  return `ha ${ha.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Ícone sem achatar (sem piso no eixo menor). */
export function iconeSemAchatar(naturalWidth, naturalHeight, base) {
  const w = naturalWidth > 0 ? naturalWidth : base;
  const h = naturalHeight > 0 ? naturalHeight : base;
  const r = w / h;
  return r >= 1 ? { width: base, height: Math.max(1, Math.round(base / r)) } : { width: Math.max(1, Math.round(base * r)), height: base };
}

const norm = (v) => String(v ?? "").toUpperCase().trim();
const normAcento = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

/** Mesma resolução de ícone do renderer anterior (ConfiguracaoIcone). */
export function resolverIconePonto(ponto, iconesConfig = []) {
  const cfg =
    iconesConfig.find((ic) => ic.id === ponto.configuracao_icone_id) ||
    iconesConfig.find((ic) => ic.tipo_entidade === "Ponto" && norm(ic.categoria) === norm(ponto.tipo));
  return { iconUrl: cfg?.icone_url || null, cor: cfg?.cor_padrao || ponto.cor || "#0066ff" };
}

export function resolverIconeSuplementacao(ponto, iconesConfig = []) {
  const categoria = norm(ponto.categoria_ponto || ponto.tipo || "COCHO");
  const doTipo = (cat) => iconesConfig.find((ic) => ic.tipo_entidade === "Ponto" && norm(ic.categoria) === cat);
  const cfg = doTipo(categoria) || doTipo(norm(ponto.tipo)) || doTipo("COCHO");
  return { iconUrl: cfg?.icone_url || null, cor: cfg?.cor_padrao || "#10b981", categoria };
}

export function resolverIconeLote(lotesNaArea, iconesConfig = []) {
  const cats = [...new Set(lotesNaArea.map((l) => norm(l.categoria)).filter(Boolean))].sort();
  let cfg = null;
  if (cats.length === 1) {
    cfg = iconesConfig.find((ic) => ic.tipo_entidade === "Lote" && norm(ic.categoria) === cats[0]) || null;
  } else if (cats.length > 1) {
    const validos = iconesConfig
      .filter((ic) => ic.tipo_entidade === "Lote" && norm(ic.categoria) === "MISTO" && Array.isArray(ic.categorias_misto) && ic.categorias_misto.length > 0)
      .filter((c) => cats.every((cat) => c.categorias_misto.map(norm).includes(cat)))
      .sort((a, b) => a.categorias_misto.length - b.categorias_misto.length);
    cfg = validos[0] || null;
  }
  return { iconUrl: cfg?.icone_url || null, categorias: cats.join("|") };
}

const CORES_PRIORIDADE = { Baixa: "#94a3b8", Normal: "#3b82f6", Alta: "#f59e0b", Urgente: "#ef4444" };

export function resolverIconeTarefa(tarefa, iconesConfig = []) {
  const cfg = iconesConfig.find((ic) => ic.tipo_entidade === "Prioridade Tarefa" && normAcento(ic.categoria) === normAcento(tarefa.prioridade));
  return { iconUrl: cfg?.icone_url || null, cor: CORES_PRIORIDADE[tarefa.prioridade] || "#3b82f6" };
}

/**
 * Bounds [lng,lat] de todas as áreas (para o fit inicial).
 * @returns {[[number, number], [number, number]] | null}
 */
export function boundsDasAreas(areas) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const a of areas || []) {
    for (const p of parseVertices(a?.coordenadas?.coords)) {
      if (p.lng < w) w = p.lng;
      if (p.lng > e) e = p.lng;
      if (p.lat < s) s = p.lat;
      if (p.lat > n) n = p.lat;
    }
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

/** Visão salva por empresa; inválida → null. */
export function lerVisaoSalva(raw) {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    const c = parseVertex(v?.center);
    return c && Number.isFinite(v?.zoom) ? { center: c, zoom: v.zoom } : null;
  } catch {
    return null;
  }
}

/**
 * Sources/layers do Mapa Geral — idempotente (reaplicável após setStyle).
 * Ordem: áreas (fill, divisa, destaque) → linhas → localização.
 * @param {any} map
 */
export function ensureMgLayers(map) {
  const src = (id, extra = {}) => {
    if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: vazio(), ...extra });
  };
  src(MG_SOURCE_IDS.AREAS, { promoteId: "id" });
  src(MG_SOURCE_IDS.LINHAS, { promoteId: "id" });
  src(MG_SOURCE_IDS.USER);
  const layer = (spec) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  };
  layer({ id: MG_LAYER_IDS.AREAS_FILL, type: "fill", source: MG_SOURCE_IDS.AREAS, paint: paintAreaFill("fill") });
  layer({ id: MG_LAYER_IDS.AREAS_LINE, type: "line", source: MG_SOURCE_IDS.AREAS, paint: paintAreaDivisa() });
  layer({ id: MG_LAYER_IDS.AREAS_DESTAQUE, type: "line", source: MG_SOURCE_IDS.AREAS, paint: paintAreaDestaque() });
  layer({
    id: MG_LAYER_IDS.LINHAS,
    type: "line",
    source: MG_SOURCE_IDS.LINHAS,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["coalesce", ["get", "cor"], "#f59e0b"], "line-width": 3 },
  });
  layer({ id: MG_LAYER_IDS.USER_FILL, type: "fill", source: MG_SOURCE_IDS.USER, paint: { "fill-color": "#4285F4", "fill-opacity": 0.15 } });
  layer({ id: MG_LAYER_IDS.USER_LINE, type: "line", source: MG_SOURCE_IDS.USER, paint: { "line-color": "#4285F4", "line-opacity": 0.3, "line-width": 1 } });
}

/**
 * Apresentação do cursor do editor (D-PROD-66) — mesmo alvo que o clique usa,
 * para que o que se vê (cruz, ímã, elástico, guia Shift) seja onde o ponto cai.
 * Não altera regras: fechar no 1º ponto, trava 45° e ímã vêm dos módulos
 * existentes (`snap.js`, `editorModos.js`).
 */
import { EDITOR_VISUAL, SOURCE_IDS } from "./estiloAreas.js";
import { buildDesenhoCollection, buildMidpointsCollection, buildVerticesCollection } from "./geojsonBuilders.js";
import { setSourceData } from "./lifecycle.js";
import { travarAngulo45 } from "./editorModos.js";
import { findNearestSnapDetalhado, isNearFirstVertex } from "./snap.js";

/**
 * Rumo em graus (0° = norte da tela, sentido horário) — fórmula da referência.
 * @param {{ x: number, y: number }} de
 * @param {{ x: number, y: number }} para
 */
export function rumoGraus(de, para) {
  return Math.round(((Math.atan2(para.y - de.y, para.x - de.x) * 180) / Math.PI + 450) % 360);
}

/**
 * Ponta da guia Shift: prolonga o segmento além do cursor (referência ×1.35).
 * @param {{ x: number, y: number }} ultimo
 * @param {{ x: number, y: number }} cur
 * @param {number} [k]
 */
export function pontaGuiaShift(ultimo, cur, k = EDITOR_VISUAL.guiaShift.extensao) {
  return { x: ultimo.x + (cur.x - ultimo.x) * k, y: ultimo.y + (cur.y - ultimo.y) * k };
}

/**
 * @typedef {{ lat: number, lng: number }} LatLng
 * @typedef {{ tipo: 'fechar' | 'vertice' | 'aresta', aresta?: [LatLng, LatLng] }} ImaVisual
 * @typedef {{ alvo: LatLng, ima: ImaVisual | null, travado: boolean }} AlvoDesenho
 */

/**
 * Onde um clique cairia agora (mesma ordem do clique): fechar no 1º ponto →
 * trava 45° com Shift → ímã (Alt suspende).
 * @param {import('maplibre-gl').Map} map
 * @param {LatLng} bruto
 * @param {{ pontos: LatLng[], tipo: string, shift?: boolean, alt?: boolean, imaLigado?: boolean, areas?: unknown[], linhas?: unknown[] }} ctx
 * @returns {AlvoDesenho}
 */
export function resolverAlvoDesenho(map, bruto, ctx) {
  const pts = ctx.pontos || [];
  if (ctx.tipo === "area" && isNearFirstVertex(map, bruto, pts, 20)) {
    return { alvo: { lat: pts[0].lat, lng: pts[0].lng }, ima: { tipo: "fechar" }, travado: false };
  }
  let alvo = { lat: bruto.lat, lng: bruto.lng };
  const ultimo = pts[pts.length - 1];
  const travado = !!(ctx.shift && ultimo && ctx.tipo !== "ponto");
  if (travado) {
    const t = travarAngulo45(map.project([ultimo.lng, ultimo.lat]), map.project([alvo.lng, alvo.lat]));
    const ll = map.unproject([t.x, t.y]);
    alvo = { lat: ll.lat, lng: ll.lng };
  }
  const s = findNearestSnapDetalhado(map, alvo, {
    areas: /** @type {any} */ (ctx.areas),
    linhas: /** @type {any} */ (ctx.linhas),
    enabled: ctx.imaLigado !== false && !ctx.alt,
  });
  if (s) {
    return { alvo: { lat: s.lat, lng: s.lng }, ima: s.tipo === "aresta" ? { tipo: "aresta", aresta: s.aresta } : { tipo: "vertice" }, travado };
  }
  return { alvo, ima: null, travado };
}

/**
 * Vértice/meio sob o ponteiro com área de acerto maior que o círculo visível
 * (mouse 8px, toque 14px). Vértice tem prioridade; entre iguais, o mais próximo.
 * @param {import('maplibre-gl').Map} map
 * @param {{ x: number, y: number }} ponto
 * @param {{ toque?: boolean, camadas: { vertices: string, meios: string } }} opts
 * @returns {{ role: 'vertex' | 'midpoint', index: number, id: string, lat: number, lng: number } | null}
 */
export function acertoEditor(map, ponto, opts) {
  const tol = opts.toque ? EDITOR_VISUAL.acerto.toque : EDITOR_VISUAL.acerto.mouse;
  const layers = [opts.camadas.vertices, opts.camadas.meios].filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  const feats = map.queryRenderedFeatures(
    [
      [ponto.x - tol, ponto.y - tol],
      [ponto.x + tol, ponto.y + tol],
    ],
    { layers }
  );
  let melhor = null;
  let melhorChave = Infinity;
  for (const f of feats) {
    if (f.geometry?.type !== "Point") continue;
    const [lng, lat] = /** @type {[number, number]} */ (f.geometry.coordinates);
    const q = map.project([lng, lat]);
    const d = Math.hypot(q.x - ponto.x, q.y - ponto.y);
    if (d > tol) continue;
    /** @type {'vertex' | 'midpoint'} */
    const role = f.properties?.role === "midpoint" ? "midpoint" : "vertex";
    const chave = (role === "vertex" ? 0 : 1000) + d;
    if (chave < melhorChave) {
      melhorChave = chave;
      melhor = { role, index: Number(f.properties?.index), id: String(f.properties?.id), lat, lng };
    }
  }
  return melhor;
}

/** @returns {GeoJSON.FeatureCollection} */
const vazia = () => ({ type: "FeatureCollection", features: [] });

/**
 * SSOT do que o editor pinta para a geometria em curso (D-PROD-67).
 * EDIÇÃO: geometria + vértices (+ meios se fechada, nunca durante arrasto).
 * PRÉVIA (formulário aberto): só a geometria, fechada e na cor do formulário —
 * nenhum manipulador. Ponto único mantém o marcador (é a própria prévia).
 * @param {import('maplibre-gl').Map} map
 * @param {{ pts: { lat: number, lng: number }[], marker: { lat: number, lng: number } | null, tipo: string, fechado: boolean, previa: boolean, cor: string | null, arrastando: boolean, selecionado: number | null }} e
 */
export function pintarEdicao(map, e) {
  const linear = e.tipo === "area" || e.tipo === "linha";
  setSourceData(map, SOURCE_IDS.DESENHO, buildDesenhoCollection(e.pts, /** @type {any} */ (e.tipo), e.marker, { cor: e.cor, fechado: e.fechado || e.previa }));
  if (linear && e.pts.length > 0 && !e.previa) {
    const vs = buildVerticesCollection(e.pts);
    vs.features.forEach((f) => {
      if (f.properties && Number(f.properties.index) === e.selecionado) f.properties.selecionado = true;
    });
    setSourceData(map, SOURCE_IDS.VERTICES, vs);
    // Durante o arrasto os meios somem (referência), voltam ao soltar.
    setSourceData(map, SOURCE_IDS.MIDPOINTS, e.fechado && !e.arrastando ? buildMidpointsCollection(e.pts, /** @type {any} */ (e.tipo)) : vazia());
  } else if (e.tipo === "ponto" && e.marker) {
    setSourceData(map, SOURCE_IDS.VERTICES, buildVerticesCollection([e.marker]));
    setSourceData(map, SOURCE_IDS.MIDPOINTS, vazia());
  } else {
    setSourceData(map, SOURCE_IDS.VERTICES, vazia());
    setSourceData(map, SOURCE_IDS.MIDPOINTS, vazia());
  }
}

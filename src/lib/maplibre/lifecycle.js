/**
 * Lifecycle MapLibre: uma instância por editor, cancel/dispose, remove limpo.
 */
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  BASEMAP_IDS,
  CENTRO_PADRAO,
  ZOOM_PADRAO,
  resolveBasemapProvider,
} from "./basemap.js";
import {
  COR_LINHA_AREA,
  LAYER_IDS,
  LAYOUT_LINHA_REDONDA,
  OPACIDADE_FILL_AREA,
  SOURCE_IDS,
  corExibidaNoMapa,
  paintAreaDivisa,
  paintEditorContorno,
  paintEditorMeios,
  paintEditorPreenchimento,
  paintEditorVertices,
  paintElastico,
  paintGuiaShift,
  paintImaAresta,
  paintVerticeSelecao,
} from "./estiloAreas.js";

/**
 * Fundo do mapa SEM internet (D-PROD-294): estilo local, sem nenhum recurso de
 * rede. O estilo-base (OpenFreeMap) vem da internet; sem ela, o mapa abria com
 * "Mapa indisponível" e escondia áreas, lotes e pontos, que estão no aparelho.
 * Com este fundo as camadas de negócio aparecem sobre uma cor neutra.
 * O id não usa os prefixos de negócio (`maike-`, `m1-`…): é estilo-base.
 */
export const ESTILO_SEM_INTERNET = Object.freeze({
  version: 8,
  name: "Sem internet",
  sources: {},
  layers: [{ id: "fundo-sem-internet", type: "background", paint: { "background-color": "#dfe7dc" } }],
});

const semInternetAgora = () => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * @param {HTMLElement} container
 * @param {{ basemapId?: string, center?: { lat: number, lng: number }, zoom?: number }} [opts]
 * @returns {{ map: import('maplibre-gl').Map, dispose: () => void, getCancelled: () => boolean, usandoFundoSemInternet: () => boolean, erroContornado: () => boolean }}
 */
export function createEditorMap(container, opts = {}) {
  let cancelled = false;
  const provider = resolveBasemapProvider(opts.basemapId || BASEMAP_IDS.RUAS);
  const center = opts.center || CENTRO_PADRAO;
  const zoom = opts.zoom ?? ZOOM_PADRAO;
  // Sem internet já na abertura: nem tenta o estilo remoto.
  let fundoSemInternet = semInternetAgora() || !provider.styleUrl;
  let estiloCarregou = false;

  const map = new maplibregl.Map({
    container,
    style: fundoSemInternet ? /** @type {any} */ (ESTILO_SEM_INTERNET) : provider.styleUrl,
    center: [center.lng, center.lat],
    zoom,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    doubleClickZoom: false,
  });

  map.touchZoomRotate.disableRotation();

  map.on("style.load", () => {
    estiloCarregou = true;
  });
  // O estilo remoto não veio (rede caída no meio, servidor fora): troca para o
  // fundo local uma vez, em vez de deixar o mapa sem abrir. Erro de tile de uma
  // fonte (`sourceId`) não derruba o estilo e não entra aqui.
  map.on("error", (e) => {
    if (estiloCarregou || fundoSemInternet || /** @type {any} */ (e)?.sourceId) return;
    fundoSemInternet = true;
    try {
      map.setStyle(/** @type {any} */ (ESTILO_SEM_INTERNET));
    } catch {
      /* best-effort */
    }
  });

  const dispose = () => {
    cancelled = true;
    try {
      map.remove();
    } catch {
      /* best-effort */
    }
  };

  return {
    map,
    dispose,
    getCancelled: () => cancelled,
    usandoFundoSemInternet: () => fundoSemInternet,
    // Falha de rede de estilo ou tile não é "mapa indisponível" quando o mapa
    // já abriu ou caiu no fundo local: as camadas do aparelho continuam.
    erroContornado: () => estiloCarregou || fundoSemInternet,
  };
}

/**
 * Garante sources/layers de negócio após load ou setStyle.
 * @param {import('maplibre-gl').Map} map
 */
export function ensureBusinessLayers(map) {
  /** @type {GeoJSON.FeatureCollection} */
  const empty = { type: "FeatureCollection", features: [] };

  const ensureSource = (id) => {
    if (!map.getSource(id)) {
      map.addSource(id, { type: "geojson", data: empty, promoteId: "id" });
    }
  };

  ensureSource(SOURCE_IDS.AREAS);
  ensureSource(SOURCE_IDS.LINHAS);
  ensureSource(SOURCE_IDS.PONTOS);
  ensureSource(SOURCE_IDS.DESENHO);
  ensureSource(SOURCE_IDS.VERTICES);
  ensureSource(SOURCE_IDS.MIDPOINTS);
  ensureSource(SOURCE_IDS.GUIA);

  if (!map.getLayer(LAYER_IDS.AREAS_FILL)) {
    map.addLayer({
      id: LAYER_IDS.AREAS_FILL,
      type: "fill",
      source: SOURCE_IDS.AREAS,
      paint: {
        "fill-color": ["coalesce", ["get", "fill"], "#16a34a"],
        "fill-opacity": OPACIDADE_FILL_AREA,
      },
    });
  }
  if (!map.getLayer(LAYER_IDS.AREAS_LINE)) {
    // SSOT com o Mapa Geral (D-PROD-65): divisa branca fina interpolada por zoom.
    map.addLayer({ id: LAYER_IDS.AREAS_LINE, type: "line", source: SOURCE_IDS.AREAS, paint: paintAreaDivisa() });
  }
  if (!map.getLayer(LAYER_IDS.LINHAS)) {
    map.addLayer({
      id: LAYER_IDS.LINHAS,
      type: "line",
      source: SOURCE_IDS.LINHAS,
      paint: {
        "line-color": ["coalesce", ["get", "cor"], "#f59e0b"],
        "line-width": 2.2,
        "line-opacity": 0.75,
      },
    });
  }
  if (!map.getLayer(LAYER_IDS.PONTOS)) {
    map.addLayer({
      id: LAYER_IDS.PONTOS,
      type: "circle",
      source: SOURCE_IDS.PONTOS,
      paint: {
        "circle-radius": 7,
        "circle-color": ["coalesce", ["get", "cor"], "#0066ff"],
        "circle-opacity": 0.7,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }
  // Editor — ordem da referência (`camada-desenho.tsx`): aresta do ímã, preenchimento,
  // contorno, elástico, guia Shift, meios, vértices (cursor/anel ficam no overlay DOM).
  const addLayer = (spec) => {
    if (!map.getLayer(spec.id)) map.addLayer(spec);
  };
  addLayer({
    id: LAYER_IDS.DESENHO_FILL,
    type: "fill",
    source: SOURCE_IDS.DESENHO,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: paintEditorPreenchimento(),
  });
  addLayer({
    id: LAYER_IDS.IMA_ARESTA_HALO,
    type: "line",
    source: SOURCE_IDS.GUIA,
    filter: ["==", ["get", "tipo"], "ima-aresta"],
    layout: { ...LAYOUT_LINHA_REDONDA },
    paint: paintImaAresta(true),
  });
  addLayer({
    id: LAYER_IDS.IMA_ARESTA,
    type: "line",
    source: SOURCE_IDS.GUIA,
    filter: ["==", ["get", "tipo"], "ima-aresta"],
    layout: { ...LAYOUT_LINHA_REDONDA },
    paint: paintImaAresta(false),
  });
  addLayer({
    id: LAYER_IDS.DESENHO_LINE,
    type: "line",
    source: SOURCE_IDS.DESENHO,
    // Rascunho aberto: só a polilinha (sem o lado de fecho); fechado: contorno inteiro.
    filter: ["==", ["get", "contorno"], true],
    layout: { ...LAYOUT_LINHA_REDONDA },
    paint: paintEditorContorno(),
  });
  addLayer({
    id: LAYER_IDS.GUIA,
    type: "line",
    source: SOURCE_IDS.GUIA,
    filter: ["==", ["get", "tipo"], "elastico"],
    layout: { "line-cap": "round" },
    paint: paintElastico(),
  });
  addLayer({
    id: LAYER_IDS.GUIA_SHIFT,
    type: "line",
    source: SOURCE_IDS.GUIA,
    filter: ["==", ["get", "tipo"], "shift"],
    paint: paintGuiaShift(),
  });
  addLayer({ id: LAYER_IDS.MIDPOINTS, type: "circle", source: SOURCE_IDS.MIDPOINTS, paint: paintEditorMeios() });
  addLayer({
    id: LAYER_IDS.VERTICES_SELECAO,
    type: "circle",
    source: SOURCE_IDS.VERTICES,
    filter: ["==", ["get", "selecionado"], true],
    paint: paintVerticeSelecao(),
  });
  addLayer({ id: LAYER_IDS.VERTICES, type: "circle", source: SOURCE_IDS.VERTICES, paint: paintEditorVertices() });
}

/**
 * Atualiza espessura da divisa conforme zoom.
 * @param {import('maplibre-gl').Map} map
 */
export function syncDivisaWidth(map) {
  // Largura agora é expressão interpolada por zoom (SSOT `paintAreaDivisa`);
  // mantido por compatibilidade dos callers — reaplica a expressão.
  if (!map.getLayer(LAYER_IDS.AREAS_LINE)) return;
  map.setPaintProperty(LAYER_IDS.AREAS_LINE, "line-width", paintAreaDivisa()["line-width"]);
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string} sourceId
 * @param {GeoJSON.FeatureCollection} data
 */
export function setSourceData(map, sourceId, data) {
  // D-PROD-340: mapa já removido (`map.remove()` apaga o estilo). Ao fechar o editor do cadastro, a limpeza do cursor
  // e do arrasto rodava DEPOIS da limpeza que remove o mapa; `getSource` lançava dentro da desmontagem do React, e
  // sem ErrorBoundary o app inteiro sumia (tela branca: "trava tudo"), na web e no app.
  let src;
  try {
    src = map?.getSource(sourceId);
  } catch {
    return;
  }
  if (src && "setData" in src && typeof src.setData === "function") {
    /** @type {{ setData: (d: GeoJSON.FeatureCollection) => void }} */ (src).setData(data);
  }
}

/**
 * Troca basemap com setStyle e reaplica layers de negócio.
 * Retorna cancel() para invalidar style.load de trocas substituídas (R5-05).
 * @param {import('maplibre-gl').Map} map
 * @param {string} basemapId
 * @param {{ onReady?: () => void, onError?: (err: Error) => void }} [hooks]
 * @returns {{ cancel: () => void }}
 */
export function applyBasemapStyle(map, basemapId, hooks = {}) {
  let cancelled = false;
  const provider = resolveBasemapProvider(basemapId);
  if (!provider.styleUrl) {
    hooks.onError?.(new Error("Style URL ausente"));
    return { cancel: () => { cancelled = true; } };
  }
  const onStyle = () => {
    if (cancelled) return;
    try {
      ensureBusinessLayers(map);
      syncDivisaWidth(map);
      if (!cancelled) hooks.onReady?.();
    } catch (err) {
      if (!cancelled) hooks.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };
  map.once("style.load", onStyle);
  try {
    map.setStyle(provider.styleUrl);
  } catch (err) {
    cancelled = true;
    hooks.onError?.(err instanceof Error ? err : new Error(String(err)));
  }
  return {
    cancel: () => {
      cancelled = true;
      try {
        map.off("style.load", onStyle);
      } catch {
        /* ignore */
      }
    },
  };
}

export { corExibidaNoMapa, maplibregl };

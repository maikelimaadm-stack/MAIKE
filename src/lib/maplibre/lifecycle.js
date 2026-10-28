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
  COR_DESENHO,
  COR_LINHA_AREA,
  COR_VERTICE_FILL,
  COR_VERTICE_STROKE,
  LAYER_IDS,
  OPACIDADE_FILL_AREA,
  OPACIDADE_FILL_DESENHO,
  SOURCE_IDS,
  corExibidaNoMapa,
  espessuraDivisaPorZoom,
} from "./estiloAreas.js";

/**
 * @param {HTMLElement} container
 * @param {{ basemapId?: string, center?: { lat: number, lng: number }, zoom?: number }} [opts]
 * @returns {{ map: import('maplibre-gl').Map, dispose: () => void, getCancelled: () => boolean }}
 */
export function createEditorMap(container, opts = {}) {
  let cancelled = false;
  const provider = resolveBasemapProvider(opts.basemapId || BASEMAP_IDS.RUAS);
  const center = opts.center || CENTRO_PADRAO;
  const zoom = opts.zoom ?? ZOOM_PADRAO;

  const map = new maplibregl.Map({
    container,
    style: provider.styleUrl,
    center: [center.lng, center.lat],
    zoom,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    doubleClickZoom: false,
  });

  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

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
    map.addLayer({
      id: LAYER_IDS.AREAS_LINE,
      type: "line",
      source: SOURCE_IDS.AREAS,
      paint: {
        "line-color": COR_LINHA_AREA,
        "line-width": espessuraDivisaPorZoom(map.getZoom()),
        "line-opacity": 0.95,
      },
    });
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
  if (!map.getLayer(LAYER_IDS.DESENHO_FILL)) {
    map.addLayer({
      id: LAYER_IDS.DESENHO_FILL,
      type: "fill",
      source: SOURCE_IDS.DESENHO,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": COR_DESENHO,
        "fill-opacity": OPACIDADE_FILL_DESENHO,
      },
    });
  }
  if (!map.getLayer(LAYER_IDS.DESENHO_LINE)) {
    map.addLayer({
      id: LAYER_IDS.DESENHO_LINE,
      type: "line",
      source: SOURCE_IDS.DESENHO,
      paint: {
        "line-color": COR_DESENHO,
        "line-width": 2.2,
        "line-opacity": 1,
      },
    });
  }
  if (!map.getLayer(LAYER_IDS.GUIA)) {
    map.addLayer({
      id: LAYER_IDS.GUIA,
      type: "line",
      source: SOURCE_IDS.GUIA,
      paint: {
        "line-color": COR_DESENHO,
        "line-width": 2,
        "line-opacity": 0.9,
        "line-dasharray": [1.5, 1.5],
      },
    });
  }
  if (!map.getLayer(LAYER_IDS.VERTICES)) {
    map.addLayer({
      id: LAYER_IDS.VERTICES,
      type: "circle",
      source: SOURCE_IDS.VERTICES,
      paint: {
        "circle-radius": 5,
        "circle-color": COR_VERTICE_FILL,
        "circle-stroke-color": COR_VERTICE_STROKE,
        "circle-stroke-width": 2.4,
      },
    });
  }
  if (!map.getLayer(LAYER_IDS.MIDPOINTS)) {
    map.addLayer({
      id: LAYER_IDS.MIDPOINTS,
      type: "circle",
      source: SOURCE_IDS.MIDPOINTS,
      paint: {
        "circle-radius": 3.5,
        "circle-color": COR_DESENHO,
        "circle-opacity": 0.55,
        "circle-stroke-color": COR_DESENHO,
        "circle-stroke-width": 1,
      },
    });
  }
}

/**
 * Atualiza espessura da divisa conforme zoom.
 * @param {import('maplibre-gl').Map} map
 */
export function syncDivisaWidth(map) {
  if (!map.getLayer(LAYER_IDS.AREAS_LINE)) return;
  map.setPaintProperty(LAYER_IDS.AREAS_LINE, "line-width", espessuraDivisaPorZoom(map.getZoom()));
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string} sourceId
 * @param {GeoJSON.FeatureCollection} data
 */
export function setSourceData(map, sourceId, data) {
  const src = map.getSource(sourceId);
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

import { describe, expect, it, vi, beforeEach } from "vitest";

const listeners = new Map();
const sources = new Map();
const layers = new Set();

function makeFakeMap() {
  return {
    dragPan: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn() },
    addControl: vi.fn(),
    remove: vi.fn(),
    getZoom: () => 14,
    isStyleLoaded: () => true,
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => (layers.has(id) ? { id } : null),
    addSource: (id, spec) => {
      sources.set(id, { ...spec, setData: vi.fn() });
    },
    addLayer: (layer) => {
      layers.add(layer.id);
    },
    setPaintProperty: vi.fn(),
    setStyle: vi.fn(function setStyle() {
      // Simula recriação: limpa sources/layers e dispara style.load
      sources.clear();
      layers.clear();
      const cb = listeners.get("once:style.load");
      if (cb) cb();
    }),
    once: (ev, cb) => {
      listeners.set(`once:${ev}`, cb);
    },
    on: vi.fn(),
    off: vi.fn(),
    getCanvas: () => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  };
}

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(function Map() {
    return makeFakeMap();
  });
  return {
    default: { Map, NavigationControl: vi.fn(), Marker: vi.fn(), LngLatBounds: vi.fn() },
    Map,
    NavigationControl: vi.fn(),
    Marker: vi.fn(),
    LngLatBounds: vi.fn(),
  };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

describe("R5-05 style swap rehydrate", () => {
  beforeEach(() => {
    listeners.clear();
    sources.clear();
    layers.clear();
    vi.resetModules();
  });

  it("applyBasemapStyle cancela style.load anterior e reaplica layers", async () => {
    const { createEditorMap, ensureBusinessLayers, applyBasemapStyle, setSourceData } = await import(
      "@/lib/maplibre/lifecycle.js"
    );
    const { SOURCE_IDS } = await import("@/lib/maplibre/estiloAreas.js");
    const { map } = createEditorMap(document.createElement("div"));
    ensureBusinessLayers(map);
    expect(sources.has(SOURCE_IDS.MIDPOINTS)).toBe(true);

    const first = applyBasemapStyle(map, "ruas", {
      onReady: () => {
        ensureBusinessLayers(map);
        setSourceData(map, SOURCE_IDS.MIDPOINTS, {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } }],
        });
        setSourceData(map, SOURCE_IDS.GUIA, {
          type: "FeatureCollection",
          features: [],
        });
      },
    });
    first.cancel();

    const ready = vi.fn();
    applyBasemapStyle(map, "ruas", {
      onReady: () => {
        ensureBusinessLayers(map);
        setSourceData(map, SOURCE_IDS.DESENHO, { type: "FeatureCollection", features: [] });
        setSourceData(map, SOURCE_IDS.VERTICES, { type: "FeatureCollection", features: [] });
        setSourceData(map, SOURCE_IDS.MIDPOINTS, { type: "FeatureCollection", features: [] });
        setSourceData(map, SOURCE_IDS.GUIA, { type: "FeatureCollection", features: [] });
        ready();
      },
    });

    expect(ready).toHaveBeenCalled();
    expect(sources.has(SOURCE_IDS.MIDPOINTS)).toBe(true);
    expect(sources.has(SOURCE_IDS.GUIA)).toBe(true);
    expect(sources.has(SOURCE_IDS.DESENHO)).toBe(true);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

const listeners = new Map();
const sources = new Map();
const layers = new Set();

function makeFakeMap() {
  const map = {
    dragPan: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn() },
    addControl: vi.fn(),
    remove: vi.fn(),
    getZoom: () => 14,
    isStyleLoaded: () => true,
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => (layers.has(id) ? { id } : null),
    addSource: (id, spec) => {
      sources.set(id, {
        ...spec,
        setData: vi.fn(),
      });
    },
    addLayer: (layer) => {
      layers.add(layer.id);
    },
    setPaintProperty: vi.fn(),
    setStyle: vi.fn(),
    once: (ev, cb) => {
      listeners.set(`once:${ev}`, cb);
    },
    on: (ev, cb) => {
      listeners.set(ev, cb);
    },
    off: vi.fn(),
    getCanvas: () => ({
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    }),
  };
  return map;
}

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(function Map() {
    return makeFakeMap();
  });
  const NavigationControl = vi.fn();
  const Marker = vi.fn();
  const LngLatBounds = vi.fn(function LngLatBounds() {
    return { extend: vi.fn() };
  });
  return {
    default: { Map, NavigationControl, Marker, LngLatBounds },
    Map,
    NavigationControl,
    Marker,
    LngLatBounds,
  };
});

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

describe("maplibre/lifecycle", () => {
  beforeEach(() => {
    listeners.clear();
    sources.clear();
    layers.clear();
    vi.resetModules();
  });

  it("createEditorMap + dispose chama map.remove e impede late-init lógico", async () => {
    const { createEditorMap, ensureBusinessLayers } = await import("@/lib/maplibre/lifecycle.js");
    const container = document.createElement("div");
    const { map, dispose, getCancelled } = createEditorMap(container, { basemapId: "ruas" });
    expect(getCancelled()).toBe(false);
    ensureBusinessLayers(map);
    expect(sources.has("m1-areas")).toBe(true);
    expect(layers.has("m1-areas-fill")).toBe(true);
    dispose();
    expect(getCancelled()).toBe(true);
    expect(map.remove).toHaveBeenCalled();
  });

  it("ensureBusinessLayers é idempotente", async () => {
    const { createEditorMap, ensureBusinessLayers } = await import("@/lib/maplibre/lifecycle.js");
    const { map } = createEditorMap(document.createElement("div"));
    ensureBusinessLayers(map);
    const nSources = sources.size;
    ensureBusinessLayers(map);
    expect(sources.size).toBe(nSources);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  areaHectares,
  comprimentoMetros,
  toPersistedCoords,
  validateLineForSave,
  validatePolygonForSave,
} from "@/lib/geografia";
import {
  MAX_AGE_AVISO_MS,
  PRECISAO_AVISO_METROS,
  buildAccuracyCircleCollection,
  buildAccuracyRingLngLat,
  buildUserPointCollection,
  checarSuporteGeolocation,
  clearGeolocationWatch,
  ensureGpsCaptureLayers,
  mensagemErroGeolocation,
  parseGeolocationPosition,
  precisaoRuim,
  GPS_LAYER_IDS,
  GPS_SOURCE_IDS,
} from "@/lib/maplibre/gpsCapture.js";
import { buildDesenhoCollection } from "@/lib/maplibre/geojsonBuilders.js";

describe("maplibre/gpsCapture — geolocation helpers", () => {
  it("clearGeolocationWatch cancela inclusive watch id 0", () => {
    const clearWatch = vi.fn();
    expect(clearGeolocationWatch(0, { clearWatch })).toBe(true);
    expect(clearWatch).toHaveBeenCalledWith(0);
    expect(clearGeolocationWatch(null, { clearWatch })).toBe(false);
    expect(clearGeolocationWatch(undefined, { clearWatch })).toBe(false);
    expect(clearWatch).toHaveBeenCalledTimes(1);
  });

  it("parseGeolocationPosition rejeita NaN/Infinity e aceita 0,0", () => {
    expect(
      parseGeolocationPosition({
        coords: { latitude: 0, longitude: 0, accuracy: 12 },
        timestamp: 1_000,
      })
    ).toEqual({
      lat: 0,
      lng: 0,
      accuracy: 12,
      timestamp: 1_000,
      stale: true,
    });

    expect(
      parseGeolocationPosition({
        coords: { latitude: Number.NaN, longitude: -59, accuracy: 5 },
        timestamp: Date.now(),
      })
    ).toBeNull();

    expect(
      parseGeolocationPosition({
        coords: { latitude: -15, longitude: Number.POSITIVE_INFINITY, accuracy: 5 },
        timestamp: Date.now(),
      })
    ).toBeNull();
  });

  it("parseGeolocationPosition marca stale e accuracy inválida", () => {
    const now = 100_000;
    const fresh = parseGeolocationPosition(
      {
        coords: { latitude: -15.01, longitude: -59.95, accuracy: 8 },
        timestamp: now - 100,
      },
      { now }
    );
    expect(fresh?.stale).toBe(false);

    const stale = parseGeolocationPosition(
      {
        coords: { latitude: -15.01, longitude: -59.95, accuracy: -1 },
        timestamp: now - MAX_AGE_AVISO_MS - 1,
      },
      { now }
    );
    expect(stale?.stale).toBe(true);
    expect(stale?.accuracy).toBeNull();
  });

  it("mensagemErroGeolocation cobre códigos padrão", () => {
    expect(mensagemErroGeolocation({ code: 1 })).toMatch(/Permissão/i);
    expect(mensagemErroGeolocation({ code: 2 })).toMatch(/indisponível/i);
    expect(mensagemErroGeolocation({ code: 3 })).toMatch(/Tempo esgotado/i);
  });

  it("precisaoRuim avisa mas não bloqueia (limiar documentado)", () => {
    expect(precisaoRuim(PRECISAO_AVISO_METROS)).toBe(false);
    expect(precisaoRuim(PRECISAO_AVISO_METROS + 1)).toBe(true);
    expect(precisaoRuim(null)).toBe(false);
  });

  it("checarSuporteGeolocation sem navigator.geolocation", () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true,
    });
    expect(checarSuporteGeolocation().ok).toBe(false);
    Object.defineProperty(globalThis, "navigator", {
      value: original,
      configurable: true,
    });
  });
});

describe("maplibre/gpsCapture — accuracy circle + layers", () => {
  it("buildAccuracyRingLngLat e collection acompanham centro/raio", () => {
    const ring = buildAccuracyRingLngLat({ lat: -15, lng: -59 }, 25, 32);
    expect(ring.length).toBe(33);
    expect(ring[0][0]).toBeCloseTo(ring[ring.length - 1][0], 8);
    expect(ring[0][1]).toBeCloseTo(ring[ring.length - 1][1], 8);

    const fc = buildAccuracyCircleCollection({ lat: -15, lng: -59 }, 40);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("Polygon");

    expect(buildAccuracyCircleCollection({ lat: -15, lng: -59 }, 0).features).toHaveLength(0);
    expect(buildUserPointCollection({ lat: 0, lng: 0 }).features).toHaveLength(1);
  });

  it("ensureGpsCaptureLayers é idempotente", () => {
    const sources = new Map();
    const layers = new Set();
    const map = {
      getSource: (id) => sources.get(id) || null,
      addSource: (id, spec) => sources.set(id, spec),
      getLayer: (id) => (layers.has(id) ? { id } : null),
      addLayer: (layer) => layers.add(layer.id),
    };
    ensureGpsCaptureLayers(map);
    const nSrc = sources.size;
    const nLay = layers.size;
    ensureGpsCaptureLayers(map);
    expect(sources.size).toBe(nSrc);
    expect(layers.size).toBe(nLay);
    expect(sources.has(GPS_SOURCE_IDS.ACCURACY)).toBe(true);
    expect(layers.has(GPS_LAYER_IDS.USER)).toBe(true);
  });
});

describe("maplibre/gpsCapture — contratos área/linha + persistência", () => {
  const areaPts = [
    { lat: -15.0, lng: -59.0, accuracy: 5, timestamp: 1 },
    { lat: -15.0, lng: -58.99, accuracy: 6, timestamp: 2 },
    { lat: -15.01, lng: -58.995, accuracy: 7, timestamp: 3 },
  ];

  const linhaPts = [
    { lat: -15.0, lng: -59.0, accuracy: 4 },
    { lat: -15.02, lng: -59.01, accuracy: 5 },
  ];

  it("área: ≥3 vértices, areaHectares, validate, toPersistedCoords [lat,lng]", () => {
    expect(validatePolygonForSave(areaPts).ok).toBe(true);
    expect(areaHectares(areaPts)).toBeGreaterThan(0);
    const moved = [...areaPts];
    moved[1] = { ...moved[1], lat: -15.001, lng: -58.988 };
    expect(validatePolygonForSave(moved).ok).toBe(true);

    const persisted = toPersistedCoords(areaPts);
    expect(persisted).toEqual([
      [-15.0, -59.0],
      [-15.0, -58.99],
      [-15.01, -58.995],
    ]);
    // metadados accuracy/timestamp NÃO entram no JSONB
    expect(persisted[0]).toHaveLength(2);
  });

  it("linha: ≥2 vértices e comprimento geodésico", () => {
    expect(validateLineForSave(linhaPts).ok).toBe(true);
    expect(comprimentoMetros(linhaPts)).toBeGreaterThan(100);
    expect(toPersistedCoords(linhaPts)).toEqual([
      [-15.0, -59.0],
      [-15.02, -59.01],
    ]);
  });

  it("cliques no mapa não criam vértices — só botão (contrato de desenho separado)", () => {
    // Sem pontos → FeatureCollection vazia; marcar é manual no componente.
    const desenho = buildDesenhoCollection([], "area");
    expect(desenho.features).toHaveLength(0);
  });

  it("simula watch id 0 → clear no unmount/cancelar/confirmar", () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn(() => 0);
    const geo = { watchPosition, clearWatch };
    const id = geo.watchPosition(
      () => {},
      () => {},
      { enableHighAccuracy: true }
    );
    expect(id).toBe(0);
    // cancelar / confirmar / unmount
    expect(clearGeolocationWatch(id, geo)).toBe(true);
    expect(clearWatch).toHaveBeenCalledWith(0);
  });
});

describe("maplibre/gpsCapture — lifecycle create/dispose (fake map)", () => {
  const listeners = new Map();
  const sources = new Map();
  const layers = new Set();

  function makeFakeMap() {
    return {
      dragPan: { disable: vi.fn(), enable: vi.fn() },
      touchZoomRotate: { disableRotation: vi.fn() },
      addControl: vi.fn(),
      remove: vi.fn(),
      getZoom: () => 18,
      getSource: (id) => sources.get(id) || null,
      getLayer: (id) => (layers.has(id) ? { id } : null),
      addSource: (id, spec) => {
        sources.set(id, { ...spec, setData: vi.fn() });
      },
      addLayer: (layer) => layers.add(layer.id),
      setPaintProperty: vi.fn(),
      setStyle: vi.fn(),
      once: (ev, cb) => listeners.set(`once:${ev}`, cb),
      on: (ev, cb) => listeners.set(ev, cb),
      off: vi.fn(),
      getCanvas: () => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      }),
    };
  }

  beforeEach(() => {
    listeners.clear();
    sources.clear();
    layers.clear();
    vi.resetModules();
  });

  it("createEditorMap + ensureGpsCaptureLayers + dispose remove mapa", async () => {
    vi.doMock("maplibre-gl", () => {
      const Map = vi.fn(function Map() {
        return makeFakeMap();
      });
      return {
        default: { Map, NavigationControl: vi.fn(), Marker: vi.fn() },
        Map,
        NavigationControl: vi.fn(),
        Marker: vi.fn(),
      };
    });
    vi.doMock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

    const { createEditorMap } = await import("@/lib/maplibre/lifecycle.js");
    const { ensureGpsCaptureLayers: ensure } = await import("@/lib/maplibre/gpsCapture.js");
    const { map, dispose, getCancelled } = createEditorMap(document.createElement("div"), {
      basemapId: "ruas",
      zoom: 18,
    });
    ensure(map);
    expect(sources.has(GPS_SOURCE_IDS.DESENHO)).toBe(true);
    dispose();
    expect(getCancelled()).toBe(true);
    expect(map.remove).toHaveBeenCalled();
  });
});

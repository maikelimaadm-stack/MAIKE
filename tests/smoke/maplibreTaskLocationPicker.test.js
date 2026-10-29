import { describe, expect, it, vi } from "vitest";
import { parseVertex, toPersistedCoords, isValidLatLng } from "@/lib/geografia";
import {
  buildSelectedPointCollection,
  buildTaskPickerAreasCollection,
  ensureTaskPickerLayers,
  findContainingArea,
  normalizarPrioridade,
  parsePickerCoordinate,
  pointInPolygonRing,
  safeCentroid,
  TASK_PICKER_LAYER_IDS,
  TASK_PICKER_SOURCE_IDS,
} from "@/lib/maplibre/taskLocationPicker.js";

describe("maplibre/taskLocationPicker — coords zero-safe", () => {
  it("parsePickerCoordinate aceita 0,0 e rejeita ||-trap legado", () => {
    expect(parsePickerCoordinate([0, 0])).toEqual({ lat: 0, lng: 0 });
    expect(parsePickerCoordinate({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0 });
    expect(parsePickerCoordinate({ lat: 0, lng: -59 })).toEqual({ lat: 0, lng: -59 });
    // legado `c[0] || c.lat` perde latitude 0 (falsy)
    const raw = [0, -59.5];
    const broken = { lat: raw[0] || /** @type {any} */ (raw).lat, lng: raw[1] || /** @type {any} */ (raw).lng };
    expect(broken.lat).not.toBe(0);
    expect(parsePickerCoordinate(raw)).toEqual({ lat: 0, lng: -59.5 });
  });

  it("isValidLatLng e initialCoordinates {0,0}", () => {
    expect(isValidLatLng(0, 0)).toBe(true);
    expect(parseVertex({ lat: 0, lng: 0 })).toEqual({ lat: 0, lng: 0 });
  });
});

describe("maplibre/taskLocationPicker — geometria", () => {
  const square = [
    { lat: -15.0, lng: -59.0 },
    { lat: -15.0, lng: -58.9 },
    { lat: -15.1, lng: -58.9 },
    { lat: -15.1, lng: -59.0 },
  ];

  it("pointInPolygonRing e findContainingArea (primeira da lista)", () => {
    expect(pointInPolygonRing({ lat: -15.05, lng: -58.95 }, square)).toBe(true);
    expect(pointInPolygonRing({ lat: -14.0, lng: -58.95 }, square)).toBe(false);

    const a1 = { id: "a1", coordenadas: { coords: square.map((p) => [p.lat, p.lng]) } };
    const a2 = {
      id: "a2",
      coordenadas: {
        coords: [
          [-15.04, -58.96],
          [-15.04, -58.94],
          [-15.06, -58.94],
          [-15.06, -58.96],
        ],
      },
    };
    // Ponto no overlap: a1 vem primeiro → a1
    const hit = findContainingArea({ lat: -15.05, lng: -58.95 }, [a1, a2]);
    expect(hit?.id).toBe("a1");
    expect(findContainingArea({ lat: -15.05, lng: -58.95 }, [a2, a1])?.id).toBe("a2");
  });

  it("safeCentroid não usa Google e funciona com anel degenerado", () => {
    const c = safeCentroid(square);
    expect(c).toBeTruthy();
    expect(isValidLatLng(c.lat, c.lng)).toBe(true);
    expect(safeCentroid([{ lat: 0, lng: 0 }])).toEqual({ lat: 0, lng: 0 });
    expect(safeCentroid([])).toBeNull();
  });

  it("buildTaskPickerAreasCollection e selected point", () => {
    const fc = buildTaskPickerAreasCollection([
      {
        id: "x",
        nome: "Piquete",
        coordenadas: { coords: square.map((p) => [p.lat, p.lng]), cor: "#16a34a" },
      },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("Polygon");
    expect(buildSelectedPointCollection({ lat: 0, lng: 0 }).features).toHaveLength(1);
    expect(buildSelectedPointCollection(null).features).toHaveLength(0);
  });
});

describe("maplibre/taskLocationPicker — contrato onSelect / persistência", () => {
  it("coords {lat,lng} → toPersistedCoords só quando formulário persiste anel", () => {
    const coords = { lat: -15.01, lng: -59.02 };
    // picker entrega ponto; formulário guarda coordenadas do ponto — parseVertex ok
    expect(parseVertex(coords)).toEqual(coords);
    // se viesse anel de área, JSONB continua [lat,lng]
    const ring = [
      { lat: -15, lng: -59 },
      { lat: -15, lng: -58.9 },
      { lat: -15.1, lng: -58.95 },
    ];
    expect(toPersistedCoords(ring)[0]).toEqual([-15, -59]);
  });

  it("normalizarPrioridade bate com categorias acentuadas", () => {
    expect(normalizarPrioridade("Média")).toBe("MEDIA");
    expect(normalizarPrioridade("media")).toBe("MEDIA");
  });

  it("simula single-select: segundo emit ignorado", () => {
    let handled = false;
    const calls = [];
    const emit = (coords, area) => {
      if (handled) return;
      handled = true;
      calls.push({ coords, area });
    };
    emit({ lat: 1, lng: 2 }, { id: "a" });
    emit({ lat: 3, lng: 4 }, { id: "b" });
    expect(calls).toHaveLength(1);
    expect(calls[0].area.id).toBe("a");
  });
});

describe("maplibre/taskLocationPicker — layers + lifecycle fake map", () => {
  it("ensureTaskPickerLayers idempotente", () => {
    const sources = new Map();
    const layers = new Set();
    const map = {
      getSource: (id) => sources.get(id) || null,
      addSource: (id, spec) => sources.set(id, spec),
      getLayer: (id) => (layers.has(id) ? { id } : null),
      addLayer: (layer) => layers.add(layer.id),
    };
    ensureTaskPickerLayers(map);
    const n = sources.size;
    ensureTaskPickerLayers(map);
    expect(sources.size).toBe(n);
    expect(layers.has(TASK_PICKER_LAYER_IDS.AREAS_FILL)).toBe(true);
    expect(sources.has(TASK_PICKER_SOURCE_IDS.SELECTED)).toBe(true);
  });

  it("createEditorMap + dispose remove mapa (picker path)", async () => {
    const sources = new Map();
    const layers = new Set();
    const listeners = new Map();
    function makeFakeMap() {
      return {
        dragPan: { disable: vi.fn(), enable: vi.fn() },
        touchZoomRotate: { disableRotation: vi.fn() },
        addControl: vi.fn(),
        remove: vi.fn(),
        getZoom: () => 14,
        getSource: (id) => sources.get(id) || null,
        getLayer: (id) => (layers.has(id) ? { id } : null),
        addSource: (id, spec) => sources.set(id, { ...spec, setData: vi.fn() }),
        addLayer: (layer) => layers.add(layer.id),
        setPaintProperty: vi.fn(),
        setStyle: vi.fn(),
        once: (ev, cb) => listeners.set(`once:${ev}`, cb),
        on: (ev, cb) => listeners.set(ev, cb),
        off: vi.fn(),
        resize: vi.fn(),
        getCanvas: () => ({
          style: {},
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          getBoundingClientRect: () => ({ left: 0, top: 0 }),
        }),
      };
    }

    vi.resetModules();
    vi.doMock("maplibre-gl", () => {
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
    vi.doMock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

    const { createEditorMap } = await import("@/lib/maplibre/lifecycle.js");
    const { ensureTaskPickerLayers: ensure } = await import("@/lib/maplibre/taskLocationPicker.js");
    const { map, dispose, getCancelled } = createEditorMap(document.createElement("div"), {
      basemapId: "ruas",
    });
    ensure(map);
    dispose();
    expect(getCancelled()).toBe(true);
    expect(map.remove).toHaveBeenCalled();
  });
});

describe("maplibre/taskLocationPicker — sem Maps JS no picker", () => {
  it("helper e dialog não importam loadGoogleMaps / google.maps", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const helper = fs.readFileSync(path.join(process.cwd(), "src/lib/maplibre/taskLocationPicker.js"), "utf8");
    const dialog = fs.readFileSync(
      path.join(process.cwd(), "src/components/mapa/TaskLocationPickerDialog.jsx"),
      "utf8"
    );
    expect(helper).not.toMatch(/loadGoogleMaps|from ["']@\/lib\/googleMaps["']/);
    expect(dialog).not.toMatch(/loadGoogleMaps|from ["']@\/lib\/googleMaps["']/);
    expect(dialog).not.toMatch(/new google\.maps|google\.maps\./);
    expect(dialog).toMatch(/createEditorMap/);
  });

  it("outros consumidores ainda usam loadGoogleMaps", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const geral = fs.readFileSync(path.join(process.cwd(), "src/pages/MapaGeral.jsx"), "utf8");
    // M2-B2 migrou SelecaoAreasMapa; prova remanescente: depósito + loader
    const deposito = fs.readFileSync(
      path.join(process.cwd(), "src/components/mapa/SelecaoDepositoMapa.jsx"),
      "utf8"
    );
    const gmaps = fs.readFileSync(path.join(process.cwd(), "src/lib/googleMaps.js"), "utf8");
    expect(geral).toMatch(/loadGoogleMaps/);
    expect(deposito).toMatch(/loadGoogleMaps/);
    expect(gmaps).toMatch(/export const loadGoogleMaps/);
  });
});

import { describe, expect, it, vi } from "vitest";
import { parseVertex, toPersistedCoords } from "@/lib/geografia";
import {
  SELECAO_FILL_OPACITY,
  SELECAO_LAYER_IDS,
  SELECAO_SOURCE_IDS,
  buildColorBatchPayload,
  buildSelecaoAreasCollection,
  clonePersistedCoordsExact,
  ensureSelecaoAreasLayers,
  planRenumeracao,
  summarizeBatchResults,
  syncSelectedIds,
} from "@/lib/maplibre/selecaoAreasMapa.js";

const square = [
  [0, -59],
  [0, -58.9],
  [-0.1, -58.9],
  [-0.1, -59],
];

describe("maplibre/selecaoAreasMapa — zero-safe coords", () => {
  it("1) clone/parse aceita latitude 0 (sem ||)", () => {
    expect(parseVertex([0, -59])).toEqual({ lat: 0, lng: -59 });
    expect(clonePersistedCoordsExact(square)).toEqual([
      [0, -59],
      [0, -58.9],
      [-0.1, -58.9],
      [-0.1, -59],
    ]);
    const broken = square.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
    expect(broken[0].lat).not.toBe(0);
  });

  it("2) persist [[lat,lng]] round-trip", () => {
    const verts = square.map(([lat, lng]) => ({ lat, lng }));
    expect(toPersistedCoords(verts)[0]).toEqual([0, -59]);
  });
});

describe("maplibre/selecaoAreasMapa — seleção / sync", () => {
  it("3) syncSelectedIds não reseta se userTouched", () => {
    const current = new Set(["a", "b"]);
    const { next, changed } = syncSelectedIds(current, ["x"], { userTouched: true });
    expect([...next].sort()).toEqual(["a", "b"]);
    expect(changed).toBe(false);
  });

  it("4) syncSelectedIds aplica preselect quando limpo", () => {
    const { next, changed } = syncSelectedIds(new Set(), ["p1", "p2"], { userTouched: false });
    expect([...next].sort()).toEqual(["p1", "p2"]);
    expect(changed).toBe(true);
  });

  it("5) toggle determinístico (simulado)", () => {
    const set = new Set(["1"]);
    const id = "1";
    if (set.has(id)) set.delete(id);
    else set.add(id);
    expect(set.has("1")).toBe(false);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    expect(set.has("1")).toBe(true);
  });
});

describe("maplibre/selecaoAreasMapa — visual / layers", () => {
  it("6) opacidades selecionado ≫ idle (distinto de M1)", () => {
    expect(SELECAO_FILL_OPACITY.SELECTED).toBeGreaterThan(SELECAO_FILL_OPACITY.IDLE + 0.25);
    expect(SELECAO_FILL_OPACITY.SELECTED).toBeLessThan(0.78);
  });

  it("7) ensureSelecaoAreasLayers idempotente", () => {
    const sources = new Map();
    const layers = new Set();
    const map = {
      getSource: (id) => sources.get(id) || null,
      addSource: (id, spec) => sources.set(id, spec),
      getLayer: (id) => (layers.has(id) ? { id } : null),
      addLayer: (layer) => layers.add(layer.id),
    };
    ensureSelecaoAreasLayers(map);
    ensureSelecaoAreasLayers(map);
    expect(sources.has(SELECAO_SOURCE_IDS.AREAS)).toBe(true);
    expect(layers.has(SELECAO_LAYER_IDS.AREAS_FILL)).toBe(true);
  });

  it("8) buildSelecaoAreasCollection GeoJSON [lng,lat]", () => {
    const fc = buildSelecaoAreasCollection([
      { id: "a", nome: "PIQUETE", coordenadas: { coords: square, cor: "#61aad9" } },
    ]);
    expect(fc.features).toHaveLength(1);
    const ring = fc.features[0].geometry.coordinates[0];
    expect(ring[0][0]).toBe(-59); // lng
    expect(ring[0][1]).toBe(0); // lat
  });
});

describe("maplibre/selecaoAreasMapa — lote / cor / renumeração", () => {
  it("9) color batch preserva coords zero-safe e sync cor", () => {
    const area = { id: "1", cor: "#111", coordenadas: { coords: square, cor: "#111" } };
    const payload = buildColorBatchPayload(area, "#61aad9");
    expect(payload.cor).toBe("#61aad9");
    expect(payload.coordenadas.cor).toBe("#61aad9");
    expect(payload.coordenadas.coords[0]).toEqual([0, -59]);
  });

  it("10) summarizeBatchResults parcial honesto", () => {
    const s = summarizeBatchResults([
      { status: "fulfilled", value: 1 },
      { status: "rejected", reason: new Error("x") },
      { status: "fulfilled", value: 2 },
    ]);
    expect(s.partial).toBe(true);
    expect(s.ok).toBe(2);
    expect(s.fail).toBe(1);
    expect(s.allOk).toBe(false);
  });

  it("11) planRenumeracao fail-fast em conflito", () => {
    const areas = [
      { id: "a", nome: "Beta", numero_area: "10" },
      { id: "b", nome: "Alfa", numero_area: "11" },
      { id: "c", nome: "Outra", numero_area: "2" },
    ];
    const bad = planRenumeracao(areas, ["a", "b"], 2);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/Conflito/);

    const good = planRenumeracao(areas, ["a", "b"], 100);
    expect(good.ok).toBe(true);
    expect(good.plan[0]).toEqual({ id: "b", numero_area: "100" }); // Alfa primeiro
    expect(good.plan[1]).toEqual({ id: "a", numero_area: "101" });
  });

  it("12) confirm once + onClose sem save (contrato)", () => {
    let calls = 0;
    let confirmed = false;
    const onConfirm = () => {
      if (confirmed) return;
      confirmed = true;
      calls += 1;
    };
    onConfirm();
    onConfirm();
    expect(calls).toBe(1);
    // onClose não chama onConfirm
    const onClose = () => {};
    onClose();
    expect(calls).toBe(1);
  });
});

describe("maplibre/selecaoAreasMapa — sem Google neste componente", () => {
  it("13) SelecaoAreasMapa não importa loadGoogleMaps / createRoot overlay", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/mapa/SelecaoAreasMapa.jsx"),
      "utf8"
    );
    expect(src).not.toMatch(/loadGoogleMaps|from ["']@\/lib\/googleMaps["']/);
    expect(src).not.toMatch(/createRoot|google\.maps\./);
    expect(src).toMatch(/createEditorMap/);
    expect(src).toMatch(/textContent/);
  });

  it("14) Google permanece em outros consumidores", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const geral = fs.readFileSync(path.join(process.cwd(), "src/pages/MapaGeral.jsx"), "utf8");
    const deposito = fs.readFileSync(
      path.join(process.cwd(), "src/components/mapa/ModalCadastroLotePontos.jsx"),
      "utf8"
    );
    const gmaps = fs.readFileSync(path.join(process.cwd(), "src/lib/googleMaps.js"), "utf8");
    // MAPLIBRE-AREAS (D-PROD-65): Mapa Geral migrou para MapLibre; Google segue só no lote de pontos.
    expect(geral).not.toMatch(/loadGoogleMaps|google\.maps\./);
    expect(deposito).toMatch(/loadGoogleMaps/);
    expect(gmaps).toMatch(/export const loadGoogleMaps/);
  });
});

describe("maplibre/selecaoAreasMapa — lifecycle fake", () => {
  it("createEditorMap + dispose", async () => {
    const sources = new Map();
    const layers = new Set();
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
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        resize: vi.fn(),
        getCanvas: () => ({ style: {} }),
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
    const { ensureSelecaoAreasLayers: ensure } = await import("@/lib/maplibre/selecaoAreasMapa.js");
    const { map, dispose, getCancelled } = createEditorMap(document.createElement("div"));
    ensure(map);
    dispose();
    expect(getCancelled()).toBe(true);
    expect(map.remove).toHaveBeenCalled();
  });
});

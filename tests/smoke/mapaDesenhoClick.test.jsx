import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

const sources = new Map();
const layers = new Set();
const handlers = new Map();
let mapInstance;

function makeMap() {
  mapInstance = {
    dragPan: { disable: vi.fn(), enable: vi.fn() },
    touchZoomRotate: { disableRotation: vi.fn() },
    addControl: vi.fn(),
    remove: vi.fn(),
    getZoom: () => 14,
    setZoom: vi.fn(),
    setCenter: vi.fn(),
    fitBounds: vi.fn(),
    isStyleLoaded: () => true,
    project: vi.fn(() => ({ x: 0, y: 0 })),
    unproject: vi.fn(([x, y]) => ({
      lng: x / 100,
      lat: y / 100,
      lngLat: undefined,
    })),
    getSource: (id) => sources.get(id) || null,
    getLayer: (id) => (layers.has(id) ? { id } : null),
    addSource: (id, spec) => {
      sources.set(id, { ...spec, setData: vi.fn() });
    },
    addLayer: (layer) => layers.add(layer.id),
    setPaintProperty: vi.fn(),
    setStyle: vi.fn(),
    queryRenderedFeatures: vi.fn(() => []),
    once: (ev, cb) => handlers.set(`once:${ev}`, cb),
    on: (ev, a, b) => {
      const cb = typeof a === "function" ? a : b;
      const key = typeof a === "string" ? `${ev}:${a}` : ev;
      handlers.set(key, cb);
      if (ev === "load") {
        // deferred
        queueMicrotask(() => cb());
      }
    },
    off: vi.fn(),
    getCanvas: () => canvasEl,
  };
  return mapInstance;
}

const canvasEl = document.createElement("canvas");
Object.defineProperty(canvasEl, "getBoundingClientRect", {
  value: () => ({ left: 0, top: 0, width: 400, height: 400 }),
});

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(function Map() {
    return makeMap();
  });
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  return {
    default: { Map, NavigationControl: vi.fn(), Marker: vi.fn(() => ({ setLngLat: () => ({ addTo: () => ({ remove: vi.fn() }) }) })), LngLatBounds },
    Map,
    NavigationControl: vi.fn(),
    Marker: vi.fn(() => ({ setLngLat: () => ({ addTo: () => ({ remove: vi.fn() }) }) })),
    LngLatBounds,
  };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({
  useEmpresaSelecionadaId: () => "emp-1",
}));

vi.mock("@/services/mapaService", () => ({
  listarAreasAtivas: vi.fn(async () => []),
  listarPontosAtivos: vi.fn(async () => []),
  listarLinhasAtivas: vi.fn(async () => []),
  listarIconesDaEmpresa: vi.fn(async () => []),
}));

vi.mock("./FormularioArea", () => ({ default: () => null }));
vi.mock("./FormularioPonto", () => ({ default: () => null }));
vi.mock("./FormularioLinha", () => ({ default: () => null }));

// relative mocks for forms used by MapaDesenho — use absolute aliases if imported that way
vi.mock("@/components/mapa/FormularioArea", () => ({ default: () => null }));
vi.mock("@/components/mapa/FormularioPonto", () => ({ default: () => null }));
vi.mock("@/components/mapa/FormularioLinha", () => ({ default: () => null }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

describe("R5-01 MapaDesenho clique cria vértices", () => {
  beforeEach(() => {
    sources.clear();
    layers.clear();
    handlers.clear();
    vi.resetModules();
  });
  afterEach(() => cleanup());

  it("pointerdown+up adiciona 1º, 2º e 3º vértices sem exceção", async () => {
    const { default: MapaDesenho } = await import("@/components/mapa/MapaDesenho.jsx");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container, findByTestId } = render(
      <QueryClientProvider client={qc}>
        <MapaDesenho tipoDesenho="area" onSalvar={() => {}} onCancelar={() => {}} />
      </QueryClientProvider>
    );

    await findByTestId("mapa-desenho-maplibre");
    // dispara load
    await act(async () => {
      handlers.get("load")?.();
      await Promise.resolve();
    });

    const canvas = mapInstance.getCanvas();
    const clickAt = (x, y) => {
      fireEvent.pointerDown(canvas, { clientX: x, clientY: y, pointerType: "mouse", isPrimary: true });
      fireEvent.pointerUp(canvas, { clientX: x, clientY: y, pointerType: "mouse", isPrimary: true });
    };

    await act(async () => {
      clickAt(10, 10);
      clickAt(50, 10);
      clickAt(50, 50);
    });

    // Source de desenho/vértices deve ter sido atualizada (sem throw)
    expect(sources.has("m1-vertices") || sources.has("m1-desenho")).toBe(true);
    expect(container.querySelector('[data-testid="mapa-desenho-maplibre"]')).toBeTruthy();
  });
});

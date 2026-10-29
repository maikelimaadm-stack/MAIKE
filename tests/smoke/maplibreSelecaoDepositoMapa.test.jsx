import React from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DEPOSITO_LAYER_IDS,
  DEPOSITO_SOURCE_IDS,
  boundsLngLats,
  buildDepositos,
  buildLinhaCollection,
  distanciaCochoDeposito,
  ensureDepositoLayers,
  estadoDeposito,
  formatDistanciaMetros,
  iconSizePreservingAspect,
} from "@/lib/maplibre/selecaoDepositoMapa.js";

// ---------------------------------------------------------------- mocks DOM
const h = vi.hoisted(() => {
  const state = {
    maps: /** @type {any[]} */ ([]),
    markers: /** @type {any[]} */ ([]),
    setSourceData: /** @type {any} */ (null),
    createFail: /** @type {null | Error} */ (null),
    empresa: "emp-1",
    supl: /** @type {Record<string, any>} */ ({}),
    refs: /** @type {Record<string, any>} */ ({}),
    suplFail: false,
  };
  return state;
});

vi.mock("@/lib/maplibre/lifecycle.js", () => {
  class Marker {
    constructor({ element }) {
      this.el = element;
      this.removed = false;
      h.markers.push(this);
    }
    setLngLat(ll) {
      this.lngLat = ll;
      return this;
    }
    addTo(map) {
      map.container.appendChild(this.el);
      return this;
    }
    remove() {
      this.removed = true;
      this.el.remove();
    }
  }
  class LngLatBounds {
    constructor(a) {
      this.pts = [a];
    }
    extend(p) {
      this.pts.push(p);
      return this;
    }
  }
  const createEditorMap = (container, opts) => {
    if (h.createFail) throw h.createFail;
    const handlers = new Map();
    const map = {
      container,
      opts,
      removed: false,
      fitBounds: (...a) => map.fitCalls.push(a),
      fitCalls: [],
      jumpTo: (...a) => map.jumpCalls.push(a),
      jumpCalls: [],
      resize() {},
      getSource: () => ({}),
      addSource() {},
      getLayer: () => ({}),
      addLayer() {},
      on: (ev, fn) => handlers.set(ev, fn),
      off: (ev) => handlers.delete(ev),
      fire: (ev, arg) => handlers.get(ev)?.(arg),
      handlers,
    };
    h.maps.push(map);
    let cancelled = false;
    return {
      map,
      dispose: () => {
        cancelled = true;
        map.removed = true;
      },
      getCancelled: () => cancelled,
    };
  };
  return {
    createEditorMap,
    maplibregl: { Marker, LngLatBounds },
    setSourceData: (...a) => h.setSourceData(...a),
  };
});

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({
  useEmpresaSelecionadaId: () => h.empresa,
}));

vi.mock("@/services/mapaService", () => ({
  listarPontosSuplementacaoDaEmpresa: async (id) => {
    if (h.suplFail) throw new Error("falha");
    return h.supl[id] || [];
  },
  listarPontosDaEmpresa: async (id) => h.refs[id] || [],
}));

const dep = (id, extra = {}) => ({
  id,
  empresa_id: "emp-1",
  status: "Ativo",
  categoria_ponto: "Depósito",
  nome_ponto: `Dep ${id}`,
  coordenadas: { lat: -15.001, lng: -59.001 },
  ...extra,
});

// ------------------------------------------------------------- helpers puros
describe("M2-B3 helpers — filtragem / ícone", () => {
  it("filtra empresa, ativo, categoria DEPOSITO e aceita coordenada 0", () => {
    const supl = [
      dep("a", { coordenadas: { lat: 0, lng: 0 } }),
      dep("b", { coordenadas: { lat: 0, lng: -59 } }),
      dep("c", { empresa_id: "emp-2" }),
      dep("d", { status: "Inativo" }),
      dep("e", { categoria_ponto: "Cocho" }),
      dep("f", { coordenadas: { lat: NaN, lng: 1 } }),
      dep("g", { coordenadas: null }),
      dep("h", { coordenadas: { lat: 95, lng: 1 } }),
      dep("a", { nome_ponto: "duplicado" }),
    ];
    const out = buildDepositos(supl, [], "emp-1");
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
    expect(out[0].coords).toEqual({ lat: 0, lng: 0 });
    expect(out[0].nome_ponto).toBe("Dep a");
    expect(out.every((d) => Number.isFinite(d.coords.lat) && Number.isFinite(d.coords.lng))).toBe(true);
    expect(buildDepositos(supl, [], null)).toEqual([]);
  });

  it("ícone por nome ou sigla, primeira ocorrência, sem vazar empresa/inativo", () => {
    const refs = [
      { empresa_id: "emp-2", nome: "Dep a", icone_url: "x://outra" },
      { empresa_id: "emp-1", nome: "Dep a", ativo: false, icone_url: "x://inativo" },
      { empresa_id: "emp-1", nome: "  dep A ", icone_url: "x://nome" },
      { empresa_id: "emp-1", nome: "Dep a", icone_url: "x://segundo" },
      { empresa_id: "emp-1", nome: "zzz", sigla: "DB", icone_url: "x://sigla" },
    ];
    const out = buildDepositos([dep("a"), dep("b", { sigla: "db" }), dep("c")], refs, "emp-1");
    expect(out.find((d) => d.id === "a").icone_url).toBe("x://nome");
    expect(out.find((d) => d.id === "b").icone_url).toBe("x://sigla");
    expect(out.find((d) => d.id === "c").icone_url).toBeNull();
  });
});

describe("M2-B3 helpers — distância / linha / bounds", () => {
  it("distância zero, positiva conhecida e inválida — sem Maps SDK", () => {
    expect(/** @type {any} */ (window).google).toBeUndefined();
    expect(distanciaCochoDeposito({ lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toBe(0);
    const d = distanciaCochoDeposito({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
    expect(distanciaCochoDeposito(null, { lat: 0, lng: 0 })).toBeNull();
    expect(distanciaCochoDeposito({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 })).toBeNull();
    expect(formatDistanciaMetros(0)).toBe("0 m");
    expect(formatDistanciaMetros(111.2)).toMatch(/ m$/);
    expect(formatDistanciaMetros(null)).toBe("");
  });

  it("linha e bounds em [lng,lat]", () => {
    const fc = buildLinhaCollection({ lat: -15, lng: -59 }, { lat: -15.1, lng: -59.2 });
    expect(fc.features[0].geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-59, -15],
        [-59.2, -15.1],
      ],
    });
    expect(buildLinhaCollection(null, { lat: 0, lng: 0 }).features).toEqual([]);
    expect(boundsLngLats({ lat: 0, lng: 1 }, [{ coords: { lat: 2, lng: 3 } }])).toEqual([
      [1, 0],
      [3, 2],
    ]);
  });

  it("ícone preserva aspecto; estado; layers idempotentes", () => {
    expect(iconSizePreservingAspect(200, 100, 42)).toEqual({ width: 42, height: 21 });
    expect(iconSizePreservingAspect(100, 200, 42)).toEqual({ width: 21, height: 42 });
    expect(iconSizePreservingAspect(0, 0, 42)).toEqual({ width: 42, height: 42 });
    expect(iconSizePreservingAspect(1000, 10, 42).height).toBe(20);
    expect(estadoDeposito("a", "a", "b")).toBe("selecionado");
    expect(estadoDeposito("b", "a", "b")).toBe("destaque");
    expect(estadoDeposito("c", "a", "b")).toBe("normal");
    const sources = new Map();
    const layers = new Set();
    const map = {
      getSource: (id) => sources.get(id) || null,
      addSource: (id, s) => sources.set(id, s),
      getLayer: (id) => (layers.has(id) ? { id } : null),
      addLayer: (l) => layers.add(l.id),
    };
    ensureDepositoLayers(map);
    ensureDepositoLayers(map);
    expect([...sources.keys()]).toEqual([DEPOSITO_SOURCE_IDS.LINHA]);
    expect([...layers]).toEqual([DEPOSITO_LAYER_IDS.LINHA_BASE, DEPOSITO_LAYER_IDS.LINHA_TRACO]);
  });
});

describe("M2-B3 — Google removido só deste consumidor", () => {
  it("componente sem loadGoogleMaps/google.maps; ModalCadastroLotePontos segue Google", () => {
    const src = readFileSync("src/components/mapa/SelecaoDepositoMapa.jsx", "utf8");
    expect(src).not.toMatch(/loadGoogleMaps|google\.maps|window\.google/);
    expect(src).toMatch(/createEditorMap/);
    expect(src).not.toMatch(/innerHTML/);
    expect(readFileSync("src/components/mapa/ModalCadastroLotePontos.jsx", "utf8")).toMatch(/google\.maps/);
  });
});

// ------------------------------------------------------------- integração DOM
describe("M2-B3 — SelecaoDepositoMapa (DOM, MapLibre mockado)", () => {
  /** @type {any} */
  let SelecaoDepositoMapa;

  beforeEach(async () => {
    h.maps.length = 0;
    h.markers.length = 0;
    h.setSourceData = vi.fn();
    h.createFail = null;
    h.empresa = "emp-1";
    h.suplFail = false;
    h.supl = {
      "emp-1": [
        dep("d1", { coordenadas: { lat: -15, lng: -59.001 } }),
        dep("d2", { coordenadas: { lat: 0, lng: 0 }, nome_ponto: "Zero" }),
      ],
      "emp-2": [dep("x1", { empresa_id: "emp-2", nome_ponto: "Outra" })],
    };
    h.refs = { "emp-1": [{ empresa_id: "emp-1", nome: "Dep d1", icone_url: "https://ex/i.png" }] };
    ({ default: SelecaoDepositoMapa } = await import("@/components/mapa/SelecaoDepositoMapa.jsx"));
  });
  afterEach(() => cleanup());

  const montar = (props = {}) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const all = { cochoCoords: { lat: -15, lng: -59 }, depositoSelecionadoId: null, onSelect, onClose, ...props };
    const ui = (p) => (
      <QueryClientProvider client={qc}>
        <SelecaoDepositoMapa {...p} />
      </QueryClientProvider>
    );
    const r = render(ui(all));
    return { ...r, onSelect, onClose, rerenderWith: (p) => r.rerender(ui({ ...all, ...p })) };
  };

  const carregar = async () => {
    await waitFor(() => expect(h.maps.length).toBe(1));
    act(() => h.maps[0].fire("load"));
    await waitFor(() => expect(screen.getAllByLabelText(/Selecionar depósito/).length).toBe(2));
  };

  it("monta 1 mapa, cocho + depósitos, fit único, clique chama onSelect 1x, confirmar só fecha", async () => {
    const { onSelect, onClose, rerenderWith, getByText } = montar();
    await carregar();
    const map = h.maps[0];
    expect(map.opts.center).toEqual({ lat: -15, lng: -59 });
    expect(screen.getByLabelText("Cocho")).toBeTruthy();
    expect(map.fitCalls.length).toBe(1);

    const botao = screen.getByLabelText("Selecionar depósito Zero");
    fireEvent.click(botao);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("d2");
    expect(onClose).not.toHaveBeenCalled();

    rerenderWith({ depositoSelecionadoId: "d2", cochoCoords: { lat: -15, lng: -59 } });
    await waitFor(() => expect(botao.getAttribute("aria-pressed")).toBe("true"));
    expect(screen.getByTestId("deposito-destaque").textContent).toMatch(/Zero/);
    expect(screen.getByTestId("deposito-destaque").textContent).toMatch(/Distância: .* m/);
    const ultimaLinha = h.setSourceData.mock.calls.at(-1)[2];
    expect(ultimaLinha.features[0].geometry.coordinates).toEqual([
      [-59, -15],
      [0, 0],
    ]);

    // sem recriar mapa/markers nem refit
    expect(h.maps.length).toBe(1);
    expect(map.fitCalls.length).toBe(1);
    const vivos = h.markers.filter((m) => !m.removed);
    expect(vivos.length).toBe(3);

    fireEvent.click(getByText("Confirmado"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("cancelar e fechar não selecionam; teclado foca e destaca", async () => {
    const { onSelect, onClose, getByText } = montar();
    await carregar();
    const botao = screen.getByLabelText("Selecionar depósito Dep d1");
    fireEvent.focus(botao);
    await waitFor(() => expect(botao.dataset.estado).toBe("destaque"));
    fireEvent.click(getByText("Cancelar"));
    fireEvent.click(screen.getByLabelText("Fechar seleção de depósito"));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSelect).not.toHaveBeenCalled();
    expect(getByText("Confirmado").closest("button").disabled).toBe(true);
  });

  it("ícone: load preserva aspecto, erro cai no fallback, async pós-unmount é ignorado", async () => {
    const { unmount } = montar();
    await carregar();
    const el = screen.getByLabelText("Selecionar depósito Dep d1");
    const img = el.querySelector("img");
    const dot = el.querySelector("span");
    expect(img).toBeTruthy();
    expect(dot.style.display).toBe("block");
    Object.defineProperty(img, "naturalWidth", { value: 200 });
    Object.defineProperty(img, "naturalHeight", { value: 100 });
    act(() => img.onload());
    expect(img.style.width).toBe("42px");
    expect(img.style.height).toBe("21px");
    expect(dot.style.display).toBe("none");
    expect(el.querySelectorAll("img").length).toBe(1);

    const onerror = img.onerror;
    act(() => img.onerror());
    expect(img.style.display).toBe("none");
    expect(dot.style.display).toBe("block");

    unmount();
    expect(h.maps[0].removed).toBe(true);
    expect(h.markers.every((m) => m.removed)).toBe(true);
    expect(img.onload).toBeNull();
    expect(() => onerror?.()).not.toThrow();
  });

  it("troca de empresa não mostra depósitos da anterior e refaz fit", async () => {
    const { rerenderWith } = montar();
    await carregar();
    h.empresa = "emp-2";
    rerenderWith({});
    await waitFor(() => expect(screen.getByLabelText("Selecionar depósito Outra")).toBeTruthy());
    expect(screen.queryByLabelText("Selecionar depósito Zero")).toBeNull();
    expect(h.maps.length).toBe(1);
    expect(h.maps[0].fitCalls.length).toBe(2);
  });

  it("cocho com coordenada inválida não gera NaN nem marcador", async () => {
    montar({ cochoCoords: { lat: "x", lng: null } });
    await carregar();
    expect(screen.queryByLabelText("Cocho")).toBeNull();
    expect(screen.getByText(/Cocho sem coordenada válida/)).toBeTruthy();
    for (const call of h.setSourceData.mock.calls) expect(call[2].features).toEqual([]);
  });

  it("erro de WebGL mostra estado honesto e retry recria", async () => {
    h.createFail = new Error("WebGL indisponível");
    montar();
    await waitFor(() => expect(screen.getByText("WebGL indisponível")).toBeTruthy());
    h.createFail = null;
    fireEvent.click(screen.getByText("Tentar novamente"));
    await waitFor(() => expect(h.maps.length).toBe(1));
  });

  it("erro de tiles e falha de consulta são visíveis; vazio honesto", async () => {
    h.suplFail = true;
    montar();
    await waitFor(() => expect(h.maps.length).toBe(1));
    act(() => h.maps[0].fire("load"));
    await waitFor(() => expect(screen.getByText("Falha ao carregar depósitos.")).toBeTruthy());
    act(() => h.maps[0].fire("error", { error: { message: "tile fetch 404" } }));
    await waitFor(() => expect(screen.getByText(/Falha ao carregar o estilo ou tiles/)).toBeTruthy());
    cleanup();

    h.suplFail = false;
    h.supl = {};
    montar();
    await waitFor(() => expect(screen.getByText(/Nenhum depósito ativo/)).toBeTruthy());
  });
});

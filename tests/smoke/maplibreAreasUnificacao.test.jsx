import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// ───────────────────────────────────────────────────────── editorModos (D)
import {
  MODOS,
  desenhoAlterado,
  modoInicial,
  podeAdicionarVertice,
  podeEditarVertices,
  podeMoverArea,
  removerVertice,
  segmentosDaRegua,
  transladarPontos,
  travarAngulo45,
} from "@/lib/maplibre/editorModos.js";
import { areaHectares, comprimentoMetros } from "@/lib/geografia";

const quadrado = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.001 },
  { lat: -0.001, lng: 0.001 },
  { lat: -0.001, lng: 0 },
];

describe("D — máquina de estados do editor", () => {
  it("D01/D03 — NAVEGAR nunca cria vértice; DESENHAR só com desenho aberto", () => {
    expect(podeAdicionarVertice(MODOS.NAVEGAR, false)).toBe(false);
    expect(podeAdicionarVertice(MODOS.EDITAR, false)).toBe(false);
    expect(podeAdicionarVertice(MODOS.MOVER, false)).toBe(false);
    expect(podeAdicionarVertice(MODOS.DESENHAR, false)).toBe(true);
    expect(podeAdicionarVertice(MODOS.DESENHAR, true)).toBe(false);
  });

  it("modo inicial: novo desenho → DESENHAR; edição de área/linha → EDITAR", () => {
    expect(modoInicial({ tipo: "area", editando: false })).toBe(MODOS.DESENHAR);
    expect(modoInicial({ tipo: "area", editando: true })).toBe(MODOS.EDITAR);
    expect(modoInicial({ tipo: "linha", editando: true })).toBe(MODOS.EDITAR);
    expect(modoInicial({ tipo: "ponto", editando: true })).toBe(MODOS.DESENHAR);
    expect(modoInicial({ tipo: null })).toBe(MODOS.NAVEGAR);
  });

  it("D04 — editar vértices só em EDITAR (área/linha)", () => {
    expect(podeEditarVertices(MODOS.EDITAR, "area")).toBe(true);
    expect(podeEditarVertices(MODOS.NAVEGAR, "area")).toBe(false);
    expect(podeEditarVertices(MODOS.MOVER, "area")).toBe(false);
    expect(podeEditarVertices(MODOS.DESENHAR, "area")).toBe(false);
  });

  it("D05 — remover vértice preserva mínimo (3 área, 2 linha)", () => {
    const r = removerVertice(quadrado, 1, "area");
    expect(r).toHaveLength(3);
    expect(r[1]).toEqual(quadrado[2]);
    expect(removerVertice(r, 0, "area")).toBeNull();
    expect(removerVertice(quadrado.slice(0, 2), 0, "linha")).toBeNull();
    expect(removerVertice(quadrado, 9, "area")).toBeNull();
  });

  it("D06 — Shift trava em 45° (pixels)", () => {
    expect(travarAngulo45({ x: 0, y: 0 }, { x: 10, y: 1 })).toEqual({ x: 10.04987562112089, y: 0 });
    const d = travarAngulo45({ x: 0, y: 0 }, { x: 10, y: 9 });
    expect(Math.abs(d.x - d.y)).toBeLessThan(1e-9);
    expect(travarAngulo45({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
  });

  it("D07 — mover só com a mão; translação preserva forma e área", () => {
    expect(podeMoverArea(MODOS.EDITAR, quadrado)).toBe(false);
    expect(podeMoverArea(MODOS.MOVER, [])).toBe(false);
    expect(podeMoverArea(MODOS.MOVER, quadrado)).toBe(true);
    const movido = transladarPontos(quadrado, 0.01, -0.02);
    expect(movido[0]).toEqual({ lat: 0.01, lng: -0.02 });
    expect(Math.abs(areaHectares(movido) - areaHectares(quadrado))).toBeLessThan(1e-3);
    expect(transladarPontos(quadrado, NaN, 0)).toEqual(quadrado);
  });

  it("régua: segmentos geodésicos; polígono fechado mede o último→primeiro", () => {
    const aberto = segmentosDaRegua(quadrado, false, (a, b) => comprimentoMetros([a, b]));
    const fechado = segmentosDaRegua(quadrado, true, (a, b) => comprimentoMetros([a, b]));
    expect(aberto).toHaveLength(3);
    expect(fechado).toHaveLength(4);
    expect(fechado[0].metros).toBeGreaterThan(110);
    expect(fechado[0].metros).toBeLessThan(112);
  });

  it("D09/D10 — alteração detectada para avisar antes de descartar", () => {
    expect(desenhoAlterado(quadrado, quadrado.map((p) => ({ ...p })))).toBe(false);
    expect(desenhoAlterado(quadrado, transladarPontos(quadrado, 0.0001, 0))).toBe(true);
    expect(desenhoAlterado([], [])).toBe(false);
  });
});

// ─────────────────────────────────────────────────── mapaGeralRender (V)
import {
  MG_LAYER_IDS,
  boundsDasAreas,
  buildMgAreasCollection,
  buildMgLinhasCollection,
  centroideArea,
  ensureMgLayers,
  fontesRotuloPorZoom,
  iconeSemAchatar,
  lerVisaoSalva,
  resolverIconeLote,
  resolverIconeSuplementacao,
  textoHectares,
} from "@/lib/maplibre/mapaGeralRender.js";
import { corExibidaNoMapa, paintAreaDivisa, LARGURA_DIVISA_EXPR } from "@/lib/maplibre/estiloAreas.js";

const area = (id, extra = {}) => ({
  id,
  nome: `Área ${id}`,
  tamanho_hectares: 12.5,
  coordenadas: { coords: [[0, 0], [0, 0.01], [-0.01, 0.01], [-0.01, 0]], cor: "#0d67ad" },
  ...extra,
});

describe("V — visualização das áreas cadastradas", () => {
  it("V01 — cor salva (+5% branco) e modo de coloração; zero válido; [lng,lat]", () => {
    const fc = buildMgAreasCollection([area("a"), area("b", { coordenadas: { coords: [[1, 2]] } })]);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.properties.fill).toBe(corExibidaNoMapa("#0d67ad"));
    expect(f.geometry.coordinates[0][0]).toEqual([0, 0]);
    expect(f.geometry.coordinates[0][1]).toEqual([0.01, 0]);
    const modo = buildMgAreasCollection([area("a")], () => "#ef4444");
    expect(modo.features[0].properties.cor).toBe("#ef4444");
    const semModo = buildMgAreasCollection([area("a")], () => null);
    expect(semModo.features[0].properties.cor).toBe("#0d67ad");
  });

  it("V01 — divisa branca fina interpolada por zoom (mesmo SSOT do editor)", () => {
    const p = paintAreaDivisa();
    expect(p["line-color"]).toBe("#ffffff");
    expect(p["line-width"]).toEqual([...LARGURA_DIVISA_EXPR]);
    const editor = readFileSync("src/lib/maplibre/lifecycle.js", "utf8");
    expect(editor).toContain("paintAreaDivisa()");
  });

  it("rótulos: hectares legíveis, fonte por faixa de zoom", () => {
    expect(textoHectares(area("a"))).toBe("ha 12,50");
    expect(textoHectares(area("a", { area_pastejada: 3 }))).toBe("ha 3,00");
    expect(textoHectares(area("a", { tamanho_hectares: 0 }))).toBeNull();
    expect(fontesRotuloPorZoom(10)).toEqual({ nome: 10, ha: 9 });
    expect(fontesRotuloPorZoom(17).nome).toBeGreaterThan(fontesRotuloPorZoom(14).nome);
  });

  it("lotes: âncora no centroide (ícone deslocado em px); ícone por categoria/misto preservado", () => {
    const c = centroideArea(area("a"));
    expect(c.lat).toBeCloseTo(-0.005, 9);
    expect(c.lng).toBeCloseTo(0.005, 9);
    expect(readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8")).toMatch(/offset: OFFSET_LOTE_PX/);
    const icones = [
      { tipo_entidade: "Lote", categoria: "BOI", icone_url: "u://boi" },
      { tipo_entidade: "Lote", categoria: "MISTO", categorias_misto: ["BOI", "VACA"], icone_url: "u://misto" },
    ];
    expect(resolverIconeLote([{ categoria: "boi" }], icones).iconUrl).toBe("u://boi");
    expect(resolverIconeLote([{ categoria: "boi" }, { categoria: "VACA" }], icones).iconUrl).toBe("u://misto");
    expect(resolverIconeSuplementacao({ categoria_ponto: "DEPOSITO" }, [{ tipo_entidade: "Ponto", categoria: "cocho", icone_url: "u://c" }]).iconUrl).toBe("u://c");
  });

  it("ícone sem achatar; bounds e visão salva zero-safe", () => {
    expect(iconeSemAchatar(400, 100, 40)).toEqual({ width: 40, height: 10 });
    expect(boundsDasAreas([area("a")])).toEqual([[0, -0.01], [0.01, 0]]);
    expect(boundsDasAreas([])).toBeNull();
    expect(lerVisaoSalva('{"center":{"lat":0,"lng":0},"zoom":15}')).toEqual({ center: { lat: 0, lng: 0 }, zoom: 15 });
    expect(lerVisaoSalva("{lixo")).toBeNull();
  });

  it("linhas e camadas idempotentes", () => {
    expect(buildMgLinhasCollection([{ id: "l", coordenadas: { coords: [[0, 0], [1, 1]] } }]).features).toHaveLength(1);
    const sources = new Map();
    const layers = [];
    const map = {
      getSource: (id) => sources.get(id),
      addSource: (id, spec) => sources.set(id, spec),
      getLayer: (id) => layers.find((l) => l.id === id),
      addLayer: (l) => layers.push(l),
    };
    ensureMgLayers(map);
    ensureMgLayers(map);
    expect(layers.map((l) => l.id)).toEqual(Object.values(MG_LAYER_IDS));
    expect(sources.get("mg-areas").promoteId).toBe("id");
  });
});

// ─────────────────────────────────────────────── Map Tiles / satélite (S)
const fakeMap = () => {
  const handlers = new Map();
  const layers = [{ id: "base-bg", source: "openmaptiles" }, { id: "mg-areas-fill", source: "mg-areas" }];
  const sources = new Map();
  const layout = new Map();
  return {
    handlers,
    layers,
    sources,
    layout,
    on: (ev, fn) => handlers.set(ev, fn),
    off: (ev) => handlers.delete(ev),
    once: vi.fn(),
    fire: (ev, arg) => handlers.get(ev)?.(arg),
    getStyle: () => ({ layers }),
    getSource: (id) => sources.get(id),
    addSource: (id, s) => sources.set(id, s),
    removeSource: (id) => sources.delete(id),
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (l, before) => {
      const i = before ? layers.findIndex((x) => x.id === before) : layers.length;
      layers.splice(i < 0 ? layers.length : i, 0, { ...l });
    },
    removeLayer: (id) => layers.splice(layers.findIndex((l) => l.id === id), 1),
    setLayoutProperty: (id, k, v) => layout.set(id, v),
    setStyle: vi.fn(),
    getZoom: () => 15,
    getBounds: () => ({ getNorth: () => -14, getSouth: () => -15, getEast: () => -59, getWest: () => -60 }),
  };
};

const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe("S — satélite via Google Map Tiles API", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("S05 — sem chave: estado de erro honesto, volta para Mapa, sem requisição", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("VITE_MAP_SATELLITE_STYLE_URL", "");
    const { createBasemapController } = await import("@/lib/maplibre/basemapController.js");
    const fetchImpl = vi.fn();
    const states = [];
    const map = fakeMap();
    const c = createBasemapController(/** @type {any} */ (map), { fetchImpl, onState: (s) => states.push(s) });
    c.setBasemap("satelite");
    expect(fetchImpl).not.toHaveBeenCalled();
    const ult = states.at(-1);
    expect(ult.basemapId).toBe("ruas");
    expect(ult.status).toBe("erro");
    expect(ult.mensagem).toMatch(/Map Tiles API/);
  });

  it("S01/S02 — createSession → raster abaixo das camadas de negócio; alterna sem remontar", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "chave-teste");
    const { createBasemapController } = await import("@/lib/maplibre/basemapController.js");
    const { descartarSessoesMapTiles } = await import("@/lib/maplibre/googleMapTiles.js");
    descartarSessoesMapTiles();
    const fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes("createSession")) {
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body)).toMatchObject({ mapType: "satellite" });
        return resp(200, { session: "SESS", expiry: String(Math.floor(Date.now() / 1000) + 86400), tileWidth: 256 });
      }
      return resp(200, { copyright: "Imagens ©2026 Maxar" });
    });
    const states = [];
    const map = fakeMap();
    const c = createBasemapController(/** @type {any} */ (map), { fetchImpl, onState: (s) => states.push(s) });
    c.setBasemap("satelite");
    await vi.waitFor(() => expect(states.at(-1).status).toBe("pronto"));
    expect(states.at(-1).basemapId).toBe("satelite");
    expect(map.layers.map((l) => l.id)).toEqual(["base-bg", "maike-basemap-satelite", "mg-areas-fill"]);
    const src = map.sources.get("maike-basemap-satelite");
    expect(src.type).toBe("raster");
    expect(src.tiles[0]).toMatch(/^https:\/\/tile\.googleapis\.com\/v1\/2dtiles\/\{z\}\/\{x\}\/\{y\}\?session=SESS&key=/);
    expect(src.attribution).toBe("Google Maps");
    // atribuição dinâmica do viewport
    map.fire("moveend");
    await vi.waitFor(() => expect(states.at(-1).atribuicao).toBe("Google Maps · Imagens ©2026 Maxar"), { timeout: 2000 });
    // ruas ↔ satélite N vezes: só visibilidade, mesma sessão (1 createSession)
    for (let i = 0; i < 3; i += 1) {
      c.setBasemap("ruas");
      expect(map.layout.get("maike-basemap-satelite")).toBe("none");
      c.setBasemap("satelite");
      await vi.waitFor(() => expect(map.layout.get("maike-basemap-satelite")).toBe("visible"));
    }
    expect(fetchImpl.mock.calls.filter(([u]) => String(u).includes("createSession"))).toHaveLength(1);
    expect(map.setStyle).not.toHaveBeenCalled();
    c.dispose();
    expect(map.handlers.size).toBe(0);
  });

  it("S03 — 403 na sessão e 429 no tile → erro visível, volta a Mapa, retry força nova sessão", async () => {
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "chave-teste");
    const { createBasemapController } = await import("@/lib/maplibre/basemapController.js");
    const { descartarSessoesMapTiles } = await import("@/lib/maplibre/googleMapTiles.js");
    descartarSessoesMapTiles();
    let falhar = true;
    const fetchImpl = vi.fn(async () => (falhar ? resp(403, {}) : resp(200, { session: "S2", expiry: "9999999999" })));
    const states = [];
    const map = fakeMap();
    const c = createBasemapController(/** @type {any} */ (map), { fetchImpl, onState: (s) => states.push(s) });
    c.setBasemap("satelite");
    await vi.waitFor(() => expect(states.at(-1).status).toBe("erro"));
    expect(states.at(-1).basemapId).toBe("ruas");
    expect(states.at(-1).mensagem).toMatch(/Map Tiles API/);
    falhar = false;
    c.retry();
    await vi.waitFor(() => expect(states.at(-1).basemapId).toBe("satelite"));
    map.fire("error", { sourceId: "maike-basemap-satelite", error: { status: 429 } });
    expect(states.at(-1).status).toBe("erro");
    expect(states.at(-1).mensagem).toMatch(/429/);
    expect(map.layout.get("maike-basemap-satelite")).toBe("none");
    c.dispose();
  });

  it("S04 — chave fora do bundle de logs; sessão só em memória; expiry respeitado", async () => {
    const mod = await import("@/lib/maplibre/googleMapTiles.js");
    expect(mod.expiryParaMs("100", 0)).toBe(100000);
    expect(mod.expiryParaMs("x", 0)).toBe(3600000);
    expect(mod.urlViewportMapTiles({ session: "s", key: "k" }, { zoom: 30, north: 95, south: -95, east: 200, west: -200 })).toMatch(
      /zoom=22&north=89\.999&south=-89\.999&east=179\.999&west=-179\.999/
    );
    const fonte = readFileSync("src/lib/maplibre/googleMapTiles.js", "utf8");
    expect(fonte).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|caches\./);
  });
});

// ─────────────────────────────────────────── renderer do Mapa Geral (V03)
const marcadores = [];
vi.mock("@/lib/maplibre/lifecycle.js", async (orig) => {
  const real = await orig();
  class Marker {
    constructor(opts) {
      this.el = opts.element;
      this.opts = opts;
      this.handlers = {};
      this.removed = false;
      marcadores.push(this);
    }
    setLngLat(ll) {
      this.ll = Array.isArray(ll) ? { lng: ll[0], lat: ll[1] } : ll;
      return this;
    }
    getLngLat() {
      return this.ll;
    }
    addTo(map) {
      map.container.appendChild(this.el);
      return this;
    }
    getElement() {
      return this.el;
    }
    setDraggable(v) {
      this.draggable = v;
      return this;
    }
    on(ev, fn) {
      this.handlers[ev] = fn;
      return this;
    }
    remove() {
      this.removed = true;
      this.el.remove();
    }
  }
  class Popup {
    setLngLat() {
      return this;
    }
    setDOMContent(el) {
      this.el = el;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  return { ...real, maplibregl: { Marker, Popup, LngLatBounds: class {} }, setSourceData: (map, id, data) => map.data.set(id, data) };
});

describe("V03 — renderer MapLibre preserva o contrato do Mapa Geral", () => {
  const mkMap = () => {
    const container = document.createElement("div");
    const handlers = [];
    const sources = new Map();
    const layers = [];
    return {
      container,
      data: new Map(),
      handlers,
      getSource: (id) => sources.get(id),
      addSource: (id, s) => sources.set(id, s),
      getLayer: (id) => layers.find((l) => l.id === id),
      addLayer: (l) => layers.push(l),
      on: (...a) => handlers.push(a),
      off: (...a) => {
        const i = handlers.findIndex((h) => h[0] === a[0] && h[h.length - 1] === a[a.length - 1]);
        if (i >= 0) handlers.splice(i, 1);
      },
      getZoom: () => 15,
      getCanvas: () => ({ style: {} }),
      setFeatureState: vi.fn(),
      queryRenderedFeatures: () => [],
    };
  };

  it("áreas/rótulos/lotes/pontos/tarefas/usuário; clique e arrasto; clearAll limpa tudo", async () => {
    marcadores.length = 0;
    const { default: useMapRenderer } = await import("@/components/mapa/useMapRenderer.jsx");
    const map = mkMap();
    const ref = { current: map };
    const { result } = renderHook(() => useMapRenderer(/** @type {any} */ (ref)));
    const r = result.current;
    const onArea = vi.fn();
    r.syncAreas([area("a1"), area("a2", { nome: '<img src=x onerror="window.__x=1">' })], true, onArea, vi.fn(), null);
    expect(map.data.get("mg-areas").features).toHaveLength(2);
    const clickArea = map.handlers.find((h) => h[0] === "click" && h[1] === "mg-areas-fill")[2];
    clickArea({ features: [{ properties: { id: "a1" } }], lngLat: { lat: 0, lng: 0 } });
    expect(onArea).toHaveBeenCalledWith(expect.objectContaining({ id: "a1" }), { lat: 0, lng: 0 });

    r.syncLabels([area("a1"), area("a2", { nome: '<img src=x onerror="window.__x=1">' })], true, (a) => (a.id === "a1" ? "Ocupado 3d" : null), true);
    const labels = map.container.querySelectorAll(".mg-area-label");
    expect(labels).toHaveLength(2);
    expect(labels[0].textContent).toContain("Área a1");
    expect(labels[0].textContent).toContain("ha 12,50");
    expect(labels[0].textContent).toContain("Ocupado 3d");
    expect(labels[1].querySelector("img")).toBeNull();
    expect(/** @type {any} */ (window).__x).toBeUndefined();

    const onLotes = vi.fn();
    const onDrag = vi.fn();
    const lotes = [
      { id: "l1", area_atual_id: "a1", quantidade_cabecas: 30, categoria: "BOI", identificador_cor: "#f00", identificador_sigla: "AB" },
      { id: "l2", area_atual_id: "a1", quantidade_cabecas: 12, categoria: "BOI" },
    ];
    r.syncLotes(lotes, [area("a1")], true, [], onLotes, onDrag, true, false);
    const loteMarker = marcadores.find((m) => m.el.querySelector(".mg-lote-count"));
    expect(loteMarker.el.querySelector(".mg-lote-count").textContent).toBe("42");
    expect(loteMarker.el.querySelector(".mg-lote-ident").textContent).toBe("AB");
    expect(loteMarker.opts.draggable).toBe(true);
    loteMarker.el.click();
    expect(onLotes).toHaveBeenCalledWith(lotes);
    loteMarker.handlers.dragstart();
    loteMarker.ll = { lat: -0.5, lng: 0.5 };
    loteMarker.handlers.dragend();
    expect(onDrag).toHaveBeenCalledWith({ lat: -0.5, lng: 0.5 }, lotes, "a1", [area("a1")]);

    const onSupl = vi.fn();
    r.syncPontosSuplementacao([{ id: "c1", nome_ponto: "Cocho", coordenadas: { lat: 0, lng: 0 } }], true, [], onSupl);
    const cocho = marcadores.find((m) => m.el.title === "Cocho");
    expect(cocho).toBeTruthy();
    cocho.el.click();
    expect(onSupl).toHaveBeenCalled();

    r.syncTarefas([{ id: "t1", titulo: "Cerca", prioridade: "Urgente", area_id: "a1" }], [area("a1")], [], vi.fn());
    expect(marcadores.some((m) => m.el.title === "Cerca")).toBe(true);
    r.syncUserLocation({ lat: 0, lng: 0 }, true);
    expect(map.data.get("mg-user").features).toHaveLength(1);

    // filtro esconde pontos: remove só o grupo
    r.syncPontosSuplementacao([], false, [], onSupl);
    expect(cocho.removed).toBe(true);
    expect(loteMarker.removed).toBe(false);

    r.clearAll();
    expect(marcadores.every((m) => m.removed)).toBe(true);
    expect(map.handlers.filter((h) => typeof h[1] === "string")).toHaveLength(0);
  });

  it("fontes do Mapa Geral e do renderer não têm Google nem innerHTML", () => {
    const geral = readFileSync("src/pages/MapaGeral.jsx", "utf8");
    const renderer = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    for (const src of [geral, renderer]) {
      expect(src).not.toMatch(/google\.maps|loadGoogleMaps/);
      expect(src).not.toMatch(/innerHTML/);
      expect(src).not.toMatch(/c\[0\] \|\| c\.lat/);
    }
    expect(readFileSync("src/components/mapa/ModalCadastroLotePontos.jsx", "utf8")).toMatch(/google\.maps/);
  });
});

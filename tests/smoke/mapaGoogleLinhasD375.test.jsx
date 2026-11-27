/**
 * D-PROD-375 — mapa do Google, etapa 4: linhas, minha localização e "Localizar" (site e app, sem APK novo).
 *
 *  G375-1. As linhas (cor da linha, 3 px × densidade, `tag`), o círculo da precisão (3 a 500 m, 20 m sem leitura) e o
 *          ponto azul (por cima de tudo, sem toque).
 *  G375-2. Mapa do site: linhas e círculos pela Maps JavaScript API; o toque na linha devolve a `tag` (o gesto que
 *          começou num ícone não abre a linha); "Localizar" centraliza no zoom do Google; destruir limpa.
 *  G375-3. Componente no app: linhas no mapa nativo e o toque nelas; o ponto azul como marcador nativo e o círculo
 *          (o novo entra antes do velho sair); `centrar` vira `setCamera`.
 *  G375-4. `useLocalizacaoNoMapa`: com o mapa do Google aberto, "Localizar" centraliza nele, não no MapLibre.
 */
import React from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/googleMaps", () => ({ loadGoogleMaps: vi.fn(async () => {}) }));

const app = vi.hoisted(() => ({ build: "9" }));
vi.mock("@capacitor/app", () => ({ App: { getInfo: vi.fn(async () => ({ build: app.build })) } }));

const plugin = vi.hoisted(() => ({ nativo: false }));
vi.mock("@capacitor/core", async (orig) => {
  const real = /** @type {any} */ (await orig());
  return {
    ...real,
    registerPlugin: () => ({ addListener: async () => ({ remove: () => {} }) }),
    Capacitor: {
      ...real.Capacitor,
      isNativePlatform: () => plugin.nativo,
      getPlatform: () => (plugin.nativo ? "android" : "web"),
      isPluginAvailable: () => plugin.nativo,
    },
  };
});

const falso = vi.hoisted(() => ({ mapa: /** @type {any} */ (null) }));
vi.mock("@capacitor/google-maps", () => ({
  GoogleMap: {
    create: vi.fn(async () => {
      const ouvintes = {};
      let n = 0;
      const ids = (l, p) => l.map(() => `${p}${++n}`);
      falso.mapa = {
        id: "mapa-1",
        ouvintes,
        setMapType: vi.fn(async () => {}),
        addPolygons: vi.fn(async (l) => ids(l, "p")),
        removePolygons: vi.fn(async () => {}),
        addPolylines: vi.fn(async (l) => ids(l, "l")),
        removePolylines: vi.fn(async () => {}),
        addCircles: vi.fn(async (l) => ids(l, "c")),
        removeCircles: vi.fn(async () => {}),
        addMarkers: vi.fn(async (l) => ids(l, "m")),
        removeMarkers: vi.fn(async () => {}),
        setCamera: vi.fn(async () => {}),
        fitBounds: vi.fn(async () => {}),
        setOnPolygonClickListener: vi.fn(async (cb) => { ouvintes.poligono = cb; }),
        setOnPolylineClickListener: vi.fn(async (cb) => { ouvintes.linha = cb; }),
        setOnCameraIdleListener: vi.fn(async (cb) => { ouvintes.parou = cb; }),
        setOnCameraMoveStartedListener: vi.fn(async (cb) => { ouvintes.mexeu = cb; }),
        setOnMapClickListener: vi.fn(async (cb) => { ouvintes.toque = cb; }),
        setOnMarkerClickListener: vi.fn(async (cb) => { ouvintes.marcador = cb; }),
        enableTouch: vi.fn(async () => {}),
        disableTouch: vi.fn(async () => {}),
        destroy: vi.fn(async () => {}),
      };
      return falso.mapa;
    }),
  },
}));

import {
  COR_LOCALIZACAO,
  LARGURA_LINHA_PX,
  Z_LOCALIZACAO,
  circuloDaLocalizacao,
  marcadorDaLocalizacao,
  polilinhasDasLinhas,
  raioDaPrecisao,
} from "@/lib/mapaNativo/mapaGoogleNativo.js";
import { criarMapaGoogleWeb } from "@/lib/mapaNativo/mapaGoogleWeb.js";
import MapaGoogleNativo from "@/components/mapa/MapaGoogleNativo.jsx";
import { useLocalizacaoNoMapa } from "@/components/mapa/useLocalizacaoNoMapa.js";

const CERCA = { id: 7, nome: "Cerca do rio", tipo: "Cerca", coordenadas: { coords: [[-15, -47], [-15.01, -47.01], [-15.02, -47]], cor: "#ff0000" } };
const SEM_COR = { id: 8, nome: "Estrada", coordenadas: { coords: [[-15, -47], [-15, -47.02]] } };
const QUEBRADA = { id: 9, nome: "Um ponto só", coordenadas: { coords: [[-15, -47]] } };

let antesGetContext;
let antesToDataURL;
let antesImage;
beforeEach(() => {
  plugin.nativo = false;
  app.build = "9";
  falso.mapa = null;
  localStorage.clear();
  antesGetContext = HTMLCanvasElement.prototype.getContext;
  antesToDataURL = HTMLCanvasElement.prototype.toDataURL;
  antesImage = globalThis.Image;
  // qualquer método do contexto vale (nada é desenhado de verdade)
  HTMLCanvasElement.prototype.getContext = /** @type {any} */ (() => new Proxy({}, { get: (alvo, k) => (k in alvo ? alvo[k] : () => {}), set: (alvo, k, v) => ((alvo[k] = v), true) }));
  HTMLCanvasElement.prototype.toDataURL = function () {
    return `data:image/png;base64,${this.width}x${this.height}`;
  };
  // @ts-ignore imagem falsa: carrega na hora
  globalThis.Image = class {
    set src(v) {
      this._src = v;
      queueMicrotask(() => this.onload?.());
    }
  };
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = antesGetContext;
  HTMLCanvasElement.prototype.toDataURL = antesToDataURL;
  globalThis.Image = antesImage;
  delete (/** @type {any} */ (globalThis).google);
  vi.clearAllMocks();
});

describe("G375-1 — linhas, círculo da precisão e ponto azul", () => {
  it("linhas: a cor da linha (ou a padrão), 3 px × densidade, clicáveis, `tag` = id; sem 2 pontos fica de fora", () => {
    const l = polilinhasDasLinhas([CERCA, SEM_COR, QUEBRADA, null], 2.5);
    expect(l.map((x) => x.tag)).toEqual(["7", "8"]);
    expect(l[0]).toMatchObject({ strokeColor: "#ff0000", strokeWeight: LARGURA_LINHA_PX * 2.5, clickable: true });
    expect(l[0].path).toEqual([{ lat: -15, lng: -47 }, { lat: -15.01, lng: -47.01 }, { lat: -15.02, lng: -47 }]);
    expect(l[1].strokeColor).toBe("#f59e0b");
  });

  it("precisão real do GPS entre 3 e 500 m; sem leitura, 20 m; o círculo azul não pega toque", () => {
    expect(raioDaPrecisao(42)).toBe(42);
    expect(raioDaPrecisao(1)).toBe(3);
    expect(raioDaPrecisao(9000)).toBe(500);
    expect(raioDaPrecisao(null)).toBe(20);
    expect(circuloDaLocalizacao({ lat: -15, lng: -47, accuracy: 12 }, 2)).toMatchObject({
      center: { lat: -15, lng: -47 },
      radius: 12,
      fillColor: COR_LOCALIZACAO,
      fillOpacity: 0.15,
      strokeWeight: 2,
      clickable: false,
    });
  });

  it("o ponto azul: 24 px, por cima de tudo (no site e no app), sem toque; sem posição, nada", () => {
    expect(marcadorDaLocalizacao({ lat: -15, lng: -47 })).toMatchObject({ id: "eu", w: 24, h: 24, z: Z_LOCALIZACAO, zNativo: Z_LOCALIZACAO, semToque: true });
    expect(marcadorDaLocalizacao(null)).toBeNull();
    expect(marcadorDaLocalizacao({ lat: NaN, lng: 0 })).toBeNull();
  });
});

/** `google.maps` falso: o bastante para o mapa, as linhas e os círculos. */
function instalarGoogleFalso() {
  const estado = { mapa: /** @type {any} */ (null), linhas: /** @type {any[]} */ ([]), circulos: /** @type {any[]} */ ([]) };
  class Ouvintes {
    constructor() {
      /** @type {Record<string, Function[]>} */ this.ouv = {};
    }
    addListener(ev, cb) {
      (this.ouv[ev] ||= []).push(cb);
      return { remove: () => {} };
    }
    disparar(ev) {
      (this.ouv[ev] || []).forEach((f) => f());
    }
  }
  class Map extends Ouvintes {
    constructor(div, opcoes) {
      super();
      this.centro = opcoes.center;
      this.zoom = opcoes.zoom;
      this.painel = document.createElement("div");
      div.appendChild(this.painel);
      estado.mapa = this;
    }
    setCenter(c) {
      this.centro = c;
    }
    setZoom(z) {
      this.zoom = z;
    }
    getZoom() {
      return this.zoom;
    }
  }
  class Forma extends Ouvintes {
    constructor(o) {
      super();
      this.o = o;
      this.mapa = o.map;
    }
    setMap(m) {
      this.mapa = m;
    }
  }
  class Polyline extends Forma {
    constructor(o) {
      super(o);
      estado.linhas.push(this);
    }
  }
  class Circle extends Forma {
    constructor(o) {
      super(o);
      estado.circulos.push(this);
    }
  }
  class OverlayView {
    setMap(m) {
      this.mapa = m;
      if (m) this.onAdd();
      else this.onRemove();
    }
    getPanes() {
      return { overlayMouseTarget: this.mapa.painel };
    }
    getProjection() {
      return null;
    }
  }
  class LatLng {}
  /** @type {any} */ (globalThis).google = { maps: { Map, Polyline, Circle, OverlayView, LatLng, Polygon: Forma, event: { clearInstanceListeners: vi.fn() } } };
  return estado;
}

describe("G375-2 — linhas e localização no mapa do site", () => {
  it("linhas pelo Google com a `tag` no toque; o gesto num ícone não abre a linha; círculos; centrar; destruir", async () => {
    const estado = instalarGoogleFalso();
    const el = document.createElement("div");
    document.body.appendChild(el);
    const mapa = await criarMapaGoogleWeb({ element: el, config: { center: { lat: -15, lng: -47 }, zoom: 15 } });
    const toque = vi.fn();
    await mapa.setOnPolylineClickListener(toque);
    const [id] = await mapa.addPolylines(polilinhasDasLinhas([CERCA]));
    expect(estado.linhas[0].o).toMatchObject({ strokeColor: "#ff0000", strokeWeight: 3, map: estado.mapa });
    expect(estado.linhas[0].o.tag).toBeUndefined();
    estado.linhas[0].disparar("click");
    expect(toque).toHaveBeenCalledWith({ polylineId: id, tag: "7" });

    // o gesto começou num ícone: o clique é do ícone, não da linha por baixo
    const icone = document.createElement("img");
    icone.dataset.marcador = "lotes|a1";
    el.firstChild?.appendChild(icone);
    icone.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    estado.linhas[0].disparar("click");
    expect(toque).toHaveBeenCalledTimes(1);

    const [c] = await mapa.addCircles([circuloDaLocalizacao({ lat: -15, lng: -47, accuracy: 30 })]);
    expect(estado.circulos[0].o).toMatchObject({ radius: 30, map: estado.mapa });
    await mapa.removeCircles([c]);
    expect(estado.circulos[0].mapa).toBeNull();

    mapa.centrar(-16, -48, 18);
    expect(estado.mapa.centro).toEqual({ lat: -16, lng: -48 });
    expect(estado.mapa.zoom).toBe(19);

    await mapa.destroy();
    expect(estado.linhas[0].mapa).toBeNull();
  });
});

describe("G375-3 — linhas e localização no mapa do app", () => {
  const props = (extra = {}) => ({ areas: [], mostrarAreas: true, corDaArea: () => null, tipoMapa: "satelite", empresaId: "e1", ...extra });

  it("linhas no mapa nativo (× densidade) e o toque nelas; o ponto azul nativo e o círculo; centrar → setCamera", async () => {
    plugin.nativo = true;
    globalThis.devicePixelRatio = 2;
    const onMapa = vi.fn();
    const onClickLinha = vi.fn();
    const { rerender, unmount } = render(<MapaGoogleNativo {...props({ onMapa, onClickLinha, linhas: [CERCA, SEM_COR] })} />);
    await waitFor(() => expect(falso.mapa?.addPolylines).toHaveBeenCalled());
    const [linhas] = falso.mapa.addPolylines.mock.calls[0];
    expect(linhas.map((l) => [l.tag, l.strokeWeight])).toEqual([["7", 6], ["8", 6]]);
    act(() => falso.mapa.ouvintes.linha({ polylineId: "l1", tag: "7" }));
    expect(onClickLinha).toHaveBeenCalledWith(CERCA);

    // sem linhas: as postas saem
    rerender(<MapaGoogleNativo {...props({ onMapa, onClickLinha, linhas: [] })} />);
    await waitFor(() => expect(falso.mapa.removePolylines).toHaveBeenCalled());

    rerender(<MapaGoogleNativo {...props({ onMapa, onClickLinha, linhas: [], localizacao: { lat: -15, lng: -47, accuracy: 10 } })} />);
    await waitFor(() => expect(falso.mapa.addCircles).toHaveBeenCalledTimes(1));
    expect(falso.mapa.addCircles.mock.calls[0][0][0]).toMatchObject({ center: { lat: -15, lng: -47 }, radius: 10, strokeWeight: 2 });
    await waitFor(() => expect(falso.mapa.addMarkers.mock.calls.some(([l]) => l[0]?.zIndex === Z_LOCALIZACAO)).toBe(true));

    // leitura nova do GPS: o círculo novo entra e só depois o velho sai
    const ordem = [];
    falso.mapa.addCircles.mockImplementationOnce(async () => (ordem.push("entra"), ["c-novo"]));
    falso.mapa.removeCircles.mockImplementationOnce(async () => void ordem.push("sai"));
    rerender(<MapaGoogleNativo {...props({ onMapa, onClickLinha, linhas: [], localizacao: { lat: -15.001, lng: -47, accuracy: 8 } })} />);
    await waitFor(() => expect(ordem).toEqual(["entra", "sai"]));

    await act(async () => {
      onMapa.mock.calls.at(-1)[0].centrar(-16, -48, 18);
    });
    expect(falso.mapa.setCamera).toHaveBeenCalledWith({ coordinate: { lat: -16, lng: -48 }, zoom: 19, animate: false });

    // a localização desligada: o círculo e o ponto saem
    rerender(<MapaGoogleNativo {...props({ onMapa, onClickLinha, linhas: [], localizacao: null })} />);
    await waitFor(() => expect(falso.mapa.removeCircles).toHaveBeenLastCalledWith(["c-novo"]));
    unmount();
    globalThis.devicePixelRatio = 1;
  });
});

describe("G375-4 — Localizar no mapa do Google", () => {
  it("com o mapa do Google aberto, centraliza nele e não no MapLibre; sem ele, o MapLibre", () => {
    const jumpTo = vi.fn();
    const mapInstanceRef = { current: { jumpTo } };
    const noGoogle = vi.fn();
    const centrarEm = { current: /** @type {any} */ (noGoogle) };
    const pos = { coords: { latitude: -15.5, longitude: -47.5, accuracy: 5, heading: null, speed: null }, timestamp: Date.now() };
    const antes = navigator.geolocation;
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok) => ok(pos), watchPosition: () => 1, clearWatch: () => {} },
    });
    const { result } = renderHook(() => useLocalizacaoNoMapa({ mapInstanceRef, ativo: false, centrarEm }));
    act(() => result.current.localizar());
    expect(noGoogle).toHaveBeenCalledWith(expect.objectContaining({ lat: -15.5, lng: -47.5 }));
    expect(jumpTo).not.toHaveBeenCalled();
    centrarEm.current = null;
    act(() => result.current.localizar());
    expect(jumpTo).toHaveBeenCalledWith({ center: [-47.5, -15.5], zoom: 18 });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: antes });
  });
});

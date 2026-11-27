/**
 * D-PROD-369 — mapa do Google do site com os marcadores do Mapa Geral (etapa 2).
 *
 *  G369-1. `criarMapaGoogleWeb`: Maps JavaScript API direto (carregador canônico), polígonos com o toque pela `tag`,
 *          tipo do mapa, enquadrar, câmera parada, destruir.
 *  G369-2. Camada de marcadores: centro da imagem no ponto + deslocamento em px, ordem (z-index), título, clique sem
 *          passar para o mapa, troca por grupo (os outros grupos ficam), atualização no lugar.
 *  G369-3. `useMarcadoresGoogle`: os mesmos itens do MapLibre (`itensDoMapaGeral`), lote acima do centro com o
 *          identificador ao lado, cocho < ponto < lote < tarefa < Urgente, cliques com o objeto do app; sem o mapa do
 *          site (ou no mapa nativo do app), nada.
 *  G369-4. O MapLibre e o Google montam os itens no mesmo lugar (`useMapRenderer` usa `itensDoMapaGeral`).
 */
import { readFileSync } from "node:fs";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("@/lib/googleMaps", () => ({ loadGoogleMaps: vi.fn(async () => {}) }));

// imagens: pixels falsos (o jsdom não desenha em canvas); a conversão em URL usa um canvas falso
vi.mock("@/lib/maplibre/lotesNoMapa.js", async (orig) => {
  const real = /** @type {any} */ (await orig());
  const raster = (w, h) => ({ imagem: { width: w * 2, height: h * 2, data: new Uint8ClampedArray(w * h * 16) }, pixelRatio: 2, w, h });
  return {
    ...real,
    pixelRatioDaTela: () => 2,
    garantirImagens: vi.fn(() => null),
    imagemPronta: vi.fn((chave) => (String(chave).includes("ident") ? raster(17, 17) : String(chave).startsWith("mg-lote") ? raster(44, 42) : raster(40, 40))),
    desenharImagemReserva: () => raster(42, 42),
  };
});

import { criarMapaGoogleWeb } from "@/lib/mapaNativo/mapaGoogleWeb.js";
import useMarcadoresGoogle, { ORDEM_GOOGLE } from "@/components/mapa/useMarcadoresGoogle.js";
import { DESLOC_IDENT_PX, OFFSET_LOTE_PX } from "@/lib/maplibre/lotesNoMapa.js";

/** `google.maps` falso: o bastante para o mapa, os polígonos e a camada. */
function instalarGoogleFalso() {
  const estado = { mapa: /** @type {any} */ (null), poligonos: /** @type {any[]} */ ([]), camadas: /** @type {any[]} */ ([]) };
  class Ouvintes {
    constructor() {
      /** @type {Record<string, Function[]>} */ this.ouv = {};
    }
    addListener(ev, cb) {
      (this.ouv[ev] ||= []).push(cb);
      return { remove: () => (this.ouv[ev] = this.ouv[ev].filter((f) => f !== cb)) };
    }
    disparar(ev, ...a) {
      (this.ouv[ev] || []).forEach((f) => f(...a));
    }
  }
  class Map extends Ouvintes {
    constructor(div, opcoes) {
      super();
      this.div = div;
      this.opcoes = opcoes;
      this.tipo = opcoes.mapTypeId;
      this.centro = opcoes.center;
      this.zoom = opcoes.zoom;
      this.painel = document.createElement("div");
      div.appendChild(this.painel);
      estado.mapa = this;
    }
    setMapTypeId(t) {
      this.tipo = t;
    }
    fitBounds(b, m) {
      this.enquadrou = { b, m };
    }
    getCenter() {
      return { lat: () => this.centro.lat, lng: () => this.centro.lng };
    }
    getZoom() {
      return this.zoom;
    }
  }
  class Polygon extends Ouvintes {
    constructor(o) {
      super();
      this.o = o;
      this.mapa = o.map;
      estado.poligonos.push(this);
    }
    setMap(m) {
      this.mapa = m;
    }
  }
  class OverlayView {
    setMap(m) {
      if (m) {
        this.mapa = m;
        estado.camadas.push(this);
        this.onAdd();
        this.draw();
      } else {
        this.onRemove();
        this.mapa = null;
      }
    }
    getPanes() {
      return { overlayMouseTarget: this.mapa.painel };
    }
    // projeção falsa: 1 grau = 1000 px, lat para baixo
    getProjection() {
      return this.mapa ? { fromLatLngToDivPixel: (ll) => ({ x: ll.lng * 1000, y: -ll.lat * 1000 }) } : null;
    }
  }
  OverlayView.preventMapHitsAndGesturesFrom = vi.fn();
  class LatLng {
    constructor(lat, lng) {
      this.lat = lat;
      this.lng = lng;
    }
  }
  class LatLngBounds {
    constructor(sw, ne) {
      this.sw = sw;
      this.ne = ne;
    }
  }
  /** @type {any} */ (globalThis).google = { maps: { Map, Polygon, OverlayView, LatLng, LatLngBounds, event: { clearInstanceListeners: vi.fn() } } };
  return estado;
}

let antesGetContext;
let antesToDataURL;
beforeEach(() => {
  antesGetContext = HTMLCanvasElement.prototype.getContext;
  antesToDataURL = HTMLCanvasElement.prototype.toDataURL;
  // @ts-ignore canvas falso
  HTMLCanvasElement.prototype.getContext = () => ({ putImageData: () => {} });
  HTMLCanvasElement.prototype.toDataURL = function () {
    return `data:image/png;base64,${this.width}x${this.height}`;
  };
  if (typeof globalThis.ImageData === "undefined") {
    // @ts-ignore jsdom sem ImageData
    globalThis.ImageData = class {
      constructor(data, w, h) {
        this.data = data;
        this.width = w;
        this.height = h;
      }
    };
  }
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = antesGetContext;
  HTMLCanvasElement.prototype.toDataURL = antesToDataURL;
  delete (/** @type {any} */ (globalThis).google);
  vi.clearAllMocks();
});

const novoMapaWeb = async () => {
  const estado = instalarGoogleFalso();
  const el = document.createElement("div");
  document.body.appendChild(el);
  const mapa = await criarMapaGoogleWeb({ element: el, config: { center: { lat: -15, lng: -47 }, zoom: 15, mapTypeId: "satellite", gestureHandling: "greedy" } });
  return { estado, el, mapa };
};

describe("G369-1 — o mapa do Google do site pela Maps JavaScript API", () => {
  it("cria o mapa no elemento com as opções do Mapa Geral; tipo, enquadrar, câmera parada; destruir limpa tudo", async () => {
    const { estado, el, mapa } = await novoMapaWeb();
    expect(estado.mapa.opcoes).toMatchObject({ center: { lat: -15, lng: -47 }, zoom: 15, mapTypeId: "satellite", gestureHandling: "greedy", tilt: 0 });
    expect(el.contains(estado.mapa.div)).toBe(true);

    await mapa.setMapType("Normal");
    expect(estado.mapa.tipo).toBe("roadmap");
    await mapa.setMapType("Satellite");
    expect(estado.mapa.tipo).toBe("satellite");

    await mapa.fitBounds({ southwest: { lat: -16, lng: -48 }, northeast: { lat: -15, lng: -47 } }, 40);
    expect(estado.mapa.enquadrou.m).toBe(40);

    const camera = vi.fn();
    await mapa.setOnCameraIdleListener(camera);
    estado.mapa.centro = { lat: -15.5, lng: -47.5 };
    estado.mapa.zoom = 16;
    estado.mapa.disparar("idle");
    expect(camera).toHaveBeenCalledWith({ latitude: -15.5, longitude: -47.5, zoom: 16 });

    await mapa.destroy();
    expect(el.contains(estado.mapa.div)).toBe(false);
    expect(estado.camadas[0].mapa).toBeNull();
  });

  it("polígonos: as opções vão para o Google sem a `tag`; o toque devolve a `tag`; remover tira do mapa", async () => {
    const { estado, mapa } = await novoMapaWeb();
    const toque = vi.fn();
    await mapa.setOnPolygonClickListener(toque);
    const ids = await mapa.addPolygons([{ paths: [{ lat: 0, lng: 0 }], fillColor: "#22c55e", fillOpacity: 0.78, tag: "a1" }]);
    expect(ids).toHaveLength(1);
    const p = estado.poligonos[0];
    expect(p.o).toMatchObject({ fillColor: "#22c55e", fillOpacity: 0.78 });
    expect(p.o.tag).toBeUndefined();
    p.disparar("click");
    expect(toque).toHaveBeenCalledWith({ polygonId: ids[0], tag: "a1" });
    await mapa.removePolygons(ids);
    expect(p.mapa).toBeNull();
  });
});

describe("G369-2 — camada de marcadores", () => {
  const imgs = (el) => [...el.querySelectorAll("img")];

  it("centro da imagem no ponto + deslocamento; ordem; título; o clique é do marcador e não do mapa", async () => {
    const { el, mapa } = await novoMapaWeb();
    const clique = vi.fn();
    mapa.definirMarcadores("supl", [{ id: "c1", lat: -0.01, lng: 0.02, url: "data:a", w: 40, h: 30, z: 500, titulo: "Cocho 1", onClick: clique }]);
    const [img] = imgs(el);
    // ponto em (20, 10) px; a imagem 40×30 centrada: canto em (0, -5)
    expect(img.style.transform).toBe("translate(0px, -5px)");
    expect(img.style.width).toBe("40px");
    expect(img.style.zIndex).toBe("500");
    expect(img.title).toBe("Cocho 1");
    img.click();
    expect(clique).toHaveBeenCalledTimes(1);

    // deslocamento do lote (como o icon-offset do MapLibre)
    mapa.definirMarcadores("lotes", [{ id: "a1", lat: 0, lng: 0, url: "data:b", w: 44, h: 42, dx: 0, dy: -26, z: 1000 }]);
    const lote = imgs(el).find((i) => i.dataset.marcador === "lotes|a1");
    expect(lote?.style.transform).toBe("translate(-22px, -47px)");
  });

  it("a roda do mouse e o arrasto em cima do marcador chegam ao mapa; o clique no marcador não abre a área por baixo", async () => {
    const { el, estado, mapa } = await novoMapaWeb();
    const aArea = vi.fn();
    await mapa.setOnPolygonClickListener(aArea);
    await mapa.addPolygons([{ paths: [{ lat: 0, lng: 0 }], tag: "a1" }]);
    mapa.definirMarcadores("supl", [{ id: "c1", lat: 0, lng: 0, url: "data:a", w: 40, h: 40, z: 500, onClick: vi.fn() }]);
    const [img] = imgs(el);
    // o mapa ouve no próprio div: a roda e o arrasto que começam no marcador precisam chegar lá (antes o
    // preventMapHitsAndGesturesFrom os parava, e o zoom com o mouse em cima de um ícone não funcionava)
    const noMapa = vi.fn();
    estado.mapa.div.addEventListener("wheel", noMapa);
    estado.mapa.div.addEventListener("pointerdown", noMapa);
    img.dispatchEvent(new Event("wheel", { bubbles: true }));
    img.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(noMapa).toHaveBeenCalledTimes(2);
    expect(/** @type {any} */ (globalThis).google.maps.OverlayView.preventMapHitsAndGesturesFrom).not.toHaveBeenCalled();
    // o Google dispara o clique do polígono do gesto que começou no marcador: é ignorado, por mais que se segure
    estado.poligonos[0].disparar("click");
    expect(aArea).not.toHaveBeenCalled();
    // o próximo gesto começa fora do marcador (mesmo logo depois de um arrasto a partir dele): a área abre
    estado.mapa.div.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    estado.poligonos[0].disparar("click");
    expect(aArea).toHaveBeenCalledTimes(1);
  });

  it("troca por grupo: o que saiu some, o resto é atualizado no mesmo elemento; os outros grupos ficam", async () => {
    const { el, mapa } = await novoMapaWeb();
    const m = (id, url) => ({ id, lat: 0, lng: 0, url, w: 10, h: 10, z: 1 });
    mapa.definirMarcadores("pontos", [m("p1", "data:1"), m("p2", "data:2")]);
    mapa.definirMarcadores("tarefas", [m("t1", "data:t")]);
    const p1 = imgs(el).find((i) => i.dataset.marcador === "pontos|p1");
    mapa.definirMarcadores("pontos", [m("p1", "data:1b")]);
    expect(imgs(el).map((i) => i.dataset.marcador).sort()).toEqual(["pontos|p1", "tarefas|t1"]);
    expect(imgs(el).find((i) => i.dataset.marcador === "pontos|p1")).toBe(p1);
    expect(p1?.getAttribute("src")).toBe("data:1b");
  });
});

describe("G369-3 — lotes, cochos, pontos e tarefas no mapa do Google do site", () => {
  const quadrado = (id, lat, lng) => ({ id, nome: `Pasto ${id}`, coordenadas: { coords: [[lat, lng], [lat, lng + 0.01], [lat - 0.01, lng + 0.01], [lat - 0.01, lng]] } });
  const A1 = quadrado("a1", -15, -47);

  it("lote acima do centro do pasto, identificador ao lado, com alerta por cima; o clique entrega os lotes do pasto", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores }));
    const lotes = [
      { id: "l1", area_atual_id: "a1", quantidade_cabecas: 30, identificador_cor: "#ef4444", identificador_sigla: "N", alertas: [{}] },
      { id: "l2", area_atual_id: "a1", quantidade_cabecas: 12 },
      { id: "l3", area_atual_id: null, quantidade_cabecas: 5 },
    ];
    const clique = vi.fn();
    await result.current.syncLotes(lotes, [A1], true, [], clique, null, false, false);
    expect(definirMarcadores).toHaveBeenCalledTimes(1);
    const [grupo, lista] = definirMarcadores.mock.calls[0];
    expect(grupo).toBe("lotes");
    const lote = lista.find((m) => m.id === "a1");
    expect(lote).toMatchObject({ dx: OFFSET_LOTE_PX[0], dy: OFFSET_LOTE_PX[1], z: ORDEM_GOOGLE.loteComAlerta, w: 44, h: 42 });
    expect(lote.url).toMatch(/^data:image\/png/);
    expect(lote.lat).toBeLessThan(-15);
    expect(lote.lat).toBeGreaterThan(-15.01);
    lote.onClick();
    expect(clique.mock.calls[0][0].map((l) => l.id)).toEqual(["l1", "l2"]);
    const ident = lista.find((m) => m.id === "a1|ident");
    expect(ident).toMatchObject({ dx: OFFSET_LOTE_PX[0] + DESLOC_IDENT_PX[0], dy: OFFSET_LOTE_PX[1] + DESLOC_IDENT_PX[1], z: ORDEM_GOOGLE.ident });
    ident.onClick();
    expect(clique).toHaveBeenCalledTimes(2);

    // lotes escondidos (filtro, permissão ou foco): o grupo fica vazio
    await result.current.syncLotes(lotes, [A1], false, [], clique);
    expect(definirMarcadores.mock.calls[1]).toEqual(["lotes", []]);
  });

  it("cocho < ponto < lote < tarefa < Urgente; cada clique entrega o objeto do app", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores }));
    const cocho = { id: "c1", nome: "Cocho", categoria_ponto: "COCHO", coordenadas: { lat: -15.001, lng: -47.001 } };
    const ponto = { id: "p1", nome: "Porteira", tipo: "Porteira", coordenadas: { lat: -15.002, lng: -47.002 } };
    const tarefas = [
      { id: "t1", titulo: "Cerca", prioridade: "Média", coordenadas: { lat: -15.003, lng: -47.003 } },
      { id: "t2", titulo: "Água", prioridade: "Urgente", area_id: "a1" },
    ];
    const [aoCocho, aoPonto, aTarefa] = [vi.fn(), vi.fn(), vi.fn()];
    await result.current.syncPontosSuplementacao([cocho], true, [], aoCocho);
    await result.current.syncPontos([ponto], true, [], aoPonto);
    await result.current.syncTarefas(tarefas, [A1], [], aTarefa, new Date("2026-11-27T12:00:00"));
    const porGrupo = Object.fromEntries(definirMarcadores.mock.calls.map(([g, l]) => [g, l]));
    expect(porGrupo.supl[0]).toMatchObject({ id: "c1", z: ORDEM_GOOGLE.supl, dx: 0, dy: 0 });
    expect(porGrupo.pontos[0]).toMatchObject({ id: "p1", z: ORDEM_GOOGLE.pontos, titulo: "Porteira" });
    expect(porGrupo.tarefas.map((m) => [m.id, m.z])).toEqual([["t1", ORDEM_GOOGLE.tarefa], ["t2", ORDEM_GOOGLE.urgente]]);
    expect(ORDEM_GOOGLE.supl < ORDEM_GOOGLE.pontos && ORDEM_GOOGLE.pontos < ORDEM_GOOGLE.lote && ORDEM_GOOGLE.ident < ORDEM_GOOGLE.tarefa).toBe(true);
    porGrupo.supl[0].onClick();
    porGrupo.pontos[0].onClick();
    porGrupo.tarefas[1].onClick();
    expect(aoCocho).toHaveBeenCalledWith(cocho);
    expect(aoPonto).toHaveBeenCalledWith(ponto);
    expect(aTarefa).toHaveBeenCalledWith(tarefas[1]);
  });

  it("figura remota lenta: o grupo sai com a reserva em até 250 ms e é publicado de novo quando ela chega", async () => {
    const lotes = await import("@/lib/maplibre/lotesNoMapa.js");
    const garantir = /** @type {any} */ (lotes.garantirImagens);
    const pronta = /** @type {any} */ (lotes.imagemPronta);
    let chegou = false;
    let soltar = () => {};
    const figura = new Promise((r) => (soltar = () => { chegou = true; r(undefined); }));
    // 1ª chamada: as reservas (prontas); 2ª: as figuras (lenta)
    garantir.mockImplementationOnce(() => null).mockImplementationOnce(() => figura);
    const r40 = { imagem: { width: 80, height: 80, data: new Uint8ClampedArray(4) }, pixelRatio: 2, w: 40, h: 40 };
    const antes = pronta.getMockImplementation();
    pronta.mockImplementation((chave) => (String(chave).startsWith("mg-ponto-res") || chegou ? r40 : null));
    onTestFinished(() => pronta.mockImplementation(antes));
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores }));
    const ponto = { id: "p1", nome: "Porteira", icone_url: "https://exemplo.invalid/porteira.png", coordenadas: { lat: -15, lng: -47 } };
    const p = result.current.syncPontos([ponto], true, [], vi.fn());
    await new Promise((r) => setTimeout(r, 300));
    expect(definirMarcadores).toHaveBeenCalledTimes(1);
    expect(definirMarcadores.mock.calls[0][1][0].id).toBe("p1");
    soltar();
    await p;
    expect(definirMarcadores).toHaveBeenCalledTimes(2);
  });

  it("sem o mapa do site (abrindo) ou no mapa nativo do app (sem `definirMarcadores`): nada", async () => {
    for (const mapa of [null, { setMapType: vi.fn() }]) {
      const { result } = renderHook(() => useMarcadoresGoogle(mapa));
      await expect(result.current.syncLotes([], [], true, [], null)).resolves.toBeUndefined();
      await expect(result.current.syncTarefas([], [], [], null, new Date())).resolves.toBeUndefined();
    }
  });
});

describe("G369-4 — os dois mapas montam os itens no mesmo lugar", () => {
  it("useMapRenderer e useMarcadoresGoogle usam itensDoMapaGeral", () => {
    const renderer = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    const google = readFileSync("src/components/mapa/useMarcadoresGoogle.js", "utf8");
    for (const fn of ["itensDosLotes", "itensDosPontos", "itensDaSuplementacao", "itensDasTarefas"]) {
      expect(renderer).toContain(`${fn}(`);
      expect(google).toContain(`${fn}(`);
    }
  });
});

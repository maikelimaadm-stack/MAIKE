/**
 * D-PROD-374 — nomes dos pastos no mapa do Google (etapa 3) e os ícones do app como marcadores do próprio mapa nativo.
 *
 *  G374-1. `posicaoDoMarcador`: centro ou topo no ponto + deslocamento, tamanho que segue o zoom, sem arredondar (o
 *          ícone não treme), `translate3d`.
 *  G374-2. `nomesGoogle`: os três níveis do MapLibre, o nível igual para todos pela colisão, o nome embaixo do lote.
 *  G374-3. `marcadoresNativos`: a margem que põe o ponto no meio da imagem, o diff por grupo (entra antes de sair), o
 *          toque pelo id nativo, o nome refeito no zoom quando o mapa para, limpar.
 *  G374-4. `useMarcadoresGoogle`: `syncLabels` publica os nomes (sem toque, por cima, tamanho no zoom); o lote sobe
 *          quando o pasto tem nome; o nível muda com a câmera; o mapa do site avisa a câmera (`aoMudarCamera`).
 *  G374-5. App com APK 1.0.8 (código 9): os ícones vão para o mapa nativo (`addMarkers`), o toque no marcador abre o
 *          detalhe, o mapa parado refaz o tamanho dos nomes; o div por cima fica escondido.
 */
import React from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/googleMaps", () => ({ loadGoogleMaps: vi.fn(async () => {}) }));

// imagens: pixels falsos (o jsdom não desenha em canvas)
vi.mock("@/lib/maplibre/lotesNoMapa.js", async (orig) => {
  const real = /** @type {any} */ (await orig());
  const raster = (w, h) => ({ imagem: { width: w * 2, height: h * 2, data: new Uint8ClampedArray(w * h * 16) }, pixelRatio: 2, w, h });
  return {
    ...real,
    pixelRatioDaTela: () => 2,
    garantirImagens: vi.fn(() => null),
    imagemPronta: vi.fn((chave) => (String(chave).startsWith("mg-nome") ? raster(60, 14) : String(chave).startsWith("mg-lote") ? raster(44, 42) : raster(40, 40))),
    desenharImagemReserva: () => raster(42, 42),
  };
});

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
      falso.mapa = {
        id: "mapa-1",
        ouvintes,
        setMapType: vi.fn(async () => {}),
        addPolygons: vi.fn(async (l) => l.map((_, i) => `p${i}`)),
        removePolygons: vi.fn(async () => {}),
        addMarkers: vi.fn(async (l) => l.map(() => `n${++n}`)),
        removeMarkers: vi.fn(async () => {}),
        fitBounds: vi.fn(async () => {}),
        setOnPolygonClickListener: vi.fn(async (cb) => { ouvintes.poligono = cb; }),
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

import { caixaDoMarcador, porNaCaixa } from "@/lib/mapaNativo/posicaoDoMarcador.js";
import { NIVEIS, colocacaoDoNome, montarNomes, nivelDosNomes } from "@/lib/mapaNativo/nomesGoogle.js";
import { DIFERENCA_REFAZER_NOME, MS_JUNTAR_GRUPOS, Z_NOME_NATIVO, criarMarcadoresNativos, geometriaNoZoom, imagemComAncora } from "@/lib/mapaNativo/marcadoresNativos.js";
import { APK_MARCADORES_NATIVOS, numeroDoApk } from "@/lib/mapaNativo/mapaGoogleNativo.js";
import useMarcadoresGoogle, { ORDEM_GOOGLE } from "@/components/mapa/useMarcadoresGoogle.js";
import MapaGoogleNativo from "@/components/mapa/MapaGoogleNativo.jsx";
import { OFFSET_LOTE_COM_NOME_PX, OFFSET_LOTE_PX } from "@/lib/maplibre/lotesNoMapa.js";
import { DESLOC_NOME_COM_LOTE_PX, tamanhoNoZoom } from "@/lib/maplibre/nomesNoMapa.js";

const quadrado = (id, lat, lng, lado = 0.01) => ({ id, nome: `Pasto ${id}`, tamanho_hectares: 100, coordenadas: { coords: [[lat, lng], [lat, lng + lado], [lat - lado, lng + lado], [lat - lado, lng]] } });

/** Câmera falsa: `k` px por grau, origem em (lat0, lng0). */
const cameraFalsa = (k, zoom = 14, lat0 = -15, lng0 = -47) => ({
  zoom,
  projetar: (lat, lng) => ({ x: (lng - lng0) * k, y: (lat0 - lat) * k }),
  largura: 800,
  altura: 600,
});

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
  // @ts-ignore canvas falso
  // qualquer método do contexto vale (nada é desenhado de verdade); a medida do texto cai na estimativa
  HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (alvo, k) => (k in alvo ? alvo[k] : k === "measureText" ? () => ({}) : () => {}), set: (alvo, k, v) => ((alvo[k] = v), true) });
  HTMLCanvasElement.prototype.toDataURL = function () {
    return `data:image/png;base64,${this.width}x${this.height}`;
  };
  // imagem falsa: carrega na hora
  // @ts-ignore
  globalThis.Image = class {
    set src(v) {
      this._src = v;
      queueMicrotask(() => this.onload?.());
    }
    get src() {
      return this._src;
    }
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
  globalThis.Image = antesImage;
  vi.clearAllMocks();
});

describe("G374-1 — onde vai a imagem do marcador", () => {
  const base = { id: "x", lat: 0, lng: 0, url: "u", w: 40, h: 20 };

  it("centro no ponto + deslocamento; topo no ponto + deslocamento; sem arredondar", () => {
    expect(caixaDoMarcador({ ...base, dx: 3, dy: -5 }, { x: 100.25, y: 50.5 }, 14)).toEqual({ x: 83.25, y: 35.5, w: 40, h: 20 });
    expect(caixaDoMarcador({ ...base, ancora: "topo", dy: 10 }, { x: 100, y: 50 }, 14)).toEqual({ x: 80, y: 60, w: 40, h: 20 });
  });

  it("o tamanho segue o zoom (`escala`); escala inválida vale 1", () => {
    const m = { ...base, escala: (z) => z / 10 };
    expect(caixaDoMarcador(m, { x: 0, y: 0 }, 5)).toEqual({ x: -10, y: -5, w: 20, h: 10 });
    expect(caixaDoMarcador({ ...base, escala: () => NaN }, { x: 0, y: 0 }, 5).w).toBe(40);
  });

  it("`porNaCaixa`: translate3d com 2 casas; o tamanho só é escrito quando muda", () => {
    const el = document.createElement("img");
    porNaCaixa(el, { x: 1.234, y: -5, w: 40, h: 20.5 });
    expect(el.style.transform).toBe("translate3d(1.23px, -5.00px, 0)");
    expect(el.style.width).toBe("40px");
    expect(el.style.height).toBe("20.5px");
    const escrever = vi.spyOn(el.style, "setProperty");
    porNaCaixa(el, { x: 2, y: 2, w: 40, h: 20.5 });
    expect(el.style.width).toBe("40px");
    escrever.mockRestore();
  });
});

describe("G374-2 — nomes dos pastos com as regras do MapLibre", () => {
  const areas = [quadrado("a1", -15, -47), quadrado("a2", -15, -46.99)];

  it("os três níveis de cada pasto; sem hectares quando desligado; extra do Mapa Geral", () => {
    const nomes = montarNomes(areas, { extraTextFn: (a) => (a.id === "a1" ? "30 cab" : null) });
    expect([...nomes.keys()]).toEqual(["a1", "a2"]);
    const n1 = /** @type {any} */ (nomes.get("a1"));
    expect(NIVEIS.every((nv) => n1.niveis[nv].chave.startsWith("mg-nome|"))).toBe(true);
    expect(n1.niveis.tudo.linhas.map((l) => l.tipo)).toEqual(["nome", "ha", "extra"]);
    expect(n1.niveis.nome.linhas).toEqual([{ tipo: "nome", texto: "Pasto a1" }]);
    expect(n1.caixa).toEqual({ oeste: -47, sul: -15.01, leste: -46.99, norte: -15 });
    const semHa = /** @type {any} */ (montarNomes(areas, { showHectares: false }).get("a1"));
    expect(semHa.niveis.tudo.linhas.map((l) => l.tipo)).toEqual(["nome"]);
    expect(montarNomes([{ id: "x", nome: "sem desenho", coordenadas: { coords: [] } }]).size).toBe(0);
  });

  it("o nível é o mesmo para todos: perto cabe tudo; longe, os nomes se encolhem", () => {
    const nomes = montarNomes(areas);
    expect(nivelDosNomes(nomes, cameraFalsa(100000, 17), new Map())).toBe("tudo");
    expect(nivelDosNomes(nomes, cameraFalsa(300, 9), new Map())).not.toBe("tudo");
    expect(nivelDosNomes(new Map(), cameraFalsa(300), new Map())).toBe("tudo");
  });

  it("com lote, o topo do nome 10 px abaixo do ponto; sem lote, centrado; o tamanho é o do MapLibre", () => {
    const n = /** @type {any} */ (montarNomes(areas).get("a1"));
    const comLote = colocacaoDoNome(n, "nome", true);
    expect(comLote).toMatchObject({ ancora: "topo", dy: DESLOC_NOME_COM_LOTE_PX[1], chave: n.niveis.nome.chave });
    expect(colocacaoDoNome(n, "tudo", false)).toMatchObject({ ancora: "centro", dy: 0 });
    expect(comLote.escala(15)).toBeCloseTo(tamanhoNoZoom(n.niveis.nome.medida, n.pf, 15), 10);
  });
});

describe("G374-3 — os ícones como marcadores do mapa nativo", () => {
  it("geometria no zoom: o ponto do mapa dentro da imagem (centro/topo menos o deslocamento)", () => {
    expect(geometriaNoZoom({ id: "l", lat: 0, lng: 0, url: "u", w: 44, h: 42, dx: 0, dy: -26 }, 14)).toEqual({ w: 44, h: 42, ax: 22, ay: 47 });
    expect(geometriaNoZoom({ id: "n", lat: 0, lng: 0, url: "u", w: 60, h: 14, dy: 10, ancora: "topo", escala: () => 0.5 }, 14)).toEqual({ w: 30, h: 7, ax: 15, ay: -10 });
  });

  it("D-PROD-379: só a margem que o ponto precisa, em px inteiros, com a âncora no ponto; ponto dentro, a mesma imagem", async () => {
    expect(await imagemComAncora("data:x", 40.4, 19.6, 20.2, 9.8)).toEqual({ url: "data:x", w: 40, h: 20, ax: (20.2 * 40) / 40.4, ay: (9.8 * 20) / 19.6 });
    // lote 44 × 42 com o ponto 47 px abaixo do topo (o ícone acima do ponto): só 5 px a mais embaixo (antes, 2 × 47)
    const r = /** @type {any} */ (await imagemComAncora("data:lote", 44, 42, 22, 47));
    expect(r).toMatchObject({ w: 44, h: 47, ax: 22, ay: 47 });
    expect(r.url).toMatch(/^data:image\/png/);
    // nome embaixo do lote (o ponto 10 px acima do topo do nome): 10 px a mais em cima
    expect(await imagemComAncora("data:nome", 60, 14, 30, -10)).toMatchObject({ w: 60, h: 24, ax: 30, ay: 0 });
  });

  it("diff por grupo: igual não mexe; mudou entra ANTES de sair; o toque acha o marcador; limpar tira tudo", async () => {
    const mapa = { addMarkers: vi.fn(async (l) => l.map((_, i) => `id${mapa.addMarkers.mock.calls.length}-${i}`)), removeMarkers: vi.fn(async () => {}) };
    const camada = criarMarcadoresNativos(mapa);
    const clique = vi.fn();
    const lote = { id: "a1", lat: -15, lng: -47, url: "data:a", w: 40, h: 40, z: 1000, onClick: clique };
    const nome = { id: "a1", lat: -15, lng: -47, url: "data:n", w: 60, h: 14, semToque: true, ancora: /** @type {const} */ ("topo"), dy: 10, escala: () => 1 };
    await camada.definir("lotes", [lote]);
    await camada.definir("nomes", [nome]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(2);
    const [[pLote]] = mapa.addMarkers.mock.calls[0];
    expect(pLote).toEqual({ coordinate: { lat: -15, lng: -47 }, iconUrl: "data:a", iconSize: { width: 40, height: 40 }, iconAnchor: { x: 20, y: 20 }, zIndex: 1000 });
    const [[pNome]] = mapa.addMarkers.mock.calls[1];
    expect(pNome.zIndex).toBe(Z_NOME_NATIVO);
    // o nome de topo com 10 px abaixo do ponto: a âncora no alto da margem (o ponto), no meio da largura
    expect(pNome.iconAnchor).toEqual({ x: pNome.iconSize.width / 2, y: 0 });

    await camada.definir("lotes", [{ ...lote }]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(2);
    expect(mapa.removeMarkers).not.toHaveBeenCalled();
    /** @type {any} */ (camada.marcadorDoToque("id1-0"))?.onClick();
    expect(clique).toHaveBeenCalledTimes(1);

    const ordem = [];
    mapa.addMarkers.mockImplementationOnce(async (l) => (ordem.push("entra"), l.map(() => "novo")));
    mapa.removeMarkers.mockImplementationOnce(async () => void ordem.push("sai"));
    await camada.definir("lotes", [{ ...lote, url: "data:b" }]);
    expect(ordem).toEqual(["entra", "sai"]);
    expect(mapa.removeMarkers).toHaveBeenLastCalledWith(["id1-0"]);
    expect(camada.marcadorDoToque("id1-0")).toBeNull();
    expect(camada.marcadorDoToque("novo")?.url).toBe("data:b");

    await camada.limpar();
    expect(mapa.removeMarkers).toHaveBeenLastCalledWith(expect.arrayContaining(["novo", "id2-0"]));
  });

  it("mapa parado: o nome é refeito no tamanho do zoom só se mudou mais que 4%", async () => {
    const mapa = { addMarkers: vi.fn(async (l) => l.map(() => "n")), removeMarkers: vi.fn(async () => {}) };
    const camada = criarMarcadoresNativos(mapa);
    camada.aoParar(14);
    await camada.definir("nomes", [{ id: "a1", lat: 0, lng: 0, url: "data:n", w: 60, h: 14, escala: (z) => z / 14 }]);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(1);
    camada.aoParar(14 * (1 + DIFERENCA_REFAZER_NOME / 2));
    await camada.definir("outro", []);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(1);
    camada.aoParar(15);
    await camada.definir("outro", []);
    expect(mapa.addMarkers).toHaveBeenCalledTimes(2);
    expect(mapa.addMarkers.mock.calls[1][0][0].iconSize.width).toBe(Math.round((60 * 15) / 14));
  });
  it("o mapa parou num zoom novo enquanto as imagens eram preparadas: o nome é refeito no zoom de agora", async () => {
    const mapa = { addMarkers: vi.fn(async (l) => l.map(() => "n")), removeMarkers: vi.fn(async () => {}) };
    const camada = criarMarcadoresNativos(mapa);
    camada.aoParar(14);
    // a imagem do nome (com margem) demora: o mapa para no zoom 16 no meio
    let soltar = () => {};
    const ImagemRapida = globalThis.Image;
    // @ts-ignore
    globalThis.Image = class {
      set src(_v) {
        soltar = () => this.onload?.();
      }
    };
    const feito = camada.definir("nomes", [{ id: "a1", lat: 0, lng: 0, url: "data:n", w: 60, h: 14, dy: 10, ancora: "topo", escala: (z) => z / 14 }]);
    // D-PROD-382: a troca sai depois de juntar os grupos pedidos em seguida
    await new Promise((r) => setTimeout(r, MS_JUNTAR_GRUPOS + 10));
    camada.aoParar(16);
    globalThis.Image = ImagemRapida;
    soltar();
    await feito;
    await waitFor(() => expect(mapa.addMarkers).toHaveBeenCalledTimes(2));
    // em px inteiros (o nome de topo só ganha a margem de cima)
    expect(mapa.addMarkers.mock.calls[1][0][0].iconSize.width).toBe(Math.ceil((60 * 16) / 14 - 0.001));
  });
});

describe("G374-4 — os nomes no mapa do Google pelo useMarcadoresGoogle", () => {
  const areas = [quadrado("a1", -15, -47), quadrado("a2", -15, -46.99)];

  it("syncLabels publica os nomes por cima, sem toque, com o tamanho no zoom; o lote sobe quando o pasto tem nome", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores }));
    const lotes = [{ id: "l1", area_atual_id: "a1", quantidade_cabecas: 30 }];
    await result.current.syncLotes(lotes, areas, true, [], vi.fn(), null, false, false);
    const loteSemNome = definirMarcadores.mock.calls.at(-1)[1].find((m) => m.id === "a1");
    expect([loteSemNome.dx, loteSemNome.dy]).toEqual(OFFSET_LOTE_PX);

    await result.current.syncLabels(areas, true, null, true);
    await Promise.resolve();
    const nomes = definirMarcadores.mock.calls.filter(([g]) => g === "nomes").at(-1)[1];
    expect(nomes.map((m) => m.id)).toEqual(["a1", "a2"]);
    const n1 = nomes.find((m) => m.id === "a1");
    const n2 = nomes.find((m) => m.id === "a2");
    expect(n1).toMatchObject({ semToque: true, z: ORDEM_GOOGLE.nome, ancora: "topo", dy: DESLOC_NOME_COM_LOTE_PX[1] });
    expect(n2).toMatchObject({ ancora: "centro", dy: 0 });
    expect(typeof n1.escala).toBe("function");
    expect(n1.onClick).toBeUndefined();
    // o pasto ganhou nome: o lote foi republicado no par ícone + nome
    const loteComNome = definirMarcadores.mock.calls.filter(([g]) => g === "lotes").at(-1)[1].find((m) => m.id === "a1");
    expect([loteComNome.dx, loteComNome.dy]).toEqual(OFFSET_LOTE_COM_NOME_PX);

    // nomes desligados: o grupo fica vazio
    await result.current.syncLabels(areas, false, null, true);
    expect(definirMarcadores.mock.calls.filter(([g]) => g === "nomes").at(-1)[1]).toEqual([]);
  });

  it("o nível muda com a câmera (mapa parado, todos os pastos); mesma câmera não republica", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores }));
    result.current.revisarNomes({ ...cameraFalsa(100000, 17), final: true });
    await result.current.syncLabels(areas, true, null, true);
    const chaveDe = () => definirMarcadores.mock.calls.filter(([g]) => g === "nomes").at(-1)[1][0].url;
    const perto = definirMarcadores.mock.calls.length;
    result.current.revisarNomes({ ...cameraFalsa(100000, 17), final: true });
    expect(definirMarcadores.mock.calls.length).toBe(perto);
    result.current.revisarNomes({ ...cameraFalsa(300, 9), final: true });
    await Promise.resolve();
    expect(definirMarcadores.mock.calls.length).toBe(perto + 1);
    expect(chaveDe()).toMatch(/^data:image\/png/);
  });

  it("o mapa avisa a câmera: o hook assina `aoMudarCamera` e desliga ao sair", () => {
    const desligar = vi.fn();
    const aoMudarCamera = vi.fn(() => desligar);
    const { unmount } = renderHook(() => useMarcadoresGoogle({ definirMarcadores: vi.fn(), aoMudarCamera }));
    expect(aoMudarCamera).toHaveBeenCalledTimes(1);
    unmount();
    expect(desligar).toHaveBeenCalledTimes(1);
  });
});

describe("G374-5 — app com APK 1.0.8: ícones no mapa nativo", () => {
  const props = (extra = {}) => ({ areas: [], mostrarAreas: true, corDaArea: () => null, tipoMapa: "satelite", empresaId: "e1", ...extra });

  it("número do APK: o `build` do app; fora do app, 0", async () => {
    expect(APK_MARCADORES_NATIVOS).toBe(9);
    expect(await numeroDoApk()).toBe(0);
    plugin.nativo = true;
    expect(await numeroDoApk()).toBe(9);
    app.build = "x";
    expect(await numeroDoApk()).toBe(0);
  });

  it("os marcadores vão para o mapa nativo; o toque abre o detalhe; o mapa parado refaz os nomes; o div fica escondido", async () => {
    plugin.nativo = true;
    const onMapa = vi.fn();
    const { getByTestId, unmount } = render(<MapaGoogleNativo {...props({ onMapa })} />);
    await waitFor(() => expect(onMapa).toHaveBeenCalled());
    const alvo = onMapa.mock.calls.at(-1)[0];
    expect(alvo.definirMarcadores).toEqual(expect.any(Function));
    expect(alvo.aoMudarCamera).toEqual(expect.any(Function));
    expect(getByTestId("mapa-google-marcadores-app").style.display).toBe("none");
    await waitFor(() => expect(falso.mapa.setOnMarkerClickListener).toHaveBeenCalled());

    const clique = vi.fn();
    await act(async () => {
      await alvo.definirMarcadores("lotes", [{ id: "a1", lat: -15, lng: -47, url: "data:a", w: 40, h: 40, z: 1000, onClick: clique }]);
    });
    expect(falso.mapa.addMarkers).toHaveBeenCalledTimes(1);
    const id = (await falso.mapa.addMarkers.mock.results[0].value)[0];
    act(() => falso.mapa.ouvintes.marcador({ markerId: id }));
    expect(clique).toHaveBeenCalledTimes(1);

    const cameras = [];
    alvo.aoMudarCamera((c) => cameras.push(c));
    await act(async () => {
      await alvo.definirMarcadores("nomes", [{ id: "a1", lat: -15, lng: -47, url: "data:n", w: 60, h: 14, semToque: true, escala: (z) => z / 14 }]);
    });
    await waitFor(() => expect(falso.mapa.addMarkers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(falso.mapa.setOnCameraIdleListener).toHaveBeenCalled());
    await act(async () => {
      falso.mapa.ouvintes.parou({ latitude: -15, longitude: -47, zoom: 18, bearing: 0, tilt: 0 });
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitFor(() => expect(falso.mapa.addMarkers).toHaveBeenCalledTimes(3));
    expect(cameras.at(-1)).toMatchObject({ zoom: 17, final: true });
    unmount();
    await waitFor(() => expect(falso.mapa.removeMarkers).toHaveBeenCalled());
  });

  it("APK antigo (código 8): segue a camada por cima do mapa, sem marcadores nativos", async () => {
    plugin.nativo = true;
    app.build = "8";
    const onMapa = vi.fn();
    const { getByTestId } = render(<MapaGoogleNativo {...props({ onMapa })} />);
    await waitFor(() => expect(onMapa).toHaveBeenCalled());
    await act(async () => {
      onMapa.mock.calls.at(-1)[0].definirMarcadores("lotes", [{ id: "a1", lat: -15, lng: -47, url: "data:a", w: 40, h: 40 }]);
    });
    expect(falso.mapa.setOnMarkerClickListener).not.toHaveBeenCalled();
    expect(falso.mapa.addMarkers).not.toHaveBeenCalled();
    expect(getByTestId("mapa-google-marcadores-app").style.display).not.toBe("none");
  });
});

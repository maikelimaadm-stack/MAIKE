/**
 * D-PROD-372 — lotes, cochos, pontos e tarefas no mapa do Google do APP (nativo). O SDK nativo só aceita imagem de
 * arquivo do app ou `https`, não a imagem desenhada na hora: os marcadores ficam num div por cima do mapa nativo,
 * posicionados pela câmera.
 *
 *  G372-1. `projetarNaCamera`: centro no meio, escala do zoom do Google (256 px), rumo girado, inclinado = sem
 *          projeção, o caminho mais curto pelo meridiano 180.
 *  G372-2. `criarCamadaDeImagens`: centro + deslocamento, ordem, toque no ponto (ícone de cima), troca por grupo,
 *          limpar; a imagem não pega toque (D-PROD-373).
 *  G372-3. Componente no app: o Mapa Geral recebe `definirMarcadores` da camada (não o mapa nativo); D-PROD-373: com
 *          o `onCameraMove` do APK 1.0.7 os ícones andam junto a cada quadro; no APK antigo somem ao mexer e voltam ao
 *          parar; todo toque é do mapa e o clique do mapa decide entre ícone e área.
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({ nativo: true, movimento: /** @type {any} */ (null), semEvento: false }));
vi.mock("@capacitor/core", async (orig) => {
  const real = /** @type {any} */ (await orig());
  return {
    ...real,
    // o plugin nativo do mapa: o `onCameraMove` do remendo (D-PROD-373)
    registerPlugin: () => ({
      addListener: async (nome, cb) => {
        if (plugin.semEvento) throw new Error("sem o evento");
        if (nome === "onCameraMove") plugin.movimento = cb;
        return { remove: () => { plugin.movimento = null; } };
      },
    }),
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
      falso.mapa = {
        id: "mapa-1",
        ouvintes,
        setMapType: vi.fn(async () => {}),
        addPolygons: vi.fn(async (l) => l.map((_, i) => `p${i}`)),
        removePolygons: vi.fn(async () => {}),
        fitBounds: vi.fn(async () => {}),
        setOnPolygonClickListener: vi.fn(async (cb) => { ouvintes.poligono = cb; }),
        setOnCameraIdleListener: vi.fn(async (cb) => { ouvintes.parou = cb; }),
        setOnCameraMoveStartedListener: vi.fn(async (cb) => { ouvintes.mexeu = cb; }),
        setOnMapClickListener: vi.fn(async (cb) => { ouvintes.toque = cb; }),
        enableTouch: vi.fn(async () => {}),
        disableTouch: vi.fn(async () => {}),
        destroy: vi.fn(async () => {}),
      };
      return falso.mapa;
    }),
  },
}));

import { criarCamadaDeImagens, projetarNaCamera } from "@/lib/mapaNativo/camadaDeImagens.js";
import MapaGoogleNativo from "@/components/mapa/MapaGoogleNativo.jsx";

beforeEach(() => {
  plugin.nativo = true;
  plugin.movimento = null;
  plugin.semEvento = false;
  falso.mapa = null;
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe("G372-1 — projeção do mapa nativo pela câmera", () => {
  const camera = { latitude: 0, longitude: 0, zoom: 10 };
  const pxPorGrau = (256 * 2 ** 10) / 360;

  it("centro no meio; leste à direita e norte para cima na escala do zoom do Google", () => {
    const p = /** @type {any} */ (projetarNaCamera(camera, 400, 800));
    expect(p(0, 0)).toEqual({ x: 200, y: 400 });
    const leste = p(0, 1);
    expect(leste.x).toBeCloseTo(200 + pxPorGrau, 6);
    expect(leste.y).toBeCloseTo(400, 6);
    const norte = p(1, 0);
    expect(norte.x).toBeCloseTo(200, 6);
    expect(norte.y).toBeLessThan(400 - pxPorGrau * 0.99);
  });

  it("rumo de 90° (olhando para o leste): o ponto a leste fica em cima", () => {
    const p = /** @type {any} */ (projetarNaCamera({ ...camera, bearing: 90 }, 400, 800));
    const leste = p(0, 1);
    expect(leste.x).toBeCloseTo(200, 6);
    expect(leste.y).toBeCloseTo(400 - pxPorGrau, 6);
  });

  it("mapa inclinado ou câmera inválida: sem projeção (os marcadores ficam escondidos)", () => {
    expect(projetarNaCamera({ ...camera, tilt: 30 }, 400, 800)).toBeNull();
    expect(projetarNaCamera(/** @type {any} */ ({ latitude: NaN, longitude: 0, zoom: 10 }), 400, 800)).toBeNull();
  });

  it("perto do meridiano 180: o caminho mais curto", () => {
    const p = /** @type {any} */ (projetarNaCamera({ latitude: 0, longitude: 179.9, zoom: 10 }, 400, 800));
    expect(p(0, -179.9).x).toBeCloseTo(200 + 0.2 * pxPorGrau, 4);
  });
});

describe("G372-2 — camada de imagens", () => {
  it("centro + deslocamento, ordem; a imagem não pega toque; o toque no ponto vai para o ícone de cima; troca por grupo; limpar", () => {
    const div = document.createElement("div");
    const camada = criarCamadaDeImagens(div);
    camada.posicionarTodos(() => ({ x: 100, y: 50 }));
    const noLote = vi.fn();
    const noCocho = vi.fn();
    camada.definir("lotes", [{ id: "a1", lat: 0, lng: 0, url: "data:x", w: 44, h: 42, dx: 0, dy: -26, z: 1000, onClick: noLote }]);
    camada.definir("supl", [{ id: "c1", lat: 0, lng: 0, url: "data:y", w: 36, h: 36, z: 500, onClick: noCocho }]);
    const [lote, cocho] = div.querySelectorAll("img");
    expect(lote.style.transform).toBe("translate(78px, 3px)");
    expect(lote.style.zIndex).toBe("1000");
    // D-PROD-373: todo toque é do mapa nativo (a pinça em cima do ícone dá zoom)
    expect(lote.style.pointerEvents).toBe("none");
    // ponto em cima do lote e do cocho: o de cima (lote) recebe
    expect(camada.tocar(100, 40)).toBe(true);
    expect(noLote).toHaveBeenCalledTimes(1);
    expect(noCocho).not.toHaveBeenCalled();
    // só o cocho (abaixo do lote): o cocho
    expect(camada.tocar(100, 66)).toBe(true);
    expect(noCocho).toHaveBeenCalledTimes(1);
    // longe de tudo: ninguém
    expect(camada.tocar(10, 10)).toBe(false);
    // duas tarefas no mesmo ponto com o mesmo z-index: a de cima na tela (a posta depois) recebe
    const t1 = vi.fn();
    const t2 = vi.fn();
    camada.definir("tarefas", [
      { id: "t1", lat: 0, lng: 0, url: "data:t", w: 40, h: 40, z: 2500, onClick: t1 },
      { id: "t2", lat: 0, lng: 0, url: "data:t", w: 40, h: 40, z: 2500, onClick: t2 },
    ]);
    const imgs = [...div.querySelectorAll("img")];
    expect(imgs.indexOf(/** @type {any} */ (div.querySelector('[data-marcador="tarefas|t2"]')))).toBeGreaterThan(imgs.indexOf(/** @type {any} */ (div.querySelector('[data-marcador="tarefas|t1"]'))));
    expect(camada.tocar(100, 50)).toBe(true);
    expect(t2).toHaveBeenCalledTimes(1);
    expect(t1).not.toHaveBeenCalled();
    camada.definir("tarefas", []);
    camada.posicionarTodos(() => ({ x: 0, y: 0 }));
    expect(cocho.style.transform).toBe("translate(-18px, -18px)");
    camada.definir("lotes", []);
    expect(div.querySelectorAll("img")).toHaveLength(1);
    camada.limpar();
    expect(div.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("G372-3 — os marcadores no mapa nativo do app", () => {
  const quadrado = { id: "a1", nome: "Pasto 1", coordenadas: { coords: [[-15, -47], [-15, -46.99], [-15.01, -46.99], [-15.01, -47]] } };

  it("o Mapa Geral recebe a camada; com o APK novo os ícones andam junto com o mapa a cada quadro", async () => {
    const onMapa = vi.fn();
    const { getByTestId } = render(
      <MapaGoogleNativo areas={[]} areasCarregadas mostrarAreas corDaArea={() => null} tipoMapa="satellite" empresaId="e1" onMapa={onMapa} />
    );
    await waitFor(() => expect(onMapa).toHaveBeenCalled());
    const alvo = onMapa.mock.calls.at(-1)[0];
    expect(alvo).not.toBe(falso.mapa);
    expect(typeof alvo.definirMarcadores).toBe("function");
    const camadaEl = getByTestId("mapa-google-marcadores-app");
    expect(camadaEl.style.pointerEvents).toBe("none");
    // a ordem dos marcadores fica dentro do mapa: não passa por cima da barra e do resumo do Mapa Geral
    expect(/** @type {HTMLElement} */ (camadaEl.parentElement).style.isolation).toBe("isolate");

    act(() => alvo.definirMarcadores("lotes", [{ id: "a1", lat: -15, lng: -47, url: "data:x", w: 44, h: 42, z: 1000 }]));
    const img = /** @type {HTMLImageElement} */ (camadaEl.querySelector("img"));
    expect(img).not.toBeNull();

    // o mapa começa a mexer e avisa a câmera a cada quadro: os ícones ficam à vista e acompanham
    act(() => falso.mapa.ouvintes.mexeu({ isGesture: true }));
    act(() => plugin.movimento({ mapId: "mapa-1", latitude: -15, longitude: -47, zoom: 15, bearing: 0, tilt: 0 }));
    expect(camadaEl.style.visibility).toBe("visible");
    // jsdom não mede: largura e altura 0 → o centro da câmera fica no canto (0, 0)
    expect(img.style.transform).toBe("translate(-22px, -21px)");
    act(() => falso.mapa.ouvintes.mexeu({ isGesture: true }));
    expect(camadaEl.style.visibility).toBe("visible");
    // evento de outro mapa: ignorado
    act(() => plugin.movimento({ mapId: "outro", latitude: 10, longitude: 10, zoom: 15 }));
    expect(img.style.transform).toBe("translate(-22px, -21px)");
    // inclinado: escondido
    act(() => plugin.movimento({ mapId: "mapa-1", latitude: -15, longitude: -47, zoom: 15, bearing: 0, tilt: 45 }));
    expect(camadaEl.style.visibility).toBe("hidden");
  });

  it("APK antigo (sem o evento a cada quadro): os ícones somem ao mexer e voltam reposicionados ao parar", async () => {
    plugin.semEvento = true;
    const onMapa = vi.fn();
    const { getByTestId } = render(
      <MapaGoogleNativo areas={[]} areasCarregadas mostrarAreas corDaArea={() => null} tipoMapa="satellite" empresaId="e1" onMapa={onMapa} />
    );
    await waitFor(() => expect(onMapa).toHaveBeenCalled());
    const camadaEl = getByTestId("mapa-google-marcadores-app");
    act(() => falso.mapa.ouvintes.mexeu({ isGesture: true }));
    expect(camadaEl.style.visibility).toBe("hidden");
    act(() => falso.mapa.ouvintes.parou({ latitude: -15, longitude: -47, zoom: 15, bearing: 0, tilt: 0 }));
    expect(camadaEl.style.visibility).toBe("visible");
  });

  it("todo toque é do mapa: o toque rápido num ícone abre o ícone; fora dele, a área; os polígonos não pegam o toque", async () => {
    const onMapa = vi.fn();
    const onClickArea = vi.fn();
    render(
      <MapaGoogleNativo areas={[quadrado]} areasCarregadas mostrarAreas corDaArea={() => "#22c55e"} tipoMapa="satellite" empresaId="e1" onMapa={onMapa} onClickArea={onClickArea} />
    );
    await waitFor(() => expect(falso.mapa?.addPolygons).toHaveBeenCalled());
    expect(falso.mapa.addPolygons.mock.calls.at(-1)[0][0].clickable).toBe(false);
    const alvo = onMapa.mock.calls.at(-1)[0];
    const noLote = vi.fn();
    act(() => alvo.definirMarcadores("lotes", [{ id: "a1", lat: -15.005, lng: -46.995, url: "data:x", w: 44, h: 42, z: 1000, onClick: noLote }]));
    // a câmera centrada no lote (jsdom: elemento 0 × 0, centro no canto 0,0)
    act(() => plugin.movimento({ mapId: "mapa-1", latitude: -15.005, longitude: -46.995, zoom: 15, bearing: 0, tilt: 0 }));
    // toque em cima do lote: o lote, não a área
    act(() => falso.mapa.ouvintes.toque({ latitude: -15.005, longitude: -46.995 }));
    expect(noLote).toHaveBeenCalledTimes(1);
    expect(onClickArea).not.toHaveBeenCalled();
    // toque no pasto, longe do ícone: a área
    act(() => falso.mapa.ouvintes.toque({ latitude: -15.0095, longitude: -46.9905 }));
    expect(onClickArea).toHaveBeenCalledWith(quadrado);
    // fora de tudo: nada
    act(() => falso.mapa.ouvintes.toque({ latitude: -14, longitude: -46 }));
    expect(onClickArea).toHaveBeenCalledTimes(1);
  });

  it("no site não há a camada do app: o Mapa Geral recebe o mapa do site", async () => {
    plugin.nativo = false;
    vi.doMock("@/lib/mapaNativo/mapaGoogleWeb.js", () => ({ criarMapaGoogleWeb: vi.fn(async () => ({ definirMarcadores: vi.fn(), setOnPolygonClickListener: vi.fn(async () => {}), setOnCameraIdleListener: vi.fn(async () => {}), setMapType: vi.fn(async () => {}), addPolygons: vi.fn(async () => []), removePolygons: vi.fn(async () => {}), fitBounds: vi.fn(async () => {}), destroy: vi.fn(async () => {}) })) }));
    vi.resetModules();
    const { default: Componente } = await import("@/components/mapa/MapaGoogleNativo.jsx");
    const onMapa = vi.fn();
    const { queryByTestId } = render(<Componente areas={[]} areasCarregadas mostrarAreas corDaArea={() => null} tipoMapa="satellite" empresaId="e1" onMapa={onMapa} />);
    await waitFor(() => expect(onMapa).toHaveBeenCalled());
    expect(queryByTestId("mapa-google-marcadores-app")).toBeNull();
    expect(/** @type {HTMLElement} */ (queryByTestId("mapa-geral-google")).style.isolation).toBe("isolate");
    vi.doUnmock("@/lib/mapaNativo/mapaGoogleWeb.js");
  });
});

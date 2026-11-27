/**
 * D-PROD-372 — lotes, cochos, pontos e tarefas no mapa do Google do APP (nativo). O SDK nativo só aceita imagem de
 * arquivo do app ou `https`, não a imagem desenhada na hora: os marcadores ficam num div por cima do mapa nativo,
 * posicionados pela câmera.
 *
 *  G372-1. `projetarNaCamera`: centro no meio, escala do zoom do Google (256 px), rumo girado, inclinado = sem
 *          projeção, o caminho mais curto pelo meridiano 180.
 *  G372-2. `criarCamadaDeImagens`: centro + deslocamento, ordem, clique, troca por grupo, limpar.
 *  G372-3. Componente no app: o Mapa Geral recebe `definirMarcadores` da camada (não o mapa nativo); a camada some
 *          quando o mapa começa a mexer e volta, reposicionada, quando ele para; o div não pega o toque, a imagem pega.
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({ nativo: true }));
vi.mock("@capacitor/core", async (orig) => {
  const real = /** @type {any} */ (await orig());
  return {
    ...real,
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
        ouvintes,
        setMapType: vi.fn(async () => {}),
        addPolygons: vi.fn(async (l) => l.map((_, i) => `p${i}`)),
        removePolygons: vi.fn(async () => {}),
        fitBounds: vi.fn(async () => {}),
        setOnPolygonClickListener: vi.fn(async (cb) => { ouvintes.poligono = cb; }),
        setOnCameraIdleListener: vi.fn(async (cb) => { ouvintes.parou = cb; }),
        setOnCameraMoveStartedListener: vi.fn(async (cb) => { ouvintes.mexeu = cb; }),
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
  it("centro + deslocamento, ordem, clique; troca por grupo; limpar", () => {
    const div = document.createElement("div");
    const tocou = vi.fn();
    const camada = criarCamadaDeImagens(div, { aoTocar: tocou });
    camada.posicionarTodos(() => ({ x: 100, y: 50 }));
    const clique = vi.fn();
    camada.definir("lotes", [{ id: "a1", lat: 0, lng: 0, url: "data:x", w: 44, h: 42, dx: 0, dy: -26, z: 1000, onClick: clique }]);
    camada.definir("supl", [{ id: "c1", lat: 0, lng: 0, url: "data:y", w: 36, h: 36, z: 500 }]);
    const [lote, cocho] = div.querySelectorAll("img");
    expect(lote.style.transform).toBe("translate(78px, 3px)");
    expect(lote.style.zIndex).toBe("1000");
    expect(lote.style.pointerEvents).toBe("auto");
    expect(lote.style.touchAction).toBe("none");
    lote.dispatchEvent(new Event("pointerdown"));
    lote.click();
    expect(tocou).toHaveBeenCalledTimes(1);
    expect(clique).toHaveBeenCalledTimes(1);
    camada.posicionarTodos(() => ({ x: 0, y: 0 }));
    expect(cocho.style.transform).toBe("translate(-18px, -18px)");
    camada.definir("lotes", []);
    expect(div.querySelectorAll("img")).toHaveLength(1);
    camada.limpar();
    expect(div.querySelectorAll("img")).toHaveLength(0);
  });
});

describe("G372-3 — os marcadores no mapa nativo do app", () => {
  it("o Mapa Geral recebe a camada; some ao mexer, volta reposicionada ao parar; só a imagem pega o toque", async () => {
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

    act(() => alvo.definirMarcadores("lotes", [{ id: "a1", lat: -15, lng: -47, url: "data:x", w: 44, h: 42, z: 1000 }]));
    const img = /** @type {HTMLImageElement} */ (camadaEl.querySelector("img"));
    expect(img).not.toBeNull();

    act(() => falso.mapa.ouvintes.mexeu({ isGesture: true }));
    expect(camadaEl.style.visibility).toBe("hidden");

    // jsdom não mede: largura e altura 0 → o centro da câmera fica no canto (0, 0)
    act(() => falso.mapa.ouvintes.parou({ latitude: -15, longitude: -47, zoom: 15, bearing: 0, tilt: 0 }));
    expect(camadaEl.style.visibility).toBe("visible");
    expect(img.style.transform).toBe("translate(-22px, -21px)");

    // inclinado: continua escondido
    act(() => falso.mapa.ouvintes.mexeu({ isGesture: true }));
    act(() => falso.mapa.ouvintes.parou({ latitude: -15, longitude: -47, zoom: 15, bearing: 0, tilt: 45 }));
    expect(camadaEl.style.visibility).toBe("hidden");
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
    vi.doUnmock("@/lib/mapaNativo/mapaGoogleWeb.js");
  });
});

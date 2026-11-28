/**
 * D-PROD-376 — a camada do Mapa Geral desenhada pelo próprio Android (APK 1.0.9), colada no mapa do Google.
 *
 *  G376-1. A página: chave curta e estável da imagem, as paradas de tamanho por zoom (0 a 24 do MapLibre), o item da
 *          camada (ordem do site, toque só em quem tem clique, âncora).
 *  G376-2. `criarCamadaNativa`: liga (tentando de novo enquanto o mapa nasce), manda cada imagem uma vez, não manda de
 *          novo o que não mudou, o toque devolve o marcador mais novo, desligar; sem o mapa, null.
 *  G376-3. Componente no app: D-PROD-378 desligou a camada (no APK 1.0.9 os ícones e nomes se moviam no zoom); os
 *          marcadores do mapa, sem a câmera a cada quadro. APK 1.0.8: os marcadores do mapa.
 *  G376-4. O lado Android: o plugin registrado, a mesma versão do mapa do plugin, o nome do plugin e a mesma conta da
 *          página (ladrilho de 256 dp, zoom do MapLibre = do Google − 1, folga do toque, 25 paradas).
 */
import React from "react";
import { readFileSync } from "node:fs";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({ build: "10" }));
vi.mock("@capacitor/app", () => ({ App: { getInfo: vi.fn(async () => ({ build: app.build })) } }));

const camadaFalsa = vi.hoisted(() => {
  const estado = { falhasAoLigar: 0, item: /** @type {any} */ (null) };
  const plugin = {
    ligar: vi.fn(async () => {
      if (estado.falhasAoLigar > 0) {
        estado.falhasAoLigar--;
        throw new Error("mapa não encontrado");
      }
    }),
    imagens: vi.fn(async () => ({})),
    definir: vi.fn(async () => {}),
    tocar: vi.fn(async () => estado.item || {}),
    desligar: vi.fn(async () => {}),
  };
  return { estado, plugin };
});
const nativo = vi.hoisted(() => ({ ligado: true, comCamada: true, movimento: vi.fn() }));
vi.mock("@capacitor/core", async (orig) => {
  const real = /** @type {any} */ (await orig());
  return {
    ...real,
    registerPlugin: (nome) =>
      nome === "CamadaDoMapa"
        ? camadaFalsa.plugin
        : { addListener: async (ev, cb) => (nativo.movimento(ev, cb), { remove: () => {} }) },
    Capacitor: {
      ...real.Capacitor,
      isNativePlatform: () => nativo.ligado,
      getPlatform: () => (nativo.ligado ? "android" : "web"),
      isPluginAvailable: (nome) => nativo.ligado && (nome !== "CamadaDoMapa" || nativo.comCamada),
    },
  };
});

const falso = vi.hoisted(() => ({ mapa: /** @type {any} */ (null) }));
vi.mock("@capacitor/google-maps", () => ({
  GoogleMap: {
    create: vi.fn(async () => {
      const ouvintes = {};
      falso.mapa = {
        id: "mapa-7",
        ouvintes,
        setMapType: vi.fn(async () => {}),
        addPolygons: vi.fn(async (l) => l.map((_, i) => `p${i}`)),
        removePolygons: vi.fn(async () => {}),
        addMarkers: vi.fn(async (l) => l.map((_, i) => `m${i}`)),
        removeMarkers: vi.fn(async () => {}),
        fitBounds: vi.fn(async () => {}),
        setOnPolygonClickListener: vi.fn(async () => {}),
        setOnCameraIdleListener: vi.fn(async (cb) => { ouvintes.parou = cb; }),
        setOnCameraMoveStartedListener: vi.fn(async () => {}),
        setOnMapClickListener: vi.fn(async (cb) => { ouvintes.toque = cb; }),
        setOnMarkerClickListener: vi.fn(async () => {}),
        enableTouch: vi.fn(async () => {}),
        disableTouch: vi.fn(async () => {}),
        destroy: vi.fn(async () => {}),
      };
      return falso.mapa;
    }),
  },
}));

import {
  APK_CAMADA_NATIVA,
  CAMADA_NATIVA_LIGADA,
  PLUGIN_CAMADA,
  ZOOMS_ESCALA,
  camadaNativaDisponivel,
  chaveDaImagem,
  criarCamadaNativa,
  itemDaCamada,
  paradasDaEscala,
} from "@/lib/mapaNativo/camadaNativa.js";
import { FOLGA_TOQUE_PX } from "@/lib/mapaNativo/camadaDeImagens.js";
import MapaGoogleNativo from "@/components/mapa/MapaGoogleNativo.jsx";

const lote = (extra = {}) => ({ id: "a1", lat: -15, lng: -47, url: "data:image/png;base64,LOTE", w: 44, h: 42, dy: -14, z: 1000, onClick: vi.fn(), ...extra });

beforeEach(() => {
  nativo.ligado = true;
  nativo.comCamada = true;
  app.build = "10";
  camadaFalsa.estado.falhasAoLigar = 0;
  camadaFalsa.estado.item = null;
  falso.mapa = null;
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe("G376-1 — imagens, paradas e itens", () => {
  it("chave curta, estável e diferente para imagens diferentes (mesmo tamanho)", () => {
    const a = "data:image/png;base64," + "A".repeat(5000);
    const b = "data:image/png;base64," + "A".repeat(4999) + "B";
    expect(chaveDaImagem(a)).toBe(chaveDaImagem(a));
    expect(chaveDaImagem(a)).not.toBe(chaveDaImagem(b));
    expect(chaveDaImagem(a).length).toBeLessThan(40);
  });

  it("paradas nos zooms 0 a 24 do MapLibre; fator inválido vale 1", () => {
    expect(ZOOMS_ESCALA).toHaveLength(25);
    const p = paradasDaEscala((z) => (z < 10 ? NaN : z / 20));
    expect(p).toHaveLength(25);
    expect(p[5]).toBe(1);
    expect(p[15]).toBe(0.75);
  });

  it("o item: a ordem do site (nome e ponto azul por cima), toque só com clique e sem `semToque`, âncora", () => {
    const l = itemDaCamada(/** @type {any} */ (lote()), "k1");
    expect(l).toEqual({ id: "a1", chave: "k1", lat: -15, lng: -47, w: 44, h: 42, dx: 0, dy: -14, ancora: "centro", z: 1000, toque: true });
    const nome = itemDaCamada(/** @type {any} */ ({ id: "a1", lat: -15, lng: -47, url: "u", w: 60, h: 14, dy: 10, z: 4000, ancora: "topo", semToque: true, escala: () => 0.5 }), "k2");
    expect(nome).toMatchObject({ ancora: "topo", z: 4000, toque: false });
    expect(nome.escala).toHaveLength(25);
    expect(itemDaCamada(/** @type {any} */ ({ id: "eu", lat: 0, lng: 0, url: "u", w: 24, h: 24, z: 10000, zNativo: 400, semToque: true }), "k3")).toMatchObject({ z: 10000, toque: false });
  });

  it("D-PROD-378: a camada está desligada (ícones e nomes se moviam no zoom): nunca disponível; APK 1.0.9 = código 10", () => {
    expect(APK_CAMADA_NATIVA).toBe(10);
    expect(CAMADA_NATIVA_LIGADA).toBe(false);
    expect(camadaNativaDisponivel()).toBe(false);
    nativo.ligado = false;
    expect(camadaNativaDisponivel()).toBe(false);
  });
});

describe("G376-2 — a camada nativa pela página", () => {
  it("liga tentando de novo; cada imagem vai uma vez; igual não vai de novo; o toque devolve o marcador mais novo", async () => {
    camadaFalsa.estado.falhasAoLigar = 2;
    const camada = /** @type {any} */ (await criarCamadaNativa("mapa-7"));
    expect(camada).not.toBeNull();
    expect(camadaFalsa.plugin.ligar).toHaveBeenCalledTimes(3);
    expect(camadaFalsa.plugin.ligar).toHaveBeenLastCalledWith({ mapId: "mapa-7" });

    const l1 = lote();
    await camada.definir("lotes", [l1, lote({ id: "a2", lat: -15.01 })]);
    expect(camadaFalsa.plugin.imagens).toHaveBeenCalledTimes(1);
    expect(camadaFalsa.plugin.imagens.mock.calls[0][0].imagens).toHaveLength(1); // a mesma imagem nos dois lotes
    const [{ grupo, itens }] = camadaFalsa.plugin.definir.mock.calls[0];
    expect(grupo).toBe("lotes");
    expect(itens.map((i) => i.id)).toEqual(["a1", "a2"]);
    expect(itens[0].chave).toBe(itens[1].chave);

    // o mesmo conteúdo (o MapaGeral publicou de novo): nada vai ao Android
    const l1novo = lote();
    await camada.definir("lotes", [l1novo, lote({ id: "a2", lat: -15.01 })]);
    expect(camadaFalsa.plugin.definir).toHaveBeenCalledTimes(1);
    expect(camadaFalsa.plugin.imagens).toHaveBeenCalledTimes(1);

    // o toque devolve o marcador mais novo (o clique de agora)
    camadaFalsa.estado.item = { grupo: "lotes", id: "a1" };
    expect(await camada.tocar(-15, -47)).toBe(l1novo);
    camadaFalsa.estado.item = null;
    expect(await camada.tocar(-15, -47)).toBeNull();

    // imagem nova (o número de cabeças mudou): só ela vai
    await camada.definir("lotes", [lote({ url: "data:image/png;base64,OUTRO" })]);
    expect(camadaFalsa.plugin.imagens).toHaveBeenCalledTimes(2);
    expect(camadaFalsa.plugin.imagens.mock.calls[1][0].imagens).toHaveLength(1);

    await camada.limpar();
    expect(camadaFalsa.plugin.desligar).toHaveBeenCalled();
  });

  it("uma troca mais nova do mesmo grupo descarta a anterior que ainda não rodou", async () => {
    const camada = /** @type {any} */ (await criarCamadaNativa("mapa-7"));
    const p1 = camada.definir("nomes", [lote({ id: "x" })]);
    const p2 = camada.definir("nomes", [lote({ id: "y" })]);
    await Promise.all([p1, p2]);
    expect(camadaFalsa.plugin.definir).toHaveBeenCalledTimes(1);
    expect(camadaFalsa.plugin.definir.mock.calls[0][0].itens[0].id).toBe("y");
  });

  it("o mapa não aparece: null (o app segue com os marcadores do mapa)", async () => {
    camadaFalsa.estado.falhasAoLigar = 100;
    vi.useFakeTimers();
    const p = criarCamadaNativa("mapa-x");
    await vi.runAllTimersAsync();
    expect(await p).toBeNull();
    vi.useRealTimers();
  });
});

describe("G376-3 — o mapa do app com a camada nativa", () => {
  const quadrado = { id: "p1", nome: "Pasto 1", coordenadas: { coords: [[-14.99, -47.01], [-14.99, -46.99], [-15.01, -46.99], [-15.01, -47.01]] } };
  const props = (extra = {}) => ({ areas: [quadrado], areasCarregadas: true, mostrarAreas: true, corDaArea: () => "#22c55e", tipoMapa: "satellite", empresaId: "e1", ...extra });

  it("D-PROD-378: no APK 1.0.9 a camada fica desligada; os marcadores do mapa (colados nele), sem câmera a cada quadro", async () => {
    const onMapa = vi.fn();
    const { getByTestId } = render(<MapaGoogleNativo {...props({ onMapa })} />);
    await waitFor(() => expect(onMapa).toHaveBeenCalled());
    expect(camadaFalsa.plugin.ligar).not.toHaveBeenCalled();
    expect(falso.mapa.setOnMarkerClickListener).toHaveBeenCalled();
    expect(getByTestId("mapa-google-marcadores-app").style.display).toBe("none");
    // com os ícones no mapa nativo, a página não pede a câmera a cada quadro
    expect(nativo.movimento).not.toHaveBeenCalled();
  });

  it("APK 1.0.8 (código 9): os marcadores do mapa, sem a camada", async () => {
    app.build = "9";
    const onMapa = vi.fn();
    render(<MapaGoogleNativo {...props({ onMapa })} />);
    await waitFor(() => expect(onMapa).toHaveBeenCalled());
    expect(camadaFalsa.plugin.ligar).not.toHaveBeenCalled();
    expect(falso.mapa.setOnMarkerClickListener).toHaveBeenCalled();
  });

});

describe("G376-4 — o lado Android", () => {
  const java = (n) => readFileSync(`android/app/src/main/java/com/makgestao/app/${n}`, "utf8");

  it("o plugin registrado com o nome da página e a mesma versão do mapa do plugin do Google", () => {
    expect(java("MainActivity.java")).toContain("registerPlugin(CamadaDoMapaPlugin.class)");
    expect(java("CamadaDoMapaPlugin.java")).toContain(`@CapacitorPlugin(name = "${PLUGIN_CAMADA}")`);
    const versaoDoPlugin = /googleMapsPlayServicesVersion'\) \? rootProject\.ext\.googleMapsPlayServicesVersion : '([\d.]+)'/.exec(
      readFileSync("node_modules/@capacitor/google-maps/android/build.gradle", "utf8")
    )?.[1];
    expect(versaoDoPlugin).toBeTruthy();
    expect(readFileSync("android/app/build.gradle", "utf8")).toContain(`com.google.android.gms:play-services-maps:${versaoDoPlugin}`);
  });

  it("a mesma conta da página: ladrilho de 256 dp, zoom do MapLibre = do Google − 1, folga do toque, paradas desde o zoom 0", () => {
    const v = java("CamadaDoMapaView.java");
    expect(v).toContain("256.0 * densidade * Math.pow(2, c.zoom)");
    expect(v).toContain("zoomMapLibre = c.zoom - 1");
    expect(v).toContain(`FOLGA_TOQUE_DP = ${FOLGA_TOQUE_PX}f`);
    expect(v).toContain("ZOOM_INICIAL = 0");
    expect(ZOOMS_ESCALA[0]).toBe(0);
    // os mesmos métodos que a página chama
    const p = java("CamadaDoMapaPlugin.java");
    for (const m of ["ligar", "imagens", "definir", "tocar", "desligar"]) expect(p).toContain(`public void ${m}(PluginCall call)`);
  });
});

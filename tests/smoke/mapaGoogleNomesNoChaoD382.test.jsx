/**
 * D-PROD-382 — os nomes dos pastos no CHÃO do mapa nativo (app): acompanham o zoom, nada é trocado no gesto.
 *  CH-1. `tamanhoNoChao`: cabe no pasto; perto, para no tamanho máximo da letra; longe (ilegível), some.
 *  CH-2. `criarNomesNoChao`: manda ao mapa só o que mudou (novo, tamanho, mostrar, esconder, tirar).
 *  CH-3. `useMarcadoresGoogle` com o chão: um nome por pasto, escondido até a câmera; revisto só com o mapa parado;
 *        com lote, o nome começa no ponto e o ícone fica todo acima dele.
 *  CH-4. O remendo e o componente.
 */
import { readFileSync } from "node:fs";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/maplibre/lotesNoMapa.js", async (orig) => {
  const real = /** @type {any} */ (await orig());
  const raster = (w, h) => ({ imagem: { width: w * 2, height: h * 2, data: new Uint8ClampedArray(w * h * 16) }, pixelRatio: 2, w, h });
  return {
    ...real,
    pixelRatioDaTela: () => 2,
    garantirImagens: vi.fn(() => null),
    imagemPronta: vi.fn((chave) => (String(chave).startsWith("mg-nome") ? raster(60, 26) : raster(44, 42))),
    desenharImagemReserva: () => raster(42, 42),
  };
});

import { FATOR_MAXIMO, criarNomesNoChao, metrosPorPx, tamanhoNoChao } from "@/lib/mapaNativo/nomesNoChao.js";
import useMarcadoresGoogle from "@/components/mapa/useMarcadoresGoogle.js";
import { OFFSET_LOTE_PX } from "@/lib/maplibre/lotesNoMapa.js";

const quadrado = (id, lat, lng, lado = 0.01) => ({ id, nome: `Pasto ${id}`, tamanho_hectares: 100, coordenadas: { coords: [[lat, lng], [lat, lng + lado], [lat - lado, lng + lado], [lat - lado, lng]] } });
const camera = (zoom, final = true) => ({ zoom, projetar: () => ({ x: 0, y: 0 }), largura: 800, altura: 600, final });

let antesGetContext;
let antesToDataURL;
beforeEach(() => {
  antesGetContext = HTMLCanvasElement.prototype.getContext;
  antesToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.getContext = /** @type {any} */ (() => new Proxy({}, { get: (alvo, k) => (k in alvo ? alvo[k] : k === "measureText" ? () => ({}) : () => {}), set: (alvo, k, v) => ((alvo[k] = v), true) }));
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
  vi.clearAllMocks();
});

describe("CH-1 — o tamanho do nome no chão", () => {
  const medida = { w: 60, h: 26 };
  const pf = { lat: -15, folga: 0.004 }; // ~440 m de raio livre

  it("perto: o tamanho máximo da letra; o mesmo nome em metros encolhe conforme o zoom aumenta", () => {
    const a = tamanhoNoChao(medida, pf, -15, false, 16);
    const b = tamanhoNoChao(medida, pf, -15, false, 17);
    expect(a.visivel && b.visivel).toBe(true);
    expect(a.fator).toBe(FATOR_MAXIMO);
    expect(a.metros).toBeCloseTo(60 * FATOR_MAXIMO * metrosPorPx(-15, 16), 6);
    expect(b.metros).toBeCloseTo(a.metros / 2, 6);
  });

  it("afastando: o nome cabe no pasto (tamanho em metros constante: o mapa o encolhe sozinho) e, ilegível, some", () => {
    const a = tamanhoNoChao(medida, pf, -15, false, 12);
    const b = tamanhoNoChao(medida, pf, -15, false, 11.8);
    expect(a.fator).toBeLessThan(FATOR_MAXIMO);
    expect(a.visivel).toBe(true);
    expect(b.metros).toBeCloseTo(a.metros, 4);
    expect(tamanhoNoChao(medida, pf, -15, false, 8).visivel).toBe(false);
  });

  it("com lote, o nome só tem a metade de baixo do espaço: fica menor", () => {
    expect(tamanhoNoChao(medida, pf, -15, true, 12).metros).toBeLessThan(tamanhoNoChao(medida, pf, -15, false, 12).metros);
  });
});

describe("CH-2 — só o que mudou vai ao mapa", () => {
  const n = (chave, extra = {}) => ({ chave, url: `data:${chave}`, lat: -15, lng: -47, ancoraY: 0.5, metros: 100, visivel: true, ...extra });

  it("novo, tamanho, esconder, mostrar e tirar; nada mudou, nada enviado", async () => {
    const enviar = vi.fn(async () => {});
    const chao = criarNomesNoChao(enviar);
    await chao.definir([n("a"), n("b")]);
    expect(enviar.mock.calls[0][0].por.map((x) => x.chave)).toEqual(["a", "b"]);
    await chao.definir([n("a"), n("b")]);
    await chao.definir([n("a", { metros: 101 }), n("b")]);
    expect(enviar).toHaveBeenCalledTimes(1);
    await chao.definir([n("a", { metros: 50 }), n("b", { visivel: false })]);
    expect(enviar.mock.calls[1][0]).toMatchObject({ por: [], tamanhos: [{ chave: "a", metros: 50 }], esconder: ["b"], mostrar: [], tirar: [] });
    await chao.definir([n("b")]);
    expect(enviar.mock.calls[2][0]).toMatchObject({ por: [], mostrar: ["b"], tirar: ["a"] });
    // mudou de lugar (o lote chegou: âncora no topo): entra de novo
    await chao.definir([n("b", { ancoraY: 0 })]);
    expect(enviar.mock.calls[3][0].por).toHaveLength(1);
  });
});

describe("CH-3 — o hook com os nomes no chão", () => {
  const areas = [quadrado("a", -15, -47), quadrado("b", -15, -46.99)];

  it("um nome por pasto, escondido até a câmera; no gesto nada; parado, aparece; nenhum marcador de nome", async () => {
    const definirMarcadores = vi.fn();
    const definirNomesNoChao = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, definirNomesNoChao, nomesFixos: true }));
    await result.current.syncLabels(areas, true, null, true);
    const primeira = definirNomesNoChao.mock.calls.at(-1)[0];
    expect(primeira.map((x) => x.chave)).toEqual(["a", "b"]);
    expect(primeira.every((x) => !x.visivel && x.ancoraY === 0.5)).toBe(true);
    const antes = definirNomesNoChao.mock.calls.length;
    result.current.revisarNomes(camera(15, false));
    expect(definirNomesNoChao.mock.calls.length).toBe(antes);
    result.current.revisarNomes(camera(15, true));
    expect(definirNomesNoChao.mock.calls.at(-1)[0].every((x) => x.visivel)).toBe(true);
    result.current.revisarNomes(camera(7, true));
    expect(definirNomesNoChao.mock.calls.at(-1)[0].every((x) => !x.visivel)).toBe(true);
    expect(definirMarcadores.mock.calls.filter(([g]) => g === "nomes")).toHaveLength(0);
  });

  it("com lote: o nome começa no ponto (âncora no topo) e o ícone fica todo acima do ponto", async () => {
    const definirMarcadores = vi.fn();
    const definirNomesNoChao = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, definirNomesNoChao, nomesFixos: true }));
    await result.current.syncLabels(areas, true, null, true);
    await result.current.syncLotes([{ id: "l1", area_atual_id: "a", quantidade_cabecas: 30 }], areas, true, [], vi.fn(), null, false, false);
    await Promise.resolve();
    await Promise.resolve();
    const lote = definirMarcadores.mock.calls.filter(([g]) => g === "lotes").at(-1)[1][0];
    expect(lote.dy).toBe(OFFSET_LOTE_PX[1]);
    const nomes = definirNomesNoChao.mock.calls.at(-1)[0];
    expect(nomes.find((x) => x.chave === "a").ancoraY).toBe(0);
    expect(nomes.find((x) => x.chave === "b").ancoraY).toBe(0.5);
  });
});

describe("CH-4 — o remendo e o componente", () => {
  it("o plugin instalado desenha no chão e o componente pergunta ao APK", async () => {
    const { MARCA_CHAO } = await import("../../scripts/app/remendar-google-maps.mjs");
    const pasta = "node_modules/@capacitor/google-maps/android/src/main/java/com/capacitorjs/plugins/googlemaps";
    const kt = readFileSync(`${pasta}/CapacitorGoogleMap.kt`, "utf8");
    expect(kt).toContain(MARCA_CHAO);
    expect(kt).toContain("googleMap?.addGroundOverlay(opcoes)");
    expect(readFileSync(`${pasta}/CapacitorGoogleMapsPlugin.kt`, "utf8")).toMatch(/@PluginMethod\n\s+fun maikeChao\(call: PluginCall\)/);
    const fonte = readFileSync("src/components/mapa/MapaGoogleNativo.jsx", "utf8");
    expect(fonte).toContain("await plugin.maikeChao({ id: mapa.id });");
    expect(fonte).toContain("definirNomesNoChao");
  });
});

/**
 * D-PROD-379 — nomes dos pastos no mapa do Google do app: tamanho fixo na tela, trocam de nível e somem quando não
 * cabem (nada de "travadinha" refazendo nomes no zoom, nenhum nome coberto por ícone); marcadores com a margem mínima.
 * O contorno escuro das letras está no N354-2 (`nomesNoMapaD354.test.jsx`).
 *
 *  G379-1. `nomesFixosNaCamera`: tamanho fixo (com lote, 10 px abaixo do ponto); o maior pasto primeiro; o nome que
 *          bate noutro nome ou num ícone (cocho, ponto, tarefa, lote de outro pasto) some; o lote do próprio pasto não
 *          conta; pasto minúsculo na tela, sem nome; longe, o nível desce para a sigla.
 *  G379-2. `useMarcadoresGoogle` no app (`nomesFixos`): sem câmera, nenhum nome; com o mapa parado, os nomes que cabem,
 *          sem `escala`; câmera no meio do gesto não mexe; um cocho novo em cima de um nome o esconde. No site, como
 *          antes (com `escala`).
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { ESCALA_NOME_FIXO, LADO_MINIMO_PASTO_PX, caixaDoNomeFixo, montarNomes, nomesFixosNaCamera } from "@/lib/mapaNativo/nomesGoogle.js";
import useMarcadoresGoogle from "@/components/mapa/useMarcadoresGoogle.js";
import { DESLOC_NOME_COM_LOTE_PX } from "@/lib/maplibre/nomesNoMapa.js";

const quadrado = (id, lat, lng, lado = 0.01) => ({ id, nome: `Pasto ${id}`, tamanho_hectares: 100, coordenadas: { coords: [[lat, lng], [lat, lng + lado], [lat - lado, lng + lado], [lat - lado, lng]] } });
/** Câmera falsa: `k` px por grau, origem em (-15, -47). */
const camera = (k, final = true) => ({ zoom: 14, projetar: (lat, lng) => ({ x: (lng + 47) * k, y: (-15 - lat) * k }), largura: 800, altura: 600, final });

let antesGetContext;
let antesToDataURL;
beforeEach(() => {
  antesGetContext = HTMLCanvasElement.prototype.getContext;
  antesToDataURL = HTMLCanvasElement.prototype.toDataURL;
  // qualquer método do contexto vale (nada é desenhado de verdade); a medida do texto cai na estimativa
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

describe("G379-1 — quais nomes aparecem, com tamanho fixo", () => {
  it("caixa de tamanho fixo: sem lote, centrada; com lote, o topo 10 px abaixo do ponto", () => {
    expect(ESCALA_NOME_FIXO).toBe(1);
    expect(caixaDoNomeFixo({ x: 100, y: 50 }, { w: 60, h: 14 }, false)).toEqual({ x: 70, y: 43, w: 60, h: 14 });
    expect(caixaDoNomeFixo({ x: 100, y: 50 }, { w: 60, h: 14 }, true)).toEqual({ x: 70, y: 50 + DESLOC_NOME_COM_LOTE_PX[1], w: 60, h: 14 });
  });

  it("perto: todos, com nome e hectares; o nome que bate no vizinho some (o maior pasto fica)", () => {
    // dois pastos lado a lado; o b é menor
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01), quadrado("b", -15, -46.99, 0.006)]);
    const longe = nomesFixosNaCamera(nomes, camera(100000), new Map());
    expect(longe.nivel).toBe("tudo");
    expect([...longe.visiveis].sort()).toEqual(["a", "b"]);
    // menos zoom: os pastos encolhem na tela, os nomes não; o nível desce e, batendo, o menor some
    const r = nomesFixosNaCamera(nomes, camera(6000), new Map());
    expect(r.nivel).toBe("sigla");
    expect([...r.visiveis]).toEqual(["a"]);
  });

  it("um cocho (ou ponto, tarefa) em cima do nome o esconde; o lote do próprio pasto não conta, o de outro sim", () => {
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01)]);
    const n = /** @type {any} */ (nomes.get("a"));
    const k = 100000;
    expect(nomesFixosNaCamera(nomes, camera(k), new Map()).visiveis.has("a")).toBe(true);
    const cocho = { lat: n.lat, lng: n.lng, w: 40, h: 40 };
    expect(nomesFixosNaCamera(nomes, camera(k), new Map(), [cocho]).visiveis.has("a")).toBe(false);
    const proprio = new Map([["a", { lat: n.lat, lng: n.lng, tamanho: { w: 44, h: 42 } }]]);
    expect(nomesFixosNaCamera(nomes, camera(k), proprio).visiveis.has("a")).toBe(true);
    // o lote de outro pasto parado em cima do nome
    const outro = new Map([["x", { lat: n.lat - 0.00012, lng: n.lng, tamanho: { w: 44, h: 42 } }]]);
    expect(nomesFixosNaCamera(nomes, camera(k), outro).visiveis.has("a")).toBe(false);
  });

  it("pasto pequeno demais na tela: sem nome", () => {
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01)]);
    const k = (LADO_MINIMO_PASTO_PX - 1) / 0.01;
    expect(nomesFixosNaCamera(nomes, camera(k), new Map()).visiveis.size).toBe(0);
    expect(nomesFixosNaCamera(new Map(), camera(k), new Map())).toEqual({ nivel: "tudo", visiveis: new Set() });
  });
});

describe("G379-2 — os nomes no app pelo useMarcadoresGoogle", () => {
  const areas = [quadrado("a", -15, -47, 0.01), quadrado("b", -15, -46.99, 0.006)];
  const nomesPublicados = (fn) => fn.mock.calls.filter(([g]) => g === "nomes").at(-1)?.[1];

  it("sem câmera, nenhum nome; o mapa parado mostra os que cabem, sem `escala`; câmera no meio do gesto não mexe", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, nomesFixos: true }));
    await result.current.syncLabels(areas, true, null, true);
    expect(nomesPublicados(definirMarcadores)).toEqual([]);

    result.current.revisarNomes(camera(100000, true));
    await Promise.resolve();
    const perto = nomesPublicados(definirMarcadores);
    expect(perto.map((m) => m.id).sort()).toEqual(["a", "b"]);
    for (const m of perto) {
      expect(m.escala).toBeUndefined();
      expect(m.semToque).toBe(true);
    }

    // no meio do gesto: nada
    const antes = definirMarcadores.mock.calls.length;
    result.current.revisarNomes(camera(6000, false));
    expect(definirMarcadores.mock.calls.length).toBe(antes);
    // parou longe: só o maior, na sigla
    result.current.revisarNomes(camera(6000, true));
    await Promise.resolve();
    expect(nomesPublicados(definirMarcadores).map((m) => m.id)).toEqual(["a"]);
    // a mesma câmera de novo: não publica
    const depois = definirMarcadores.mock.calls.length;
    result.current.revisarNomes(camera(6000, true));
    expect(definirMarcadores.mock.calls.length).toBe(depois);
  });

  it("um cocho novo em cima de um nome o esconde (os ícones são obstáculos)", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, nomesFixos: true }));
    await result.current.syncLabels([areas[0]], true, null, true);
    result.current.revisarNomes(camera(100000, true));
    await Promise.resolve();
    expect(nomesPublicados(definirMarcadores).map((m) => m.id)).toEqual(["a"]);
    const centro = nomesPublicados(definirMarcadores)[0];
    await result.current.syncPontosSuplementacao([{ id: "c1", tipo: "cocho", coordenadas: { lat: centro.lat, lng: centro.lng }, nome: "Cocho" }], true, [], vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    const cochos = definirMarcadores.mock.calls.filter(([g]) => g === "supl").at(-1)?.[1] || [];
    expect(cochos).toHaveLength(1);
    expect(nomesPublicados(definirMarcadores)).toEqual([]);
  });

  it("no site (sem `nomesFixos`): como antes, o tamanho segue o zoom (`escala`)", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores }));
    await result.current.syncLabels(areas, true, null, true);
    const lista = nomesPublicados(definirMarcadores);
    expect(lista.length).toBe(2);
    expect(typeof lista[0].escala).toBe("function");
  });
});

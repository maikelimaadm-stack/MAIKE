/**
 * D-PROD-379/382 — nomes dos pastos no mapa do Google do app: tamanho fixo na tela (nada de refazer nomes no zoom).
 * D-PROD-382 (o proprietário): as letras como antes (sem contorno), os hectares aparecendo e sumindo sem engasgar e os
 * nomes sumindo TODOS de uma vez, nunca só alguns.
 *
 *  G382-1. `nivelDosNomesFixos`: o mesmo nível para todos — tudo, nome, sigla e "nenhum" (todos somem juntos); um
 *          ícone de outro pasto em cima conta, o lote do próprio pasto não; o mapa girado usa os 4 cantos do pasto.
 *  G382-2. `useMarcadoresGoogle` no app (`nomesFixos`): sem câmera, nenhum nome; o nome e os hectares são marcadores
 *          separados — entre "tudo" e "nome" o marcador do nome é o MESMO (só os hectares entram e saem); "nenhum" tira
 *          todos; câmera no meio do gesto não mexe. No site, como antes (com `escala`).
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

import { ESCALA_NOME_FIXO, FOLGA_PARA_SUBIR_PX, ZOOM_MINIMO_NOMES, caixaDoNomeFixo, caixaDoPastoNaTela, montarNomes, nivelDosNomesFixos, nomesFixosNaCamera } from "@/lib/mapaNativo/nomesGoogle.js";
import { projetarNaCamera } from "@/lib/mapaNativo/camadaDeImagens.js";
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

describe("G382-1 — o nível dos nomes de tamanho fixo, o mesmo para todos", () => {
  it("caixa de tamanho fixo: sem lote, centrada; com lote, o topo 10 px abaixo do ponto", () => {
    expect(ESCALA_NOME_FIXO).toBe(1);
    expect(caixaDoNomeFixo({ x: 100, y: 50 }, { w: 60, h: 14 }, false)).toEqual({ x: 70, y: 43, w: 60, h: 14 });
    expect(caixaDoNomeFixo({ x: 100, y: 50 }, { w: 60, h: 14 }, true)).toEqual({ x: 70, y: 50 + DESLOC_NOME_COM_LOTE_PX[1], w: 60, h: 14 });
  });

  it("perto: nome e hectares; afastando: nome, sigla e, sem caber, NENHUM (todos juntos)", () => {
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01), quadrado("b", -15, -46.99, 0.01)]);
    expect(nivelDosNomesFixos(nomes, camera(100000), new Map())).toBe("tudo");
    const niveis = [20000, 8000, 3000, 600].map((k) => nivelDosNomesFixos(nomes, camera(k), new Map()));
    // vai descendo, nunca sobe, e no fim nenhum
    const ordem = ["tudo", "nome", "sigla", "nenhum"];
    for (let i = 1; i < niveis.length; i++) expect(ordem.indexOf(niveis[i])).toBeGreaterThanOrEqual(ordem.indexOf(niveis[i - 1]));
    expect(niveis.at(-1)).toBe("nenhum");
    expect(nivelDosNomesFixos(new Map(), camera(600), new Map())).toBe("tudo");
  });

  it("um cocho em cima do nome: o nome vai para o lado livre; sem lado livre, conta como problema; o lote do próprio pasto não", () => {
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01)]);
    const n = /** @type {any} */ (nomes.get("a"));
    const k = 100000;
    expect(nivelDosNomesFixos(nomes, camera(k), new Map())).toBe("tudo");
    // o cocho no meio do pasto (1000 px na tela): o nome desce para baixo dele, sem sair do pasto
    const cocho = { lat: n.lat, lng: n.lng, w: 200, h: 200 };
    const r = nomesFixosNaCamera(nomes, camera(k), new Map(), [cocho]);
    expect(r.nivel).toBe("tudo");
    expect(r.ocultos.size).toBe(0);
    const d = /** @type {any} */ (r.desloc.get("a"));
    expect(d.dx).toBe(0);
    expect(d.dy).toBeGreaterThan(100);
    // um ícone que cobre o pasto todo: o nome não tem lugar e não fica em cima dele
    const enorme = { lat: n.lat, lng: n.lng, w: 3000, h: 3000 };
    const r2 = nomesFixosNaCamera(nomes, camera(k), new Map(), [enorme]);
    expect(r2.nivel).toBe("nenhum");
    const proprio = new Map([["a", { lat: n.lat, lng: n.lng, tamanho: { w: 44, h: 42 } }]]);
    expect(nivelDosNomesFixos(nomes, camera(k), proprio)).toBe("tudo");
  });

  it("de muito longe (abaixo do zoom mínimo), nenhum nome, mesmo que coubesse", () => {
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01)]);
    const longe = { ...camera(100000), zoom: ZOOM_MINIMO_NOMES - 0.1 };
    expect(nivelDosNomesFixos(nomes, longe, new Map())).toBe("nenhum");
    expect(nivelDosNomesFixos(nomes, { ...longe, zoom: ZOOM_MINIMO_NOMES }, new Map())).toBe("tudo");
  });

  it("dois nomes que se encostariam: o segundo vai para o lado livre em vez de ficar por cima", () => {
    // dois pastos sobrepostos na tela (o mesmo ponto): o maior fica no lugar, o outro é puxado
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01), quadrado("b", -15.002, -46.998, 0.006)]);
    const r = nomesFixosNaCamera(nomes, camera(100000), new Map());
    expect(r.ocultos.size).toBe(0);
    expect(r.desloc.has("a")).toBe(false);
    expect(r.desloc.has("b")).toBe(true);
  });

  it("para subir de nível precisa de folga: perto do limite, quem está em 'nome' fica em 'nome'", () => {
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01), quadrado("b", -15, -46.99, 0.01)]);
    let k = 100000;
    while (nivelDosNomesFixos(nomes, camera(k), new Map()) === "tudo") k *= 0.99;
    // um tiquinho mais perto, "tudo" volta a caber por pouco; quem já está em "nome" não sobe
    const kVolta = k / 0.99;
    expect(nivelDosNomesFixos(nomes, camera(kVolta), new Map())).toBe("tudo");
    expect(nivelDosNomesFixos(nomes, camera(kVolta), new Map(), [], "nome")).toBe("nome");
    // com folga de sobra, sobe
    expect(nivelDosNomesFixos(nomes, camera(kVolta * 3), new Map(), [], "nome")).toBe("tudo");
    expect(FOLGA_PARA_SUBIR_PX).toBeGreaterThan(0);
  });

  it("mapa girado 45°: a caixa do pasto usa os 4 cantos (não achata) e o pasto grande segue com nome", () => {
    const b = { oeste: -47, sul: -15.01, leste: -46.99, norte: -15 };
    const girado = /** @type {any} */ (projetarNaCamera({ latitude: -15.005, longitude: -46.995, zoom: 17, bearing: 45 }, 800, 600));
    const c = /** @type {any} */ (caixaDoPastoNaTela(b, girado));
    expect(c.w).toBeGreaterThan(800);
    expect(c.h).toBeGreaterThan(800);
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01)]);
    expect(nivelDosNomesFixos(nomes, { zoom: 16, projetar: girado, largura: 800, altura: 600 }, new Map())).toBe("tudo");
  });
});

describe("G382-2 — os nomes no app pelo useMarcadoresGoogle", () => {
  const areas = [quadrado("a", -15, -47, 0.01), quadrado("b", -15, -46.99, 0.01)];
  const nomesPublicados = (fn) => fn.mock.calls.filter(([g]) => g === "nomes").at(-1)?.[1];

  it("sem câmera, nenhum; perto, nome + hectares (marcadores separados); o nome é o mesmo entre 'tudo' e 'nome'", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, nomesFixos: true }));
    await result.current.syncLabels(areas, true, null, true);
    expect(nomesPublicados(definirMarcadores)).toEqual([]);

    result.current.revisarNomes(camera(100000, true));
    await Promise.resolve();
    const perto = nomesPublicados(definirMarcadores);
    expect(perto.map((m) => m.id).sort()).toEqual(["a", "a|ha", "b", "b|ha"]);
    for (const m of perto) {
      expect(m.escala).toBeUndefined();
      expect(m.semToque).toBe(true);
    }
    const nomeA = perto.find((m) => m.id === "a");
    const haA = perto.find((m) => m.id === "a|ha");
    // os hectares logo abaixo do nome (sem lote, o nome no meio do ponto)
    expect(nomeA.ancora).toBe("centro");
    expect(haA).toMatchObject({ ancora: "topo", dy: nomeA.h / 2 });

    // um pouco mais longe (o primeiro zoom em que o nível é "nome"): só os nomes; o marcador do nome é o MESMO
    // (mesma imagem e lugar: o mapa não o refaz), os hectares saem
    const nomes = montarNomes(areas);
    let k = 100000;
    while (nivelDosNomesFixos(nomes, camera(k), new Map()) === "tudo") k *= 0.9;
    expect(nivelDosNomesFixos(nomes, camera(k), new Map())).toBe("nome");
    result.current.revisarNomes(camera(k, true));
    await Promise.resolve();
    const so = nomesPublicados(definirMarcadores);
    expect(so.map((m) => m.id).sort()).toEqual(["a", "b"]);
    const nomeA2 = so.find((m) => m.id === "a");
    expect(nomeA2.url).toBe(nomeA.url);
    expect([nomeA2.dy, nomeA2.ancora, nomeA2.w, nomeA2.h]).toEqual([nomeA.dy, nomeA.ancora, nomeA.w, nomeA.h]);

    // câmera no meio do gesto: nada
    const antes = definirMarcadores.mock.calls.length;
    result.current.revisarNomes(camera(600, false));
    expect(definirMarcadores.mock.calls.length).toBe(antes);
    // parou longe: nenhum (todos juntos)
    result.current.revisarNomes(camera(600, true));
    await Promise.resolve();
    expect(nomesPublicados(definirMarcadores)).toEqual([]);
    // a mesma câmera de novo: não publica
    const depois = definirMarcadores.mock.calls.length;
    result.current.revisarNomes(camera(600, true));
    expect(definirMarcadores.mock.calls.length).toBe(depois);
  });

  it("com lote: o nome 10 px abaixo do ponto e os hectares logo abaixo do nome", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, nomesFixos: true }));
    await result.current.syncLotes([{ id: "l1", area_atual_id: "a", quantidade_cabecas: 30 }], areas, true, [], vi.fn(), null, false, false);
    await result.current.syncLabels(areas, true, null, true);
    result.current.revisarNomes(camera(100000, true));
    await Promise.resolve();
    const lista = nomesPublicados(definirMarcadores);
    const nome = lista.find((m) => m.id === "a");
    const ha = lista.find((m) => m.id === "a|ha");
    expect(nome).toMatchObject({ ancora: "topo", dy: DESLOC_NOME_COM_LOTE_PX[1] });
    expect(ha).toMatchObject({ ancora: "topo", dy: DESLOC_NOME_COM_LOTE_PX[1] + nome.h });
  });

  it("no site (sem `nomesFixos`): como antes, o tamanho segue o zoom (`escala`), sem marcador de hectares à parte", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores }));
    await result.current.syncLabels(areas, true, null, true);
    const lista = nomesPublicados(definirMarcadores);
    expect(lista.map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(typeof lista[0].escala).toBe("function");
  });

  it("um cocho novo em cima de um nome: o nome (e os hectares) vão para o lado livre, não ficam por cima", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, nomesFixos: true }));
    await result.current.syncLabels([areas[0]], true, null, true);
    result.current.revisarNomes(camera(100000, true));
    await Promise.resolve();
    const antes = nomesPublicados(definirMarcadores);
    const nomeAntes = antes.find((m) => m.id === "a");
    expect(nomeAntes.dy).toBe(0);
    await result.current.syncPontosSuplementacao([{ id: "c1", tipo: "cocho", coordenadas: { lat: nomeAntes.lat, lng: nomeAntes.lng }, nome: "Cocho" }], true, [], vi.fn());
    await Promise.resolve();
    await Promise.resolve();
    const depois = nomesPublicados(definirMarcadores);
    const nome = depois.find((m) => m.id === "a");
    const ha = depois.find((m) => m.id === "a|ha");
    // o nome desceu para baixo do cocho (40 px) e os hectares foram junto
    expect(nome.dy).toBeGreaterThan(20);
    expect(ha.dy - nome.dy).toBe(nome.h / 2);
  });
});

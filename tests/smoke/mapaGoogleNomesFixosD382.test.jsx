/**
 * D-PROD-379/382 — nomes dos pastos no mapa do Google do app: tamanho fixo na tela (nada de refazer nomes no zoom).
 * D-PROD-382 (o proprietário): as letras como antes (sem contorno), os hectares aparecendo e sumindo sem engasgar e os
 * nomes sumindo TODOS de uma vez, nunca só alguns.
 *
 *  G382-1. `nivelDosNomesFixos`: o mesmo nível para todos — tudo, nome, sigla e "nenhum" (todos somem juntos); um
 *          ícone de outro pasto em cima conta, o lote do próprio pasto não; o mapa girado usa os 4 cantos do pasto.
 *  G382-2. `useMarcadoresGoogle` no app (`nomesFixos`): sem câmera, nenhum nome; o nome e os hectares são marcadores
 *          separados — entre "tudo" e "nome" o marcador do nome é o MESMO (só os hectares entram e saem); "nenhum" tira
 *          todos; no meio do gesto os nomes se ajustam (no máximo a cada 120 ms). No site, como antes (com `escala`).
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

import { DESLOC_MAXIMO_PX, ESCALA_NOME_FIXO, FOLGA_PARA_SUBIR_PX, NOMES_SEM_RECORTE, TOLERANCIA_NA_SIGLA, ZOOM_MINIMO_NOMES, caixaDoNomeFixo, caixaDoPastoNaTela, montarNomes, nivelDosNomesFixos, nomesFixosNaCamera } from "@/lib/mapaNativo/nomesGoogle.js";
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
    // a letra um pouco menor do que no site (pedido do proprietário)
    expect(ESCALA_NOME_FIXO).toBe(0.85);
    const w = 60 * ESCALA_NOME_FIXO;
    const h = 14 * ESCALA_NOME_FIXO;
    expect(caixaDoNomeFixo({ x: 100, y: 50 }, { w: 60, h: 14 }, false)).toEqual({ x: 100 - w / 2, y: 50 - h / 2, w, h });
    expect(caixaDoNomeFixo({ x: 100, y: 50 }, { w: 60, h: 14 }, true)).toEqual({ x: 100 - w / 2, y: 50 + DESLOC_NOME_COM_LOTE_PX[1], w, h });
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
    // o cocho (40 px) no meio do pasto (1000 px na tela): o nome desce para logo abaixo dele, perto do meio
    const cocho = { lat: n.lat, lng: n.lng, w: 40, h: 40 };
    const r = nomesFixosNaCamera(nomes, camera(k), new Map(), [cocho]);
    expect(r.nivel).toBe("tudo");
    expect(r.ocultos.size).toBe(0);
    const d = /** @type {any} */ (r.desloc.get("a"));
    expect(d.dx).toBe(0);
    expect(d.dy).toBeGreaterThan(20);
    expect(d.dy).toBeLessThanOrEqual(DESLOC_MAXIMO_PX);
    expect(d.dy % 4).toBe(0);
    // um ícone grande: o nome teria de ir longe do meio do pasto ("descentralizado") — fica sem aparecer
    const grande = { lat: n.lat, lng: n.lng, w: 200, h: 200 };
    expect(nomesFixosNaCamera(nomes, camera(k), new Map(), [grande]).nivel).toBe("nenhum");
    // um ícone que cobre o pasto todo: o nome não tem lugar e não fica em cima dele
    const enorme = { lat: n.lat, lng: n.lng, w: 3000, h: 3000 };
    const r2 = nomesFixosNaCamera(nomes, camera(k), new Map(), [enorme]);
    expect(r2.nivel).toBe("nenhum");
    const proprio = new Map([["a", { lat: n.lat, lng: n.lng, tamanho: { w: 44, h: 42 } }]]);
    expect(nivelDosNomesFixos(nomes, camera(k), proprio)).toBe("tudo");
    expect(nomesFixosNaCamera(nomes, camera(k), proprio).desloc.size).toBe(0);
  });

  it("o nome puxado para o lado nunca vai para cima do lote do próprio pasto", () => {
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01)]);
    const n = /** @type {any} */ (nomes.get("a"));
    const k = 100000;
    const cam = camera(k);
    const proprio = new Map([["a", { lat: n.lat, lng: n.lng, tamanho: { w: 44, h: 42 } }]]);
    // um cocho bem onde o nome ficaria (logo abaixo do lote): para cima, o lugar livre seria em cima do lote
    const p = /** @type {any} */ (cam.projetar(n.lat, n.lng));
    const abaixo = { lat: n.lat - 22 / k, lng: n.lng, w: 30, h: 24 };
    const r = nomesFixosNaCamera(nomes, cam, proprio, [abaixo]);
    const lote = { x: p.x - 22, y: p.y - 14 - 21, w: 44, h: 42 };
    const d = r.desloc.get("a");
    if (d) {
      const c = caixaDoNomeFixo(p, n.niveis[/** @type {any} */ (r.nivel)].medida, true);
      const k2 = { x: c.x + d.dx, y: c.y + d.dy, w: c.w, h: c.h };
      const bate = k2.x < lote.x + lote.w && lote.x < k2.x + k2.w && k2.y < lote.y + lote.h && lote.y < k2.y + k2.h;
      expect(bate).toBe(false);
    } else {
      // sem lugar perto: o nome não aparece
      expect(r.nivel === "nenhum" || r.ocultos.has("a")).toBe(true);
    }
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

  it("o nível muda no MESMO zoom, aproximando ou afastando (não é preciso afastar mais do que se aproximou)", () => {
    const nomes = montarNomes([quadrado("a", -15, -47, 0.01), quadrado("b", -15, -46.99, 0.01)]);
    let k = 100000;
    while (nivelDosNomesFixos(nomes, camera(k), new Map()) === "tudo") k *= 0.99;
    const kVolta = k / 0.99;
    // vindo de "nome" (aproximando) ou de "tudo" (afastando), o mesmo zoom dá o mesmo nível
    for (const atual of /** @type {any[]} */ (["tudo", "nome", "sigla", "nenhum", undefined])) {
      expect(nivelDosNomesFixos(nomes, camera(kVolta), new Map(), [], atual)).toBe("tudo");
      expect(nivelDosNomesFixos(nomes, camera(k), new Map(), [], atual)).toBe("nome");
    }
    expect(FOLGA_PARA_SUBIR_PX).toBe(0);
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
  /** Os nomes que APARECEM (os `oculto` ficam no mapa escondidos, prontos para aparecer sem serem refeitos). */
  const nomesPublicados = (fn) => (fn.mock.calls.filter(([g]) => g === "nomes").at(-1)?.[1] || []).filter((m) => !m.oculto);
  const todosOsNomes = (fn) => fn.mock.calls.filter(([g]) => g === "nomes").at(-1)?.[1] || [];

  it("sem câmera, nenhum; perto, nome + hectares (marcadores separados); o nome é o mesmo entre 'tudo' e 'nome'", async () => {
    const definirMarcadores = vi.fn();
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, nomesFixos: true }));
    await result.current.syncLabels(areas, true, null, true);
    expect(nomesPublicados(definirMarcadores)).toEqual([]);
    // todos os níveis já vão na lista, escondidos: trocar de nível é só mostrar e esconder
    // (nome curto: a sigla é igual ao nome e um marcador só serve aos dois níveis)
    expect(todosOsNomes(definirMarcadores).map((m) => m.id).sort()).toEqual(["a", "a|ha", "b", "b|ha"]);
    expect(todosOsNomes(definirMarcadores).every((m) => m.oculto)).toBe(true);

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
    // os hectares continuam na lista, iguais, só escondidos (o mapa não os refaz ao voltar)
    const haA2 = todosOsNomes(definirMarcadores).find((m) => m.id === "a|ha");
    expect(haA2.oculto).toBe(true);
    expect([haA2.url, haA2.dy]).toEqual([haA.url, haA.dy]);

    // no meio do gesto (a câmera só chega com o APK que mostra e esconde): os nomes se ajustam enquanto o mapa mexe,
    // no máximo a cada MS_NIVEL_NO_MOVIMENTO
    result.current.revisarNomes(camera(600, false));
    await Promise.resolve();
    expect(nomesPublicados(definirMarcadores)).toEqual([]);
    const antes = definirMarcadores.mock.calls.length;
    result.current.revisarNomes(camera(100000, false));
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
    expect(ha.dy - nome.dy).toBeCloseTo(nome.h / 2, 5);
    // a letra menor: o marcador tem o tamanho da imagem × ESCALA_NOME_FIXO
    expect(nome.w).toBeCloseTo(60 * ESCALA_NOME_FIXO, 5);
  });

  it("nome comprido: a sigla é um marcador à parte (`<id>|sg`), escondido até o nível 'sigla'", async () => {
    const definirMarcadores = vi.fn();
    const comprido = { ...quadrado("a", -15, -47, 0.01), nome: "Pasto da Represa Grande do Meio" };
    const { result } = renderHook(() => useMarcadoresGoogle({ definirMarcadores, nomesFixos: true }));
    await result.current.syncLabels([comprido], true, null, true);
    result.current.revisarNomes(camera(100000, true));
    await Promise.resolve();
    const nomes = montarNomes([comprido]);
    const n = /** @type {any} */ (nomes.get("a"));
    if (n.niveis.sigla.chave === n.niveis.nome.chave) return; // sem sigla diferente neste nome: nada a conferir
    expect(nomesPublicados(definirMarcadores).map((m) => m.id).sort()).toEqual(["a", "a|ha"]);
    expect(todosOsNomes(definirMarcadores).find((m) => m.id === "a|sg").oculto).toBe(true);
    let k = 100000;
    while (k > 100 && nivelDosNomesFixos(nomes, camera(k), new Map()) !== "sigla") k *= 0.9;
    if (nivelDosNomesFixos(nomes, camera(k), new Map()) !== "sigla") return;
    result.current.revisarNomes(camera(k, true));
    await Promise.resolve();
    expect(nomesPublicados(definirMarcadores).map((m) => m.id)).toEqual(["a|sg"]);
  });
});

describe("G382-6 — de longe, como no Google: os nomes dos pastos pequenos saem primeiro", () => {
  it("na sigla, o pasto que virou um pontinho fica sem nome e os grandes continuam; longe demais, nenhum", () => {
    // um pasto grande e três pequenos
    const lista = [quadrado("g", -15, -47, 0.02), quadrado("p1", -15.03, -47, 0.002), quadrado("p2", -15.04, -47, 0.002), quadrado("p3", -15.05, -47, 0.002)];
    const nomes = montarNomes(lista);
    // 0,002° × 4000 = 8 px (um pontinho); o grande, 80 px
    const r = nomesFixosNaCamera(nomes, camera(4000), new Map());
    expect(r.nivel).toBe("sigla");
    expect(r.ocultos.has("g")).toBe(false);
    expect([...r.ocultos].sort()).toEqual(["p1", "p2", "p3"]);
    expect(TOLERANCIA_NA_SIGLA).toBeGreaterThan(0.5);
    // todos viraram pontinhos: nenhum
    expect(nomesFixosNaCamera(nomes, camera(300), new Map()).nivel).toBe("nenhum");
  });

  it("fazenda com muitos pastos: só os de perto da tela entram (os de longe ficam escondidos)", () => {
    const muitos = [];
    for (let i = 0; i < NOMES_SEM_RECORTE + 20; i += 1) muitos.push(quadrado(`a${i}`, -15 - i * 0.02, -47, 0.01));
    const nomes = montarNomes(muitos);
    // 0,01° × 20000 = 200 px por pasto, um a cada 400 px para baixo; a tela tem 600 px de altura
    const r = nomesFixosNaCamera(nomes, camera(20000), new Map());
    expect(r.ocultos.has("a0")).toBe(false);
    expect(r.ocultos.has("a2")).toBe(false);
    expect(r.ocultos.has(`a${NOMES_SEM_RECORTE}`)).toBe(true);
    // poucos pastos: nenhum recorte
    const poucos = montarNomes(muitos.slice(0, 50));
    expect(nomesFixosNaCamera(poucos, camera(20000), new Map()).ocultos.size).toBe(0);
  });
});

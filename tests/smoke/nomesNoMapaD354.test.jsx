/**
 * D-PROD-354 (mapa leve, etapa 4) — nomes dos pastos desenhados pelo próprio mapa.
 *
 * O nome do pasto deixou de ser um marcador HTML: é um ponto na fonte GeoJSON `mg-nomes` e duas camadas `symbol`
 * pintam a imagem do texto (canvas). O tamanho no zoom é o `icon-size` da camada; o nível (nome + ha, nome, sigla)
 * é escolhido sem tocar em elemento nenhum. MapLibre e canvas falsos.
 *
 *  N354-1. Fonte e camadas: nada de HTML; duas camadas symbol (sem lote: centro; com lote: topo + 10 px), por cima de
 *          tudo, sem colisão do mapa, sem `text-field`, sem clique.
 *  N354-2. Imagem: letra, cores, opacidade e linhas do rótulo de antes, sem sombra; imagem por chave (texto + cores):
 *          texto igual divide a imagem, refetch não redesenha nem republica, texto novo = imagem nova.
 *  N354-3. Tamanho no zoom: `icon-size` = (letra do zoom ÷ 12) × encaixe no pasto (mínimo 60%), por pasto na fonte.
 *  N354-4. Nível global por colisão (sem DOM): tudo / nome / sigla; lote de OUTRO pasto é obstáculo; o próprio não.
 *  N354-5. Durante o zoom: revisão barata, só pelos pastos na tela, no máximo a cada 120 ms, publica só se o nível muda.
 *  N354-6. Posição com e sem lote (`comLote` nos nomes, `comRotulo` nos lotes).
 *  N354-7. Troca de estilo, `styleimagemissing`, poda, densidade da tela, letra Inter, clearAll.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { centroideArea, pontoEFolga } from "@/lib/maplibre/mapaGeralRender.js";
import { LOTES_SOURCE_ID, caixaDoLote, limparCacheImagensLotes } from "@/lib/maplibre/lotesNoMapa.js";
import {
  ALTURA_LINHA,
  COR_EXTRA,
  DESLOC_NOME_COM_LOTE_PX,
  NOMES_LAYER_ID,
  NOMES_LOTE_LAYER_ID,
  NOMES_SOURCE_ID,
  ZOOMS_NOME,
  caixaDoNome,
  camadasNomes,
  chaveImagemNome,
  escalaRotulo,
  expressaoTamanhoNome,
  fontesRotuloPorZoom,
  limparCacheNomes,
  linhasDoNivel,
  medirLinhas,
  raioNaTela,
  tamanhoNoZoom,
  tamanhosAcertadosNoZoom,
  tamanhosPorZoom,
} from "@/lib/maplibre/nomesNoMapa.js";
import { parseVertices } from "@/lib/geografia/coords.js";
import useMapRenderer from "@/components/mapa/useMapRenderer.jsx";
import { esperarImagens, instalarCanvasFalso } from "./helpers/canvasLotesFalso.js";

const marcadores = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock("@/lib/maplibre/lifecycle.js", async (orig) => {
  const real = await orig();
  class Marker {
    constructor(opts) {
      this.el = opts.element;
      marcadores.push(this);
    }
    setLngLat() { return this; }
    addTo() { return this; }
    getElement() { return this.el; }
    setOffset() { return this; }
    remove() {}
  }
  class Popup {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() {}
  }
  return {
    ...real,
    maplibregl: { Marker, Popup, LngLatBounds: class {} },
    setSourceData: (map, id, data) => {
      map?.publicacoes?.push(id);
      map?.data?.set(id, data);
    },
  };
});

/** 1 grau = 10.000 px no zoom 15; dobra a cada nível (como o mapa). */
const PX_GRAU = 10000;
const mkMap = () => {
  const sources = new Map();
  const layers = [];
  const images = new Map();
  const handlers = [];
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 800;
  const map = {
    container: document.createElement("div"),
    data: new Map(),
    publicacoes: /** @type {string[]} */ ([]),
    handlers,
    images,
    layers,
    zoom: 15,
    /** ponto do mapa no centro da tela (px); a tela tem 400 × 800 */
    origem: { x: 0, y: 0 },
    getSource: (id) => sources.get(id),
    addSource: (id, s) => sources.set(id, s),
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (l) => layers.push(l),
    addImage: vi.fn((id, img, opts) => {
      if (images.has(id)) throw new Error(`imagem ${id} já existe`);
      images.set(id, { img, opts });
    }),
    hasImage: (id) => images.has(id),
    removeImage: vi.fn((id) => images.delete(id)),
    setPaintProperty: vi.fn(),
    setFeatureState: vi.fn(),
    on: (...a) => handlers.push(a),
    off: (...a) => {
      const i = handlers.findIndex((h) => h[0] === a[0] && h[h.length - 1] === a[a.length - 1]);
      if (i >= 0) handlers.splice(i, 1);
    },
    getZoom: () => map.zoom,
    project: (ll) => {
      const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat];
      const k = PX_GRAU * Math.pow(2, map.zoom - 15);
      return { x: lng * k - map.origem.x, y: -lat * k - map.origem.y };
    },
    unproject: ([x, y]) => ({ lng: x / PX_GRAU, lat: -y / PX_GRAU }),
    getCanvas: () => canvas,
    queryRenderedFeatures: () => [],
  };
  return map;
};

/** Dispara os handlers de um evento sem camada. */
const disparar = (map, ev, e = {}) => {
  for (const h of [...map.handlers]) if (h[0] === ev && typeof h[1] === "function") h[1](e);
};

const montar = () => {
  const map = mkMap();
  const { result } = renderHook(() => useMapRenderer(/** @type {any} */ ({ current: map })));
  return { map, r: result.current };
};

/** Área quadrada com o canto de cima à esquerda em (lat, lng) e lado `lado` graus. */
const quadrado = (id, nome, lat, lng, lado = 0.01, extra = {}) => ({
  id,
  nome,
  tamanho_hectares: 12.5,
  coordenadas: { coords: [[lat, lng], [lat, lng + lado], [lat - lado, lng + lado], [lat - lado, lng]] },
  ...extra,
});
const A1 = quadrado("a1", "Pasto 1", 0, 0);
const A2 = quadrado("a2", "Pasto 2", 0, 0.02);

const feicoes = (map) => map.data.get(NOMES_SOURCE_ID)?.features || [];
const porId = (map, id) => feicoes(map).find((f) => f.properties.id === id);
const niveis = (map) => [...new Set(feicoes(map).map((f) => f.properties.nivel))];
const nomesAdds = (map) => map.addImage.mock.calls.filter((c) => String(c[0]).startsWith("mg-nome|"));
const desenhosNome = () => canvas.chamadas.filter((c) => c.nome === "fillText" && c.estado.font.startsWith("700 12px")).length;
const quadro = () => new Promise((res) => requestAnimationFrame(() => res(undefined)));
/** syncLabels → a revisão no próximo quadro → as imagens desenhadas. */
const pronto = async () => {
  for (let i = 0; i < 3; i += 1) {
    await esperarImagens();
    await quadro();
    // a fila de desenho devolve a vez ao navegador entre fatias (setTimeout 0)
    for (let j = 0; j < 8; j += 1) await new Promise((res) => setTimeout(res, 0));
  }
};
const LOTE = (areaId, extra = {}) => ({ id: `l-${areaId}`, area_atual_id: areaId, quantidade_cabecas: 10, ...extra });

let canvas;
let renderer = null;
beforeEach(() => {
  marcadores.length = 0;
  limparCacheImagensLotes();
  limparCacheNomes();
  canvas = instalarCanvasFalso();
  renderer = null;
});
afterEach(() => {
  renderer?.clearAll();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("N354-1 — fonte e camadas, sem HTML", () => {
  it("o nome vai para a fonte do mapa (texto, nível, imagem); nenhum elemento HTML de nome", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncLabels([A1, A2], true, (a) => (a.id === "a1" ? "Ocupado 3d" : null), true);
    await pronto();

    expect(marcadores).toHaveLength(0);
    expect(document.querySelector(".mg-area-label")).toBeNull();
    expect(map.container.childElementCount).toBe(0);
    expect(feicoes(map)).toHaveLength(2);
    const f = porId(map, "a1");
    const c = centroideArea(A1);
    expect(f.geometry.coordinates).toEqual([c.lng, c.lat]);
    expect(f.properties).toMatchObject({ id: "a1", nome: "Pasto 1", nivel: "tudo", texto: "Pasto 1\nha 12,50\nOcupado 3d", comLote: false });
    expect(f.properties.imagem).toBe(chaveImagemNome([{ tipo: "nome", texto: "Pasto 1" }, { tipo: "ha", texto: "ha 12,50" }, { tipo: "extra", texto: "Ocupado 3d" }]));
    expect(porId(map, "a2").properties.texto).toBe("Pasto 2\nha 12,50");
    // a imagem no devicePixelRatio
    const [chave, , opts] = nomesAdds(map).find((a) => a[0] === f.properties.imagem);
    expect(chave).toBe(f.properties.imagem);
    expect(opts).toEqual({ pixelRatio: window.devicePixelRatio || 1 });
  });

  it("texto perigoso é só texto pintado no canvas (nenhum elemento é criado)", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncLabels([quadrado("x", '<img src=x onerror="window.__x354=1">', 0, 0)], true, null, true);
    await pronto();
    expect(porId(map, "x").properties.nome).toBe('<img src=x onerror="window.__x354=1">');
    expect(document.querySelector("img")).toBeNull();
    expect(/** @type {any} */ (window).__x354).toBeUndefined();
  });

  it("duas camadas symbol: sem lote centrado no ponto; com lote o topo 10 px abaixo do ponto (icon-translate)", () => {
    const [sem, com] = camadasNomes();
    expect(sem).toMatchObject({ id: NOMES_LAYER_ID, type: "symbol", source: NOMES_SOURCE_ID, filter: ["!", ["boolean", ["get", "comLote"], false]] });
    expect(com).toMatchObject({ id: NOMES_LOTE_LAYER_ID, type: "symbol", source: NOMES_SOURCE_ID, filter: ["boolean", ["get", "comLote"], false] });
    expect(sem.layout["icon-anchor"]).toBe("center");
    expect(com.layout["icon-anchor"]).toBe("top");
    // o `icon-offset` seria multiplicado pelo icon-size; o `icon-translate` é em px da tela
    expect(DESLOC_NOME_COM_LOTE_PX).toEqual([0, 10]);
    expect(com.paint).toEqual({ "icon-translate": [0, 10], "icon-translate-anchor": "viewport" });
    expect(sem.paint).toBeUndefined();
    for (const l of [sem, com]) {
      expect(l.layout).toMatchObject({ "icon-image": ["get", "imagem"], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-rotation-alignment": "viewport" });
      expect(l.layout["icon-offset"]).toBeUndefined();
      expect(l.layout["icon-size"]).toEqual(expressaoTamanhoNome());
      // o estilo sem internet não tem fonte de letras
      expect(JSON.stringify(l)).not.toMatch(/text-field|text-font/);
    }
  });

  it("os nomes ficam por cima de todas as camadas do Mapa Geral e não recebem clique", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncAreas([A1], true, vi.fn(), vi.fn(), null);
    r.syncLabels([A1], true, null, true);
    await pronto();
    const ids = map.layers.map((l) => l.id);
    expect(ids.slice(-2)).toEqual([NOMES_LAYER_ID, NOMES_LOTE_LAYER_ID]);
    expect(ids.indexOf(NOMES_LAYER_ID)).toBeGreaterThan(ids.indexOf("mg-tarefas"));
    // nenhum evento ligado às camadas dos nomes: o clique no pasto continua da camada das áreas
    expect(map.handlers.filter((h) => h[1] === NOMES_LAYER_ID || h[1] === NOMES_LOTE_LAYER_ID)).toHaveLength(0);
    expect(map.handlers.some((h) => h[0] === "click" && h[1] === "mg-areas-fill")).toBe(true);
  });

  it("nomes desligados: a fonte fica vazia", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncLabels([A1, A2], true, null, true);
    await pronto();
    expect(feicoes(map)).toHaveLength(2);
    r.syncLabels([A1, A2], false, null, true);
    await pronto();
    expect(feicoes(map)).toHaveLength(0);
  });
});

describe("N354-2 — a imagem do nome", () => {
  it("nome 700 12 px branco, ha 400 11 px a 95%, extra 600 11 px #fef08a; centralizado, line-height 1,15, sem sombra", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncLabels([A1], true, () => "Ocupado 3d", true);
    await pronto();
    const textos = canvas.chamadas.filter((c) => c.nome === "fillText");
    const [nome, ha, extra] = textos;
    expect(textos).toHaveLength(3);
    expect(nome.args[0]).toBe("Pasto 1");
    expect(nome.estado).toMatchObject({ font: "700 12px Inter, Arial, sans-serif", fillStyle: "#ffffff", globalAlpha: 1, textAlign: "center" });
    expect(ha.args[0]).toBe("ha 12,50");
    expect(ha.estado).toMatchObject({ font: "400 11px Inter, Arial, sans-serif", fillStyle: "#ffffff", globalAlpha: 0.95 });
    expect(extra.args[0]).toBe("Ocupado 3d");
    expect(extra.estado).toMatchObject({ font: "600 11px Inter, Arial, sans-serif", fillStyle: COR_EXTRA, globalAlpha: 1 });
    expect(COR_EXTRA).toBe("#fef08a");
    for (const t of textos) {
      expect(t.estado.shadowBlur).toBe(0);
      expect(t.estado.shadowColor).toBe("");
    }
    // centralizado na largura da imagem; cada linha no meio da sua altura (letra × 1,15)
    const [, pixels] = nomesAdds(map)[0];
    const pr = window.devicePixelRatio || 1;
    const larguraCss = pixels.width / pr;
    for (const t of textos) expect(t.args[1]).toBeCloseTo(larguraCss / 2, 5);
    // sem as métricas da letra (canvas falso) a linha de base é o meio da linha
    expect(nome.args[2]).toBeCloseTo((12 * ALTURA_LINHA) / 2, 5);
    expect(ha.args[2]).toBeCloseTo(12 * ALTURA_LINHA + (11 * ALTURA_LINHA) / 2, 5);
    expect(extra.args[2]).toBeCloseTo(12 * ALTURA_LINHA + 11 * ALTURA_LINHA + (11 * ALTURA_LINHA) / 2, 5);
    // tamanho: a linha mais larga (6 px por letra no canvas falso) + 1 px de cada lado; altura = soma das linhas
    expect(larguraCss).toBe(Math.ceil(6 * "Ocupado 3d".length) + 2);
    expect(pixels.height / pr).toBe(Math.ceil(12 * ALTURA_LINHA + 2 * 11 * ALTURA_LINHA));
    expect(readFileSync("src/lib/maplibre/nomesNoMapa.js", "utf8")).not.toMatch(/shadowBlur|shadowColor|strokeText/);
  });

  it("chave = linhas + cores: texto igual divide a imagem; refetch não redesenha nem republica; texto novo = imagem nova", async () => {
    const { map, r } = montar();
    renderer = r;
    const gemeo = quadrado("a3", "Pasto 1", 0, 0.04);
    r.syncLabels([A1, gemeo], true, null, true);
    await pronto();
    expect(porId(map, "a1").properties.imagem).toBe(porId(map, "a3").properties.imagem);
    expect(desenhosNome()).toBe(1);
    expect(nomesAdds(map)).toHaveLength(1);
    const dados = map.data.get(NOMES_SOURCE_ID);

    // refetch: objetos novos, mesmo conteúdo
    r.syncLabels([{ ...A1 }, { ...gemeo }], true, null, true);
    await pronto();
    expect(desenhosNome()).toBe(1);
    expect(map.data.get(NOMES_SOURCE_ID)).toBe(dados); // nada mudou: nem setData

    // o texto extra muda: imagem nova só para quem mudou
    r.syncLabels([A1, gemeo], true, (a) => (a.id === "a3" ? "Descanso 5d" : null), true);
    await pronto();
    expect(porId(map, "a3").properties.imagem).not.toBe(porId(map, "a1").properties.imagem);
    expect(porId(map, "a3").properties.texto).toBe("Pasto 1\nha 12,50\nDescanso 5d");
    expect(desenhosNome()).toBe(2);

    // as cores fazem parte da chave
    expect(chaveImagemNome([{ tipo: "nome", texto: "X" }])).toContain("#ffffff");
    expect(chaveImagemNome([{ tipo: "nome", texto: "X" }])).toContain("#fef08a");
  });

  it("linhas por nível: tudo = nome + ha + extra; nome; sigla; linha vazia não entra", () => {
    const t = { nome: "KM - 01 A", sigla: "01 A", ha: "ha 3,00", extra: "Ocupado 2d" };
    expect(linhasDoNivel(t, "tudo").map((l) => l.texto)).toEqual(["KM - 01 A", "ha 3,00", "Ocupado 2d"]);
    expect(linhasDoNivel(t, "nome")).toEqual([{ tipo: "nome", texto: "KM - 01 A" }]);
    expect(linhasDoNivel(t, "sigla")).toEqual([{ tipo: "nome", texto: "01 A" }]);
    expect(linhasDoNivel({ ...t, ha: null, extra: null }, "tudo")).toEqual(linhasDoNivel(t, "nome"));
    expect(linhasDoNivel({ nome: "", sigla: "", ha: null, extra: null }, "tudo")).toEqual([]);
    // pasto sem "ha": os níveis "tudo" e "nome" desenham o mesmo e dividem a imagem
    expect(chaveImagemNome(linhasDoNivel({ ...t, ha: null, extra: null }, "tudo"))).toBe(chaveImagemNome(linhasDoNivel(t, "nome")));
  });
});

describe("N354-3 — tamanho no zoom pelo próprio mapa", () => {
  it("icon-size: interpolação exponencial de base 2 entre paradas por pasto, de 8 a 22", () => {
    expect(ZOOMS_NOME).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    const e = expressaoTamanhoNome();
    expect(e.slice(0, 3)).toEqual(["interpolate", ["exponential", 2], ["zoom"]]);
    expect(e.slice(3)).toEqual(ZOOMS_NOME.flatMap((z) => [z, ["get", `s${z}`]]));
  });

  it("parada = (letra do zoom ÷ 12) × encaixe no pasto — a mesma conta do rótulo HTML (fr × escalaRotulo(w·fr, h·fr, raio))", () => {
    const m = { w: 48, h: 26 };
    const pf = { lat: -15, lng: -60, folga: 0.0004 };
    for (const z of [8, 11, 13, 14.5, 16, 17, 20]) {
      const fr = fontesRotuloPorZoom(z).nome / 12;
      const raio = raioNaTela(pf.folga, pf.lat, z);
      expect(tamanhoNoZoom(m, pf, z)).toBeCloseTo(fr * escalaRotulo(m.w * fr, m.h * fr, raio), 10);
    }
    // pasto grande: só a letra (10 px até o 13, 12 px a partir do 17)
    const grande = { lat: 0, lng: 0, folga: 1 };
    expect(tamanhoNoZoom(m, grande, 12)).toBeCloseTo(10 / 12, 10);
    expect(tamanhoNoZoom(m, grande, 15)).toBeCloseTo(11 / 12, 10);
    expect(tamanhoNoZoom(m, grande, 18)).toBe(1);
    // pasto minúsculo: nunca abaixo de 60% (legível)
    const mini = { lat: 0, lng: 0, folga: 1e-7 };
    expect(tamanhoNoZoom(m, mini, 12)).toBeCloseTo(0.6 * (10 / 12), 10);
    expect(tamanhoNoZoom(m, mini, 18)).toBeCloseTo(0.6, 10);
    // sem folga (área sem ponto de dentro): só a letra
    expect(tamanhoNoZoom(m, null, 15)).toBeCloseTo(11 / 12, 10);
  });

  it("a folga em px é a da projeção do mapa (Mercator, mundo de 512 px no zoom 0)", () => {
    const y = (lat, z) => ((180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360) * 512 * Math.pow(2, z);
    for (const [lat, z] of [[-15, 14], [-22.5, 17], [0, 10]]) {
      const folga = 0.0003;
      expect(raioNaTela(folga, lat, z)).toBeCloseTo(y(lat - folga / 2, z) - y(lat + folga / 2, z), 2);
    }
  });

  it("parado num zoom qualquer o nome tem o tamanho exato: as duas paradas em volta do zoom são acertadas", () => {
    const m = { w: 60, h: 26 };
    const pf = { lat: -15, lng: 0, folga: 0.0012 };
    const tabela = tamanhosPorZoom(m, pf);
    const noMapa = (tab, z) => {
      const z0 = Math.floor(z);
      const a = tab[`s${z0}`], b = tab[`s${z0 + 1}`];
      return a + (b - a) * (Math.pow(2, z - z0) - 1);
    };
    // nas paradas inteiras a tabela já é exata
    for (const z of [12, 13, 14]) expect(noMapa(tabela, z)).toBeCloseTo(tamanhoNoZoom(m, pf, z), 3);
    for (const z of [12.6, 13.3, 13.9, 16.5]) {
      const exato = tamanhoNoZoom(m, pf, z);
      const acertada = tamanhosAcertadosNoZoom(tabela, m, pf, z);
      expect(noMapa(acertada, z)).toBeCloseTo(exato, 2);
      // só as duas paradas em volta mudam
      const mudaram = Object.keys(tabela).filter((k) => tabela[k] !== acertada[k]);
      expect(mudaram.every((k) => k === `s${Math.floor(z)}` || k === `s${Math.floor(z) + 1}`)).toBe(true);
    }
    // sem o acerto, perto do mínimo de 60% a curva de dois pontos passa do tamanho certo
    const z = 13.4;
    expect(Math.abs(noMapa(tabela, z) / tamanhoNoZoom(m, pf, z) - 1)).toBeGreaterThan(0.03);
  });

  it("cada pasto leva as suas paradas na fonte, do nível em que está", async () => {
    const { map, r } = montar();
    renderer = r;
    const mini = quadrado("m", "Mini", 0, 0.05, 0.0003);
    r.syncLabels([A1, mini], true, null, true);
    await pronto();
    const ring = parseVertices(mini.coordenadas.coords);
    const pf = pontoEFolga(ring);
    const f = porId(map, "m");
    const linhas = linhasDoNivel({ nome: "Mini", sigla: "Mini", ha: "ha 12,50", extra: null }, f.properties.nivel);
    expect(f.properties).toMatchObject(tamanhosAcertadosNoZoom(tamanhosPorZoom(medirLinhas(linhas), pf), medirLinhas(linhas), pf, 15));
    for (const z of ZOOMS_NOME) {
      expect(f.properties[`s${z}`]).toBeGreaterThanOrEqual(Math.round(0.6 * (10 / 12) * 1000) / 1000 - 0.001);
      expect(f.properties[`s${z}`]).toBeLessThanOrEqual(1);
    }
    // o pasto grande não encolhe no zoom 15 (só a letra); o minúsculo sim
    expect(porId(map, "a1").properties.s15).toBeCloseTo(11 / 12, 3);
    expect(f.properties.s15).toBeLessThan(porId(map, "a1").properties.s15);
  });

  it("durante o zoom não roda nada por quadro para o tamanho dos nomes (só a revisão do nível, com intervalo)", () => {
    const src = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(src).not.toMatch(/scale\(|getBoundingClientRect|\.style\.transform|escalarNome|aplicarFonteRotulo/);
    expect(src).toMatch(/const h = \(\) => arrumarDuranteZoom\(\);\s*map\.on\("zoom", h\);/);
  });
});

describe("N354-4 — nível global por colisão, sem medir elemento", () => {
  it("cabe tudo → nome + ha para todos; pastos minúsculos → sigla para todos", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncLabels([A1, A2], true, null, true);
    await pronto();
    expect(niveis(map)).toEqual(["tudo"]);

    // no zoom 11 cada pasto tem 6 px na tela: nem o nome cabe
    map.zoom = 11;
    disparar(map, "moveend");
    await pronto();
    expect(niveis(map)).toEqual(["sigla"]);
    expect(porId(map, "a1").properties.texto).toBe("Pasto 1"); // sem sigla nem prefixo "XX - ": o próprio nome, sem o ha
  });

  it("o ha bate no nome do vizinho, o nome não → só o nome para todos", async () => {
    const { map, r } = montar();
    renderer = r;
    // dois pastos largos, um em cima do outro: os pontos ficam a 24 px; "tudo" (≈ 23 px de altura) bate, o nome (≈ 12 px) não
    const largo = (id, nome, lat) => ({ id, nome, tamanho_hectares: 9, coordenadas: { coords: [[lat, 0], [lat, 0.05], [lat - 0.0024, 0.05], [lat - 0.0024, 0]] } });
    r.syncLabels([largo("c1", "Pasto C1", 0), largo("c2", "Pasto C2", -0.0024)], true, null, true);
    await pronto();
    expect(niveis(map)).toEqual(["nome"]);
    expect(porId(map, "c1").properties.texto).toBe("Pasto C1");
  });

  it("o ícone do lote de OUTRO pasto é obstáculo; o do próprio pasto não conta", async () => {
    const { map, r } = montar();
    renderer = r;
    // a1 com lote; a2 sem lote, com o ponto 20 px acima do de a1: o nome de a2 cai no ícone do lote de a1
    const c1 = centroideArea(A1);
    const a2 = quadrado("a2", "Pasto 2", c1.lat + 0.002 + 0.0035, c1.lng - 0.0035, 0.007);
    expect(centroideArea(a2).lat - c1.lat).toBeCloseTo(0.002, 6);
    await r.syncLotes([LOTE("a1")], [A1, a2], true, [], vi.fn(), vi.fn(), true, false);
    r.syncLabels([A1, a2], true, null, true);
    await pronto();
    expect(niveis(map)).toEqual(["sigla"]);

    // sem o lote não há ícone no caminho (o nome de a1 desce para o centro e só o "ha" encosta no nome de a2): só o nome
    await r.syncLotes([], [A1, a2], true, [], vi.fn(), vi.fn(), true, false);
    await pronto();
    expect(niveis(map)).toEqual(["nome"]);

    // só a1, com o lote dele: nome + ha (o ícone do próprio pasto não conta contra o nome dele)
    await r.syncLotes([LOTE("a1")], [A1], true, [], vi.fn(), vi.fn(), true, false);
    r.syncLabels([A1], true, null, true);
    await pronto();
    expect(niveis(map)).toEqual(["tudo"]);
    const src = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(src).toMatch(/caixaDoLote\(map\.project\(lote\.item\.lngLat\), nomesRef\.current\.has\(id\), lote\.tamanho\);\s*obstaculosLotes\.push\(\{ \.\.\.c, dono: id \}\);/);
    expect(src).toMatch(/escolherModoRotulos\(itens, \{ tudo: obstaculosLotes, nome: obstaculosLotes \}\)/);
  });

  it("caixa do nome: tamanho na letra do zoom (sem o encaixe, como era medido), com lote o topo 10 px abaixo do ponto", () => {
    const m = { w: 48, h: 24 };
    // zoom 15: letra 11 px → 11/12 do tamanho medido em 12 px
    expect(caixaDoNome({ x: 100, y: 200 }, m, 15, false)).toEqual({ x: 100 - 22, y: 200 - 11, w: 44, h: 22 });
    expect(caixaDoNome({ x: 100, y: 200 }, m, 15, true)).toEqual({ x: 100 - 22, y: 210, w: 44, h: 22 });
    expect(caixaDoNome({ x: 0, y: 0 }, m, 18, false)).toEqual({ x: -24, y: -12, w: 48, h: 24 });
  });
});

describe("N354-5 — revisão durante o zoom", () => {
  it("só pelos pastos na tela, no máximo a cada 120 ms, e publica só quando o nível muda; o moveend revê todos", async () => {
    const agora = { t: 1000 };
    vi.spyOn(performance, "now").mockImplementation(() => agora.t);
    const { map, r } = montar();
    renderer = r;
    // a1 grande na tela; o minúsculo bem longe, fora da tela
    const longe = quadrado("z", "Longe", 0, 5, 0.0002);
    r.syncLabels([A1, longe], true, null, true);
    // sem o minúsculo na conta (fora da tela): começa tudo pelo moveend? Não: o moveend conta todos → sigla
    await pronto();
    expect(niveis(map)).toEqual(["sigla"]);

    // durante o zoom só a1 conta (o minúsculo está fora da tela): volta a "tudo"
    const antes = map.publicacoes.filter((id) => id === NOMES_SOURCE_ID).length;
    disparar(map, "zoom");
    await pronto();
    expect(niveis(map)).toEqual(["tudo"]);
    expect(map.publicacoes.filter((id) => id === NOMES_SOURCE_ID).length).toBe(antes + 1);

    // 50 ms depois: nada (intervalo de 120 ms), mesmo que o nível mudasse
    map.zoom = 11;
    agora.t += 50;
    disparar(map, "zoom");
    await pronto();
    expect(niveis(map)).toEqual(["tudo"]);
    // passou o intervalo: revê e muda (a1 ficou pequeno)
    agora.t += 100;
    disparar(map, "zoom");
    await pronto();
    expect(niveis(map)).toEqual(["sigla"]);
    // mesmo nível na revisão seguinte: não publica de novo
    const n = map.publicacoes.filter((id) => id === NOMES_SOURCE_ID).length;
    agora.t += 200;
    disparar(map, "zoom");
    await pronto();
    expect(map.publicacoes.filter((id) => id === NOMES_SOURCE_ID).length).toBe(n);
  });

  it("a revisão não toca em elemento nenhum (D-PROD-347 sem DOM)", async () => {
    const { map, r } = montar();
    renderer = r;
    const getBCR = vi.spyOn(Element.prototype, "getBoundingClientRect");
    r.syncLabels([A1, A2], true, null, true);
    await pronto();
    disparar(map, "zoom");
    disparar(map, "moveend");
    await pronto();
    expect(getBCR).not.toHaveBeenCalled();
  });
});

describe("N354-6 — posição com e sem lote", () => {
  it("pasto com lote: o nome na camada de baixo do ícone (`comLote`) e o lote sobe (`comRotulo`); nomes desligados, o lote volta", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([LOTE("a1")], [A1, A2], true, [], vi.fn(), vi.fn(), true, false);
    const lote = () => map.data.get(LOTES_SOURCE_ID).features[0];
    expect(lote().properties.comRotulo).toBe(false);

    r.syncLabels([A1, A2], true, null, true);
    await pronto();
    expect(lote().properties.comRotulo).toBe(true);
    expect(porId(map, "a1").properties.comLote).toBe(true);
    expect(porId(map, "a2").properties.comLote).toBe(false);
    // o nome e o lote no mesmo ponto do pasto (D-PROD-127)
    expect(porId(map, "a1").geometry.coordinates).toEqual(lote().geometry.coordinates);

    // o lote sai do pasto: o nome volta a ser centrado no ponto
    await r.syncLotes([], [A1, A2], true, [], vi.fn(), vi.fn(), true, false);
    await pronto();
    expect(porId(map, "a1").properties.comLote).toBe(false);

    await r.syncLotes([LOTE("a1")], [A1, A2], true, [], vi.fn(), vi.fn(), true, false);
    r.syncLabels([A1, A2], false, null, true);
    await pronto();
    expect(lote().properties.comRotulo).toBe(false);
  });

  it("o par ícone + nome continua o de D-PROD-128: ícone 14 px acima do ponto, nome começando 10 px abaixo", () => {
    const icone = caixaDoLote({ x: 0, y: 0 }, true, { w: 44, h: 42 });
    expect(icone.y + icone.h / 2).toBe(-14);
    expect(caixaDoNome({ x: 0, y: 0 }, { w: 40, h: 26 }, 18, true).y).toBe(10);
  });
});

describe("N354-7 — troca de estilo, poda, densidade, letra e limpeza", () => {
  it("ensureLayers repõe camadas, imagens e dados; styleimagemissing repõe a imagem que faltar", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncLabels([A1, A2], true, null, true);
    await pronto();
    const chaves = feicoes(map).map((f) => f.properties.imagem).sort();
    const desenhos = desenhosNome();

    map.images.clear();
    map.layers.length = 0;
    map.data.delete(NOMES_SOURCE_ID);
    r.ensureLayers();
    expect(map.getLayer(NOMES_LAYER_ID)).toBeTruthy();
    expect(map.getLayer(NOMES_LOTE_LAYER_ID)).toBeTruthy();
    expect([...map.images.keys()].filter((k) => k.startsWith("mg-nome|")).sort()).toEqual(chaves);
    expect(feicoes(map)).toHaveLength(2);
    expect(desenhosNome()).toBe(desenhos); // reaproveita, não redesenha

    map.images.delete(chaves[0]);
    for (const h of map.handlers.filter((x) => x[0] === "styleimagemissing")) h[1]({ id: chaves[0] });
    expect(map.images.has(chaves[0])).toBe(true);
  });

  it("poda: o texto que saiu tira a imagem do mapa; o nível que não está na tela fica (trocar de nível não redesenha)", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncLabels([A1, A2], true, null, true);
    await pronto();
    const tudo = porId(map, "a1").properties.imagem;
    map.zoom = 11;
    disparar(map, "moveend");
    await pronto();
    expect(niveis(map)).toEqual(["sigla"]);
    // a imagem do "tudo" continua no mapa: o texto do pasto ainda é o mesmo
    expect(map.images.has(tudo)).toBe(true);
    const desenhos = desenhosNome();
    map.zoom = 15;
    disparar(map, "moveend");
    await pronto();
    expect(niveis(map)).toEqual(["tudo"]);
    expect(desenhosNome()).toBe(desenhos);

    // o pasto muda de nome: a imagem velha sai do mapa
    r.syncLabels([{ ...A1, nome: "Pasto Um" }, A2], true, null, true);
    await pronto();
    expect(map.removeImage).toHaveBeenCalledWith(tudo);
    expect(map.images.has(tudo)).toBe(false);
    expect(porId(map, "a1").properties.texto).toBe("Pasto Um\nha 12,50");
  });

  it("densidade da tela nova: as imagens são desenhadas de novo nela", async () => {
    const { map, r } = montar();
    renderer = r;
    r.syncLabels([A1], true, null, true);
    await pronto();
    const chave = porId(map, "a1").properties.imagem;
    const dprAntes = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 3, configurable: true });
    try {
      disparar(map, "resize");
      await pronto();
      expect(map.images.get(chave).opts).toEqual({ pixelRatio: 3 });
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: dprAntes, configurable: true });
    }
  });

  it("espera a letra Inter (700, 400 e 600) antes de medir e desenhar", async () => {
    let soltar;
    const carregou = new Promise((res) => { soltar = res; });
    const load = vi.fn(() => carregou);
    Object.defineProperty(document, "fonts", { value: { load }, configurable: true });
    try {
      const { map, r } = montar();
      renderer = r;
      r.syncLabels([A1], true, null, true);
      await pronto();
      expect(load.mock.calls.map((c) => c[0])).toEqual(['700 12px "Inter"', '400 11px "Inter"', '600 11px "Inter"']);
      expect(desenhosNome()).toBe(0);
      expect(feicoes(map)).toHaveLength(0);
      soltar([]);
      await pronto();
      await pronto();
      expect(feicoes(map)).toHaveLength(1);
      expect(desenhosNome()).toBe(1);
    } finally {
      delete (/** @type {any} */ (document)).fonts;
    }
  });

  it("clearAll esvazia a fonte e desliga o zoom; o que ainda chega não publica", async () => {
    const { map, r } = montar();
    r.syncLabels([A1], true, null, true);
    await pronto();
    expect(feicoes(map)).toHaveLength(1);
    r.syncLabels([A1, A2], true, () => "novo", true); // revisão pendente
    r.clearAll();
    await pronto();
    expect(feicoes(map)).toHaveLength(0);
    expect(map.handlers.some((h) => h[0] === "zoom")).toBe(false);
  });

  it("publicação pendente quando o mapa é refeito (clearAll + mapa novo) não escreve os nomes velhos no mapa novo", async () => {
    const mapa1 = mkMap();
    const ref = { current: mapa1 };
    const { result } = renderHook(() => useMapRenderer(/** @type {any} */ (ref)));
    const r = result.current;
    renderer = r;
    r.syncLabels([A1], true, null, true);
    await quadro(); // a revisão publicou; as imagens do A1 ainda estão sendo desenhadas
    r.clearAll();
    const mapa2 = mkMap();
    ref.current = mapa2;
    /** @type {string[]} */
    const escritos = [];
    const set = mapa2.data.set.bind(mapa2.data);
    mapa2.data.set = (id, d) => {
      if (id === NOMES_SOURCE_ID) escritos.push(...(d?.features || []).map((f) => f.properties.id));
      return set(id, d);
    };
    r.syncLabels([A2], true, null, true);
    await pronto();
    expect(escritos).not.toContain("a1");
    expect(feicoes(mapa2).map((f) => f.properties.id)).toEqual(["a2"]);
  });

  it("publicação pendente com o texto já trocado põe no mapa as imagens que ela usa (e não as poda)", async () => {
    const { map, r } = montar();
    renderer = r;
    map.zoom = 11;
    r.syncLabels([A1, A2], true, () => "velho", true);
    await pronto();
    expect(niveis(map)).toEqual(["sigla"]);
    // a cada publicação e a cada poda: todo nome publicado tem a sua imagem no mapa
    /** @type {string[]} */
    const faltando = [];
    const conferir = () => {
      for (const f of feicoes(map)) if (!map.images.has(f.properties.imagem)) faltando.push(f.properties.imagem);
    };
    const set = map.data.set.bind(map.data);
    map.data.set = (id, d) => {
      const ret = set(id, d);
      if (id === NOMES_SOURCE_ID) conferir();
      return ret;
    };
    const remover = map.removeImage.getMockImplementation();
    map.removeImage.mockImplementation((id) => {
      const ret = remover(id);
      conferir();
      return ret;
    });
    map.zoom = 15;
    disparar(map, "moveend");
    await quadro(); // publicação do "tudo" esperando as imagens
    r.syncLabels([A1, A2], true, () => "novo", true); // o texto extra muda antes dela terminar
    await pronto();
    expect(faltando).toEqual([]);
    expect(porId(map, "a1").properties.texto).toBe("Pasto 1\nha 12,50\nnovo");
  });
});

/**
 * D-PROD-349 (mapa leve, etapa 2) — lotes desenhados pelo próprio mapa.
 *
 * O ícone do lote deixou de ser um marcador HTML: é um ponto na fonte GeoJSON `mg-lotes` e uma camada `symbol`
 * pinta a imagem (a figura do motor com a contagem escrita dentro, num canvas). MapLibre e canvas falsos.
 *
 *  L348-1. Imagem por desenho + contagem: mesma chave = mesma imagem, sem desenhar de novo nem registrar de novo.
 *  L348-2. Contagem com milhar, cinza #6b7280, 9,5 px, negrito, na faixa CONTAGEM_TOPO_PCT, com halo branco.
 *  L348-3. Posição: [0,-26] sem nome embaixo, [0,-14] com nome (`comRotulo` na fonte); nomes mantêm PAR_LOTE.nome.
 *  L348-4. Clique no lote abre os lotes e não a área por baixo; `hitArea` vê o lote.
 *  L348-5. Arrastar chama onDragLotes como o dragend antigo; clique curto não; sem permissão o mapa desliza.
 *  L348-6. Piscar só com alerta (e com identificador): a camada do identificador alterna a opacidade.
 *  L348-7. Troca de estilo (satélite ↔ mapa): as imagens voltam (ensureLayers e styleimagemissing).
 *  L348-8. Identificador: bolinha com a sigla, MISTO metade preto/metade branco.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { CONTAGEM_TOPO_PCT, LARGURA_MARCADOR_PX, resolverFiguraDoPasto, urlMarcadorLote } from "@/assets/icones/lotes";
import { FONTE_CONTAGEM_PX } from "@/lib/maplibre/contagemLote.js";
import { centroideArea } from "@/lib/maplibre/mapaGeralRender.js";
import {
  COR_IDENT_MISTO,
  LOTES_IDENT_LAYER_ID,
  LOTES_LAYER_ID,
  LOTES_SOURCE_ID,
  OFFSET_LOTE_COM_NOME_PX,
  OFFSET_LOTE_PX,
  OPACIDADE_PISCAR,
  PISCAR_MS,
  caixaDoLote,
  camadasLotes,
  chaveImagemIdent,
  chaveImagemLote,
  identificadoresDoLote,
  limparCacheImagensLotes,
} from "@/lib/maplibre/lotesNoMapa.js";
import useMapRenderer from "@/components/mapa/useMapRenderer.jsx";
import { esperarImagens, instalarCanvasFalso, svgDaUrl } from "./helpers/canvasLotesFalso.js";

const marcadores = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock("@/lib/maplibre/lifecycle.js", async (orig) => {
  const real = await orig();
  class Marker {
    constructor(opts) {
      this.el = opts.element;
      this.opts = opts;
      this.offset = opts.offset;
      this.removed = false;
      marcadores.push(this);
    }
    setLngLat(ll) {
      this.ll = Array.isArray(ll) ? { lng: ll[0], lat: ll[1] } : ll;
      return this;
    }
    getLngLat() {
      return this.ll;
    }
    addTo(map) {
      map.container.appendChild(this.el);
      return this;
    }
    getElement() {
      return this.el;
    }
    setOffset(o) {
      this.offset = o;
      return this;
    }
    on() {
      return this;
    }
    remove() {
      this.removed = true;
      this.el.remove();
    }
  }
  class Popup {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
    remove() {}
  }
  return { ...real, maplibregl: { Marker, Popup, LngLatBounds: class {} }, setSourceData: (map, id, data) => map?.data?.set(id, data) };
});

/** Mapa falso: fontes, camadas, imagens, eventos (com e sem camada) e projeção linear. */
const mkMap = () => {
  const sources = new Map();
  const layers = [];
  const images = new Map();
  const handlers = [];
  const canvas = document.createElement("canvas");
  const map = {
    container: document.createElement("div"),
    data: new Map(),
    handlers,
    images,
    layers,
    /** o que está "desenhado" sob o ponto, por camada */
    sobPonto: /** @type {Record<string, any[]>} */ ({}),
    getSource: (id) => sources.get(id),
    addSource: (id, s) => sources.set(id, s),
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (l) => layers.push(l),
    addImage: vi.fn((id, img, opts) => {
      if (images.has(id)) throw new Error(`imagem ${id} já existe`);
      images.set(id, { img, opts });
    }),
    hasImage: (id) => images.has(id),
    setPaintProperty: vi.fn(),
    setFeatureState: vi.fn(),
    on: (...a) => handlers.push(a),
    off: (...a) => {
      const i = handlers.findIndex((h) => h[0] === a[0] && h[h.length - 1] === a[a.length - 1]);
      if (i >= 0) handlers.splice(i, 1);
    },
    getZoom: () => 15,
    project: (ll) => {
      const [lng, lat] = Array.isArray(ll) ? ll : [ll.lng, ll.lat];
      return { x: lng * 10000, y: -lat * 10000 };
    },
    unproject: ([x, y]) => ({ lng: x / 10000, lat: -y / 10000 }),
    getCanvas: () => canvas,
    queryRenderedFeatures: (_p, opts) => (opts?.layers || []).flatMap((l) => map.sobPonto[l] || []),
  };
  return map;
};

/** Dispara os handlers de um evento (com camada: `on(ev, layer, fn)`; sem: `on(ev, fn)`). */
const disparar = (map, ev, camada, e) => {
  for (const h of [...map.handlers]) {
    if (h[0] !== ev) continue;
    if (camada ? h[1] === camada : typeof h[1] === "function") h[h.length - 1](e);
  }
};

const montar = () => {
  const map = mkMap();
  const { result } = renderHook(() => useMapRenderer(/** @type {any} */ ({ current: map })));
  return { map, r: result.current };
};

const AREA = {
  id: "a1",
  nome: "Pasto 1",
  tamanho_hectares: 12.5,
  coordenadas: { coords: [[0, 0], [0, 0.01], [-0.01, 0.01], [-0.01, 0]], cor: "#0d67ad" },
};
const AREA2 = { ...AREA, id: "a2", nome: "Pasto 2", coordenadas: { coords: [[0, 0.02], [0, 0.03], [-0.01, 0.03], [-0.01, 0.02]] } };
const CATEGORIAS = [
  { id: "cat-touro", empresa_id: "emp-1", nome: "TOURO", sexo: "Macho", idade_minima_meses: 37, idade_maxima_meses: null },
  { id: "cat-vaca", empresa_id: "emp-1", nome: "VACA", sexo: "Fêmea", idade_minima_meses: 37, idade_maxima_meses: null },
];
const pos = (id, categoria_manejo_id, quantidade_cabecas, extra = {}) => ({ id, area_atual_id: "a1", categoria_manejo_id, quantidade_cabecas, ...extra });

const fonte = (map) => map.data.get(LOTES_SOURCE_ID);
const feicoes = (map) => fonte(map)?.features || [];
const quadro = () => new Promise((res) => requestAnimationFrame(() => res(undefined)));

let canvas;
let renderer = null;
beforeEach(() => {
  marcadores.length = 0;
  limparCacheImagensLotes();
  canvas = instalarCanvasFalso();
  renderer = null;
});
afterEach(() => {
  renderer?.clearAll();
  vi.useRealTimers();
});

describe("L348-1 — imagem por desenho + contagem", () => {
  it("o lote vai para a fonte do mapa com a imagem da figura e a contagem; a camada é symbol", async () => {
    const { map, r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-touro", 30), pos("p2", "cat-touro", 12)];
    await r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);

    // nenhum marcador HTML de lote
    expect(marcadores).toHaveLength(0);
    expect(map.container.querySelector(".mg-lote-count")).toBeNull();

    const icone = resolverFiguraDoPasto(lotes, CATEGORIAS);
    const [f] = feicoes(map);
    expect(feicoes(map)).toHaveLength(1);
    const centro = centroideArea(AREA);
    expect(f.geometry.coordinates).toEqual([centro.lng, centro.lat]);
    expect(f.properties).toMatchObject({ areaId: "a1", cabecas: 42, contagem: "42", desenho: icone.chave, imagem: chaveImagemLote(icone.chave, 42), alerta: false, piscar: false, comRotulo: false, nome: "Pasto 1" });
    expect(f.properties.ident).toBeUndefined();

    // imagem registrada no mapa, no devicePixelRatio, desenhada a partir da data URL do motor
    expect(map.addImage).toHaveBeenCalledTimes(1);
    const [chave, pixels, opts] = map.addImage.mock.calls[0];
    expect(chave).toBe(f.properties.imagem);
    expect(opts).toEqual({ pixelRatio: window.devicePixelRatio || 1 });
    const svg = svgDaUrl(urlMarcadorLote(icone));
    const altura = Math.round((LARGURA_MARCADOR_PX * Number(svg.getAttribute("height"))) / Number(svg.getAttribute("width")));
    expect(pixels.width).toBe(LARGURA_MARCADOR_PX);
    expect(pixels.height).toBe(altura);
    expect(canvas.figurasCarregadas).toEqual([urlMarcadorLote(icone)]);
    const desenho = canvas.chamadas.find((c) => c.nome === "drawImage");
    expect(desenho.args.slice(1)).toEqual([0, 0, LARGURA_MARCADOR_PX, altura]);

    // camadas: ícone e identificador, nunca somem por colisão, acima das áreas
    const ids = map.layers.map((l) => l.id);
    expect(ids.indexOf(LOTES_LAYER_ID)).toBeGreaterThan(ids.indexOf("mg-areas-fill"));
    expect(ids.indexOf(LOTES_LAYER_ID)).toBeGreaterThan(ids.indexOf("mg-linhas"));
    expect(ids.indexOf(LOTES_IDENT_LAYER_ID)).toBeGreaterThan(ids.indexOf(LOTES_LAYER_ID));
    const camada = map.layers.find((l) => l.id === LOTES_LAYER_ID);
    expect(camada).toMatchObject({ type: "symbol", source: LOTES_SOURCE_ID });
    expect(camada.layout).toMatchObject({ "icon-image": ["get", "imagem"], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-anchor": "center" });
    expect(camada.layout["symbol-sort-key"]).toEqual(["case", ["boolean", ["get", "alerta"], false], 1, 0]);
    expect(JSON.stringify(camada)).not.toMatch(/text-field/);
  });

  it("mesma chave = mesma imagem: refetch e outro pasto igual não desenham nem registram de novo; contagem nova sim", async () => {
    const { map, r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-vaca", 15)];
    await r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(canvas.desenhos()).toBe(1);
    const dadosAntes = fonte(map);

    // refetch: listas novas, mesmo conteúdo
    await r.syncLotes(lotes.map((p) => ({ ...p })), [AREA], true, CATEGORIAS.map((c) => ({ ...c })), vi.fn(), vi.fn(), true, false);
    expect(canvas.desenhos()).toBe(1);
    expect(map.addImage).toHaveBeenCalledTimes(1);
    expect(fonte(map)).toBe(dadosAntes); // nada mudou: nem setData

    // outro pasto com o mesmo desenho e a mesma contagem usa a MESMA imagem
    const dois = [...lotes, { ...pos("p9", "cat-vaca", 15), area_atual_id: "a2" }];
    await r.syncLotes(dois, [AREA, AREA2], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(feicoes(map)).toHaveLength(2);
    expect(new Set(feicoes(map).map((f) => f.properties.imagem)).size).toBe(1);
    expect(canvas.desenhos()).toBe(1);
    expect(map.addImage).toHaveBeenCalledTimes(1);

    // a contagem muda: imagem nova (a figura não é recarregada)
    await r.syncLotes([pos("p1", "cat-vaca", 16)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(canvas.desenhos()).toBe(2);
    expect(feicoes(map)[0].properties.contagem).toBe("16");
    expect(feicoes(map)[0].properties.desenho).toBe(resolverFiguraDoPasto(lotes, CATEGORIAS).chave);
    expect(canvas.figurasCarregadas).toHaveLength(1);
  });

  it("chega imagem atrasada de uma chamada antiga: não publica por cima da mais nova", async () => {
    const { map, r } = montar();
    renderer = r;
    const p1 = r.syncLotes([pos("p1", "cat-vaca", 15)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const p2 = r.syncLotes([pos("p1", "cat-vaca", 7)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    await Promise.all([p1, p2]);
    expect(feicoes(map).map((f) => f.properties.contagem)).toEqual(["7"]);
  });

  it("filtro desliga os lotes: a fonte fica vazia", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([pos("p1", "cat-vaca", 15)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(feicoes(map)).toHaveLength(1);
    await r.syncLotes([pos("p1", "cat-vaca", 15)], [AREA], false, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(feicoes(map)).toHaveLength(0);
  });
});

describe("L348-2 — a contagem desenhada na imagem", () => {
  it("milhar com ponto, cinza, 9,5 px, negrito, centrada na faixa da contagem, com halo branco", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([pos("p1", "cat-touro", 5000)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [f] = feicoes(map);
    expect(f.properties.contagem).toBe("5.000");
    expect(f.properties.imagem).toBe(chaveImagemLote(f.properties.desenho, 5000));
    expect(chaveImagemLote("x", 12500)).toBe("mg-lote|x|12.500");

    const textos = canvas.chamadas.filter((c) => c.nome === "fillText" && c.args[0] === "5.000");
    expect(textos).toHaveLength(3); // duas camadas de halo + o texto
    const [halo3, halo2, texto] = textos;
    expect(texto.estado.fillStyle).toBe("#6b7280");
    expect(texto.estado.font).toBe(`700 ${FONTE_CONTAGEM_PX}px Inter, Arial, sans-serif`);
    expect(texto.estado.textAlign).toBe("center");
    expect(texto.estado.shadowBlur).toBe(0);
    const altura = map.addImage.mock.calls[0][1].height;
    expect(texto.args[1]).toBe(LARGURA_MARCADOR_PX / 2);
    expect(texto.args[2]).toBeCloseTo((altura * CONTAGEM_TOPO_PCT) / 100, 5);
    // halo = text-shadow 0 0 3px rgba(255,255,255,.8), 0 0 2px rgba(255,255,255,.95): só a sombra cai na imagem
    expect(halo3.estado).toMatchObject({ shadowColor: "rgba(255,255,255,.8)", shadowBlur: 3 });
    expect(halo2.estado).toMatchObject({ shadowColor: "rgba(255,255,255,.95)", shadowBlur: 2 });
    for (const h of [halo3, halo2]) expect(h.args[1] + h.estado.shadowOffsetX).toBe(texto.args[1]);
    expect(readFileSync("src/lib/maplibre/lotesNoMapa.js", "utf8")).toMatch(/formatarContagem/);
  });
});

describe("L348-3 — posição do ícone com e sem nome embaixo", () => {
  it("icon-offset: [0,-26] sozinho, [0,-14] com nome; identificador 22 px à direita e 24 px acima do centro", () => {
    expect(OFFSET_LOTE_PX).toEqual([0, -26]);
    expect(OFFSET_LOTE_COM_NOME_PX).toEqual([0, -14]);
    const [lote, ident] = camadasLotes();
    expect(lote.layout["icon-offset"]).toEqual(["case", ["boolean", ["get", "comRotulo"], false], ["literal", [0, -14]], ["literal", [0, -26]]]);
    expect(ident.layout["icon-offset"]).toEqual(["case", ["boolean", ["get", "comRotulo"], false], ["literal", [22, -38]], ["literal", [22, -50]]]);
    expect(ident.filter).toEqual(["has", "ident"]);
    expect(caixaDoLote({ x: 100, y: 200 }, false, { w: 44, h: 42 })).toEqual({ x: 78, y: 153, w: 44, h: 42 });
    expect(caixaDoLote({ x: 100, y: 200 }, true, { w: 44, h: 42 })).toEqual({ x: 78, y: 165, w: 44, h: 42 });
  });

  it("com o nome do pasto ligado o lote vai para cima do nome; desligado, volta; o nome continua em PAR_LOTE.nome", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([pos("p1", "cat-touro", 3)], [AREA, AREA2], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(feicoes(map)[0].properties.comRotulo).toBe(false);

    r.syncLabels([AREA, AREA2], true, null, true);
    await quadro();
    await quadro();
    expect(feicoes(map)[0].properties.comRotulo).toBe(true);
    const nome = (id) => marcadores.find((m) => m.el.dataset?.area === id);
    expect(nome("a1").offset).toEqual([0, 10]); // com lote: o nome embaixo do ícone
    expect(nome("a2").offset).toEqual([0, 0]); // sem lote: o nome centrado no ponto

    r.syncLabels([AREA, AREA2], false, null, true);
    await quadro();
    expect(feicoes(map)[0].properties.comRotulo).toBe(false);
  });

  it("o ícone do lote é obstáculo dos nomes por caixa calculada (sem medir elemento de lote)", () => {
    const src = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    const corpo = src.slice(src.indexOf("const arrumarRotulos = (opcoes) =>"), src.indexOf("const escalarNome ="));
    expect(corpo).toMatch(/caixaDoLote\(map\.project\(lote\.item\.lngLat\), labelsRef\.current\.has\(id\), lote\.tamanho\)/);
    expect(corpo).toMatch(/dono: id/);
    expect(corpo).toMatch(/return \{ rotulos, obstaculos: obstaculosLotes \};/);
    expect(corpo).not.toMatch(/lote_area_/);
  });
});

describe("L348-4 — clique", () => {
  it("clique no lote abre os lotes do pasto e NÃO a área por baixo; hitArea enxerga o lote", async () => {
    const { map, r } = montar();
    renderer = r;
    const onArea = vi.fn();
    const onLotes = vi.fn();
    r.syncAreas([AREA], true, onArea, vi.fn(), null);
    const lotes = [pos("p1", "cat-touro", 3)];
    await r.syncLotes(lotes, [AREA], true, CATEGORIAS, onLotes, vi.fn(), true, false);

    const feature = { properties: { areaId: "a1" } };
    map.sobPonto[LOTES_LAYER_ID] = [feature];
    const e = { point: { x: 1, y: 1 }, lngLat: { lat: 0, lng: 0 }, features: [feature] };
    disparar(map, "click", LOTES_LAYER_ID, e);
    disparar(map, "click", "mg-areas-fill", { ...e, features: [{ properties: { id: "a1" } }] });
    expect(onLotes).toHaveBeenCalledWith(lotes);
    expect(onArea).not.toHaveBeenCalled();
    expect(r.hitArea({ x: 1, y: 1 })).toBe(true);

    // fora do lote, a área abre normalmente
    map.sobPonto[LOTES_LAYER_ID] = [];
    disparar(map, "click", "mg-areas-fill", { ...e, features: [{ properties: { id: "a1" } }] });
    expect(onArea).toHaveBeenCalledTimes(1);
    expect(onLotes).toHaveBeenCalledTimes(1);
  });

  it("cursor de mão e o nome do pasto no título ao passar sobre o lote", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([pos("p1", "cat-touro", 3)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const c = map.getCanvas();
    disparar(map, "mousemove", LOTES_LAYER_ID, { features: [{ properties: { areaId: "a1" } }] });
    expect(c.style.cursor).toBe("pointer");
    expect(c.title).toBe("Pasto 1");
    disparar(map, "mouseleave", LOTES_LAYER_ID, {});
    expect(c.style.cursor).toBe("");
    expect(c.title).toBe("");
  });
});

describe("L348-5 — arrastar para mover", () => {
  const preparar = async (canDrag = true) => {
    const { map, r } = montar();
    renderer = r;
    const onLotes = vi.fn();
    const onDrag = vi.fn();
    const lotes = [pos("p1", "cat-touro", 3, { identificador_cor: "#dc2626", identificador_sigla: "LA" })];
    await r.syncLotes(lotes, [AREA], true, CATEGORIAS, onLotes, onDrag, canDrag, false);
    const feature = { properties: { areaId: "a1" } };
    return { map, r, onLotes, onDrag, lotes, feature };
  };

  it("pressionar, andar e soltar: cópia segue o dedo, o ícone some e volta; onDragLotes recebe o ponto solto", async () => {
    const { map, onLotes, onDrag, lotes, feature } = await preparar();
    const centro = centroideArea(AREA);
    const p0 = map.project([centro.lng, centro.lat]);
    const preventDefault = vi.fn();
    disparar(map, "mousedown", LOTES_LAYER_ID, { type: "mousedown", point: { x: p0.x, y: p0.y }, features: [feature], preventDefault });
    expect(preventDefault).toHaveBeenCalled(); // o mapa não desliza

    disparar(map, "mousemove", null, { point: { x: p0.x + 30, y: p0.y - 10 } });
    const copia = marcadores.find((m) => m.el.className === "mg-lote-arrastando");
    expect(copia).toBeTruthy();
    expect(copia.opts).toMatchObject({ anchor: "center", offset: OFFSET_LOTE_PX });
    expect(copia.el.querySelectorAll("img")).toHaveLength(2); // ícone + identificador
    expect(map.setFeatureState).toHaveBeenCalledWith({ source: LOTES_SOURCE_ID, id: "a1" }, { arrastando: true });

    disparar(map, "mousemove", null, { point: { x: p0.x + 50, y: p0.y + 20 } });
    const fim = map.unproject([p0.x + 50, p0.y + 20]);
    expect(copia.ll).toEqual({ lng: fim.lng, lat: fim.lat });

    disparar(map, "mouseup", null, { point: { x: p0.x + 50, y: p0.y + 20 } });
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledWith({ lat: fim.lat, lng: fim.lng }, lotes, "a1", [AREA]);
    expect(copia.removed).toBe(true);
    expect(map.setFeatureState).toHaveBeenLastCalledWith({ source: LOTES_SOURCE_ID, id: "a1" }, { arrastando: false });
    // a fonte não mudou: o ícone volta ao lugar até o movimento ser confirmado
    expect(feicoes(map)[0].geometry.coordinates).toEqual([centro.lng, centro.lat]);
    // o clique que vem logo depois do arrasto não abre os lotes
    disparar(map, "click", LOTES_LAYER_ID, { features: [feature] });
    expect(onLotes).not.toHaveBeenCalled();
    // sem handlers de arrasto sobrando
    expect(map.handlers.filter((h) => typeof h[1] === "function" && ["mousemove", "mouseup"].includes(h[0]))).toHaveLength(0);
  });

  it("movimento menor que 4 px é clique: não arrasta, não chama onDragLotes", async () => {
    const { map, onLotes, onDrag, lotes, feature } = await preparar();
    disparar(map, "mousedown", LOTES_LAYER_ID, { type: "mousedown", point: { x: 10, y: 10 }, features: [feature], preventDefault: vi.fn() });
    disparar(map, "mousemove", null, { point: { x: 12, y: 12 } });
    disparar(map, "mouseup", null, { point: { x: 12, y: 12 } });
    expect(onDrag).not.toHaveBeenCalled();
    expect(marcadores.find((m) => m.el.className === "mg-lote-arrastando")).toBeUndefined();
    disparar(map, "click", LOTES_LAYER_ID, { features: [feature] });
    expect(onLotes).toHaveBeenCalledWith(lotes);
  });

  it("toque: um dedo arrasta; dois dedos (pinça) não", async () => {
    const { map, onDrag, feature } = await preparar();
    const pd = vi.fn();
    disparar(map, "touchstart", LOTES_LAYER_ID, { type: "touchstart", point: { x: 0, y: 0 }, points: [{}, {}], features: [feature], preventDefault: pd });
    expect(pd).not.toHaveBeenCalled();
    disparar(map, "touchstart", LOTES_LAYER_ID, { type: "touchstart", point: { x: 0, y: 0 }, points: [{}], features: [feature], preventDefault: pd });
    expect(pd).toHaveBeenCalledTimes(1);
    disparar(map, "touchmove", null, { point: { x: 40, y: 0 }, points: [{}] });
    disparar(map, "touchend", null, { point: { x: 40, y: 0 } });
    expect(onDrag).toHaveBeenCalledTimes(1);
  });

  it("sem permissão de mover: o mapa desliza normalmente e nada é arrastado", async () => {
    const { map, onDrag, feature } = await preparar(false);
    const pd = vi.fn();
    disparar(map, "mousedown", LOTES_LAYER_ID, { type: "mousedown", point: { x: 0, y: 0 }, features: [feature], preventDefault: pd });
    disparar(map, "mousemove", null, { point: { x: 40, y: 0 } });
    disparar(map, "mouseup", null, { point: { x: 40, y: 0 } });
    expect(pd).not.toHaveBeenCalled();
    expect(onDrag).not.toHaveBeenCalled();
  });

  it("o toque longo do mapa (lançar tarefa) não é bloqueado: o arrasto não para o evento do DOM", () => {
    const src = readFileSync("src/lib/maplibre/lotesNoMapa.js", "utf8");
    expect(src).not.toMatch(/originalEvent\.(preventDefault|stopPropagation)/);
    expect(readFileSync("src/pages/MapaGeral.jsx", "utf8")).toMatch(/mapElement\.addEventListener\('touchstart', handlePressStart, \{ passive: true \}\);/);
  });
});

describe("L348-6 — piscar do alerta", () => {
  const comAlerta = (extra = {}) => [pos("p1", "cat-touro", 3, { identificador_cor: "#dc2626", identificador_sigla: "LA", alertas: [{ id: "x" }], ...extra })];
  const opacidades = (map) => map.setPaintProperty.mock.calls.filter((c) => c[0] === LOTES_IDENT_LAYER_ID && c[1] === "icon-opacity").map((c) => c[2]);

  it("com alerta e piscar ligado: o identificador alterna 1 ↔ 0,2 a cada 550 ms; para ao tirar o alerta", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes(comAlerta(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    const [f] = feicoes(map);
    expect(f.properties).toMatchObject({ alerta: true, piscar: true });
    expect(opacidades(map)).toHaveLength(0);
    vi.advanceTimersByTime(PISCAR_MS);
    expect(JSON.stringify(opacidades(map).at(-1))).toContain(String(OPACIDADE_PISCAR));
    vi.advanceTimersByTime(PISCAR_MS);
    expect(JSON.stringify(opacidades(map).at(-1))).not.toContain(String(OPACIDADE_PISCAR));
    vi.advanceTimersByTime(PISCAR_MS);
    // tira o alerta no meio do "apagado": volta a 1 e para
    await r.syncLotes(comAlerta({ alertas: [] }), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    expect(JSON.stringify(opacidades(map).at(-1))).not.toContain(String(OPACIDADE_PISCAR));
    const n = opacidades(map).length;
    vi.advanceTimersByTime(PISCAR_MS * 4);
    expect(opacidades(map)).toHaveLength(n);
  });

  it("sem alerta, ou com o piscar desligado, ou sem identificador: nada pisca", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes(comAlerta({ alertas: [] }), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    await r.syncLotes(comAlerta(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(feicoes(map)[0].properties).toMatchObject({ alerta: true, piscar: false });
    await r.syncLotes([pos("p1", "cat-touro", 3, { alertas: [{ id: "x" }] })], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    expect(feicoes(map)[0].properties).toMatchObject({ alerta: true, piscar: false });
    vi.advanceTimersByTime(PISCAR_MS * 4);
    expect(opacidades(map)).toHaveLength(0);
  });

  it("a opacidade pisca só os que têm `piscar` e some no arrasto; clearAll para o piscar", async () => {
    const [, ident] = camadasLotes();
    expect(ident.paint["icon-opacity"]).toEqual(["case", ["boolean", ["feature-state", "arrastando"], false], 0, ["boolean", ["get", "piscar"], false], 1, 1]);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { map, r } = montar();
    await r.syncLotes(comAlerta(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    r.clearAll();
    const n = opacidades(map).length;
    vi.advanceTimersByTime(PISCAR_MS * 4);
    expect(opacidades(map)).toHaveLength(n);
    expect(feicoes(map)).toHaveLength(0);
  });
});

describe("L348-7 — troca de estilo (satélite ↔ mapa)", () => {
  it("ensureLayers recria camadas, imagens e dados; styleimagemissing repõe a imagem que faltar", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([pos("p1", "cat-touro", 3, { identificador_cor: "#dc2626", identificador_sigla: "LA" })], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [f] = feicoes(map);
    expect([...map.images.keys()].sort()).toEqual([f.properties.ident, f.properties.imagem].sort());

    // setStyle: estilo novo sem nada do Mapa Geral
    map.images.clear();
    map.layers.length = 0;
    map.data.delete(LOTES_SOURCE_ID);
    const desenhos = canvas.desenhos();
    r.ensureLayers();
    expect(map.getLayer(LOTES_LAYER_ID)).toBeTruthy();
    expect([...map.images.keys()].sort()).toEqual([f.properties.ident, f.properties.imagem].sort());
    expect(feicoes(map)).toHaveLength(1);
    expect(canvas.desenhos()).toBe(desenhos); // reaproveita, não redesenha

    map.images.delete(f.properties.imagem);
    disparar(map, "styleimagemissing", null, { id: f.properties.imagem });
    expect(map.images.has(f.properties.imagem)).toBe(true);
    disparar(map, "styleimagemissing", null, { id: "outra-coisa" });
    expect(map.images.has("outra-coisa")).toBe(false);
  });
});

describe("L348-8 — identificador", () => {
  it("um, nenhum ou MISTO (mesmo comportamento do marcador antigo)", () => {
    expect(identificadoresDoLote([{ quantidade_cabecas: 1 }])).toEqual([]);
    expect(identificadoresDoLote([{ identificador_cor: "#f00", identificador_sigla: "AB" }, { quantidade_cabecas: 2 }])).toEqual([{ cor: "#f00", sigla: "AB", nome: "AB" }]);
    expect(identificadoresDoLote([{ identificador_nome: "Lote X" }])).toEqual([{ cor: "#64748b", sigla: "Lote X", nome: "Lote X" }]);
    expect(identificadoresDoLote([{ identificador_cor: "#f00", identificador_sigla: "A" }, { identificador_cor: "#00f", identificador_sigla: "B" }])).toEqual([{ cor: COR_IDENT_MISTO, nome: "MISTO", sigla: "" }]);
    expect(chaveImagemIdent({ cor: "#f00", sigla: "ABC", nome: "" })).toBe("mg-lote-ident|#f00|AB");
    expect(chaveImagemIdent(null)).toBeNull();
  });

  it("bolinha de 13 px com borda branca, sombra e a sigla (2 letras) branca de 6 px; MISTO metade preto, metade branco", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([pos("p1", "cat-touro", 3, { identificador_cor: "#dc2626", identificador_sigla: "LAX" })], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [f] = feicoes(map);
    expect(f.properties.ident).toBe("mg-lote-ident|#dc2626|LA");
    const sigla = canvas.chamadas.find((c) => c.nome === "fillText" && c.args[0] === "LA");
    expect(sigla.estado).toMatchObject({ fillStyle: "#ffffff", font: "700 6px Inter, Arial, sans-serif", textAlign: "center" });
    const arcos = canvas.chamadas.filter((c) => c.nome === "arc" && c.largura === 21);
    expect(arcos.map((a) => a.args[2])).toEqual(expect.arrayContaining([6.5, 6]));
    const sombra = canvas.chamadas.find((c) => c.nome === "fill" && c.largura === 21);
    expect(sombra.estado).toMatchObject({ shadowColor: "rgba(0,0,0,.35)", shadowBlur: 3, shadowOffsetY: 1 });
    const fundo = canvas.chamadas.find((c) => c.nome === "fillRect" && c.largura === 21);
    expect(fundo.estado.fillStyle).toBe("#dc2626");
    const borda = canvas.chamadas.find((c) => c.nome === "stroke" && c.largura === 21);
    expect(borda.estado).toMatchObject({ strokeStyle: "#ffffff", lineWidth: 1 });

    canvas.chamadas.length = 0;
    await r.syncLotes(
      [pos("p1", "cat-touro", 3, { identificador_cor: "#dc2626", identificador_sigla: "A" }), pos("p2", "cat-touro", 3, { identificador_cor: "#2563eb", identificador_sigla: "B" })],
      [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false,
    );
    expect(feicoes(map)[0].properties.ident).toBe(chaveImagemIdent({ cor: COR_IDENT_MISTO, sigla: "", nome: "MISTO" }));
    const metades = canvas.chamadas.filter((c) => c.nome === "fillRect");
    expect(metades.map((c) => c.estado.fillStyle)).toEqual(["#000000", "#ffffff"]);
    expect(metades[0].args[0]).toBeLessThan(metades[1].args[0]); // preto à esquerda
    expect(canvas.textos()).not.toContain("");
  });
});

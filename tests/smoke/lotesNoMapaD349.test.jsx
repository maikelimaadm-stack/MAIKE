/**
 * D-PROD-349 (mapa leve, etapa 2) — lotes desenhados pelo próprio mapa.
 *
 * O ícone do lote deixou de ser um marcador HTML: é um ponto na fonte GeoJSON `mg-lotes` e uma camada `symbol`
 * pinta a imagem (a figura do motor com a contagem escrita dentro, num canvas). MapLibre e canvas falsos.
 *
 *  L349-1. Imagem por desenho + contagem: mesma chave = mesma imagem, sem desenhar de novo nem registrar de novo.
 *  L349-2. Contagem com milhar, cinza #6b7280, 9,5 px, negrito, na faixa CONTAGEM_TOPO_PCT, com halo branco.
 *  L349-3. Posição: [0,-26] sem nome embaixo, [0,-14] com nome (`comRotulo` na fonte); nomes mantêm PAR_LOTE.nome.
 *  L349-4. Clique no lote abre os lotes e não a área por baixo; `hitArea` vê o lote.
 *  L349-5. Arrastar chama onDragLotes como o dragend antigo; clique curto não; sem permissão o mapa desliza.
 *  L349-6. Piscar só com alerta (e com identificador): estado `piscaApagado` só nesses lotes; a pintura da
 *          camada não muda (nada de setPaintProperty, que refaria a fonte no worker).
 *  L349-7. Troca de estilo (satélite ↔ mapa): as imagens voltam (ensureLayers e styleimagemissing).
 *  L349-8. Identificador: bolinha com a sigla, MISTO metade preto/metade branco.
 *  L349-9. Revisão: arrasto não fica preso com o botão solto fora do mapa; imagem que falha usa a reserva e é
 *          tentada de novo; imagens sem uso saem do mapa e do cache; densidade da tela nova troca as imagens;
 *          toque longo não começa em cima do lote e o clique que encerra um toque longo não abre os lotes.
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
  IMAGEM_RESERVA,
  OPACIDADE_IDENT,
  OPACIDADE_PISCAR,
  PISCAR_MS,
  caixaDoLote,
  camadasLotes,
  chaveImagemIdent,
  chaveImagemLote,
  identificadoresDoLote,
  limparCacheImagensLotes,
  MAX_TENTATIVAS_IMAGEM,
} from "@/lib/maplibre/lotesNoMapa.js";
import useMapRenderer from "@/components/mapa/useMapRenderer.jsx";
import { acaoDoCliqueNoLote, deveComecarToqueLongo } from "@/domain/mapa/cliqueArea";
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
    removeImage: vi.fn((id) => images.delete(id)),
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
    queryRenderedFeatures: (p, opts) => {
      // como o MapLibre: só [x, y] (ou Point) é ponto; um objeto comum seria lido como "opções" (tela inteira)
      if (!Array.isArray(p)) throw new Error("ponto deve ser [x, y]");
      return (opts?.layers || []).flatMap((l) => map.sobPonto[l] || []);
    },
  };
  return map;
};

/** `addImage` das imagens de lote (sem a reserva). */
const loteAdds = (map) => map.addImage.mock.calls.filter((c) => c[0] !== IMAGEM_RESERVA);

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
/** imagens de lote e identificador lidas do canvas (a reserva, 46 × 46, não conta) */
const desenhosLote = () => canvas.chamadas.filter((c) => c.nome === "getImageData" && c.args[0] !== 46).length;
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

describe("L349-1 — imagem por desenho + contagem", () => {
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
    expect(loteAdds(map)).toHaveLength(1);
    expect(map.images.has(IMAGEM_RESERVA)).toBe(true);
    const [chave, pixels, opts] = loteAdds(map)[0];
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
    expect(camada.layout).toMatchObject({ "icon-image": ["coalesce", ["image", ["get", "imagem"]], ["image", IMAGEM_RESERVA]], "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-anchor": "center" });
    expect(camada.layout["symbol-sort-key"]).toEqual(["case", ["boolean", ["get", "alerta"], false], 1, 0]);
    expect(JSON.stringify(camada)).not.toMatch(/text-field/);
  });

  it("mesma chave = mesma imagem: refetch e outro pasto igual não desenham nem registram de novo; contagem nova sim", async () => {
    const { map, r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-vaca", 15)];
    await r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(desenhosLote()).toBe(1);
    const dadosAntes = fonte(map);

    // refetch: listas novas, mesmo conteúdo
    await r.syncLotes(lotes.map((p) => ({ ...p })), [AREA], true, CATEGORIAS.map((c) => ({ ...c })), vi.fn(), vi.fn(), true, false);
    expect(desenhosLote()).toBe(1);
    expect(loteAdds(map)).toHaveLength(1);
    expect(fonte(map)).toBe(dadosAntes); // nada mudou: nem setData

    // outro pasto com o mesmo desenho e a mesma contagem usa a MESMA imagem
    const dois = [...lotes, { ...pos("p9", "cat-vaca", 15), area_atual_id: "a2" }];
    await r.syncLotes(dois, [AREA, AREA2], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(feicoes(map)).toHaveLength(2);
    expect(new Set(feicoes(map).map((f) => f.properties.imagem)).size).toBe(1);
    expect(desenhosLote()).toBe(1);
    expect(loteAdds(map)).toHaveLength(1);

    // a contagem muda: imagem nova (a figura não é recarregada)
    await r.syncLotes([pos("p1", "cat-vaca", 16)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(desenhosLote()).toBe(2);
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

describe("L349-2 — a contagem desenhada na imagem", () => {
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
    const altura = loteAdds(map)[0][1].height;
    expect(texto.args[1]).toBe(LARGURA_MARCADOR_PX / 2);
    expect(texto.args[2]).toBeCloseTo((altura * CONTAGEM_TOPO_PCT) / 100, 5);
    // halo = text-shadow 0 0 3px rgba(255,255,255,.8), 0 0 2px rgba(255,255,255,.95): só a sombra cai na imagem
    expect(halo3.estado).toMatchObject({ shadowColor: "rgba(255,255,255,.8)", shadowBlur: 3 });
    expect(halo2.estado).toMatchObject({ shadowColor: "rgba(255,255,255,.95)", shadowBlur: 2 });
    for (const h of [halo3, halo2]) expect(h.args[1] + h.estado.shadowOffsetX).toBe(texto.args[1]);
    expect(readFileSync("src/lib/maplibre/lotesNoMapa.js", "utf8")).toMatch(/formatarContagem/);
  });
});

describe("L349-3 — posição do ícone com e sem nome embaixo", () => {
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

describe("L349-4 — clique", () => {
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

describe("L349-5 — arrastar para mover", () => {
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

describe("L349-6 — piscar do alerta", () => {
  const comAlerta = (extra = {}) => [pos("p1", "cat-touro", 3, { identificador_cor: "#dc2626", identificador_sigla: "LA", alertas: [{ id: "x" }], ...extra })];
  /** estados `piscaApagado` marcados, em ordem: [id, valor] */
  const piscadas = (map) =>
    map.setFeatureState.mock.calls.filter((c) => c[0]?.source === LOTES_SOURCE_ID && "piscaApagado" in (c[1] || {})).map((c) => [c[0].id, c[1].piscaApagado]);
  const pinturaIdent = (map) => map.setPaintProperty.mock.calls.filter((c) => c[0] === LOTES_IDENT_LAYER_ID);

  it("a camada tem a opacidade FIXA (estado do lote); o piscar nunca chama setPaintProperty", async () => {
    const [, ident] = camadasLotes();
    expect(ident.paint["icon-opacity"]).toEqual(["case", ["boolean", ["feature-state", "arrastando"], false], 0, ["boolean", ["feature-state", "piscaApagado"], false], OPACIDADE_PISCAR, 1]);
    expect(ident.paint["icon-opacity"]).toBe(OPACIDADE_IDENT);
    expect(JSON.stringify(ident.paint)).not.toMatch(/"get"/); // nada de propriedade da fonte na pintura
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes(comAlerta(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    const dados = fonte(map);
    vi.advanceTimersByTime(PISCAR_MS * 6);
    expect(piscadas(map).length).toBeGreaterThanOrEqual(6);
    expect(pinturaIdent(map)).toHaveLength(0);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(fonte(map)).toBe(dados); // a fonte não é refeita
  });

  it("com alerta e piscar ligado: só os lotes com alerta alternam apagado ↔ aceso a cada 550 ms, juntos; param ao tirar o alerta", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { map, r } = montar();
    renderer = r;
    const dois = [...comAlerta(), { ...pos("p9", "cat-touro", 3, { identificador_cor: "#2563eb", identificador_sigla: "B" }), area_atual_id: "a2" }];
    await r.syncLotes(dois, [AREA, AREA2], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    // D-PROD-353: o lote com alerta vai no fim dos dados (é desenhado por cima, e o clique segue a ordem dos dados)
    expect(feicoes(map).map((f) => [f.properties.areaId, f.properties.piscar])).toEqual([["a2", false], ["a1", true]]);
    expect(piscadas(map)).toHaveLength(0);
    vi.advanceTimersByTime(PISCAR_MS);
    expect(piscadas(map)).toEqual([["a1", true]]);
    vi.advanceTimersByTime(PISCAR_MS);
    expect(piscadas(map)).toEqual([["a1", true], ["a1", false]]);
    vi.advanceTimersByTime(PISCAR_MS); // apagado de novo
    // o a2 ganha alerta no meio do "apagado": entra apagado, na mesma fase do a1
    const tresAlertas = dois.map((l) => ({ ...l, alertas: [{ id: "y" }] }));
    await r.syncLotes(tresAlertas, [AREA, AREA2], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    expect(piscadas(map).at(-1)).toEqual(["a2", true]);
    vi.advanceTimersByTime(PISCAR_MS);
    expect(piscadas(map).slice(-2)).toEqual([["a1", false], ["a2", false]]);
    vi.advanceTimersByTime(PISCAR_MS);
    // tira todos os alertas no meio do "apagado": voltam acesos e param
    await r.syncLotes(dois.map((l) => ({ ...l, alertas: [] })), [AREA, AREA2], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    expect(piscadas(map).slice(-2)).toEqual([["a1", false], ["a2", false]]);
    const n = piscadas(map).length;
    vi.advanceTimersByTime(PISCAR_MS * 4);
    expect(piscadas(map)).toHaveLength(n);
    expect(map.setPaintProperty).not.toHaveBeenCalled();
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
    expect(piscadas(map)).toHaveLength(0);
  });

  it("clearAll para o piscar", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { map, r } = montar();
    await r.syncLotes(comAlerta(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, true);
    vi.advanceTimersByTime(PISCAR_MS);
    r.clearAll();
    expect(piscadas(map).at(-1)).toEqual(["a1", false]);
    const n = piscadas(map).length;
    vi.advanceTimersByTime(PISCAR_MS * 4);
    expect(piscadas(map)).toHaveLength(n);
    expect(feicoes(map)).toHaveLength(0);
  });
});

describe("L349-7 — troca de estilo (satélite ↔ mapa)", () => {
  it("ensureLayers recria camadas, imagens e dados; styleimagemissing repõe a imagem que faltar", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([pos("p1", "cat-touro", 3, { identificador_cor: "#dc2626", identificador_sigla: "LA" })], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [f] = feicoes(map);
    expect([...map.images.keys()].sort()).toEqual([f.properties.ident, f.properties.imagem, IMAGEM_RESERVA].sort());

    // setStyle: estilo novo sem nada do Mapa Geral
    map.images.clear();
    map.layers.length = 0;
    map.data.delete(LOTES_SOURCE_ID);
    const desenhos = desenhosLote();
    r.ensureLayers();
    expect(map.getLayer(LOTES_LAYER_ID)).toBeTruthy();
    expect([...map.images.keys()].sort()).toEqual([f.properties.ident, f.properties.imagem, IMAGEM_RESERVA].sort());
    expect(feicoes(map)).toHaveLength(1);
    expect(desenhosLote()).toBe(desenhos); // reaproveita, não redesenha

    map.images.delete(f.properties.imagem);
    disparar(map, "styleimagemissing", null, { id: f.properties.imagem });
    expect(map.images.has(f.properties.imagem)).toBe(true);
    map.images.delete(IMAGEM_RESERVA);
    disparar(map, "styleimagemissing", null, { id: IMAGEM_RESERVA });
    expect(map.images.has(IMAGEM_RESERVA)).toBe(true);
    disparar(map, "styleimagemissing", null, { id: "outra-coisa" });
    expect(map.images.has("outra-coisa")).toBe(false);
  });
});

describe("L349-8 — identificador", () => {
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

describe("L349-9 — correções da revisão", () => {
  const umLote = (extra = {}) => [pos("p1", "cat-touro", 3, { identificador_cor: "#dc2626", identificador_sigla: "LA", ...extra })];
  const feature = { properties: { areaId: "a1" } };
  const iniciarArrasto = async (map, r) => {
    const onDrag = vi.fn();
    await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), onDrag, true, false);
    disparar(map, "mousedown", LOTES_LAYER_ID, { type: "mousedown", point: { x: 0, y: 0 }, features: [feature], preventDefault: vi.fn() });
    disparar(map, "mousemove", null, { point: { x: 30, y: 0 }, originalEvent: { buttons: 1 } });
    const copia = marcadores.filter((m) => m.el.className === "mg-lote-arrastando").at(-1);
    expect(copia?.removed).toBe(false);
    return { onDrag, copia };
  };
  const ouvintesArrasto = () => map0.handlers.filter((h) => typeof h[1] === "function" && ["mousemove", "mouseup"].includes(h[0]));
  let map0;

  it("mouse solto fora do mapa: o próximo movimento sem botão encerra o arrasto (sem mover o lote)", async () => {
    const { map, r } = montar();
    renderer = r;
    map0 = map;
    const { onDrag, copia } = await iniciarArrasto(map, r);
    disparar(map, "mousemove", null, { point: { x: 60, y: 0 }, originalEvent: { buttons: 0 } });
    expect(copia.removed).toBe(true);
    expect(onDrag).not.toHaveBeenCalled();
    expect(map.setFeatureState).toHaveBeenLastCalledWith({ source: LOTES_SOURCE_ID, id: "a1" }, { arrastando: false });
    expect(ouvintesArrasto()).toHaveLength(0);
  });

  it("mouseup ou perda de foco na janela fora do mapa encerram o arrasto; mouseup dentro do mapa fica para o mapa; os ouvintes da janela saem", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const rem = vi.spyOn(window, "removeEventListener");
    const { map, r } = montar();
    renderer = r;
    map0 = map;
    const caixa = document.createElement("div");
    const dentro = document.createElement("canvas");
    caixa.appendChild(dentro);
    document.body.appendChild(caixa);
    map.getCanvasContainer = () => caixa;
    try {
      // mouseup fora do mapa
      let { onDrag, copia } = await iniciarArrasto(map, r);
      expect(add.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(["mouseup", "blur"]));
      window.dispatchEvent(new MouseEvent("mouseup"));
      expect(copia.removed).toBe(true);
      expect(onDrag).not.toHaveBeenCalled();
      const ouvinte = add.mock.calls.find((c) => c[0] === "mouseup")[1];
      expect(rem).toHaveBeenCalledWith("mouseup", ouvinte);
      expect(rem).toHaveBeenCalledWith("blur", ouvinte);

      // janela perde o foco
      ({ onDrag, copia } = await iniciarArrasto(map, r));
      window.dispatchEvent(new Event("blur"));
      expect(copia.removed).toBe(true);
      expect(onDrag).not.toHaveBeenCalled();

      // mouseup dentro do mapa: quem solta é o mapa (o lote é movido)
      ({ onDrag, copia } = await iniciarArrasto(map, r));
      dentro.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      expect(copia.removed).toBe(false);
      disparar(map, "mouseup", null, { point: { x: 30, y: 0 } });
      expect(onDrag).toHaveBeenCalledTimes(1);
      expect(copia.removed).toBe(true);
      expect(ouvintesArrasto()).toHaveLength(0);
    } finally {
      caixa.remove();
    }
  });

  it("imagem que falha: o lote usa a reserva (círculo verde), avisa uma vez e tenta de novo na próxima sincronização", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    canvas.falharLeitura = (w) => w === LARGURA_MARCADOR_PX; // só a imagem do lote falha
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [f] = feicoes(map);
    expect(f).toBeTruthy(); // o lote não some da fonte
    expect(map.images.has(f.properties.imagem)).toBe(false);
    expect(map.images.has(IMAGEM_RESERVA)).toBe(true);
    // reserva: círculo verde #10b981 de raio 19 com borda branca de 3 px
    const verde = canvas.chamadas.find((c) => c.nome === "fill" && c.estado.fillStyle === "#10b981");
    expect(verde).toBeTruthy();
    expect(canvas.chamadas.find((c) => c.nome === "arc" && c.largura === 46 && c.args[2] === 19)).toBeTruthy();
    expect(canvas.chamadas.find((c) => c.nome === "stroke" && c.largura === 46).estado).toMatchObject({ strokeStyle: "#ffffff", lineWidth: 3 });
    expect(aviso).toHaveBeenCalledTimes(1);

    // nova sincronização (mesmos dados): tenta desenhar de novo; o aviso não se repete
    const tentativas = () => canvas.chamadas.filter((c) => c.nome === "getImageData" && c.args[0] === LARGURA_MARCADOR_PX).length;
    const antes = tentativas();
    await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(tentativas()).toBe(antes + 1);
    expect(aviso).toHaveBeenCalledTimes(1);

    // agora dá certo: a imagem entra e a fonte é publicada de novo (o mapa troca a reserva pela imagem)
    canvas.falharLeitura = null;
    const dados = fonte(map);
    await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(map.images.has(f.properties.imagem)).toBe(true);
    expect(fonte(map)).not.toBe(dados);
  });

  it("figura que não carrega (Codex P2): não vira imagem só com o número — fica a reserva e a próxima vez recarrega", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    canvas.falharFigura = true;
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [f] = feicoes(map);
    expect(map.images.has(f.properties.imagem)).toBe(false); // nada de imagem só com o número
    expect(map.images.has(IMAGEM_RESERVA)).toBe(true);
    expect(canvas.textos()).not.toContain("3"); // a contagem (3 cabeças) não foi escrita sozinha
    // a figura volta a carregar: a próxima sincronização recarrega e a imagem entra
    canvas.falharFigura = false;
    await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(map.images.has(f.properties.imagem)).toBe(true);
  });

  it("imagem que falha sempre: para de tentar depois de MAX_TENTATIVAS_IMAGEM (fica a reserva)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    canvas.falharLeitura = (w) => w === LARGURA_MARCADOR_PX;
    const { r } = montar();
    renderer = r;
    const tentativas = () => canvas.chamadas.filter((c) => c.nome === "getImageData" && c.args[0] === LARGURA_MARCADOR_PX).length;
    for (let i = 0; i < MAX_TENTATIVAS_IMAGEM + 3; i++) {
      await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    }
    expect(tentativas()).toBe(MAX_TENTATIVAS_IMAGEM);
  });

  it("imagens que nenhum lote usa mais saem do mapa e do cache; com os lotes escondidos, nada sai", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes([pos("p1", "cat-vaca", 15)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const velha = feicoes(map)[0].properties.imagem;
    await r.syncLotes([pos("p1", "cat-vaca", 16)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const nova = feicoes(map)[0].properties.imagem;
    expect(map.removeImage).toHaveBeenCalledWith(velha);
    expect(map.images.has(velha)).toBe(false);
    expect(map.images.has(nova)).toBe(true);
    expect(map.images.has(IMAGEM_RESERVA)).toBe(true); // a reserva nunca sai
    // a velha saiu do cache: voltar a 15 desenha de novo
    const d = desenhosLote();
    await r.syncLotes([pos("p1", "cat-vaca", 15)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(desenhosLote()).toBe(d + 1);

    // filtro esconde os lotes: as imagens ficam (mostrar de novo não redesenha)
    map.removeImage.mockClear();
    await r.syncLotes([pos("p1", "cat-vaca", 15)], [AREA], false, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(map.removeImage).not.toHaveBeenCalled();
    const d2 = desenhosLote();
    await r.syncLotes([pos("p1", "cat-vaca", 15)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(desenhosLote()).toBe(d2);
  });

  it("a densidade da tela muda (resize): as imagens são redesenhadas nela e trocadas no mapa", async () => {
    const original = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    const { map, r } = montar();
    renderer = r;
    try {
      await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
      const chave = feicoes(map)[0].properties.imagem;
      expect(map.images.get(chave).opts).toEqual({ pixelRatio: 1 });
      disparar(map, "resize", null, {}); // mesma densidade: nada
      expect(map.removeImage).not.toHaveBeenCalled();

      Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
      disparar(map, "resize", null, {});
      await vi.waitFor(() => expect(map.images.get(chave)?.opts).toEqual({ pixelRatio: 2 }));
      expect(map.removeImage).toHaveBeenCalledWith(chave);
      expect(map.images.get(chave).img.width).toBe(2 * LARGURA_MARCADOR_PX);
      expect(map.images.get(IMAGEM_RESERVA).opts).toEqual({ pixelRatio: 2 });
    } finally {
      if (original) Object.defineProperty(window, "devicePixelRatio", original);
      else delete window.devicePixelRatio;
    }
  });

  it("hitLote enxerga o ícone do lote; toque longo não começa em cima dele; clique que encerra um toque longo não abre os lotes", async () => {
    const { map, r } = montar();
    renderer = r;
    await r.syncLotes(umLote(), [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(r.hitLote({ x: 1, y: 1 })).toBe(false);
    map.sobPonto[LOTES_LAYER_ID] = [feature];
    expect(r.hitLote({ x: 1, y: 1 })).toBe(true);

    expect(deveComecarToqueLongo({ podeUsarTarefasMapa: true, selecionandoLocalTarefa: false, sobreLote: false })).toBe(true);
    expect(deveComecarToqueLongo({ podeUsarTarefasMapa: true, selecionandoLocalTarefa: false, sobreLote: true })).toBe(false);
    expect(deveComecarToqueLongo({ podeUsarTarefasMapa: false, selecionandoLocalTarefa: false, sobreLote: false })).toBe(false);
    expect(deveComecarToqueLongo({ podeUsarTarefasMapa: true, selecionandoLocalTarefa: true, sobreLote: false })).toBe(false);
    expect(acaoDoCliqueNoLote({ toqueLongoAcabouDeDisparar: true })).toBe("ignorar");
    expect(acaoDoCliqueNoLote({ toqueLongoAcabouDeDisparar: false })).toBe("abrir-lotes");

    // o Mapa Geral usa as duas regras: o toque longo consulta o lote ANTES de armar o tempo, e zera o "acabou de
    // disparar" antes (senão um toque longo antigo bloquearia o próximo clique no lote)
    const src = readFileSync("src/pages/MapaGeral.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const press = src.slice(src.indexOf("const handlePressStart = (event) => {"), src.indexOf("const handlePressMove"));
    const zera = press.indexOf("longPressTriggeredRef.current = false;");
    const consulta = press.indexOf("rendererHitLoteRef.current?.(");
    const regra = press.indexOf("deveComecarToqueLongo({ podeUsarTarefasMapa, selecionandoLocalTarefa, sobreLote, sobrePonto })");
    const arma = press.indexOf("longPressTimerRef.current = setTimeout(");
    expect(zera).toBeGreaterThan(-1);
    expect(consulta).toBeGreaterThan(zera);
    expect(regra).toBeGreaterThan(consulta);
    expect(arma).toBeGreaterThan(regra);
    expect(src).toMatch(/rendererHitLoteRef\.current = renderer\.hitLote;/);
    const clique = src.slice(src.indexOf("const handleClickLotes = useCallback("), src.indexOf("const handleClickTarefa"));
    expect(clique).toMatch(/acaoDoCliqueNoLote\(\{ toqueLongoAcabouDeDisparar: longPressTriggeredRef\.current \}\) === 'ignorar'\) return;/);
    expect(clique.indexOf("acaoDoCliqueNoLote")).toBeLessThan(clique.indexOf("setSelectedLote"));
  });
});

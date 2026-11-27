/**
 * MAIKE-ICONES-LOTE-CODIGO (D-PROD-191) — o ícone do lote NO MAPA GERAL.
 *
 * O motor (src/assets/icones/lotes) tem os testes dele em iconesLoteMotor.test.js.
 * Aqui é a integração com o mapa: `resolverIconeLote` (mapaGeralRender) e o
 * lote que `syncLotes` (useMapRenderer) põe no mapa, com MapLibre e canvas falsos.
 * Desde a D-PROD-348 o lote é desenhado pelo mapa: um ponto na fonte `mg-lotes`
 * (com `desenho` = chave do motor) e uma imagem montada no canvas a partir da
 * data URL do motor, com a contagem escrita dentro.
 *
 *  ILM-1. Nunca sai sem figura: `iconUrl` é sempre a data URL do SVG do marcador
 *         (lista vazia, posição sem categoria, categoria desconhecida, sexo "Misto").
 *  ILM-2. O resolver não lê ConfiguracaoIcone: ícones de Lote com `icone_url` não
 *         mudam nada; o Mapa Geral passa as Categorias de Manejo ao `syncLotes`.
 *  ILM-3. O lote de `syncLotes`: imagem desenhada da data URL do motor, `desenho` igual à
 *         chave do motor, contagem a CONTAGEM_TOPO_PCT % e largura LARGURA_MARCADOR_PX.
 *  ILM-4. Troca de categoria (na posição ou na própria Categoria de Manejo) troca o
 *         desenho no MESMO lote (mesmo id na fonte); a mesma figura não é redesenhada.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { CONTAGEM_TOPO_PCT, LARGURA_MARCADOR_PX, resolverFiguraDoPasto, urlMarcadorLote } from "@/assets/icones/lotes";
import { resolverIconeLote } from "@/lib/maplibre/mapaGeralRender.js";
import { LOTES_SOURCE_ID, limparCacheImagensLotes } from "@/lib/maplibre/lotesNoMapa.js";
import useMapRenderer from "@/components/mapa/useMapRenderer.jsx";
import { instalarCanvasFalso } from "./helpers/canvasLotesFalso.js";

// ─── MapLibre falso (mesmo padrão de maplibreAreasUnificacao.test.jsx) ───
const marcadores = vi.hoisted(() => /** @type {any[]} */ ([]));
vi.mock("@/lib/maplibre/lifecycle.js", async (orig) => {
  const real = await orig();
  class Marker {
    constructor(opts) {
      this.el = opts.element;
      this.opts = opts;
      this.handlers = {};
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
    on(ev, fn) {
      this.handlers[ev] = fn;
      return this;
    }
    remove() {
      this.removed = true;
      this.el.remove();
    }
  }
  class Popup {
    setLngLat() {
      return this;
    }
    setDOMContent() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  return { ...real, maplibregl: { Marker, Popup, LngLatBounds: class {} }, setSourceData: (map, id, data) => map?.data?.set(id, data) };
});

const mkMap = () => {
  const handlers = [];
  const images = new Map();
  return {
    container: document.createElement("div"),
    data: new Map(),
    handlers,
    images,
    getSource: () => undefined,
    addSource: () => {},
    getLayer: () => undefined,
    addLayer: () => {},
    addImage: (id, img, opts) => images.set(id, { img, opts }),
    hasImage: (id) => images.has(id),
    on: (...a) => handlers.push(a),
    off: (...a) => {
      const i = handlers.findIndex((h) => h[0] === a[0] && h[h.length - 1] === a[a.length - 1]);
      if (i >= 0) handlers.splice(i, 1);
    },
    getZoom: () => 15,
    project: () => ({ x: 0, y: 0 }),
    getCanvas: () => ({ style: {} }),
    setFeatureState: vi.fn(),
    queryRenderedFeatures: () => [],
  };
};

/** Renderer real sobre o mapa falso. */
const montar = () => {
  const map = mkMap();
  const { result } = renderHook(() => useMapRenderer(/** @type {any} */ ({ current: map })));
  return { map, r: result.current };
};

// ─── Dados ───
const AREA = {
  id: "a1",
  nome: "Pasto 1",
  tamanho_hectares: 12.5,
  coordenadas: { coords: [[0, 0], [0, 0.01], [-0.01, 0.01], [-0.01, 0]], cor: "#0d67ad" },
};

/** Categorias de Manejo como vêm do cache do mapa (sexo do cadastro: Macho, Fêmea ou Misto). */
const CATEGORIAS = [
  { id: "cat-bezerro", empresa_id: "emp-1", nome: "BEZERRO", sexo: "Macho", idade_minima_meses: 0, idade_maxima_meses: 8 },
  { id: "cat-novilha", empresa_id: "emp-1", nome: "NOVILHA", sexo: "Fêmea", idade_minima_meses: 13, idade_maxima_meses: 24 },
  { id: "cat-vaca", empresa_id: "emp-1", nome: "VACA", sexo: "Fêmea", idade_minima_meses: 37, idade_maxima_meses: null },
  { id: "cat-touro", empresa_id: "emp-1", nome: "TOURO", sexo: "Macho", idade_minima_meses: 37, idade_maxima_meses: null },
  { id: "cat-misto", empresa_id: "emp-1", nome: "MISTURADO", sexo: "Misto", idade_minima_meses: 13, idade_maxima_meses: 24 },
];

/** Posição do rebanho no pasto a1. */
const pos = (id, categoria_manejo_id, quantidade_cabecas, extra = {}) => ({
  id,
  area_atual_id: "a1",
  categoria_manejo_id,
  quantidade_cabecas,
  ...extra,
});

/** ConfiguracaoIcone de Lote (upload antigo): não pode influir em nada. */
const ICONES_LOTE_UPLOAD = [
  { id: "ic-boi", tipo_entidade: "Lote", categoria: "BOI", icone_url: "https://exemplo.invalid/boi.png", ativo: true },
  { id: "ic-novilha", tipo_entidade: "Lote", categoria: "NOVILHA", icone_url: "https://exemplo.invalid/novilha.png", ativo: true },
  {
    id: "ic-misto",
    tipo_entidade: "Lote",
    categoria: "MISTO",
    categorias_misto: ["BOI", "VACA", "NOVILHA"],
    icone_url: "https://exemplo.invalid/misto.png",
    ativo: true,
  },
];

const DATA_SVG = /^data:image\/svg\+xml;base64,/;
/** SVG dentro da data URL. */
const svgDaUrl = (url) => new DOMParser().parseFromString(atob(String(url).replace(DATA_SVG, "")), "image/svg+xml").documentElement;

/** O resultado do resolver é exatamente o do motor. */
const doMotor = (posicoes, categorias) => {
  const icone = resolverFiguraDoPasto(posicoes, categorias);
  return { iconUrl: urlMarcadorLote(icone), chave: icone.chave, nivel: icone.nivel, rotulo: icone.rotulo };
};

/** Lotes na fonte do mapa (D-PROD-348). */
const lotesNaFonte = (map) => map.data.get(LOTES_SOURCE_ID)?.features || [];

/** Fonte sem comentários: comentário explicativo não é código. */
const codigoDe = (rel) =>
  readFileSync(rel, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

let renderer = null;
let canvas;
beforeEach(() => {
  marcadores.length = 0;
  renderer = null;
  limparCacheImagensLotes();
  canvas = instalarCanvasFalso();
});
afterEach(() => {
  // Cancela o quadro agendado para os rótulos e derruba os marcadores.
  renderer?.clearAll();
});

describe("ILM-1 — o resolver do mapa sempre devolve figura", () => {
  const casos = [
    ["lista vazia", []],
    ["sem lista", undefined],
    ["posições sem categoria", [{ quantidade_cabecas: 10 }, { quantidade_cabecas: 5, categoria: "" }]],
    ["categoria desconhecida", [pos("p1", "cat-que-nao-existe", 7)]],
    ["sexo Misto na posição", [{ sexo: "Misto", quantidade_cabecas: 12 }]],
    ["Categoria de Manejo de sexo Misto", [pos("p1", "cat-misto", 9)]],
    ["texto oficial sem Categoria de Manejo", [{ categoria: "Novilha 13 a 24 meses", quantidade_cabecas: 4 }]],
  ];

  it.each(casos)("%s: iconUrl é a data URL do SVG, com a chave do motor", (_nome, posicoes) => {
    const r = resolverIconeLote(posicoes, CATEGORIAS);
    expect(r).toEqual(doMotor(posicoes, CATEGORIAS));
    expect(r.iconUrl).toMatch(DATA_SVG);
    expect(typeof r.chave).toBe("string");
    expect(r.chave).not.toBe("");
    expect([1, 2, 3, 4, 5]).toContain(r.nivel);
    expect(r.rotulo).not.toBe("");
    expect(svgDaUrl(r.iconUrl).getAttribute("data-icone-lote")).toBe(r.chave);
  });

  it("sem as categorias (ainda carregando) também sai figura; com elas, a do sexo e da faixa", () => {
    const posicoes = [pos("p1", "cat-novilha", 20)];
    const semLista = resolverIconeLote(posicoes);
    expect(semLista.iconUrl).toMatch(DATA_SVG);
    expect(resolverIconeLote(posicoes, null).iconUrl).toMatch(DATA_SVG);
    const comLista = resolverIconeLote(posicoes, CATEGORIAS);
    expect(comLista.nivel).toBe(1);
    expect(comLista.rotulo).toContain("13 a 24 meses");
    expect(comLista.chave).not.toBe(semLista.chave);
    // aceita também o Map por id, como o motor
    expect(resolverIconeLote(posicoes, new Map(CATEGORIAS.map((c) => [c.id, c])))).toEqual(comLista);
  });

  it("mesma chave → mesma data URL (memorizada pelo motor)", () => {
    const a = resolverIconeLote([pos("p1", "cat-touro", 3)], CATEGORIAS);
    const b = resolverIconeLote([pos("p9", "cat-touro", 40)], [...CATEGORIAS]);
    expect(b.chave).toBe(a.chave);
    expect(b.iconUrl).toBe(a.iconUrl);
  });
});

describe("ILM-2 — ConfiguracaoIcone não decide mais o ícone do lote", () => {
  it("ícones de Lote com icone_url (e categorias_misto) não mudam nada", () => {
    const casos = [
      [{ categoria: "BOI", quantidade_cabecas: 3 }],
      [{ categoria: "BOI", quantidade_cabecas: 3 }, { categoria: "VACA", quantidade_cabecas: 2 }],
      [pos("p1", "cat-novilha", 8)],
    ];
    for (const posicoes of casos) {
      const comUpload = resolverIconeLote(posicoes, /** @type {any} */ ([...CATEGORIAS, ...ICONES_LOTE_UPLOAD]));
      expect(comUpload).toEqual(resolverIconeLote(posicoes, CATEGORIAS));
      expect(comUpload.iconUrl).toMatch(DATA_SVG);
      expect(comUpload.iconUrl).not.toContain("exemplo.invalid");
      expect(resolverIconeLote(posicoes, /** @type {any} */ (ICONES_LOTE_UPLOAD))).toEqual(resolverIconeLote(posicoes, []));
    }
  });

  it("o código do resolver não consulta ConfiguracaoIcone; o Mapa Geral passa as categorias", () => {
    const fonteRender = codigoDe("src/lib/maplibre/mapaGeralRender.js");
    const inicio = fonteRender.indexOf("export function resolverIconeLote");
    const corpo = fonteRender.slice(inicio, fonteRender.indexOf("\n}\n", inicio));
    expect(inicio).toBeGreaterThan(-1);
    expect(corpo).toMatch(/resolverFiguraDoPasto\(lotesNaArea, categoriasManejo\)/);
    expect(corpo).not.toMatch(/tipo_entidade|icone_url|categorias_misto|MISTO/);

    const mapa = codigoDe("src/pages/MapaGeral.jsx");
    expect(mapa).toContain("useQuery(createMapaQuery('categoriasManejo'))");
    expect(mapa).toMatch(/renderer\.syncLotes\(lotesFiltrados, areas, [^,]+, categoriasManejo,/);
    expect(mapa).not.toMatch(/renderer\.syncLotes\([^;]*iconesConfig/);
    // os uploads antigos de Lote não são mais baixados
    expect(mapa).toMatch(/if \(icone\.tipo_entidade === 'Lote'\) return;/);
  });

  it("syncLotes com ícones de upload no 4º argumento continua desenhando o ícone do código", async () => {
    const { map, r } = montar();
    renderer = r;
    const lotes = [pos("p1", null, 5, { categoria: "BOI" })];
    await r.syncLotes(lotes, [AREA], true, ICONES_LOTE_UPLOAD, vi.fn(), vi.fn(), true, false);
    const [f] = lotesNaFonte(map);
    expect(f.properties.desenho).toBe(resolverFiguraDoPasto(lotes, []).chave);
    // a figura desenhada na imagem é a data URL do motor, nunca o upload
    expect(canvas.figurasCarregadas).toHaveLength(1);
    expect(canvas.figurasCarregadas[0]).toMatch(DATA_SVG);
    expect(canvas.figurasCarregadas[0]).not.toContain("exemplo.invalid");
    expect(canvas.figurasCarregadas[0]).toBe(urlMarcadorLote(resolverFiguraDoPasto(lotes, [])));
  });
});

describe("ILM-3 — o lote que syncLotes põe no mapa (D-PROD-348: desenhado pelo mapa)", () => {
  it("imagem da data URL do motor, `desenho` = chave do motor, contagem no centro da faixa e largura do motor", async () => {
    const { map, r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-touro", 30), pos("p2", "cat-touro", 12)];
    await r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);

    const doLote = lotesNaFonte(map);
    expect(doLote).toHaveLength(1);
    const f = doLote[0];
    const icone = resolverFiguraDoPasto(lotes, CATEGORIAS);
    const src = urlMarcadorLote(icone);
    expect(canvas.figurasCarregadas).toEqual([src]);
    expect(f.properties.desenho).toBe(icone.chave);
    expect(svgDaUrl(src).getAttribute("data-icone-lote")).toBe(icone.chave);
    expect(f.properties.contagem).toBe("42");
    expect(map.images.has(f.properties.imagem)).toBe(true);

    // a figura ocupa LARGURA_MARCADOR_PX de largura e a altura segue o desenho (sem achatar)
    const svg = svgDaUrl(src);
    const largura = Number(svg.getAttribute("width"));
    const altura = Number(svg.getAttribute("height"));
    const alturaPx = Math.round((LARGURA_MARCADOR_PX * altura) / largura);
    const desenho = canvas.chamadas.find((c) => c.nome === "drawImage");
    expect(desenho.args.slice(1)).toEqual([0, 0, LARGURA_MARCADOR_PX, alturaPx]);
    // a contagem no centro da faixa (CONTAGEM_TOPO_PCT da altura) e no meio da largura
    const texto = canvas.chamadas.filter((c) => c.nome === "fillText" && c.args[0] === "42").at(-1);
    expect(texto.args[1]).toBe(LARGURA_MARCADOR_PX / 2);
    expect(texto.args[2]).toBeCloseTo((alturaPx * CONTAGEM_TOPO_PCT) / 100, 5);
  });

  it("um lote por pasto, cada um com o desenho do seu rebanho", async () => {
    const { map, r } = montar();
    renderer = r;
    const area2 = { ...AREA, id: "a2", nome: "Pasto 2" };
    const lotes = [
      pos("p1", "cat-bezerro", 10),
      { ...pos("p2", "cat-vaca", 15), area_atual_id: "a2" },
      { ...pos("p3", "cat-touro", 2), area_atual_id: "a2" },
    ];
    await r.syncLotes(lotes, [AREA, area2], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const porPasto = Object.fromEntries(lotesNaFonte(map).map((f) => [f.properties.nome, f.properties.desenho]));
    expect(porPasto).toEqual({
      "Pasto 1": resolverFiguraDoPasto(lotes.filter((l) => l.area_atual_id === "a1"), CATEGORIAS).chave,
      "Pasto 2": resolverFiguraDoPasto(lotes.filter((l) => l.area_atual_id === "a2"), CATEGORIAS).chave,
    });
    expect(porPasto["Pasto 1"]).not.toBe(porPasto["Pasto 2"]);
  });
});

describe("ILM-4 — troca de categoria atualiza o mesmo lote", () => {
  it("a posição muda de Categoria de Manejo: desenho e imagem novos, o lote é o mesmo (mesmo id na fonte)", async () => {
    const { map, r } = montar();
    renderer = r;
    const antes = [pos("p1", "cat-bezerro", 30), pos("p2", "cat-bezerro", 12)];
    await r.syncLotes(antes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [f0] = lotesNaFonte(map);
    expect(f0.properties.desenho).toBe(resolverFiguraDoPasto(antes, CATEGORIAS).chave);

    // manejo "Mudar categoria": as posições passam a apontar para a Novilha
    const depois = antes.map((p) => ({ ...p, categoria_manejo_id: "cat-novilha" }));
    await r.syncLotes(depois, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(lotesNaFonte(map)).toHaveLength(1);
    const [f1] = lotesNaFonte(map);
    expect(f1.id).toBe(f0.id);
    const icone = resolverFiguraDoPasto(depois, CATEGORIAS);
    expect(f1.properties.desenho).toBe(icone.chave);
    expect(f1.properties.desenho).not.toBe(f0.properties.desenho);
    expect(f1.properties.imagem).not.toBe(f0.properties.imagem);
    expect(canvas.figurasCarregadas.at(-1)).toBe(urlMarcadorLote(icone));
    expect(f1.properties.contagem).toBe("42");
  });

  it("a Categoria de Manejo muda de faixa, ou chega depois do cache: o desenho acompanha", async () => {
    const { map, r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-novilha", 20)];
    // categorias ainda não carregadas (placeholder do useQuery)
    await r.syncLotes(lotes, [AREA], true, [], vi.fn(), vi.fn(), true, false);
    expect(lotesNaFonte(map)[0].properties.desenho).toBe(resolverFiguraDoPasto(lotes, []).chave);

    await r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(lotesNaFonte(map)[0].properties.desenho).toBe(resolverFiguraDoPasto(lotes, CATEGORIAS).chave);

    // a mesma categoria (mesmo id) editada para 25 a 36 meses
    const editadas = CATEGORIAS.map((c) => (c.id === "cat-novilha" ? { ...c, idade_minima_meses: 25, idade_maxima_meses: 36 } : c));
    await r.syncLotes(lotes, [AREA], true, editadas, vi.fn(), vi.fn(), true, false);
    const icone = resolverFiguraDoPasto(lotes, editadas);
    expect(icone.chave).not.toBe(resolverFiguraDoPasto(lotes, CATEGORIAS).chave);
    expect(lotesNaFonte(map)[0].properties.desenho).toBe(icone.chave);
    expect(canvas.figurasCarregadas.at(-1)).toBe(urlMarcadorLote(icone));
    expect(lotesNaFonte(map)).toHaveLength(1);
  });

  it("a mesma figura com listas novas (refetch) não redesenha; contagem nova mantém o desenho e não recarrega a figura", async () => {
    const { map, r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-vaca", 15)];
    await r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const desenhos = canvas.desenhos();

    await r.syncLotes(lotes.map((p) => ({ ...p })), [AREA], true, CATEGORIAS.map((c) => ({ ...c })), vi.fn(), vi.fn(), true, false);
    expect(canvas.desenhos()).toBe(desenhos);

    await r.syncLotes([pos("p1", "cat-vaca", 16)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [f] = lotesNaFonte(map);
    expect(f.properties.contagem).toBe("16");
    expect(f.properties.desenho).toBe(resolverFiguraDoPasto(lotes, CATEGORIAS).chave);
    // só a contagem mudou: a figura (URL de dezenas de kB) não é carregada de novo
    expect(canvas.figurasCarregadas).toHaveLength(1);
    expect(canvas.desenhos()).toBe(desenhos + 1);
  });
});

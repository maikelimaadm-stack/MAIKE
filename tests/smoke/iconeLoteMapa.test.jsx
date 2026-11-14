/**
 * MAIKE-ICONES-LOTE-CODIGO (D-PROD-191) — o ícone do lote NO MAPA GERAL.
 *
 * O motor (src/assets/icones/lotes) tem os testes dele em iconesLoteMotor.test.js.
 * Aqui é a integração com o mapa: `resolverIconeLote` (mapaGeralRender) e o
 * marcador que `syncLotes` (useMapRenderer) põe no mapa, com MapLibre falso.
 *
 *  ILM-1. Nunca sai sem figura: `iconUrl` é sempre a data URL do SVG do marcador
 *         (lista vazia, posição sem categoria, categoria desconhecida, sexo "Misto").
 *  ILM-2. O resolver não lê ConfiguracaoIcone: ícones de Lote com `icone_url` não
 *         mudam nada; o Mapa Geral passa as Categorias de Manejo ao `syncLotes`.
 *  ILM-3. O marcador de `syncLotes`: <img> com a data URL, `data-icone-lote` igual à
 *         chave do motor, contagem a CONTAGEM_TOPO_PCT % e largura LARGURA_MARCADOR_PX.
 *  ILM-4. Troca de categoria (na posição ou na própria Categoria de Manejo) troca o
 *         desenho no MESMO marcador; a mesma figura não recria o <img>.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { CONTAGEM_TOPO_PCT, LARGURA_MARCADOR_PX, resolverFiguraDoPasto, urlMarcadorLote } from "@/assets/icones/lotes";
import { resolverIconeLote } from "@/lib/maplibre/mapaGeralRender.js";
import useMapRenderer from "@/components/mapa/useMapRenderer.jsx";

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
    setDraggable(v) {
      this.draggable = v;
      return this;
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
  return { ...real, maplibregl: { Marker, Popup, LngLatBounds: class {} }, setSourceData: (map, id, data) => map.data.set(id, data) };
});

const mkMap = () => {
  const handlers = [];
  return {
    container: document.createElement("div"),
    data: new Map(),
    handlers,
    getSource: () => undefined,
    addSource: () => {},
    getLayer: () => undefined,
    addLayer: () => {},
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

/** Marcador de lote ainda no mapa (o que tem a contagem). */
const marcadoresDeLote = () => marcadores.filter((m) => !m.removed && m.el.querySelector(".mg-lote-count"));

/** Fonte sem comentários: comentário explicativo não é código. */
const codigoDe = (rel) =>
  readFileSync(rel, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

let renderer = null;
beforeEach(() => {
  marcadores.length = 0;
  renderer = null;
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

  it("syncLotes com ícones de upload no 4º argumento continua desenhando o ícone do código", () => {
    const { r } = montar();
    renderer = r;
    const lotes = [pos("p1", null, 5, { categoria: "BOI" })];
    r.syncLotes(lotes, [AREA], true, ICONES_LOTE_UPLOAD, vi.fn(), vi.fn(), true, false);
    const [m] = marcadoresDeLote();
    const src = m.el.querySelector("img").getAttribute("src");
    expect(src).toMatch(DATA_SVG);
    expect(src).not.toContain("exemplo.invalid");
    expect(m.el.dataset.iconeLote).toBe(resolverFiguraDoPasto(lotes, []).chave);
  });
});

describe("ILM-3 — o marcador que syncLotes põe no mapa", () => {
  it("<img> com a data URL, data-icone-lote, contagem no centro da faixa e largura do motor", () => {
    const { map, r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-touro", 30), pos("p2", "cat-touro", 12)];
    r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);

    const doLote = marcadoresDeLote();
    expect(doLote).toHaveLength(1);
    const m = doLote[0];
    expect(map.container.contains(m.el)).toBe(true);

    const icone = resolverFiguraDoPasto(lotes, CATEGORIAS);
    const img = m.el.querySelector("img");
    const src = img.getAttribute("src");
    expect(src).toMatch(DATA_SVG);
    expect(src).toBe(urlMarcadorLote(icone));
    expect(m.el.dataset.iconeLote).toBe(icone.chave);
    expect(m.el.getAttribute("data-icone-lote")).toBe(icone.chave);
    expect(svgDaUrl(src).getAttribute("data-icone-lote")).toBe(icone.chave);

    const contagem = m.el.querySelector(".mg-lote-count");
    expect(contagem.textContent).toBe("42");
    expect(contagem.style.top).toBe(`${CONTAGEM_TOPO_PCT}%`);
    expect(contagem.style.left).toBe("50%");

    // Antes de carregar: a caixa do motor; depois, a largura fica e a altura segue o desenho.
    expect(img.style.width).toBe(`${LARGURA_MARCADOR_PX}px`);
    expect(img.style.height).toBe(`${LARGURA_MARCADOR_PX}px`);
    const svg = svgDaUrl(src);
    const largura = Number(svg.getAttribute("width"));
    const altura = Number(svg.getAttribute("height"));
    Object.defineProperty(img, "naturalWidth", { value: largura });
    Object.defineProperty(img, "naturalHeight", { value: altura });
    img.onload();
    expect(img.style.width).toBe(`${LARGURA_MARCADOR_PX}px`);
    expect(img.style.height).toBe(`${Math.round((LARGURA_MARCADOR_PX * altura) / largura)}px`);
  });

  it("um marcador por pasto, cada um com o desenho do seu rebanho", () => {
    const { r } = montar();
    renderer = r;
    const area2 = { ...AREA, id: "a2", nome: "Pasto 2" };
    const lotes = [
      pos("p1", "cat-bezerro", 10),
      { ...pos("p2", "cat-vaca", 15), area_atual_id: "a2" },
      { ...pos("p3", "cat-touro", 2), area_atual_id: "a2" },
    ];
    r.syncLotes(lotes, [AREA, area2], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const porPasto = Object.fromEntries(marcadoresDeLote().map((m) => [m.el.title, m.el.dataset.iconeLote]));
    expect(porPasto).toEqual({
      "Pasto 1": resolverFiguraDoPasto(lotes.filter((l) => l.area_atual_id === "a1"), CATEGORIAS).chave,
      "Pasto 2": resolverFiguraDoPasto(lotes.filter((l) => l.area_atual_id === "a2"), CATEGORIAS).chave,
    });
    expect(porPasto["Pasto 1"]).not.toBe(porPasto["Pasto 2"]);
  });
});

describe("ILM-4 — troca de categoria atualiza o mesmo marcador", () => {
  it("a posição muda de Categoria de Manejo: chave e <img> novos, marcador o mesmo", () => {
    const { r } = montar();
    renderer = r;
    const antes = [pos("p1", "cat-bezerro", 30), pos("p2", "cat-bezerro", 12)];
    r.syncLotes(antes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [m] = marcadoresDeLote();
    const chaveAntes = m.el.dataset.iconeLote;
    expect(chaveAntes).toBe(resolverFiguraDoPasto(antes, CATEGORIAS).chave);

    // manejo "Mudar categoria": as posições passam a apontar para a Novilha
    const depois = antes.map((p) => ({ ...p, categoria_manejo_id: "cat-novilha" }));
    r.syncLotes(depois, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(marcadoresDeLote()).toHaveLength(1);
    expect(marcadoresDeLote()[0]).toBe(m);
    const icone = resolverFiguraDoPasto(depois, CATEGORIAS);
    expect(m.el.dataset.iconeLote).toBe(icone.chave);
    expect(m.el.dataset.iconeLote).not.toBe(chaveAntes);
    expect(m.el.querySelector("img").getAttribute("src")).toBe(urlMarcadorLote(icone));
    expect(m.el.querySelectorAll("img")).toHaveLength(1);
    expect(m.el.querySelector(".mg-lote-count").textContent).toBe("42");
  });

  it("a Categoria de Manejo muda de faixa, ou chega depois do cache: o desenho acompanha", () => {
    const { r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-novilha", 20)];
    // categorias ainda não carregadas (placeholder do useQuery)
    r.syncLotes(lotes, [AREA], true, [], vi.fn(), vi.fn(), true, false);
    const [m] = marcadoresDeLote();
    expect(m.el.dataset.iconeLote).toBe(resolverFiguraDoPasto(lotes, []).chave);

    r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(m.el.dataset.iconeLote).toBe(resolverFiguraDoPasto(lotes, CATEGORIAS).chave);

    // a mesma categoria (mesmo id) editada para 25 a 36 meses
    const editadas = CATEGORIAS.map((c) => (c.id === "cat-novilha" ? { ...c, idade_minima_meses: 25, idade_maxima_meses: 36 } : c));
    r.syncLotes(lotes, [AREA], true, editadas, vi.fn(), vi.fn(), true, false);
    const icone = resolverFiguraDoPasto(lotes, editadas);
    expect(icone.chave).not.toBe(resolverFiguraDoPasto(lotes, CATEGORIAS).chave);
    expect(m.el.dataset.iconeLote).toBe(icone.chave);
    expect(m.el.querySelector("img").getAttribute("src")).toBe(urlMarcadorLote(icone));
    expect(marcadoresDeLote()).toHaveLength(1);
    expect(marcadoresDeLote()[0]).toBe(m);
  });

  it("a mesma figura com listas novas (refetch) não recria o <img>; contagem nova mantém a chave", () => {
    const { r } = montar();
    renderer = r;
    const lotes = [pos("p1", "cat-vaca", 15)];
    r.syncLotes(lotes, [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    const [m] = marcadoresDeLote();
    const img = m.el.querySelector("img");

    r.syncLotes(lotes.map((p) => ({ ...p })), [AREA], true, CATEGORIAS.map((c) => ({ ...c })), vi.fn(), vi.fn(), true, false);
    expect(m.el.querySelector("img")).toBe(img);

    r.syncLotes([pos("p1", "cat-vaca", 16)], [AREA], true, CATEGORIAS, vi.fn(), vi.fn(), true, false);
    expect(m.el.querySelector(".mg-lote-count").textContent).toBe("16");
    expect(m.el.dataset.iconeLote).toBe(resolverFiguraDoPasto(lotes, CATEGORIAS).chave);
    expect(m.el.querySelector("img").getAttribute("src")).toMatch(DATA_SVG);
    // só a contagem mudou: o <img> (URL de dezenas de kB) não é trocado
    expect(m.el.querySelector("img")).toBe(img);
  });
});

/**
 * MAPLIBRE-EDITOR-PARIDADE-VISUAL-01 (D-PROD-66) — editor de polígonos com o
 * acabamento do CONTROLE-DE-ESTOQUE (`camada-desenho.tsx` @6aef845e).
 * Prova visual com WebGL real: tests/e2e/harness/run-editor-visual.cjs.
 */
import React, { createRef } from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import {
  COR_DESENHO,
  EDITOR_VISUAL,
  LAYER_IDS,
  OPACIDADE_FILL_AREA,
  OPACIDADE_FILL_DESENHO,
  OPACIDADE_FILL_DESENHO_ABERTO,
  paintAreaDivisa,
  paintEditorMeios,
  paintEditorPreenchimento,
  paintEditorVertices,
  paintElastico,
  paintGuiaShift,
  raioCirculoMapLibre,
} from "@/lib/maplibre/estiloAreas.js";
import { ensureBusinessLayers } from "@/lib/maplibre/lifecycle.js";
import { buildDesenhoCollection, buildGuiaCollection } from "@/lib/maplibre/geojsonBuilders.js";
import { findNearestSnap, findNearestSnapDetalhado } from "@/lib/maplibre/snap.js";
import { acertoEditor, pontaGuiaShift, resolverAlvoDesenho, rumoGraus } from "@/lib/maplibre/editorVisual.js";
import CursorEditorOverlay from "@/components/mapa/CursorEditorOverlay";

/** Mapa falso: projeção linear 1° = 1000 px (y para baixo), sources/layers em memória. */
function mapaFalso(feats = []) {
  const layers = [];
  const sources = {};
  return {
    layers,
    getSource: (id) => sources[id],
    addSource: (id, s) => { sources[id] = s; },
    getLayer: (id) => layers.find((l) => l.id === id),
    addLayer: (l) => layers.push(l),
    project: ([lng, lat]) => ({ x: lng * 1000, y: -lat * 1000 }),
    unproject: ([x, y]) => ({ lng: x / 1000, lat: -y / 1000 }),
    queryRenderedFeatures: () => feats,
  };
}

const pts = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.1 }, { lat: -0.1, lng: 0.1 }, { lat: -0.1, lng: 0 }];

describe("D-PROD-66 — tokens da referência", () => {
  it("valores exatos de camada-desenho.tsx", () => {
    expect(COR_DESENHO).toBe("#f5a01b");
    expect(EDITOR_VISUAL.linha).toBe(2.2);
    expect(EDITOR_VISUAL.vertice).toEqual({ raio: 5, raioAtivo: 5.6, borda: 2.4 });
    expect(EDITOR_VISUAL.meio).toEqual({ raio: 2.8, raioHover: 3.4 });
    expect(EDITOR_VISUAL.ima.anel).toBe(8);
    expect(EDITOR_VISUAL.ima.anelBorda).toBe(1.6);
    expect(EDITOR_VISUAL.cruz).toEqual({ braco: 7, largura: 1.8 });
    expect(EDITOR_VISUAL.guiaShift.traco).toEqual([4, 6]);
    expect(EDITOR_VISUAL.guiaShift.largura).toBe(1.2);
    expect(OPACIDADE_FILL_DESENHO).toBe(0.18);
    expect(OPACIDADE_FILL_DESENHO_ABERTO).toBe(0.1);
  });

  it("VIS-03: círculo MapLibre compensa o traço por fora (SVG r5 + borda 2.4 → r3.8)", () => {
    expect(raioCirculoMapLibre(5, 2.4)).toBeCloseTo(3.8);
    const v = paintEditorVertices();
    expect(v["circle-radius"][2]).toBeCloseTo(4.4); // ativo 5.6
    expect(v["circle-radius"][3]).toBeCloseTo(3.8); // normal 5
    expect(v["circle-color"]).toBe("#ffffff");
    expect(v["circle-stroke-color"]).toBe(COR_DESENHO);
    expect(v["circle-stroke-width"]).toBe(2.4);
    expect(JSON.stringify(v["circle-radius"])).toContain('"feature-state","ativo"');
  });

  it("VIS-04: meio laranja sólido sem borda, 2.8 → 3.4 no hover", () => {
    const m = paintEditorMeios();
    expect(m["circle-radius"]).toEqual(["case", ["boolean", ["feature-state", "hover"], false], 3.4, 2.8]);
    expect(m["circle-opacity"]).toBe(1);
    expect(m["circle-stroke-width"]).toBe(0);
  });

  it("VIS-02: elástico sólido; Shift é guia ADICIONAL pontilhada 4/6 px", () => {
    expect(paintElastico()).toEqual({ "line-color": COR_DESENHO, "line-width": 2.2, "line-opacity": 1 });
    expect(paintElastico()).not.toHaveProperty("line-dasharray");
    const g = paintGuiaShift();
    expect(g["line-width"]).toBe(1.2);
    expect(g["line-dasharray"].map((v) => v * 1.2)).toEqual([expect.closeTo(4, 3), expect.closeTo(6, 3)]);
  });

  it("VIS-07: preenchimento — cor salva 0.78, fechado 0.18, aberto 0.1", () => {
    const op = paintEditorPreenchimento()["fill-opacity"];
    expect(op).toEqual(["case", ["has", "fill"], OPACIDADE_FILL_AREA, ["boolean", ["get", "fechado"], true], 0.18, 0.1]);
  });

  it("Mapa Geral/áreas cadastradas intactas (divisa branca fina)", () => {
    expect(paintAreaDivisa()["line-color"]).toBe("#ffffff");
  });
});

describe("D-PROD-66 — camadas (ordem, filtros, layout)", () => {
  it("ordem da referência e linhas com junta/ponta redondas", () => {
    const m = mapaFalso();
    ensureBusinessLayers(m);
    const ids = m.layers.map((l) => l.id).filter((id) => id.startsWith("m1-desenho") || id.startsWith("m1-ima") || id.startsWith("m1-guia") || id.startsWith("m1-v") || id.startsWith("m1-mid"));
    expect(ids).toEqual([
      LAYER_IDS.DESENHO_FILL, LAYER_IDS.IMA_ARESTA_HALO, LAYER_IDS.IMA_ARESTA, LAYER_IDS.DESENHO_LINE,
      LAYER_IDS.GUIA, LAYER_IDS.GUIA_SHIFT, LAYER_IDS.MIDPOINTS, LAYER_IDS.VERTICES_SELECAO, LAYER_IDS.VERTICES,
    ]);
    const linha = m.getLayer(LAYER_IDS.DESENHO_LINE);
    expect(linha.layout).toEqual({ "line-cap": "round", "line-join": "round" });
    expect(linha.filter).toEqual(["==", ["get", "contorno"], true]);
    expect(m.getLayer(LAYER_IDS.GUIA).filter).toEqual(["==", ["get", "tipo"], "elastico"]);
    expect(m.getLayer(LAYER_IDS.GUIA_SHIFT).filter).toEqual(["==", ["get", "tipo"], "shift"]);
    // idempotente (troca Mapa ↔ Satélite reaplica)
    const n = m.layers.length;
    ensureBusinessLayers(m);
    expect(m.layers.length).toBe(n);
  });
});

describe("D-PROD-66 — dados do desenho e do cursor", () => {
  it("VIS-01: aberto = polilinha sem o lado de fecho + polígono só para preenchimento", () => {
    const fc = buildDesenhoCollection(pts.slice(0, 3), "area", null, { fechado: false });
    const poly = fc.features.find((f) => f.geometry.type === "Polygon");
    const linha = fc.features.find((f) => f.geometry.type === "LineString");
    expect(poly.properties).toMatchObject({ fechado: false, contorno: false });
    expect(linha.properties.contorno).toBe(true);
    expect(linha.geometry.coordinates).toHaveLength(3); // sem voltar ao 1º
  });

  it("VIS-01/07: fechado = contorno inteiro; cor salva só quando fechado; zero é coordenada válida", () => {
    const fc = buildDesenhoCollection(pts, "area", null, { fechado: true, cor: "#92ca25" });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ contorno: true, fechado: true });
    expect(fc.features[0].properties.fill).toBeTruthy();
    expect(fc.features[0].geometry.coordinates[0][0]).toEqual([0, 0]);
    // padrão (sem `fechado`) preserva o comportamento anterior (GPS/outros callers)
    expect(buildDesenhoCollection(pts, "area").features[0].properties.contorno).toBe(true);
  });

  it("guia: elástico, Shift e aresta do ímã como feições tipadas; vazia sem origem", () => {
    const fc = buildGuiaCollection(pts[0], pts[1], { shiftAte: pts[2], imaAresta: [pts[2], pts[3]] });
    expect(fc.features.map((f) => f.properties.tipo).sort()).toEqual(["elastico", "ima-aresta", "shift"]);
    expect(buildGuiaCollection(null, null).features).toHaveLength(0);
    expect(buildGuiaCollection(null, null, { imaAresta: [pts[0], pts[1]] }).features.map((f) => f.properties.tipo)).toEqual(["ima-aresta"]);
  });

  it("snap detalhado tem a MESMA regra do snap (alvo idêntico) e diz vértice/aresta", () => {
    const m = mapaFalso();
    const areas = [{ coordenadas: { coords: [[0, 0], [0, 0.1], [-0.1, 0.1], [-0.1, 0]] } }];
    for (const mouse of [{ lat: 0.004, lng: -0.004 }, { lat: -0.004, lng: 0.004 }, { lat: -0.006, lng: 0.05 }, { lat: -0.05, lng: 0.05 }]) {
      const a = findNearestSnap(m, mouse, { areas });
      const d = findNearestSnapDetalhado(m, mouse, { areas });
      expect(a ? { lat: a.lat, lng: a.lng } : null).toEqual(d ? { lat: d.lat, lng: d.lng } : null);
    }
    expect(findNearestSnapDetalhado(m, { lat: 0.004, lng: -0.004 }, { areas }).tipo).toBe("vertice");
    const ar = findNearestSnapDetalhado(m, { lat: -0.006, lng: 0.05 }, { areas });
    expect(ar.tipo).toBe("aresta");
    expect(ar.aresta).toHaveLength(2);
    expect(findNearestSnapDetalhado(m, { lat: -0.004, lng: 0.004 }, { areas, enabled: false })).toBeNull();
  });

  it("alvo do cursor = alvo do clique: fechar no 1º, Shift trava 45°, Alt suspende o ímã", () => {
    const m = mapaFalso();
    const desenho = pts.slice(0, 3);
    const fechar = resolverAlvoDesenho(m, { lat: -0.005, lng: 0.005 }, { pontos: desenho, tipo: "area" });
    expect(fechar.ima).toEqual({ tipo: "fechar" });
    expect(fechar.alvo).toEqual(desenho[0]);
    const s = resolverAlvoDesenho(m, { lat: -0.2, lng: 0.27 }, { pontos: [{ lat: 0, lng: 0 }], tipo: "area", shift: true });
    expect(s.travado).toBe(true);
    expect(Math.abs(s.alvo.lat)).toBeCloseTo(Math.abs(s.alvo.lng), 6);
    const areas = [{ coordenadas: { coords: [[1, 1], [1, 1.1], [0.9, 1.1]] } }];
    expect(resolverAlvoDesenho(m, { lat: 1.004, lng: 0.996 }, { pontos: [], tipo: "area", areas }).ima?.tipo).toBe("vertice");
    expect(resolverAlvoDesenho(m, { lat: 1.004, lng: 0.996 }, { pontos: [], tipo: "area", areas, alt: true }).ima).toBeNull();
  });

  it("rumo e ponta da guia Shift (fórmulas da referência)", () => {
    expect(rumoGraus({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90);
    expect(rumoGraus({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(0);
    expect(pontaGuiaShift({ x: 0, y: 0 }, { x: 10, y: 20 })).toEqual({ x: 13.5, y: 27 });
  });

  it("VIS-04: acerto 8px no mouse e 14px no toque; vértice tem prioridade sobre o meio", () => {
    const f = (role, i, lng, lat) => ({ geometry: { type: "Point", coordinates: [lng, lat] }, properties: { role, index: i, id: `${role[0]}-${i}` } });
    const m = mapaFalso([f("midpoint", 0, 0.005, 0), f("vertex", 1, 0.03, 0)]);
    m.addLayer({ id: LAYER_IDS.VERTICES });
    m.addLayer({ id: LAYER_IDS.MIDPOINTS });
    const camadas = { vertices: LAYER_IDS.VERTICES, meios: LAYER_IDS.MIDPOINTS };
    expect(acertoEditor(m, { x: 5, y: 6 }, { camadas })).toMatchObject({ role: "midpoint", index: 0 });
    expect(acertoEditor(m, { x: 5, y: 10 }, { camadas })).toBeNull();
    expect(acertoEditor(m, { x: 5, y: 12 }, { camadas, toque: true })).toMatchObject({ role: "midpoint" });
    expect(acertoEditor(m, { x: 24, y: 0 }, { camadas })).toMatchObject({ role: "vertex", index: 1 });
  });
});

describe("D-PROD-66 — overlay do cursor (cruz/anel/rumo)", () => {
  it("não captura eventos e atualiza sem re-render; limpa tudo", () => {
    const ref = createRef();
    const { getByTestId } = render(<CursorEditorOverlay ref={ref} />);
    const raiz = getByTestId("editor-overlay");
    expect(raiz.className).toContain("pointer-events-none");
    const cruz = getByTestId("editor-cruzinha");
    const ima = getByTestId("editor-ima");
    expect(cruz.style.display).toBe("none");
    act(() => ref.current.atualizar({ cur: { x: 10, y: 20 }, cruz: true }));
    expect(cruz.style.display).toBe("");
    expect(cruz.getAttribute("transform")).toBe("translate(10.0 20.0)");
    expect(cruz.querySelector("line").getAttribute("x1")).toBe("-7");
    act(() => ref.current.atualizar({ cur: { x: 10, y: 20 }, cruz: true, ima: { tipo: "aresta" }, rumo: 45 }));
    expect(cruz.style.display).toBe("none"); // com ímã, só o anel+cruz do ímã
    expect(ima.getAttribute("data-tipo")).toBe("aresta");
    expect(ima.querySelector("circle").getAttribute("r")).toBe("8");
    expect(getByTestId("editor-rumo").textContent).toBe("45°");
    act(() => ref.current.limpar());
    expect(ima.style.display).toBe("none");
    expect(getByTestId("editor-rumo").style.display).toBe("none");
  });
});

describe("D-PROD-66 — editor (fonte)", () => {
  const src = readFileSync("src/components/mapa/MapaDesenho.jsx", "utf8");
  it("cursor e arrasto usam o overlay e limpam no unmount/troca de modo/pan", () => {
    expect(src).toContain("<CursorEditorOverlay ref={cursorRef} />");
    expect(src).toMatch(/map\.on\("movestart", onMoveStart\)/);
    expect(src).toMatch(/map\.off\("movestart", onMoveStart\)/);
    expect(src).toContain("cursorRef.current?.limpar()");
  });
  it("acerto de vértice/meio pelo mapa (não por camada) e meio sem arrasto insere no meio exato", () => {
    expect(src).toContain('map.on("mousedown", onPointerDown)');
    expect(src).not.toContain('map.on("mousedown", LAYER_IDS.MIDPOINTS');
    expect(src).toContain("after.splice(insertAfter + 1, 0, { ...st.meio })");
  });
  it("rótulos das áreas gravadas somem fora do NAVEGAR (referência ocultarRotulos={desenhando})", () => {
    expect(src).toMatch(/style\.visibility = modo === MODOS\.NAVEGAR \? "" : "hidden"/);
  });
});

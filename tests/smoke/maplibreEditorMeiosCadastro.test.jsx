/**
 * MAPLIBRE-PONTOS-MÉDIOS-NO-CADASTRO-03 (D-PROD-68) — pontos médios na área em
 * cadastro (ainda aberta): só nas arestas desenhadas; o de fecho só depois de fechar.
 * Prova WebGL: tests/e2e/harness/run-editor-meios-cadastro.cjs.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildMidpointsCollection } from "@/lib/maplibre/geojsonBuilders.js";
import { acertoEditor, pintarEdicao } from "@/lib/maplibre/editorVisual.js";
import { LAYER_IDS, SOURCE_IDS } from "@/lib/maplibre/estiloAreas.js";

const quad = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: -0.01, lng: 0.01 }, { lat: -0.01, lng: 0 }];
const coords = (fc) => fc.features.map((f) => f.geometry.coordinates);
const FECHO = [0, -0.005]; // meio de quad[3]→quad[0]

describe("A — buildMidpointsCollection", () => {
  it("área aberta com 2 pontos: 1 meio, nenhum de fecho", () => {
    const fc = buildMidpointsCollection(quad.slice(0, 2), "area", { fechado: false });
    expect(coords(fc)).toEqual([[0.005, 0]]);
  });
  it("área aberta com 4 pontos: 3 meios, sem o último→primeiro", () => {
    const fc = buildMidpointsCollection(quad, "area", { fechado: false });
    expect(fc.features).toHaveLength(3);
    expect(coords(fc)).not.toContainEqual(FECHO);
    expect(fc.features.map((f) => f.properties.index)).toEqual([0, 1, 2]);
  });
  it("área fechada com 4 pontos: 4 meios, inclui o último→primeiro (padrão inalterado)", () => {
    expect(coords(buildMidpointsCollection(quad, "area", { fechado: true }))).toContainEqual(FECHO);
    expect(buildMidpointsCollection(quad, "area").features).toHaveLength(4);
  });
  it("linha com N pontos: N−1 meios, nunca fecha (com ou sem `fechado`)", () => {
    expect(buildMidpointsCollection(quad, "linha").features).toHaveLength(3);
    expect(buildMidpointsCollection(quad, "linha", { fechado: true }).features).toHaveLength(3);
    expect(buildMidpointsCollection(quad.slice(0, 1), "area", { fechado: false }).features).toHaveLength(0);
  });
});

/** Mapa falso: guarda o último setData de cada source. */
function mapaFalso() {
  const dados = {};
  return { dados, getSource: (id) => ({ setData: (d) => { dados[id] = d; } }) };
}
const base = { pts: quad, marker: null, tipo: "area", fechado: false, previa: false, cor: null, arrastando: false, selecionado: null };

describe("pintarEdicao — por estado", () => {
  it("cadastro aberto (2+ vértices) pinta meios; arrasto e prévia escondem", () => {
    const m = mapaFalso();
    pintarEdicao(/** @type {any} */ (m), { ...base, pts: quad.slice(0, 2) });
    expect(m.dados[SOURCE_IDS.MIDPOINTS].features).toHaveLength(1);
    pintarEdicao(/** @type {any} */ (m), { ...base, arrastando: true });
    expect(m.dados[SOURCE_IDS.MIDPOINTS].features).toHaveLength(0);
    pintarEdicao(/** @type {any} */ (m), { ...base, previa: true });
    expect(m.dados[SOURCE_IDS.MIDPOINTS].features).toHaveLength(0);
    expect(m.dados[SOURCE_IDS.VERTICES].features).toHaveLength(0);
  });
  it("C — fechada/existente: 4 meios com o de fecho, como antes", () => {
    const m = mapaFalso();
    pintarEdicao(/** @type {any} */ (m), { ...base, fechado: true, cor: "#92ca25" });
    expect(coords(m.dados[SOURCE_IDS.MIDPOINTS])).toContainEqual(FECHO);
    expect(m.dados[SOURCE_IDS.MIDPOINTS].features).toHaveLength(4);
  });
  it("linha NOVA continua sem meios (criação de linhas inalterada)", () => {
    const m = mapaFalso();
    pintarEdicao(/** @type {any} */ (m), { ...base, tipo: "linha", fechado: false });
    expect(m.dados[SOURCE_IDS.MIDPOINTS].features).toHaveLength(0);
  });
});

describe("acerto no cadastro aberto: só pontos médios", () => {
  const f = (role, i, lng, lat) => ({ geometry: { type: "Point", coordinates: [lng, lat] }, properties: { role, index: i, id: `${role[0]}-${i}` } });
  const mapa = (feats) => ({
    getLayer: (id) => [LAYER_IDS.VERTICES, LAYER_IDS.MIDPOINTS].includes(id),
    project: ([lng, lat]) => ({ x: lng * 1000, y: -lat * 1000 }),
    queryRenderedFeatures: (_box, { layers }) => feats.filter((x) => layers.includes(x.properties.role === "vertex" ? LAYER_IDS.VERTICES : LAYER_IDS.MIDPOINTS)),
  });
  it("vertices: null ignora vértices (sem arrastar vértice no Desenhar) e acha o meio", () => {
    const m = mapa([f("vertex", 0, 0, 0), f("midpoint", 0, 0.02, 0)]);
    expect(acertoEditor(/** @type {any} */ (m), { x: 1, y: 0 }, { camadas: { vertices: null, meios: LAYER_IDS.MIDPOINTS } })).toBeNull();
    expect(acertoEditor(/** @type {any} */ (m), { x: 1, y: 0 }, { camadas: { vertices: LAYER_IDS.VERTICES, meios: LAYER_IDS.MIDPOINTS } })).toMatchObject({ role: "vertex" });
    expect(acertoEditor(/** @type {any} */ (m), { x: 19, y: 4 }, { camadas: { vertices: null, meios: LAYER_IDS.MIDPOINTS } })).toMatchObject({ role: "midpoint", index: 0 });
  });
});

describe("B — editor (fonte): interação no cadastro aberto", () => {
  const src = readFileSync("src/components/mapa/MapaDesenho.jsx", "utf8");
  it("habilita só os meios no Desenhar de área aberta; vértices/mover inalterados", () => {
    expect(src).toContain('const meiosNoCadastro = modoInteracao === MODOS.DESENHAR && tipoDesenho === "area" && !drawingClosed && !itemEditando;');
    expect(src).toContain("vertices: meiosNoCadastro ? null : LAYER_IDS.VERTICES");
    expect(src).toContain("if (modoInteracao !== MODOS.MOVER) return undefined;");
  });
  it("meio inserido no ponto exato da aresta (não na geometria quantizada do tile)", () => {
    expect(src).toContain("meioDaAresta(currentPointsRef.current, a.index");
    expect(src).toContain("after.splice(insertAfter + 1, 0, { ...st.meio })");
  });
  it("clique no meio não cria também o ponto final: o clique-adiciona respeita o arrasto em curso", () => {
    expect(src).toMatch(/if \(dragStateRef\.current\) return;\s*\n\s*const rect = canvas\.getBoundingClientRect\(\);/);
  });
});

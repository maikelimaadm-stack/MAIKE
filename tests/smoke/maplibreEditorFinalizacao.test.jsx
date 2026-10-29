/**
 * MAPLIBRE-EDITOR-PONTOS-FINALIZACAO-02 (D-PROD-67) — estados de fechar/finalizar
 * polígono como `confirmar()`/`sairDoDesenho()` do CONTROLE-DE-ESTOQUE.
 * Prova visual com WebGL real: tests/e2e/harness/run-editor-finalizacao.cjs.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SOURCE_IDS, corExibidaNoMapa } from "@/lib/maplibre/estiloAreas.js";
import { pintarEdicao } from "@/lib/maplibre/editorVisual.js";

/** Mapa falso: guarda o último setData de cada source. */
function mapaFalso() {
  const dados = {};
  const src = (id) => ({ setData: (d) => { dados[id] = d; } });
  return { dados, getSource: (id) => src(id) };
}
const quad = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: -0.01, lng: 0.01 }, { lat: -0.01, lng: 0 }];
const base = { pts: quad, marker: null, tipo: "area", fechado: false, previa: false, cor: null, arrastando: false, selecionado: null };

describe("D-PROD-67 — o que o editor pinta por estado", () => {
  it("A aberto: polilinha sem lado de fecho, vértices, sem meios", () => {
    const m = mapaFalso();
    pintarEdicao(/** @type {any} */ (m), base);
    const linhas = m.dados[SOURCE_IDS.DESENHO].features.filter((f) => f.geometry.type === "LineString");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].geometry.coordinates).toHaveLength(4); // não volta ao 1º
    expect(m.dados[SOURCE_IDS.VERTICES].features).toHaveLength(4);
    expect(m.dados[SOURCE_IDS.MIDPOINTS].features).toHaveLength(0);
  });

  it("B fechado: contorno inteiro e meio da aresta último→primeiro", () => {
    const m = mapaFalso();
    pintarEdicao(/** @type {any} */ (m), { ...base, fechado: true });
    const fc = m.dados[SOURCE_IDS.DESENHO].features;
    expect(fc).toHaveLength(1);
    expect(fc[0].properties).toMatchObject({ fechado: true, contorno: true });
    const meios = m.dados[SOURCE_IDS.MIDPOINTS].features;
    expect(meios).toHaveLength(4);
    // meio do lado 3→0 = (-0.01,0)…(0,0) → (-0.005, 0)
    expect(meios[3].geometry.coordinates).toEqual([0, -0.005]);
  });

  it("C selecionado/arrasto: anel só no selecionado; meios somem no arrasto", () => {
    const m = mapaFalso();
    pintarEdicao(/** @type {any} */ (m), { ...base, fechado: true, selecionado: 2, arrastando: true });
    expect(m.dados[SOURCE_IDS.VERTICES].features.filter((f) => f.properties.selecionado).map((f) => f.properties.index)).toEqual([2]);
    expect(m.dados[SOURCE_IDS.MIDPOINTS].features).toHaveLength(0);
  });

  it("D prévia (formulário aberto): geometria fechada na cor do formulário, NENHUM manipulador, pontos preservados", () => {
    const m = mapaFalso();
    const pts = quad.map((p) => ({ ...p }));
    pintarEdicao(/** @type {any} */ (m), { ...base, pts, fechado: false, previa: true, cor: "#f5a01b", selecionado: 1 });
    const fc = m.dados[SOURCE_IDS.DESENHO].features;
    expect(fc).toHaveLength(1);
    expect(fc[0].properties).toMatchObject({ fechado: true, contorno: true, fill: corExibidaNoMapa("#f5a01b") });
    expect(m.dados[SOURCE_IDS.VERTICES].features).toHaveLength(0);
    expect(m.dados[SOURCE_IDS.MIDPOINTS].features).toHaveLength(0);
    expect(pts).toEqual(quad); // não muta a geometria
  });

  it("ponto único mantém o marcador como prévia; linha sem fecho", () => {
    const m = mapaFalso();
    pintarEdicao(/** @type {any} */ (m), { ...base, tipo: "ponto", pts: [], marker: { lat: 0, lng: 0 }, previa: false });
    expect(m.dados[SOURCE_IDS.VERTICES].features).toHaveLength(1);
    const l = mapaFalso();
    pintarEdicao(/** @type {any} */ (l), { ...base, tipo: "linha", fechado: true });
    expect(l.dados[SOURCE_IDS.DESENHO].features[0].geometry.type).toBe("LineString");
  });
});

describe("D-PROD-67 — fluxo do editor (fonte)", () => {
  const src = readFileSync("src/components/mapa/MapaDesenho.jsx", "utf8");
  it("1º comando com área aberta (≥3) só fecha; formulário só no comando seguinte", () => {
    const fin = src.slice(src.indexOf("const finalizarDesenho = () => {"));
    expect(fin.indexOf("setDrawingClosed(true);")).toBeLessThan(fin.indexOf("setShowFormularioArea(true);"));
    expect(fin).toMatch(/if \(!drawingClosed && !itemEditando\) \{\s*if \(currentPoints\.length < 3\) return;\s*setDrawingClosed\(true\);/);
    expect(src).toContain('tipoDesenho === "area" ? "Fechar área" : "Terminar"');
  });
  it("formulário aberto desliga as interações do editor (modoInteracao) e o Delete", () => {
    expect(src).toContain("const modoInteracao = emPrevia ? MODOS.NAVEGAR : modo;");
    expect(src).not.toMatch(/podeAdicionarVertice\(modo, drawingClosed\)/);
    expect(src).not.toMatch(/podeEditarVertices\(modo, tipoDesenho\)/);
    expect(src).toContain("if (verticeSelecionado == null || emPrevia) return undefined;");
  });
  it("cancelar/salvar descartam a cor de prévia; currentPoints não é zerado para esconder manipuladores", () => {
    expect(src.match(/setCorPrevia\(null\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("onCorChange={setCorPrevia}");
  });
});

describe("D-PROD-67 — FormularioArea informa a cor escolhida", () => {
  it("chama onCorChange com a cor inicial (sem cor salva = padrão do formulário)", async () => {
    vi.resetModules();
    vi.doMock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
    const { default: FormularioArea } = await import("@/components/mapa/FormularioArea");
    const onCorChange = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    render(
      <QueryClientProvider client={qc}>
        <FormularioArea coordenadas={quad} onSave={() => {}} onCancel={() => {}} item={{ id: "a", nome: "X", coordenadas: { coords: [], cor: "#92ca25" } }} onCorChange={onCorChange} />
      </QueryClientProvider>
    );
    expect(onCorChange).toHaveBeenCalledWith("#92ca25");
    vi.doUnmock("@/hooks/useEmpresaSelecionadaId");
  });
});

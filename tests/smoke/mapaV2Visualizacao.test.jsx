// @vitest-environment jsdom
/**
 * D-PROD-131 — Mapa Geral: sem o ✕ e sem botão de fazenda/menu lateral;
 * painel "Visualização" (tipo de mapa, estilo e cores dos pastos, o que
 * mostrar); controles flutuantes; atribuição do satélite discreta.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import MapaControlesMobile from "@/components/mapa/MapaControlesMobile";
import MapaVisualizacao from "@/components/mapa/MapaVisualizacao";
import BasemapAtribuicao from "@/components/mapa/BasemapAtribuicao";
import { camadasDoMapa } from "@/components/mapa/MapaFiltrosAvancados";
import { aplicarEstiloPasto, paintEstiloPasto, MG_LAYER_IDS } from "@/lib/maplibre/mapaGeralRender";

afterEach(cleanup);

const controles = (extra = {}) => (
  <MapaControlesMobile mapType="roadmap" setMapType={() => {}} onRefresh={() => {}} onLocate={() => {}} onToggleDrag={() => {}} onOpenTarefas={() => {}} onOpenFiltros={() => {}} {...extra} />
);

describe("Shell e controles (D-PROD-131)", () => {
  it("cabeçalho sai só no celular/tablet; sem menu lateral nem fazenda no mapa", () => {
    const layout = readFileSync("src/Layout.jsx", "utf8");
    expect(layout).toMatch(/const telaMapa = currentPageName === PRIMARY_PAGE;/);
    expect(layout).not.toMatch(/MenuLateral|MapaShellContext/);
    const css = readFileSync("src/styles/mapa-geral.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 1023px\) \{\s*\.mk-shell--mapa > header \{\s*display: none !important;/);
    const fonte = readFileSync("src/components/mapa/MapaControlesMobile.jsx", "utf8");
    expect(fonte).not.toMatch(/navigate\(-1\)|Trocar empresa|Abrir menu/);
  });

  it("Visualização abre o painel e fecha pelo ✕", () => {
    render(controles({ painel: <p>conteúdo</p> }));
    fireEvent.click(screen.getByRole("button", { name: "Visualização do mapa: Mapa" }));
    expect(screen.getByRole("dialog", { name: "Visualização" }).textContent).toContain("conteúdo");
    fireEvent.click(screen.getByRole("button", { name: "Fechar visualização" }));
    expect(screen.queryByRole("dialog", { name: "Visualização" })).toBeNull();
  });

  it("Filtros não repete as camadas nem o 'Demarcar áreas por'", () => {
    const mg = readFileSync("src/pages/MapaGeral.jsx", "utf8");
    expect(mg).toMatch(/mostrarVisualizacao=\{false\}/);
    expect(mg).toMatch(/<MapaVisualizacao/);
  });
});

describe("Painel Visualização", () => {
  const painel = (extra = {}) => {
    const props = { mapType: "roadmap", setMapType: vi.fn(), estiloPasto: "cheio", setEstiloPasto: vi.fn(), modoColoracao: "padrao", setModoColoracao: vi.fn(), ...extra };
    render(<MapaVisualizacao {...props} />);
    return props;
  };

  it("tipo de mapa, estilo e cor dos pastos", () => {
    const p = painel();
    fireEvent.click(screen.getByRole("button", { name: "Satélite" }));
    fireEvent.click(screen.getByRole("button", { name: "Contorno" }));
    fireEvent.click(screen.getByRole("button", { name: "Ocupação" }));
    expect(p.setMapType).toHaveBeenCalledWith("satellite");
    expect(p.setEstiloPasto).toHaveBeenCalledWith("contorno");
    expect(p.setModoColoracao).toHaveBeenCalledWith("ocupacao");
    expect(screen.getByRole("button", { name: "Cheio" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("mostrar no mapa liga/desliga camadas, respeitando permissões", () => {
    const setShowLotes = vi.fn();
    const camadas = camadasDoMapa({ showAreas: true, showLotes: false, setShowLotes, showNomesAreas: true, showHectaresAreas: true, permissions: { visualizar_alertas: false } });
    expect(camadas.find((c) => c.id === "alertas")).toBeUndefined();
    painel({ camadas });
    const lotes = screen.getByRole("button", { name: "Lotes" });
    expect(lotes.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(lotes);
    expect(setShowLotes).toHaveBeenCalledTimes(1);
  });

  it("sem permissão de cores, só o tipo de mapa", () => {
    painel({ podeColorir: false });
    expect(screen.queryByRole("button", { name: "Contorno" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mapa" })).toBeTruthy();
  });
});

describe("Estilo dos pastos no mapa", () => {
  it("cheio, suave e contorno mudam opacidade e linha", () => {
    expect(paintEstiloPasto("cheio").fill["fill-opacity"]).toBeCloseTo(0.78);
    expect(paintEstiloPasto("suave").fill["fill-opacity"]).toBeCloseTo(0.4);
    const c = paintEstiloPasto("contorno");
    expect(c.fill["fill-opacity"]).toBeLessThan(0.15);
    expect(c.line["line-color"]).toEqual(["coalesce", ["get", "fill"], "#94a3b8"]);
  });

  it("aplica nas camadas existentes e o renderer reaplica após troca de basemap", () => {
    const set = vi.fn();
    aplicarEstiloPasto({ getLayer: (id) => id === MG_LAYER_IDS.AREAS_FILL || id === MG_LAYER_IDS.AREAS_LINE, setPaintProperty: set }, "suave");
    expect(set).toHaveBeenCalledWith(MG_LAYER_IDS.AREAS_FILL, "fill-opacity", 0.4);
    const r = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(r.match(/aplicarEstiloPasto\(map, estiloPastoRef\.current\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Atribuição e aviso do satélite discretos", () => {
  const LONGO = "Imagens ©2026 Airbus, CNES / Airbus, Maxar Technologies, Planet.com — Dados do mapa ©2026";

  it("texto longo fica atrás de 'Fontes de dados' e aparece inteiro ao tocar", () => {
    render(<BasemapAtribuicao atribuicao={LONGO} status="pronto" />);
    expect(screen.getByTestId("basemap-atribuicao-texto").className).toBe("sr-only");
    expect(screen.queryByRole("region", { name: "Fontes de dados do mapa" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Fontes de dados/ }));
    expect(screen.getByRole("region", { name: "Fontes de dados do mapa" }).textContent).toBe(LONGO);
  });

  it("aviso de falha compacto: Tentar novamente e fechar", () => {
    const onRetry = vi.fn();
    render(<BasemapAtribuicao status="erro" mensagem="Satélite não configurado." onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Satélite indisponível");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

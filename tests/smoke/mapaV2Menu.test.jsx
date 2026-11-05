// @vitest-environment jsdom
/**
 * D-PROD-131 — Mapa Geral como tela de entrada: sem cabeçalho do sistema por
 * cima, ☰ no lugar do ✕ abre o menu lateral, controles flutuantes novos,
 * atribuição do satélite discreta e aviso compacto.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import MenuLateral from "@/components/navigation/MenuLateral";
import MapaControlesMobile from "@/components/mapa/MapaControlesMobile";
import BasemapAtribuicao from "@/components/mapa/BasemapAtribuicao";
import { MapaShellContext } from "@/lib/mapaShellContext";

afterEach(cleanup);

const MENU = [
  { id: "mapa", title: "Mapa", submenu: [{ id: "m1", title: "Mapa Geral", url: "MapaGeral" }, { id: "m2", title: "Cadastro do Mapa", url: "MapaCadastro" }] },
  { id: "manejo", title: "Manejo", submenu: [{ id: "l1", title: "Lotes", url: "CadastroLotes" }] },
];

const controles = (extra = {}) => (
  <MapaControlesMobile mapType="roadmap" setMapType={() => {}} onRefresh={() => {}} onLocate={() => {}} onToggleDrag={() => {}} onOpenTarefas={() => {}} onOpenFiltros={() => {}} {...extra} />
);

describe("Shell: o mapa entra sem o cabeçalho do sistema (D-PROD-131)", () => {
  it("Layout marca a tela do mapa e o CSS tira cabeçalho e barra de módulos", () => {
    const layout = readFileSync("src/Layout.jsx", "utf8");
    expect(layout).toMatch(/const telaMapa = currentPageName === PRIMARY_PAGE;/);
    expect(layout).toMatch(/telaMapa \? " mk-shell--mapa" : ""/);
    expect(layout).toMatch(/<MapaShellContext\.Provider value=\{mapaShell\}>/);
    const css = readFileSync("src/styles/mapa-geral.css", "utf8");
    expect(css).toMatch(/\.mk-shell--mapa > header,\s*\.mk-shell--mapa > nav\[aria-label="Módulos"\] \{\s*display: none !important;/);
    expect(readFileSync("src/index.css", "utf8")).toContain('@import "./styles/mapa-geral.css";');
  });

  it("sem o ✕ que voltava a tela (navigate(-1))", () => {
    const fonte = readFileSync("src/components/mapa/MapaControlesMobile.jsx", "utf8");
    expect(fonte).not.toMatch(/navigate\(-1\)/);
  });
});

describe("Controles do mapa", () => {
  it("☰ abre o menu e o nome da fazenda troca a empresa", () => {
    const abrirMenu = vi.fn();
    const trocarEmpresa = vi.fn();
    render(
      <MapaShellContext.Provider value={{ abrirMenu, trocarEmpresa, empresaNome: "Fazenda Boa Vista" }}>{controles()}</MapaShellContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(abrirMenu).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Trocar empresa" }));
    expect(trocarEmpresa).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Fazenda Boa Vista")).toBeTruthy();
  });

  it("fora do Layout não há ☰", () => {
    render(controles());
    expect(screen.queryByRole("button", { name: "Abrir menu" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filtros" })).toBeTruthy();
  });

  it("Camadas: Mapa/Satélite numa escolha só", () => {
    const setMapType = vi.fn();
    render(controles({ setMapType }));
    fireEvent.click(screen.getByRole("button", { name: "Camadas do mapa: Mapa" }));
    fireEvent.click(screen.getByRole("button", { name: "Satélite" }));
    expect(setMapType).toHaveBeenCalledWith("satellite");
    expect(screen.queryByRole("group", { name: "Tipo de mapa" })).toBeNull();
  });
});

describe("Menu lateral", () => {
  const abrir = (extra = {}) => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <MenuLateral open onClose={onClose} menuItems={MENU} paginaAtualUrl="MapaGeral" empresaNome="Fazenda Boa Vista" onTrocarEmpresa={() => {}} usuario={{ full_name: "Maike Lima", email: "m@x.com" }} onSair={() => {}} onAbrirTela={() => {}} {...extra} />
      </MemoryRouter>,
    );
    return onClose;
  };

  it("lista módulos e telas, com a tela atual marcada", () => {
    abrir();
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mapa Geral" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Lotes" })).toBeTruthy();
    expect(screen.getByText("Maike Lima")).toBeTruthy();
  });

  it("busca filtra as telas", () => {
    abrir();
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar tela" }), { target: { value: "lot" } });
    expect(screen.queryByRole("link", { name: "Mapa Geral" })).toBeNull();
    expect(screen.getByRole("link", { name: "Lotes" })).toBeTruthy();
  });

  it("fecha pelo ✕, pelo Esc e ao abrir uma tela", () => {
    const onClose = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Fechar menu" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Menu" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("link", { name: "Lotes" }));
    expect(onClose).toHaveBeenCalledTimes(3);
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

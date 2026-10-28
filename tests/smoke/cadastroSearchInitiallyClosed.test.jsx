/**
 * MotorBase1 — pesquisa integrada inicia fechada (lupa); abre só por clique.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

const chromeSearchProps = {
  searchValue: "",
  onSearchChange: vi.fn(),
  onSearchApply: vi.fn(),
  searchActive: false,
  searchPlaceholder: "Buscar…",
};

const renderIntegrated = (extra = {}) =>
  render(
    <CadastroListaChrome
      {...BASE1_LISTA_INTEGRADA_VISUAL.chrome}
      selectedCount={0}
      viewMode="table"
      onViewModeChange={vi.fn()}
      {...chromeSearchProps}
      {...extra}
    >
      <div data-testid="list-child">lista</div>
    </CadastroListaChrome>,
  );

describe("CadastroListaChrome — pesquisa integrada fechada ao montar", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query) => ({
      matches: query.includes("min-width: 640px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("viewport largo: mostra lupa e não o input (joinTableToolbar)", () => {
    renderIntegrated();
    expect(screen.getByLabelText("Abrir pesquisa")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Buscar…")).toBeNull();
  });

  it("clique na lupa revela o campo de busca", () => {
    renderIntegrated();
    fireEvent.click(screen.getByLabelText("Abrir pesquisa"));
    expect(screen.getByPlaceholderText("Buscar…")).toBeTruthy();
  });

  it("busca aplicada permanece ao fechar UI (valor committed)", () => {
    const { rerender } = renderIntegrated({
      searchValue: "alpha",
      searchCommittedValue: "alpha",
      searchActive: true,
    });
    fireEvent.click(screen.getByLabelText("Abrir pesquisa"));
    expect(screen.getByDisplayValue("alpha")).toBeTruthy();
    fireEvent.blur(screen.getByPlaceholderText("Buscar…"), {
      relatedTarget: document.body,
    });
    rerender(
      <CadastroListaChrome
        {...BASE1_LISTA_INTEGRADA_VISUAL.chrome}
        selectedCount={0}
        viewMode="table"
        onViewModeChange={vi.fn()}
        searchValue="alpha"
        searchCommittedValue="alpha"
        searchActive={true}
        onSearchChange={vi.fn()}
        onSearchApply={vi.fn()}
        searchPlaceholder="Buscar…"
      >
        <div data-testid="list-child">lista</div>
      </CadastroListaChrome>,
    );
    expect(screen.getByLabelText("Abrir pesquisa")).toBeTruthy();
  });

  it("ramo legado joinTableToolbar=false mantém pill visível", () => {
    render(
      <CadastroListaChrome
        joinTableToolbar={false}
        selectedCount={0}
        viewMode="table"
        onViewModeChange={vi.fn()}
        {...chromeSearchProps}
      >
        <div>lista</div>
      </CadastroListaChrome>,
    );
    expect(screen.getByPlaceholderText("Buscar…")).toBeTruthy();
    expect(screen.queryByLabelText("Abrir pesquisa")).toBeNull();
  });
});

/**
 * MOTORBASE1-GLOBAL-SELECT-TITLE-01 — checkbox global Base1 + título visível no workspace.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import TabelaMarcas, { MARCAS_COLUNAS, getMarcaFieldValue } from "@/components/marcas/TabelaMarcas";
import TabelaSetores from "@/components/setores/TabelaSetores";
import TabelaUnidadesMedida from "@/components/unidades-medida/TabelaUnidadesMedida";
import TabelaLocaisEstoque from "@/components/locais-estoque/TabelaLocaisEstoque";
import { Base1Cards } from "@/components/cadastro/base1/Base1Cards";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

const MARCAS_FIXTURE = [
  { id: "m1", numero_marca: "1", nome: "MARCA A", descricao: "A", ativo: true },
  { id: "m2", numero_marca: "2", nome: "MARCA B", descricao: "B", ativo: true },
  { id: "m3", numero_marca: "3", nome: "MARCA C", descricao: "C", ativo: true },
];

function renderWithProviders(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

function GradeHarness({ rows, displayLimit, onSelectionChange, onOpen = vi.fn() }) {
  return (
    <CadastroBase1Grade
      rows={rows}
      columns={MARCAS_COLUNAS}
      storageKey="test_global_select_marcas"
      droppableId="test-global-marcas"
      getFieldValue={getMarcaFieldValue}
      defaultSortKey="nome"
      searchQuery=""
      resetFiltersKey={0}
      onSelectionChange={onSelectionChange}
      onFiltersActiveChange={() => {}}
      viewMode="table"
      displayLimit={displayLimit}
      onOpen={onOpen}
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
    />
  );
}

function MarcasAdapterHarness({ onSelectionChange, onOpen = vi.fn() }) {
  return (
    <TabelaMarcas
      marcas={MARCAS_FIXTURE}
      isLoading={false}
      searchQuery=""
      resetFiltersKey={0}
      onSelectionChange={onSelectionChange}
      onFiltersActiveChange={() => {}}
      viewMode="table"
      onEdit={onOpen}
      showConfigColunas={false}
      setShowConfigColunas={() => {}}
    />
  );
}

describe("MOTORBASE1-GLOBAL-SELECT-TITLE-01 — checkbox adapters piloto", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    ["Marcas", MarcasAdapterHarness],
  ])("%s — coluna Selecionar todos e por linha", (_label, Harness) => {
    renderWithProviders(<Harness onSelectionChange={vi.fn()} />);
    expect(screen.getByLabelText("Selecionar todos")).toBeTruthy();
    expect(screen.getAllByLabelText("Selecionar linha").length).toBe(3);
  });

  it("Marcas — checkbox não dispara onOpen", () => {
    const onOpen = vi.fn();
    renderWithProviders(<MarcasAdapterHarness onSelectionChange={vi.fn()} onOpen={onOpen} />);
    fireEvent.click(screen.getAllByLabelText("Selecionar linha")[0]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("Marcas — onSelectionChange com id correto", () => {
    const onSelectionChange = vi.fn();
    renderWithProviders(<MarcasAdapterHarness onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getAllByLabelText("Selecionar linha")[1]);
    expect(onSelectionChange).toHaveBeenCalled();
    const last = onSelectionChange.mock.calls.at(-1)[0];
    expect(last).toEqual(["m2"]);
  });

  it("Setores/Unidades/Locais/Categorias — fonte sem colunaSelecao=false", async () => {
    const { readFileSync } = await import("node:fs");
    const paths = [
      "src/components/setores/TabelaSetores.jsx",
      "src/components/unidades-medida/TabelaUnidadesMedida.jsx",
      "src/components/locais-estoque/TabelaLocaisEstoque.jsx",
      "src/components/categorias-produto/TabelaCategoriasProduto.jsx",
    ];
    for (const p of paths) {
      expect(readFileSync(p, "utf8")).not.toMatch(/colunaSelecao=\{false\}/);
    }
  });
});

describe("MOTORBASE1-GLOBAL-SELECT-TITLE-01 — selecionar todos visível", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("displayLimit — selecionar todos só janela visível", () => {
    const onSelectionChange = vi.fn();
    renderWithProviders(
      <GradeHarness rows={MARCAS_FIXTURE} displayLimit={2} onSelectionChange={onSelectionChange} />,
    );
    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    const last = onSelectionChange.mock.calls.at(-1)[0].sort();
    expect(last).toEqual(["m1", "m2"]);
  });

  it("desmarcar todos visível zera só itens da janela", () => {
    const onSelectionChange = vi.fn();
    renderWithProviders(
      <GradeHarness rows={MARCAS_FIXTURE} displayLimit={2} onSelectionChange={onSelectionChange} />,
    );
    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    expect(onSelectionChange.mock.calls.at(-1)[0].sort()).toEqual(["m1", "m2"]);
    fireEvent.click(screen.getByLabelText("Selecionar todos"));
    expect(onSelectionChange.mock.calls.at(-1)[0]).toEqual([]);
  });
});

describe("MOTORBASE1-GLOBAL-SELECT-TITLE-01 — cards", () => {
  beforeEach(() => cleanup());

  it("checkbox visível em cada card e alterna seleção", () => {
    const selected = new Set();
    const onToggle = vi.fn((id) => {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    });
    const { rerender } = render(
      <Base1Cards
        rows={MARCAS_FIXTURE.slice(0, 2)}
        columns={MARCAS_COLUNAS}
        fields={["descricao"]}
        perRow={2}
        selected={selected}
        onSelectClick={vi.fn()}
        onToggle={onToggle}
        getFieldValue={getMarcaFieldValue}
        titleColId="nome"
        codeColId="numero"
      />,
    );
    const cards = screen.getAllByTestId("b1-card");
    expect(within(cards[0]).getByLabelText(/Selecionar MARCA A/i)).toBeTruthy();
    fireEvent.click(within(cards[0]).getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledWith("m1");
    selected.add("m1");
    rerender(
      <Base1Cards
        rows={MARCAS_FIXTURE.slice(0, 2)}
        columns={MARCAS_COLUNAS}
        fields={["descricao"]}
        perRow={2}
        selected={selected}
        onSelectClick={vi.fn()}
        onToggle={onToggle}
        getFieldValue={getMarcaFieldValue}
        titleColId="nome"
        codeColId="numero"
      />,
    );
    expect(within(cards[0]).getByRole("checkbox")).toHaveProperty("checked", true);
  });
});

describe("MOTORBASE1-GLOBAL-SELECT-TITLE-01 — título workspace", () => {
  beforeEach(() => {
    cleanup();
    vi.stubGlobal("matchMedia", (query) => ({
      matches: query.includes("min-width: 640px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["Produtos", "Produtos"],
    ["Marcas", "Marcas"],
    ["Tipos de tarefa", "Tipos de tarefa"],
    ["Categorias de manejo", "Categorias de manejo"],
  ])("base1-list — h1 visível %s antes da toolbar", (title, expected) => {
    render(
      <CadastroWorkspace title={title} pageLayout="base1-list">
        <CadastroListaChrome
          {...BASE1_LISTA_INTEGRADA_VISUAL.chrome}
          createLabel="Novo"
          onNew={() => {}}
          searchPlaceholder="Buscar"
          searchValue=""
          onSearchChange={() => {}}
          selectedCount={0}
          onEdit={() => {}}
          onDuplicate={() => {}}
          onDelete={() => {}}
          viewMode="table"
          onViewModeChange={() => {}}
        />
        <div data-testid="grade-slot">grade</div>
      </CadastroWorkspace>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: expected });
    expect(heading.className).not.toMatch(/sr-only/);
    const toolbar = screen.getByRole("button", { name: "Novo" });
    expect(
      heading.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("layout default mantém CadastroWorkspaceHeader único", () => {
    render(
      <CadastroWorkspace title="Empresa" pageLayout="default">
        <div>conteúdo</div>
      </CadastroWorkspace>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Empresa" })).toBeTruthy();
    expect(document.querySelector(".cadastro-b1__page-title")).toBeNull();
  });
});

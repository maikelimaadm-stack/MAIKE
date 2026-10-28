/**
 * MOTORBASE1-ROLLOUT-03 — Categorias hierárquicas no motor Base1.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import {
  buildHierarchy,
  flattenHierarchyOrdered,
  prepareCategoriasExportRows,
} from "@/components/categorias-produto/TabelaCategoriasProduto.jsx";

const serviceMock = {
  listarTodasCategorias: vi.fn(),
};

vi.mock("@/services/categoriaProdutoService", () => ({
  listarTodasCategorias: (...a) => serviceMock.listarTodasCategorias(...a),
  criarCategoria: vi.fn(),
  atualizarCategoria: vi.fn(),
  excluirCategorias: vi.fn(),
}));

vi.mock("@/lib/maikeNotify", () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));

vi.mock("@/components/common/ConfirmDialog", () => ({
  default: () => null,
}));

const gradePropsSpy = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-categorias">grade</div>;
  },
}));

const CATS = [
  { id: "r1", nome: "RAIZ", ordem: 1, ativo: true },
  { id: "f1", nome: "FILHA", categoria_pai_id: "r1", ordem: 1, ativo: true },
];

const renderPagina = async () => {
  gradePropsSpy.mockClear();
  const { default: Categorias } = await import("@/pages/Categorias");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Categorias />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
};

beforeEach(() => {
  serviceMock.listarTodasCategorias.mockResolvedValue(CATS);
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("Categorias — rollout MotorBase1 hierárquico", () => {
  it("importa controller hierárquico e CadastroBase1Screen", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const code = fs.readFileSync(path.join(process.cwd(), "src/pages/Categorias.jsx"), "utf8");
    expect(code).toMatch(/useCadastroBase1HierarchicalController/);
    expect(code).toMatch(/CadastroBase1Screen/);
    expect(code).not.toMatch(/CadastroWorkspace/);
  });

  it("carrega lista completa via listarTodasCategorias (sem fetchPage)", async () => {
    await renderPagina();
    await waitFor(() => {
      expect(serviceMock.listarTodasCategorias).toHaveBeenCalled();
    });
    expect(serviceMock.listarTodasCategorias.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("grade usa preset integrado, storageKey e badge ativo", async () => {
    await renderPagina();
    await waitFor(() => {
      expect(screen.getByTestId("grade-categorias")).toBeTruthy();
    });
    const props = gradePropsSpy.mock.calls.at(-1)?.[0];
    expect(props.storageKey).toBe("colunas_categorias_produto");
    expect(props.droppableId).toBe("colunas-categorias-produto");
    expect(props.referenceHeaders).toBe(BASE1_LISTA_INTEGRADA_VISUAL.grade.referenceHeaders);
    const ativoCol = props.columns.find((c) => c.id === "ativo");
    expect(ativoCol?.cellKind).toBeDefined();
  });

  it("pesquisa integrada inicia fechada", async () => {
    await renderPagina();
    await waitFor(() => {
      expect(screen.getByLabelText("Abrir pesquisa")).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText("Buscar categorias…")).toBeNull();
  });
});

describe("Categorias — escala full-list (120+ nós)", () => {
  it("não trunca árvore nem perde filhos fora de página hipotética", () => {
    /** @type {Array<{ id: string, categoria_pai_id?: string, ordem: number, nome: string }>} */
    const items = [];
    for (let i = 0; i < 120; i += 1) {
      items.push({
        id: `n${i}`,
        nome: `CAT ${i}`,
        ordem: i,
        categoria_pai_id: i > 0 ? `n${i - 1}` : undefined,
      });
    }
    const { indice } = buildHierarchy(items);
    expect(indice.size).toBe(120);
    const ordered = flattenHierarchyOrdered(items);
    expect(ordered).toHaveLength(120);
    expect(ordered[119].id).toBe("n119");
  });

  it("export filtrado não inclui ancestrais extras", () => {
    const items = [
      { id: "a", nome: "A", ordem: 1 },
      { id: "b", nome: "B", categoria_pai_id: "a", ordem: 1 },
      { id: "c", nome: "C", categoria_pai_id: "b", ordem: 1 },
    ];
    const rows = prepareCategoriasExportRows(items, { appliedSearch: "C", searchPickId: null });
    expect(rows.map((r) => r.id)).toEqual(["c"]);
  });
});

/**
 * MOTORBASE1-ROLLOUT-04 — Produtos consome motor Base1 + paginação nativa.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

const serviceMock = {
  listarProdutosPagina: vi.fn(),
};

vi.mock("@/services/produtoService", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listarProdutosPagina: (...a) => serviceMock.listarProdutosPagina(...a),
    criarProduto: vi.fn(),
    atualizarProduto: vi.fn(),
    excluirProdutos: vi.fn(),
    importarProdutos: vi.fn(),
    listarProdutosDaEmpresa: vi.fn(),
  };
});

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({
  useEmpresaSelecionadaId: () => "emp-1",
}));

const PAGE_ENVELOPE = {
  items: [],
  next_cursor: null,
  has_more: false,
  total: 0,
  limit: 100,
};

vi.mock("@/lib/maikeNotify", () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));

vi.mock("@/components/common/ConfirmDialog", () => ({
  default: () => null,
}));

vi.mock("../components/produtos/FichaProduto", () => ({
  default: () => null,
}));

const gradePropsSpy = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-produtos">grade</div>;
  },
}));

const PRODUTOS = [
  {
    id: "p1",
    nome_produto: "MILHO",
    numero_produto: "1",
    ativo: true,
    empresa_id: "emp-1",
  },
];

const renderPagina = async () => {
  gradePropsSpy.mockClear();
  const { default: Produtos } = await import("@/pages/Produtos");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Produtos />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
};

beforeEach(() => {
  serviceMock.listarProdutosPagina.mockResolvedValue({ ...PAGE_ENVELOPE, items: PRODUTOS, total: 1 });
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("Produtos — rollout MotorBase1", () => {
  it("importa controller/screen e chama listarProdutosPagina com empresa", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const code = fs.readFileSync(path.join(process.cwd(), "src/pages/Produtos.jsx"), "utf8");
    expect(code).toMatch(/useCadastroBase1Controller/);
    expect(code).toMatch(/CadastroBase1Screen/);

    await renderPagina();
    await waitFor(() => {
      expect(serviceMock.listarProdutosPagina).toHaveBeenCalled();
    });
    const firstCall = serviceMock.listarProdutosPagina.mock.calls[0];
    expect(firstCall[0]).toBe("emp-1");
  });

  it("grade usa preset integrado, storageKey histórico e badge ativo SSOT", async () => {
    await renderPagina();
    await waitFor(() => {
      expect(screen.getByTestId("grade-produtos")).toBeTruthy();
    });
    const props = gradePropsSpy.mock.calls.at(-1)?.[0];
    expect(props.storageKey).toBe("colunas_produtos_v2");
    expect(props.droppableId).toBe("colunas-produtos");
    expect(props.cardsTitleColId).toBe("nome");
    expect(props.cardsCodeColId).toBe("numero");
    expect(props.referenceHeaders).toBe(BASE1_LISTA_INTEGRADA_VISUAL.grade.referenceHeaders);
    const ativoCol = props.columns.find((c) => c.id === "ativo");
    expect(ativoCol?.cellKind).toBeDefined();
  });
});

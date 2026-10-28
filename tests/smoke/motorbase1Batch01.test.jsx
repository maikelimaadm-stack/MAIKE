/**
 * MOTORBASE1-BATCH-01 — menu Produtos, Novo universal, batch cadastros tarefas/manejo.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";

const serviceMock = {
  listarProdutosPagina: vi.fn(),
  listarGrupos: vi.fn(),
  listarTipos: vi.fn(),
  listarGruposSimples: vi.fn(),
  listarCategoriasManejoDaEmpresa: vi.fn(),
  listarIconesDeLoteDaEmpresa: vi.fn(),
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
    carregarFontesDoFormulario: vi.fn(async () => ({
      categorias: [],
      unidades: [],
      locais: [],
      marcas: [],
    })),
  };
});

vi.mock("@/services/tarefaCadastroService", () => ({
  listarGrupos: (...a) => serviceMock.listarGrupos(...a),
  listarTipos: (...a) => serviceMock.listarTipos(...a),
  listarGruposSimples: (...a) => serviceMock.listarGruposSimples(...a),
  criarGrupo: vi.fn(),
  atualizarGrupo: vi.fn(),
  excluirGrupos: vi.fn(),
  criarTipo: vi.fn(),
  atualizarTipo: vi.fn(),
  excluirTipos: vi.fn(),
}));

vi.mock("@/services/categoriaProdutoService", () => ({
  listarTodasCategorias: vi.fn().mockResolvedValue([]),
  criarCategoria: vi.fn(),
  atualizarCategoria: vi.fn(),
  excluirCategorias: vi.fn(),
}));

vi.mock("@/services/categoriaManejoService", () => ({
  listarCategoriasManejoDaEmpresa: (...a) => serviceMock.listarCategoriasManejoDaEmpresa(...a),
  listarIconesDeLoteDaEmpresa: (...a) => serviceMock.listarIconesDeLoteDaEmpresa(...a),
  criarCategoriaManejo: vi.fn(),
  atualizarCategoriaManejo: vi.fn(),
  excluirCategoriaManejo: vi.fn(),
}));

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({
  useEmpresaSelecionadaId: () => "emp-1",
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

vi.mock("@/components/produtos/FichaProduto", () => ({
  default: () => null,
}));

const PAGE_ENVELOPE = {
  items: [],
  next_cursor: null,
  has_more: false,
  total: 0,
  limit: 100,
};

describe("MOTORBASE1-BATCH-01", () => {
  beforeEach(() => {
    serviceMock.listarProdutosPagina.mockResolvedValue(PAGE_ENVELOPE);
    serviceMock.listarGrupos.mockResolvedValue([]);
    serviceMock.listarTipos.mockResolvedValue([]);
    serviceMock.listarGruposSimples.mockResolvedValue([]);
    serviceMock.listarCategoriasManejoDaEmpresa.mockResolvedValue([]);
    serviceMock.listarIconesDeLoteDaEmpresa.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("CadastroListaChrome — additionalMoreActions aparece no menu Mais opções", async () => {
    const onRefresh = vi.fn();
    render(
      <CadastroListaChrome
        onNew={() => {}}
        additionalMoreActions={[
          { key: "refresh", label: "Atualizar lista", onSelect: onRefresh },
          { key: "import", label: "Importar CSV", onSelect: vi.fn() },
        ]}
        exportCsvLabel="Exportar janela carregada (CSV)"
        onExportCsv={() => {}}
      >
        <div>grade</div>
      </CadastroListaChrome>,
    );

    expect(screen.queryByRole("button", { name: /Atualizar lista/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
    expect(screen.getByText(/Atualizar lista/i)).toBeTruthy();
    expect(screen.getByText(/Exportar janela carregada/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/Atualizar lista/i));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("Produtos — sem extraToolbar duplicada; import dispara input file", async () => {
    const { default: Produtos } = await import("@/pages/Produtos");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Produtos />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(serviceMock.listarProdutosPagina).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /^Atualizar$/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Novo" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Mais opções" }));
    await waitFor(() => {
      expect(screen.getByText(/Atualizar lista/i)).toBeTruthy();
      expect(screen.getByText(/Exportar todos os produtos/i)).toBeTruthy();
      expect(screen.getByText(/Exportar janela carregada/i)).toBeTruthy();
      expect(screen.getByText(/Baixar modelo CSV/i)).toBeTruthy();
      expect(screen.getByText(/Importar CSV/i)).toBeTruthy();
    });

    const input = document.querySelector('input[type="file"][accept=".csv"]');
    expect(input).toBeTruthy();
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByText(/Importar CSV/i));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("FormularioProduto — grid B1Field e condicional Nutrição Animal", async () => {
    const { default: FormularioProduto } = await import("@/components/produtos/FormularioProduto");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (ui) => (
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    );
    render(
      wrap(
        <FormularioProduto
          variant="embedded"
          toolbarActions
          readOnly={false}
          initialData={{ tipo_uso: "Operacional" }}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      ),
    );
    expect(screen.getByTestId("b1-form-produto")).toHaveClass("mg-b1-form-grid");
    expect(screen.queryByText(/Configuração de Suplementação/i)).toBeNull();
    cleanup();

    render(
      wrap(
        <FormularioProduto
          key="nutricao"
          variant="embedded"
          toolbarActions
          readOnly={true}
          initialData={{ tipo_uso: "Nutrição Animal", nome_produto: "SAL" }}
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
        />,
      ),
    );
    expect(screen.getByText(/Configuração de Suplementação/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sugerir valores/i })).toBeNull();
  });

  it("Categorias produto — botão Novo", async () => {
    const { default: Categorias } = await import("@/pages/Categorias");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Categorias />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Novo" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Nova categoria/i })).toBeNull();
  });

  it("GruposAtividades — CadastroBase1Screen com grade real", async () => {
    serviceMock.listarGrupos.mockResolvedValue([
      { id: "g1", nome_grupo: "PASTAGEM", ativo: true },
    ]);
    const { default: GruposAtividades } = await import("@/pages/GruposAtividades");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GruposAtividades />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("PASTAGEM")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Novo" })).toBeTruthy();
  });

  it("TiposTarefa — formulário exige grupo e preserva flags", async () => {
    serviceMock.listarGruposSimples.mockResolvedValue([
      { id: "g1", nome_grupo: "GERAL", ativo: true },
    ]);
    serviceMock.listarTipos.mockResolvedValue([]);
    const { default: TiposTarefa } = await import("@/pages/TiposTarefa");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <TiposTarefa />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Novo" }));
    expect(screen.getByTestId("b1-form-tipo-tarefa")).toBeTruthy();
    expect(screen.getByLabelText(/Exige área/i)).toBeTruthy();
    fireEvent.submit(document.getElementById("formulario-tipo-tarefa-base1"));
    await waitFor(() => expect(screen.getAllByText("Obrigatório").length).toBeGreaterThan(0));
  });

  it("CategoriasManejo — queryKey inclui empresa e form 12 GMDs", async () => {
    serviceMock.listarCategoriasManejoDaEmpresa.mockResolvedValue([]);
    const { default: CategoriasManejo } = await import("@/pages/CategoriasManejo");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CategoriasManejo />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(serviceMock.listarCategoriasManejoDaEmpresa).toHaveBeenCalledWith("emp-1"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Novo" }));
    const form = screen.getByTestId("b1-form-categoria-manejo");
    expect(form.querySelectorAll('input[type="number"]').length).toBeGreaterThanOrEqual(15);
  });
});

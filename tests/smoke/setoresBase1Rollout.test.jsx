/**
 * MOTORBASE1-ROLLOUT-02 — Setores consome motor Base1 + paginação nativa.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

const serviceMock = {
  listarSetoresPagina: vi.fn(),
};

vi.mock("@/services/setorService", () => ({
  listarSetoresPagina: (...a) => serviceMock.listarSetoresPagina(...a),
  criarSetor: vi.fn(),
  atualizarSetor: vi.fn(),
  excluirSetor: vi.fn(),
}));

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

const gradePropsSpy = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-setores">grade</div>;
  },
}));

const SETORES = [
  {
    id: "s1",
    sigla: "SC",
    nome: "SANTA CLARA",
    tipo: "Próprio",
    ativo: true,
    empresa_id: "emp-1",
  },
];

const renderPagina = async () => {
  gradePropsSpy.mockClear();
  const { default: CadastroSetores } = await import("@/pages/CadastroSetores");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CadastroSetores />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
};

beforeEach(() => {
  serviceMock.listarSetoresPagina.mockResolvedValue({ ...PAGE_ENVELOPE, items: SETORES, total: 1 });
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("CadastroSetores — rollout MotorBase1", () => {
  it("importa controller/screen e chama listarSetoresPagina com empresa", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const code = fs.readFileSync(path.join(process.cwd(), "src/pages/CadastroSetores.jsx"), "utf8");
    expect(code).toMatch(/useCadastroBase1Controller/);
    expect(code).toMatch(/CadastroBase1Screen/);

    await renderPagina();
    await waitFor(() => {
      expect(serviceMock.listarSetoresPagina).toHaveBeenCalled();
    });
    const firstCall = serviceMock.listarSetoresPagina.mock.calls[0];
    expect(firstCall[0]).toBe("emp-1");
  });

  it("grade usa preset integrado e storageKey histórico", async () => {
    await renderPagina();
    await waitFor(() => {
      expect(screen.getByTestId("grade-setores")).toBeTruthy();
    });
    const props = gradePropsSpy.mock.calls.at(-1)?.[0];
    expect(props.storageKey).toBe("colunas_largura_setores");
    expect(props.droppableId).toBe("colunas-setores");
    expect(props.referenceHeaders).toBe(BASE1_LISTA_INTEGRADA_VISUAL.grade.referenceHeaders);
    const ativoCol = props.columns.find((c) => c.id === "ativo");
    expect(ativoCol?.cellKind).toBeDefined();
  });

  it("pesquisa integrada inicia fechada na tela", async () => {
    await renderPagina();
    await waitFor(() => {
      expect(screen.getByLabelText("Abrir pesquisa")).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText("Buscar setores…")).toBeNull();
  });
});

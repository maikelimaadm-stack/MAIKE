/**
 * MOTORBASE1-ROLLOUT-06 — Cadastro de Lotes consome motor Base1 full-list.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

const serviceMock = {
  listarLotes: vi.fn(),
};

vi.mock("@/services/loteCadastroService", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listarLotes: (...a) => serviceMock.listarLotes(...a),
    criarLote: vi.fn(),
    atualizarLote: vi.fn(),
    excluirLotes: vi.fn(),
    listarAreasAtivas: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({
  useEmpresaSelecionadaId: () => "emp-1",
}));

vi.mock("@/services/mapaCacheService", () => ({
  refreshMapaCacheEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/maikeNotify", () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));

vi.mock("@/components/common/RegistroAnexosDialog", () => ({
  default: () => null,
}));

const gradePropsSpy = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-lotes">grade</div>;
  },
}));

const LOTES = [
  {
    id: "l1",
    numero_lote: "1",
    nome: "LOTE A",
    quantidade_cabecas: 50,
    empresa_id: "emp-1",
    status: "Ativo",
  },
];

const renderPagina = async () => {
  gradePropsSpy.mockClear();
  const { default: CadastroLotes } = await import("@/pages/CadastroLotes");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <CadastroLotes />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
};

beforeEach(() => {
  serviceMock.listarLotes.mockResolvedValue(LOTES);
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("CadastroLotes — rollout MotorBase1", () => {
  it("importa controller/screen e lista lotes da empresa", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const code = fs.readFileSync(path.join(process.cwd(), "src/pages/CadastroLotes.jsx"), "utf8");
    expect(code).toMatch(/useCadastroBase1FullListController/);
    expect(code).toMatch(/CadastroBase1Screen/);
    expect(code).toMatch(/workspaceTitle="Cadastro de Lotes"/);

    await renderPagina();
    await waitFor(() => {
      expect(serviceMock.listarLotes).toHaveBeenCalled();
    });
    expect(serviceMock.listarLotes.mock.calls[0][0]).toEqual(
      expect.objectContaining({ empresaId: "emp-1", incluirSistema: false }),
    );
  });

  it("grade preserva storageKey, droppableId e preset integrado", async () => {
    await renderPagina();
    await waitFor(() => {
      expect(screen.getByTestId("grade-lotes")).toBeTruthy();
    });
    const props = gradePropsSpy.mock.calls.at(-1)?.[0];
    expect(props.storageKey).toBe("colunas_cadastro_lotes");
    expect(props.droppableId).toBe("colunas-cadastro-lotes");
    expect(props.referenceHeaders).toBe(BASE1_LISTA_INTEGRADA_VISUAL.grade.referenceHeaders);
    expect(props.onDisplayChange).toBeTypeOf("function");
  });

  it("pesquisa integrada inicia fechada", async () => {
    await renderPagina();
    await waitFor(() => {
      expect(screen.getByLabelText("Abrir pesquisa")).toBeTruthy();
    });
    expect(screen.queryByPlaceholderText("Buscar lotes…")).toBeNull();
  });
});

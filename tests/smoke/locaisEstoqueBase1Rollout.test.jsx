/**
 * MOTORBASE1-ROLLOUT-05 — LocaisEstoque consome motor Base1 + paginação nativa.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

const serviceMock = {
  listarLocaisPagina: vi.fn(),
  numerarLocaisSemNumero: vi.fn(),
};

vi.mock("@/services/localEstoqueService", () => ({
  listarLocaisPagina: (...a) => serviceMock.listarLocaisPagina(...a),
  criarLocal: vi.fn(),
  atualizarLocal: vi.fn(),
  numerarLocaisSemNumero: (...a) => serviceMock.numerarLocaisSemNumero(...a),
  excluirLocais: vi.fn(),
}));

const PAGE_ENVELOPE = {
  items: [],
  next_cursor: null,
  has_more: false,
  total: 0,
  limit: 100,
};

vi.mock("@/lib/maikeNotify", () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));

vi.mock("@/components/common/ConfirmDialog", () => ({
  default: () => null,
}));

const gradePropsSpy = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-locais">grade</div>;
  },
}));

const LOCAIS = [
  { id: "l1", nome: "GALPÃO", capacidade: "100", ativo: true, numero_local: "1" },
];

const renderPagina = async () => {
  gradePropsSpy.mockClear();
  const { default: LocaisEstoque } = await import("@/pages/LocaisEstoque");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LocaisEstoque />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
};

beforeEach(() => {
  serviceMock.listarLocaisPagina.mockResolvedValue({ ...PAGE_ENVELOPE, items: LOCAIS, total: 1 });
  serviceMock.numerarLocaisSemNumero.mockResolvedValue({ numeradas: [] });
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("LocaisEstoque — rollout preset Base1 lista integrada", () => {
  it("aplica layout base1-list e preset na grade sem alterar storageKey/droppableId", async () => {
    await renderPagina();

    await waitFor(() => {
      expect(screen.getByTestId("grade-locais")).toBeTruthy();
    });

    expect(document.querySelector(".cadastro-b1--full-page")).toBeTruthy();
    expect(BASE1_LISTA_INTEGRADA_VISUAL.workspace.pageLayout).toBe("base1-list");

    const gradeCall = gradePropsSpy.mock.calls.find((c) => c[0]?.storageKey === "colunas_locais_estoque");
    expect(gradeCall).toBeTruthy();
    const props = gradeCall[0];
    expect(props.droppableId).toBe("colunas-locais-estoque");
    expect(props.referenceHeaders).toBe(BASE1_LISTA_INTEGRADA_VISUAL.grade.referenceHeaders);
    expect(props.storageKey).toBe("colunas_locais_estoque");
  });

  it("LocaisEstoque.jsx importa CadastroBase1Screen e listarLocaisPagina", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "src/pages/LocaisEstoque.jsx"), "utf8");
    expect(src).toMatch(/CadastroBase1Screen/);
    expect(src).toMatch(/localEstoqueService/);
    expect(src).toMatch(/listarLocaisPagina/);
    expect(src).toMatch(/colunas_locais_estoque/);
    expect(src).toMatch(/useCadastroBase1Controller/);
    expect(src).toMatch(/\["locais_estoque", "page"\]/);
    const port = fs.readFileSync(
      path.join(process.cwd(), "src/apis/locais-estoque/localEstoqueNativePort.js"),
      "utf8",
    );
    expect(port).toMatch(/listPage/);
    expect(port).toMatch(/listPage.*nativeRequest/s);
  });
});

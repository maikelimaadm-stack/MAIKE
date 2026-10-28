/**
 * MOTORBASE1-ROLLOUT-07 — Cadastro de Empresas consome motor Base1 full-list.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const serviceMock = {
  listEmpresas: vi.fn(),
};

vi.mock("@/services/empresaService", () => ({
  listEmpresas: (...a) => serviceMock.listEmpresas(...a),
  createEmpresa: vi.fn(),
  updateEmpresa: vi.fn(),
  excluirEmpresas: vi.fn(),
}));

vi.mock("@/lib/maikeNotify", () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
  notifyExclusoesEmpilhadas: vi.fn(),
}));

const gradePropsSpy = vi.fn();
vi.mock("@/components/cadastro/base1/CadastroBase1Grade", () => ({
  default: (props) => {
    gradePropsSpy(props);
    return <div data-testid="grade-empresas">grade</div>;
  },
}));

vi.mock("@/components/empresa/FormularioEmpresa", () => ({
  FORMULARIO_EMPRESA_ID: "formulario-empresa-base1",
  default: () => <div data-testid="form-empresa-mock" />,
}));

const EMPRESAS = [
  {
    id: "e1",
    numero_empresa: 1,
    apelido: "FAZENDA",
    nome: "FAZENDA TESTE",
    tipo_pessoa: "Jurídica",
  },
];

const renderPagina = async () => {
  gradePropsSpy.mockClear();
  const { default: Empresa } = await import("@/pages/Empresa");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Empresa />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  serviceMock.listEmpresas.mockResolvedValue(EMPRESAS);
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("Empresa — rollout MotorBase1", () => {
  it("composição oficial e título Empresas", async () => {
    const fs = await import("node:fs");
    const code = fs.readFileSync("src/pages/Empresa.jsx", "utf8");
    expect(code).toMatch(/useCadastroBase1FullListController/);
    expect(code).toMatch(/CadastroBase1Screen/);
    expect(code).toMatch(/workspaceTitle="Empresas"/);
    expect(code).toMatch(/queryKey: \["empresas"\]/);

    await renderPagina();
    await waitFor(() => expect(serviceMock.listEmpresas).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: /^empresas$/i })).toBeTruthy();
  });

  it("grade preserva storageKey e droppableId", async () => {
    await renderPagina();
    await waitFor(() => expect(screen.getByTestId("grade-empresas")).toBeTruthy());
    const props = gradePropsSpy.mock.calls.at(-1)?.[0];
    expect(props.storageKey).toBe("colunas_empresas_v2");
    expect(props.droppableId).toBe("colunas-empresas");
  });
});

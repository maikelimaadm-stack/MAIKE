/**
 * MOTORBASE1-TABS-01 — FormularioLote Base1: abas novas + Ativo compacto.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({
  useEmpresaSelecionadaId: () => "emp-1",
}));

vi.mock("@/hooks/useSetorAreas", () => ({
  default: () => ({
    setores: [{ id: "s1", nome: "SETOR 1" }],
    areas: [{ id: "a1", nome: "AREA 1", setor_id: "s1" }],
    getAreasBySetor: () => [{ id: "a1", nome: "AREA 1", setor_id: "s1" }],
  }),
}));

vi.mock("@/services/loteCadastroService", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listarCategoriasManejoAtivas: vi.fn(async () => []),
    listarFornecedores: vi.fn(async () => []),
  };
});

const renderForm = async (props = {}) => {
  const { default: FormularioLote } = await import("@/components/lotes/FormularioLote.jsx");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSubmit = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <FormularioLote
        visualVariant="base1"
        variant="embedded"
        toolbarActions
        readOnly={false}
        isEditing={false}
        onSubmit={onSubmit}
        onCancel={() => {}}
        initialData={null}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onSubmit };
};

beforeEach(() => {
  localStorage.removeItem("cadastro_lotes_form_layout_config");
  localStorage.removeItem("motorbase1_lotes_panel_style");
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("FormularioLote — Base1 tabs e Ativo", () => {
  it("não renderiza LegacyTabs e expõe abas Geral/Motivo/Identificação/Observações", async () => {
    await renderForm();
    expect(screen.queryByTitle("Painéis anteriores")).toBeNull();
    expect(screen.getByRole("tab", { name: "Geral" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Motivo" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Identificação" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Observações" })).toBeTruthy();
  });

  it("Ativo usa B1ChaveRow sem mg-field--switch", async () => {
    await renderForm();
    const statusField = document.querySelector('[data-field="status"]');
    expect(statusField).toBeTruthy();
    expect(statusField.querySelector("[data-chave-row]")).toBeTruthy();
    expect(statusField.querySelector(".mg-field--switch")).toBeNull();
    expect(within(statusField).getByRole("switch")).toBeTruthy();
  });

  it("preserva valor ao trocar aba e alterna status string via switch", async () => {
    await renderForm();
    const desc = screen.getByPlaceholderText("NOME DO LOTE");
    fireEvent.change(desc, { target: { value: "LOTE TESTE" } });
    const statusWrap = document.querySelector('[data-field="status"]');
    fireEvent.click(within(statusWrap).getByRole("switch"));
    fireEvent.click(screen.getByRole("tab", { name: "Observações" }));
    fireEvent.click(screen.getByRole("tab", { name: "Geral" }));
    expect(desc).toHaveValue("LOTE TESTE");
    expect(within(statusWrap).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(within(statusWrap).getByRole("switch"));
    expect(within(statusWrap).getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });
});

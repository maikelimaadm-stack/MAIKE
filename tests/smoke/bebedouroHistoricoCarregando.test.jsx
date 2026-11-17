// @vitest-environment jsdom
/**
 * D-PROD-220 — o "carregando" do histórico do bebedouro com o hook REAL
 * (`useBebedouroHistorico`, só o serviço trocado por dublê). O sinal vem do
 * `placeholderData: []` do hook (`isPlaceholderData`): sem ele, a tela volta a
 * dizer "Nenhum lançamento ainda." enquanto a lista ainda chega.
 * O detalhesV12Bebedouro troca o hook inteiro por dublê; este arquivo prova o elo.
 * Dados sintéticos.
 */
import React from "react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const estado = vi.hoisted(() => ({ pendente: true, lista: [] }));
vi.mock("@/services/mapaService", () => ({
  listarIconesPorTipoEntidade: async () => [],
  listarPontosDaEmpresa: async () => [{ id: "p-1", nome: "Bebedouro 01", numero_ponto: "BB-01", ativo: true }],
}));
vi.mock("@/services/loteManejoService", () => ({ listarTodosLotes: async () => [] }));
vi.mock("@/services/bebedouroDataService", () => ({
  listarHistorico: vi.fn(async () => (estado.pendente ? new Promise(() => {}) : estado.lista)),
  criarHistorico: vi.fn(),
  excluirHistorico: vi.fn(),
}));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ full_name: "João" }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { default: DetalhesBebedouro } = await import("@/components/bebedouros/DetalhesBebedouro");

const BEBEDOURO = { id: "beb-1", empresa_id: "emp-1", nome: "Bebedouro 01", tipo: "Australiano", status: "Ativo", ponto_referencia_id: "p-1" };

beforeEach(() => {
  localStorage.setItem("empresa_selecionada_id", "emp-1");
  estado.pendente = true;
  estado.lista = [];
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const montar = async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DetalhesBebedouro bebedouro={BEBEDOURO} semCabecalho />
    </QueryClientProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 60));
  });
};

it("lista ainda chegando (hook real): 'Carregando...' no Último registro e 'Carregando histórico...', sem 'Nenhum lançamento ainda.'", async () => {
  await montar();
  expect(screen.getByText("Carregando...")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("Carregando histórico...");
  expect(screen.queryByText("Nenhum lançamento ainda.")).toBeNull();
});

it("lista vazia do servidor (hook real): 'Nenhum lançamento ainda.', sem carregando", async () => {
  estado.pendente = false;
  await montar();
  expect(screen.getByText("Nenhum lançamento ainda.")).toBeTruthy();
  expect(screen.queryAllByRole("status")).toHaveLength(0);
});

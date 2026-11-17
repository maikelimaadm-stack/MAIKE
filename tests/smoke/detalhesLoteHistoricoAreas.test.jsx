// @vitest-environment jsdom
/**
 * D-PROD-220 — o nome da outra área na aba Histórico do pasto, de ponta a
 * ponta: DetalhesLote REAL → PainelPasto REAL → AbaHistorico REAL. As áreas do
 * mapa vêm do cache ('areas'); um registro antigo gravou o nome da outra área
 * vazio. O histórico mostra o nome do cadastro de áreas, não "Área …id".
 * Pega quem tirar `areas` do `dadosDoPasto` (DetalhesLote) ou do `dadosPasto`
 * (PainelPasto). Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  buscarLoteDoHistorico: vi.fn(async () => null),
  listarProdutosDaEmpresa: vi.fn(async () => []),
  criarEventoSuplementacao: vi.fn(),
  registrarSuplementacaoEmLote: vi.fn(),
}));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(async () => []),
  getMapaCacheSnapshot: vi.fn(async () => ({ items: [], atualizadoEm: null })),
  refreshMapaCacheEntry: vi.fn(async () => []),
}));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/mapaService", () => ({ listarIconesPorTipoEntidade: async () => [] }));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ id: "u-9", cliente_id: "c-9" }) }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-9" }));
vi.mock("@/components/lotes/ExcluirMovimentacao", () => ({ escopoDoUsuario: () => "c-9:u-9", default: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

const { default: DetalhesLote } = await import("@/components/mapa/DetalhesLote");

const EMP = "emp-9";
const AREAS_DO_MAPA = [
  { id: "a-aqui", nome: "Pasto Aqui", empresa_id: EMP, tamanho_hectares: 20 },
  { id: "a-origem-000111", nome: "RETIRO DE ORIGEM", empresa_id: EMP },
];
/** Entrada antiga: a área de origem gravou o nome vazio. */
const ENTRADA_SEM_NOME = {
  id: "mv-e",
  empresa_id: EMP,
  tipo: "Transferência de Área",
  lote: "ANGUS 3",
  quantidade_animais: 7,
  area_origem_id: "a-origem-000111",
  area_origem_nome: "",
  area_destino_id: "a-aqui",
  area_destino_nome: "Pasto Aqui",
  data_movimentacao: "2026-11-08T12:00:00.000Z",
  created_date: "2026-11-08T13:00:00.000Z",
  efeito_servidor: { comando: "rebanho_ledger", evento_id: "ev-e", operation_id: "op-e", registrado_em: "2026-11-08T13:00:00.000Z" },
  historico_ocorrencia: "2026-11-08",
  historico_registrado_em: "2026-11-08T13:00:00.000Z",
};
const pagina = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100, ordem: "ocorrencia_desc_v2" });
const POSICAO = {
  id: "p9",
  nome: "ANGUS 3",
  categoria: "BOI",
  quantidade_cabecas: 7,
  peso_medio_kg: 380,
  area_atual_id: "a-aqui",
  area_atual_nome: "Pasto Aqui",
  status: "Ativo",
  __posicao: true,
  empresa_id: EMP,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("aba Histórico do pasto: nome da outra área pelas áreas do mapa (D-PROD-220)", () => {
  it("entrada antiga com a origem de nome vazio mostra o nome do cadastro de áreas, sem 'Área …'", async () => {
    localStorage.setItem("empresa_selecionada_id", EMP);
    cache.getMapaCachedData.mockImplementation(async (chave) => (chave === "areas" ? AREAS_DO_MAPA : []));
    cache.refreshMapaCacheEntry.mockImplementation(async (chave) => (chave === "areas" ? AREAS_DO_MAPA : []));
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([ENTRADA_SEM_NOME]));
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DetalhesLote lotes={[POSICAO]} onClose={() => {}} permissions={{}} setorNome="Sede" />
      </QueryClientProvider>,
    );
    // As áreas do mapa chegaram ao DetalhesLote antes de abrir a aba.
    await waitFor(() => expect(client.getQueryData(["mapa-areas", EMP])).toEqual(AREAS_DO_MAPA));
    await act(async () => {
      fireEvent.click(await screen.findByRole("tab", { name: "Histórico" }));
    });
    const lista = await screen.findByRole("list", { name: "Registros do pasto" });
    await waitFor(() => expect(lista.textContent).toContain("ANGUS 3"));
    expect(lista.textContent).toContain("RETIRO DE ORIGEM");
    expect(lista.textContent).not.toContain("Área …");
  });
});

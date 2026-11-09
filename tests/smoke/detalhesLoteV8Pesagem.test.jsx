// @vitest-environment jsdom
/**
 * UI-DETALHES-LOTE-V8 — a pesagem recém-registrada aparece ao reabrir o Detalhes
 * do Lote. Achado do dono no preview: pesou, reabriu e a pesagem não estava lá.
 * Causa: o diálogo fecha depois do manejo e, ao reabrir em menos de 1 min, a
 * query das movimentações (staleTime 60 s) devolvia a lista antiga da memória
 * sem reler — mesmo com o cache do mapa já atualizado pelo 'atualizar-mapa'.
 * DetalhesLote REAL; mocks só na borda (cache do mapa, serviços, toast).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const formulario = vi.hoisted(() => (nome) => async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-testid": `form-${nome}` }) };
});
const dados = vi.hoisted(() => ({ areas: [], lotes: [], movimentacoes: [] }));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(async (chave) => dados[chave] ?? []),
  refreshMapaCacheEntry: vi.fn(async (chave) => dados[chave] ?? []),
}));

vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/loteManejoService", () => ({ listarProdutosDaEmpresa: vi.fn(async () => []), criarEventoSuplementacao: vi.fn(), registrarSuplementacaoEmLote: vi.fn() }));
vi.mock("@/services/mapaService", () => ({ listarIconesPorTipoEntidade: async () => [] }));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1" }) }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/lotes/ExcluirMovimentacao", () => ({ escopoDoUsuario: () => "c-1:u-1" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/suplementacao/ResumoSuplementacao", formulario("resumo-supl"));
vi.mock("@/components/lotes/HistoricoMovimentacoes", formulario("historico"));
vi.mock("@/components/suplementacao/HistoricoSuplementacaoLote", formulario("historico-supl"));

const { default: DetalhesLote } = await import("@/components/mapa/DetalhesLote");

const posicao = {
  id: "p1", posicao_id: "p1", __posicao: true, nome: "LOTE PESADO", categoria: "BOI MAGRO", sexo: "Macho",
  quantidade_cabecas: 20, peso_medio_kg: 412.5, area_atual_id: "a1", area_atual_nome: "PASTO A", status: "Ativo",
  raca_predominante: "Nelore", sistema_produtivo: "Recria", data_entrada: "2026-06-01", categoria_manejo_nome: "Recria",
};
const pesagem = {
  id: "mov-1", tipo: "Pesagem", empresa_id: "emp-1", data_movimentacao: "2026-11-05",
  linhas: [{ lote_id: "p1", posicao_id: "p1", lote_nome: "LOTE PESADO", quantidade_cabecas: 20, peso_anterior_kg: 380, peso_novo_kg: 412.5 }],
};

const abrir = async (client) => {
  const utils = render(
    <QueryClientProvider client={client}>
      <DetalhesLote lotes={[posicao]} onClose={() => {}} permissions={{}} />
    </QueryClientProvider>
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: /Lotes/ })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Lista", exact: true })); });
  return utils;
};

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: /min-width: 1024px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  dados.areas = [{ id: "a1", nome: "PASTO A", tamanho_hectares: 50, tipo_pastagem: "Brachiaria", tipo_cultura: "Pastagem" }];
  dados.lotes = [posicao];
  dados.movimentacoes = [];
});
afterEach(() => cleanup());

describe("Detalhes do Lote v8: pesagem nova aparece ao reabrir", () => {
  it("reabrir logo depois de pesar mostra a pesagem (sem esperar 1 minuto)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // 1ª abertura: ainda sem pesagem — a coluna "Última" fica vazia.
    const primeira = await abrir(client);
    expect(screen.getByText("Última")).toBeTruthy();
    expect(screen.queryByText("05/11/2026")).toBeNull();
    primeira.unmount();

    // O manejo Pesar gravou no servidor e o 'atualizar-mapa' atualizou o cache do mapa.
    dados.movimentacoes = [pesagem];

    // 2ª abertura, segundos depois, no MESMO QueryClient do app.
    await abrir(client);
    expect(screen.getByText("05/11/2026")).toBeTruthy(); // Última pesagem
    expect(screen.getByText("MEDIDO")).toBeTruthy(); // peso atual = peso da pesagem
  });
});

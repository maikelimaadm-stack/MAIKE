/**
 * D-PROD-123 — PR191-R2 (achado de revisão): o marcador `ordem` do envelope
 * H2 precisa atravessar o adaptador público (`lotesApi`) até o componente.
 * Aqui só a porta HTTP nativa é simulada; adaptador, serviço e componente são
 * os reais. Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const porta = vi.hoisted(() => ({ pagina: vi.fn() }));
vi.mock("@/apis/movimentacoes-mapa/movimentacaoMapaNativePort", async (importOriginal) => ({
  ...(await importOriginal()),
  listarHistoricoMovimentacoesMapaPagina: (...a) => porta.pagina(...a),
}));
const cache = vi.hoisted(() => ({
  getMapaCachedData: vi.fn(async () => []),
  getMapaCacheSnapshot: vi.fn(async () => ({ items: [], atualizadoEm: null })),
  refreshMapaCacheEntry: vi.fn(async () => []),
  updateMapaCachedData: vi.fn(async () => []),
}));
vi.mock("@/services/mapaCacheService", () => cache);
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ administrador_fazenda: false }), ehAdministrador: () => false }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));

const { listHistoricoMovimentacoesPagina } = await import("@/apis/lotes/lotesApi");
const { default: HistoricoMovimentacoes } = await import("@/components/lotes/HistoricoMovimentacoes");

// Movimento do ledger: o documento diz 2020-01-01; o EventoRebanho vinculado diz 2026-01-01.
const doServidor = (id, oc, dataDoc, reg) => ({
  id, empresa_id: "emp-1", tipo: "Pesagem", lote: "TESTE", lote_id: "lote-1", area_origem_id: "area-A",
  data_movimentacao: dataDoc, created_date: "2026-11-01T10:00:00.000Z",
  historico_ocorrencia: oc, historico_ocorrencia_origem: "evento", historico_registrado_em: reg,
});
const envelope = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100, ordem: "ocorrencia_desc_v2" });

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  porta.pagina.mockReset();
});
afterEach(() => cleanup());

describe("adaptador público do histórico preserva o envelope H2", () => {
  it("lotesApi.listHistoricoMovimentacoesPagina devolve `ordem` (e só aceita texto)", async () => {
    porta.pagina.mockResolvedValueOnce(envelope([]));
    expect((await listHistoricoMovimentacoesPagina({ empresaId: "emp-1", areaId: "area-A" })).ordem).toBe("ocorrencia_desc_v2");
    porta.pagina.mockResolvedValueOnce({ ...envelope([]), ordem: { x: 1 } });
    expect((await listHistoricoMovimentacoesPagina({ empresaId: "emp-1" })).ordem).toBeNull();
  });

  it("caminho real porta → adaptador → serviço → componente: datas do servidor e ordem do servidor", async () => {
    porta.pagina.mockResolvedValue(
      envelope([
        doServidor("m-recente", "2026-10-30", "2019-01-01", "2026-10-30T15:10:00.000Z"),
        doServidor("m-antigo", "2026-01-01", "2020-01-01", "2026-02-01T09:59:55.000Z"),
      ])
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <HistoricoMovimentacoes lotes={[{ id: "lote-1", nome: "TESTE", area_atual_id: "area-A" }]} areaId="area-A" />
      </QueryClientProvider>
    );
    expect(await screen.findByText("Movimentações: 2 de 2")).toBeTruthy();
    expect(screen.getAllByTestId("ocorrencia").map((el) => el.textContent)).toEqual(["Ocorrência: 30/10/2026", "Ocorrência: 01/01/2026"]);
    expect(screen.getAllByTestId("registrado-em")[1].textContent).toMatch(/^Registrado em: 01\/02\/2026/);
  });
});

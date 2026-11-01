/**
 * Histórico da Área acessível pelo contorno no Mapa Geral
 * (MAIKE-MAPA-HISTORICO-MOVIMENTACOES-R1.1, D-PROD-94a). Testes de componente
 * (mock de serviço) — a prova no navegador real está no relatório (E2E local).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { acaoDoCliqueNaArea, ehCurral, podeVerHistoricoDaArea } from "@/domain/mapa/cliqueArea";

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  cancelarMovimentacaoMapa: vi.fn(),
  consultarCancelamentoMovimentacao: vi.fn(),
}));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async () => [],
  getMapaCacheSnapshot: async () => ({ items: [], atualizadoEm: null }),
  refreshMapaCacheEntry: async (chave) => (chave === "areas" ? [{ id: "area-A", nome: "PASTO A", empresa_id: "emp-1" }] : []),
}));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ administrador_fazenda: false }), ehAdministrador: (u) => u?.administrador_fazenda === true }));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));
vi.mock("@/components/mapa/HistoricoAbateCurral", () => ({
  default: ({ areaId }) => <div data-testid="abate-curral">Histórico de Abate {areaId}</div>,
}));

const { default: DetalhesArea } = await import("@/components/mapa/DetalhesArea");

const PASTO_A = { id: "area-A", nome: "PASTO A", tipo_cultura: "Pastagem" };
const RESERVA = { id: "area-R", nome: "RESERVA", tipo_cultura: "Reserva" };
const CURRAL = { id: "area-C", nome: "CURRAL", tipo_cultura: "Infraestrutura", tipo_infraestrutura: "Curral" };
const PERMITE = { visualizar_historico_movimentacoes_lote: true };
const NEGA = { visualizar_historico_movimentacoes_lote: false };

const saidaAntiga = {
  id: "mv-1",
  empresa_id: "emp-1",
  tipo: "Transferência de Área",
  lote: "NELORE 1",
  lote_id: "lote-que-saiu",
  quantidade_animais: 120,
  area_origem_id: "area-A",
  area_origem_nome: "PASTO A",
  area_destino_id: "area-B",
  area_destino_nome: "PASTO B",
  data_movimentacao: "2026-09-01T12:00:00.000Z",
  created_date: "2026-09-01T15:00:00.000Z",
};
const pagina = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100 });

const renderizar = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([]));
});
afterEach(() => cleanup());

describe("política do clique na área", () => {
  it("T08: selecionando local de tarefa, o clique escolhe o local e nunca abre detalhes", () => {
    for (const area of [PASTO_A, CURRAL]) {
      expect(acaoDoCliqueNaArea({ area, selecionandoLocalTarefa: true, toqueLongoAcabouDeDisparar: false, permissoes: PERMITE })).toBe("selecionar-local");
    }
  });

  it("clique que encerra um toque longo (lançamento de tarefa) não abre detalhes", () => {
    expect(acaoDoCliqueNaArea({ area: PASTO_A, selecionandoLocalTarefa: false, toqueLongoAcabouDeDisparar: true, permissoes: PERMITE })).toBe("ignorar");
  });

  it("T04/T05: pasto, reserva, curral abrem detalhes com permissão", () => {
    for (const area of [PASTO_A, RESERVA, CURRAL]) {
      expect(acaoDoCliqueNaArea({ area, selecionandoLocalTarefa: false, toqueLongoAcabouDeDisparar: false, permissoes: PERMITE })).toBe("abrir-detalhes");
    }
  });

  it("T10: sem a permissão de histórico, área comum não abre nada; curral mantém o abate de antes", () => {
    expect(acaoDoCliqueNaArea({ area: PASTO_A, selecionandoLocalTarefa: false, toqueLongoAcabouDeDisparar: false, permissoes: NEGA })).toBe("ignorar");
    expect(acaoDoCliqueNaArea({ area: CURRAL, selecionandoLocalTarefa: false, toqueLongoAcabouDeDisparar: false, permissoes: NEGA })).toBe("abrir-detalhes");
    expect(podeVerHistoricoDaArea(undefined)).toBe(true);
    expect(ehCurral(CURRAL)).toBe(true);
    expect(ehCurral(PASTO_A)).toBe(false);
  });
});

describe("DetalhesArea", () => {
  it("T04: pasto vazio com saída antiga mostra a saída — consulta pela área, sem lotes atuais", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([saidaAntiga]));
    renderizar(<DetalhesArea area={PASTO_A} permissions={PERMITE} />);
    expect(await screen.findByText("Movimentações: 1 de 1")).toBeTruthy();
    expect(screen.getByText("Saída")).toBeTruthy();
    expect(screen.getByText("Histórico da Área PASTO A (1)")).toBeTruthy();
    const chamada = servico.listarHistoricoMovimentacoesPagina.mock.calls[0][0];
    expect(chamada).toMatchObject({ empresaId: "emp-1", areaId: "area-A" });
    expect(chamada.loteIds).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Lotes atuais" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
  });

  it("T06: área sem movimento mostra vazio verdadeiro, não erro", async () => {
    renderizar(<DetalhesArea area={RESERVA} permissions={PERMITE} />);
    expect(await screen.findByText("Nenhum lançamento encontrado")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("erro do servidor sem cache: erro + Tentar novamente", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => {
      throw Object.assign(new Error("x"), { code: "PROVIDER_UNAVAILABLE" });
    });
    renderizar(<DetalhesArea area={PASTO_A} permissions={PERMITE} />);
    expect(await screen.findByText("Não foi possível carregar o histórico.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });

  it("T07: curral abre no abate e tem a aba Histórico da Área, sem misturar os dois", async () => {
    renderizar(<DetalhesArea area={CURRAL} permissions={PERMITE} />);
    expect(screen.getByTestId("abate-curral").textContent).toContain("area-C");
    expect(screen.getByRole("tab", { name: "Abate" }).getAttribute("aria-selected")).toBe("true");
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
    const aba = screen.getByRole("tab", { name: "Histórico da Área" });
    fireEvent.mouseDown(aba);
    fireEvent.click(aba);
    expect(await screen.findByText("Nenhum lançamento encontrado")).toBeTruthy();
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenCalledWith(expect.objectContaining({ areaId: "area-C" }));
  });

  it("T10: sem permissão — área comum não renderiza; curral só o abate", () => {
    const { container } = renderizar(<DetalhesArea area={PASTO_A} permissions={NEGA} />);
    expect(container.textContent).toBe("");
    cleanup();
    renderizar(<DetalhesArea area={CURRAL} permissions={NEGA} />);
    expect(screen.getByTestId("abate-curral")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
  });
});

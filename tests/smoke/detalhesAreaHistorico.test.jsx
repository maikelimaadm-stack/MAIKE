/**
 * Histórico da Área acessível pelo contorno no Mapa Geral
 * (MAIKE-MAPA-HISTORICO-MOVIMENTACOES-R1.1, D-PROD-94a), no desenho do
 * Detalhes do Lote v12 (D-PROD-220): a mesma linha do tempo da aba Histórico do
 * pasto, só leitura; curral com as abas Abate · Histórico da Área; a pílula
 * "Histórico completo" abre por cima o Histórico de Movimentação da área de
 * hoje, com o "Excluir movimentação" do administrador (D-PROD-110). Testes de
 * componente (mock de serviço).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { acaoDoCliqueNaArea, ehCurral, podeVerHistoricoDaArea } from "@/domain/mapa/cliqueArea";
import { MAPA_GERAL_ACESSO_TOTAL } from "@/lib/mapaGeralPermissions";

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  cancelarMovimentacaoMapa: vi.fn(),
  consultarCancelamentoMovimentacao: vi.fn(),
  // "Excluir movimentação" (D-PROD-110) do Histórico completo da área.
  excluirMovimentacaoMapa: vi.fn(),
  consultarExclusaoMovimentacao: vi.fn(),
  removerMovimentacaoExcluidaDoCacheOffline: vi.fn(),
  pendenciasOfflineDaMovimentacao: vi.fn(),
  eventoMudancaFilaOffline: () => "offline-entity-queue-updated",
}));
const sessao = vi.hoisted(() => ({ admin: false }));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async () => [],
  getMapaCacheSnapshot: async () => ({ items: [], atualizadoEm: null }),
  refreshMapaCacheEntry: async (chave) => (chave === "areas" ? [{ id: "area-A", nome: "PASTO A", empresa_id: "emp-1" }] : []),
}));
vi.mock("@/services/sessionService", () => ({
  getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1", administrador_fazenda: sessao.admin }),
  ehAdministrador: (u) => u?.administrador_fazenda === true,
}));
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
  sessao.admin = false;
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([]));
  servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({ elegivel: true, codigo: null, pode_excluir: true, efeitos: [] }));
  servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => []);
  servico.removerMovimentacaoExcluidaDoCacheOffline.mockImplementation(async () => 1);
});
afterEach(() => cleanup());

/** Movimento do ledger (a exclusão só vale para ele): a prova é o evento + a operação idempotente. */
const morteDoLedger = {
  id: "mv-m",
  empresa_id: "emp-1",
  tipo: "Morte",
  lote: "NELORE 1",
  lote_id: "lote-1",
  quantidade_animais: 1,
  area_origem_id: "area-A",
  area_origem_nome: "PASTO A",
  data_movimentacao: "2026-10-10T12:00:00.000Z",
  created_date: "2026-10-10T13:00:00.000Z",
  efeito_servidor: { comando: "rebanho_ledger", evento_id: "ev-1", operation_id: "manejo-x" },
};

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
    renderizar(<DetalhesArea area={PASTO_A} permissions={PERMITE} setorNome="Retiro" />);
    // v12: casca .mk-dp (fora do diálogo, cabeçalho próprio "Histórico da Área" · "área · setor") e a linha do tempo da área.
    expect(screen.getByRole("heading", { name: "Histórico da Área" })).toBeTruthy();
    expect(screen.getByText("PASTO A · Retiro")).toBeTruthy();
    expect(document.querySelector(".mk-dp .mk-dp__corpo--cards")).toBeTruthy();
    // A lista se anuncia como da área (não "Registros do pasto").
    const linha = await screen.findByRole("list", { name: "Registros da área" });
    expect(linha.textContent).toContain("Movimentação · saída");
    expect(linha.textContent).toContain("NELORE 1");
    expect(linha.textContent).toContain("PASTO B");
    expect(screen.getByText("Registros de todas as movimentações, pesagens e manejos que passaram por esta área.")).toBeTruthy();
    const chamada = servico.listarHistoricoMovimentacoesPagina.mock.calls[0][0];
    expect(chamada).toMatchObject({ empresaId: "emp-1", areaId: "area-A" });
    expect(chamada.loteIds).toBeUndefined();
    expect(screen.queryByRole("button", { name: "Lotes atuais" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
  });

  it("T06: área sem movimento mostra vazio verdadeiro, não erro", async () => {
    renderizar(<DetalhesArea area={RESERVA} permissions={PERMITE} />);
    expect(await screen.findByText("Nenhum registro deste tipo nesta área.")).toBeTruthy();
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
    fireEvent.click(aba);
    expect(aba.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("abate-curral")).toBeNull();
    expect(await screen.findByText("Nenhum registro deste tipo nesta área.")).toBeTruthy();
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenCalledWith(expect.objectContaining({ areaId: "area-C" }));
  });

  it("A1/A2: o rodapé tem 'Histórico completo' — o Histórico de Movimentação da área por cima, com o 'Excluir movimentação' do administrador", async () => {
    sessao.admin = true;
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([morteDoLedger]));
    renderizar(<DetalhesArea area={RESERVA} permissions={PERMITE} setorNome="Retiro" />);
    const linha = await screen.findByRole("list", { name: "Registros da área" });
    // A linha do tempo resumida continua só leitura.
    expect(within(linha).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Excluir movimentação" })).toBeNull();
    const rodape = screen.getByRole("group", { name: "Ações da área" });
    expect([...rodape.querySelectorAll(".mk-dp-pilula")].map((b) => b.textContent)).toEqual(["Histórico completo"]);
    fireEvent.click(within(rodape).getByRole("button", { name: "Histórico completo" }));
    const dialogo = await screen.findByRole("dialog");
    expect(dialogo.querySelector(".mk-ll-dlg__titulo")?.textContent).toMatch(/^Histórico da Área/);
    expect(await within(dialogo).findByRole("button", { name: "Excluir movimentação" })).toBeTruthy();
    // A consulta é a da área, sem lotes (área vazia não perde histórico).
    expect(servico.listarHistoricoMovimentacoesPagina).toHaveBeenLastCalledWith(expect.objectContaining({ areaId: "area-R" }));
  });

  it("A1: quem não é administrador vê o histórico completo, sem o 'Excluir movimentação'", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([morteDoLedger]));
    renderizar(<DetalhesArea area={RESERVA} permissions={PERMITE} />);
    await screen.findByRole("list", { name: "Registros da área" });
    fireEvent.click(screen.getByRole("button", { name: "Histórico completo" }));
    const dialogo = await screen.findByRole("dialog");
    expect(await within(dialogo).findByText("NELORE 1")).toBeTruthy();
    expect(within(dialogo).queryByRole("button", { name: "Excluir movimentação" })).toBeNull();
  });

  it("A6: acesso total (Forragem + histórico): cabeçalho área · setor, a Forragem antes do 'Histórico da área', a linha da área e o 'Histórico completo'", async () => {
    sessao.admin = true;
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([saidaAntiga]));
    renderizar(<DetalhesArea area={PASTO_A} permissions={MAPA_GERAL_ACESSO_TOTAL} setorNome="Retiro" />);
    expect(screen.getByRole("heading", { level: 2, name: "PASTO A" })).toBeTruthy();
    expect(screen.getByText("Retiro")).toBeTruthy();
    const forragem = screen.getByTestId("painel-forragem");
    const titulo = screen.getByRole("heading", { name: "Histórico da área" });
    expect(forragem.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const linha = await screen.findByRole("list", { name: "Registros da área" });
    expect(linha.textContent).toContain("NELORE 1");
    expect(screen.getByRole("button", { name: "Histórico completo" })).toBeTruthy();
  });

  it("A3: registro antigo com o nome da outra área vazio mostra o nome do cadastro de áreas do mapa", async () => {
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([{ ...saidaAntiga, area_destino_nome: "" }]));
    renderizar(<DetalhesArea area={PASTO_A} permissions={PERMITE} areas={[{ id: "area-B", nome: "PASTO B" }]} />);
    const linha = await screen.findByRole("list", { name: "Registros da área" });
    expect(linha.textContent).toContain("PASTO B");
    expect(linha.textContent).not.toContain("Área …");
    cleanup();
    // Sem as áreas do mapa, o socorro é o id (o mesmo do histórico completo).
    renderizar(<DetalhesArea area={PASTO_A} permissions={PERMITE} />);
    expect((await screen.findByRole("list", { name: "Registros da área" })).textContent).toContain("Área …area-B");
  });

  it("curral com histórico: 'Histórico completo' nas duas abas; o painel aponta para a aba ativa", async () => {
    renderizar(<DetalhesArea area={CURRAL} permissions={PERMITE} setorNome="Sede" />);
    expect(screen.getByRole("button", { name: "Histórico completo" })).toBeTruthy();
    const painel = screen.getByRole("tabpanel");
    expect(painel.getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Abate" }).id);
    fireEvent.click(screen.getByRole("tab", { name: "Histórico da Área" }));
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Histórico da Área" }).id);
    expect(screen.getByRole("button", { name: "Histórico completo" })).toBeTruthy();
    await screen.findByText("Nenhum registro deste tipo nesta área.");
  });

  it("T10: sem permissão — área comum não renderiza; curral só o abate", () => {
    const { container } = renderizar(<DetalhesArea area={PASTO_A} permissions={NEGA} />);
    expect(container.textContent).toBe("");
    cleanup();
    renderizar(<DetalhesArea area={CURRAL} permissions={NEGA} />);
    expect(screen.getByTestId("abate-curral")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("button", { name: "Histórico completo" })).toBeNull();
    expect(servico.listarHistoricoMovimentacoesPagina).not.toHaveBeenCalled();
  });
});

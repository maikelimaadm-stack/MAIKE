// @vitest-environment jsdom
/**
 * D-PROD-222 — o cartão comum dos históricos (`CartaoHistorico`) tem o MESMO
 * desenho do cartão do Histórico de Movimentação do manejo
 * (`HistoricoMovimentacoes`): as mesmas classes na raiz, na fileira de selos,
 * no selo da data, nos selos de tipo, no título, nas linhas e no rodapé. Se um
 * mudar sem o outro, este teste cai. No mapa só existe exclusão: o Histórico de
 * Movimentação não tem mais selo de situação (Ativo/Cancelado) e não mostra o
 * cancelado antigo. Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const servico = vi.hoisted(() => ({
  listarHistoricoMovimentacoesPagina: vi.fn(),
  cancelarMovimentacaoMapa: vi.fn(),
  consultarCancelamentoMovimentacao: vi.fn(),
  excluirMovimentacaoMapa: vi.fn(),
  consultarExclusaoMovimentacao: vi.fn(),
  removerMovimentacaoExcluidaDoCacheOffline: vi.fn(),
  pendenciasOfflineDaMovimentacao: vi.fn(),
  eventoMudancaFilaOffline: () => "offline-entity-queue-updated",
}));
vi.mock("@/services/loteManejoService", () => servico);
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async () => [],
  getMapaCacheSnapshot: async () => ({ items: [], atualizadoEm: null }),
  refreshMapaCacheEntry: async () => [],
}));
vi.mock("@/services/sessionService", () => ({
  getCurrentUser: async () => ({ id: "u-1", cliente_id: "c-1", administrador_fazenda: true }),
  ehAdministrador: (u) => u?.administrador_fazenda === true,
}));
vi.mock("@/hooks/useEmpresaSelecionadaId", () => ({ useEmpresaSelecionadaId: () => "emp-1" }));

const { default: HistoricoMovimentacoes } = await import("@/components/lotes/HistoricoMovimentacoes");
const { LancLoteDialogo } = await import("@/components/lotes/LancamentoLoteUi");
const { default: CartaoHistorico, SeloHistorico, LinhaHistorico, MolduraHistorico, AcaoHistorico, useTituloDoHistorico } = await import("@/components/lotes/CartaoHistorico");

const MORTE = {
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
const pagina = (items) => ({ items, next_cursor: null, has_more: false, total: items.length, limit: 100 });

beforeEach(() => {
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([MORTE]));
  servico.consultarExclusaoMovimentacao.mockImplementation(async () => ({ elegivel: true, codigo: null, pode_excluir: true, efeitos: [] }));
  servico.pendenciasOfflineDaMovimentacao.mockImplementation(async () => []);
});
afterEach(() => cleanup());

const noDialogo = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Histórico" largo somenteLeitura>
        {ui}
      </LancLoteDialogo>
    </QueryClientProvider>,
  );
};

/** As partes do cartão a partir do selo da data (o primeiro selo). */
const partes = (seloData) => {
  const fileira = /** @type {HTMLElement} */ (seloData.parentElement);
  const coluna = /** @type {HTMLElement} */ (fileira.parentElement);
  const cartao = /** @type {HTMLElement} */ (coluna.closest(".rounded-lg"));
  const [, titulo, linhas] = Array.from(coluna.children);
  const rodape = /** @type {HTMLElement | null} */ (cartao.lastElementChild !== cartao.firstElementChild ? cartao.lastElementChild : null);
  return {
    cartao: cartao.className,
    fileira: fileira.className,
    data: seloData.className,
    selo: /** @type {HTMLElement} */ (fileira.children[1]).className,
    // Sem selo de situação: a fileira é data, tipo e fluxo.
    quantosSelos: fileira.children.length,
    titulo: /** @type {HTMLElement} */ (titulo).className,
    linhas: /** @type {HTMLElement} */ (linhas).className,
    rodape: rodape?.className ?? null,
    lista: /** @type {HTMLElement} */ (cartao.parentElement).className,
  };
};

describe("CartaoHistorico = cartão do Histórico de Movimentação (D-PROD-222)", () => {
  it("mesmas classes em cada parte do cartão e na lista", async () => {
    noDialogo(<HistoricoMovimentacoes lotes={[]} areaId="area-A" />);
    // O selo da data é o primeiro "10/10/2026" que é um <span> (a ocorrência repete a data numa linha).
    const ref = partes((await screen.findAllByText("10/10/2026")).find((el) => el.tagName === "SPAN"));
    cleanup();

    function Comum() {
      useTituloDoHistorico("Histórico", 1);
      return (
        <MolduraHistorico>
          <CartaoHistorico
            selos={
              <>
                <SeloHistorico tom="data">10/10/2026</SeloHistorico>
                <SeloHistorico>Morte</SeloHistorico>
                <SeloHistorico>Saída</SeloHistorico>
              </>
            }
            titulo="NELORE 1"
            rodape={<button type="button">Excluir</button>}
          >
            <LinhaHistorico rotulo="Quantidade">1 cab</LinhaHistorico>
          </CartaoHistorico>
        </MolduraHistorico>
      );
    }
    noDialogo(<Comum />);
    const comum = partes(screen.getAllByText("10/10/2026").find((el) => el.tagName === "SPAN"));
    expect(comum).toEqual(ref);
  });

  it("o selo âmbar (Vínculo pelo nome) e o botão do 'Excluir' (contorno) são os do Histórico de Movimentação; o cancelado antigo não aparece", async () => {
    // Um antigo (sem lote_id: "Vínculo pelo nome") ativo do ledger, que tem o "Excluir movimentação", ao lado de um cancelado antigo.
    const LEGADO = { ...MORTE, id: "mv-l", lote_id: null };
    const CANCELADO = { ...MORTE, id: "mv-c", lote: "CANCELADO ANTIGO", situacao: "cancelado", cancelamento: { por_login: "admin" } };
    servico.listarHistoricoMovimentacoesPagina.mockImplementation(async () => pagina([LEGADO, CANCELADO]));
    noDialogo(<HistoricoMovimentacoes lotes={[]} areaId="area-A" />);
    const excluirRef = /** @type {HTMLButtonElement} */ (await screen.findByRole("button", { name: "Excluir movimentação" }));
    await waitFor(() => expect(excluirRef.disabled).toBe(false));
    const vinculoRef = screen.getByText("Vínculo pelo nome");
    expect(screen.queryByText("CANCELADO ANTIGO")).toBeNull();
    expect(screen.queryByText("Cancelado")).toBeNull();
    expect(screen.queryByText("Ativo")).toBeNull();
    expect(document.body.textContent).not.toMatch(/cancel|estorn/i);
    const ref = {
      cartao: /** @type {HTMLElement} */ (vinculoRef.closest(".rounded-lg")).className,
      ambar: vinculoRef.className,
      excluir: excluirRef.className,
    };
    cleanup();

    noDialogo(
      <MolduraHistorico>
        <CartaoHistorico
          selos={
            <>
              <SeloHistorico tom="data">10/10/2026</SeloHistorico>
              <SeloHistorico tom="ambar">Vínculo pelo nome</SeloHistorico>
            </>
          }
          titulo="NELORE 1"
        />
        <CartaoHistorico titulo="NELORE 2" rodape={<AcaoHistorico destrutiva>Excluir</AcaoHistorico>} />
      </MolduraHistorico>,
    );
    const vinculo = screen.getByText("Vínculo pelo nome");
    expect({
      cartao: /** @type {HTMLElement} */ (vinculo.closest(".rounded-lg")).className,
      ambar: vinculo.className,
      excluir: screen.getByRole("button", { name: "Excluir" }).className,
    }).toEqual(ref);
  });

  it("fora do mapa nada muda: o CartaoHistorico continua com o fundo do cancelado e o selo vermelho para quem os usa", () => {
    noDialogo(
      <MolduraHistorico>
        <CartaoHistorico cancelado selos={<SeloHistorico tom="vermelho">Situação</SeloHistorico>} titulo="NELORE 1" />
      </MolduraHistorico>,
    );
    const selo = screen.getByText("Situação");
    expect(selo.className).toContain("text-red-800 border-red-300 bg-red-50");
    expect(/** @type {HTMLElement} */ (selo.closest(".rounded-lg")).className).toContain("border-slate-200 bg-[#FAFCFE]");
  });

  it("título do diálogo com a contagem; sem contagem quando zero ou nula", () => {
    function Titulo({ n }) {
      useTituloDoHistorico("Histórico do Depósito", n);
      return null;
    }
    const { rerender } = noDialogo(<Titulo n={3} />);
    const titulo = () => document.querySelector(".mk-ll-dlg__titulo")?.textContent;
    expect(titulo()).toBe("Histórico do Depósito (3)");
    const client = new QueryClient();
    for (const n of [0, null]) {
      rerender(
        <QueryClientProvider client={client}>
          <LancLoteDialogo open onOpenChange={() => {}} titulo="Histórico" largo somenteLeitura>
            <Titulo n={n} />
          </LancLoteDialogo>
        </QueryClientProvider>,
      );
      expect(titulo()).toBe("Histórico do Depósito");
    }
    expect(within(document.body).queryByText("Histórico do Depósito (0)")).toBeNull();
  });
});

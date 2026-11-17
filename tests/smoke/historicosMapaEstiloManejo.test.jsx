// @vitest-environment jsdom
/**
 * D-PROD-221 — os históricos do cocho e do depósito no desenho do histórico do
 * manejo (o do Histórico de Movimentação), dentro do `LancLoteDialogo`:
 * - o título com a contagem vai para o cabeçalho do diálogo e o nome do
 *   cocho/depósito fica no subtítulo; não há cartão nem título por dentro;
 * - cada registro é um `CartaoHistorico` (selo da data primeiro, o produto em
 *   negrito, linhas "Rótulo: valor"), com os mesmos dados de antes;
 * - a política de estorno (D-PROD-94a) continua: aviso e nenhum "Excluir";
 * - o histórico da tarefa idem, com o "Excluir" do manejo no rodapé e só o mais
 *   recente ligado (como antes).
 * Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MENSAGEM_ESTORNO_SUSPENSO } from "@/domain/estornos/politicaEstorno";

const cache = vi.hoisted(() => ({ dados: {} }));
vi.mock("@/services/suplementacaoHistoricoService", () => ({ excluirEventoSuplementacaoComReversao: vi.fn(), excluirTransferenciaDeposito: vi.fn() }));
vi.mock("@/services/sessionService", () => ({ getCurrentUser: async () => ({ email: "operador@exemplo.test" }) }));
vi.mock("@/services/tarefasMapaService", () => ({ excluirHistorico: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock("@/services/mapaCacheService", () => ({
  getMapaCachedData: async (chave) => cache.dados[chave] || [],
  refreshMapaCacheEntry: async (chave) => cache.dados[chave] || [],
  updateMapaCachedData: vi.fn(),
}));

const { LancLoteDialogo } = await import("@/components/lotes/LancamentoLoteUi");
const { default: HistoricoSuplementacaoPonto } = await import("@/components/suplementacao/HistoricoSuplementacaoPonto");
const { default: HistoricoDepositoSuplementacao } = await import("@/components/suplementacao/HistoricoDepositoSuplementacao");
const { default: HistoricoTarefaPanel } = await import("@/components/mapa/HistoricoTarefaPanel");

const EMP = "emp-1";

beforeEach(() => {
  localStorage.setItem("empresa_selecionada_id", EMP);
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  cache.dados = {
    eventosSuplementacao: [
      { id: "ev-2", empresa_id: EMP, ponto_suplementacao_id: "cocho-1", produto: "SAL MINERAL 80", data_lancamento: "2026-11-09", created_date: "2026-11-09T10:00:00.000Z", total_cabecas_afetadas: 314, peso_medio_lotes_kg: 216.8, unidade_lancamento: "SACO", quantidade_total_kg: 400, area_nomes: ["Pasto 07"], observacoes: "Lançado pelo João." },
      { id: "ev-1", empresa_id: EMP, ponto_suplementacao_id: "cocho-1", produto: "SAL MINERAL 80", data_lancamento: "2026-10-27", created_date: "2026-10-27T10:00:00.000Z", total_cabecas_afetadas: 314, dias_periodo: 13, quantidade_total_kg: 284.4 },
    ],
    movimentacoes: [],
    movimentacaoEstoque: [
      { id: "me-1", empresa_id: EMP, tipo_detalhado: "transferencia_recebida", origem_sistema: "deposito", local_estoque_origem: "local-x", local_estoque_destino: "local-1", local_origem: "Galpão Central", local_destino: "Galpão Sede", produto_nome: "SAL MINERAL 80", quantidade: 1000, saldo_antes: 400, saldo_depois: 1400, valor_total: 3500, data_movimentacao: "2026-11-04T12:00:00.000Z", created_date: "2026-11-04T12:00:00.000Z", observacoes: "NF 4.512" },
    ],
  };
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const noDialogo = (titulo, nome, ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LancLoteDialogo open onOpenChange={() => {}} titulo={titulo} lotes={[{ nome }]} largo somenteLeitura>
        {ui}
      </LancLoteDialogo>
    </QueryClientProvider>,
  );
};

const titulo = () => document.querySelector(".mk-ll-dlg__titulo")?.textContent;
const subtitulo = () => document.querySelector(".mk-ll-dlg__lotes")?.textContent;
/** "Rótulo: valor" de cada linha de um cartão. @param {Element} cartao */
const linhas = (cartao) =>
  [...cartao.querySelectorAll("strong")].map((forte) =>
    `${forte.textContent} ${forte.parentElement?.textContent?.slice(forte.textContent?.length ?? 0).trim()}`.replace(/\u00a0/g, " "),
  );
/** Os cartões da lista do histórico. */
const cartoes = () => [...document.querySelectorAll(".mk-hist__lista > .rounded-lg")];

describe("Histórico do cocho no desenho do manejo (D-PROD-221)", () => {
  it("título com a contagem no cabeçalho do diálogo, o cocho no subtítulo, sem cartão nem título por dentro", async () => {
    noDialogo("Histórico de Suplementação", "Cocho 07", <HistoricoSuplementacaoPonto pontoId="cocho-1" pontoNome="Cocho 07" ponto={{ id: "cocho-1" }} />);
    await screen.findAllByText("SAL MINERAL 80");
    expect(titulo()).toBe("Histórico do Cocho (2)");
    expect(subtitulo()).toBe("Cocho 07");
    // Um título só (o do cabeçalho): nada de "Histórico do Cocho (2)" dentro do corpo.
    expect(screen.getAllByText("Histórico do Cocho (2)")).toHaveLength(1);
    expect(document.querySelector(".mk-ll .rounded-xl, .mk-ll [class*='CardHeader']")).toBeNull();
    expect(screen.getByRole("note").textContent).toBe(MENSAGEM_ESTORNO_SUSPENSO);
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
  });

  it("cada lançamento é um cartão do manejo: selo da data primeiro, produto em negrito e as linhas de antes", async () => {
    noDialogo("Histórico de Suplementação", "Cocho 07", <HistoricoSuplementacaoPonto pontoId="cocho-1" pontoNome="Cocho 07" ponto={{ id: "cocho-1" }} />);
    await screen.findAllByText("SAL MINERAL 80");
    const [aberto, fechado] = cartoes();
    expect(cartoes()).toHaveLength(2);
    const selos = [...aberto.querySelectorAll(".flex-wrap > *")].map((s) => s.textContent);
    expect(selos).toEqual(["09/11/2026", "Em aberto"]);
    expect([...fechado.querySelectorAll(".flex-wrap > *")].map((s) => s.textContent)).toEqual(["27/10/2026", "Fechado"]);
    expect(within(aberto).getByText("SAL MINERAL 80").className).toBe("text-xs font-semibold text-slate-900");
    const doAberto = linhas(aberto);
    expect(doAberto.slice(0, 4)).toEqual(["Áreas: Pasto 07", "Cabeças: 314", "Peso médio: 216,8 kg", "Unidade: SACO"]);
    expect(doAberto).toContain("Quantidade kg: 400,00 kg");
    expect(doAberto).toContain("Fechamento: Em aberto");
    expect(doAberto.at(-1)).toBe("Observações: Lançado pelo João.");
    // As métricas continuam agrupadas pela seção, como antes.
    expect([...aberto.querySelectorAll("[data-secao]")].map((s) => s.getAttribute("data-secao"))).toEqual(["fornecimento", "lote", "esperado", "projecao"]);
  });
});

describe("Histórico do depósito no desenho do manejo (D-PROD-221)", () => {
  it("título com a contagem no cabeçalho, o depósito no subtítulo e o cartão do manejo com os dados de antes", async () => {
    noDialogo("Histórico do Depósito", "Depósito Sede", <HistoricoDepositoSuplementacao deposito={{ id: "dep-1", local_estoque_id: "local-1" }} />);
    await screen.findByText("SAL MINERAL 80");
    expect(titulo()).toBe("Histórico do Depósito (1)");
    expect(subtitulo()).toBe("Depósito Sede");
    expect(screen.getAllByText("Histórico do Depósito (1)")).toHaveLength(1);
    const [cartao] = cartoes();
    expect([...cartao.querySelectorAll(".flex-wrap > *")].map((s) => s.textContent)).toEqual(["04/11/2026", "Entrada (transferência)"]);
    expect(linhas(cartao)).toEqual([
      "Quantidade kg: 1.000,00 kg",
      "Unidade: KG",
      "Origem: Galpão Central",
      "Destino: Galpão Sede",
      "Saldo antes: 400,00 kg",
      "Saldo depois: 1.400,00 kg",
      "Valor total: R$ 3.500,00",
      "Custo médio: -",
      "Observações: NF 4.512",
    ]);
    expect(screen.getByRole("note").textContent).toBe(MENSAGEM_ESTORNO_SUSPENSO);
    expect(screen.queryByRole("button", { name: /Excluir/ })).toBeNull();
  });

  it("sem movimentação: o vazio do manejo e o título sem contagem", async () => {
    cache.dados.movimentacaoEstoque = [];
    noDialogo("Histórico do Depósito", "Depósito Sede", <HistoricoDepositoSuplementacao deposito={{ id: "dep-1", local_estoque_id: "local-1" }} />);
    expect(await screen.findByText("Nenhum registro encontrado")).toBeTruthy();
    expect(titulo()).toBe("Histórico do Depósito");
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("Histórico da tarefa no desenho do manejo (D-PROD-221)", () => {
  const HISTORICO = [
    { id: "h2", status: "Em andamento", evento: "Pendente → Em andamento", responsavel: "Ana", descricao: "Começou a cerca.", data_evento: "2026-11-12T14:30:00" },
    { id: "h1", status: "Pendente", evento: "Criação", responsavel: "Ana", descricao: "Tarefa criada pelo mapa.", data_evento: "2026-11-10T09:00:00" },
  ];

  it("título com a contagem no cabeçalho; cartões do manejo; o \"Excluir\" do manejo no rodapé, só o mais recente ligado", async () => {
    noDialogo("Histórico da tarefa", "Consertar cerca", <HistoricoTarefaPanel tarefaId="t1" tarefaTitulo="Consertar cerca" historico={HISTORICO} />);
    expect(titulo()).toBe("Histórico da Tarefa (2)");
    expect(subtitulo()).toBe("Consertar cerca");
    const [recente, antigo] = cartoes();
    expect([...recente.querySelectorAll(".flex-wrap > *")].map((s) => s.textContent)).toEqual(["12/11/2026", "Em andamento"]);
    expect(linhas(recente)).toEqual(["Evento: Pendente → Em andamento", "Responsável: Ana", "Descrição: Começou a cerca.", "Hora: 14:30:00"]);
    const excluir = cartoes().map((c) => within(/** @type {HTMLElement} */ (c)).getByRole("button", { name: "Excluir" }));
    expect(excluir.map((b) => b.disabled)).toEqual([false, true]);
    // O botão do "Excluir movimentação" do manejo: contorno, 32 px, vermelho quando ligado.
    expect(excluir[0].className).toMatch(/\bh-8\b/);
    expect(excluir[0].className).toMatch(/text-red-700/);
    expect(excluir[1].className).toMatch(/text-slate-500/);
    expect(within(/** @type {HTMLElement} */ (antigo)).getByText("Somente o último histórico pode ser excluído.")).toBeTruthy();
  });
});

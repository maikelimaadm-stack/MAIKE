// @vitest-environment jsdom
/**
 * UI-DETALHES-LOTE-V8 — a pesagem recém-registrada aparece ao reabrir o Detalhes
 * do Lote. Achado do dono no preview: pesou, reabriu e a pesagem não estava lá.
 * Causa: o diálogo fecha depois do manejo e, ao reabrir em menos de 1 min, a
 * query das movimentações (staleTime 60 s) devolvia a lista antiga da memória
 * sem reler — mesmo com o cache do mapa já atualizado pelo 'atualizar-mapa'.
 * DetalhesLote REAL; mocks só na borda (cache do mapa, serviços, toast).
 *
 * v12 (D-PROD-V12): a aba Lotes abre na Lista no desktop e as colunas padrão
 * (Alertas + Lotação + Pesagem) têm "Última" e "Origem". O teste com o
 * DetalhesLote real usa a casca real (PainelPasto) e roda depois da integração
 * das peças do Detalhes v12; o da casca de teste vale já.
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
vi.mock("@/components/lotes/HistoricoMovimentacoes", formulario("historico"));
vi.mock("@/components/suplementacao/HistoricoSuplementacaoLote", formulario("historico-supl"));

const { default: DetalhesLote } = await import("@/components/mapa/DetalhesLote");
const { montarModeloDetalhes } = await import("@/components/mapa/detalhes-lote/catalogo");
const { esquecerEstadoLotes } = await import("@/components/mapa/detalhes-lote/useEstadoLotes");
const { CascaDeTeste } = await import("./fixtures/pastoV12.jsx");

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
  esquecerEstadoLotes();
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: /min-width: 1024px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
  dados.areas = [{ id: "a1", nome: "PASTO A", tamanho_hectares: 50, tipo_pastagem: "Brachiaria", tipo_cultura: "Pastagem" }];
  dados.lotes = [posicao];
  dados.movimentacoes = [];
});
afterEach(() => cleanup());

describe("Detalhes do Lote: pesagem nova aparece ao reabrir", () => {
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

describe("Detalhes do Lote v12: Lista com as colunas da pesagem", () => {
  it("aba Lotes → Lista: 'Última' e 'Origem' com a pesagem do cache de movimentações", async () => {
    const area = dados.areas[0];
    const sem = montarModeloDetalhes({ area, lotes: [posicao], movimentacoes: [], hoje: new Date(2026, 10, 9) });
    const primeira = render(<CascaDeTeste modelo={sem} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Lista", exact: true })); });
    expect(screen.getByText("Última")).toBeTruthy();
    expect(screen.getByText("Origem")).toBeTruthy();
    expect(screen.queryByText("05/11/2026")).toBeNull();
    primeira.unmount();

    const com = montarModeloDetalhes({ area, lotes: [posicao], movimentacoes: [pesagem], hoje: new Date(2026, 10, 9) });
    render(<CascaDeTeste modelo={com} />);
    expect(screen.getByText("05/11/2026")).toBeTruthy();
    expect(screen.getByText("MEDIDO")).toBeTruthy();
  });
});

describe("Manejo com data futura: mensagem clara (não 'Resultado desconhecido')", () => {
  it("REBANHO_DATA_FUTURA e EMPRESA_FUSO_NAO_CONFIGURADO têm mensagem própria", async () => {
    const { mensagemDaTransferenciaLedger } = await import("@/services/manejoRebanhoService");
    // Forma real do erro do cliente nativo: código genérico na casca, código do servidor no `cause`.
    const futura = Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "REBANHO_DATA_FUTURA", details: { data: "2026-12-04", hoje: "2026-11-09" } } });
    const semFuso = Object.assign(new Error("x"), { code: "API_OPERATION_FAILED", cause: { code: "EMPRESA_FUSO_NAO_CONFIGURADO" } });
    expect(mensagemDaTransferenciaLedger(futura)).toMatch(/depois de hoje/);
    expect(mensagemDaTransferenciaLedger(futura)).not.toMatch(/Resultado desconhecido/);
    expect(mensagemDaTransferenciaLedger(semFuso)).toMatch(/fuso horário da fazenda/);
  });
});

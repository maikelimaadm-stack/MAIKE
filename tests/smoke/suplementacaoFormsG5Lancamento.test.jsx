/**
 * Frente G5 — G5-1 de ponta a ponta: o formulário de lançamento do cocho, montado com um cocho
 * ligado a 12 pastos de nome longo e a um depósito, chama `registrarSaidaSuplementacao` com
 * `areaNome` que cabe nos 255 caracteres da rota (antes mandava `nomes.join(', ')` e a rota
 * respondia 400). O evento continua com a lista completa.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toast = vi.hoisted(() => Object.assign(() => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal()), toast }));

const saida = vi.hoisted(() => vi.fn());
const lancar = vi.hoisted(() => vi.fn());

const AREAS = Array.from({ length: 12 }, (_, i) => ({ id: `area-${i + 1}`, nome: `PASTO DA INVERNADA NUM ${String(i + 1).padStart(2, "0")}`, ativo: true }));
const PRODUTO = { id: "prod-1", empresa_id: "emp-1", nome_produto: "SAL MINERAL", tipo_uso: "Nutrição Animal", unidade_principal_estoque: "KG" };
const FORMULACAO = { id: "f-1", nome: "SAL MINERAL 80", tipo: "PRONTO", produto_id: "prod-1", produto_nome: "SAL MINERAL", produto_ativo: true, percentual_pv_padrao: 0.1, consumo_objetivo_g_cab_dia: null, regras: [] };
const DEPOSITO = { id: "dep-1", empresa_id: "emp-1", nome_ponto: "DEPÓSITO", categoria_ponto: "DEPOSITO", local_estoque_id: "loc-1", local_estoque_nome: "ARMAZÉM" };
const PONTO = { id: "p1", empresa_id: "emp-1", nome_ponto: "COCHO 1", categoria_ponto: "COCHO", area_vinculada_ids: AREAS.map((a) => a.id), deposito_origem_id: "dep-1", produto_padrao: "SAL MINERAL" };

vi.mock("@/services/suplementacaoService", async (importOriginal) => ({
  ...(await importOriginal()),
  carregarPontoAtualizado: vi.fn(async () => PONTO),
  listarPontosDaEmpresa: vi.fn(async () => [PONTO, DEPOSITO]),
  listarAreasDaEmpresa: vi.fn(async () => AREAS),
  listarRebanhoParaSuplementacao: vi.fn(async () => [
    { id: "pa", posicao_id: "pa", __posicao: true, nome: "LOTE A", quantidade_cabecas: 30, area_atual_id: "area-1", status: "Ativo", categoria: "Boi 25 a 36 meses", projecao_peso: { disponivel: true, peso_kg: 400 }, peso_medio_kg: 380 },
  ]),
  listarProdutosDaEmpresa: vi.fn(async () => [PRODUTO]),
  listarFormulacoesParaLancamento: vi.fn(async () => [FORMULACAO]),
  listarLotesNotaDaEmpresa: vi.fn(async () => [{ id: "ln-1", empresa_id: "emp-1", produto_id: "prod-1", local_estoque_id: "loc-1", quantidade_disponivel: 5000, status: "Disponivel", data_documento: "2026-01-05" }]),
  listarMovimentacoesPecuariasDaEmpresa: vi.fn(async () => []),
  listarEventosDoPonto: vi.fn(async () => []),
  ultimoEventoDoPonto: vi.fn(async () => null),
  registrarLancamento: lancar,
  // D-PROD-296: o formulário chama o registro único; o adaptador passa pelas simulações de antes.
  registrarLancamentoDoCocho: (await import("./helpers/shimLancamentoCocho.js")).criarShimLancamentoDoCocho({ saida: saida, lancar: lancar, fechar: undefined }),
  fecharPeriodoSuplementacao: vi.fn(async () => ({})),
}));
vi.mock("@/services/suplementacaoEstoqueService", async (importOriginal) => ({ ...(await importOriginal()), registrarSaidaSuplementacao: saida }));
vi.mock("@/services/mapaCacheService", async (importOriginal) => ({
  ...(await importOriginal()),
  updateMapaCachedData: vi.fn(async () => {}),
  refreshMapaCacheEntry: vi.fn(async () => {}),
}));
vi.mock("@/services/empresaService", async (importOriginal) => ({ ...(await importOriginal()), listEmpresas: vi.fn(async () => [{ id: "emp-1", fuso_horario: "America/Cuiaba" }]) }));
vi.mock("@/services/sessionService", async (importOriginal) => ({ ...(await importOriginal()), getCurrentUser: vi.fn(async () => ({ id: "u-1" })) }));

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem("empresa_selecionada_id", "emp-1");
  saida.mockReset();
  lancar.mockReset();
  saida.mockImplementation(async () => ({ movimentacao: { id: "mov-1" } }));
  lancar.mockImplementation(async ({ evento }) => ({ id: "ev-novo", ...evento }));
});
afterEach(() => cleanup());

describe("G5-1 — lançamento do cocho com muitos pastos", () => {
  it("a saída de estoque recebe areaNome com no máximo 255 caracteres; o evento guarda a lista completa", async () => {
    const { default: FormularioLancamentoSuplementacao } = await import("@/components/suplementacao/FormularioLancamentoSuplementacao");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(<QueryClientProvider client={client}><FormularioLancamentoSuplementacao ponto={PONTO} onCancel={() => {}} /></QueryClientProvider>);
    });
    await assentar();
    await screen.findByText(/Data do abastecimento/);
    await waitFor(() => expect(screen.getByText(/cabeças/)).toBeTruthy());

    const nomesCompletos = AREAS.map((a) => a.nome).join(", ");
    expect(nomesCompletos.length).toBeGreaterThan(255);

    await act(async () => { fireEvent.change(screen.getAllByPlaceholderText("0,00")[0], { target: { value: "200" } }); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar novo ciclo" })); });
    await assentar();

    expect(saida).toHaveBeenCalledTimes(1);
    const { areaNome } = saida.mock.calls[0][0];
    expect(typeof areaNome).toBe("string");
    expect(areaNome.length).toBeLessThanOrEqual(255);
    expect(areaNome.startsWith("PASTO DA INVERNADA NUM 01, ")).toBe(true);
    expect(areaNome).toMatch(/ \+\d+$/);

    expect(lancar).toHaveBeenCalledTimes(1);
    const { evento } = lancar.mock.calls[0][0];
    expect(evento.area_nome).toBe(nomesCompletos);
  });
});

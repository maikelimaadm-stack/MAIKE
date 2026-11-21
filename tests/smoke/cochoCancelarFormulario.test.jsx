/**
 * D-PROD-268 — o formulário de lançamento do cocho e o cancelamento:
 *  CF-1. o comando leva `evento_anterior_id` (o último lançamento que a tela viu; null sem nenhum)
 *        e o fechamento do período anterior leva a prova de QUEM fechou (`fechadoPorEventoId`);
 *  CF-2. 409 LANCAMENTO_DESATUALIZADO: mensagem em português, nada a mais é gravado, e salvar de
 *        novo reaproveita a baixa já feita (mesmo operation_id, sem segunda baixa);
 *  CF-3. 409 SUPLEMENTACAO_REGISTRO_CANCELADO (o reenvio achou o lançamento já cancelado em outra
 *        tela): frase própria, sem fechar o anterior, sem "registrada com sucesso", e a próxima
 *        tentativa é OUTRA operação (nova baixa, nova chave).
 * Montagem copiada de suplementacaoLancamentoBase.test.jsx (mesmos mocks).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toast = vi.hoisted(() => Object.assign(() => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal()), toast }));

const estado = vi.hoisted(() => ({
  rebanho: /** @type {any[]} */ ([]),
  formulacoes: /** @type {any[]} */ ([]),
  produtos: /** @type {any[]} */ ([]),
  ultimoEvento: /** @type {any} */ (null),
  lancamento: /** @type {any} */ (null),
  fechar: /** @type {any} */ (null),
}));
const saida = vi.hoisted(() => vi.fn());
const lancar = vi.hoisted(() => vi.fn());
const fechar = vi.hoisted(() => vi.fn());

// D-PROD-203: o %PV do PRODUTO (0,3) não é mais lido no lançamento — o esperado usa o da formulação (0,1).
const PRODUTO = { id: "prod-1", empresa_id: "emp-1", nome_produto: "SAL MINERAL", tipo_uso: "Nutrição Animal", percentual_consumo_pv: 0.3, unidade_principal_estoque: "KG" };
const FORMULACAO = { id: "f-1", nome: "SAL MINERAL 80", tipo: "PRONTO", produto_id: "prod-1", produto_nome: "SAL MINERAL", produto_ativo: true, percentual_pv_padrao: 0.1, consumo_objetivo_g_cab_dia: null, regras: [] };
const DEPOSITO = { id: "dep-1", empresa_id: "emp-1", nome_ponto: "DEPÓSITO", categoria_ponto: "DEPOSITO", local_estoque_id: "loc-1", local_estoque_nome: "ARMAZÉM" };
const PONTO = { id: "p1", empresa_id: "emp-1", nome_ponto: "COCHO 1", categoria_ponto: "COCHO", area_vinculada_ids: ["area-a"], deposito_origem_id: "dep-1", produto_padrao: "SAL MINERAL" };

vi.mock("@/services/suplementacaoService", async (importOriginal) => ({
  ...(await importOriginal()),
  carregarPontoAtualizado: vi.fn(async () => PONTO),
  listarPontosDaEmpresa: vi.fn(async () => [PONTO, DEPOSITO]),
  listarAreasDaEmpresa: vi.fn(async () => [{ id: "area-a", nome: "PASTO A", ativo: true }]),
  listarRebanhoParaSuplementacao: vi.fn(async () => estado.rebanho),
  listarProdutosDaEmpresa: vi.fn(async () => estado.produtos),
  listarFormulacoesParaLancamento: vi.fn(async () => estado.formulacoes),
  listarLotesNotaDaEmpresa: vi.fn(async () => [{ id: "ln-1", empresa_id: "emp-1", produto_id: "prod-1", local_estoque_id: "loc-1", quantidade_disponivel: 5000, status: "Disponivel", data_documento: "2026-01-05" }]),
  listarMovimentacoesPecuariasDaEmpresa: vi.fn(async () => []),
  listarEventosDoPonto: vi.fn(async () => []),
  ultimoEventoDoPonto: vi.fn(async () => estado.ultimoEvento),
  registrarLancamento: lancar,
  fecharPeriodoSuplementacao: fechar,
}));
vi.mock("@/services/suplementacaoEstoqueService", async (importOriginal) => ({ ...(await importOriginal()), registrarSaidaSuplementacao: saida }));
vi.mock("@/services/mapaCacheService", async (importOriginal) => ({
  ...(await importOriginal()),
  updateMapaCachedData: vi.fn(async () => {}),
  refreshMapaCacheEntry: vi.fn(async () => {}),
}));
vi.mock("@/services/empresaService", async (importOriginal) => ({ ...(await importOriginal()), listEmpresas: vi.fn(async () => [{ id: "emp-1", fuso_horario: "America/Cuiaba" }]) }));
vi.mock("@/services/sessionService", async (importOriginal) => ({ ...(await importOriginal()), getCurrentUser: vi.fn(async () => ({ id: "u-1" })) }));

const posicao = (id, nome, cab, extra = {}) => ({ id, posicao_id: id, __posicao: true, nome, quantidade_cabecas: cab, area_atual_id: "area-a", status: "Ativo", categoria: "Boi 25 a 36 meses", ...extra });
const projecao = (peso) => ({ disponivel: true, peso_kg: peso });

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
// O primeiro "0,00" é a quantidade fornecida (o segundo, a sobra).
const campoKg = () => /** @type {HTMLInputElement} */ (screen.getAllByPlaceholderText("0,00")[0]);
const salvar = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar novo ciclo" })); });
  await assentar();
};

const montar = async () => {
  const { default: FormularioLancamentoSuplementacao } = await import("@/components/suplementacao/FormularioLancamentoSuplementacao");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCancel = vi.fn();
  await act(async () => {
    render(<QueryClientProvider client={client}><FormularioLancamentoSuplementacao ponto={PONTO} onCancel={onCancel} /></QueryClientProvider>);
  });
  await assentar();
  await screen.findByText(/Data do abastecimento/);
  await waitFor(() => expect(screen.getByText(/cabeças/)).toBeTruthy());
  return { onCancel };
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem("empresa_selecionada_id", "emp-1");
  for (const f of Object.values(toast)) if (typeof f === "function" && "mockReset" in f) f.mockReset();
  saida.mockReset();
  lancar.mockReset();
  fechar.mockReset();
  estado.rebanho = [posicao("pa", "LOTE A", 30, { projecao_peso: projecao(400), peso_medio_kg: 380 }), posicao("pb", "LOTE B", 20, { peso_medio_kg: null })];
  estado.ultimoEvento = null;
  estado.formulacoes = [FORMULACAO];
  estado.produtos = [PRODUTO];
  saida.mockImplementation(async () => ({ movimentacao: { id: "mov-1" } }));
  lancar.mockImplementation(async ({ evento }) => ({ id: "ev-novo", ...evento }));
  fechar.mockImplementation(async () => ({}));
});
afterEach(() => cleanup());

describe("D-PROD-268 — lançamento e cancelamento", () => {
  it("CF-1 — sem anterior: evento_anterior_id null; com anterior aberto: o id dele e o fechamento com fechadoPorEventoId", async () => {
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(lancar.mock.calls[0][0].eventoAnteriorId).toBeNull();
    cleanup();

    estado.ultimoEvento = { id: "ev-1", data_lancamento: "2020-01-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null };
    lancar.mockReset();
    lancar.mockImplementation(async ({ evento }) => ({ id: "ev-novo", ...evento }));
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(lancar.mock.calls[0][0].eventoAnteriorId).toBe("ev-1");
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(fechar.mock.calls[0][0]).toMatchObject({ fechadoPorEventoId: "ev-novo", evento: expect.objectContaining({ id: "ev-1" }) });
  });

  it("CF-2 — LANCAMENTO_DESATUALIZADO: frase do cocho mudou; o reenvio reaproveita a baixa e o mesmo operation_id", async () => {
    estado.ultimoEvento = { id: "ev-1", data_lancamento: "2020-01-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null };
    lancar.mockImplementationOnce(async () => { throw Object.assign(new Error("409"), { cause: { code: "LANCAMENTO_DESATUALIZADO" } }); });
    const { MENSAGEM_LANCAMENTO_DESATUALIZADO } = await import("@/components/suplementacao/FormularioLancamentoSuplementacao");
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(saida).toHaveBeenCalledTimes(1);
    expect(fechar).not.toHaveBeenCalled();
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(MENSAGEM_LANCAMENTO_DESATUALIZADO);
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/o estoque não será baixado outra vez/);
    const op = saida.mock.calls[0][0].operationId;
    await salvar();
    expect(saida).toHaveBeenCalledTimes(1);
    expect(lancar).toHaveBeenCalledTimes(2);
    expect(lancar.mock.calls[1][0].operationId).toBe(op);
  });

  it("CF-3 — SUPLEMENTACAO_REGISTRO_CANCELADO: frase do lançamento cancelado; nada de sucesso; a chave é descartada", async () => {
    estado.ultimoEvento = { id: "ev-1", data_lancamento: "2020-01-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null };
    lancar.mockImplementationOnce(async () => { throw Object.assign(new Error("409"), { cause: { code: "SUPLEMENTACAO_REGISTRO_CANCELADO", details: { evento_id: "ev-n" } } }); });
    const { MENSAGEM_LANCAMENTO_JA_CANCELADO } = await import("@/components/suplementacao/FormularioLancamentoSuplementacao");
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(fechar).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error.mock.calls.at(-1)[0]).toBe(MENSAGEM_LANCAMENTO_JA_CANCELADO);
    const op = saida.mock.calls[0][0].operationId;
    await salvar();
    expect(saida).toHaveBeenCalledTimes(2);
    expect(saida.mock.calls[1][0].operationId).not.toBe(op);
    expect(lancar.mock.calls[1][0].operationId).not.toBe(op);
  });
});

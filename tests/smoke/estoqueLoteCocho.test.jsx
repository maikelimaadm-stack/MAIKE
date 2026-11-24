// @vitest-environment jsdom
/**
 * D-PROD-282 em todas as telas — o "Lançar" do cocho com produto que controla lote: o campo "Lote" (sugestão FEFO,
 * escolher e dividir, aviso de vencido com confirmação) aparece abaixo do saldo do depósito; a baixa leva `lotes` só
 * com a escolha manual; o vencido sem confirmação não grava; o aviso `lote_vencido` da resposta vira um alerta.
 * Produto sem lote: nada muda (sem campo, sem leitura dos lotes, a baixa sem `lotes`). Formulário REAL; só a rede é
 * de mentira (os services).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toast = vi.hoisted(() => Object.assign(() => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal()), toast }));

const PRODUTO = { id: "prod-1", empresa_id: "emp-1", nome_produto: "SAL MINERAL", tipo_uso: "Nutrição Animal", unidade_principal_estoque: "KG", controla_lote: false };
const FORMULACAO = { id: "f-1", nome: "SAL MINERAL 80", tipo: "PRONTO", produto_id: "prod-1", produto_nome: "SAL MINERAL", produto_ativo: true, percentual_pv_padrao: 0.1, consumo_objetivo_g_cab_dia: null, regras: [] };
const DEPOSITO = { id: "dep-1", empresa_id: "emp-1", nome_ponto: "DEPÓSITO", categoria_ponto: "DEPOSITO", local_estoque_id: "loc-1", local_estoque_nome: "ARMAZÉM" };
const PONTO = { id: "p1", empresa_id: "emp-1", nome_ponto: "COCHO 1", categoria_ponto: "COCHO", area_vinculada_ids: ["area-a"], deposito_origem_id: "dep-1", produto_padrao: "SAL MINERAL" };
const SALDO = { id: "ln-1", empresa_id: "emp-1", produto_id: "prod-1", local_estoque_id: "loc-1", quantidade_disponivel: 160, status: "Disponivel", data_documento: "2026-01-05" };
const LOTES = {
  unidade: "KG", controla_lote: true, controla_validade: true, hoje: "2026-11-15", dias_aviso: 30,
  lotes: [
    { id: "cV", lote_fabricante: "VELHO", data_validade: "2026-11-01", quantidade_disponivel: "10.0000", custo_unitario: "3.0000", vencido: true, vence_em_dias: -14 },
    { id: "cB", lote_fabricante: "B", data_validade: "2027-01-01", quantidade_disponivel: "50.0000", custo_unitario: "6.0000", vencido: false, vence_em_dias: 47 },
    { id: "cA", lote_fabricante: "A", data_validade: "2027-12-31", quantidade_disponivel: "100.0000", custo_unitario: "4.0000", vencido: false, vence_em_dias: 411 },
  ],
};

const estado = vi.hoisted(() => ({ produtos: /** @type {any[]} */ ([]) }));
const saida = vi.hoisted(() => vi.fn());
const lancar = vi.hoisted(() => vi.fn());
const lerLotes = vi.hoisted(() => vi.fn());

vi.mock("@/services/suplementacaoService", async (importOriginal) => ({
  ...(await importOriginal()),
  carregarPontoAtualizado: vi.fn(async () => PONTO),
  listarPontosDaEmpresa: vi.fn(async () => [PONTO, DEPOSITO]),
  listarAreasDaEmpresa: vi.fn(async () => [{ id: "area-a", nome: "PASTO A", ativo: true }]),
  listarRebanhoParaSuplementacao: vi.fn(async () => [{ id: "pa", posicao_id: "pa", __posicao: true, nome: "LOTE A", quantidade_cabecas: 30, area_atual_id: "area-a", status: "Ativo", categoria: "Boi", peso_medio_kg: 400 }]),
  listarProdutosDaEmpresa: vi.fn(async () => estado.produtos),
  listarFormulacoesParaLancamento: vi.fn(async () => [FORMULACAO]),
  listarLotesNotaDaEmpresa: vi.fn(async () => [SALDO]),
  listarMovimentacoesPecuariasDaEmpresa: vi.fn(async () => []),
  listarEventosDoPonto: vi.fn(async () => []),
  ultimoEventoDoPonto: vi.fn(async () => null),
  registrarLancamento: lancar,
  fecharPeriodoSuplementacao: vi.fn(async () => ({})),
}));
vi.mock("@/services/suplementacaoEstoqueService", async (importOriginal) => ({ ...(await importOriginal()), registrarSaidaSuplementacao: saida }));
const comando = vi.hoisted(() => vi.fn());
vi.mock("@/apis/movimentacoes-estoque", async (importOriginal) => ({ ...(await importOriginal()), comandoSaidaSuplementacao: comando }));
vi.mock("@/services/estoqueConsultaService", async (importOriginal) => ({ ...(await importOriginal()), listarLotesDisponiveis: lerLotes }));
vi.mock("@/services/mapaCacheService", async (importOriginal) => ({
  ...(await importOriginal()),
  getMapaCachedData: vi.fn(async () => []),
  updateMapaCachedData: vi.fn(async () => {}),
  refreshMapaCacheEntry: vi.fn(async () => {}),
}));
vi.mock("@/services/empresaService", async (importOriginal) => ({ ...(await importOriginal()), listEmpresas: vi.fn(async () => [{ id: "emp-1", fuso_horario: "America/Cuiaba" }]) }));
vi.mock("@/services/sessionService", async (importOriginal) => ({ ...(await importOriginal()), getCurrentUser: vi.fn(async () => ({ id: "u-1" })) }));

const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

const montar = async () => {
  const { default: Formulario } = await import("@/components/suplementacao/FormularioLancamentoSuplementacao");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Formulario ponto={PONTO} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  const form = await screen.findByTestId("form-lancamento-suplementacao");
  await assentar();
  await waitFor(() => expect(within(form).getByTestId("suplementacao-saldo-deposito")).toBeTruthy());
  return form;
};
const digitarKg = async (form, valor) => {
  await act(async () => { fireEvent.change(/** @type {HTMLInputElement} */ (within(form).getByPlaceholderText("0,00")), { target: { value: valor } }); });
  await assentar();
};
const salvar = async () => {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Salvar novo ciclo" })); });
  await assentar();
};

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem("empresa_selecionada_id", "emp-1");
  for (const f of Object.values(toast)) if (typeof f === "function" && "mockReset" in f) f.mockReset();
  saida.mockReset();
  lancar.mockReset();
  lerLotes.mockReset();
  estado.produtos = [PRODUTO];
  saida.mockImplementation(async () => ({ movimentacao: { id: "mov-1" }, avisos: [] }));
  lancar.mockImplementation(async ({ evento }) => ({ id: "ev-novo", ...evento }));
  lerLotes.mockImplementation(async () => LOTES);
});
afterEach(() => cleanup());

describe("D-PROD-282 — lote no lançamento do cocho", () => {
  it("produto sem lote: nenhum campo, nenhuma leitura dos lotes; a baixa vai como hoje (sem `lotes`)", async () => {
    const form = await montar();
    await digitarKg(form, "20");
    expect(within(form).queryByTestId("suplementacao-lotes")).toBeNull();
    await salvar();
    expect(lerLotes).not.toHaveBeenCalled();
    expect(saida).toHaveBeenCalledTimes(1);
    expect("lotes" in saida.mock.calls[0][0]).toBe(false);
  });

  it("produto com lote: sugere FEFO; o vencido sem confirmação não grava; escolher A + B manda `lotes`", async () => {
    estado.produtos = [{ ...PRODUTO, controla_lote: true, controla_validade: true }];
    const form = await montar();
    await digitarKg(form, "20");
    const campo = await within(form).findByTestId("suplementacao-lotes");
    expect((await within(campo).findByTestId("suplementacao-lotes-sugestao")).textContent).toContain("VELHO");
    expect(within(campo).getByTestId("suplementacao-lotes-vencido").textContent).toContain("Lote vencido em 01/11");
    await salvar();
    expect(saida).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Confirme o uso do lote vencido.");

    // Escolher lotes: 12 do A + 8 do B (sem o vencido).
    await act(async () => { fireEvent.click(within(campo).getByTestId("suplementacao-lotes-alternar")); });
    await act(async () => {
      fireEvent.change(within(campo).getByTestId("suplementacao-lotes-qtd-cV"), { target: { value: "" } });
      fireEvent.change(within(campo).getByTestId("suplementacao-lotes-qtd-cB"), { target: { value: "8" } });
      fireEvent.change(within(campo).getByTestId("suplementacao-lotes-qtd-cA"), { target: { value: "12" } });
    });
    await assentar();
    expect(within(campo).queryByTestId("suplementacao-lotes-vencido")).toBeNull();
    await salvar();
    expect(saida).toHaveBeenCalledTimes(1);
    expect(saida.mock.calls[0][0].lotes).toEqual([{ estoque_lote_nota_id: "cB", quantidade: "8" }, { estoque_lote_nota_id: "cA", quantidade: "12" }]);
  });

  it("soma dos lotes diferente da quantidade: não grava e diz o porquê", async () => {
    estado.produtos = [{ ...PRODUTO, controla_lote: true }];
    const form = await montar();
    await digitarKg(form, "20");
    const campo = await within(form).findByTestId("suplementacao-lotes");
    await within(campo).findByTestId("suplementacao-lotes-sugestao");
    await act(async () => { fireEvent.click(within(campo).getByTestId("suplementacao-lotes-alternar")); });
    await act(async () => {
      fireEvent.change(within(campo).getByTestId("suplementacao-lotes-qtd-cV"), { target: { value: "" } });
      fireEvent.change(within(campo).getByTestId("suplementacao-lotes-qtd-cB"), { target: { value: "5" } });
    });
    await assentar();
    await salvar();
    expect(saida).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("A soma dos lotes tem de ser a quantidade da linha.");
  });

  it("vencido confirmado: grava pelo FEFO (sem `lotes`) e o aviso da resposta vira alerta", async () => {
    estado.produtos = [{ ...PRODUTO, controla_lote: true }];
    saida.mockImplementation(async () => ({ movimentacao: { id: "mov-1" }, avisos: [{ tipo: "lote_vencido", lote_id: "cV", lote: "VELHO", validade: "2026-11-01" }] }));
    const form = await montar();
    await digitarKg(form, "20");
    const campo = await within(form).findByTestId("suplementacao-lotes");
    await within(campo).findByTestId("suplementacao-lotes-vencido");
    await act(async () => { fireEvent.click(within(campo).getByTestId("suplementacao-lotes-confirma-vencido")); });
    await salvar();
    expect(saida).toHaveBeenCalledTimes(1);
    expect("lotes" in saida.mock.calls[0][0]).toBe(false);
    expect(toast.warning).toHaveBeenCalledWith("Saiu de lote vencido: VELHO (venceu em 01/11/2026).");
  });

  it("service da baixa: produto com lote manda `lotes` e não leva o rateio FIFO do navegador; devolve os avisos; sem lote, como hoje", async () => {
    const { registrarSaidaSuplementacao } = await vi.importActual("@/services/suplementacaoEstoqueService");
    comando.mockImplementation(async () => ({ committed: true, movimentacao: { id: "m" }, rateio: [], avisos: [{ tipo: "lote_vencido", lote: "VELHO", validade: "2026-11-01" }] }));
    const base = { empresaId: "emp-1", quantidade: 20, localOrigemId: "loc-1", observacoes: "Saída automática", lotesNota: [SALDO], operationId: "op-12345678" };
    const lotes = [{ estoque_lote_nota_id: "cA", quantidade: "20" }];
    const r = await registrarSaidaSuplementacao({ ...base, produto: { ...PRODUTO, controla_lote: true, estoque_atual: 160 }, lotes });
    expect(comando.mock.calls[0][0]).toMatchObject({ lotes, observacoes: "Saída automática" });
    expect(r.avisos).toHaveLength(1);
    await registrarSaidaSuplementacao({ ...base, produto: { ...PRODUTO, estoque_atual: 160 }, lotes });
    expect("lotes" in comando.mock.calls[1][0]).toBe(false);
    expect(comando.mock.calls[1][0].observacoes).toContain("[RATEIO_FIFO]");
  });
});

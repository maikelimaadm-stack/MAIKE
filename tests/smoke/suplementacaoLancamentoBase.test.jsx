/**
 * D-PROD-201 — base do lançamento de suplementação no cocho.
 *
 *  SB-1. rebanho da MESMA fonte do mapa (posições do ledger) e peso PROJETADO;
 *        lote sem peso fica fora da média (antes entrava como 0 kg) e a tela avisa;
 *  SB-2. salvar de novo depois de falha no evento NÃO baixa o estoque outra vez e
 *        usa o MESMO operation_id;
 *  SB-3. mudar a quantidade depois da baixa feita: recusa (não baixa de novo);
 *  SB-4. data anterior ao último abastecimento: recusa, nada é gravado;
 *  SB-5. falha ao fechar o período anterior: aviso (toast.warning), o lançamento
 *        conta como salvo — antes `toast.warn` (inexistente) virava "Não foi possível registrar";
 *  SB-6. funções puras (peso de consumo, datas, chave da baixa) e o motivo "sem peso" no mapa.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toast = vi.hoisted(() => Object.assign(() => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({ ...(await importOriginal()), toast }));

const estado = vi.hoisted(() => ({
  rebanho: /** @type {any[]} */ ([]),
  ultimoEvento: /** @type {any} */ (null),
  lancamento: /** @type {any} */ (null),
  fechar: /** @type {any} */ (null),
}));
const saida = vi.hoisted(() => vi.fn());
const lancar = vi.hoisted(() => vi.fn());
const fechar = vi.hoisted(() => vi.fn());

const PRODUTO = { id: "prod-1", empresa_id: "emp-1", nome_produto: "SAL MINERAL", tipo_uso: "Nutrição Animal", percentual_consumo_pv: 0.1, unidade_principal_estoque: "KG" };
const DEPOSITO = { id: "dep-1", empresa_id: "emp-1", nome_ponto: "DEPÓSITO", categoria_ponto: "DEPOSITO", local_estoque_id: "loc-1", local_estoque_nome: "ARMAZÉM" };
const PONTO = { id: "p1", empresa_id: "emp-1", nome_ponto: "COCHO 1", categoria_ponto: "COCHO", area_vinculada_ids: ["area-a"], deposito_origem_id: "dep-1", produto_padrao: "SAL MINERAL" };

vi.mock("@/services/suplementacaoService", async (importOriginal) => ({
  ...(await importOriginal()),
  carregarPontoAtualizado: vi.fn(async () => PONTO),
  listarPontosDaEmpresa: vi.fn(async () => [PONTO, DEPOSITO]),
  listarAreasDaEmpresa: vi.fn(async () => [{ id: "area-a", nome: "PASTO A", ativo: true }]),
  listarRebanhoParaSuplementacao: vi.fn(async () => estado.rebanho),
  listarProdutosDaEmpresa: vi.fn(async () => [PRODUTO]),
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
  saida.mockImplementation(async () => ({ movimentacao: { id: "mov-1" } }));
  lancar.mockImplementation(async ({ evento }) => ({ id: "ev-novo", ...evento }));
  fechar.mockImplementation(async () => ({}));
});
afterEach(() => cleanup());

describe("D-PROD-201 — rebanho e peso do lançamento", () => {
  it("SB-1 — posições do mapa, peso projetado, lote sem peso fora da média e com aviso", async () => {
    await montar();
    expect(screen.getByText(/2 lote\(s\) - 50 cabeças/)).toBeTruthy();
    // 30 cab × 400 kg (projetado) → 400 kg; o LOTE B (sem peso) não puxa para 240.
    expect(screen.getByText(/Peso médio:/).textContent).toMatch(/400,0 kg/);
    expect(screen.getByTestId("suplementacao-sem-peso").textContent).toMatch(/20 cabeça\(s\) sem peso \(LOTE B\)/);
    expect(screen.getByTestId("suplementacao-peso-origem").textContent).toMatch(/peso projetado de hoje/);

    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(lancar).toHaveBeenCalledTimes(1);
    const { evento, lotes } = lancar.mock.calls[0][0];
    expect(evento.total_cabecas_afetadas).toBe(50);
    expect(evento.peso_medio_lotes_kg).toBe(400);
    expect(evento.cabecas_sem_peso).toBe(20);
    // 400 kg × 0,1% × 50 cab = 20 kg/dia (a média dos com peso vale para todas as cabeças).
    expect(evento.consumo_esperado_pv_kg).toBeCloseTo(20, 6);
    expect(lotes.map((l) => [l.lote_id, l.peso_medio_lote_kg])).toEqual([["pa", 400], ["pb", null]]);
  });
});

describe("D-PROD-201 — salvar de novo não baixa duas vezes", () => {
  it("SB-2 — o evento falha, salvar de novo reaproveita a baixa e o mesmo operation_id", async () => {
    lancar.mockImplementationOnce(async () => { throw new Error("rede caiu"); });
    const { onCancel } = await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(saida).toHaveBeenCalledTimes(1);
    expect(lancar).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/A baixa no estoque foi registrada: clique em salvar de novo/);
    const opBaixa = saida.mock.calls[0][0].operationId;
    expect(lancar.mock.calls[0][0].operationId).toBe(opBaixa);

    await salvar();
    expect(saida).toHaveBeenCalledTimes(1); // sem segunda baixa
    expect(lancar).toHaveBeenCalledTimes(2);
    expect(lancar.mock.calls[1][0].operationId).toBe(opBaixa);
    expect(lancar.mock.calls[1][0].evento.movimentacao_estoque_id).toBe("mov-1");
    expect(toast.success).toHaveBeenCalledWith("Suplementação registrada com sucesso.");
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(onCancel).toHaveBeenCalled();
  });

  it("SB-3 — mudar a quantidade depois da baixa feita: recusa e não baixa de novo", async () => {
    lancar.mockImplementationOnce(async () => { throw new Error("rede caiu"); });
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "300" } }); });
    await salvar();
    expect(saida).toHaveBeenCalledTimes(1);
    expect(lancar).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/já foi feita \(200,00 kg de SAL MINERAL/);
  });
});

describe("D-PROD-201 — datas e fechamento do período anterior", () => {
  it("SB-4 — data anterior ao último abastecimento: recusa sem gravar nada", async () => {
    estado.ultimoEvento = { id: "ev-1", data_lancamento: "2099-01-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null };
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(saida).not.toHaveBeenCalled();
    expect(lancar).not.toHaveBeenCalled();
    expect(toast.error.mock.calls.at(-1)[0]).toMatch(/é anterior ao último abastecimento deste cocho \(10\/01\/2099\)/);
  });

  it("SB-5 — falha ao fechar o período anterior: aviso, e o lançamento conta como salvo", async () => {
    estado.ultimoEvento = { id: "ev-1", data_lancamento: "2020-01-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null };
    fechar.mockImplementationOnce(async () => { throw new Error("falhou"); });
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(lancar).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith("Falha ao fechar o período anterior, mas o lançamento foi salvo.");
    expect(toast.success).toHaveBeenCalledWith("Suplementação registrada com sucesso.");
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("D-PROD-201 — funções puras", () => {
  it("SB-6 — peso de consumo, datas, chave da baixa e motivo 'sem peso' no mapa", async () => {
    const { pesoDeConsumoDoLote, resumoPesoDosLotes } = await import("@/components/suplementacao/consumoPVUtils");
    const { erroDeDataDoLancamento, chaveDaSaida } = await import("@/components/suplementacao/FormularioLancamentoSuplementacao");
    const { calcularNivelCocho, MENSAGENS_NIVEL } = await import("@/domain/suplementacao/nivelSuplementacao");

    expect(pesoDeConsumoDoLote({ projecao_peso: projecao(407), peso_medio_kg: 400 })).toEqual({ peso: 407, origem: "projetado" });
    expect(pesoDeConsumoDoLote({ projecao_peso: { disponivel: false }, peso_medio_kg: 400 })).toEqual({ peso: 400, origem: "ultimo_peso" });
    expect(pesoDeConsumoDoLote({ peso_medio_kg: 0 })).toEqual({ peso: 0, origem: "sem_peso" });
    const r = resumoPesoDosLotes([{ quantidade_cabecas: 30, peso_medio_kg: 400 }, { quantidade_cabecas: 20 }]);
    expect(r.pesoMedio).toBe(400);
    expect([r.cabecasComPeso, r.cabecasSemPeso]).toEqual([30, 20]);

    expect(erroDeDataDoLancamento({ dataLancamento: "2026-11-14", ultimaData: "2026-11-14" })).toBeNull();
    expect(erroDeDataDoLancamento({ dataLancamento: "2026-11-15", ultimaData: "2026-11-14" })).toBeNull();
    expect(erroDeDataDoLancamento({ dataLancamento: "2026-11-13", ultimaData: "2026-11-14" })).toMatch(/anterior ao último/);
    expect(erroDeDataDoLancamento({ dataLancamento: "2026-11-20", dataFimAnterior: "2026-11-10", ultimaData: "2026-11-14" })).toMatch(/não pode ser antes/);
    expect(erroDeDataDoLancamento({ dataLancamento: "2026-11-20", dataFimAnterior: "2026-11-21", ultimaData: "2026-11-14" })).toMatch(/não pode ser depois/);
    expect(erroDeDataDoLancamento({ dataLancamento: "" })).toMatch(/Informe a data/);
    expect(chaveDaSaida({ produtoId: "p", quantidadeKg: 200, data: "2026-11-14", localId: "l" })).toBe(chaveDaSaida({ produtoId: "p", quantidadeKg: 200.00001, data: "2026-11-14", localId: "l" }));

    const semPeso = calcularNivelCocho({
      ponto: { id: "p1", categoria_ponto: "COCHO" },
      eventos: [{ ponto_suplementacao_id: "p1", data_lancamento: "2026-11-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: null, percentual_consumo_pv_usado: 0.1, peso_medio_lotes_kg: null }],
      hoje: "2026-11-11",
    });
    expect(semPeso.motivo).toBe(MENSAGENS_NIVEL.motivoSemPeso);
    const semPv = calcularNivelCocho({
      ponto: { id: "p1", categoria_ponto: "COCHO" },
      eventos: [{ ponto_suplementacao_id: "p1", data_lancamento: "2026-11-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null, consumo_esperado_pv_kg: null, percentual_consumo_pv_usado: null, peso_medio_lotes_kg: 400 }],
      hoje: "2026-11-11",
    });
    expect(semPv.motivo).toBe(MENSAGENS_NIVEL.motivoSemPv);
  });
});

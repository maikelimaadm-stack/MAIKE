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
 *
 * D-PROD-203 — a FORMULAÇÃO é obrigatória no lançamento (o %PV não vem mais do produto):
 *  SF-1. sem formulação ativa: aviso com o caminho para Formulações e nada é gravado;
 *  SF-2. regra por categoria: quem não consome sai do esperado (e é contado à parte), quem
 *        tem %PV próprio entra com ele; lote sem peso usa a média dos com peso com o %PV
 *        da própria categoria; o evento leva a formulação e cada lote o seu %PV;
 *  SF-3. com depósito, só as formulações cujo produto tem saldo nele (ou é o padrão do cocho);
 *        a única sobra e é escolhida sozinha; a baixa é do produto da formulação;
 *  SF-4. função pura `consumoEsperadoPorFormulacao`.
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
    // D-PROD-203: o %PV é o da formulação (0,1), não o do produto (0,3); a média vale também para o lote sem peso.
    expect(evento.percentual_consumo_pv_usado).toBe(0.1);
    expect([evento.formulacao_id, evento.formulacao_nome, evento.formulacao_tipo, evento.produto, evento.produto_id]).toEqual(["f-1", "SAL MINERAL 80", "PRONTO", "SAL MINERAL", "prod-1"]);
    expect(evento.cabecas_nao_consomem).toBe(0);
    expect(lotes.map((l) => [l.percentual_pv_lote, Number(l.consumo_esperado_pv_lote_kg.toFixed(6))])).toEqual([[0.1, 12], [0.1, 8]]);
    // D-PROD-212: projeção sem os 12 meses (e lote sem peso) → sem curva gravada; o fechamento marca aproximado.
    expect(lotes.map((l) => l.gmd_mensal_kg)).toEqual([null, null]);
  });

  it("SB-1b — D-PROD-212: o lote com peso projetado grava a curva de ganho (GMD de cada mês) para o fechamento", async () => {
    // Projeção como o servidor manda: 400 kg em 20/11 e +0,5 kg/dia em todos os meses.
    const meses = [];
    let ano = 2026;
    let mes0 = 10;
    let anterior = { dia: "2026-11-20", peso: 400 };
    for (let i = 0; i < 12; i += 1) {
      const fim = new Date(Date.UTC(ano, mes0 + 1, 0)).toISOString().slice(0, 10);
      const dias = Math.round((Date.parse(fim) - Date.parse(anterior.dia)) / 86400000);
      const peso = anterior.peso + 0.5 * dias;
      meses.push({ mes: fim.slice(0, 7), dia: fim, peso_kg: peso });
      anterior = { dia: fim, peso };
      mes0 += 1;
      if (mes0 > 11) { mes0 = 0; ano += 1; }
    }
    estado.rebanho = [posicao("pa", "LOTE A", 30, { projecao_peso: { disponivel: true, dia: "2026-11-20", peso_kg: 400, sem_curva: false, gmd_hoje_kg: 0.5, projecao_mensal: meses } })];
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    const { lotes } = lancar.mock.calls[0][0];
    expect(lotes[0].gmd_mensal_kg).toEqual(Object.fromEntries(["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"].map((m) => [`gmd_${m}`, 0.5])));
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

describe("D-PROD-203 — formulação obrigatória no lançamento", () => {
  it("SF-1 — sem formulação ativa: aviso com o caminho para Formulações, botão travado e nada gravado", async () => {
    estado.formulacoes = [];
    await montar();
    const aviso = await screen.findByTestId("suplementacao-sem-formulacao");
    expect(aviso.textContent).toMatch(/Não há formulação ativa nesta fazenda/);
    expect(aviso.querySelector("a").getAttribute("href")).toMatch(/Formulacoes/i);
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    expect(/** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "Salvar novo ciclo" })).disabled).toBe(true);
    await salvar();
    expect(saida).not.toHaveBeenCalled();
    expect(lancar).not.toHaveBeenCalled();
  });

  it("SF-2 — BEZERRO MAMANDO não consome, VACA com 0,15%: esperado lote a lote, não consumidores à parte", async () => {
    estado.formulacoes = [{
      ...FORMULACAO, id: "f-2", nome: "PROTEINADO", tipo: "BATELADA", percentual_pv_padrao: 0.1,
      regras: [
        { categoria_manejo_id: "cat-bez", categoria_manejo_nome: "BEZERRO MAMANDO", consome: false, percentual_pv: null },
        { categoria_manejo_id: "cat-vaca", categoria_manejo_nome: "VACA LEITEIRA", consome: true, percentual_pv: 0.15 },
      ],
    }];
    estado.rebanho = [
      posicao("pv", "VACAS", 10, { categoria_manejo_id: "cat-vaca", projecao_peso: projecao(450) }),
      posicao("pz", "BEZERROS", 8, { categoria_manejo_id: "cat-bez", peso_medio_kg: 120 }),
      posicao("pb", "BOIS", 20, { categoria_manejo_id: "cat-boi", peso_medio_kg: 400 }),
      posicao("ps", "SEM PESO", 5, { categoria_manejo_id: "cat-vaca", peso_medio_kg: null }),
    ];
    await montar();
    // 10 × 450 × 0,15% = 6,75; bezerros 0; 20 × 400 × 0,1% = 8; sem peso: média (10×450+8×120+20×400)/38 ≈ 354,21 × 0,15% × 5 ≈ 2,6566.
    const media = (10 * 450 + 8 * 120 + 20 * 400) / 38;
    const esperado = 6.75 + 8 + media * 0.0015 * 5;
    expect(screen.getByTestId("suplementacao-nao-consomem").textContent).toMatch(/8 cabeça\(s\) não consomem/);
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "300" } }); });
    await salvar();
    expect(lancar).toHaveBeenCalledTimes(1);
    const { evento, lotes } = lancar.mock.calls[0][0];
    expect(evento.total_cabecas_afetadas).toBe(43);
    expect(evento.cabecas_nao_consomem).toBe(8);
    expect(evento.consumo_esperado_pv_kg).toBeCloseTo(esperado, 6);
    expect(evento.percentual_consumo_pv_usado).toBe(0.1);
    expect([evento.formulacao_id, evento.formulacao_tipo]).toEqual(["f-2", "BATELADA"]);
    expect(lotes.map((l) => [l.lote_id, l.percentual_pv_lote])).toEqual([["pv", 0.15], ["pz", 0], ["pb", 0.1], ["ps", 0.15]]);
    expect(lotes.find((l) => l.lote_id === "pz").consumo_esperado_pv_lote_kg).toBe(0);
    expect(lotes.find((l) => l.lote_id === "pv").consumo_esperado_pv_lote_kg).toBeCloseTo(6.75, 6);
  });

  it("SF-3 — com depósito: só a formulação cujo produto tem saldo (ou é o padrão do cocho); escolhida sozinha; a baixa é do produto dela", async () => {
    const MISTURA = { id: "prod-mix", empresa_id: "emp-1", nome_produto: "PROTEINADO DA FAZENDA", unidade_principal_estoque: "KG" };
    estado.produtos = [PRODUTO, MISTURA];
    // O SAL MINERAL tem saldo (5.000 kg); o PROTEINADO, não, e não é o padrão do cocho.
    estado.formulacoes = [{ ...FORMULACAO, id: "f-mix", nome: "PROTEINADO", tipo: "BATELADA", produto_id: "prod-mix", produto_nome: "PROTEINADO DA FAZENDA" }, FORMULACAO];
    await montar();
    await waitFor(() => expect(screen.getByTestId("suplementacao-produto-da-formulacao").textContent).toMatch(/SAL MINERAL/));
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(saida).toHaveBeenCalledTimes(1);
    expect(saida.mock.calls[0][0].produto.id).toBe("prod-1");
    expect(lancar.mock.calls[0][0].evento.formulacao_id).toBe("f-1");
  });

  it("SF-4 — consumoEsperadoPorFormulacao: padrão, regra, não consome, sem peso e sem formulação", async () => {
    const { consumoEsperadoPorFormulacao, percentualPVDoLote } = await import("@/components/suplementacao/consumoPVUtils");
    const formulacao = { percentual_pv_padrao: 0.2, regras: [{ categoria_manejo_id: "bz", consome: false, percentual_pv: null }, { categoria_manejo_id: "vc", consome: true, percentual_pv: 0.05 }] };
    expect(percentualPVDoLote({ categoria_manejo_id: "bz" }, formulacao)).toEqual({ percentual: 0, consome: false, origem: "nao_consome" });
    expect(percentualPVDoLote({ categoria_manejo_id: "vc" }, formulacao)).toEqual({ percentual: 0.05, consome: true, origem: "regra" });
    expect(percentualPVDoLote({ categoria_manejo_id: "x" }, formulacao)).toEqual({ percentual: 0.2, consome: true, origem: "padrao" });
    expect(percentualPVDoLote({}, formulacao).origem).toBe("padrao");

    const r = consumoEsperadoPorFormulacao({
      formulacao,
      lotes: [
        { id: "a", quantidade_cabecas: 10, peso_medio_kg: 300, categoria_manejo_id: "x" },
        { id: "b", quantidade_cabecas: 10, peso_medio_kg: 100, categoria_manejo_id: "bz" },
        { id: "c", quantidade_cabecas: 4, categoria_manejo_id: "vc" },
        { id: "z", quantidade_cabecas: 0, peso_medio_kg: 999 },
      ],
    });
    // a: 300 × 0,2% × 10 = 6; b: não consome; c: sem peso → média 200 × 0,05% × 4 = 0,4.
    expect(r.totalKgDia).toBeCloseTo(6.4, 9);
    expect(r.cabecasNaoConsomem).toBe(10);
    expect(r.cabecasConsomem).toBe(14);
    expect(r.cabecasSemPeso).toBe(4);
    expect(r.pesoMedioReferencia).toBe(200);
    expect(r.porLote.map((l) => [l.id, l.percentualPV, l.consome, l.pesoExtrapolado, l.esperadoKgDia === null ? null : Number(l.esperadoKgDia.toFixed(6))])).toEqual([
      ["a", 0.2, true, false, 6], ["b", 0, false, false, 0], ["c", 0.05, true, true, 0.4],
    ]);
    // Ninguém consome, ou ninguém tem peso: total 0 (o lançamento grava null).
    expect(consumoEsperadoPorFormulacao({ formulacao, lotes: [{ id: "b", quantidade_cabecas: 5, peso_medio_kg: 100, categoria_manejo_id: "bz" }] }).totalKgDia).toBe(0);
    const semPeso = consumoEsperadoPorFormulacao({ formulacao, lotes: [{ id: "s", quantidade_cabecas: 5 }] });
    expect([semPeso.totalKgDia, semPeso.porLote[0].esperadoKgDia]).toEqual([0, null]);
    expect(consumoEsperadoPorFormulacao({ formulacao: null, lotes: [{ id: "a", quantidade_cabecas: 3, peso_medio_kg: 300 }] }).totalKgDia).toBe(0);
  });
});

describe("D-PROD-206 — o lançamento grava o que o fechamento do consumo precisa", () => {
  const sobraCampo = () => /** @type {HTMLInputElement} */ (screen.getByLabelText("Sobra no cocho (kg)"));

  it("SF-5 — sobra vazia = não medida (fecha com sobraInformada false e avisa); 0 digitado = medida (true)", async () => {
    estado.ultimoEvento = { id: "ev-1", data_lancamento: "2020-01-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null };
    await montar();
    expect(sobraCampo().value).toBe("");
    expect(sobraCampo().placeholder).toBe("Não medida");
    expect(screen.getByTestId("suplementacao-sobra-nao-medida").textContent).toMatch(/aproximado/);
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(fechar).toHaveBeenCalledTimes(1);
    expect(fechar.mock.calls[0][0]).toMatchObject({ sobraFinal: 0, sobraInformada: false });
    // Sem a prop, o serviço confere o compartilhamento pelo cache (o formulário não decide).
    expect(fechar.mock.calls[0][0].compartilhado).toBeUndefined();

    cleanup();
    fechar.mockClear();
    lancar.mockClear();
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await act(async () => { fireEvent.change(sobraCampo(), { target: { value: "0" } }); });
    expect(screen.queryByTestId("suplementacao-sobra-nao-medida")).toBeNull();
    await salvar();
    expect(fechar.mock.calls[0][0]).toMatchObject({ sobraFinal: 0, sobraInformada: true });
  });

  it("SF-6 — custo/kg da saída (FIFO), faixa da formulação e peso vivo de quem consome vão no evento", async () => {
    estado.formulacoes = [{ ...FORMULACAO, faixa_tolerancia_percentual: 20 }];
    saida.mockImplementation(async () => ({ movimentacao: { id: "mov-1", valor_unitario: "3.5" } }));
    await montar();
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    const { evento } = lancar.mock.calls[0][0];
    expect(evento.custo_unitario_kg).toBe(3.5);
    expect(evento.faixa_tolerancia_percentual).toBe(20);
    // 30 × 400 (projetado) + 20 × 400 (sem peso: a média dos com peso) = 20.000 kg.
    expect(evento.peso_vivo_consumo_kg).toBe(20000);
  });

  it("SF-7 — formulação sem faixa → null (15% na leitura); saída sem valor → sem custo; ciclo compartilhado vem da prop", async () => {
    const { custoUnitarioDaSaida, pesoVivoDeQuemConsome } = await import("@/components/suplementacao/FormularioLancamentoSuplementacao");
    expect(custoUnitarioDaSaida({ valor_unitario: 0 })).toBe(0);
    expect(custoUnitarioDaSaida({ valor_unitario: null })).toBeNull();
    expect(custoUnitarioDaSaida(null)).toBeNull();
    expect(custoUnitarioDaSaida({ valor_unitario: "x" })).toBeNull();
    expect(pesoVivoDeQuemConsome([{ cabecas: 10, peso: 300, consome: true }, { cabecas: 5, peso: 100, consome: false }])).toBe(3000);
    expect(pesoVivoDeQuemConsome([{ cabecas: 5, peso: 0, consome: true }])).toBeNull();

    estado.ultimoEvento = { id: "ev-1", data_lancamento: "2020-01-10", quantidade_total_kg: 100, sobra_kg: 0, dias_periodo: null };
    const { default: FormularioLancamentoSuplementacao } = await import("@/components/suplementacao/FormularioLancamentoSuplementacao");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(<QueryClientProvider client={client}><FormularioLancamentoSuplementacao ponto={PONTO} cicloCompartilhado onCancel={() => {}} /></QueryClientProvider>);
    });
    await assentar();
    await waitFor(() => expect(screen.getByText(/cabeças/)).toBeTruthy());
    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    expect(lancar.mock.calls[0][0].evento.faixa_tolerancia_percentual).toBeNull();
    expect(lancar.mock.calls[0][0].evento.custo_unitario_kg).toBeNull();
    expect(fechar.mock.calls[0][0].compartilhado).toBe(true);
  });
});

describe("D-PROD-210 — lançamento numa formulação da base g/cab/dia", () => {
  const SAL_G = {
    ...FORMULACAO, id: "f-g", nome: "SAL MINERAL G", base_consumo: "G_CAB_DIA", percentual_pv_padrao: null, consumo_objetivo_g_cab_dia: 80,
    regras: [
      { categoria_manejo_id: "cat-bez", categoria_manejo_nome: "BEZERRO MAMANDO", consome: false, percentual_pv: null, g_cab_dia: null },
      { categoria_manejo_id: "cat-vaca", categoria_manejo_nome: "VACA LEITEIRA", consome: true, percentual_pv: null, g_cab_dia: 1500 },
    ],
  };

  it("SG-1 — esperado = cabeças × gramas (regra da categoria, senão o padrão) ÷ 1000, sem peso; rótulos em g, sem %PV; evento grava a base e os gramas", async () => {
    estado.formulacoes = [SAL_G];
    estado.rebanho = [
      posicao("pv", "VACAS", 10, { categoria_manejo_id: "cat-vaca", projecao_peso: projecao(450) }),
      posicao("pz", "BEZERROS", 8, { categoria_manejo_id: "cat-bez", peso_medio_kg: 120 }),
      posicao("pb", "BOIS SEM PESO", 20, { categoria_manejo_id: "cat-boi", peso_medio_kg: null }),
    ];
    await montar();
    // 10 × 1500 g + 20 × 80 g = 16,6 kg/dia; os 8 bezerros ficam fora; o lote sem peso conta (meta fixa).
    expect(screen.getByTestId("suplementacao-painel-g")).toBeTruthy();
    expect(screen.queryByTestId("suplementacao-painel-pv")).toBeNull();
    expect(screen.getByTestId("suplementacao-esperado-grupo").textContent).toBe("16,6 kg");
    expect(screen.getByTestId("suplementacao-meta-g").textContent).toBe("553 g");
    expect(screen.queryByTestId("suplementacao-sem-peso")).toBeNull();
    expect(screen.getByText(/SAL MINERAL G/).textContent).toMatch(/80 g\/cab\/dia/);
    expect(screen.getByText(/SAL MINERAL G/).textContent).not.toMatch(/% PV/);

    await act(async () => { fireEvent.change(campoKg(), { target: { value: "200" } }); });
    await salvar();
    const { evento, lotes } = lancar.mock.calls[0][0];
    expect(evento.base_consumo).toBe("G_CAB_DIA");
    expect(evento.consumo_esperado_pv_kg).toBeCloseTo(16.6, 6);
    expect(evento.consumo_esperado_g_cab_dia).toBeCloseTo(553.33, 2);
    expect(evento.percentual_consumo_pv_usado).toBeNull();
    expect(evento.cabecas_nao_consomem).toBe(8);
    expect(lotes.map((l) => [l.lote_id, l.g_cab_dia_lote, l.percentual_pv_lote, l.consumo_esperado_pv_lote_kg])).toEqual([
      ["pv", 1500, null, 15], ["pz", 0, null, 0], ["pb", 80, null, 1.6],
    ]);
  });

  it("SG-2 — funções puras: gramasDoLote e consumoEsperadoPorFormulacao na base g; base PV continua igual e sem gCabDiaEsperado", async () => {
    const { consumoEsperadoPorFormulacao, gramasDoLote, baseDoConsumo } = await import("@/components/suplementacao/consumoPVUtils");
    expect(baseDoConsumo(SAL_G)).toBe("G_CAB_DIA");
    expect(baseDoConsumo({})).toBe("PV");
    expect(gramasDoLote({ categoria_manejo_id: "cat-bez" }, SAL_G)).toEqual({ gramas: 0, consome: false, origem: "nao_consome" });
    expect(gramasDoLote({ categoria_manejo_id: "cat-vaca" }, SAL_G)).toEqual({ gramas: 1500, consome: true, origem: "regra" });
    expect(gramasDoLote({ categoria_manejo_id: "x" }, SAL_G)).toEqual({ gramas: 80, consome: true, origem: "padrao" });
    const r = consumoEsperadoPorFormulacao({ lotes: [{ id: "a", quantidade_cabecas: 100, categoria_manejo_id: "x" }], formulacao: SAL_G });
    expect(r.base).toBe("G_CAB_DIA");
    expect(r.totalKgDia).toBeCloseTo(8, 9);
    expect(r.gCabDiaEsperado).toBeCloseTo(80, 9);
    const pv = consumoEsperadoPorFormulacao({ lotes: [{ id: "a", quantidade_cabecas: 10, peso_medio_kg: 400 }], formulacao: { percentual_pv_padrao: 0.1, regras: [] } });
    expect(pv.base).toBe("PV");
    expect(pv.gCabDiaEsperado).toBeNull();
    expect(pv.totalKgDia).toBeCloseTo(4, 9);
  });
});

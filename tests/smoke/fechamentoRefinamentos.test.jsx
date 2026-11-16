/**
 * D-PROD-212 — refinamentos do fechamento do consumo.
 *
 *  FR-1. curva de ganho no front: `ganhoNoPeriodo` dá o MESMO ganho do servidor
 *        (D-PROD-198) e a curva sai certa da projeção de peso da posição;
 *  FR-2. peso médio do período (base PV): o exemplo do proprietário (306 → 312 kg,
 *        média 309, esperado 92,7 kg/dia, 95 kg/dia ≈ 102,5%); sem curva/peso →
 *        aproximado com o motivo; base G não muda a meta;
 *  FR-3. a sobra antiga sai primeiro no custo: o exemplo do proprietário (R$ 3.275,00,
 *        não R$ 3.325,00; R$ 3,28/cab/dia), sobra maior que o consumo carrega as
 *        camadas antigas, evento antigo usa o custo do lançamento anterior (ou o atual,
 *        aproximado);
 *  FR-4. o patch do fechamento e o da reabertura passam pela lista fechada do servidor
 *        (antes o PATCH inteiro era recusado) e tipos errados são recusados;
 *  FR-5. o serviço acha as camadas do fechamento anterior do mesmo cocho;
 *  FR-6. a tela mostra o peso médio do período e a sobra antiga no custo.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const apis = vi.hoisted(() => ({
  listEventos: vi.fn(async () => []),
  listLotesSuplementacao: vi.fn(async () => []),
  listLotesRebanho: vi.fn(async () => []),
  listMovimentacoesPecuarias: vi.fn(async () => []),
  updateEvento: vi.fn(async () => ({})),
  updateLoteSuplementacao: vi.fn(async () => ({})),
  opcoes: vi.fn(async () => []),
  cache: /** @type {Record<string, any[]>} */ ({}),
}));
vi.mock("@/apis/suplementacao", async (importOriginal) => ({
  ...(await importOriginal()),
  listEventos: apis.listEventos,
  listLotesSuplementacao: apis.listLotesSuplementacao,
  listLotesRebanho: apis.listLotesRebanho,
  listMovimentacoesPecuarias: apis.listMovimentacoesPecuarias,
  updateEvento: apis.updateEvento,
  updateLoteSuplementacao: apis.updateLoteSuplementacao,
}));
vi.mock("@/apis/formulacoes", async (importOriginal) => ({ ...(await importOriginal()), listFormulacoesOpcoesLancamento: apis.opcoes }));
vi.mock("@/services/mapaCacheService", async (importOriginal) => ({
  ...(await importOriginal()),
  getMapaCachedData: vi.fn(async (chave) => apis.cache[chave] ?? []),
}));

const curvaFront = await import("@/domain/rebanho/ganhoPelaCurva");
const curvaServidor = await import("../../backend/src/modules/rebanhoLedger/pesoProjetado.js");
const dominio = await import("@/domain/suplementacao/fechamentoConsumo");
const consumo = await import("@/components/utils/consumoUtils");
const supSvc = await import("@/services/suplementacaoService");
const camposServidor = await import("../../backend/src/modules/suplementacaoEventos/camposFechamentoEvento.js");
const { ResumoFechamentoConsumo } = await import("@/components/suplementacao/FarolConsumo");

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** Curva com o mesmo GMD em todos os meses. */
const curvaFixa = (gmd) => Object.fromEntries(MESES.map((m) => [`gmd_${m}`, gmd]));
/** Curva com GMD diferente por mês (0,40 em jan … 0,95 em dez). */
const CURVA_VARIADA = Object.fromEntries(MESES.map((m, i) => [`gmd_${m}`, Number((0.4 + i * 0.05).toFixed(2))]));

/** Projeção de peso como o servidor manda (`projecao_peso`, D-PROD-198), a partir de uma curva. */
const projecaoDoServidor = (curva, dia, peso) => {
  const meses = [];
  let ano = Number(dia.slice(0, 4));
  let mes0 = Number(dia.slice(5, 7)) - 1;
  for (let i = 0; i < 12; i += 1) {
    const fim = new Date(Date.UTC(ano, mes0 + 1, 0)).toISOString().slice(0, 10);
    meses.push({ mes: fim.slice(0, 7), dia: fim, peso_kg: Math.round((peso + curvaServidor.ganhoNoPeriodo(curva, dia, fim)) * 100) / 100 });
    mes0 += 1;
    if (mes0 > 11) { mes0 = 0; ano += 1; }
  }
  return { disponivel: true, dia, peso_kg: peso, sem_curva: false, gmd_hoje_kg: curvaServidor.gmdDoDia(curva, dia), projecao_mensal: meses };
};

/** Evento do exemplo: 100 cabeças, 306 kg (projetado), 0,3% PV → 91,8 kg/dia esperados. */
const EVENTO_PV = Object.freeze({
  id: "e2", empresa_id: "emp-1", ponto_suplementacao_id: "p1", data_lancamento: "2026-12-11",
  quantidade_total_kg: 900, sobra_kg: 100, total_cabecas_afetadas: 100, cabecas_nao_consomem: 0,
  peso_medio_lotes_kg: 306, peso_vivo_consumo_kg: 30600, consumo_esperado_pv_kg: 91.8, percentual_consumo_pv_usado: 0.3,
});
const LOTE_PV = Object.freeze({
  id: "sl2", suplementacao_evento_id: "e2", lote_id: "pa", cabecas_na_area: 100,
  peso_medio_lote_kg: 306, percentual_pv_lote: 0.3, consumo_esperado_pv_lote_kg: 91.8, gmd_mensal_kg: curvaFixa(0.6),
});

beforeEach(() => {
  cleanup();
  for (const f of [apis.listEventos, apis.listLotesSuplementacao, apis.updateEvento, apis.updateLoteSuplementacao, apis.opcoes]) f.mockReset();
  apis.listEventos.mockImplementation(async () => []);
  apis.listLotesSuplementacao.mockImplementation(async () => []);
  apis.opcoes.mockImplementation(async () => []);
  apis.updateEvento.mockImplementation(async () => ({}));
  apis.updateLoteSuplementacao.mockImplementation(async () => ({}));
  apis.cache = {};
});

describe("FR-1 — curva de ganho no front = a do servidor", () => {
  it("ganhoNoPeriodo dá o mesmo ganho do servidor, inclusive virando mês e ano", () => {
    const casos = [["2026-12-11", "2026-12-21"], ["2026-11-20", "2027-02-10"], ["2026-01-31", "2026-03-01"], ["2026-05-05", "2026-05-05"], ["2026-05-05", "2026-05-01"]];
    for (const [de, ate] of casos) {
      for (const curva of [curvaFixa(0.6), CURVA_VARIADA]) {
        expect(curvaFront.ganhoNoPeriodo(curva, de, ate)).toBeCloseTo(curvaServidor.ganhoNoPeriodo(curva, de, ate), 9);
      }
    }
    expect(curvaFront.ganhoNoPeriodo(curvaFixa(0.6), "2026-12-11", "2026-12-21")).toBeCloseTo(6, 9);
  });

  it("sem curva, curva incompleta ou data inválida → null (não inventa GMD)", () => {
    expect(curvaFront.ganhoNoPeriodo(null, "2026-12-11", "2026-12-21")).toBeNull();
    const { gmd_dez, ...semDezembro } = curvaFixa(0.6);
    void gmd_dez;
    expect(curvaFront.ganhoNoPeriodo(semDezembro, "2026-12-11", "2026-12-21")).toBeNull();
    expect(curvaFront.ganhoNoPeriodo(semDezembro, "2026-11-01", "2026-11-20")).toBeCloseTo(11.4, 9);
    expect(curvaFront.ganhoNoPeriodo(curvaFixa(0.6), "11/12/2026", "2026-12-21")).toBeNull();
  });

  it("a curva sai da projeção de peso da posição (12 meses), e some sem projeção ou sem curva", () => {
    for (const dia of ["2026-11-20", "2026-11-30", "2026-02-28"]) {
      const curva = curvaFront.curvaDaProjecaoDePeso(projecaoDoServidor(CURVA_VARIADA, dia, 300));
      expect(curva).not.toBeNull();
      for (const m of MESES) expect(curva[`gmd_${m}`]).toBeCloseTo(CURVA_VARIADA[`gmd_${m}`], 3);
    }
    expect(curvaFront.curvaDaProjecaoDePeso({ disponivel: true, peso_kg: 300 })).toBeNull();
    expect(curvaFront.curvaDaProjecaoDePeso({ ...projecaoDoServidor(CURVA_VARIADA, "2026-11-20", 300), sem_curva: true })).toBeNull();
    expect(curvaFront.curvaDaProjecaoDePeso({ disponivel: false })).toBeNull();
    expect(curvaFront.curvaDaProjecaoDePeso(null)).toBeNull();
  });
});

describe("FR-2 — peso médio do período no esperado do fechamento (base PV)", () => {
  it("o exemplo do proprietário: 306 → 312 kg em 10 dias, média 309, esperado 92,7 kg/dia, 95 kg/dia ≈ 102,5%", () => {
    const pesoMedio = dominio.pesoMedioDoPeriodo({ evento: EVENTO_PV, lotesDoEvento: [LOTE_PV], diasPeriodo: 10 });
    expect(pesoMedio.peso_medio_periodo_kg).toBeCloseTo(309, 6);
    expect(pesoMedio.consumo_esperado_fechamento_kg_dia).toBeCloseTo(92.7, 6);
    expect([pesoMedio.aproximado, pesoMedio.motivo]).toEqual([false, null]);
    const r = dominio.calcularFechamentoConsumo({ evento: EVENTO_PV, consumoTotalKg: 950, diasPeriodo: 10, sobraInformada: true, pesoMedio });
    expect(r.consumo_relacao_esperado).toBeCloseTo(95 / 92.7, 4);
    expect(Math.round(r.consumo_relacao_esperado * 1000) / 10).toBe(102.5);
    expect(r.consumo_esperado_pv_percentual).toBeCloseTo(0.3, 6);
    expect([r.peso_medio_periodo_kg, r.peso_medio_periodo_aproximado, r.consumo_esperado_fechamento_kg_dia]).toEqual([309, false, 92.7]);
    // Antes (peso do lançamento): 95 ÷ 91,8 ≈ 103,5%.
    const antes = dominio.calcularFechamentoConsumo({ evento: EVENTO_PV, consumoTotalKg: 950, diasPeriodo: 10, sobraInformada: true });
    expect(Math.round(antes.consumo_relacao_esperado * 1000) / 10).toBe(103.5);
  });

  it("lote sem curva gravada (evento antigo, legado, categoria sem curva) → peso do lançamento, aproximado 'sem_curva'", () => {
    const pesoMedio = dominio.pesoMedioDoPeriodo({ evento: EVENTO_PV, lotesDoEvento: [{ ...LOTE_PV, gmd_mensal_kg: undefined }], diasPeriodo: 10 });
    expect(pesoMedio).toEqual({ peso_medio_periodo_kg: 306, peso_vivo_medio_consumo_kg: 30600, consumo_esperado_fechamento_kg_dia: 91.8, aproximado: true, motivo: "sem_curva" });
  });

  it("lote sem peso próprio fica com o peso do lançamento (aproximado 'sem_peso'); quem não consome fica fora", () => {
    const comCurva = { ...LOTE_PV, cabecas_na_area: 60, consumo_esperado_pv_lote_kg: 55.08 };
    const semPeso = { ...LOTE_PV, id: "sl3", lote_id: "pb", cabecas_na_area: 40, peso_medio_lote_kg: null, consumo_esperado_pv_lote_kg: 36.72 };
    const naoConsome = { ...LOTE_PV, id: "sl4", lote_id: "pc", cabecas_na_area: 10, percentual_pv_lote: 0, consumo_esperado_pv_lote_kg: 0 };
    const p = dominio.pesoMedioDoPeriodo({ evento: EVENTO_PV, lotesDoEvento: [comCurva, semPeso, naoConsome], diasPeriodo: 10 });
    // Só o lote com curva ganha: 60 cab × 6 kg ÷ 2 = 180 kg a mais de PV; esperado: 55,08 × 309/306 + 36,72.
    expect(p.peso_vivo_medio_consumo_kg).toBeCloseTo(30780, 6);
    expect(p.consumo_esperado_fechamento_kg_dia).toBeCloseTo(91.8 * ((55.08 * 309 / 306 + 36.72) / 91.8), 4);
    expect([p.aproximado, p.motivo]).toEqual([true, "sem_peso"]);
    // Sem lote que consuma, sem data → o do lançamento, aproximado.
    expect(dominio.pesoMedioDoPeriodo({ evento: EVENTO_PV, lotesDoEvento: [naoConsome], diasPeriodo: 10 }).motivo).toBe("sem_lotes");
    expect(dominio.pesoMedioDoPeriodo({ evento: { ...EVENTO_PV, data_lancamento: null }, lotesDoEvento: [LOTE_PV], diasPeriodo: 10 }).motivo).toBe("sem_data");
  });

  it("base G (g/cab/dia): a meta não muda com o peso; o %PV informativo usa o peso médio", () => {
    const eventoG = { ...EVENTO_PV, base_consumo: "G_CAB_DIA", consumo_esperado_g_cab_dia: 950, consumo_esperado_pv_kg: 95 };
    const loteG = { ...LOTE_PV, percentual_pv_lote: null, g_cab_dia_lote: 950, consumo_esperado_pv_lote_kg: 95 };
    const pesoMedio = dominio.pesoMedioDoPeriodo({ evento: eventoG, lotesDoEvento: [loteG], diasPeriodo: 10 });
    const r = dominio.calcularFechamentoConsumo({ evento: eventoG, consumoTotalKg: 950, diasPeriodo: 10, pesoMedio });
    expect([r.consumo_esperado_g_cab_dia, r.consumo_relacao_esperado, r.farol_consumo]).toEqual([950, 1, "dentro"]);
    expect(r.consumo_esperado_pv_percentual).toBeNull();
    expect(r.consumo_real_pv_percentual).toBeCloseTo((95 / 30900) * 100, 4);
  });

  it("o esperado do LANÇAMENTO (taxa do nível do cocho) não muda: o patch não grava consumo_esperado_pv_kg", () => {
    const { patchEvento } = consumo.calcularFechamentoDePeriodo({
      evento: EVENTO_PV, diasPeriodo: 10, sobraFinal: 50, sobraInicial: 100, lotesDoEvento: [LOTE_PV], alocacoes: [], sobraInformada: true,
    });
    expect("consumo_esperado_pv_kg" in patchEvento).toBe(false);
    expect([patchEvento.peso_medio_periodo_kg, patchEvento.consumo_esperado_fechamento_kg_dia]).toEqual([309, 92.7]);
  });
});

describe("FR-3 — a sobra antiga sai primeiro no custo", () => {
  it("o exemplo do proprietário: 100 kg herdados a R$ 3,00 + 900 kg a R$ 3,50, sobra 50 → 950 kg, R$ 3.275,00 (não 3.325), R$ 3,28/cab/dia", () => {
    const r = dominio.calcularFechamentoConsumo({
      evento: EVENTO_PV, consumoTotalKg: 950, diasPeriodo: 10, custoUnitarioKg: 3.5,
      sobraInicialKg: 100, sobraHerdada: { camadas: [{ kg: 100, custo_kg: 3 }] },
    });
    expect(r.custo_total_periodo).toBe(3275);
    expect(r.custo_cab_dia).toBe(3.275);
    expect(r.custo_cab_dia.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 })).toBe("R$ 3,28");
    expect([r.sobra_herdada_kg, r.custo_sobra_herdada_kg, r.custo_sobra_aproximado]).toEqual([100, 3, false]);
    expect(r.sobra_final_camadas).toEqual([{ kg: 50, custo_kg: 3.5 }]);
    // Sem a sobra herdada (prévia, evento antigo): tudo ao custo do lançamento, como antes.
    expect(dominio.calcularFechamentoConsumo({ evento: EVENTO_PV, consumoTotalKg: 950, diasPeriodo: 10, custoUnitarioKg: 3.5 }).custo_total_periodo).toBe(3325);
  });

  it("sobra maior que o consumo: a sobra final carrega as camadas antigas para o próximo período", () => {
    const r = dominio.custoDoConsumoComSobraPrimeiro({
      consumoKg: 200, sobraHerdada: [{ kg: 300, custo_kg: 3 }], fornecidoKg: 100, custoLancamentoKg: 3.5,
    });
    expect(r.custoTotal).toBe(600);
    expect(r.sobraFinalCamadas).toEqual([{ kg: 100, custo_kg: 3 }, { kg: 100, custo_kg: 3.5 }]);
    // No período seguinte, com 150 kg herdados dessas camadas (proporcional): 75 a R$ 3,00 e 75 a R$ 3,50.
    const h = dominio.camadasDaSobraHerdada({ sobraKg: 150, camadas: r.sobraFinalCamadas, custoLancamentoKg: 4 });
    expect(h).toEqual({ camadas: [{ kg: 75, custo_kg: 3 }, { kg: 75, custo_kg: 3.5 }], aproximado: false });
  });

  it("evento antigo: sem camadas, a sobra herdada vale o custo do lançamento anterior; sem ele, o atual (aproximado)", () => {
    expect(dominio.camadasDaSobraHerdada({ sobraKg: 100, camadas: null, custoAnteriorKg: 3, custoLancamentoKg: 3.5 }))
      .toEqual({ camadas: [{ kg: 100, custo_kg: 3 }], aproximado: false });
    expect(dominio.camadasDaSobraHerdada({ sobraKg: 100, custoLancamentoKg: 3.5 }))
      .toEqual({ camadas: [{ kg: 100, custo_kg: 3.5 }], aproximado: true });
    expect(dominio.camadasDaSobraHerdada({ sobraKg: 0, custoLancamentoKg: 3.5 })).toEqual({ camadas: [], aproximado: false });
    const r = dominio.calcularFechamentoConsumo({ evento: EVENTO_PV, consumoTotalKg: 950, diasPeriodo: 10, custoUnitarioKg: 3.5, sobraInicialKg: 100, sobraHerdada: {} });
    expect([r.custo_total_periodo, r.custo_sobra_aproximado]).toEqual([3325, true]);
    // Sem custo do lançamento: "sem custo", como antes, e nada da sobra herdada.
    const semCusto = dominio.calcularFechamentoConsumo({ evento: EVENTO_PV, consumoTotalKg: 950, diasPeriodo: 10, sobraInicialKg: 100, sobraHerdada: { custoAnteriorKg: 3 } });
    expect([semCusto.custo_total_periodo, semCusto.custo_cab_dia, semCusto.sobra_final_camadas]).toEqual([null, null, null]);
  });
});

describe("FR-4 — o servidor aceita o patch do fechamento e da reabertura (lista fechada, tipos conferidos)", () => {
  const permitidos = new Set(camposServidor.CAMPOS_PATCH_PERMITIDOS);
  it("todo campo do patch do fechamento e da reabertura está na lista do servidor, com o tipo certo", () => {
    const { patchEvento } = consumo.calcularFechamentoDePeriodo({
      evento: EVENTO_PV, diasPeriodo: 10, sobraFinal: 50, sobraInicial: 100, lotesDoEvento: [LOTE_PV], alocacoes: [],
      sobraInformada: true, faixaPercentual: 15, custoUnitarioKg: 3.5, sobraHerdada: { camadas: [{ kg: 100, custo_kg: 3 }] },
    });
    for (const campo of Object.keys(patchEvento)) expect(permitidos.has(campo), campo).toBe(true);
    expect(() => camposServidor.exigirTiposDoFechamento(patchEvento, "SuplementacaoEvento")).not.toThrow();
    for (const campo of Object.keys(consumo.PATCH_REABERTURA_EVENTO)) expect(permitidos.has(campo), campo).toBe(true);
    expect(() => camposServidor.exigirTiposDoFechamento({ ...consumo.PATCH_REABERTURA_EVENTO }, "SuplementacaoEvento")).not.toThrow();
  });

  it("tipo errado é recusado com o campo; campo de saldo continua fora da lista", () => {
    const erro = (entrada) => {
      try { camposServidor.exigirTiposDoFechamento(entrada, "SuplementacaoEvento"); return null; } catch (e) { return e.details?.field ?? e.message; }
    };
    expect(erro({ farol_consumo: "verde" })).toBe("farol_consumo");
    expect(erro({ sobra_informada: "sim" })).toBe("sobra_informada");
    expect(erro({ custo_cab_dia: "3,28" })).toBe("custo_cab_dia");
    expect(erro({ sobra_final_camadas: [{ kg: -1, custo_kg: 3 }] })).toBe("sobra_final_camadas");
    expect(erro({ sobra_final_camadas: [{ kg: 1, custo_kg: 3, extra: 1 }] })).toBe("sobra_final_camadas");
    expect(erro({ sobra_kg: "muito" })).toBe("sobra_kg");
    expect(erro({ sobra_final_camadas: [{ kg: 1.5, custo_kg: 3 }], farol_consumo: null, peso_medio_periodo_motivo: "sem_curva" })).toBeNull();
    for (const campo of ["quantidade_total_kg", "produto", "consumo_esperado_pv_kg", "movimentacao_estoque_id"]) expect(permitidos.has(campo), campo).toBe(false);
  });
});

describe("FR-5 — o serviço acha a sobra herdada no fechamento anterior do mesmo cocho", () => {
  it("usa as camadas gravadas pelo fechamento anterior; outro cocho e período aberto ficam fora", async () => {
    apis.listLotesSuplementacao.mockImplementation(async () => [LOTE_PV]);
    apis.listEventos.mockImplementation(async () => [
      { id: "e0", empresa_id: "emp-1", ponto_suplementacao_id: "p1", data_lancamento: "2026-11-21", dias_periodo: 10, custo_unitario_kg: 9, sobra_final_camadas: [{ kg: 100, custo_kg: 3 }] },
      { id: "x1", empresa_id: "emp-1", ponto_suplementacao_id: "p9", data_lancamento: "2026-12-01", dias_periodo: 10, sobra_final_camadas: [{ kg: 100, custo_kg: 99 }] },
      { id: "e-1", empresa_id: "emp-1", ponto_suplementacao_id: "p1", data_lancamento: "2026-11-01", dias_periodo: 20, sobra_final_camadas: [{ kg: 100, custo_kg: 50 }] },
      { ...EVENTO_PV },
    ]);
    const preparado = await supSvc.prepararFechamentoPeriodo({
      evento: { ...EVENTO_PV, custo_unitario_kg: 3.5 }, diasPeriodo: 10, sobraFinal: 50, sobraInicial: 100, sobraInformada: true, compartilhado: false,
    });
    expect(preparado.patchEvento.custo_total_periodo).toBe(3275);
    expect(preparado.patchEvento.sobra_final_camadas).toEqual([{ kg: 50, custo_kg: 3.5 }]);
    expect(preparado.patchEvento.custo_sobra_aproximado).toBe(false);
    expect(preparado.patchEvento.peso_medio_periodo_kg).toBe(309);
  });

  it("fechamento anterior sem camadas (antes desta decisão): o custo/kg do lançamento anterior", async () => {
    apis.listEventos.mockImplementation(async () => [
      { id: "e0", empresa_id: "emp-1", ponto_suplementacao_id: "p1", data_lancamento: "2026-12-01", dias_periodo: 10, custo_unitario_kg: 3 },
    ]);
    const preparado = await supSvc.prepararFechamentoPeriodo({
      evento: { ...EVENTO_PV, custo_unitario_kg: 3.5 }, diasPeriodo: 10, sobraFinal: 50, sobraInicial: 100, compartilhado: false,
    });
    expect([preparado.patchEvento.custo_total_periodo, preparado.patchEvento.custo_sobra_aproximado]).toEqual([3275, false]);
  });

  it("sem fechamento anterior ou sem rede: o custo do lançamento atual, aproximado — e o fechamento não falha", async () => {
    apis.listEventos.mockImplementation(async () => { throw new Error("offline"); });
    const preparado = await supSvc.prepararFechamentoPeriodo({
      evento: { ...EVENTO_PV, custo_unitario_kg: 3.5 }, diasPeriodo: 10, sobraFinal: 50, sobraInicial: 100, compartilhado: false,
    });
    expect([preparado.patchEvento.custo_total_periodo, preparado.patchEvento.custo_sobra_aproximado]).toEqual([3325, true]);
  });
});

describe("FR-6 — tela", () => {
  it("mostra o peso médio do período e a sobra antiga no custo; o aproximado traz o motivo", () => {
    const resumo = dominio.calcularFechamentoConsumo({
      evento: EVENTO_PV, consumoTotalKg: 950, diasPeriodo: 10, sobraInformada: true, custoUnitarioKg: 3.5,
      pesoMedio: dominio.pesoMedioDoPeriodo({ evento: EVENTO_PV, lotesDoEvento: [LOTE_PV], diasPeriodo: 10 }),
      sobraInicialKg: 100, sobraHerdada: { camadas: [{ kg: 100, custo_kg: 3 }] },
    });
    const { unmount } = render(<ResumoFechamentoConsumo resumo={resumo} />);
    expect(screen.getByTestId("peso-medio-periodo").textContent).toBe("309 kg");
    expect(screen.getByTestId("custo-sobra-herdada").textContent).toMatch(/Sobra antiga primeiro: 100,00 kg a R\$\s3,00\/kg/);
    expect(screen.getByText(/R\$\s3,28/)).toBeTruthy();
    expect(screen.getByText(/R\$\s3\.275,00/)).toBeTruthy();
    unmount();
    const aproximado = dominio.calcularFechamentoConsumo({
      evento: EVENTO_PV, consumoTotalKg: 950, diasPeriodo: 10, custoUnitarioKg: 3.5,
      pesoMedio: dominio.pesoMedioDoPeriodo({ evento: EVENTO_PV, lotesDoEvento: [{ ...LOTE_PV, gmd_mensal_kg: null }], diasPeriodo: 10 }),
      sobraInicialKg: 100, sobraHerdada: {},
    });
    render(<ResumoFechamentoConsumo resumo={aproximado} />);
    expect(screen.getByTestId("peso-medio-periodo").textContent).toBe("306 kg(aproximado: lote sem curva de ganho gravada)");
    expect(screen.getByTestId("custo-sobra-herdada").textContent).toMatch(/custo da sobra aproximado/);
  });

  it("evento fechado e gravado: o resumo devolve os campos novos como estão", () => {
    const gravado = { ...EVENTO_PV, dias_periodo: 10, farol_consumo: "dentro", peso_medio_periodo_kg: 309, peso_medio_periodo_aproximado: false, sobra_herdada_kg: 100, custo_sobra_herdada_kg: 3, custo_sobra_aproximado: false, sobra_final_camadas: [{ kg: 50, custo_kg: 3.5 }] };
    const r = dominio.resumoDoFechamento(gravado);
    expect([r.peso_medio_periodo_kg, r.sobra_herdada_kg, r.custo_sobra_herdada_kg, r.sobra_final_camadas]).toEqual([309, 100, 3, [{ kg: 50, custo_kg: 3.5 }]]);
  });
});

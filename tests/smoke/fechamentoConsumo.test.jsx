/**
 * D-PROD-206 — fechamento do consumo (etapa 4 da suplementação).
 *
 *  FC-1. domínio puro: cada cor do farol, os limites exatos (85%/115% com a faixa de
 *        15% e 80%/120% com 20%), sem esperado, sem peso, sem custo, sobra não medida,
 *        cocho compartilhado, quem não consome fora das cabeças e do peso vivo;
 *  FC-2. `calcularFechamentoDePeriodo` grava os campos novos no patch do evento e a
 *        reabertura os limpa (o custo/kg do lançamento fica);
 *  FC-3. `resumoDoFechamento`: o gravado vale como está; evento fechado ANTES desta
 *        decisão é calculado na hora com o que há;
 *  FC-4. o serviço acha a faixa da formulação e o custo do movimento para evento antigo,
 *        e o cocho compartilhado pelo cache do mapa;
 *  FC-5. tela: o cartão do lançamento e o detalhe do cocho mostram o farol com texto,
 *        "Aproximado", %PV real × esperado e o custo.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const apis = vi.hoisted(() => ({
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

const dominio = await import("@/domain/suplementacao/fechamentoConsumo");
const consumo = await import("@/components/utils/consumoUtils");
const supSvc = await import("@/services/suplementacaoService");
const { default: CardMetricaEvento } = await import("@/components/suplementacao/CardMetricaEvento");
const { ResumoFechamentoConsumo, FarolConsumoSelo } = await import("@/components/suplementacao/FarolConsumo");

/** 100 cabeças, 400 kg cada (40.000 kg de PV), esperado 40 kg/dia (0,1% PV). */
const EVENTO = Object.freeze({
  id: "e1", empresa_id: "emp-1", ponto_suplementacao_id: "p1", data_lancamento: "2026-11-01",
  quantidade_total_kg: 300, sobra_kg: 20, total_cabecas_afetadas: 100, cabecas_nao_consomem: 0,
  peso_medio_lotes_kg: 400, peso_vivo_consumo_kg: 40000, consumo_esperado_pv_kg: 40, percentual_consumo_pv_usado: 0.1,
});
/** Fechamento com `consumoTotalKg` em 7 dias. */
const fechar = (total, extra = {}) => dominio.calcularFechamentoConsumo({ evento: EVENTO, consumoTotalKg: total, diasPeriodo: 7, sobraInformada: true, ...extra });

beforeEach(() => {
  cleanup();
  for (const f of [apis.listLotesSuplementacao, apis.updateEvento, apis.updateLoteSuplementacao, apis.opcoes]) f.mockClear();
  apis.cache = {};
  apis.opcoes.mockImplementation(async () => []);
});

describe("FC-1 — domínio puro", () => {
  it("o exemplo combinado: 280 kg em 7 dias = 40 kg/dia, 400 g/cab/dia, 0,1% PV real × 0,1% esperado → dentro; custo R$ 3,50/kg = R$ 1,40/cab/dia", () => {
    const r = fechar(280, { custoUnitarioKg: 3.5 });
    expect(r).toEqual({
      consumo_g_cab_dia: 400, consumo_real_pv_percentual: 0.1, consumo_esperado_pv_percentual: 0.1, consumo_relacao_esperado: 1,
      farol_consumo: "dentro", farol_consumo_motivo: null, faixa_tolerancia_aplicada: 15, sobra_informada: true, base_consumo_aplicada: "PV", consumo_esperado_g_cab_dia: null,
      custo_unitario_kg: 3.5, custo_total_periodo: 980, custo_cab_dia: 1.4,
    });
  });

  it("cores e limites exatos: 85% e 115% ficam DENTRO com a faixa de 15%; um passo além vira abaixo/acima; com 20%, 80% e 120%", () => {
    // esperado 40 kg/dia × 7 = 280 kg.
    expect(fechar(280 * 0.85).farol_consumo).toBe("dentro");
    expect(fechar(280 * 0.8499).farol_consumo).toBe("abaixo");
    expect(fechar(280 * 1.15).farol_consumo).toBe("dentro");
    expect(fechar(280 * 1.1501).farol_consumo).toBe("acima");
    expect(fechar(0).farol_consumo).toBe("abaixo");
    expect(fechar(280 * 0.8, { faixaPercentual: 20 }).farol_consumo).toBe("dentro");
    expect(fechar(280 * 0.79, { faixaPercentual: 20 }).farol_consumo).toBe("abaixo");
    expect(fechar(280 * 1.2, { faixaPercentual: 20 }).farol_consumo).toBe("dentro");
    expect(fechar(280 * 1.21, { faixaPercentual: 20 }).farol_consumo).toBe("acima");
    expect(fechar(280 * 1.2, { faixaPercentual: 20 }).faixa_tolerancia_aplicada).toBe(20);
    // Faixa inválida (0, > 100, texto) → o padrão de 15%.
    for (const ruim of [0, 101, "x", null, undefined]) expect(dominio.faixaDeTolerancia(ruim)).toBe(15);
    expect(dominio.faixaDeTolerancia("12.5")).toBe(12.5);
  });

  it("sem esperado: sem referência com o motivo, mas consumo real e custo continuam; sem peso: %PV vazio, farol pelo esperado", () => {
    const semEsperado = fechar(280, { evento: { ...EVENTO, consumo_esperado_pv_kg: null }, custoUnitarioKg: 2 });
    expect([semEsperado.farol_consumo, semEsperado.farol_consumo_motivo, semEsperado.consumo_relacao_esperado]).toEqual(["sem_referencia", "sem_esperado", null]);
    expect([semEsperado.consumo_g_cab_dia, semEsperado.consumo_real_pv_percentual, semEsperado.consumo_esperado_pv_percentual]).toEqual([400, 0.1, null]);
    expect(semEsperado.custo_total_periodo).toBe(560);
    const semPeso = fechar(280, { evento: { ...EVENTO, peso_vivo_consumo_kg: null, peso_medio_lotes_kg: null } });
    expect([semPeso.consumo_real_pv_percentual, semPeso.consumo_esperado_pv_percentual, semPeso.farol_consumo]).toEqual([null, null, "dentro"]);
  });

  it("sem custo, sobra não medida, cocho compartilhado e quem não consome", () => {
    const semCusto = fechar(280);
    expect([semCusto.custo_unitario_kg, semCusto.custo_total_periodo, semCusto.custo_cab_dia]).toEqual([null, null, null]);
    expect(fechar(280, { sobraInformada: false }).sobra_informada).toBe(false);
    expect(fechar(280, { sobraInformada: null }).sobra_informada).toBeNull();
    const compartilhado = fechar(280, { compartilhado: true });
    expect([compartilhado.farol_consumo, compartilhado.farol_consumo_motivo]).toEqual(["sem_referencia", "cocho_compartilhado"]);
    expect(compartilhado.consumo_relacao_esperado).toBe(1);
    // 20 das 100 cabeças não consomem: 80 cabeças; evento antigo sem PV gravado usa peso médio × quem consome.
    const parcial = fechar(280, { evento: { ...EVENTO, cabecas_nao_consomem: 20, peso_vivo_consumo_kg: undefined }, custoUnitarioKg: 1 });
    expect(parcial.consumo_g_cab_dia).toBe(500);
    expect(parcial.consumo_real_pv_percentual).toBe(0.125);
    expect(parcial.custo_cab_dia).toBe(0.5);
  });
});

describe("FC-2 — fechamento do período grava o consumo e a reabertura o limpa", () => {
  it("o patch do evento traz o farol, a faixa, a sobra medida e o custo; o PATCH_REABERTURA limpa os campos do fechamento", () => {
    const r = consumo.calcularFechamentoDePeriodo({
      evento: EVENTO, diasPeriodo: 7, sobraFinal: 40, sobraInicial: 20, lotesDoEvento: [], alocacoes: [],
      sobraInformada: true, faixaPercentual: 15, custoUnitarioKg: 3.5, compartilhado: false,
    });
    // 300 + 20 − 40 = 280 kg.
    expect(r.consumoTotal).toBe(280);
    expect(r.patchEvento).toMatchObject({ sobra_kg: 40, dias_periodo: 7, consumo_diario_grupo_kg: 40, farol_consumo: "dentro", sobra_informada: true, custo_cab_dia: 1.4, faixa_tolerancia_aplicada: 15 });
    for (const campo of dominio.CAMPOS_FECHAMENTO_CONSUMO) expect(consumo.PATCH_REABERTURA_EVENTO[campo], campo).toBeNull();
    expect("custo_unitario_kg" in consumo.PATCH_REABERTURA_EVENTO).toBe(false);
  });
});

describe("FC-3 — resumo para a tela", () => {
  it("o gravado vale como está; aberto → null; evento fechado antes da decisão é calculado na hora (sem saber da sobra)", () => {
    expect(dominio.resumoDoFechamento({ ...EVENTO, dias_periodo: null })).toBeNull();
    const gravado = dominio.resumoDoFechamento({ ...EVENTO, dias_periodo: 7, consumo_diario_grupo_kg: 99, farol_consumo: "acima", consumo_relacao_esperado: 1.3, faixa_tolerancia_aplicada: 15, sobra_informada: false });
    expect([gravado.farol_consumo, gravado.consumo_relacao_esperado, gravado.sobra_informada]).toEqual(["acima", 1.3, false]);
    const antigo = dominio.resumoDoFechamento({ ...EVENTO, dias_periodo: 7, consumo_diario_grupo_kg: 30, custo_unitario_kg: 2 });
    expect([antigo.farol_consumo, antigo.consumo_relacao_esperado, antigo.sobra_informada, antigo.custo_total_periodo]).toEqual(["abaixo", 0.75, null, 420]);
  });
});

describe("FC-4 — serviço: faixa, custo e compartilhamento de um evento antigo", () => {
  it("faixa da formulação pelo formulacao_id, custo do movimento no cache e o farol gravado", async () => {
    apis.opcoes.mockImplementation(async () => [{ id: "f-1", faixa_tolerancia_percentual: 30 }]);
    apis.cache = { movimentacaoEstoque: [{ id: "mov-9", valor_unitario: "2.5" }] };
    const antigo = { ...EVENTO, formulacao_id: "f-1", movimentacao_estoque_id: "mov-9" };
    // 70% do esperado: abaixo com 15%, DENTRO com os 30% da formulação.
    const p = await supSvc.prepararFechamentoPeriodo({ evento: antigo, diasPeriodo: 7, sobraFinal: 124, sobraInicial: 20, sobraInformada: true, compartilhado: false });
    expect(p.patchEvento).toMatchObject({ farol_consumo: "dentro", faixa_tolerancia_aplicada: 30, custo_unitario_kg: 2.5, consumo_relacao_esperado: 0.7 });
    expect(apis.opcoes).toHaveBeenCalledWith("emp-1");
  });

  it("evento novo: a faixa gravada (mesmo null) vale e não busca a formulação; sem custo nenhum → sem custo", async () => {
    const p = await supSvc.prepararFechamentoPeriodo({ evento: { ...EVENTO, faixa_tolerancia_percentual: null, formulacao_id: "f-1" }, diasPeriodo: 7, sobraFinal: 40, sobraInicial: 20, compartilhado: false });
    expect(apis.opcoes).not.toHaveBeenCalled();
    expect(p.patchEvento).toMatchObject({ faixa_tolerancia_aplicada: 15, custo_unitario_kg: null, sobra_informada: null });
  });

  it("sem a prop, o compartilhamento vem do nível do cocho com o cache do mapa (o mesmo produto e os mesmos animais em outro cocho)", async () => {
    const outro = { ...EVENTO, id: "e2", ponto_suplementacao_id: "p2" };
    apis.cache = {
      eventosSuplementacao: [{ ...EVENTO, produto: "SAL", area_ids: ["a1"], dias_periodo: null }, { ...outro, produto: "SAL", area_ids: ["a1"], dias_periodo: null }],
      pontosSuplementacao: [
        { id: "p1", categoria_ponto: "COCHO", status: "Ativo", area_vinculada_ids: ["a1"] },
        { id: "p2", categoria_ponto: "COCHO", status: "Ativo", area_vinculada_ids: ["a1"] },
      ],
    };
    const p = await supSvc.prepararFechamentoPeriodo({ evento: { ...EVENTO, produto: "SAL", area_ids: ["a1"] }, diasPeriodo: 3, sobraFinal: 40, sobraInicial: 20, sobraInformada: true });
    expect([p.patchEvento.farol_consumo, p.patchEvento.farol_consumo_motivo]).toEqual(["sem_referencia", "cocho_compartilhado"]);
    // Sozinho no pasto: farol normal.
    apis.cache = { eventosSuplementacao: [{ ...EVENTO, produto: "SAL", area_ids: ["a1"] }], pontosSuplementacao: [{ id: "p1", categoria_ponto: "COCHO", status: "Ativo", area_vinculada_ids: ["a1"] }] };
    const s = await supSvc.prepararFechamentoPeriodo({ evento: { ...EVENTO, produto: "SAL", area_ids: ["a1"] }, diasPeriodo: 3, sobraFinal: 40, sobraInicial: 20, sobraInformada: true });
    expect(s.patchEvento.farol_consumo_motivo).not.toBe("cocho_compartilhado");
  });
});

describe("FC-5 — tela", () => {
  it("o cartão do período fechado mostra o farol COM texto, %PV real × esperado, custo e 'Aproximado' quando a sobra não foi medida", () => {
    const fechado = { ...EVENTO, dias_periodo: 7, consumo_diario_grupo_kg: 40, ...fechar(280, { custoUnitarioKg: 3.5, sobraInformada: false }) };
    render(<CardMetricaEvento evento={fechado} showProjecao={false} />);
    const bloco = screen.getByTestId("fechamento-consumo");
    expect(within(bloco).getByTestId("farol-consumo").textContent).toMatch(/Dentro \(±15%\)/);
    expect(within(bloco).getByTestId("farol-consumo").getAttribute("data-farol")).toBe("dentro");
    expect(bloco.textContent).toMatch(/100% do esperado/);
    expect(bloco.textContent).toMatch(/0,100% × 0,100%/);
    expect(bloco.textContent).toMatch(/400 g/);
    expect(bloco.textContent).toMatch(/R\$\s?1,40/);
    expect(bloco.textContent).toMatch(/R\$\s?980,00 · R\$\s?3,50\/kg/);
    expect(within(bloco).getByTestId("fechamento-aproximado").textContent).toMatch(/sobra não informada/);
  });

  it("período aberto: sem bloco de fechamento; sem custo e sem referência aparecem por escrito", () => {
    render(<CardMetricaEvento evento={{ ...EVENTO, dias_periodo: null }} />);
    expect(screen.queryByTestId("fechamento-consumo")).toBeNull();
    cleanup();
    render(<ResumoFechamentoConsumo resumo={fechar(280, { compartilhado: true })} />);
    expect(screen.getByTestId("farol-consumo").textContent).toMatch(/Sem referência — cocho compartilhado/);
    expect(screen.getAllByText("Sem custo").length).toBe(2);
    cleanup();
    render(<FarolConsumoSelo farol="abaixo" faixa={20} />);
    expect(screen.getByTestId("farol-consumo").textContent).toMatch(/🔴Abaixo \(±20%\)/);
    cleanup();
    render(<FarolConsumoSelo farol="acima" faixa={15} />);
    expect(screen.getByTestId("farol-consumo").textContent).toMatch(/Acima/);
  });
});

describe("D-PROD-210 — fechamento na base g/cab/dia: o farol compara os gramas", () => {
  it("FG-1 — relação = g real ÷ g esperado; limites exatos da faixa; %PV esperado nulo; %PV real só informação", async () => {
    const { calcularFechamentoConsumo } = await import("@/domain/suplementacao/fechamentoConsumo");
    const evento = { base_consumo: "G_CAB_DIA", total_cabecas_afetadas: 100, cabecas_nao_consomem: 0, consumo_esperado_pv_kg: 8, consumo_esperado_g_cab_dia: 80, peso_vivo_consumo_kg: 40000 };
    // 7 dias, 56 kg = 8 kg/dia = 80 g/cab/dia → 100%.
    const dentro = calcularFechamentoConsumo({ evento, consumoTotalKg: 56, diasPeriodo: 7 });
    expect(dentro).toMatchObject({ farol_consumo: "dentro", consumo_g_cab_dia: 80, consumo_esperado_g_cab_dia: 80, base_consumo_aplicada: "G_CAB_DIA", consumo_esperado_pv_percentual: null });
    expect(dentro.consumo_real_pv_percentual).toBeCloseTo(0.02, 6);
    // 85% exato (68 g) fica dentro; 84% abaixo; 115% dentro; 116% acima.
    expect(calcularFechamentoConsumo({ evento, consumoTotalKg: 0.85 * 56, diasPeriodo: 7 }).farol_consumo).toBe("dentro");
    expect(calcularFechamentoConsumo({ evento, consumoTotalKg: 0.84 * 56, diasPeriodo: 7 }).farol_consumo).toBe("abaixo");
    expect(calcularFechamentoConsumo({ evento, consumoTotalKg: 1.15 * 56, diasPeriodo: 7 }).farol_consumo).toBe("dentro");
    expect(calcularFechamentoConsumo({ evento, consumoTotalKg: 1.16 * 56, diasPeriodo: 7 }).farol_consumo).toBe("acima");
    // Faixa 10%: 112% acima.
    expect(calcularFechamentoConsumo({ evento, consumoTotalKg: 1.12 * 56, diasPeriodo: 7, faixaPercentual: 10 }).farol_consumo).toBe("acima");
  });

  it("FG-2 — sem os gramas gravados, o esperado vem do kg/dia ÷ cabeças que consomem; sem peso o %PV real fica nulo mas o farol sai; evento sem base = PV", async () => {
    const { calcularFechamentoConsumo } = await import("@/domain/suplementacao/fechamentoConsumo");
    const semG = { base_consumo: "G_CAB_DIA", total_cabecas_afetadas: 120, cabecas_nao_consomem: 20, consumo_esperado_pv_kg: 8 };
    const r = calcularFechamentoConsumo({ evento: semG, consumoTotalKg: 56, diasPeriodo: 7 });
    expect(r).toMatchObject({ consumo_esperado_g_cab_dia: 80, consumo_g_cab_dia: 80, farol_consumo: "dentro", consumo_real_pv_percentual: null });
    const pv = calcularFechamentoConsumo({ evento: { total_cabecas_afetadas: 10, consumo_esperado_pv_kg: 4, peso_vivo_consumo_kg: 4000 }, consumoTotalKg: 28, diasPeriodo: 7 });
    expect(pv).toMatchObject({ base_consumo_aplicada: "PV", consumo_esperado_g_cab_dia: null, consumo_esperado_pv_percentual: 0.1, farol_consumo: "dentro" });
  });

  it("FG-3 — a tela mostra 'g/cab/dia real × meta' e o %PV como informação na base g", async () => {
    const { ResumoFechamentoConsumo } = await import("@/components/suplementacao/FarolConsumo");
    const { calcularFechamentoConsumo } = await import("@/domain/suplementacao/fechamentoConsumo");
    const evento = { base_consumo: "G_CAB_DIA", total_cabecas_afetadas: 100, consumo_esperado_pv_kg: 8, consumo_esperado_g_cab_dia: 80, peso_vivo_consumo_kg: 40000 };
    render(<ResumoFechamentoConsumo resumo={calcularFechamentoConsumo({ evento, consumoTotalKg: 56, diasPeriodo: 7 })} />);
    expect(screen.getByText("g/cab/dia real × meta")).toBeTruthy();
    expect(screen.getByText("80 g × 80 g")).toBeTruthy();
    expect(screen.getByText("%PV real (informação)")).toBeTruthy();
    expect(screen.queryByText("%PV real × esperado")).toBeNull();
  });
});

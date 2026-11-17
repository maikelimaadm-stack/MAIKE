/**
 * D-PROD-217 (número definitivo no PR) — aba Suplementação do Detalhes do Lote
 * v12: `src/components/mapa/detalhes-lote/suplementacaoDoPasto.js` (puro).
 *
 *  SP-1. cochos da área: só COCHO (categoria vazia conta), ligados por
 *        `area_vinculada_ids` (vence) ou `area_vinculada_id`, por nome pt-BR;
 *  SP-2. o exemplo do v12 com eventos REAIS (período fechado pelo
 *        `calcularFechamentoDePeriodo`, ponto decorado como no mapa): KPIs,
 *        Fornecimento, Consumo, item do cocho;
 *  SP-3. tolerância REAL do fechamento (padrão 15%, faixa da formulação),
 *        dentro/fora e a cor do farol na bolinha do %PV;
 *  SP-4. base g/cab/dia (D-PROD-210): meta em gramas, sem %PV esperado;
 *  SP-5. cocho compartilhado e fechamento antigo (sem os campos do farol);
 *  SP-6. o período fechado MAIS RECENTE (empate → o último da lista);
 *  SP-7. sem dado → "—": sem lançamento, período fechado, sem %PV;
 *  SP-8. 2+ cochos: títulos com o nome; nível do ponto decorado; sem dados.
 */
import { describe, expect, it } from "vitest";
import {
  VAZIO,
  cochoDaArea,
  cochosDoPasto,
  corDoFarolConsumo,
  esperadoGramasCabDia,
  metaDoCocho,
  numeroBR,
  numerosDoCocho,
  suplementacaoDoPasto,
  ultimoPeriodoFechado,
} from "@/components/mapa/detalhes-lote/suplementacaoDoPasto";
import { urlIconeCocho } from "@/assets/icones/cocho-descoberto";
import { AREA, HOJE, cocho, decorar, exemploV12, fechadoK07, fechar, lancamento, leitura } from "./fixtures/suplementacaoPasto";

/** Mapa rótulo → valor de uma lista de células/KPIs. */
const porRotulo = (lista) => Object.fromEntries(lista.map((c) => [c.rotulo, c.valor]));
const daChave = (lista, chave) => lista.find((c) => c.chave === chave);

/** Só um cocho, sem decoração, com os eventos dados. */
const numerosDe = (eventos, extraPonto = {}) => {
  const ponto = cocho("k07", "Cocho 07", extraPonto);
  const v = suplementacaoDoPasto({ suplementacao: { pontos: [ponto], eventos, hoje: HOJE }, areaId: AREA });
  return v.primeiro;
};

describe("SP-1 — cochos da área", () => {
  it("só COCHO da área (lista de áreas vence a área única), por nome em pt-BR", () => {
    const pontos = [
      cocho("c10", "Cocho 10"),
      cocho("c2", "cocho 2", { area_vinculada_ids: [], area_vinculada_id: AREA }),
      cocho("ag", "Água Cocho", { categoria_ponto: "" }),
      cocho("dep", "Depósito Retiro", { categoria_ponto: "DEPOSITO" }),
      cocho("outra", "Cocho 01", { area_vinculada_ids: ["a-p01"], area_vinculada_id: "a-p01" }),
      // A lista de áreas manda: a área única antiga não vale.
      cocho("lista", "Cocho 03", { area_vinculada_ids: ["a-p02"], area_vinculada_id: AREA }),
      cocho("min", "Cocho 05", { categoria_ponto: "cocho" }),
    ];
    const nomes = cochosDoPasto({ pontos, eventos: [], hoje: HOJE, areaId: AREA }).map((c) => c.nome);
    expect(nomes).toEqual(["Água Cocho", "cocho 2", "Cocho 05", "Cocho 10"]);
    expect(cochoDaArea(pontos[0], null)).toBe(false);
    expect(cochoDaArea(pontos[3], AREA)).toBe(false);
    expect(cochosDoPasto({ pontos: null, eventos: null, areaId: AREA })).toEqual([]);
  });
});

describe("SP-2 — o exemplo do v12 com eventos reais", () => {
  const { pontos, eventos, hoje } = exemploV12();
  const v = suplementacaoDoPasto({ suplementacao: { pontos, eventos, hoje }, areaId: AREA });

  it("KPIs do último período fechado: 75 g (esperado 75 g), desvio -0,6 dentro de ±20% (faixa da formulação)", () => {
    expect(v.primeiro.kpis).toEqual([
      { chave: "porCabeca", rotulo: "Por cabeça (g/cab/dia)", valor: "75", nota: "esperado 75 g", corNota: "#64748b" },
      { chave: "desvio", rotulo: "Desvio da meta (%)", valor: "-0,6", nota: "dentro de ±20%", corNota: "#16a34a" },
    ]);
    expect(v.primeiro.fechado.id).toBe("e-k07-1");
    expect(v.primeiro.resumo.faixa_tolerancia_aplicada).toBe(20);
  });

  it("Fornecimento do ciclo aberto e Consumo esperado / real com a bolinha do farol do fechamento", () => {
    expect(porRotulo(v.primeiro.fornecimento)).toEqual({
      Produto: "SAL MINERAL 80",
      "Total fornecido (kg)": "400,00",
      "Total consumido (kg)": "140,40",
      "Sobra (resta) (kg)": "259,60",
    });
    expect(v.primeiro.fornecimento.some((c) => c.sub)).toBe(false);
    expect(porRotulo(v.primeiro.consumo)).toEqual({
      "Consumo do pasto (kg/dia)": "23,40",
      "Esperado/cab/dia (kg)": "0,075",
      "Realizado/cab/dia (kg)": "0,075",
      "%PV real × esperado": "0,034% × 0,035%",
    });
    expect(daChave(v.primeiro.consumo, "pv").bolinha).toBe("#16a34a");
  });

  it("item do cocho: nível do marcador, '65% · restam 260 kg', produto e o farol da leitura; um cocho → títulos sem nome", () => {
    expect(v.cochos).toHaveLength(1);
    const [c] = v.cochos;
    expect(c.nome).toBe("Cocho 07");
    expect(c.meta).toBe("65% · restam 260 kg");
    expect(c.produto).toBe("SAL MINERAL 80");
    expect(c.fracaoIcone).toBe(0.65);
    expect(c.fracaoIcone).toBe(pontos[0].indicador_percentual);
    expect(c.farol).toEqual({ hex: "#16a34a", texto: "Leitura: Cocho adequado" });
    expect(urlIconeCocho(c.fracaoIcone, true)).toMatch(/^data:image\/svg\+xml/);
    expect(v.titulos).toEqual({ fornecimento: "Fornecimento", consumo: "Consumo esperado / real" });
  });

  it("sobra anterior no ciclo: o total fornecido é a base do ciclo e diz quanto veio da sobra", () => {
    const n = numerosDe([lancamento("e1", "k07", { quantidade_total_kg: 350, sobra_kg: 50 })]);
    expect(daChave(n.fornecimento, "fornecido")).toEqual({
      chave: "fornecido",
      rotulo: "Total fornecido (kg)",
      valor: "400,00",
      sub: "inclui 50,00 kg de sobra anterior",
    });
    expect(daChave(n.fornecimento, "sobra").valor).toBe("259,60");
  });
});

describe("SP-3 — tolerância real e farol", () => {
  const anterior = (consumoTotal, faixa = null) =>
    fechar(lancamento("f1", "k07", { data_lancamento: "2026-10-27", quantidade_total_kg: consumoTotal, sobra_kg: 0, consumo_esperado_pv_kg: 23.55 }), {
      dias: 13,
      sobraFinal: 0,
      faixa,
    });

  it("sem faixa na formulação vale o padrão de 15%", () => {
    const n = numerosDe([anterior(23.55 * 13)]);
    expect(daChave(n.kpis, "desvio")).toMatchObject({ valor: "0,0", nota: "dentro de ±15%", corNota: "#16a34a" });
    expect(n.resumo.faixa_tolerancia_aplicada).toBe(15);
  });

  it("abaixo da faixa: 'fora de ±15%' em âmbar e bolinha vermelha; acima: azul", () => {
    const abaixo = numerosDe([anterior(23.55 * 13 * 0.8)]);
    expect(daChave(abaixo.kpis, "desvio")).toMatchObject({ valor: "-20,0", nota: "fora de ±15%", corNota: "#b45309" });
    expect(daChave(abaixo.consumo, "pv").bolinha).toBe("#dc2626");
    const acima = numerosDe([anterior(23.55 * 13 * 1.2)]);
    expect(daChave(acima.kpis, "desvio")).toMatchObject({ valor: "20,0", nota: "fora de ±15%", corNota: "#b45309" });
    expect(daChave(acima.consumo, "pv").bolinha).toBe("#2563eb");
  });

  it("faixa de 12,5% da formulação aparece como está; o limite exato fica dentro", () => {
    const n = numerosDe([anterior(23.55 * 13 * 0.875, 12.5)]);
    expect(daChave(n.kpis, "desvio")).toMatchObject({ valor: "-12,5", nota: "dentro de ±12,5%" });
    expect(corDoFarolConsumo("dentro")).toBe("#16a34a");
    expect(corDoFarolConsumo("sem_referencia")).toBeNull();
    expect(corDoFarolConsumo(null)).toBeNull();
  });
});

describe("SP-4 — base g/cab/dia (D-PROD-210)", () => {
  it("a meta é a gravada em gramas; %PV só real (sem esperado e sem bolinha)", () => {
    const fechado = fechar(
      lancamento("g1", "k07", {
        data_lancamento: "2026-10-27",
        base_consumo: "G_CAB_DIA",
        consumo_esperado_g_cab_dia: 80,
        consumo_esperado_pv_kg: 25.12,
        quantidade_total_kg: 314 * 0.072 * 10,
        sobra_kg: 0,
      }),
      { dias: 10, sobraFinal: 0 },
    );
    const n = numerosDe([fechado]);
    expect(n.resumo.base_consumo_aplicada).toBe("G_CAB_DIA");
    expect(porRotulo(n.kpis)).toEqual({ "Por cabeça (g/cab/dia)": "72", "Desvio da meta (%)": "-10,0" });
    expect(daChave(n.kpis, "porCabeca").nota).toBe("esperado 80 g");
    expect(daChave(n.kpis, "desvio").nota).toBe("dentro de ±15%");
    expect(daChave(n.consumo, "esperadoCab").valor).toBe("0,080");
    expect(daChave(n.consumo, "realizadoCab").valor).toBe("0,072");
    expect(daChave(n.consumo, "pv")).toEqual({ chave: "pv", rotulo: "%PV real × esperado", valor: `0,033% × ${VAZIO}` });
  });
});

describe("SP-5 — sem referência e fechamento antigo", () => {
  it("cocho compartilhado: g/cab/dia real aparece, desvio '—' sem nota, %PV sem bolinha", () => {
    const fechado = fechar(lancamento("s1", "k07", { data_lancamento: "2026-10-27", quantidade_total_kg: 23.55 * 13, consumo_esperado_pv_kg: 23.55 }), {
      dias: 13,
      sobraFinal: 0,
      compartilhado: true,
    });
    const n = numerosDe([fechado]);
    expect(n.resumo.farol_consumo).toBe("sem_referencia");
    expect(daChave(n.kpis, "porCabeca")).toMatchObject({ valor: "75", nota: "esperado 75 g" });
    expect(daChave(n.kpis, "desvio")).toEqual({ chave: "desvio", rotulo: "Desvio da meta (%)", valor: VAZIO });
    expect(daChave(n.consumo, "pv").valor).toBe("0,035% × 0,035%");
    expect(daChave(n.consumo, "pv").bolinha).toBeUndefined();
  });

  it("período fechado ANTES do farol gravado: resumo calculado na hora (faixa padrão)", () => {
    const antigo = lancamento("o1", "k07", {
      data_lancamento: "2026-10-01",
      dias_periodo: 10,
      consumo_diario_grupo_kg: 21.195,
      sobra_kg: 5,
    });
    const n = numerosDe([antigo]);
    expect(n.fechado.id).toBe("o1");
    expect(porRotulo(n.kpis)).toEqual({ "Por cabeça (g/cab/dia)": "68", "Desvio da meta (%)": "-9,4" });
    expect(daChave(n.kpis, "desvio").nota).toBe("dentro de ±15%");
    expect(daChave(n.kpis, "porCabeca").nota).toBe("esperado 75 g");
  });
});

describe("SP-6 — qual período fechado", () => {
  it("o de lançamento mais recente; o ciclo aberto e outros cochos ficam fora; empate → o último da lista", () => {
    const velho = fechar(lancamento("v", "k07", { data_lancamento: "2026-09-01", quantidade_total_kg: 100 }), { dias: 5, sobraFinal: 0 });
    const novo = fechadoK07();
    const aberto = lancamento("a", "k07");
    const deOutro = fechar(lancamento("x", "k09", { data_lancamento: "2026-11-01" }), { dias: 3, sobraFinal: 0 });
    expect(ultimoPeriodoFechado([novo, aberto, velho, deOutro], "k07").id).toBe("e-k07-1");
    const gemeo = { ...novo, id: "gemeo" };
    expect(ultimoPeriodoFechado([novo, gemeo], "k07").id).toBe("gemeo");
    expect(ultimoPeriodoFechado([aberto], "k07")).toBeNull();
    expect(ultimoPeriodoFechado(null, "k07")).toBeNull();
  });
});

describe("SP-7 — sem dado, '—'", () => {
  it("sem lançamento: 'Sem lançamento', números '—', produto padrão; esperado do cadastro do cocho", () => {
    const n = numerosDe([], { consumo_ideal_por_cabeca_kg: 0.08 });
    expect(n.cocho.meta).toBe("Sem lançamento");
    expect(n.cocho.fracaoIcone).toBe(0);
    expect(n.kpis).toEqual([
      { chave: "porCabeca", rotulo: "Por cabeça (g/cab/dia)", valor: VAZIO, nota: "esperado 80 g", corNota: "#64748b" },
      { chave: "desvio", rotulo: "Desvio da meta (%)", valor: VAZIO },
    ]);
    expect(porRotulo(n.fornecimento)).toEqual({
      Produto: "SAL MINERAL 80",
      "Total fornecido (kg)": VAZIO,
      "Total consumido (kg)": VAZIO,
      "Sobra (resta) (kg)": VAZIO,
    });
    expect(porRotulo(n.consumo)).toEqual({
      "Consumo do pasto (kg/dia)": VAZIO,
      "Esperado/cab/dia (kg)": "0,080",
      "Realizado/cab/dia (kg)": VAZIO,
      "%PV real × esperado": VAZIO,
    });
    const semNada = numerosDe([], { produto_padrao: null });
    expect(daChave(semNada.fornecimento, "produto").valor).toBe(VAZIO);
    expect(daChave(semNada.kpis, "porCabeca").nota).toBeUndefined();
  });

  it("último evento fechado (sem ciclo aberto): só a sobra informada; 'Período fechado'", () => {
    const n = numerosDe([fechar(lancamento("f", "k07", { data_lancamento: "2026-11-01", quantidade_total_kg: 200 }), { dias: 7, sobraFinal: 15.6 })]);
    expect(n.cocho.meta).toBe("Período fechado");
    expect(porRotulo(n.fornecimento)).toMatchObject({ "Total fornecido (kg)": VAZIO, "Total consumido (kg)": VAZIO, "Sobra (resta) (kg)": "15,60" });
    expect(daChave(n.consumo, "consumoPasto").valor).toBe(VAZIO);
  });

  it("sem %PV no lançamento: base conhecida, sem consumo nem sobra estimados; 'Sem estimativa'", () => {
    const n = numerosDe([lancamento("s", "k07", { consumo_esperado_pv_kg: null })]);
    expect(n.cocho.meta).toBe("Sem estimativa");
    expect(porRotulo(n.fornecimento)).toMatchObject({ "Total fornecido (kg)": "400,00", "Total consumido (kg)": VAZIO, "Sobra (resta) (kg)": VAZIO });
    expect(metaDoCocho(null)).toBe("Sem lançamento");
  });

  it("formatação: casas fixas, sem '-0,0', vazio para não número", () => {
    expect(numeroBR(-0.04, 1)).toBe("0,0");
    expect(numeroBR(1234.5, 2)).toBe("1.234,50");
    expect(numeroBR(null)).toBe(VAZIO);
    expect(numeroBR("x")).toBe(VAZIO);
    expect(esperadoGramasCabDia({ resumo: null, fechado: null, ponto: {} })).toBeNull();
  });
});

describe("SP-8 — vários cochos e o nível do mapa", () => {
  it("2+ cochos: números e títulos do primeiro por nome", () => {
    const extra = {
      pontos: [cocho("k09", "Cocho 09", { produto_padrao: "CREEP 22" }), cocho("k01", "Cocho 01", { area_vinculada_ids: ["a-p01"] })],
      eventos: [lancamento("e-k09", "k09", { produto: "CREEP 22", produto_id: "p-creep", quantidade_total_kg: 150, consumo_esperado_pv_kg: 6, data_lancamento: "2026-11-10" })],
      leituras: [leitura("l-k09", "k09", "2026-11-14", "CHEIO")],
    };
    const { pontos, eventos } = exemploV12(extra);
    const v = suplementacaoDoPasto({ suplementacao: { pontos, eventos, hoje: HOJE }, areaId: AREA });
    expect(v.cochos.map((c) => c.nome)).toEqual(["Cocho 07", "Cocho 09"]);
    expect(v.titulos).toEqual({ fornecimento: "Fornecimento · Cocho 07", consumo: "Consumo esperado / real · Cocho 07" });
    expect(v.primeiro.cocho.id).toBe("k07");
    expect(v.cochos[1]).toMatchObject({ meta: "80% · restam 120 kg", produto: "CREEP 22", farol: { hex: "#2563eb", texto: "Leitura: Cocho cheio" } });
  });

  it("usa o nível que o mapa já calculou; sem ele calcula com os mesmos insumos", () => {
    const { pontos, eventos } = exemploV12();
    const decorado = { ...pontos[0], nivel_suplementacao: { ...pontos[0].nivel_suplementacao, rotuloCurto: "42%", saldoKg: 168 } };
    const v = suplementacaoDoPasto({ suplementacao: { pontos: [decorado], eventos, hoje: HOJE }, areaId: AREA });
    expect(v.cochos[0].meta).toBe("42% · restam 168 kg");
    const cru = { ...pontos[0], nivel_suplementacao: undefined, indicador_farol: undefined };
    const calculado = suplementacaoDoPasto({ suplementacao: { pontos: [cru], eventos, hoje: HOJE }, areaId: AREA });
    expect(calculado.cochos[0].meta).toBe("65% · restam 260 kg");
    expect(calculado.cochos[0].farol).toBeNull();
    expect(decorar([cocho("k07", "Cocho 07")], eventos)[0].nivel_suplementacao.rotuloCurto).toBe("65%");
  });

  it("sem dados de suplementação: nenhum cocho", () => {
    expect(suplementacaoDoPasto({ suplementacao: null, areaId: AREA })).toEqual({
      cochos: [],
      primeiro: null,
      titulos: { fornecimento: "Fornecimento", consumo: "Consumo esperado / real" },
    });
  });
});

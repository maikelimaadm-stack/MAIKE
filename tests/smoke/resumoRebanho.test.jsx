/**
 * D-PROD-213 — Resumo do Rebanho (Mapa Geral): contas puras e o painel na casca
 * do Detalhes do Lote (`.mk-dl8`) nos três modos.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import {
  resumoDoRebanho,
  pesoProjetadoNoDia,
  somarDias,
  rotuloFazenda,
  TODAS_FAZENDAS,
} from "@/domain/rebanho/resumoDoRebanho";
import PainelResumoRebanho from "@/components/mapa/resumo-rebanho/PainelResumoRebanho";

const HOJE = "2026-11-16";

/** Projeção como o servidor manda: hoje + fim de cada mês (GMD constante no mês). */
const projecao = (pesoHoje, gmdNov = 0.35, gmdDez = 0.35, gmdJan = 0.4, gmdFev = 0.45) => {
  const nov = pesoHoje + gmdNov * 14; // 16/11 → 30/11
  const dez = nov + gmdDez * 31;
  const jan = dez + gmdJan * 31;
  const fev = jan + gmdFev * 28;
  return {
    disponivel: true,
    dia: HOJE,
    peso_kg: pesoHoje,
    projecao_mensal: [
      { mes: "2026-11", dia: "2026-11-30", peso_kg: nov },
      { mes: "2026-12", dia: "2026-12-31", peso_kg: dez },
      { mes: "2027-01", dia: "2027-01-31", peso_kg: jan },
      { mes: "2027-02", dia: "2027-02-28", peso_kg: fev },
    ],
  };
};

const AREAS = [
  { id: "a1", nome: "KM - 06", setor_nome: "FAZENDA KAIMAN I", tamanho_hectares: 125.9 },
  { id: "a2", nome: "MT - 01 A", setor_nome: "FAZENDA MATA AZUL", tamanho_hectares: 16.8 },
  { id: "a3", nome: "KM - 07 F", setor_nome: "FAZENDA KAIMAN I", tamanho_hectares: 10 },
];
const CATS = [
  { id: "c-bez", nome: "BEZERRO 09 A 12 MESES", idade_minima_meses: 9 },
  { id: "c-gar", nome: "GARROTE 13 A 24 MESES", idade_minima_meses: 13 },
  { id: "c-vac", nome: "VACA LEITERA", idade_minima_meses: 37 },
];
const POS = [
  { id: "p1", area_atual_id: "a1", categoria_manejo_id: "c-bez", categoria_manejo_nome: "BEZERRO 09 A 12 MESES", quantidade_cabecas: 300, peso_medio_kg: 250, projecao_peso: projecao(254) },
  { id: "p2", area_atual_id: "a2", categoria_manejo_id: "c-gar", categoria_manejo_nome: "GARROTE 13 A 24 MESES", quantidade_cabecas: 150, peso_medio_kg: 320, projecao_peso: projecao(324) },
  { id: "p3", area_atual_id: "a3", categoria_manejo_id: "c-vac", categoria_manejo_nome: "VACA LEITERA", quantidade_cabecas: 27, peso_medio_kg: 400, projecao_peso: { disponivel: false, motivo: "sem_peso" } },
  { id: "p0", area_atual_id: "a1", categoria_manejo_nome: "BEZERRO 09 A 12 MESES", quantidade_cabecas: 0, peso_medio_kg: 999 },
];

describe("D-PROD-213 — contas puras", () => {
  it("interpola a projeção entre os fins de mês e devolve null além do último ponto", () => {
    const p = projecao(300);
    expect(pesoProjetadoNoDia(p, HOJE)).toBe(300);
    expect(pesoProjetadoNoDia(p, "2026-11-01")).toBe(300);
    expect(pesoProjetadoNoDia(p, "2026-11-30")).toBeCloseTo(304.9, 6);
    // 16/12: metade de dezembro (15 de 31 dias) depois do fim de novembro.
    expect(pesoProjetadoNoDia(p, "2026-12-15")).toBeCloseTo(304.9 + 0.35 * 15, 6);
    // +90 dias = 14/02/2027: 14 dias de fevereiro a 0,45.
    const d90 = somarDias(HOJE, 90);
    expect(d90).toBe("2027-02-14");
    expect(pesoProjetadoNoDia(p, d90)).toBeCloseTo(300 + 0.35 * 14 + 0.35 * 31 + 0.4 * 31 + 0.45 * 14, 6);
    expect(pesoProjetadoNoDia(p, "2027-03-10")).toBeNull();
    expect(pesoProjetadoNoDia({ disponivel: false }, HOJE)).toBeNull();
    expect(pesoProjetadoNoDia(null, HOJE)).toBeNull();
  });

  it("totais, médias ponderadas, arrobas, 90 dias e cabeças sem projeção", () => {
    const r = resumoDoRebanho({ posicoes: POS, areas: AREAS, categoriasManejo: CATS, hoje: HOJE });
    expect(r.cabecas).toBe(477);
    expect(r.cabecasSemProjecao).toBe(27);
    expect(r.cabecasSemPeso).toBe(0);
    const kgHoje = 300 * 254 + 150 * 324 + 27 * 400;
    expect(r.pesoMedioHoje).toBeCloseTo(kgHoje / 477, 6);
    expect(r.arrobasHoje).toBeCloseTo(kgHoje / 30, 6);
    const ganhoCab = 0.35 * 14 + 0.35 * 31 + 0.4 * 31 + 0.45 * 14;
    // A vaca sem projeção não ganha no horizonte.
    expect(r.arrobasGanho90).toBeCloseTo(((300 + 150) * ganhoCab) / 30, 6);
    expect(r.pesoMedio90).toBeCloseTo((kgHoje + 450 * ganhoCab) / 477, 6);
    expect(r.categorias.map((c) => c.nome)).toEqual(["BEZERRO 09 A 12 MESES", "GARROTE 13 A 24 MESES", "VACA LEITERA"]);
    expect(r.categorias[0]).toMatchObject({ cabecas: 300, pesoHoje: 254 });
    expect(r.categorias[2]).toMatchObject({ cabecas: 27, pesoHoje: 400, peso90: 400 });
    expect(r.fazendas).toEqual([
      { id: "FAZENDA KAIMAN I", rotulo: "KAIMAN I" },
      { id: "FAZENDA MATA AZUL", rotulo: "MATA AZUL" },
    ]);
  });

  it("UA/ha por pasto (UA = 450 kg) ordenado da maior lotação para a menor", () => {
    const r = resumoDoRebanho({ posicoes: POS, areas: AREAS, categoriasManejo: CATS, hoje: HOJE });
    expect(r.pastos.map((p) => p.nome)).toEqual(["MT - 01 A", "KM - 07 F", "KM - 06"]);
    expect(r.pastos[0].uaHa).toBeCloseTo((150 * 324) / 450 / 16.8, 6);
    expect(r.pastos[2].uaHa).toBeCloseTo((300 * 254) / 450 / 125.9, 6);
    expect(r.pastos[0].fazenda).toBe("MATA AZUL");
  });

  it("filtro por fazenda e posição sem peso nenhum", () => {
    const r = resumoDoRebanho({ posicoes: POS, areas: AREAS, categoriasManejo: CATS, hoje: HOJE, fazenda: "FAZENDA MATA AZUL" });
    expect(r.cabecas).toBe(150);
    expect(r.pastos).toHaveLength(1);
    // O filtro não esconde as outras fazendas da lista de opções.
    expect(r.fazendas).toHaveLength(2);
    const semPeso = resumoDoRebanho({
      posicoes: [{ area_atual_id: "a1", categoria: "Boi", quantidade_cabecas: 10, peso_medio_kg: null }],
      areas: AREAS,
      hoje: HOJE,
      fazenda: TODAS_FAZENDAS,
    });
    expect(semPeso).toMatchObject({ cabecas: 10, cabecasSemPeso: 10, pesoMedioHoje: null, arrobasHoje: null });
    expect(semPeso.pastos[0].uaHa).toBeNull();
    expect(rotuloFazenda("FAZENDA MATA AZUL")).toBe("MATA AZUL");
    expect(rotuloFazenda("Sítio Novo")).toBe("Sítio Novo");
  });

  it("sem dia de hoje (fazenda sem fuso): 90 dias = peso de hoje", () => {
    const r = resumoDoRebanho({ posicoes: POS, areas: AREAS, categoriasManejo: CATS, hoje: null });
    expect(r.arrobasGanho90).toBeCloseTo(0, 6);
    expect(r.cabecasSemProjecao).toBe(477);
  });
});

const modo = (/** @type {'celular'|'tablet'|'desktop'} */ m) => {
  window.matchMedia = /** @type {any} */ ((q) => ({
    matches: m === "celular" ? /max-width: 639px/.test(q) : m === "desktop" ? /min-width: 1024px/.test(q) : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
};

afterEach(() => cleanup());

describe("D-PROD-213 — painel", () => {
  for (const m of /** @type {const} */ (["celular", "tablet", "desktop"])) {
    it(`${m}: casca do Detalhes do Lote, abas, filtro de fazenda e as duas listas`, () => {
      modo(m);
      const { container } = render(<PainelResumoRebanho posicoes={POS} areas={AREAS} categoriasManejo={CATS} hoje={HOJE} />);
      const raiz = container.querySelector(".mk-dl.mk-dl8");
      expect(raiz?.getAttribute("data-modo")).toBe(m);
      expect(screen.getByRole("tab", { name: "Rebanho" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getAllByText("Cabeças").length).toBeGreaterThan(0);
      expect(screen.getAllByText("477").length).toBeGreaterThan(0);
      expect(screen.getByText("Por categoria · 3")).toBeTruthy();
      expect(screen.getByText(/27 cabeças sem projeção usam o peso gravado/)).toBeTruthy();

      const fazendas = screen.getByRole("group", { name: "Fazenda" });
      fireEvent.click(within(fazendas).getByRole("button", { name: "MATA AZUL" }));
      expect(within(fazendas).getByRole("button", { name: "MATA AZUL" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getAllByText("150").length).toBeGreaterThan(0);
      expect(screen.queryByText("477")).toBeNull();

      fireEvent.click(screen.getByRole("tab", { name: "Pastos" }));
      expect(screen.getByRole("tab", { name: "Pastos" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("Pastos · 1")).toBeTruthy();
      expect(screen.getByText("MT - 01 A")).toBeTruthy();
    });
  }
});

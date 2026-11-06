/**
 * Resumo e lotes da área no Mapa Geral (D-PROD-94a): o diálogo da área mostra
 * os indicadores do pastejo antes da lista, e a aba "Lotes" traz o que o
 * manejo precisa ver — categoria, cabeças, carga, peso e dias, com o total.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import ResumoArea from "@/components/mapa/ResumoArea";
import LotesDaArea from "@/components/mapa/LotesDaArea";
import { PESO_DA_UA_KG, indicadoresDaArea } from "@/domain/areas/indicadoresArea";

const AREA = {
  id: "area-A",
  nome: "PASTO 1",
  tipo_cultura: "Pastagem",
  tipo_pastagem: "Marandu",
  tamanho_hectares: "20",
  area_pastejada: "16",
  aproveitamento_classificacao: "Média",
};

const diasAtras = (dias) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - dias);
  return d.toISOString();
};

const LOTES = [
  { id: "l1", nome: "GARROTES 1", categoria: "Garrotes", quantidade_cabecas: 50, peso_medio_kg: 360, data_entrada: diasAtras(10), area_atual_id: "area-A", identificador_cor: "#8b4513" },
  { id: "l2", nome: "MATRIZES 1", categoria: "Matrizes", quantidade_cabecas: 30, peso_medio_kg: 450, data_entrada: diasAtras(20), area_atual_id: "area-A" },
];

describe("indicadoresDaArea", () => {
  it("soma cabeças, converte peso em UA e usa a área útil na taxa de lotação", () => {
    const i = indicadoresDaArea(AREA, LOTES);
    const pesoTotal = 360 * 50 + 450 * 30;
    expect(i.cabecas).toBe(80);
    expect(i.pesoTotal).toBe(pesoTotal);
    expect(i.cargaAnimal).toBeCloseTo(pesoTotal / PESO_DA_UA_KG, 6);
    expect(i.taxaDeLotacao).toBeCloseTo(pesoTotal / PESO_DA_UA_KG / 16, 6);
    expect(i.areaTotal).toBe(20);
    expect(i.areaUtil).toBe(16);
  });

  it("sem área pastejada, a área útil é a área total; sem lote, nada quebra", () => {
    const i = indicadoresDaArea({ tamanho_hectares: 10 }, []);
    expect(i.areaUtil).toBe(10);
    expect(i.cabecas).toBe(0);
    expect(i.taxaDeLotacao).toBe(0);
    expect(i.diasPastejados).toBe(0);
  });

  it("dias pastejados são a média ponderada por cabeça", () => {
    const i = indicadoresDaArea(AREA, LOTES);
    expect(i.diasPastejados).toBe(14); // (10*50 + 20*30) / 80
  });
});

describe("ResumoArea", () => {
  it("mostra o cabeçalho da área e os indicadores do pastejo", () => {
    render(<ResumoArea area={AREA} lotes={LOTES} />);
    expect(screen.getByText("PASTO 1")).toBeTruthy();
    expect(screen.getByText("Marandu")).toBeTruthy();
    for (const rotulo of ["Área total", "Área útil", "Dias pastejados", "Bovinos", "Carga animal", "Taxa de lotação"]) {
      expect(screen.getByText(rotulo), rotulo).toBeTruthy();
    }
    expect(screen.getByText("80")).toBeTruthy();
    cleanup();
  });

  it("curral mostra a infraestrutura no lugar do pastejo", () => {
    render(<ResumoArea area={{ id: "c1", nome: "CURRAL 1", tipo_cultura: "Infraestrutura", tipo_infraestrutura: "Curral" }} />);
    expect(screen.getByText("Tipo de infraestrutura")).toBeTruthy();
    expect(screen.queryByText("Taxa de lotação")).toBeNull();
  });
});

describe("LotesDaArea", () => {
  it("lista os lotes com cabeças, carga, peso e dias", () => {
    render(<LotesDaArea lotes={LOTES} />);
    expect(screen.getByText("GARROTES 1")).toBeTruthy();
    expect(screen.getByText("MATRIZES 1")).toBeTruthy();
    expect(screen.getByText("Garrotes")).toBeTruthy();
    expect(screen.getByText("360")).toBeTruthy(); // peso por cabeça, sem casas
    expect(screen.getByText("Total")).toBeTruthy();
    expect(screen.getByText("80")).toBeTruthy(); // total de cabeças
  });

  it("área sem lote tem vazio próprio", () => {
    render(<LotesDaArea lotes={[]} />);
    expect(screen.getByText("Nenhum lote nesta área.")).toBeTruthy();
  });
});

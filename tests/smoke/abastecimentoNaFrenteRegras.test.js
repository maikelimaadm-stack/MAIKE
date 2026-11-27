/**
 * D-PROD-359 — as linhas dos abastecimentos em "Lançado hoje" (`abastecimentoNaFrenteRegras`): só CONFIRMADO, a quantidade
 * na unidade gravada ("80 L"), a linha de apoio (Produto · local ou Posto externo), a hora no fuso da fazenda, e a junção
 * na ordem do horário sem tocar em `lancamentosDoDia`.
 */
import { describe, it, expect } from "vitest";
import { juntarNaOrdemDoDia, linhasDosAbastecimentosDoDia, subDoAbastecimento } from "@/lib/abastecimentoNaFrenteRegras";
import { lancamentosDoDia } from "@/lib/aberturaServicoRegras";

const FUSO = "America/Sao_Paulo";
const confirmado = (over = {}) => ({
  id: "ab-1",
  status: "CONFIRMADO",
  produto: { id: "p1", nome: "Óleo diesel S10" },
  local_estoque: { id: "l1", nome: "Tanque diesel sede" },
  origem: "ESTOQUE",
  quantidade: "80.0000",
  unidade: "L",
  created_date: "2026-11-26T10:20:00.000Z",
  ...over,
});

describe("linhasDosAbastecimentosDoDia", () => {
  it("(1) uma linha por abastecimento CONFIRMADO: título Abastecimento, Produto · local, \"80 L\" e a hora no fuso da fazenda", () => {
    const [linha] = linhasDosAbastecimentosDoDia([confirmado()], FUSO);
    expect(linha).toMatchObject({ chave: "abastecimento:ab-1", hora: "07:20", tipo: "abastecimento", titulo: "Abastecimento", sub: "Óleo diesel S10 · Tanque diesel sede", quantidade: "80 L" });
  });

  it("(2) cancelado não entra (e lista vazia ou ausente não quebra)", () => {
    expect(linhasDosAbastecimentosDoDia([confirmado({ id: "x", status: "CANCELADO" })], FUSO)).toEqual([]);
    expect(linhasDosAbastecimentosDoDia(undefined, FUSO)).toEqual([]);
    expect(linhasDosAbastecimentosDoDia([null, "lixo"], FUSO)).toEqual([]);
  });

  it("(3) posto externo: a linha de apoio diz \"Posto externo\", sem local de estoque", () => {
    const registro = confirmado({ origem: "EXTERNO", local_estoque: null, quantidade: "120.5000" });
    expect(subDoAbastecimento(registro)).toBe("Óleo diesel S10 · Posto externo");
    expect(linhasDosAbastecimentosDoDia([registro], FUSO)[0].quantidade).toBe("120,5 L");
  });

  it("(4) a quantidade vai na unidade gravada (kg para o Produto em quilos)", () => {
    const [linha] = linhasDosAbastecimentosDoDia([confirmado({ quantidade: "35.0000", unidade: "KG" })], FUSO);
    expect(linha.quantidade).toBe("35 kg");
  });

  it("(5) sem produto nem local, a linha de apoio fica só com o que houver", () => {
    expect(subDoAbastecimento({ origem: "ESTOQUE", produto: { nome: "Diesel" }, local_estoque: null })).toBe("Diesel");
    expect(subDoAbastecimento({ origem: "ESTOQUE" })).toBe("");
  });
});

describe("juntarNaOrdemDoDia", () => {
  it("(6) junta na ordem do horário, sem alterar as listas de origem", () => {
    const lancamentos = lancamentosDoDia(
      [
        {
          id: "ap-1",
          data_operacional: "2026-11-26",
          status: "CONFIRMADO",
          createdAt: "2026-11-26T09:00:00.000Z",
          observacao: null,
          produtos: [{ id: "pl-1", status: "CONFIRMADO", produto: { nome: "Glifosato" }, quantidade: "10.0000", unidade: "L", jato: 1, createdAt: "2026-11-26T09:10:00.000Z" }],
          maquinas: [],
          mao_obra: [],
          servicos: [],
        },
      ],
      "2026-11-26",
      FUSO,
    );
    const copiaDosLancamentos = JSON.stringify(lancamentos);
    const abastecimentos = linhasDosAbastecimentosDoDia([confirmado({ created_date: "2026-11-26T11:00:00.000Z" })], FUSO);
    const juntas = juntarNaOrdemDoDia(lancamentos, abastecimentos);
    expect(juntas.map((l) => l.tipo)).toEqual(["insumo", "abastecimento"]);
    expect(juntas[1].hora).toBe("08:00");
    // `lancamentosDoDia` não muda (o cálculo das horas e a lista do serviço seguem como estavam).
    expect(JSON.stringify(lancamentos)).toBe(copiaDosLancamentos);
    expect(lancamentos).toHaveLength(1);
  });
});

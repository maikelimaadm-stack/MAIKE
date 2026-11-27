/**
 * D-PROD-348 (item 5) — regras puras do encerramento quando o tipo EXIGE produção: reconhecer a recusa do servidor
 * (`ATIVIDADE_EXIGIDA_PELO_TIPO` com `field = quantidade_produzida`) e ler a quantidade produzida digitada (pt-BR).
 */
import { describe, it, expect } from "vitest";
import { ehProducaoExigida, parseQuantidadeProduzida, TEXTO_PRODUCAO_EXIGIDA } from "@/lib/lancamentoAtividadesRegras";

describe("ehProducaoExigida (D-PROD-348, item 5)", () => {
  it("reconhece a recusa do concluir pelo código e pelo campo (no topo do erro)", () => {
    const erro = Object.assign(new Error("x"), { code: "ATIVIDADE_EXIGIDA_PELO_TIPO", details: { field: "quantidade_produzida", reason: "exige_producao" } });
    expect(ehProducaoExigida(erro)).toBe(true);
  });

  it("reconhece quando o corpo do servidor está em `cause` (o transporte guarda o corpo ali)", () => {
    const erro = Object.assign(new Error("x"), {
      code: "API_INVALID_ARGUMENT",
      cause: { code: "ATIVIDADE_EXIGIDA_PELO_TIPO", field: "quantidade_produzida", reason: "exige_producao" },
    });
    expect(ehProducaoExigida(erro)).toBe(true);
  });

  it("não confunde com as outras exigências do tipo (área, máquina) nem com outro código", () => {
    expect(ehProducaoExigida(Object.assign(new Error("x"), { code: "ATIVIDADE_EXIGIDA_PELO_TIPO", details: { field: "bem_id", reason: "exige_maquina" } }))).toBe(false);
    expect(ehProducaoExigida(Object.assign(new Error("x"), { code: "ATIVIDADE_NOT_FOUND" }))).toBe(false);
    expect(ehProducaoExigida(new Error("rede"))).toBe(false);
    expect(ehProducaoExigida(null)).toBe(false);
  });

  it("o texto do aviso é o da tela (claro, sem o erro cru)", () => {
    expect(TEXTO_PRODUCAO_EXIGIDA).toBe("Este tipo de atividade exige informar a produção. Informe a quantidade produzida para encerrar.");
  });
});

describe("parseQuantidadeProduzida (D-PROD-348, item 5)", () => {
  it("pt-BR → canônico do servidor (até 4 casas; ponto de milhar sai)", () => {
    expect(parseQuantidadeProduzida("1.250,5")).toBe("1250.5");
    expect(parseQuantidadeProduzida("12,5")).toBe("12.5");
    expect(parseQuantidadeProduzida("300")).toBe("300");
    expect(parseQuantidadeProduzida(" 7,12345 ")).toBeNull();
    expect(parseQuantidadeProduzida("0,0001")).toBe("0.0001");
  });

  it("vazio, zero, negativo, texto ou formato inválido → null (não grava nada)", () => {
    expect(parseQuantidadeProduzida("")).toBeNull();
    expect(parseQuantidadeProduzida("   ")).toBeNull();
    expect(parseQuantidadeProduzida("0")).toBeNull();
    expect(parseQuantidadeProduzida("0,0")).toBeNull();
    expect(parseQuantidadeProduzida("-5")).toBeNull();
    expect(parseQuantidadeProduzida("abc")).toBeNull();
    expect(parseQuantidadeProduzida(undefined)).toBeNull();
  });
});

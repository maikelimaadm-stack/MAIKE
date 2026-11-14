/**
 * D-PROD-198 — o peso objetivo digitado em pt-BR: "1.200" é milhar (1200), não 1,2.
 */
import { describe, it, expect } from "vitest";
import { numeroPtBr, pesoObjetivoOuNulo } from "@/services/categoriaManejoService";
import { pesoObjetivoValido } from "@/components/categorias-manejo/FormularioCategoriaManejo";
import { compararCategoriasManejo } from "@/components/categorias-manejo/TabelaCategoriasManejo";

describe("D-PROD-198 — número pt-BR do peso objetivo", () => {
  it("milhar, vírgula e ponto decimal", () => {
    expect(numeroPtBr("1.200")).toBe(1200);
    expect(numeroPtBr("1.250,5")).toBe(1250.5);
    expect(numeroPtBr("450,5")).toBe(450.5);
    expect(numeroPtBr("450.5")).toBe(450.5);
    expect(numeroPtBr("540")).toBe(540);
    expect(Number.isNaN(numeroPtBr("12a"))).toBe(true);
    expect(Number.isNaN(numeroPtBr("1,200.5"))).toBe(true);
  });

  it("payload e validação do formulário usam a mesma leitura", () => {
    expect(pesoObjetivoOuNulo("1.200")).toBe(1200);
    expect(pesoObjetivoOuNulo(" ")).toBeNull();
    expect(pesoObjetivoOuNulo("abc")).toBe("abc");
    expect(pesoObjetivoValido("1.200")).toBe(true);
    expect(pesoObjetivoValido("3.000,5")).toBe(false);
    expect(pesoObjetivoValido("")).toBe(true);
  });

  it("a grade ordena o peso objetivo pelo número; vazio no fim", () => {
    const lista = [{ peso_objetivo_kg: 1200 }, { peso_objetivo_kg: null }, { peso_objetivo_kg: 980 }];
    lista.sort((a, b) => compararCategoriasManejo(a, b, "peso_objetivo"));
    expect(lista.map((x) => x.peso_objetivo_kg)).toEqual([980, 1200, null]);
    expect(compararCategoriasManejo({}, {}, "nome")).toBeUndefined();
  });
});

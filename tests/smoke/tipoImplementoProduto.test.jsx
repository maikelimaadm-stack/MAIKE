/**
 * D-PROD-279 (MAIKE-TIPO-IMPLEMENTO-PRODUTO) — o bloco "Usa produto?" do
 * formulário do tipo ("⋯ › Gerenciar tipos" › "+ Novo tipo"):
 *  - só aparece quando o Tipo de bem é Implemento (com a dica);
 *  - Não: o envio leva `usa_produto: false` e nada mais do produto;
 *  - Sim: "Como conta" (Por jato), "Capacidade do jato" e "Unidade" (L | kg);
 *    capacidade vazia, zero ou acima de 100.000 é recusada sem enviar;
 *  - outro Tipo de bem não manda os campos do produto;
 *  - o resumo discreto da lista ("usa produto · jato 2.000 L").
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";

const { default: FormularioTipo, FORMULARIO_TIPO_ID } = await import("@/components/patrimonio/FormularioTipo");
const { resumoProduto } = await import("@/components/patrimonio/GerenciarTiposDialog");

afterEach(cleanup);

const enviar = () => fireEvent.submit(document.getElementById(FORMULARIO_TIPO_ID));
const nome = (v) => fireEvent.change(screen.getByPlaceholderText("EX.: TRATOR DE PNEUS"), { target: { value: v } });
const escolher = (grupo, rotulo) => fireEvent.click(within(screen.getByTestId(grupo)).getByRole("radio", { name: rotulo }));

describe("D-PROD-279 — produto do implemento no formulário do tipo", () => {
  it("o bloco aparece só para Implemento", () => {
    const { unmount } = render(<FormularioTipo naturezaFixa="MAQUINA" onSubmit={() => {}} />);
    expect(screen.queryByTestId("tipo-usa-produto")).toBeNull();
    expect(screen.queryByTestId("tipo-produto-dica")).toBeNull();
    unmount();
    render(<FormularioTipo naturezaFixa="IMPLEMENTO" onSubmit={() => {}} />);
    expect(screen.getByTestId("tipo-usa-produto")).toBeTruthy();
    expect(screen.getByTestId("tipo-produto-dica").textContent).toBe("Ex.: pulverizador 2.000 L. A grade não usa produto.");
    // Não (padrão): sem os campos do jato.
    expect(screen.queryByTestId("tipo-capacidade")).toBeNull();
    escolher("tipo-usa-produto", "Sim");
    expect(screen.getByText("Como conta")).toBeTruthy();
    expect(screen.getAllByText("Por jato (tanque)").length).toBeGreaterThan(0);
    expect(screen.getByTestId("tipo-capacidade")).toBeTruthy();
    expect(within(screen.getByTestId("tipo-capacidade-unidade")).getAllByRole("radio").map((b) => b.textContent)).toEqual(["L", "kg"]);
  });

  it("Não envia só usa_produto=false; outro Tipo de bem não envia nada do produto", () => {
    const onSubmit = vi.fn();
    const { unmount } = render(<FormularioTipo naturezaFixa="IMPLEMENTO" onSubmit={onSubmit} />);
    nome("GRADE ARADORA");
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({ natureza: "IMPLEMENTO", nome: "GRADE ARADORA", salto_maximo_medidor: null, usa_produto: false });
    unmount();
    const outro = vi.fn();
    render(<FormularioTipo naturezaFixa="MAQUINA" onSubmit={outro} />);
    nome("TRATOR");
    enviar();
    expect(Object.keys(outro.mock.calls[0][0]).sort()).toEqual(["natureza", "nome", "salto_maximo_medidor"]);
  });

  it("Sim: capacidade obrigatória, > 0 e ≤ 100.000; envia jato, capacidade em texto decimal e a unidade", () => {
    const onSubmit = vi.fn();
    render(<FormularioTipo naturezaFixa="IMPLEMENTO" onSubmit={onSubmit} />);
    nome("PULVERIZADOR");
    escolher("tipo-usa-produto", "Sim");
    const cap = screen.getByTestId("tipo-capacidade");
    for (const ruim of ["", "0", "100000,5", "abc"]) {
      fireEvent.change(cap, { target: { value: ruim } });
      enviar();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByText("Maior que zero, até 100.000, até 4 casas decimais")).toBeTruthy();
    }
    fireEvent.change(cap, { target: { value: "2.000" } });
    escolher("tipo-capacidade-unidade", "kg");
    enviar();
    expect(onSubmit).toHaveBeenCalledWith({
      natureza: "IMPLEMENTO", nome: "PULVERIZADOR", salto_maximo_medidor: null,
      usa_produto: true, forma_produto: "JATO", capacidade: "2000", capacidade_unidade: "KG",
    });
  });

  it("resumo da lista: só implemento com produto", () => {
    expect(resumoProduto({ natureza: "IMPLEMENTO", usa_produto: true, forma_produto: "JATO", capacidade: "2000.0000", capacidade_unidade: "L" })).toBe("usa produto · jato 2.000 L");
    expect(resumoProduto({ natureza: "IMPLEMENTO", usa_produto: false })).toBeNull();
    expect(resumoProduto({ natureza: "MAQUINA", usa_produto: true })).toBeNull();
  });
});

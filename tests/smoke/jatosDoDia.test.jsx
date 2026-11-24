// D-PROD-283 (MAIKE-INSUMO-POR-JATO) — "Jatos de hoje": as regras (agrupar, repetir, somar), o corpo enviado com o jato,
// o tanque do implemento e o bloco da tela (cartões, "igual ao jato", Editar, Repetir, Jato diferente, total).
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import JatosDoDia from "@/components/lancamento-atividades/JatosDoDia";
import { jatosDosItens, jatosIguais, proximoJato, repetirUltimoJato, rotuloDoTanque, tanqueDoRegistro, tanqueEJatoDoDia, textoDosJatosSalvos, totaisDosJatos } from "@/lib/jatosRegras";
import { bemEscolhido, formularioDaLinhaMaquina, jatoDoImplemento } from "@/lib/atividadeLinhasRegras";
import { linhasDoCorpoDoRegistro } from "@/lib/registroDeCampoRegras";

const HERB = { id: "p1", rotulo: "HERBICIDA FOLHA LARGA", unidade_principal_estoque: "L" };
const ADUBO = { id: "p2", rotulo: "ADUBO FOLIAR", unidade_principal_estoque: "KG" };
const item = (chave, produto, quantidade, jato) => ({ chave, form: { produto, local_estoque_id: "l1", quantidade, observacao: "", ...(jato ? { jato } : {}) } });
const TANQUE = { capacidade: "2000", unidade: "L" };

describe("regras dos jatos", () => {
  const itens = [item("a", HERB, "10", 1), item("b", ADUBO, "8", 1), item("c", HERB, "10", 2), item("d", ADUBO, "8", 2), item("e", HERB, "14", 3), item("f", ADUBO, "8", 3)];

  it("agrupa por jato, em ordem; o próximo é o maior + 1", () => {
    expect(jatosDosItens(itens).map((j) => [j.numero, j.itens.map((i) => i.chave)])).toEqual([[1, ["a", "b"]], [2, ["c", "d"]], [3, ["e", "f"]]]);
    expect(proximoJato(itens)).toBe(4);
    expect(proximoJato([])).toBe(1);
    expect(jatosDosItens([item("x", HERB, "1")])).toEqual([]);
  });

  it("jato igual ao anterior: mesmos produtos, locais e quantidades", () => {
    const [j1, j2, j3] = jatosDosItens(itens);
    expect(jatosIguais(j2, j1)).toBe(true);
    expect(jatosIguais(j3, j2)).toBe(false);
  });

  it("repetir copia o último jato com o número novo e chaves novas", () => {
    let n = 0;
    const copias = repetirUltimoJato(itens, () => `novo-${(n += 1)}`);
    expect(copias.map((i) => [i.chave, i.form.jato, i.form.produto.id, i.form.quantidade])).toEqual([["novo-1", 4, "p1", "14"], ["novo-2", 4, "p2", "8"]]);
    expect(repetirUltimoJato([], () => "x")).toEqual([]);
  });

  it("soma cada produto do dia, na unidade do estoque", () => {
    expect(totaisDosJatos(itens)).toEqual([{ rotulo: "HERBICIDA FOLHA LARGA", texto: "34 L" }, { rotulo: "ADUBO FOLIAR", texto: "24 kg" }]);
  });

  it("o corpo leva o jato em texto só na linha de um jato", () => {
    const corpo = linhasDoCorpoDoRegistro({ maquinas: [], produtos: [item("a", HERB, "10,5", 2), item("b", ADUBO, "3")], mao_obra: [], servicos: [] });
    expect(corpo.produtos).toEqual([
      { produto_id: "p1", local_estoque_id: "l1", quantidade: "10.5", observacao: null, jato: "2" },
      { produto_id: "p2", local_estoque_id: "l1", quantidade: "3", observacao: null },
    ]);
  });

  it("o tanque vem do implemento (da opção ou da linha gravada); sem jato, nada", () => {
    expect(jatoDoImplemento({ jato: { capacidade: "2000", unidade: "L" } })).toEqual(TANQUE);
    expect(jatoDoImplemento({ jato: null })).toBeNull();
    expect(bemEscolhido({ id: 9, nome: "Pulverizador", jato: TANQUE }).jato).toEqual(TANQUE);
    expect("jato" in bemEscolhido({ id: 9, nome: "Roçadeira", jato: null })).toBe(false);
    const f = formularioDaLinhaMaquina({ bem_id: "b1", implemento_bem_id: "i1", implemento: { id: "i1", nome: "Pulverizador", jato: TANQUE } });
    expect(f.implemento.jato).toEqual(TANQUE);
    expect(tanqueDoRegistro([{ form: f }])).toEqual(TANQUE);
    expect(tanqueDoRegistro([], { form: { implemento: { id: "i2" } } })).toBeNull();
    expect(rotuloDoTanque(TANQUE)).toBe("2.000 L");
  });
});

describe("D-PROD-292: o dia já salvo com jatos", () => {
  it("'3 jatos de 2.000 L' e o total de cada produto; cancelada e linha sem jato não contam; sem jato, nada", () => {
    const linhas = [
      { status: "CONFIRMADO", jato: 1, produto_id: "p1", produto: { nome: "HERBICIDA FOLHA LARGA" }, quantidade: "10.0000", unidade: "L" },
      { status: "CONFIRMADO", jato: 2, produto_id: "p1", produto: { nome: "HERBICIDA FOLHA LARGA" }, quantidade: "10.0000", unidade: "L" },
      { status: "CONFIRMADO", jato: 3, produto_id: "p1", produto: { nome: "HERBICIDA FOLHA LARGA" }, quantidade: "14.0000", unidade: "L" },
      { status: "CONFIRMADO", jato: 3, produto_id: "p2", produto: { nome: "ADUBO FOLIAR" }, quantidade: "8.0000", unidade: "KG" },
      { status: "CANCELADO", jato: 4, produto_id: "p1", produto: { nome: "HERBICIDA FOLHA LARGA" }, quantidade: "99.0000", unidade: "L" },
    ];
    const maquinas = [{ implemento: { id: "i1", jato: { capacidade: "2000", unidade: "L" } } }];
    expect(textoDosJatosSalvos(linhas, maquinas)).toBe("3 jatos de 2.000 L · herbicida folha larga 34 L · adubo foliar 8 kg");
    expect(textoDosJatosSalvos(linhas, [])).toBe("3 jatos · herbicida folha larga 34 L · adubo foliar 8 kg");
    expect(textoDosJatosSalvos([{ status: "CONFIRMADO", produto_id: "p1", quantidade: "1" }], maquinas)).toBeNull();
  });
});

describe("D-PROD-293: o jato na linha avulsa", () => {
  it("o tanque vem da máquina do dia ou, sem ela, do último lançamento com implemento por jato; o jato sugerido é o maior do dia", () => {
    const pv = { implemento: { id: "i1", jato: { capacidade: "2000", unidade: "L" } } };
    const dia = { maquinas: [pv], produtos: [{ status: "CONFIRMADO", jato: 1 }, { status: "CONFIRMADO", jato: 3 }, { status: "CANCELADO", jato: 9 }] };
    expect(tanqueEJatoDoDia(dia)).toEqual({ tanque: TANQUE, jatoSugerido: 3 });
    const outros = [
      { data_operacional: "2026-12-01", maquinas: [{ implemento: { id: "r1" } }] },
      { data_operacional: "2026-12-02", maquinas: [pv] },
    ];
    expect(tanqueEJatoDoDia(null, outros)).toEqual({ tanque: TANQUE, jatoSugerido: 1 });
    expect(tanqueEJatoDoDia(null, [])).toEqual({ tanque: null, jatoSugerido: 1 });
  });
});

describe("bloco Jatos de hoje", () => {
  const props = (extra = {}) => ({
    tanque: TANQUE, produtos: [], jatoAberto: null, secaoAberta: null, bloqueado: false,
    onEditar: vi.fn(), onRepetir: vi.fn(), onNovo: vi.fn(), onPronto: vi.fn(), ...extra,
  });

  it("sem jato: só o botão + Jato", () => {
    const p = props();
    render(<JatosDoDia {...p} />);
    expect(screen.getByTestId("jatos-vazio").textContent).toContain("2.000 L");
    expect(screen.queryByTestId("jatos-repetir")).toBeNull();
    fireEvent.click(screen.getByTestId("jatos-novo"));
    expect(p.onNovo).toHaveBeenCalled();
  });

  it("com jatos: cartões, 'igual ao jato', Editar, Repetir, Jato diferente e o total", () => {
    const p = props({ produtos: [item("a", HERB, "10", 1), item("b", HERB, "10", 2), item("c", HERB, "14", 3)] });
    render(<JatosDoDia {...p} />);
    expect(screen.getByTestId("jato-1").textContent).toContain("Jato 1 · 2.000 L");
    expect(screen.getByTestId("jato-1").textContent).toContain("10 L");
    expect(screen.getByTestId("jato-2").textContent).toContain("Jato 2 · igual ao jato 1");
    expect(screen.getByTestId("jato-3").textContent).toContain("14 L");
    expect(screen.getByTestId("jatos-total").textContent).toBe("Hoje: 3 jatos · herbicida folha larga 34 L");
    fireEvent.click(screen.getByTestId("jato-2-editar"));
    expect(p.onEditar).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByTestId("jatos-repetir"));
    expect(p.onRepetir).toHaveBeenCalled();
    expect(screen.getByTestId("jatos-novo").textContent).toBe("+ Jato diferente");
  });

  it("com um jato aberto: o título dele, a seção e Pronto", () => {
    const p = props({ jatoAberto: 4, secaoAberta: <div className="col-span-12" data-testid="secao-do-jato" /> });
    render(<JatosDoDia {...p} />);
    expect(screen.getByText("Jato 4 · o que foi no tanque (2.000 L)")).toBeTruthy();
    expect(screen.getByTestId("secao-do-jato")).toBeTruthy();
    fireEvent.click(screen.getByTestId("jatos-pronto"));
    expect(p.onPronto).toHaveBeenCalled();
  });
});

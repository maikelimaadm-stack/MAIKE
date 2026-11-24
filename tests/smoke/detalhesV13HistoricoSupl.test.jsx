/**
 * Detalhes do Lote v13 — abas Histórico e Suplementação (redesenho aprovado).
 *
 * Prova, com as funções e os componentes REAIS:
 *  H-1. `resumoDoCartao`: o que sobe para o cabeçalho do cartão curto (lote, quantidade
 *       com sinal, peso da pesagem, rota De → Até) e o que continua em linha — nada some;
 *  H-2. `LinhaDoTempo compacto` desenha o cartão curto; sem `compacto` o cartão é o de sempre;
 *  S-1. `reguaDoDesvio`: zona verde 20%–80%, marcador preso às bordas, sem faixa → sem régua;
 *  S-2. `serieEsperadoReal`: um ponto por período FECHADO do cocho, do mais antigo ao mais
 *       novo, só com o que o fechamento guarda; ciclo aberto e outros cochos ficam fora;
 *  S-3. `barraDoFornecimento` e `percentualDoNivel`;
 *  S-4. a régua e o gráfico na tela (com menos de 2 períodos, só o texto).
 * Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import LinhaDoTempo, { resumoDoCartao } from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import {
  MAX_PONTOS_DA_SERIE,
  barraDoFornecimento,
  numerosDoCocho,
  percentualDoNivel,
  reguaDoDesvio,
  serieEsperadoReal,
  suplementacaoDoPasto,
} from "@/components/mapa/detalhes-lote/suplementacaoDoPasto";
import { GraficoEsperadoReal, ReguaDoDesvio } from "@/components/mapa/detalhes-lote/AbaSuplementacao";
import { AREA, HOJE, exemploV12, fechar, lancamento } from "./fixtures/suplementacaoPasto";

afterEach(cleanup);

const linha = (rotulo, valor) => ({ rotulo, valor });

describe("H-1 — resumoDoCartao", () => {
  it("movimentação de entrada: lote, '+N cab' e a rota sobem; nada sobra em linha", () => {
    const r = resumoDoCartao({
      icone: "movimentacao",
      titulo: "Movimentação · entrada",
      linhas: [linha("Lote", "L-1"), linha("Cabeças", "33"), linha("De", "Pasto 04"), linha("Até", "Pasto 07")],
    });
    expect(r.lote).toBe("L-1");
    expect(r.destaque).toEqual({ texto: "+33 cab", tom: "entrada", rotulo: "Entraram 33 cabeças" });
    expect(r.rota).toEqual({ de: "Pasto 04", ate: "Pasto 07" });
    expect(r.resto).toEqual([]);
  });

  it("saída leva o sinal de menos; o peso do registro antigo continua em linha", () => {
    const r = resumoDoCartao({
      icone: "movimentacao",
      titulo: "Movimentação · saída",
      linhas: [linha("Lote", "L-2"), linha("Cabeças", "72"), linha("De", "A"), linha("Até", "B"), linha("Peso médio (kg)", "310,0")],
    });
    expect(r.destaque).toEqual({ texto: "−72 cab", tom: "saida", rotulo: "Saíram 72 cabeças" });
    expect(r.resto).toEqual([linha("Peso médio (kg)", "310,0")]);
  });

  it("pesagem: o peso médio é o destaque; cabeças pesadas e origem ficam em linha", () => {
    const r = resumoDoCartao({
      icone: "pesagem",
      titulo: "Pesagem",
      linhas: [linha("Lote", "L-8"), linha("Cabeças pesadas", "38"), linha("Peso médio (kg)", "449,5"), linha("Origem", "MEDIDO")],
    });
    expect(r.destaque).toEqual({ texto: "449,5 kg", tom: "neutro", rotulo: "Peso médio: 449,5 kg" });
    expect(r.rota).toBeNull();
    expect(r.resto.map((l) => l.rotulo)).toEqual(["Cabeças pesadas", "Origem"]);
  });

  it("manejo com 'Quantidade' → 'N cab' neutro; lote '—' não sobe; suplementação fica inteira em linhas", () => {
    const morte = resumoDoCartao({ icone: "morte", titulo: "Morte", linhas: [linha("Lote", "—"), linha("Quantidade", "1"), linha("Causa", "DOENÇA")] });
    expect(morte.lote).toBeNull();
    expect(morte.destaque).toEqual({ texto: "1 cab", tom: "neutro", rotulo: "Quantidade: 1 cabeças" });
    expect(morte.resto.map((l) => l.rotulo)).toEqual(["Lote", "Causa"]);
    const linhas = [linha("Cocho", "Cocho 07"), linha("Produto", "SAL"), linha("Quantidade (kg)", "400,00")];
    const supl = resumoDoCartao({ icone: "suplementacao", titulo: "Suplementação", linhas });
    expect(supl).toEqual({ lote: null, destaque: null, rota: null, resto: linhas });
  });
});

describe("H-2 — LinhaDoTempo compacto", () => {
  const dias = [
    {
      chave: "2026-11-05",
      rotulo: "05 NOV. 2026",
      cartoes: [
        {
          chave: "c1",
          icone: "movimentacao",
          titulo: "Movimentação · entrada",
          linhas: [linha("Lote", "L-1"), linha("Cabeças", "2"), linha("De", "KM - 06"), linha("Até", "KM - P. 01")],
          acoes: <button type="button">Excluir movimentação</button>,
        },
      ],
    },
  ];

  it("cartão curto: ponto do dia, lote, '+2 cab', rota e o pé de ações", () => {
    render(
      <div className="mk-dp">
        <LinhaDoTempo compacto dias={dias} />
      </div>,
    );
    expect(document.querySelector("ol.mk-dp-tl--curto")).not.toBeNull();
    expect(document.querySelector(".mk-dp-tl__dia").textContent).toBe("05 NOV. 2026");
    expect(document.querySelector(".mk-dp-tl__ponto")).not.toBeNull();
    expect(document.querySelector(".mk-dp-tl__lote").textContent).toBe("Lote: L-1");
    expect(screen.getByLabelText("Entraram 2 cabeças").textContent).toBe("+2 cab");
    expect(document.querySelector(".mk-dp-tl__rota").textContent).toContain("KM - 06");
    expect(document.querySelector(".mk-dp-tl__linhas")).toBeNull();
    expect(screen.getByRole("button", { name: "Excluir movimentação" })).toBeTruthy();
  });

  it("sem `compacto` (cocho, depósito, bebedouro, tarefa): as quatro linhas rótulo/valor de sempre", () => {
    render(
      <div className="mk-dp">
        <LinhaDoTempo dias={dias} />
      </div>,
    );
    expect(document.querySelector(".mk-dp-tl--curto")).toBeNull();
    expect([...document.querySelectorAll("dt")].map((n) => n.textContent)).toEqual(["Lote", "Cabeças", "De", "Até"]);
    expect(document.querySelector(".mk-dp-tl__qtd")).toBeNull();
  });
});

describe("S-1 — reguaDoDesvio", () => {
  it("meta no meio; ±faixa nas bordas da zona verde", () => {
    expect(reguaDoDesvio(0, 20)).toMatchObject({ posicao: 50, inicio: 20, fim: 80, dentro: true, preso: false });
    expect(reguaDoDesvio(20, 20)).toMatchObject({ posicao: 80, dentro: true });
    expect(reguaDoDesvio(-20, 20)).toMatchObject({ posicao: 20, dentro: true });
    expect(reguaDoDesvio(-10, 20).posicao).toBeCloseTo(35, 6);
  });

  it("fora da faixa: marcador na zona vermelha; além da régua fica preso à borda", () => {
    expect(reguaDoDesvio(25, 20)).toMatchObject({ dentro: false, preso: false });
    expect(reguaDoDesvio(25, 20).posicao).toBeCloseTo(87.5, 6);
    expect(reguaDoDesvio(90, 20)).toMatchObject({ posicao: 100, dentro: false, preso: true });
    expect(reguaDoDesvio(-90, 20)).toMatchObject({ posicao: 0, dentro: false, preso: true });
  });

  it("texto para o leitor de tela; sem desvio ou sem faixa não há régua", () => {
    expect(reguaDoDesvio(-0.6, 20).texto).toBe("Desvio de -0,6% em relação à meta; dentro da faixa de ±20%");
    expect(reguaDoDesvio(null, 20)).toBeNull();
    expect(reguaDoDesvio(5, null)).toBeNull();
    expect(reguaDoDesvio(5, 0)).toBeNull();
  });
});

describe("S-2 — serieEsperadoReal", () => {
  /** Período fechado do k07 com a data dada. */
  const fechado = (id, data, extra = {}) =>
    fechar(lancamento(id, "k07", { data_lancamento: data, quantidade_total_kg: 300, ...extra }), { dias: 10, sobraFinal: 60, faixa: 20 });

  it("exemplo do v12: só o período fechado do cocho vira ponto (o ciclo aberto não)", () => {
    const { pontos, eventos } = exemploV12();
    const serie = serieEsperadoReal(eventos, pontos[0]);
    expect(serie.length).toBe(1);
    expect(serie[0]).toMatchObject({ dia: "2026-10-27", rotulo: "27/10" });
    expect(Math.round(serie[0].real)).toBe(75);
    expect(Math.round(serie[0].esperado)).toBe(75);
    // A aba recebe a mesma série dentro dos números do cocho.
    const visao = suplementacaoDoPasto({ suplementacao: { pontos, eventos, hoje: HOJE }, areaId: AREA });
    expect(visao.primeiro.serie).toEqual(serie);
    expect(visao.primeiro.regua).toMatchObject({ dentro: true, faixa: 20 });
  });

  it("ordem do mais antigo ao mais novo, sem outros cochos, no máximo os 8 mais recentes", () => {
    const { pontos } = exemploV12();
    const eventos = [
      fechado("c", "2026-10-10"),
      fechado("a", "2026-08-01"),
      { ...fechado("x", "2026-09-01"), ponto_suplementacao_id: "outro" },
      fechado("b", "2026-09-05"),
      lancamento("aberto", "k07", { data_lancamento: "2026-11-09" }),
    ];
    expect(serieEsperadoReal(eventos, pontos[0]).map((p) => p.rotulo)).toEqual(["01/08", "05/09", "10/10"]);
    const muitos = Array.from({ length: 11 }, (_, i) => fechado(`m${i}`, `2026-0${1 + (i % 9)}-${String(10 + i).padStart(2, "0")}`));
    expect(serieEsperadoReal(muitos, pontos[0]).length).toBe(MAX_PONTOS_DA_SERIE);
    expect(serieEsperadoReal(null, pontos[0])).toEqual([]);
  });
});

describe("S-3 — barra do fornecimento e nível do cocho", () => {
  it("consumido × sobra sobre a base do ciclo; sem base não há barra", () => {
    const b = barraDoFornecimento({ baseCicloKg: 400, consumoEstimadoKg: 140.4, saldoKg: 259.6 });
    expect(b.consumido).toBeCloseTo(35.1, 6);
    expect(b.sobra).toBeCloseTo(64.9, 6);
    expect(b.texto).toBe("Consumido 35% do total fornecido; sobra 65%");
    expect(barraDoFornecimento({ baseCicloKg: null, consumoEstimadoKg: 10, saldoKg: 5 })).toBeNull();
    expect(barraDoFornecimento(null)).toBeNull();
    const { pontos, eventos } = exemploV12();
    const visao = suplementacaoDoPasto({ suplementacao: { pontos, eventos, hoje: HOJE }, areaId: AREA });
    expect(Math.round(visao.primeiro.barra.sobra)).toBe(65);
    expect(numerosDoCocho(visao.cochos[0], { eventos }).barra).toEqual(visao.primeiro.barra);
  });

  it("percentual do nível: fração do ciclo; ícone neutro não tem barra", () => {
    expect(percentualDoNivel({ neutro: false, fracaoCiclo: 0.649 })).toBeCloseTo(64.9, 6);
    expect(percentualDoNivel({ neutro: false, fracaoCiclo: 1.4 })).toBe(100);
    expect(percentualDoNivel({ neutro: true, fracaoCiclo: 0.5 })).toBeNull();
    expect(percentualDoNivel(null)).toBeNull();
  });
});

describe("S-4 — régua e gráfico na tela", () => {
  it("régua: imagem com o texto do desvio, zona verde e marcador na posição", () => {
    render(<ReguaDoDesvio regua={reguaDoDesvio(-10, 20)} />);
    const regua = screen.getByRole("img", { name: "Desvio de -10,0% em relação à meta; dentro da faixa de ±20%" });
    expect(regua.querySelector(".mk-dp-supl-regua__zona").style.left).toBe("20%");
    expect(regua.querySelector(".mk-dp-supl-regua__zona").style.width).toBe("60%");
    expect(regua.querySelector(".mk-dp-supl-regua__marca").style.left).toBe("35%");
    expect(regua.textContent).toBe("-20%meta+20%");
  });

  it("gráfico: menos de 2 períodos → só o texto; com 2+ → as duas linhas e a lista para o leitor de tela", () => {
    const { rerender } = render(<GraficoEsperadoReal serie={[{ chave: "a", dia: "2026-10-27", rotulo: "27/10", real: 75, esperado: 75 }]} />);
    expect(screen.getByText("Ainda sem períodos fechados para comparar.")).toBeTruthy();
    expect(document.querySelector("svg")).toBeNull();
    rerender(
      <GraficoEsperadoReal
        serie={[
          { chave: "a", dia: "2026-10-01", rotulo: "01/10", real: 68, esperado: 75 },
          { chave: "b", dia: "2026-10-14", rotulo: "14/10", real: 81, esperado: 75 },
          { chave: "c", dia: "2026-10-27", rotulo: "27/10", real: 74, esperado: null },
        ]}
      />,
    );
    expect(screen.getByText("Esperado × real (g/cab/dia)")).toBeTruthy();
    expect(document.querySelectorAll("svg polyline").length).toBe(2);
    expect(document.querySelectorAll("svg circle").length).toBe(3);
    expect([...document.querySelectorAll(".mk-dp-supl-graf__dados li")].map((n) => n.textContent)).toEqual([
      "01/10: real 68 g, esperado 75 g",
      "14/10: real 81 g, esperado 75 g",
      "27/10: real 74 g",
    ]);
  });
});

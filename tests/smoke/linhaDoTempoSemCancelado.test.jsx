// @vitest-environment jsdom
/**
 * No Mapa Geral só há EXCLUSÃO ("Olha eu não tenho cancelamentos eu tenho exclusão ok"):
 * a `LinhaDoTempo` não desenha chip "Cancelado" nem a marca `.is-cancelado`, mesmo que
 * um cartão ainda chegue com `cancelado: true`. O resto do cartão (título, linhas e
 * pé com ações) continua igual. Dados sintéticos.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";

afterEach(() => cleanup());

const dias = [
  {
    chave: "2026-11-09",
    rotulo: "09 NOV. 2026",
    cartoes: [
      { chave: "a", icone: "movimentacao", titulo: "Entrada", cancelado: true, linhas: [{ rotulo: "Lote", valor: "L-1" }] },
      { chave: "b", icone: "pesagem", titulo: "Pesagem", linhas: [{ rotulo: "Peso médio", valor: "300" }], acoes: <button type="button">Excluir pesagem</button> },
    ],
  },
];

describe("LinhaDoTempo — sem cancelamento na tela", () => {
  it("cartão marcado `cancelado` não ganha chip nem classe de cancelado; o texto não fala em cancelar/estornar", () => {
    const { container } = render(<LinhaDoTempo dias={dias} />);
    expect(screen.queryByText("Cancelado")).toBeNull();
    expect(container.querySelector(".is-cancelado")).toBeNull();
    expect(container.querySelector(".mk-dp-tl__chip")).toBeNull();
    expect(container.textContent).not.toMatch(/cancel|estorn/i);
  });

  it("o resto do cartão fica como antes: título, linhas e o pé com a ação", () => {
    const { container } = render(<LinhaDoTempo dias={dias} />);
    expect(container.querySelectorAll(".mk-dp-tl__card")).toHaveLength(2);
    expect(screen.getByText("Entrada")).toBeTruthy();
    expect(screen.getByText("L-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Excluir pesagem" })).toBeTruthy();
    expect(container.querySelectorAll(".mk-dp-tl__acoes")).toHaveLength(1);
  });
});

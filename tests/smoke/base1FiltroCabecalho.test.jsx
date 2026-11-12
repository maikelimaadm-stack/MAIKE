/**
 * D-PROD-166 — o filtro do cabeçalho da coluna é a MESMA janela do filtro das pílulas da faixa: pesquisa com
 * "Condição ⌄", "Todos" e os valores com ✓ e a contagem; rodapé ✕ · "N de M" · ✓; tudo rascunho até o ✓.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import CadastroColunaFiltro from "@/components/cadastro/base1/CadastroColunaFiltro";
import { ContagemNomesContext } from "@/components/cadastro/base1/FiltrosRapidos";
import { nomesDaContagem } from "@/components/cadastro/base1/contagemBase1";

afterEach(() => cleanup());

const VALORES = ["Macho", "Fêmea", "Macho", "Misto", "Fêmea", "Macho"];

function abrir(extra = {}) {
  const onAplicar = vi.fn();
  const onFechar = vi.fn();
  render(
    <ContagemNomesContext.Provider value={nomesDaContagem(undefined, { um: "lote", varios: "lotes" })}>
      <table>
        <thead>
          <tr>
            <th>
              Sexo <button type="button" data-b1-col-menu="sexo" aria-label="Abrir menu da coluna Sexo" />
            </th>
          </tr>
        </thead>
      </table>
      <CadastroColunaFiltro
        rotulo="Sexo"
        tipo="texto"
        ancora='[data-b1-col-menu="sexo"]'
        valores={VALORES}
        totais={10}
        atual={null}
        onAplicar={onAplicar}
        onFechar={onFechar}
        {...extra}
      />
    </ContagemNomesContext.Provider>,
  );
  return { onAplicar, onFechar, janela: screen.getByRole("dialog", { name: "Filtrar coluna Sexo" }) };
}

describe("filtro do cabeçalho = janela do filtro da faixa", () => {
  it("mesma janela: classes da faixa, pesquisa com Condição, Todos, valores com contagem e rodapé ✕ · contagem · ✓", () => {
    const { janela } = abrir();
    expect(janela).toHaveClass("mk-sel-pop", "b1-lista-pop", "b1-fr-pop", "b1-col-pop");
    expect(screen.getByRole("textbox", { name: "Pesquisar" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Condição" })).toBeInTheDocument();
    const opcoes = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opcoes).toEqual(["Todos", "Fêmea2", "Macho3", "Misto1"]);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeInTheDocument();
    expect(janela.querySelector(".b1-fr-acoes__conta")).toHaveTextContent("6 de 10 lotes");
    // o desenho antigo saiu
    expect(screen.queryByText(/Selecionar Tudo/)).toBeNull();
    expect(screen.queryByText(/Limpar filtro de/)).toBeNull();
  });

  it("marcar é rascunho (a contagem mostra a prévia); ✓ aplica só os marcados", () => {
    const { onAplicar, janela } = abrir();
    fireEvent.click(screen.getByRole("option", { name: /Macho/ }));
    expect(onAplicar).not.toHaveBeenCalled();
    expect(janela.querySelector(".b1-fr-acoes__conta")).toHaveTextContent("3 de 10 lotes");
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    const filtro = onAplicar.mock.calls[0][0];
    expect([...filtro.valores]).toEqual(["Macho"]);
    expect(filtro.op).toBe("");
  });

  it("com filtro aplicado, reabre marcado; Todos + ✓ tira o filtro (null)", () => {
    const { onAplicar } = abrir({ atual: { op: "", v1: "", v2: "", valores: new Set(["Fêmea"]) } });
    expect(screen.getByRole("option", { name: /Fêmea/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("option", { name: "Todos" }));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(onAplicar).toHaveBeenCalledWith(null);
  });

  it("✕ e Esc fecham sem aplicar", () => {
    const { onAplicar, onFechar } = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onFechar).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onFechar).toHaveBeenCalledTimes(2);
    expect(onAplicar).not.toHaveBeenCalled();
  });
});

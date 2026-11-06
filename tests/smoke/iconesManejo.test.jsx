// @vitest-environment jsdom
/** D-PROD-131 — "Saída" (antigo Abate), "Mover", "Pesar", "Nascimento", "Morte", "Juntar Lotes", "Mudar Categoria" e "Editar Informação" (antigo Renomear Lote) usam as imagens do proprietário. */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import AcoesDoLote from "@/components/mapa/AcoesDoLote";
import { IconeEditarInformacao, IconeHistoricoMovimentacao, IconeHistoricoSuplementacao, IconeJuntarLotes, IconeMorte, IconeMoverAnimais, IconeMudarCategoria, IconeNascimento, IconePesar, IconeSaida } from "@/components/mapa/IconesManejo";

afterEach(cleanup);

describe("Ícones em imagem dos manejos (D-PROD-131)", () => {
  it("imagens existem e o Detalhes do Lote usa nos quadros Saída, Mover, Pesar, Nascimento, Morte, Juntar Lotes, Mudar Categoria e Editar Informação", () => {
    expect(existsSync("public/icons/mover-animais.png")).toBe(true);
    expect(existsSync("public/icons/pesar.png")).toBe(true);
    expect(existsSync("public/icons/nascimento.png")).toBe(true);
    expect(existsSync("public/icons/saida.png")).toBe(true);
    expect(existsSync("public/icons/morte.png")).toBe(true);
    expect(existsSync("public/icons/juntar-lotes.png")).toBe(true);
    expect(existsSync("public/icons/mudar-categoria.png")).toBe(true);
    expect(existsSync("public/icons/editar-informacao.png")).toBe(true);
    expect(existsSync("public/icons/historico-movimentacao.png")).toBe(true);
    expect(existsSync("public/icons/historico-suplementacao.png")).toBe(true);
    const dl = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");
    expect(dl).toMatch(/rotulo: 'Histórico de Movimentação', Icone: IconeHistoricoMovimentacao/);
    expect(dl).toMatch(/rotulo: 'Histórico de Suplementação', Icone: IconeHistoricoSuplementacao/);
    expect(dl).not.toMatch(/from "lucide-react"/);
    expect(dl).toMatch(/nome: 'Mover', Icone: IconeMoverAnimais/);
    expect(dl).toMatch(/nome: 'Pesar', Icone: IconePesar/);
    expect(dl).toMatch(/nome: 'Nascimento', Icone: IconeNascimento/);
    expect(dl).toMatch(/nome: 'Saída', Icone: IconeSaida, onClick: \(\) => abrirManejo\(setShowAbate\)/);
    expect(dl).toMatch(/titulo="Registrar Saída"/);
    expect(dl).toMatch(/nome: 'Morte', Icone: IconeMorte/);
    expect(dl).toMatch(/nome: 'Juntar Lotes', Icone: IconeJuntarLotes/);
    expect(dl).toMatch(/nome: 'Mudar Categoria', Icone: IconeMudarCategoria/);
    expect(dl).toMatch(/nome: 'Editar Informação', Icone: IconeEditarInformacao, onClick: abrirRenomear/);
    expect(dl).toMatch(/titulo="Editar Informação"/);
    expect(dl).not.toMatch(/nome: 'Abate'|ArrowLeftRight|\bScale\b|\bBaby\b|\bBeef\b|HeartCrack|\bCombine\b|\bTags\b|PencilLine|nome: 'Renomear Lote'/);
  });

  it("aparecem no quadro, com o nome, sem descer a linha", () => {
    render(
      <AcoesDoLote grupos={[{ titulo: "Manejos", itens: [
        { nome: "Mover", Icone: IconeMoverAnimais, onClick: () => {} },
        { nome: "Histórico de Movimentação", Icone: IconeHistoricoMovimentacao, onClick: () => {} },
        { nome: "Histórico de Suplementação", Icone: IconeHistoricoSuplementacao, onClick: () => {} },
        { nome: "Pesar", Icone: IconePesar, onClick: () => {} },
        { nome: "Nascimento", Icone: IconeNascimento, onClick: () => {} },
        { nome: "Saída", Icone: IconeSaida, onClick: () => {} },
        { nome: "Morte", Icone: IconeMorte, onClick: () => {} },
        { nome: "Juntar Lotes", Icone: IconeJuntarLotes, onClick: () => {} },
        { nome: "Mudar Categoria", Icone: IconeMudarCategoria, onClick: () => {} },
        { nome: "Editar Informação", Icone: IconeEditarInformacao, onClick: () => {} },
      ] }]} />,
    );
    expect(screen.getByRole("button", { name: "Mover" }).querySelector("svg.mk-al__img")?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(screen.getByRole("button", { name: "Pesar" }).querySelector("svg.mk-al__img")?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(screen.getByRole("button", { name: "Nascimento" }).querySelector("svg.mk-al__img")?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(screen.getByRole("button", { name: "Saída" }).querySelector("svg.mk-al__img")?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(screen.getByRole("button", { name: "Morte" }).querySelector("svg.mk-al__img")?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(screen.getByRole("button", { name: "Juntar Lotes" }).querySelector("svg.mk-al__img")?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(screen.getByRole("button", { name: "Mudar Categoria" }).querySelector("svg.mk-al__img")?.getAttribute("viewBox")).toBe("0 0 64 64");
    expect(screen.getByRole("button", { name: "Editar Informação" }).querySelector("svg.mk-al__img")?.getAttribute("viewBox")).toBe("0 0 64 64");
    for (const name of ["Histórico de Movimentação", "Histórico de Suplementação"]) {
      const icon = screen.getByRole("button", { name }).querySelector("svg.mk-al__img");
      expect(icon?.getAttribute("viewBox")).toBe("0 0 90 70");
      expect(icon?.querySelector("circle")).not.toBeNull();
    }
    const css = readFileSync("src/styles/lancamento-lote.css", "utf8");
    expect(css).toMatch(/\.mk-al__quadro \.mk-al__img \{[^}]*display: block;[^}]*height: 32px;/);
    expect(css).toMatch(/\.mk-al--embaixo \.mk-al__quadro \.mk-al__img \{[^}]*height: 30px;[^}]*margin: -9px 0 -2px;/);
  });
  it("ordena os botões e mantém Juntar Lotes visível, sem executar quando desabilitado", () => {
    const juntar = vi.fn();
    const pesar = vi.fn();
    render(<AcoesDoLote grupos={[{ titulo: "Manejos", itens: [
      { nome: "Pesar", Icone: IconePesar, onClick: pesar },
      { nome: "Juntar Lotes", Icone: IconeJuntarLotes, onClick: juntar, disabled: true, motivoBloqueio: "Dois lotes da mesma categoria são necessários." },
      { nome: "Editar Informação", Icone: IconeEditarInformacao, onClick: () => {} },
    ] }]} />);
    expect([...document.querySelectorAll(".mk-al__quadro")].map(b => b.textContent)).toEqual(["Editar Informação", "Juntar Lotes", "Pesar"]);
    const button = screen.getByRole("button", { name: "Juntar Lotes" });
    expect(button.disabled).toBe(true);
    button.click();
    expect(juntar).not.toHaveBeenCalled();
    screen.getByRole("button", { name: "Pesar" }).click();
    expect(pesar).toHaveBeenCalledTimes(1);
  });

});

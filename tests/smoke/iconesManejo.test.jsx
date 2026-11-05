// @vitest-environment jsdom
/** D-PROD-131 — "Mover" e "Pesar" usam as imagens do proprietário. */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import AcoesDoLote from "@/components/mapa/AcoesDoLote";
import { IconeMoverAnimais, IconePesar } from "@/components/mapa/IconesManejo";

afterEach(cleanup);

describe("Ícones em imagem dos manejos (D-PROD-131)", () => {
  it("imagens existem e o Detalhes do Lote usa nos quadros Mover e Pesar", () => {
    expect(existsSync("public/icons/mover-animais.png")).toBe(true);
    expect(existsSync("public/icons/pesar.png")).toBe(true);
    const dl = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");
    expect(dl).toMatch(/nome: 'Mover', Icone: IconeMoverAnimais/);
    expect(dl).toMatch(/nome: 'Pesar', Icone: IconePesar/);
    expect(dl).not.toMatch(/ArrowLeftRight|\bScale\b/);
  });

  it("aparecem no quadro, com o nome, sem descer a linha", () => {
    render(
      <AcoesDoLote grupos={[{ titulo: "Manejos", itens: [
        { nome: "Mover", Icone: IconeMoverAnimais, onClick: () => {} },
        { nome: "Pesar", Icone: IconePesar, onClick: () => {} },
      ] }]} />,
    );
    expect(screen.getByRole("button", { name: "Mover" }).querySelector("img")?.getAttribute("src")).toBe("/icons/mover-animais.png");
    expect(screen.getByRole("button", { name: "Pesar" }).querySelector("img")?.getAttribute("src")).toBe("/icons/pesar.png");
    const css = readFileSync("src/styles/lancamento-lote.css", "utf8");
    expect(css).toMatch(/\.mk-al__quadro \.mk-al__img \{[^}]*display: block;[^}]*height: 32px;/);
    expect(css).toMatch(/\.mk-al--embaixo \.mk-al__quadro \.mk-al__img \{[^}]*height: 30px;[^}]*margin: -9px 0 -2px;/);
  });
});

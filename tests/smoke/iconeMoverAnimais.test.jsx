// @vitest-environment jsdom
/** D-PROD-131 — o manejo "Mover" usa a imagem do proprietário (boi entre porteiras). */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import AcoesDoLote from "@/components/mapa/AcoesDoLote";
import IconeMoverAnimais from "@/components/mapa/IconeMoverAnimais";

afterEach(cleanup);

describe("Ícone do Mover animais (D-PROD-131)", () => {
  it("imagem existe e o Detalhes do Lote usa o ícone no Mover", () => {
    expect(existsSync("public/icons/mover-animais.png")).toBe(true);
    const dl = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");
    expect(dl).toMatch(/nome: 'Mover', Icone: IconeMoverAnimais/);
    expect(dl).not.toMatch(/ArrowLeftRight/);
  });

  it("aparece no quadro com o nome Mover, na mesma altura dos outros ícones", () => {
    render(<AcoesDoLote grupos={[{ titulo: "Manejos", itens: [{ nome: "Mover", Icone: IconeMoverAnimais, onClick: () => {} }] }]} />);
    const img = screen.getByRole("button", { name: "Mover" }).querySelector("img");
    expect(img?.getAttribute("src")).toBe("/icons/mover-animais.png");
    const css = readFileSync("src/styles/lancamento-lote.css", "utf8");
    expect(css).toMatch(/\.mk-al__quadro \.mk-al__img \{[^}]*display: block;[^}]*height: 24px;/);
  });
});

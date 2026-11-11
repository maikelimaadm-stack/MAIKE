/**
 * D-PROD-170 — janela do motor Base1 sobre o Radix Dialog (`B1Janela`): o desenho de "Configurar colunas"
 * (`b1ref .mdlc`), com título e ✕ no cabeçalho, corpo e rodapé com os botões do motor; leva `cadastro-b1` (o
 * portal fica fora da tela) e centraliza sem `transform` (a folha do celular aberta dentro ocupa a tela).
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import B1Janela from "@/components/cadastro/base1/B1Janela";

afterEach(() => cleanup());

const abrir = (extra = {}) => {
  const onFechar = vi.fn();
  render(
    <B1Janela aberto onFechar={onFechar} titulo="Gerenciar tipos" descricao="Texto de apoio" testId="janela" rodape={<button type="button">Confirmar</button>} {...extra}>
      <p>corpo</p>
    </B1Janela>,
  );
  return { onFechar, camada: screen.getByTestId("janela") };
};

describe("B1Janela", () => {
  it("desenho do motor: camada b1ref cadastro-b1 sem transform; cartão mdlc com cabeçalho, corpo e rodapé", () => {
    const { camada } = abrir();
    expect(camada).toHaveClass("b1ref", "cadastro-b1", "b1-janela__camada");
    expect(camada.className).not.toMatch(/translate|-50%/);
    const cartao = camada.querySelector(".mdlc.b1-janela");
    expect(cartao?.querySelector(".mdl-h .mdl-t")).toHaveTextContent("Gerenciar tipos");
    expect(cartao?.querySelector(".mdl-b")).toHaveTextContent("Texto de apoio");
    expect(cartao?.querySelector(".mdl-b")).toHaveTextContent("corpo");
    expect(cartao?.querySelector(".mdl-f")).toHaveTextContent("Confirmar");
    expect(document.querySelector(".b1-janela__fundo")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Gerenciar tipos" })).toBe(camada);
  });

  it("o ✕ (Fechar) e o Escape fecham", () => {
    const { onFechar } = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onFechar).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(onFechar).toHaveBeenCalledTimes(2);
  });

  it("podeFechar falso (enviando): ✕ travado e o Escape não fecha", () => {
    const { onFechar } = abrir({ podeFechar: false });
    expect(screen.getByRole("button", { name: "Fechar" })).toBeDisabled();
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    expect(onFechar).not.toHaveBeenCalled();
  });

  it("aoPedirFechar falso (folha aberta dentro): o pedido é ignorado", () => {
    const { onFechar } = abrir({ aoPedirFechar: () => false });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onFechar).not.toHaveBeenCalled();
  });

  it("sem rodapé não desenha a faixa de baixo; sem descrição não pede aria-describedby", () => {
    const { camada } = abrir({ rodape: null, descricao: null });
    expect(camada.querySelector(".mdl-f")).toBeNull();
    expect(camada).not.toHaveAttribute("aria-describedby");
  });

  it("CSS: fundo quente, cartão sob medida e corpo que rola", () => {
    const css = readFileSync(join(process.cwd(), "src/styles/base1-design-ajustes.css"), "utf8");
    expect(css).toMatch(/\.b1-janela__fundo \{\s*background: rgba\(20, 20, 19, 0\.34\);/);
    expect(css).toMatch(/\.b1ref \.mdlc\.b1-janela:not\(#mk-a\) \{[^}]*height: auto;[^}]*max-height: min\(86vh, 720px\);/);
    expect(css).toMatch(/\.b1ref \.b1-janela__corpo:not\(#mk-a\) \{[^}]*overflow-y: auto;/);
  });
});

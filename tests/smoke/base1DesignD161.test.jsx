/**
 * D-PROD-161 — acabamento do design "Cadastro de Lote" no motor Base1.
 */
import React from "react";
import fs from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";
import B1Field from "@/components/cadastro/base1/B1Field";

const TABS = [
  { id: "geral", label: "Geral" },
  { id: "compra", label: "Motivo" },
];

const Abas = ({ comErro = false }) => (
  <div className="cadastro-b1">
    <Base1PanelTabs
      tabs={TABS}
      value="geral"
      onChange={() => {}}
      renderPanel={(id) =>
        id === "compra" && comErro ? (
          <B1Field label="Fornecedor" error>
            <input />
          </B1Field>
        ) : (
          <div data-testid={`painel-${id}`}>conteúdo {id}</div>
        )
      }
    />
  </div>
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("D-PROD-161 — abas e campo", () => {
  it("desktop: abas em pílula e cartão com o nome da aba", () => {
    const { container } = render(<Abas />);
    expect(container.querySelector(".b1-abas-fora")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(container.querySelector(".b1-aba-cartao__titulo").textContent).toBe("Geral");
  });

  it("abaixo de 1024px: sem abas, cada painel vira uma seção visível", () => {
    vi.stubGlobal("matchMedia", (consulta) => ({
      matches: consulta === "(max-width: 1023px)",
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container } = render(<Abas />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(container.querySelectorAll(".b1-secao")).toHaveLength(2);
    expect(screen.getByTestId("painel-geral")).toBeVisible();
    expect(screen.getByTestId("painel-compra")).toBeVisible();
  });

  it("aba com campo inválido ganha o ponto, sem mudar o nome acessível", () => {
    const { container } = render(<Abas comErro />);
    expect(screen.getByRole("tab", { name: "Motivo" }).querySelector(".b1-aba-dot")).toBeTruthy();
    expect(container.querySelectorAll(".b1-aba-dot")).toHaveLength(1);
  });

  it("erro booleano mostra 'Campo obrigatório', não 'true'", () => {
    render(
      <B1Field label="Nome" error="true">
        <input />
      </B1Field>,
    );
    expect(screen.getByRole("alert").textContent).toBe("Campo obrigatório");
  });

  it("a camada do design não define tamanho de fonte e carrega antes da tipografia", () => {
    const css = fs.readFileSync("src/styles/base1-design.css", "utf8");
    expect(css).not.toMatch(/font-size\s*:/);
    const indice = fs.readFileSync("src/index.css", "utf8");
    expect(indice.indexOf("base1-design.css")).toBeGreaterThan(-1);
    expect(indice.indexOf("base1-design.css")).toBeLessThan(indice.indexOf("base1-tipografia.css"));
  });
});

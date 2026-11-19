/**
 * MOTORBASE1-TABS-01 — Base1PanelTabs (paridade PanelTabs).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";

const TABS = [
  { id: "geral", label: "Geral" },
  { id: "compra", label: "Motivo" },
  { id: "observacoes", label: "Observações" },
];

function Harness({ initial = "geral", preferenceKey = "test_b1_panel_style" }) {
  const [value, setValue] = React.useState(initial);
  return (
    <div className="cadastro-b1">
      <Base1PanelTabs
        tabs={TABS}
        value={value}
        onChange={setValue}
        preferenceKey={preferenceKey}
        renderPanel={(id) => <div data-testid={`panel-${id}`}>conteúdo {id}</div>}
      />
    </div>
  );
}

beforeEach(() => {
  localStorage.removeItem("test_b1_panel_style");
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("test_b1_panel_style");
});

describe("Base1PanelTabs", () => {
  it("marca aba ativa com aria-selected e exibe painel correspondente", () => {
    render(<Harness />);
    const geral = screen.getByRole("tab", { name: "Geral" });
    expect(geral.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("panel-geral")).toBeVisible();
    expect(screen.getByTestId("panel-compra")).not.toBeVisible();
  });

  it("troca aba por clique", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Motivo" }));
    expect(screen.getByRole("tab", { name: "Motivo" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("panel-compra")).toBeVisible();
  });

  it("navega por teclado (ArrowRight)", () => {
    render(<Harness />);
    const geral = screen.getByRole("tab", { name: "Geral" });
    geral.focus();
    fireEvent.keyDown(geral, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Motivo" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Motivo" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Geral" }).getAttribute("aria-selected")).toBe("true");
  });

  it("guias verticais: navega por teclado (ArrowDown / ArrowUp)", () => {
    render(<Harness />);
    const geral = screen.getByRole("tab", { name: "Geral" });
    geral.focus();
    fireEvent.keyDown(geral, { key: "ArrowDown" });
    const motivo = screen.getByRole("tab", { name: "Motivo" });
    expect(motivo.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(motivo);
    fireEvent.keyDown(motivo, { key: "ArrowDown" });
    expect(screen.getByRole("tab", { name: "Observações" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Observações" }), { key: "ArrowUp" });
    expect(screen.getByRole("tab", { name: "Motivo" }).getAttribute("aria-selected")).toBe("true");
  });

  // Guias laterais (PR #339) substituem as abas horizontais da D-PROD-164; segue sem o
  // botão de alternar "lista lateral / abas horizontais", mesmo com preferência antiga salva.
  it("guias laterais (verticais), sem alternador de lista — mesmo com preferência antiga salva", () => {
    localStorage.setItem("test_b1_panel_style", "sidebar");
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /lista lateral|abas horizontais/i })).toBeNull();
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("vertical");
  });

  it("\"Buscar guia\" filtra as guias pelo nome (sem acento) e recolher esconde a lista", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar guia" }), { target: { value: "observacoes" } });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Observações"]);
    fireEvent.click(screen.getByRole("button", { name: "Recolher guias" }));
    expect(screen.queryByRole("tablist")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expandir guias" }));
    expect(screen.getByRole("tablist")).toBeTruthy();
  });

  it("envio recusado: abre a guia com o primeiro campo inválido (o campo não fica escondido)", () => {
    function FormComErro() {
      const [value, setValue] = React.useState("geral");
      const [tentou, setTentou] = React.useState(false);
      return (
        <form onSubmit={(e) => { e.preventDefault(); setTentou(true); }}>
          <Base1PanelTabs
            tabs={TABS}
            value={value}
            onChange={setValue}
            renderPanel={(id) =>
              id === "observacoes" ? <div className={tentou ? "mg-field is-invalid" : "mg-field"}>obs</div> : <div>{id}</div>
            }
          />
          <button type="submit">Salvar</button>
        </form>
      );
    }
    render(<FormComErro />);
    expect(screen.getByRole("tab", { name: "Geral" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByRole("tab", { name: "Observações" }).getAttribute("aria-selected")).toBe("true");
  });

  it("tolera storage inválido", () => {
    localStorage.setItem("test_b1_panel_style", "{corrupt");
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Geral" })).toBeTruthy();
  });

  it("corrigie value inválido para primeira aba habilitada", () => {
    function Controlled() {
      const [value, setValue] = React.useState("inexistente");
      return (
        <div className="cadastro-b1">
          <Base1PanelTabs
            tabs={TABS}
            value={value}
            onChange={setValue}
            renderPanel={(id) => <div data-testid={`panel-${id}`} />}
          />
        </div>
      );
    }
    render(<Controlled />);
    expect(screen.getByRole("tab", { name: "Geral" }).getAttribute("aria-selected")).toBe("true");
  });
});

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
  });

  it("só abas, sem lista lateral — mesmo com preferência antiga salva (D-PROD-164)", () => {
    localStorage.setItem("test_b1_panel_style", "sidebar");
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /lista lateral|abas horizontais/i })).toBeNull();
    expect(screen.getByRole("tablist").getAttribute("aria-orientation")).toBe("horizontal");
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

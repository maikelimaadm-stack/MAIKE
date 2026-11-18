// @vitest-environment jsdom
/**
 * D-PROD-222 — o campo de escolha dos manejos (`B1Select`) se escolhe pelo teclado no desktop/tablet também
 * com até 8 opções (sem a caixa de pesquisa): Enter abre, ↑/↓ andam pela lista e Enter escolhe, com o foco
 * no campo — como o AutocompleteGenerico (o campo repassa as teclas ao painel). Antes, ↑/↓ e Enter não
 * faziam nada com a lista aberta; o Lançar do cocho (Formulação), a Entrada/Saída do depósito (Produto,
 * Unidade) e o Lançar do bebedouro (Tipo, Status, Qualidade) passaram a usar este campo.
 */
import React from "react";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const { default: B1Select } = await import("@/components/cadastro/base1/B1Select");

const original = window.matchMedia;
beforeEach(() => {
  // Desktop: nenhuma consulta de largura máxima bate (não é celular).
  window.matchMedia = /** @type {any} */ ((q) => ({ matches: !/max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
});
afterEach(() => {
  cleanup();
  window.matchMedia = original;
});

function Campo({ inicial = "Concluído" }) {
  const [valor, setValor] = React.useState(inicial);
  return (
    <B1Select aria-label="Status" value={valor} onChange={(e) => setValor(e.target.value)}>
      <option value="Pendente">Pendente</option>
      <option value="Concluído">Concluído</option>
      <option value="Emergencial">Emergencial</option>
    </B1Select>
  );
}

const tecla = (el, key) => act(async () => { fireEvent.keyDown(el, { key }); });

describe("B1Select pelo teclado, sem pesquisa (D-PROD-222)", () => {
  it("Enter abre; ↓ e Enter escolhem a próxima opção; o foco continua no campo", async () => {
    render(<Campo />);
    const campo = screen.getByRole("combobox", { name: "Status" });
    campo.focus();
    await tecla(campo, "Enter");
    const lista = screen.getByRole("listbox", { name: "Status" });
    expect(lista.querySelector("input")).toBeNull(); // 3 opções: sem caixa de pesquisa
    expect(document.activeElement).toBe(campo);
    await tecla(campo, "ArrowDown");
    await tecla(campo, "Enter");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(campo).toHaveTextContent("Emergencial");
    expect(document.activeElement).toBe(campo);
  });

  it("↑ volta na lista; Enter escolhe a opção destacada", async () => {
    render(<Campo />);
    const campo = screen.getByRole("combobox", { name: "Status" });
    campo.focus();
    await tecla(campo, "ArrowDown"); // ↓ também abre
    expect(screen.getByRole("listbox")).toBeTruthy();
    await tecla(campo, "ArrowUp");
    await tecla(campo, "Enter");
    expect(campo).toHaveTextContent("Pendente");
  });
});

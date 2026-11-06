import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfiguracaoLayoutCardsB1Dialog } from "@/components/cadastro/base1/ConfiguracaoCardsB1Dialogs";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function abrir(celular) {
  vi.stubGlobal("matchMedia", (query) => ({
    matches: query.includes("max-width: 639px") && celular,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const onAplicar = vi.fn();
  const onRestaurar = vi.fn();
  const onFechar = vi.fn();
  render(<ConfiguracaoLayoutCardsB1Dialog open value={4} onAplicar={onAplicar} onRestaurar={onRestaurar} onFechar={onFechar} />);
  const confirmar = () => fireEvent.click(screen.getByRole("button", { name: celular ? "Aplicar" : "Pronto", exact: true }));
  return { onAplicar, onRestaurar, onFechar, confirmar };
}

describe.each([false, true])("configuração de cards — mobile=%s", (celular) => {
  it("aplica a opção escolhida somente ao confirmar", () => {
    const { onAplicar, confirmar } = abrir(celular);
    fireEvent.click(screen.getByRole("radio", { name: /2 cards por linha/ }));
    expect(onAplicar).not.toHaveBeenCalled();
    confirmar();
    expect(onAplicar).toHaveBeenCalledWith(2);
  });
  it("fechar descarta o rascunho", async () => {
    const { onAplicar, onRestaurar, onFechar } = abrir(celular);
    fireEvent.click(screen.getByRole("radio", { name: /2 cards por linha/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fechar", exact: true }));
    await waitFor(() => expect(onFechar).toHaveBeenCalled());
    expect(onAplicar).not.toHaveBeenCalled();
    expect(onRestaurar).not.toHaveBeenCalled();
  });
  it("restaurar padrão permanece em rascunho até confirmar", () => {
    const { onAplicar, onRestaurar, confirmar } = abrir(celular);
    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão", exact: true }));
    expect(onRestaurar).not.toHaveBeenCalled();
    confirmar();
    expect(onRestaurar).toHaveBeenCalledTimes(1);
    expect(onAplicar).not.toHaveBeenCalled();
  });
});

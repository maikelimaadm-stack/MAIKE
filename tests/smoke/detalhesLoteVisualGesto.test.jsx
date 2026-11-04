// @vitest-environment jsdom
/**
 * D-PROD-120 — Detalhes do Lote sem "Alertas do lote", nomes de área/lote na
 * cor dos botões (verde), e o deslizar da borda esquerda fecha a janela de cima
 * no celular (lançamentos, históricos, detalhes e folhas).
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { Scale } from "lucide-react";
import AcoesDoLote from "@/components/mapa/AcoesDoLote";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { readFileSync } from "node:fs";
import { useDeslizarParaFechar } from "@/hooks/useDeslizarParaVoltar";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const detalhes = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");
const area = readFileSync("src/components/mapa/InformacoesArea.jsx", "utf8");
const css = readFileSync("src/styles/lancamento-lote.css", "utf8");

describe("Detalhes do Lote: visual (D-PROD-120)", () => {
  it("sem os alertas do lote", () => {
    expect(detalhes).not.toMatch(/Alertas do lote|lote\.alertas/);
  });

  it("nomes de área e lote em verde (cor dos botões), sem o amarelo", () => {
    expect(detalhes).toMatch(/className="mk-dl__nome">Lote: \{lote\.nome\}/);
    expect(area).toMatch(/className="mk-dl__nome">Informações da Área: \{area\.nome\}/);
    for (const f of [detalhes, area]) expect(f).not.toMatch(/yellow|amber/);
    expect(css).toMatch(/\.mk-dl__nome \{[^}]*background: var\(--mg-accent, #40de63\);[^}]*color: #fff;/);
  });
});

describe("Celular: botão de manejos no alto, à direita do título (D-PROD-120)", () => {
  it("fica no cabeçalho do diálogo (espelho do ✕) e abre a folha", () => {
    window.matchMedia = /** @type {any} */ ((q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
    const pesar = vi.fn();
    render(
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Detalhes do Lote" largo somenteLeitura>
        <AcoesDoLote grupos={[{ titulo: "Manejos", itens: [{ nome: "Pesar", Icone: Scale, onClick: pesar }] }]} />
      </LancLoteDialogo>,
    );
    const botao = screen.getByRole("button", { name: "Manejos e históricos" });
    expect(botao.closest(".mk-ll-dlg__head")).not.toBeNull();
    expect(botao.parentElement?.className).toBe("mk-ll-dlg__slot");
    fireEvent.click(botao);
    fireEvent.click(screen.getByRole("button", { name: "Pesar" }));
    expect(pesar).toHaveBeenCalledTimes(1);
  });
});

function Gesto() {
  useDeslizarParaFechar();
  return null;
}

const toque = (tipo, x, y = 300) => {
  const e = new Event(tipo, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: tipo === "touchend" ? [] : [{ clientX: x, clientY: y }] });
  document.dispatchEvent(e);
};
const deslizar = (x0, dist) => {
  toque("touchstart", x0);
  for (let i = 1; i <= 5; i++) toque("touchmove", x0 + (dist * i) / 5);
  toque("touchend", x0 + dist);
};

describe("Deslizar da borda fecha a janela de cima (D-PROD-120)", () => {
  const preparar = () => {
    window.matchMedia = /** @type {any} */ ((q) => ({ matches: /max-width: 767px/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
    vi.useFakeTimers();
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("data-state", "open");
    const esc = vi.fn();
    dlg.addEventListener("keydown", (e) => e.key === "Escape" && esc());
    document.body.appendChild(dlg);
    render(<Gesto />);
    return { dlg, esc };
  };

  it("da borda e além do limiar: fecha (Esc no diálogo)", () => {
    const { esc } = preparar();
    deslizar(10, 200);
    vi.advanceTimersByTime(300);
    expect(esc).toHaveBeenCalledTimes(1);
  });

  it("curto ou longe da borda: não fecha e volta ao lugar", () => {
    const { dlg, esc } = preparar();
    deslizar(10, 50);
    deslizar(120, 200);
    vi.advanceTimersByTime(1000);
    expect(esc).not.toHaveBeenCalled();
    expect(dlg.style.translate).toBe("");
  });

  it("folha aberta fecha pelo fundo escuro", () => {
    preparar();
    const folha = document.createElement("div");
    folha.className = "mk-sheet-root";
    const fundo = document.createElement("div");
    fundo.className = "mk-sheet-scrim";
    const clique = vi.fn();
    fundo.addEventListener("click", clique);
    folha.append(fundo);
    document.body.appendChild(folha);
    deslizar(10, 200);
    vi.advanceTimersByTime(300);
    expect(clique).toHaveBeenCalledTimes(1);
  });
});

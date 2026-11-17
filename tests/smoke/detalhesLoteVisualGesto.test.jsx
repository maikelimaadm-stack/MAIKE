// @vitest-environment jsdom
/**
 * D-PROD-120 — Detalhes do Lote sem "Alertas do lote", nomes de área/lote na
 * cor dos botões (verde), e o deslizar da borda esquerda fecha a janela de cima
 * no celular (lançamentos, históricos, detalhes e folhas).
 * D-PROD-218 — os cartões v8 (aba Tudo) saíram; o botão "Manejos" foi para o
 * rodapé da casca; o popup (desktop e, no Detalhes, tablet) fecha só pelo ✕.
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";
import { Scale } from "lucide-react";
import AcoesDoLote from "@/components/mapa/AcoesDoLote";
import PainelPasto from "@/components/mapa/detalhes-lote/PainelPasto";
import { montarModeloDetalhes } from "@/components/mapa/detalhes-lote/catalogo";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { readFileSync } from "node:fs";
import { useDeslizarParaFechar } from "@/hooks/useDeslizarParaVoltar";

// O conteúdo da aba Lotes é de outra peça (LOTES); aqui só a casca importa.
vi.mock("@/components/mapa/detalhes-lote/AbaLotes", async () => {
  const { createElement } = await import("react");
  return { default: () => createElement("div", { "data-testid": "aba-lotes" }) };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const detalhes = readFileSync("src/components/mapa/DetalhesLote.jsx", "utf8");
const css = readFileSync("src/styles/lancamento-lote.css", "utf8");
// As pílulas de título (pecas.jsx) seguem no Resumo do Rebanho (D-PROD-213).
const pecas = readFileSync("src/components/mapa/detalhes-lote/pecas.jsx", "utf8");

describe("Detalhes do Lote: visual (D-PROD-120)", () => {
  it("sem os alertas do lote", () => {
    expect(detalhes).not.toMatch(/Alertas do lote|lote\.alertas/);
  });

  it("nomes de área e lote em texto simples, sem o amarelo", () => {
    // D-PROD-144: o nome da área vai no cabeçalho do diálogo (D-PROD-218: título = pasto).
    expect(detalhes).not.toMatch(/mk-dl__area-nome/);
    for (const f of [detalhes, pecas]) expect(f).not.toMatch(/yellow|amber/);
    // UI-DETALHES-LOTE-V8: pílula de título (texto #374151, 700), ainda usada pelo Resumo do Rebanho.
    expect(pecas).toMatch(/export function PilulaTitulo[\s\S]*?color: COR\.texto,[\s\S]*?fontWeight: 700,/);
    expect(pecas).toMatch(/texto: "#374151"/);
  });
});

describe("Campos numa linha só, texto corre se não couber (D-PROD-124)", () => {
  it("rótulo e valor no mesmo tamanho do Categoria de Manejo, sem quebra de linha", () => {
    expect(css).toMatch(/\.mk-dl__linha \{[^}]*overflow: hidden;[^}]*white-space: nowrap;[^}]*font-size: 10\.5px;/);
    expect(css).toMatch(/\.mk-dl__chip \{[^}]*font-size: 10\.5px;/);
    expect(css).toMatch(/\.mk-dl__icone \{[^}]*\}/);
    expect(css).not.toMatch(/\.mk-dl__icone \{[^}]*background/);
  });

  it("CampoDl corre quando o texto passa da largura", async () => {
    const { default: CampoDl } = await import("@/components/mapa/CampoDl");
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get() { return this.classList.contains("mk-dl__correr") ? 200 : 80; } });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 80; } });
    try {
      const { container } = render(<CampoDl rotulo="Identificador">LOTE COMPOSTO DE ENGORDA</CampoDl>);
      const corre = container.querySelectorAll(".mk-dl__correr.is-correndo");
      expect(corre.length).toBe(2);
      expect(/** @type {HTMLElement} */ (corre[1]).style.getPropertyValue("--mk-dist")).toBe("-120px");
    } finally {
      if (sw) Object.defineProperty(HTMLElement.prototype, "scrollWidth", sw);
      if (cw) Object.defineProperty(HTMLElement.prototype, "clientWidth", cw);
    }
  });
});

describe("Ajustes D-PROD-125", () => {
  it("popup fecha só pelo ✕ (sem clique fora nem Esc); D-PROD-218: Esc numa tela empilhada volta um nível; D-PROD-220: num formulário empilhado (escVolta: false) o Esc é ignorado", () => {
    const ui = readFileSync("src/components/lotes/LancamentoLoteUi.jsx", "utf8");
    expect(ui).toMatch(/onInteractOutside=\{popup \? \(e\) => e\.preventDefault\(\) : undefined\}/);
    expect(ui).toMatch(
      /onEscapeKeyDown=\{\(e\) => \{\s*if \(cabecalho\?\.escVolta === false\) e\.preventDefault\(\);\s*else if \(voltar\) \{\s*e\.preventDefault\(\);\s*voltar\(\);\s*\} else if \(popup\) e\.preventDefault\(\);\s*\}\}/
    );
    // O comportamento (popup no desktop e no tablet, Esc) é provado em detalhesLoteV12Casca.test.jsx;
    // o Esc ignorado no formulário empilhado, em detalhesV12CascaDetalhe.test.jsx.
  });

  it("sub-ícone maior sem aumentar a linha; cabeçalho cinza e ✕ branco", () => {
    expect(css).toMatch(/\.mk-dl__icone \{[^}]*height: 22px;[^}]*overflow: visible;/);
    expect(css).toMatch(/\.mk-dl__icone img \{[^}]*width: 36px;/);
    expect(css).toMatch(/\.mk-dl\) \.mk-ll-dlg__head:not\(#mk-padrao\) \{[^}]*background: transparent;/);
  });

  it("identificador do lote no mapa: bolinha menor, borda fina, encostada na figura", () => {
    const mapa = readFileSync("src/components/mapa/useMapRenderer.jsx", "utf8");
    expect(mapa).toContain("left:calc(50% + 22px);top:calc(50% - 24px)");
    expect(mapa).toContain("width:13px;height:13px;box-sizing:border-box;border-radius:9999px;border:1px solid #fff;");
    expect(mapa).toContain("font-size:6px");
  });
});

describe("Celular: botão de manejos no rodapé (D-PROD-120 → D-PROD-218)", () => {
  it("\"Manejos\" fica no rodapé da casca (não no cabeçalho) e empilha a tela dos quadros, com ‹ no lugar do ✕", async () => {
    window.matchMedia = /** @type {any} */ ((q) => ({ matches: /max-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} }));
    const pesar = vi.fn();
    const modelo = montarModeloDetalhes({
      area: { id: "a1", nome: "Pasto 07" },
      lotes: [{ id: "p1", nome: "L-1", categoria: "BOI", quantidade_cabecas: 10, area_atual_id: "a1", __posicao: true }],
    });
    render(
      <LancLoteDialogo open onOpenChange={() => {}} titulo="Pasto 07" lotes={[{ nome: "Retiro" }]} largo somenteLeitura popupDesde="tablet">
        <PainelPasto
          modelo={modelo}
          permissoes={{ mover: true, pesar: true, historico: true, supl: true, detalhesCocho: true, lancarSupl: true, historicoCocho: true }}
          dados={{ areaNome: "Pasto 07", setorNome: "Retiro" }}
          manejos={<AcoesDoLote grupos={[{ titulo: "Manejos", itens: [{ nome: "Pesar", Icone: Scale, onClick: pesar }] }]} />}
        />
      </LancLoteDialogo>,
    );
    expect(document.querySelector(".mk-ll-dlg")?.classList.contains("is-tela")).toBe(true);
    const botao = screen.getByRole("button", { name: "Manejos" });
    expect(botao.closest(".mk-ll-dlg__head")).toBeNull();
    expect(botao.closest(".mk-dp__rodape")).not.toBeNull();
    await act(async () => { fireEvent.click(botao); });
    expect(screen.queryByRole("button", { name: "Fechar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Voltar" }).closest(".mk-ll-dlg__head")).not.toBeNull();
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

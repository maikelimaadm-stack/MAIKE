/**
 * D-PROD-164 — movimento do design "Cadastro de Lote" (proposta 6.32) no motor Base1:
 * aperto com mola, janela que nasce do botão e volta para ele, pílula nova que cresce,
 * folha do celular que sai na hora (a cópia desce), painel que só esmaece ao trocar de aba
 * e ‹ › que não repetem a entrada ao trocar de registro.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { iniciarMovimentoBase1, ligarMovimentoBase1, movimentoBase1Ligado } from "@/components/cadastro/base1/movimentoBase1";
import MobileSheet from "@/components/common/MobileSheet";
import Base1PanelTabs from "@/components/cadastro/base1/Base1PanelTabs";
import { NavegacaoDoRegistro, RegistroNavContext } from "@/components/cadastro/base1/registroNavBase1";

/** @type {ReturnType<typeof vi.fn>} */
let animate;
/** @type {(() => void) | null} */
let desligar = null;

const retangulo = (el, { left, top, width, height }) => {
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} });
};

/** Liga `matchMedia` só para as consultas pedidas. */
const consultas = (verdadeiras) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q) => ({ matches: verdadeiras.includes(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })),
  );
};

const chamadas = () => animate.mock.calls.map(([quadros, opc], i) => ({ quadros, opc, alvo: animate.mock.contexts[i] }));

/** Evento de ponteiro com `pointerType` (o jsdom não preenche no PointerEvent sintético). */
const ponteiro = (el, tipo, { x = 0, y = 0, pointerType = "mouse" } = {}) => {
  const ev = new MouseEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  Object.defineProperty(ev, "isPrimary", { value: true });
  el.dispatchEvent(ev);
};

beforeEach(() => {
  vi.useFakeTimers();
  animate = vi.fn(function () {
    return { cancel: vi.fn(), currentTime: 0, onfinish: null, oncancel: null };
  });
  Element.prototype.animate = /** @type {any} */ (animate);
  consultas([]);
});

afterEach(() => {
  desligar?.();
  desligar = null;
  cleanup();
  document.body.innerHTML = "";
  delete (/** @type {any} */ (Element.prototype).animate);
  vi.useRealTimers();
});

describe("movimento do design no motor Base1 (6.32)", () => {
  it("sem Element.animate (navegador sem animação) não liga nada", () => {
    delete (/** @type {any} */ (Element.prototype).animate);
    const parar = iniciarMovimentoBase1();
    expect(movimentoBase1Ligado()).toBe(false);
    parar();
  });

  it("aperto: o botão cede e volta com mola", () => {
    desligar = ligarMovimentoBase1();
    expect(movimentoBase1Ligado()).toBe(true);
    document.body.innerHTML = '<div class="cadastro-b1 cadastro-b1--full-page"><button type="button" aria-label="Novo">+</button></div>';
    const botao = screen.getByRole("button", { name: "Novo" });
    retangulo(botao, { left: 10, top: 10, width: 40, height: 40 });

    ponteiro(botao, "pointerdown", { x: 30, y: 30 });
    expect(chamadas()[0]).toMatchObject({
      alvo: botao,
      quadros: [{ scale: "1" }, { scale: "0.9" }],
      opc: { duration: 110, easing: "cubic-bezier(.2, .7, .3, 1)", fill: "forwards" },
    });

    ponteiro(botao, "pointerup", { x: 30, y: 30 });
    act(() => {
      vi.advanceTimersByTime(120);
    });
    const volta = chamadas().find((c) => c.opc.duration === 340);
    expect(volta).toMatchObject({ alvo: botao, quadros: [{ scale: "0.9" }, { scale: "1" }], opc: { easing: "cubic-bezier(.3, 1.45, .45, 1)" } });
  });

  it("a mola segue no botão novo quando o React troca o nó (ex.: próximo registro)", () => {
    desligar = ligarMovimentoBase1();
    document.body.innerHTML = '<div class="cadastro-b1 cadastro-b1--full-page"><span id="nav"><button type="button" aria-label="Próximo registro">›</button></span></div>';
    const velho = screen.getByRole("button", { name: "Próximo registro" });
    retangulo(velho, { left: 100, top: 20, width: 32, height: 32 });
    ponteiro(velho, "pointerdown", { x: 116, y: 36 });
    ponteiro(velho, "pointerup", { x: 116, y: 36 });

    // O formulário remonta: botão igual, no mesmo lugar.
    const novo = document.createElement("button");
    novo.type = "button";
    novo.setAttribute("aria-label", "Próximo registro");
    document.getElementById("nav").replaceChildren(novo);
    document.elementFromPoint = vi.fn(() => novo);

    act(() => {
      vi.advanceTimersByTime(120);
    });
    const volta = chamadas().find((c) => c.opc.duration === 340);
    expect(volta?.alvo).toBe(novo);
  });

  it("a janela nasce do botão (contorno + desfoque) e, ao fechar, uma cópia inerte volta para ele", async () => {
    desligar = ligarMovimentoBase1();
    document.body.innerHTML = '<div class="cadastro-b1 cadastro-b1--full-page"><button type="button" aria-label="Ordenar">Ordenar</button></div>';
    const botao = screen.getByRole("button", { name: "Ordenar" });
    retangulo(botao, { left: 100, top: 50, width: 80, height: 30 });
    ponteiro(botao, "pointerdown", { x: 120, y: 60 });
    ponteiro(botao, "pointerup", { x: 120, y: 60 });
    animate.mockClear();

    const invólucro = document.createElement("div");
    invólucro.setAttribute("data-radix-popper-content-wrapper", "");
    invólucro.style.transform = "translate(100px, 90px)";
    const painel = document.createElement("div");
    painel.className = "b1-fr-pop";
    painel.id = "radix-1";
    painel.setAttribute("data-testid", "janela");
    invólucro.appendChild(painel);
    const caixaOriginal = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList?.contains("b1-fr-pop")) return { left: 100, top: 90, width: 240, height: 320, right: 340, bottom: 410, x: 100, y: 90, toJSON() {} };
      return caixaOriginal.call(this);
    });
    await act(async () => {
      document.body.appendChild(invólucro);
      await Promise.resolve();
    });

    const nasce = chamadas().find((c) => c.alvo === painel);
    expect(nasce?.opc).toMatchObject({ duration: 460, fill: "backwards" });
    // contorno de partida = o botão (encostado no topo da janela), raio 5 px
    expect(nasce?.quadros[0]).toMatchObject({ offset: 0, clipPath: "inset(0px 160px 310px 0px round 5px)", opacity: 0.55, transform: "scale(.96)" });
    expect(nasce?.quadros[2]).toMatchObject({ offset: 0.46, transform: "scale(1.022)" });
    const desfoque = chamadas().find((c) => c.alvo === invólucro);
    expect(desfoque?.quadros[0]).toMatchObject({ filter: "blur(11px)" });
    expect(painel.style.transformOrigin).toBe("40px 5px");

    animate.mockClear();
    await act(async () => {
      invólucro.remove();
      await Promise.resolve();
    });
    const fantasma = document.querySelector(".mk-fantasmas [data-mk-fantasma]");
    expect(fantasma).not.toBeNull();
    expect(fantasma?.hasAttribute("inert")).toBe(true);
    expect(fantasma?.querySelector("#radix-1, [data-testid]")).toBeNull();
    const volta = chamadas().find((c) => c.opc.duration === 210 && c.alvo !== fantasma);
    expect(volta?.quadros.at(-1)).toMatchObject({ offset: 1, clipPath: "inset(0px 160px 310px 0px round 5px)", opacity: 0 });

    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(document.querySelector("[data-mk-fantasma]")).toBeNull();
  });

  it("clique de teclado (detail 0) nunca é desviado para o botão apertado antes", () => {
    desligar = ligarMovimentoBase1();
    document.body.innerHTML =
      '<div class="cadastro-b1 cadastro-b1--full-page"><button type="button" aria-label="Canto">a</button><button type="button" aria-label="Outro">b</button></div>';
    const canto = screen.getByRole("button", { name: "Canto" });
    const outro = screen.getByRole("button", { name: "Outro" });
    retangulo(canto, { left: 0, top: 0, width: 40, height: 40 });
    const noCanto = vi.fn();
    const noOutro = vi.fn();
    canto.addEventListener("click", noCanto);
    outro.addEventListener("click", noOutro);
    ponteiro(canto, "pointerdown", { x: 20, y: 20 }); // apertou e arrastou para fora: nenhum clique
    outro.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0, clientX: 0, clientY: 0 }));
    expect(noOutro).toHaveBeenCalledTimes(1);
    expect(noCanto).not.toHaveBeenCalled();
  });

  it("pílula nova na faixa de filtros aparece crescendo", async () => {
    desligar = ligarMovimentoBase1();
    document.body.innerHTML = '<div class="cadastro-b1 cadastro-b1--full-page"><div class="b1-fr__chips"></div></div>';
    const chip = document.createElement("span");
    chip.className = "b1-fr-chip";
    await act(async () => {
      document.querySelector(".b1-fr__chips").appendChild(chip);
      await Promise.resolve();
    });
    expect(chamadas().find((c) => c.alvo === chip)).toMatchObject({ quadros: [{ scale: ".5", opacity: 0 }, { offset: 0.6, scale: "1.08" }, { scale: "1" }], opc: { duration: 300 } });
  });

  it("com 'reduzir movimento' nada anima e nada fica para trás", async () => {
    consultas(["(prefers-reduced-motion: reduce)"]);
    desligar = ligarMovimentoBase1();
    document.body.innerHTML = '<div class="cadastro-b1 cadastro-b1--full-page"><button type="button" aria-label="Novo">+</button></div>';
    ponteiro(screen.getByRole("button", { name: "Novo" }), "pointerdown");
    const janela = document.createElement("div");
    janela.className = "cadastro-b1 fpc fpc--pop";
    retangulo(janela, { left: 0, top: 0, width: 200, height: 200 });
    await act(async () => {
      document.body.appendChild(janela);
      await Promise.resolve();
      janela.remove();
      await Promise.resolve();
    });
    expect(animate).not.toHaveBeenCalled();
    expect(document.querySelector("[data-mk-fantasma]")).toBeNull();
  });

  it("folha do celular: com o movimento ligado o ✕ fecha na hora (a cópia faz a descida do design)", () => {
    consultas(["(max-width: 639px)"]);
    const onClose = vi.fn();
    render(
      <MobileSheet open onClose={onClose} label="Filtros">
        <p>conteúdo</p>
      </MobileSheet>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).not.toHaveBeenCalled(); // sem tela Base1: saída própria da folha (200 ms)
    act(() => {
      vi.advanceTimersByTime(210);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    desligar = ligarMovimentoBase1();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("painel das abas e navegação do registro (como no design)", () => {
  const TABS = [
    { id: "geral", label: "Geral" },
    { id: "compra", label: "Motivo" },
  ];
  function Abas({ chave }) {
    const [aba, setAba] = React.useState("geral");
    return (
      <div className="cadastro-b1">
        <Base1PanelTabs tabs={TABS} value={aba} onChange={setAba} animationKey={chave} renderPanel={(id) => <p>painel {id}</p>} />
      </div>
    );
  }

  it("o painel só esmaece ao trocar de aba no mesmo registro — nunca ao abrir ou trocar de registro", () => {
    const { rerender } = render(<Abas chave="lote-1" />);
    expect(document.querySelector(".b1-panel-motion--animate")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Motivo" }));
    expect(document.querySelector("#b1-panel-compra")).toHaveClass("b1-panel-motion--animate");
    rerender(<Abas chave="lote-2" />);
    expect(document.querySelector(".b1-panel-motion--animate")).toBeNull();
  });

  it("‹ › entram deslizando só quando o registro abre; o formulário remontado (próximo registro) não repete", () => {
    const navJaEntrou = { current: false };
    const info = { index: 2, total: 12, onGo: () => {} };
    const contexto = { info, registrar: () => () => {}, navJaEntrou };
    const { unmount } = render(
      <RegistroNavContext.Provider value={contexto}>
        <NavegacaoDoRegistro info={info} />
      </RegistroNavContext.Provider>,
    );
    expect(screen.getByTestId("cadastro-record-nav")).not.toHaveClass("b1-reg-nav--fica");
    expect(navJaEntrou.current).toBe(true);
    unmount();
    render(
      <RegistroNavContext.Provider value={contexto}>
        <NavegacaoDoRegistro info={{ ...info, index: 3 }} />
      </RegistroNavContext.Provider>,
    );
    expect(screen.getByTestId("cadastro-record-nav")).toHaveClass("b1-reg-nav--fica");
  });
});

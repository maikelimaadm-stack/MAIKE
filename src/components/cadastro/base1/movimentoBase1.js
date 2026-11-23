import React from "react";

/**
 * Movimento do design "Cadastro de Lote" (proposta 6.32, D-PROD-165) — a parte que no design é feita
 * por script (`iniciarMovimento()`); a parte em CSS está em `src/styles/base1-design.css`.
 * Nada de cor ou desenho novo: só como as coisas abrem, fecham e respondem ao toque.
 *
 * - **Toque:** o botão cede um pouco e volta com mola. No toque espera um instante (se for rolagem, nem começa).
 * - **Janelas nascem do botão:** o contorno do botão cresce até virar a janela (o conteúdo vem do desfoque,
 *   passa um pouco do tamanho e assenta) e, ao fechar, volta para ele (uma cópia inerte da janela faz o caminho).
 * - **Pílula nova** na faixa de filtros aparece crescendo.
 * - Com "reduzir movimento" do sistema, nada disso acontece.
 *
 * Fica ligado só enquanto uma tela Base1 está aberta (mesma condição do CSS:
 * `body.b1-tela`, ligada por `useCascoBase1`): o Mapa Geral não muda. Sem `Element.animate` (jsdom), não liga.
 *
 * Tradução do protótipo para o app: a raiz do protótipo (`.mkx-root`) é o `document.body`, onde os portais
 * montam as janelas; `.mkx-popper` é o invólucro do Radix (`[data-radix-popper-content-wrapper]`); não há
 * moldura de aparelho (escala 1). As medidas, curvas e tempos são os do design.
 */

const INVOLUCRO = "[data-radix-popper-content-wrapper]";
const JANELA = `${INVOLUCRO}, .fpc--pop, .b1-col-pop, .mk-sheet-root`;
const SO_ABRE = ".b1-fr-regra__lista, .mg-search-suggest, .mdlc, .mg-confirm-dialog";
const CENTRO = ".mdlc, .mg-confirm-dialog";
const APERTA = 'button, [role="button"], [role="option"], [role="menuitem"]';
/** O mapa (MapLibre) não entra no movimento das telas Base1. */
const FORA = ".maplibregl-map";

/** @typedef {{ left: number, top: number, right: number, bottom: number, width?: number }} Caixa */
/** @typedef {{ l: number, t: number, r: number, b: number }} Geo */

/**
 * @param {Element} el
 * @returns {Element | null}
 */
const painel = (el) => (el.matches(INVOLUCRO) ? el.firstElementChild : el);

const calmo = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

/**
 * @param {Element | null} el
 * @param {Keyframe[]} quadros
 * @param {KeyframeAnimationOptions} opc
 * @returns {Animation | null}
 */
const anima = (el, quadros, opc) => {
  try {
    return el && typeof el.animate === "function" ? el.animate(quadros, opc) : null;
  } catch {
    return null;
  }
};

/** @param {number} v @param {number} a @param {number} b */
const lim = (v, a, b) => Math.max(a, Math.min(b, v));
/** @param {number} n */
const px = (n) => `${Math.round(n * 10) / 10}px`;

/**
 * Contorno de partida: o pedaço da janela que coincide com o botão (ou a beirada encostada nele).
 * @param {Geo} geo
 * @param {number} W
 * @param {number} H
 */
function contorno(geo, W, H) {
  let l = lim(geo.l, 0, W);
  let r = lim(geo.r, 0, W);
  let t = lim(geo.t, 0, H);
  let b = lim(geo.b, 0, H);
  if (r - l < 24) {
    const c = lim((geo.l + geo.r) / 2, 12, Math.max(12, W - 12));
    l = Math.max(0, c - 12);
    r = Math.min(W, c + 12);
  }
  if (b - t < 10) {
    if (geo.b <= 5) {
      t = 0;
      b = Math.min(H, 10);
    } else if (geo.t >= H - 5) {
      b = H;
      t = Math.max(0, H - 10);
    } else {
      const c = lim((geo.t + geo.b) / 2, 5, Math.max(5, H - 5));
      t = Math.max(0, c - 5);
      b = Math.min(H, c + 5);
    }
  }
  const raio = Math.max(3, Math.min((r - l) / 2, (b - t) / 2, 22));
  return { ini: `inset(${px(t)} ${px(W - r)} ${px(H - b)} ${px(l)} round ${px(raio)})`, ox: (l + r) / 2, oy: (t + b) / 2 };
}

/**
 * @param {Element} p
 * @param {Geo} geo
 * @param {number} W
 * @param {number} H
 */
function formas(p, geo, W, H) {
  const raio = parseFloat(getComputedStyle(p).borderTopLeftRadius) || 12;
  const c = contorno(geo, W, H);
  return { ...c, cheio: `inset(0px 0px 0px 0px round ${px(raio)})`, fora: `inset(-40px -40px -40px -40px round ${px(raio + 40)})` };
}

/**
 * O quanto o botão cede: opções de lista quase nada; botão pequeno mais.
 * @param {HTMLElement} el
 */
function fator(el) {
  const w = el.offsetWidth || 0;
  if (el.matches('[role="option"], [role="menuitem"]')) return w > 220 ? 0.985 : 0.97;
  return w <= 64 ? 0.9 : w <= 190 ? 0.95 : 0.975;
}

/** O movimento está de fato rodando no documento (há tela Base1 aberta e o navegador anima). */
let rodando = false;

/**
 * Para quem fecha janela com animação própria (ex.: a folha do celular): com o movimento ligado,
 * a janela deve sair na hora e a cópia que o movimento deixa faz a saída do design.
 */
export const movimentoBase1Ligado = () => rodando;

/**
 * Liga o movimento no documento. Devolve a função que desliga.
 * @returns {() => void}
 */
export function iniciarMovimentoBase1() {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  if (typeof MutationObserver === "undefined" || typeof Element.prototype.animate !== "function") return () => {};
  const raiz = document.body;
  rodando = true;

  /** @type {WeakMap<Element, number>} */
  const rolagens = new WeakMap();
  /** @type {WeakMap<Element, Geo>} */
  const geometrias = new WeakMap();
  /** @type {{ x: number, y: number, t: number, larg: number, r: Caixa | null } | null} */
  let toque = null;
  /** @type {{ el: HTMLElement, r: DOMRect } | null} */
  let botao = null;
  /** @type {{ p: Element, x: number, y: number, t: number } | null} */
  let nascendo = null;
  /** @type {HTMLDivElement | null} */
  let camadaAtual = null;
  /**
   * @typedef {{ quadros: Keyframe[], opc: KeyframeAnimationOptions, inicio: number, fim: number }} Fase
   * @typedef {{ el: HTMLElement, chave: string, r: DOMRect, x: number, y: number, on: boolean, t1?: number, f?: number,
   *   anim?: Animation | null, fase?: Fase | null, seguindo?: boolean, timer?: ReturnType<typeof setTimeout> }} Aperto
   */
  /** @type {Aperto | null} */
  let aperto = null;

  // ---- aperto: o botão cede um pouco e volta com mola.
  /** @param {Element} el */
  const chaveDe = (el) => `${el.tagName}|${el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent || "").trim().slice(0, 40)}`;
  /**
   * O React pode trocar o botão apertado por outro igual (ex.: o formulário remonta ao ir para o próximo registro);
   * no design o nó continua o mesmo — então a mola segue no botão novo, no mesmo lugar e com o mesmo nome.
   * @param {Aperto} A
   */
  const substituto = (A) => {
    const el = document.elementFromPoint((A.r.left + A.r.right) / 2, (A.r.top + A.r.bottom) / 2);
    const novo = el ? el.closest(`.b1-fr-chip, ${APERTA}`) : null;
    return novo instanceof HTMLElement && novo !== A.el && chaveDe(novo) === A.chave ? novo : null;
  };
  /**
   * Anima o botão apertado e, se ele for trocado no meio, continua no substituto do ponto em que estava.
   * @param {Aperto} A
   * @param {Keyframe[]} quadros
   * @param {KeyframeAnimationOptions} opc
   * @param {number} fim até quando seguir (ms de `performance.now()`)
   */
  const animaAperto = (A, quadros, opc, fim) => {
    A.fase = { quadros, opc, inicio: performance.now(), fim };
    A.anim = anima(A.el, quadros, opc);
    if (A.seguindo) return;
    A.seguindo = true;
    const passo = () => {
      const F = A.fase;
      if (!F || performance.now() > F.fim) {
        A.seguindo = false;
        return;
      }
      if (!A.el.isConnected) {
        const novo = substituto(A);
        if (!novo) {
          A.seguindo = false;
          return;
        }
        A.el = novo;
        A.anim = anima(novo, F.quadros, F.opc);
        if (A.anim) A.anim.currentTime = Math.max(0, performance.now() - F.inicio);
      }
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  };
  /** @param {Aperto} A */
  const liga = (A) => {
    if (A.on || calmo() || !A.el.isConnected) return;
    A.on = true;
    A.t1 = Date.now();
    A.f = fator(A.el);
    animaAperto(A, [{ scale: "1" }, { scale: String(A.f) }], { duration: 110, easing: "cubic-bezier(.2, .7, .3, 1)", fill: "forwards" }, Infinity);
  };
  /** @param {boolean} cancelou */
  const solta = (cancelou) => {
    const A = aperto;
    if (!A) return;
    aperto = null;
    clearTimeout(A.timer);
    if (!A.on) {
      if (cancelou) return;
      liga(A);
      if (!A.on) return;
    }
    const volta = () => {
      if (A.anim) {
        try {
          A.anim.cancel();
        } catch {
          /* já acabou */
        }
      }
      if (!A.el.isConnected) {
        const novo = substituto(A);
        if (novo) A.el = novo;
      }
      if (A.el.isConnected) {
        animaAperto(A, [{ scale: String(A.f) }, { scale: "1" }], { duration: 340, easing: "cubic-bezier(.3, 1.45, .45, 1)" }, performance.now() + 340);
      } else {
        A.fase = null;
      }
    };
    const falta = cancelou ? 0 : Math.max(0, 100 - (Date.now() - (A.t1 ?? 0)));
    if (falta) setTimeout(volta, falta);
    else volta();
  };

  /** @param {PointerEvent} e */
  const aoTocar = (e) => {
    if (e.isPrimary === false) return;
    const alvo = e.target instanceof Element ? e.target : null;
    if (!alvo || alvo.closest(FORA)) return;
    const cx = alvo.closest(".b1-fr-chip, .mg-field") || alvo.closest(APERTA);
    const caixa = cx ? cx.getBoundingClientRect() : null;
    toque = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      larg: window.innerWidth,
      r: caixa && caixa.width ? { left: caixa.left, top: caixa.top, right: caixa.right, bottom: caixa.bottom } : null,
    };
    const bt = /** @type {HTMLElement | null} */ (alvo.closest(APERTA));
    botao = bt ? { el: bt, r: bt.getBoundingClientRect() } : null;
    solta(true);
    const ap = /** @type {HTMLElement | null} */ (alvo.closest(".b1-fr-chip") || bt);
    if (
      ap &&
      !(/** @type {HTMLButtonElement} */ (ap).disabled) &&
      ap.getAttribute("aria-disabled") !== "true" &&
      !ap.classList.contains("b1-switch") &&
      !ap.classList.contains("mk-sheet__handle") &&
      !ap.closest(".mk-fantasmas")
    ) {
      /** @type {Aperto} */
      const A = { el: ap, chave: chaveDe(ap), r: ap.getBoundingClientRect(), x: e.clientX, y: e.clientY, on: false };
      aperto = A;
      if (e.pointerType === "mouse") liga(A);
      else A.timer = setTimeout(() => liga(A), 70);
    }
  };
  /** @param {PointerEvent} e */
  const aoMover = (e) => {
    const A = aperto;
    if (A && Math.hypot(e.clientX - A.x, e.clientY - A.y) > 10) solta(true);
  };
  const aoSoltar = () => solta(false);
  const aoCancelar = () => solta(true);
  /** @param {MouseEvent} e */
  const aoClicar = (e) => {
    // Clique de teclado (Enter/Espaço: `detail` 0, sem coordenadas) nunca é desviado nem engolido.
    if (e.detail === 0) {
      botao = null;
      return;
    }
    // segundo toque no mesmo lugar, com a janela ainda nascendo, não escolhe o item que apareceu embaixo do dedo
    const N = nascendo;
    if (
      N &&
      e.isTrusted &&
      Date.now() - N.t < 400 &&
      Math.hypot(e.clientX - N.x, e.clientY - N.y) < 16 &&
      N.p.isConnected &&
      e.target instanceof Node &&
      N.p.contains(e.target)
    ) {
      botao = null;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    // o botão encolhe um pouco ao ser apertado: se o dedo estava na beirada, o clique continua valendo
    const B = botao;
    botao = null;
    if (!B || !e.isTrusted || !B.el.isConnected || /** @type {HTMLButtonElement} */ (B.el).disabled) return;
    if (e.target instanceof Node && B.el.contains(e.target)) return;
    if (e.clientX >= B.r.left && e.clientX <= B.r.right && e.clientY >= B.r.top && e.clientY <= B.r.bottom) {
      e.stopPropagation();
      e.preventDefault();
      B.el.click();
    }
  };
  /** @param {Event} e */
  const aoRolar = (e) => {
    if (aperto) solta(true);
    const t = e.target;
    if (t instanceof Element && t.closest(`${INVOLUCRO}, .mk-sheet-root, .fpc--pop, .b1-col-pop`)) rolagens.set(t, t.scrollTop);
  };

  /**
   * A janela nasce do botão que a abriu.
   * @param {Element} el
   * @param {number} [tent]
   */
  const abrir = (el, tent = 0) => {
    if (!el.isConnected || el.classList.contains("mk-sheet-root") || calmo()) return; // a folha sobe sozinha (CSS)
    const p = painel(el);
    if (!p || typeof p.animate !== "function") return;
    // O Radix só posiciona a janela depois de medir (até lá ela fica fora da tela, em -200%).
    const aindaNaoPosicionou = el.matches(INVOLUCRO) && /-200%/.test(/** @type {HTMLElement} */ (el).style.transform || "");
    if (aindaNaoPosicionou || getComputedStyle(el).visibility === "hidden") {
      if (tent < 12) requestAnimationFrame(() => abrir(el, tent + 1));
      return;
    }
    if (p.matches(CENTRO)) {
      anima(p, [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(.2, .9, .3, 1)" });
      return;
    }
    const r = p.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const W = r.width;
    const H = r.height;
    const T = toque;
    const recente = Boolean(T) && Date.now() - (T?.t ?? 0) < 900;
    const focado = document.activeElement;
    const ativo = focado && focado !== document.body && !p.contains(focado) ? focado.getBoundingClientRect() : null;
    /** @type {Caixa | null} */
    let g = recente && T ? T.r || { left: T.x - 16, right: T.x + 16, top: T.y - 16, bottom: T.y + 16 } : ativo && ativo.width ? ativo : null;
    if (!g) g = { left: r.left + r.width / 2 - 20, right: r.left + r.width / 2 + 20, top: r.top - 8, bottom: r.top };
    const geo = { l: g.left - r.left, t: g.top - r.top, r: g.right - r.left, b: g.bottom - r.top };
    geometrias.set(p, geo);
    if (recente && T) nascendo = { p, x: T.x, y: T.y, t: Date.now() };
    const F = formas(p, geo, W, H);
    const solto = p === el; // sem invólucro: o desfoque vai no próprio painel
    /** @type {HTMLElement} */ (p).style.transformOrigin = `${Math.round(F.ox)}px ${Math.round(F.oy)}px`;
    p.setAttribute("data-mk-abre", "");
    const fluido = p.matches(".mg-mais-opcoes");
    // Mais opções: o contorno se expande com uma mola leve; o texto entra depois,
    // sem desfocar a lista. Não anima width/height nem recalcula a posição do Radix.
    const quadrosFluidos = [
      { offset: 0, clipPath: F.ini, opacity: 0.7, transform: "scale(1, .95)", borderRadius: "25px", easing: "cubic-bezier(.19, 1.22, .20, 1)" },
      { offset: 0.36, clipPath: F.cheio, opacity: 1, transform: "scale(1.013, 1.025)", borderRadius: "25px", easing: "cubic-bezier(.23, .89, .3, 1)" },
      { offset: 0.66, clipPath: F.fora, opacity: 1, transform: "scale(.995, .989)", borderRadius: getComputedStyle(p).borderTopLeftRadius, easing: "ease-out" },
      { offset: 1, clipPath: F.fora, opacity: 1, transform: "scale(1)", borderRadius: getComputedStyle(p).borderTopLeftRadius },
    ];
    const a = anima(
      p,
      fluido ? quadrosFluidos : [
        { offset: 0, clipPath: F.ini, opacity: 0.55, transform: "scale(.96)", ...(solto ? { filter: "blur(8px)" } : {}), easing: "cubic-bezier(.25, .75, .2, 1)" },
        { offset: 0.12, opacity: 1 },
        { offset: 0.46, clipPath: F.cheio, transform: "scale(1.022)", ...(solto ? { filter: "blur(2px)" } : {}), easing: "cubic-bezier(.4, 0, .4, 1)" },
        { offset: 0.72, clipPath: F.fora, transform: "scale(.996)", ...(solto ? { filter: "blur(0px)" } : {}), easing: "ease-out" },
        { offset: 1, clipPath: F.fora, opacity: 1, transform: "scale(1)", ...(solto ? { filter: "blur(0px)" } : {}) },
      ],
      { duration: fluido ? 660 : 460, fill: "backwards" },
    );
    if (fluido) {
      Array.from(p.children).forEach((conteudo) => {
        anima(conteudo, [
          { opacity: 0, transform: "translate3d(12px, -11px, 0) scale(.97)" },
          { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" },
        ], { delay: 150, duration: 420, easing: "cubic-bezier(.18, 1.18, .26, 1)", fill: "backwards" });
      });
    } else if (!solto) {
      anima(
        el,
        [
          { offset: 0, filter: "blur(11px)" },
          { offset: 0.36, filter: "blur(5px)" },
          { offset: 0.64, filter: "blur(0px)" },
          { offset: 1, filter: "blur(0px)" },
        ],
        { duration: 460, easing: "ease-out" },
      );
    }
    const fim = () => p.removeAttribute("data-mk-abre");
    if (a) {
      a.onfinish = fim;
      a.oncancel = fim;
    }
    setTimeout(fim, 700);
  };

  const camada = () => {
    let c = camadaAtual;
    if (!c || !c.isConnected || c.parentElement !== raiz) {
      c = document.createElement("div");
      c.className = "mk-fantasmas";
      c.setAttribute("aria-hidden", "true");
      camadaAtual = c;
    }
    if (raiz.lastElementChild !== c) raiz.appendChild(c);
    return c;
  };

  /**
   * Ao fechar, uma cópia inerte da janela volta para o botão (a folha do celular desce).
   * @param {Element} el
   */
  const fechar = (el) => {
    const T = toque;
    if ((T && T.larg && T.larg !== window.innerWidth) || calmo()) return; // girou ou trocou de tamanho: não há para onde voltar
    if (!document.querySelector(".cadastro-b1--full-page")) return; // a tela Base1 saiu junto
    const folha = el.classList.contains("mk-sheet-root");
    const g = /** @type {Element} */ (el.cloneNode(true));
    const de = el.querySelectorAll("*");
    const para = g.querySelectorAll("*");
    /** @type {[Element, number][]} */
    const rol = [];
    for (let i = 0; i < de.length && i < para.length; i += 1) {
      const v = rolagens.get(de[i]);
      if (v) rol.push([para[i], v]);
    }
    [g, ...Array.from(para)].forEach((n) => {
      ["id", "data-testid", "name", "data-mk-abre", "for"].forEach((a) => n.removeAttribute(a));
    });
    g.setAttribute("data-mk-fantasma", "");
    g.setAttribute("inert", "");
    const p = painel(g);
    if (p) p.setAttribute("data-mk-fecha", "");
    camada().appendChild(g);
    rol.forEach(([n, v]) => {
      n.scrollTop = v;
    });
    if (!folha && p) {
      const original = painel(el);
      const geo = original ? geometrias.get(original) : undefined;
      const r = p.getBoundingClientRect();
      if (geo && r.width && r.height && typeof p.animate === "function") {
        const F = formas(p, geo, r.width, r.height);
        /** @type {HTMLElement} */ (p).style.transformOrigin = `${Math.round(F.ox)}px ${Math.round(F.oy)}px`;
        anima(
          p,
          [
            { offset: 0, clipPath: F.fora, opacity: 1, transform: "scale(1)" },
            { offset: 0.2, clipPath: F.cheio, opacity: 1 },
            { offset: 1, clipPath: F.ini, opacity: 0, transform: "scale(.96)" },
          ],
          { duration: p.matches(".mg-mais-opcoes") ? 320 : 210, easing: "cubic-bezier(.4, 0, .85, .5)", fill: "forwards" },
        );
        if (p !== g && !p.matches(".mg-mais-opcoes")) anima(g, [{ filter: "blur(0px)" }, { filter: "blur(9px)" }], { duration: 210, easing: "ease-in", fill: "forwards" });
      } else {
        anima(p, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: "forwards" });
      }
    }
    setTimeout(() => g.remove(), folha ? 340 : p?.matches(".mg-mais-opcoes") ? 325 : 215);
  };

  const observador = new MutationObserver((lista) => {
    /** @type {Element[]} */
    const novos = [];
    /** @type {Element[]} */
    const idos = [];
    lista.forEach((m) => {
      const alvo = m.target;
      if (!(alvo instanceof Element) || alvo.classList.contains("mk-fantasmas") || alvo.closest(".mk-fantasmas")) return;
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element) || n.hasAttribute("data-mk-fantasma")) return;
        if (n.matches(JANELA) || n.matches(SO_ABRE)) novos.push(n);
        // pílula de filtro NOVA (a faixa já existia): aparece crescendo
        else if (n.classList.contains("b1-fr-chip") && alvo.classList.contains("b1-fr__chips") && !calmo()) {
          anima(
            n,
            [
              { scale: ".5", opacity: 0 },
              { offset: 0.6, scale: "1.08", opacity: 1 },
              { scale: "1", opacity: 1 },
            ],
            { duration: 300, easing: "cubic-bezier(.3, 1.2, .4, 1)" },
          );
        }
      });
      m.removedNodes.forEach((n) => {
        if (n instanceof Element && !n.hasAttribute("data-mk-fantasma") && n.matches(JANELA) && alvo === raiz) idos.push(n);
      });
    });
    novos.forEach((n) => {
      if (!idos.includes(n)) abrir(n);
    });
    idos.forEach((n) => {
      if (!n.isConnected) fechar(n);
    });
  });

  document.addEventListener("pointerdown", aoTocar, true);
  document.addEventListener("pointermove", aoMover, true);
  document.addEventListener("pointerup", aoSoltar, true);
  document.addEventListener("pointercancel", aoCancelar, true);
  document.addEventListener("click", aoClicar, true);
  document.addEventListener("scroll", aoRolar, true);
  observador.observe(raiz, { childList: true, subtree: true });

  return () => {
    rodando = false;
    observador.disconnect();
    document.removeEventListener("pointerdown", aoTocar, true);
    document.removeEventListener("pointermove", aoMover, true);
    document.removeEventListener("pointerup", aoSoltar, true);
    document.removeEventListener("pointercancel", aoCancelar, true);
    document.removeEventListener("click", aoClicar, true);
    document.removeEventListener("scroll", aoRolar, true);
    if (aperto) {
      clearTimeout(aperto.timer);
      aperto.fase = null;
    }
    aperto = null;
    camadaAtual?.remove();
    camadaAtual = null;
  };
}

let ligados = 0;
/** @type {(() => void) | null} */
let desligar = null;

/**
 * Liga o movimento (uma vez só, mesmo com várias telas Base1 abertas) e devolve quem desliga.
 * @returns {() => void}
 */
export function ligarMovimentoBase1() {
  ligados += 1;
  if (ligados === 1) desligar = iniciarMovimentoBase1();
  let feito = false;
  return () => {
    if (feito) return;
    feito = true;
    ligados -= 1;
    if (ligados === 0 && desligar) {
      desligar();
      desligar = null;
    }
  };
}

/**
 * Movimento do design enquanto a tela Base1 que chama está aberta.
 * @param {boolean} [ativo]
 */
export function useMovimentoBase1(ativo = true) {
  React.useEffect(() => (ativo ? ligarMovimentoBase1() : undefined), [ativo]);
}

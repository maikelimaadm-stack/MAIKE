import { useEffect, useRef } from "react";

/** Largura da borda esquerda onde o gesto começa (como no iOS). */
const BORDA = 28;
/** Distância mínima para valer como "voltar". */
const LIMIAR = 90;

/**
 * Deslizar da borda esquerda para a direita volta uma tela (D-PROD-95), como
 * no iPhone. Só no celular (< 768px) e só quando há para onde voltar. Folhas
 * abertas (`.mk-sheet-root`) e o mapa (`[data-sem-voltar-deslizando]`) ficam
 * de fora. A tela acompanha o dedo; soltando antes do limiar ela volta ao lugar.
 *
 * @param {{ ativo: boolean, onVoltar: (() => void) | null | undefined, alvoRef: { current: HTMLElement | null } }} opcoes
 */
export default function useDeslizarParaVoltar({ ativo, onVoltar, alvoRef }) {
  const voltarRef = useRef(onVoltar);
  voltarRef.current = onVoltar;

  useEffect(() => {
    if (!ativo || typeof window === "undefined") return undefined;
    /** @type {null | { x0: number, y0: number, dx: number, decidido: boolean, arrastando: boolean }} */
    let g = null;

    const celular = () => window.matchMedia?.("(max-width: 767px)").matches;
    const alvo = () => alvoRef.current;

    const inicio = (e) => {
      const t = e.touches[0];
      if (!t || t.clientX > BORDA || !celular() || !voltarRef.current) return;
      const el = /** @type {Element} */ (e.target);
      if (document.querySelector(".mk-sheet-root, [role='dialog'][data-state='open']")) return;
      if (el instanceof Element && el.closest("[data-sem-voltar-deslizando], .leaflet-container, .maplibregl-map")) return;
      g = { x0: t.clientX, y0: t.clientY, dx: 0, decidido: false, arrastando: false };
    };

    const mover = (e) => {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.decidido) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.decidido = true;
        g.arrastando = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2;
        if (!g.arrastando) {
          g = null;
          return;
        }
        const el = alvo();
        if (el) {
          el.style.transition = "none";
          el.style.willChange = "transform";
        }
      }
      if (e.cancelable) e.preventDefault();
      g.dx = Math.max(0, dx);
      const el = alvo();
      if (el) {
        el.style.transform = `translateX(${g.dx}px)`;
        el.style.boxShadow = "-12px 0 24px rgba(15, 23, 42, 0.12)";
      }
    };

    const fim = () => {
      if (!g) return;
      const { dx, arrastando } = g;
      g = null;
      if (!arrastando) return;
      const el = alvo();
      const voltar = dx > LIMIAR;
      if (el) {
        el.style.transition = "transform 0.24s cubic-bezier(0.32, 0.72, 0, 1)";
        el.style.transform = voltar ? "translateX(100%)" : "translateX(0)";
      }
      window.setTimeout(
        () => {
          if (voltar) voltarRef.current?.();
          if (el) {
            el.style.transition = "";
            el.style.transform = "";
            el.style.boxShadow = "";
            el.style.willChange = "";
          }
        },
        voltar ? 220 : 240,
      );
    };

    document.addEventListener("touchstart", inicio, { passive: true });
    document.addEventListener("touchmove", mover, { passive: false });
    document.addEventListener("touchend", fim);
    document.addEventListener("touchcancel", fim);
    return () => {
      document.removeEventListener("touchstart", inicio);
      document.removeEventListener("touchmove", mover);
      document.removeEventListener("touchend", fim);
      document.removeEventListener("touchcancel", fim);
    };
  }, [ativo, alvoRef]);
}

/**
 * Deslizar da borda esquerda também FECHA a janela de cima (D-PROD-120): os
 * lançamentos, históricos, detalhes e folhas abrem em tela inteira no celular,
 * e o gesto de voltar do iPhone precisa valer neles. A janela acompanha o dedo
 * (`translate`, que soma ao `transform` do diálogo) e, passando do limiar,
 * fecha como o ✕: folha pelo fundo escuro; diálogo do Radix pelo Esc.
 */
export function useDeslizarParaFechar() {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    /** @type {null | { x0: number, y0: number, dx: number, decidido: boolean, arrastando: boolean, janela: HTMLElement, mover: HTMLElement }} */
    let g = null;
    const celular = () => window.matchMedia?.("(max-width: 767px)").matches;

    const janelaDeCima = () => {
      const abertas = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll(".mk-sheet-root, [role='dialog'][data-state='open']")));
      return abertas[abertas.length - 1] || null;
    };

    const inicio = (e) => {
      const t = e.touches[0];
      if (!t || t.clientX > BORDA || !celular()) return;
      const janela = janelaDeCima();
      if (!janela) return;
      const mover = janela.classList.contains("mk-sheet-root") ? /** @type {HTMLElement} */ (janela.querySelector(".mk-sheet") || janela) : janela;
      g = { x0: t.clientX, y0: t.clientY, dx: 0, decidido: false, arrastando: false, janela, mover };
    };

    const mover = (e) => {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.decidido) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.decidido = true;
        g.arrastando = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2;
        if (!g.arrastando) {
          g = null;
          return;
        }
        g.mover.style.transition = "none";
      }
      if (e.cancelable) e.preventDefault();
      g.dx = Math.max(0, dx);
      g.mover.style.translate = `${g.dx}px 0`;
    };

    const fim = () => {
      if (!g) return;
      const { dx, arrastando, janela, mover: el } = g;
      g = null;
      if (!arrastando) return;
      const fechar = dx > LIMIAR;
      el.style.transition = "translate 0.22s cubic-bezier(0.32, 0.72, 0, 1)";
      el.style.translate = fechar ? "100vw 0" : "0 0";
      window.setTimeout(() => {
        const voltarAoLugar = () => {
          el.style.transition = "";
          el.style.translate = "";
        };
        if (!fechar) return voltarAoLugar();
        const fundo = janela.classList.contains("mk-sheet-root") ? /** @type {HTMLElement | null} */ (janela.querySelector(".mk-sheet-scrim")) : null;
        if (fundo) fundo.click();
        else janela.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        // Se a janela não pôde fechar (ex.: salvando), volta ao lugar.
        window.setTimeout(() => {
          if (janela.isConnected && (janela.classList.contains("mk-sheet-root") || janela.getAttribute("data-state") === "open")) voltarAoLugar();
        }, 450);
      }, fechar ? 200 : 230);
    };

    document.addEventListener("touchstart", inicio, { passive: true });
    document.addEventListener("touchmove", mover, { passive: false });
    document.addEventListener("touchend", fim);
    document.addEventListener("touchcancel", fim);
    return () => {
      document.removeEventListener("touchstart", inicio);
      document.removeEventListener("touchmove", mover);
      document.removeEventListener("touchend", fim);
      document.removeEventListener("touchcancel", fim);
    };
  }, []);
}

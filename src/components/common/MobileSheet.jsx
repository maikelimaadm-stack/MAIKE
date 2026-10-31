import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Alturas da folha: média ao abrir, grande ao puxar a alça para cima. */
const ALTURA_MEDIA = "62dvh";
const ALTURA_GRANDE = "92dvh";

/**
 * Folha que abre de baixo no celular (padrão único das aberturas do app).
 *
 * - Fundo preto `rgba(0,0,0,.45)`; tocar fora fecha.
 * - Alça no topo: tocar alterna média/grande; puxar para cima expande; puxar
 *   para baixo volta para a média ou, já na média, fecha.
 * - Altura fixa (62% / 92% da tela) — pesquisar dentro não faz a folha pular.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   label: string,
 *   title?: React.ReactNode,
 *   aside?: React.ReactNode,
 *   children: React.ReactNode,
 *   footer?: React.ReactNode,
 *   className?: string,
 *   role?: string,
 * }} props
 */
export default function MobileSheet({ open, onClose, label, title = null, aside = null, children, footer = null, className, role = "dialog" }) {
  const [grande, setGrande] = React.useState(false);
  const sheetRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const fecharRef = React.useRef(onClose);
  fecharRef.current = onClose;

  React.useEffect(() => {
    if (!open) {
      setGrande(false);
      return undefined;
    }
    const onKey = (event) => {
      if (event.key === "Escape") fecharRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const iniciarArraste = (event) => {
    const alca = event.currentTarget;
    const folha = sheetRef.current;
    if (!folha) return;
    event.preventDefault();
    try {
      alca.setPointerCapture(event.pointerId);
    } catch {
      /* navegador sem captura: segue pelos eventos da janela */
    }
    const y0 = event.clientY;
    const estavaGrande = grande;
    let dy = 0;
    let terminou = false;
    folha.style.transition = "none";

    const mover = (ev) => {
      dy = ev.clientY - y0;
      const desloc = estavaGrande ? Math.max(0, dy) : dy < 0 ? dy * 0.35 : dy;
      folha.style.transform = `translateY(${desloc}px)`;
    };
    const soltar = () => {
      if (terminou) return;
      terminou = true;
      alca.removeEventListener("pointermove", mover);
      alca.removeEventListener("pointerup", soltar);
      alca.removeEventListener("pointercancel", soltar);
      alca.removeEventListener("lostpointercapture", soltar);
      window.removeEventListener("pointerup", soltar);
      folha.style.transition = "transform .2s ease, height .25s cubic-bezier(.2,.8,.2,1)";
      if (Math.abs(dy) < 6) {
        folha.style.transform = "";
        setGrande(!estavaGrande);
        return;
      }
      if (dy < -40 && !estavaGrande) {
        folha.style.transform = "";
        setGrande(true);
        return;
      }
      if (dy > 70 && estavaGrande) {
        folha.style.transform = "";
        setGrande(false);
        return;
      }
      if (dy > 70) {
        folha.style.transform = "translateY(110%)";
        window.setTimeout(() => fecharRef.current?.(), 170);
        return;
      }
      folha.style.transform = "";
    };
    alca.addEventListener("pointermove", mover);
    alca.addEventListener("pointerup", soltar);
    alca.addEventListener("pointercancel", soltar);
    alca.addEventListener("lostpointercapture", soltar);
    window.addEventListener("pointerup", soltar);
  };

  if (!open || typeof document === "undefined") return null;

  const altura = grande ? ALTURA_GRANDE : ALTURA_MEDIA;

  return createPortal(
    <div className="mk-sheet-root">
      <div className="mk-sheet-scrim" onClick={() => onClose()} aria-hidden />
      <div
        ref={sheetRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        className={cn("mk-sheet", className)}
        style={{ height: altura, maxHeight: altura }}
      >
        <div
          className="mk-sheet__handle"
          onPointerDown={iniciarArraste}
          role="button"
          tabIndex={0}
          aria-label={grande ? "Reduzir painel" : "Expandir painel"}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setGrande((v) => !v);
            }
          }}
        >
          <span aria-hidden />
        </div>
        {/* Cabeçalho no estilo do app do Claude: ✕ redondo à esquerda, título ao centro. */}
        <div className="mk-sheet__head">
          <button type="button" className="mk-sheet__close" onClick={() => onClose()} aria-label="Fechar" title="Fechar">
            <X size={20} aria-hidden />
          </button>
          <span className="mk-sheet__title">{title || label}</span>
          <span className="mk-sheet__close-gap" aria-hidden />
        </div>
        {aside ? <div className="mk-sheet__aside">{aside}</div> : null}
        <div className="mk-sheet__body">{children}</div>
        {footer ? <div className="mk-sheet__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Acompanha uma media query (atualiza ao girar/redimensionar). */
export function useMediaQuery(consulta) {
  const ler = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(consulta).matches;
  const [casa, setCasa] = React.useState(ler);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(consulta);
    const onChange = () => setCasa(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [consulta]);
  return casa;
}

/** `true` abaixo de 640px (breakpoint `639px` do Base1). */
export function useCelular() {
  return useMediaQuery("(max-width: 639px)");
}

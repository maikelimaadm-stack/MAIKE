import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Altura média ao abrir (cartão flutuante); a grande vai até perto do topo. */
const FRACAO_MEDIA = 0.62;
const FOLGA_TOPO = 10;

/** Alvos que nunca começam o arraste da folha (digitar, rolar horizontal…). */
const NAO_ARRASTA = "input, textarea, select, [contenteditable='true'], [data-no-sheet-drag]";

const alturaGrande = () => {
  if (typeof window === "undefined") return 800;
  const topo = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mk-safe-top")) || 0;
  return window.innerHeight - FOLGA_TOPO - topo;
};

/**
 * Folha que abre de baixo no celular (padrão único das aberturas do app),
 * no comportamento das folhas do iOS / app do Claude (D-PROD-95):
 *
 * - **Média** (62%): cartão flutuante, com margem e os quatro cantos redondos.
 * - **Grande**: vai até perto do topo e encosta nas bordas da tela.
 * - Arrasta-se pela alça, pelo cabeçalho ou pela própria lista quando ela está
 *   no topo — não é preciso mirar na alça. Para cima expande; para baixo
 *   reduz e, já na média, fecha. Tocar na alça alterna.
 * - Fundo escuro; tocar fora ou Esc fecha.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   label: string,
 *   title?: React.ReactNode,
 *   aside?: React.ReactNode,
 *   headerAction?: React.ReactNode,
 *   children: React.ReactNode,
 *   footer?: React.ReactNode,
 *   className?: string,
 *   role?: string,
 *   initialLarge?: boolean,
 * }} props
 */
export default function MobileSheet({
  open,
  onClose,
  label,
  title = null,
  aside = null,
  headerAction = null,
  children,
  footer = null,
  className,
  role = "dialog",
  initialLarge = false,
}) {
  const [grande, setGrande] = React.useState(initialLarge);
  const [saindo, setSaindo] = React.useState(false);
  const sheetRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const bodyRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const fecharRef = React.useRef(onClose);
  fecharRef.current = onClose;
  const grandeRef = React.useRef(grande);
  grandeRef.current = grande;

  const fecharAnimado = React.useCallback(() => {
    const folha = sheetRef.current;
    if (!folha || !window.matchMedia?.("(max-width: 639px)").matches) {
      fecharRef.current?.();
      return;
    }
    setSaindo(true);
    window.setTimeout(() => fecharRef.current?.(), 200);
  }, []);

  React.useEffect(() => {
    if (!open) {
      setGrande(initialLarge);
      setSaindo(false);
      return undefined;
    }
    const onKey = (event) => {
      if (event.key === "Escape") fecharRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, initialLarge]);

  // Arraste por toque/caneta/mouse em qualquer ponto da folha.
  React.useEffect(() => {
    const folha = sheetRef.current;
    if (!open || !folha) return undefined;
    const celular = () => window.matchMedia?.("(max-width: 639px)").matches;

    /** @type {null | { y0: number, x0: number, h0: number, decidido: boolean, arrastando: boolean, ultimoY: number, ultimoT: number, vel: number, noCorpo: boolean }} */
    let g = null;

    const iniciar = (x, y, alvo) => {
      if (!celular()) return;
      if (alvo instanceof Element && alvo.closest(NAO_ARRASTA)) return;
      g = {
        y0: y,
        x0: x,
        h0: folha.getBoundingClientRect().height,
        decidido: false,
        arrastando: false,
        ultimoY: y,
        ultimoT: performance.now(),
        vel: 0,
        noCorpo: Boolean(alvo instanceof Element && bodyRef.current?.contains(alvo)),
      };
    };

    const mover = (x, y, ev) => {
      if (!g) return;
      const dy = y - g.y0;
      const dx = x - g.x0;
      if (!g.decidido) {
        if (Math.abs(dy) < 7 && Math.abs(dx) < 7) return;
        g.decidido = true;
        if (Math.abs(dx) > Math.abs(dy)) {
          g = null;
          return;
        }
        const corpo = bodyRef.current;
        const noTopo = !corpo || corpo.scrollTop <= 0;
        // Na lista: puxar para baixo só com a lista no topo; para cima só expande a média.
        g.arrastando = !g.noCorpo || (dy > 0 && noTopo) || (dy < 0 && !grandeRef.current);
        if (!g.arrastando) {
          g = null;
          return;
        }
        folha.style.transition = "none";
        folha.classList.add("is-dragging");
      }
      if (ev?.cancelable) ev.preventDefault();
      const agora = performance.now();
      g.vel = (y - g.ultimoY) / Math.max(1, agora - g.ultimoT);
      g.ultimoY = y;
      g.ultimoT = agora;
      const max = alturaGrande();
      const h = g.h0 - dy;
      if (h > max) {
        folha.style.height = `${max + (h - max) * 0.15}px`;
        folha.style.transform = "";
      } else if (h >= g.h0 || grandeRef.current) {
        folha.style.height = `${Math.max(h, window.innerHeight * FRACAO_MEDIA)}px`;
        const sobra = window.innerHeight * FRACAO_MEDIA - h;
        folha.style.transform = sobra > 0 ? `translateY(${sobra}px)` : "";
      } else {
        folha.style.height = `${g.h0}px`;
        folha.style.transform = `translateY(${g.h0 - h}px)`;
      }
    };

    const soltar = () => {
      if (!g) return;
      const estado = g;
      g = null;
      if (!estado.arrastando) return;
      const dy = estado.ultimoY - estado.y0;
      const media = window.innerHeight * FRACAO_MEDIA;
      const alturaFinal = estado.h0 - dy;
      folha.classList.remove("is-dragging");
      folha.style.transition = "";
      folha.style.height = "";
      folha.style.transform = "";
      const rapidoBaixo = estado.vel > 0.6;
      const rapidoCima = estado.vel < -0.6;
      // Evita que o clique que encerra o arraste escolha uma opção.
      const engolir = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };
      folha.addEventListener("click", engolir, { capture: true, once: true });
      window.setTimeout(() => folha.removeEventListener("click", engolir, { capture: true }), 350);
      if (rapidoCima || alturaFinal > (media + alturaGrande()) / 2) {
        setGrande(true);
        return;
      }
      if (grandeRef.current && !rapidoBaixo && alturaFinal > media * 0.7) {
        setGrande(false);
        return;
      }
      if (rapidoBaixo || alturaFinal < media * 0.72) {
        if (grandeRef.current && alturaFinal > media * 0.7) {
          setGrande(false);
          return;
        }
        fecharAnimado();
        return;
      }
      setGrande(false);
    };

    const onTouchStart = (e) => iniciar(e.touches[0].clientX, e.touches[0].clientY, e.target);
    const onTouchMove = (e) => mover(e.touches[0].clientX, e.touches[0].clientY, e);
    const onTouchEnd = () => soltar();
    const onPointerDown = (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      iniciar(e.clientX, e.clientY, e.target);
      const pm = (ev) => mover(ev.clientX, ev.clientY, ev);
      const pu = () => {
        window.removeEventListener("pointermove", pm);
        window.removeEventListener("pointerup", pu);
        soltar();
      };
      window.addEventListener("pointermove", pm);
      window.addEventListener("pointerup", pu);
    };

    folha.addEventListener("touchstart", onTouchStart, { passive: true });
    folha.addEventListener("touchmove", onTouchMove, { passive: false });
    folha.addEventListener("touchend", onTouchEnd);
    folha.addEventListener("touchcancel", onTouchEnd);
    folha.addEventListener("pointerdown", onPointerDown);
    return () => {
      folha.removeEventListener("touchstart", onTouchStart);
      folha.removeEventListener("touchmove", onTouchMove);
      folha.removeEventListener("touchend", onTouchEnd);
      folha.removeEventListener("touchcancel", onTouchEnd);
      folha.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, fecharAnimado]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={cn("mk-sheet-root", saindo && "is-leaving")}>
      <div className="mk-sheet-scrim" onClick={() => fecharAnimado()} aria-hidden />
      <div
        ref={sheetRef}
        role={role}
        aria-modal="true"
        aria-label={label}
        data-detent={grande ? "large" : "medium"}
        className={cn("mk-sheet", grande ? "is-large" : "is-medium", className)}
      >
        <div
          className="mk-sheet__handle"
          role="button"
          tabIndex={0}
          aria-label={grande ? "Reduzir painel" : "Expandir painel"}
          onClick={() => setGrande((v) => !v)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setGrande((v) => !v);
            }
          }}
        >
          <span aria-hidden />
        </div>
        {/* Cabeçalho no estilo do app do Claude: ✕ redondo à esquerda, título ao centro, ação à direita. */}
        <div className="mk-sheet__head">
          <button type="button" className="mk-sheet__close" onClick={() => fecharAnimado()} aria-label="Fechar" title="Fechar">
            <X size={20} aria-hidden />
          </button>
          <span className="mk-sheet__title">{title || label}</span>
          {headerAction ? <span className="mk-sheet__action">{headerAction}</span> : <span className="mk-sheet__close-gap" aria-hidden />}
        </div>
        {aside ? <div className="mk-sheet__aside">{aside}</div> : null}
        <div className="mk-sheet__body" ref={bodyRef}>
          {children}
        </div>
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

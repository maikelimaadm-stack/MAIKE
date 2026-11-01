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

  // Arraste por toque/caneta/mouse em qualquer ponto da folha (D-PROD-96):
  // durante o arraste só `transform` muda (sem recalcular layout a cada
  // movimento). No início a folha média ganha a altura da grande, deslocada
  // para baixo pelo que falta — visualmente igual; no fim anima até o destino
  // e só então troca a altura.
  React.useEffect(() => {
    const folha = sheetRef.current;
    if (!open || !folha) return undefined;
    const celular = () => window.matchMedia?.("(max-width: 639px)").matches;
    const CURVA = "transform 0.34s cubic-bezier(0.32, 0.72, 0, 1)";

    /** @type {null | { y0: number, x0: number, h0: number, max: number, base: number, desloc: number, decidido: boolean, arrastando: boolean, ultimoY: number, ultimoT: number, vel: number, noCorpo: boolean, quadro: number }} */
    let g = null;

    const pintar = () => {
      if (!g) return;
      g.quadro = 0;
      const d = g.desloc < 0 ? g.desloc * 0.18 : g.desloc;
      folha.style.transform = `translate3d(0, ${d}px, 0)`;
    };

    const iniciar = (x, y, alvo) => {
      if (!celular()) return;
      if (alvo instanceof Element && alvo.closest(NAO_ARRASTA)) return;
      g = {
        y0: y,
        x0: x,
        h0: 0,
        max: 0,
        base: 0,
        desloc: 0,
        decidido: false,
        arrastando: false,
        ultimoY: y,
        ultimoT: performance.now(),
        vel: 0,
        noCorpo: Boolean(alvo instanceof Element && bodyRef.current?.contains(alvo)),
        quadro: 0,
      };
    };

    const mover = (x, y, ev) => {
      if (!g) return;
      const dy = y - g.y0;
      const dx = x - g.x0;
      if (!g.decidido) {
        // iOS: se o primeiro touchmove não for cancelado a lista começa a rolar
        // e o arraste da folha engasga. Cancela já no primeiro milímetro quando
        // o gesto só pode ser da folha (cabeçalho/alça, lista no topo puxando
        // para baixo, média puxando para cima).
        if (ev?.cancelable && Math.abs(dy) >= Math.abs(dx)) {
          const corpo = bodyRef.current;
          const daFolha = !g.noCorpo || (dy > 0 && (!corpo || corpo.scrollTop <= 0)) || (dy < 0 && !grandeRef.current);
          if (daFolha) ev.preventDefault();
        }
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
        g.h0 = folha.getBoundingClientRect().height;
        g.max = alturaGrande();
        folha.classList.add("is-dragging");
        folha.style.transition = "none";
        // Altura fixa na da grande durante todo o arraste (a média fica deslocada
        // para baixo: mesma aparência). Assim só `transform` muda até soltar.
        folha.style.height = `${g.max}px`;
        folha.style.maxHeight = "none";
        g.base = grandeRef.current ? 0 : g.max - g.h0;
      }
      if (ev?.cancelable) ev.preventDefault();
      const agora = performance.now();
      g.vel = (y - g.ultimoY) / Math.max(1, agora - g.ultimoT);
      g.ultimoY = y;
      g.ultimoT = agora;
      g.desloc = g.base + dy;
      if (!g.quadro) g.quadro = requestAnimationFrame(pintar);
    };

    /** Anima até `alvo` px e chama `depois` ao terminar. As margens e cantos da
     *  troca média ↔ grande animam junto, na mesma curva (sem salto no fim). */
    const animarAte = (alvo, depois) => {
      folha.classList.remove("is-dragging");
      folha.style.transition = `${CURVA}, left 0.34s cubic-bezier(0.32, 0.72, 0, 1), right 0.34s cubic-bezier(0.32, 0.72, 0, 1), bottom 0.34s cubic-bezier(0.32, 0.72, 0, 1), border-radius 0.34s cubic-bezier(0.32, 0.72, 0, 1)`;
      folha.style.transform = `translate3d(0, ${alvo}px, 0)`;
      let feito = false;
      const fim = () => {
        if (feito) return;
        feito = true;
        folha.removeEventListener("transitionend", fim);
        depois();
      };
      folha.addEventListener("transitionend", fim);
      window.setTimeout(fim, 380);
    };

    const limpar = () => {
      // Altura volta para a da classe e o deslocamento zera no mesmo quadro:
      // a borda de cima não se mexe.
      folha.style.transition = "none";
      folha.style.height = "";
      folha.style.maxHeight = "";
      folha.style.transform = "";
      requestAnimationFrame(() => {
        folha.style.transition = "";
      });
    };

    const soltar = () => {
      if (!g) return;
      const estado = g;
      g = null;
      if (estado.quadro) cancelAnimationFrame(estado.quadro);
      if (!estado.arrastando) return;
      // Evita que o clique que encerra o arraste escolha uma opção.
      const engolir = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };
      folha.addEventListener("click", engolir, { capture: true, once: true });
      window.setTimeout(() => folha.removeEventListener("click", engolir, { capture: true }), 350);

      const media = window.innerHeight * FRACAO_MEDIA;
      const visivel = estado.max - Math.max(0, estado.desloc);
      const rapidoBaixo = estado.vel > 0.6;
      const rapidoCima = estado.vel < -0.6;
      let destino = "media";
      if (rapidoCima || visivel > (media + estado.max) / 2) destino = "grande";
      else if (rapidoBaixo ? !grandeRef.current || visivel < media * 0.9 : visivel < media * 0.72) {
        destino = grandeRef.current && !rapidoBaixo && visivel > media * 0.7 ? "media" : "fechar";
      }
      if (destino === "grande") {
        // Troca a classe já: margens e cantos animam junto com o deslizamento.
        setGrande(true);
        animarAte(0, limpar);
      } else if (destino === "media") {
        setGrande(false);
        animarAte(estado.max - media, limpar);
      } else {
        animarAte(estado.max + 40, () => fecharRef.current?.());
      }
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

import React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { CheckRow, PillBtn } from "./Base1Ui";

/**
 * Painel de visibilidade de colunas (lista + Restaurar/OK), ancorado no botão da faixa de filtros.
 * Paridade popover de campos dos cards / frota-equipamentos.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(o: boolean) => void} props.onOpenChange
 * @param {import('react').RefObject<HTMLElement | null>} [props.anchorRef]
 * @param {Array<{ id: string; label: string; fixo?: boolean }>} props.columns
 * @param {string[]} props.visibleKeys
 * @param {string[]} props.defaultVisible
 * @param {(keys: string[]) => void} props.onApply
 */
export default function ConfiguracaoColunasBase1Popover({
  open,
  onOpenChange,
  anchorRef,
  columns,
  visibleKeys,
  defaultVisible,
  onApply,
}) {
  const [draft, setDraft] = React.useState(visibleKeys);
  const [pos, setPos] = React.useState(/** @type {React.CSSProperties} */ ({ visibility: "hidden" }));
  const panelRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const restoreFocusRef = React.useRef(/** @type {HTMLElement | null} */ (null));

  React.useEffect(() => {
    if (open) setDraft(visibleKeys);
  }, [open, visibleKeys]);

  const fechar = React.useRef(onOpenChange);
  fechar.current = onOpenChange;

  React.useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const teclado = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        fechar.current(false);
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = /** @type {HTMLElement} */ (focusables[0]);
        const last = /** @type {HTMLElement} */ (focusables[focusables.length - 1]);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", teclado);
    return () => document.removeEventListener("keydown", teclado);
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
      return;
    }
    const id = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector('input[type="checkbox"]');
      if (first instanceof HTMLElement) first.focus();
      else panelRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const el =
      anchorRef?.current ?? document.querySelector('[data-testid="b1-col-config-trigger"]');
    if (!el) return;
    const b = el.getBoundingClientRect();
    const width = 288;
    const left = Math.max(8, Math.min(b.right - width, window.innerWidth - width - 8));
    const abaixo = window.innerHeight - b.bottom - 12;
    const acima = b.top - 12;
    const openBelow = abaixo >= 280 || abaixo >= acima;
    setPos(
      openBelow
        ? { top: b.bottom + 6, left, maxHeight: Math.min(abaixo, 420) }
        : { bottom: window.innerHeight - b.top + 6, left, maxHeight: Math.min(acima, 420) },
    );
  }, [open, anchorRef, visibleKeys]);

  const toggle = (id, on) => {
    setDraft((d) => {
      if (on) return d.includes(id) ? d : [...d, id];
      const next = d.filter((k) => k !== id);
      return next.length ? next : d;
    });
  };

  const sorted = [...columns]
    .filter((c) => !c.fixo)
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  if (!open) return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Fechar configuração de colunas"
        tabIndex={-1}
        className="fixed inset-0 z-[59] cursor-default"
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Configurar colunas da tabela"
        tabIndex={-1}
        className={cn(
          "cadastro-b1 mg-b1-glass-pop fixed z-[60] w-72 rounded-[14px] p-3 text-[12.5px] outline-none",
        )}
        style={pos}
      >
        <div
          className="overflow-auto"
          style={{ maxHeight: typeof pos.maxHeight === "number" ? pos.maxHeight - 56 : 288 }}
          role="group"
        >
          {sorted.map((c) => (
            <CheckRow
              key={c.id}
              label={c.label}
              checked={draft.includes(c.id)}
              onChange={(on) => toggle(c.id, on)}
            />
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <PillBtn
            tone="gray"
            className="flex-1 justify-center"
            onClick={() => {
              onApply(defaultVisible);
              onOpenChange(false);
            }}
          >
            Restaurar
          </PillBtn>
          <PillBtn
            className="flex-1 justify-center"
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            OK
          </PillBtn>
        </div>
      </div>
    </>,
    document.body,
  );
}

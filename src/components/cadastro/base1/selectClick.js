import { useEffect } from "react";

/** @typedef {{ ctrl: boolean; shift: boolean }} SelectClick */

/** Impede seleção nativa de texto na grade/cards (sem `onSelectStart` no JSX). */
/** @param {import('react').RefObject<HTMLElement|null>} ref */
export function useBlockNativeTextSelection(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    /** @param {Event} e */
    const blockSelectStart = (e) => e.preventDefault();
    const clearSelection = () => {
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount > 0) sel.removeAllRanges();
    };
    el.addEventListener("selectstart", blockSelectStart);
    el.addEventListener("mousedown", clearSelection);
    return () => {
      el.removeEventListener("selectstart", blockSelectStart);
      el.removeEventListener("mousedown", clearSelection);
    };
  }, [ref]);
}

/** Clique vindo de toque (celular/tablet). `click` é `PointerEvent` nos navegadores atuais. */
/** @param {MouseEvent | React.MouseEvent | React.KeyboardEvent} e */
export function ehToque(e) {
  const nativo = /** @type {any} */ ("nativeEvent" in e ? e.nativeEvent : e);
  return nativo?.pointerType === "touch" || nativo?.pointerType === "pen";
}

/**
 * No toque não existe Ctrl: cada toque marca ou desmarca o registro, para
 * selecionar vários. No mouse continua o padrão (clique troca a seleção).
 * @param {MouseEvent | React.MouseEvent | React.KeyboardEvent} e
 */
export function selectClickOf(e) {
  return {
    ctrl: e.ctrlKey || e.metaKey || ehToque(e),
    shift: e.shiftKey,
  };
}

let ultimoToque = /** @type {{ id: string, t: number } | null} */ (null);

/**
 * Toque duplo no mesmo registro (≤ 380 ms) — o `dblclick` nativo não é
 * confiável no celular. Só conta toques; no mouse o `onDoubleClick` resolve.
 * @param {MouseEvent | React.MouseEvent} e
 * @param {string} id
 */
export function ehToqueDuplo(e, id) {
  if (!ehToque(e)) return false;
  const agora = Date.now();
  if (ultimoToque && ultimoToque.id === id && agora - ultimoToque.t < 380) {
    ultimoToque = null;
    return true;
  }
  ultimoToque = { id, t: agora };
  return false;
}

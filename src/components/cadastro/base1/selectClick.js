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

/** @param {MouseEvent | React.MouseEvent | React.KeyboardEvent} e */
export function selectClickOf(e) {
  return {
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
  };
}

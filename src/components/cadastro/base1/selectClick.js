/** @typedef {{ ctrl: boolean; shift: boolean }} SelectClick */

/** @param {MouseEvent | React.MouseEvent | React.KeyboardEvent} e */
export function selectClickOf(e) {
  return {
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
  };
}

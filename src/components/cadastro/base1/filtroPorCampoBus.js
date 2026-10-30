/**
 * Botão Filtros do chrome → painel "Filtrar por campo" da grade.
 *
 * O chrome e a grade são irmãos montados pela tela (a grade chega por slot),
 * então o pedido vai por evento de documento. Só uma lista Base1 fica montada
 * por vez.
 */
export const EVENTO_FILTRAR_POR_CAMPO = "maike:b1-filtrar-por-campo";

/** @param {DOMRect | null} ancora retângulo do botão Filtros */
export function pedirFiltroPorCampo(ancora) {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(EVENTO_FILTRAR_POR_CAMPO, { detail: { ancora } }));
}

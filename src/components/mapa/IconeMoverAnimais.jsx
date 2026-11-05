import React from "react";

/**
 * Ícone do manejo "Mover" (animais entre pastos): boi entre duas porteiras com
 * as setas de troca — imagem fornecida pelo proprietário (D-PROD-131).
 * Fica no lugar de um ícone lucide no quadro de AcoesDoLote.
 *
 * @param {{ className?: string }} props
 */
export default function IconeMoverAnimais({ className = "" }) {
  return <img src="/icons/mover-animais.png" alt="" aria-hidden="true" draggable={false} className={`mk-al__img ${className}`.trim()} />;
}

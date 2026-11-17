import React from "react";
import { Beef } from "lucide-react";
import { Vazio } from "./blocos";

/*
 * Tela empilhada do lote (Detalhes do Lote v12, D-PROD-V12). Provisório da
 * casca: a peça LOTES entrega os blocos do lote `loteId`. O cabeçalho (nome,
 * "CAT · Área", ‹) e o rodapé (Mover · Pesar · Manejos) são da casca.
 */

/** @param {{ loteId: string }} props */
export default function TelaLote({ loteId }) {
  return <Vazio icone={Beef}>Em construção.</Vazio>;
}

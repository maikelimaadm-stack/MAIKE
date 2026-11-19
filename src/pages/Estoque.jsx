import React from "react";
import EstoqueTela from "@/components/estoque/EstoqueTela";

/**
 * Estoque (D-PROD-255) — Saldo e Movimentos (kardex) da fazenda, somente consulta.
 * Menu: Suporte do Mapa → Estoque (tela `sup-estoque`, ação `visualizar`).
 */
export default function Estoque() {
  return <EstoqueTela />;
}

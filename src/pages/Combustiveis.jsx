import React from "react";
import CatalogoPatrimonioTela from "@/components/patrimonio/CatalogoPatrimonioTela";

/** Combustíveis (D-PROD-157) — catálogo classificatório do tenant (sem preço, custo ou saldo) para os tanques dos bens. */
export default function Combustiveis() {
  return <CatalogoPatrimonioTela recurso="combustiveis" />;
}

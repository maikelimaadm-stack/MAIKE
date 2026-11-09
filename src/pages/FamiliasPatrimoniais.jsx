import React from "react";
import CatalogoPatrimonioTela from "@/components/patrimonio/CatalogoPatrimonioTela";

/** Famílias Patrimoniais (D-PROD-156) — catálogo do tenant; a natureza da família decide o que o bem tem. */
export default function FamiliasPatrimoniais() {
  return <CatalogoPatrimonioTela recurso="familias" />;
}

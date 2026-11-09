import React from "react";
import CatalogoPatrimonioTela from "@/components/patrimonio/CatalogoPatrimonioTela";

/** Tipos Patrimoniais (D-PROD-156) — catálogo do tenant, por família; perfis de medição sugeridos para benfeitorias. */
export default function TiposPatrimoniais() {
  return <CatalogoPatrimonioTela recurso="tipos" />;
}

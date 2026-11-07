import React from "react";
import CentrosCadastroTela from "@/components/gestao/CentrosCadastroTela";

/** Centros de Custo (Gestão Rural, D-PROD-145) — cadastro com hierarquia e vínculo N:N; sem valores. */
export default function CentrosCusto() {
  return <CentrosCadastroTela tipo="custo" />;
}

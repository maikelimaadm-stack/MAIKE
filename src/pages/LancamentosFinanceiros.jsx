import React from "react";
import LancamentosFinanceirosTela from "@/components/financeiroGestao/LancamentosFinanceirosTela";

/**
 * Central Única de Lançamentos (Gestão Rural P3-01, D-PROD-155) — documento
 * gerencial nativo: pagar/receber, com ou sem produtos, títulos, baixas manuais
 * e integração mínima de estoque. Sem conciliação, fiscal ou contabilidade.
 */
export default function LancamentosFinanceiros() {
  return <LancamentosFinanceirosTela />;
}

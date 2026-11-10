import React from "react";
import AbastecimentosTela from "@/components/patrimonio/AbastecimentosTela";

/**
 * Abastecimentos (Patrimônio e Frota P1-02, D-PROD-159) — abastecimento e
 * consumo da frota da empresa: litros informados, KG convertido pelo fator
 * informado pelo responsável e baixa física FIFO do estoque. Sem manutenção,
 * ordem de serviço ou lançamento financeiro.
 */
export default function Abastecimentos() {
  return <AbastecimentosTela />;
}

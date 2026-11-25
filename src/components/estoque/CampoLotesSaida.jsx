import React from "react";
import CampoLotes from "@/components/estoque/CampoLotes";
import { quantidadeDeEstoque } from "@/lib/estoqueLotesRegras";

/**
 * D-PROD-282 — campo "Lote" de uma linha de SAÍDA ou TRANSFERÊNCIA do Estoque: o `CampoLotes` reutilizável lendo o
 * formato da linha (`produto`, `deposito`, `quantidade` em texto, `unidade` SACO → kg). O estado continua na linha:
 * `lotes`, `confirmaVencido`, `loteVencido` e `erroLote`. Produto sem lote: não aparece.
 * @param {{ empresaId: string, linha: any, onMudar: (patch: Record<string, unknown>) => void, testId: string }} props
 */
export default function CampoLotesSaida({ empresaId, linha, onMudar, testId }) {
  return (
    <CampoLotes
      empresaId={empresaId}
      produto={linha?.produto}
      localId={linha?.deposito?.id}
      quantidade={quantidadeDeEstoque(linha)}
      lotes={linha?.lotes}
      confirmaVencido={linha?.confirmaVencido}
      loteVencido={linha?.loteVencido}
      erroLote={linha?.erroLote}
      onMudar={onMudar}
      testId={testId}
    />
  );
}

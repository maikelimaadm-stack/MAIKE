import React from "react";
import { Button } from "@/components/ui/button";

/**
 * Botões de ação compactos - sem descrição de cada botão, estilo cocho/depósito.
 */
export default function BotoesAcaoLote({
  lotes = [],
  onMover,
  onPesar,
  onMudarCategoria,
  onNascimento,
  onMorte,
  onAbate,
  onHistorico,
  onHistoricoSupl,
  onRenomear,
  onJuntar,
  podeJuntar,
  motivoNaoJuntar,
}) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-3 gap-1">
        <Button onClick={onMover} variant="outline" size="sm" className="h-8 text-xs">Mover</Button>
        <Button onClick={onPesar} variant="outline" size="sm" className="h-8 text-xs">Pesar</Button>
        <Button onClick={onMudarCategoria} variant="outline" size="sm" className="h-8 text-xs">Categoria</Button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Button onClick={onNascimento} variant="outline" size="sm" className="h-8 text-xs">Nascimento</Button>
        <Button onClick={onMorte} variant="outline" size="sm" className="h-8 text-xs">Morte</Button>
        <Button onClick={onAbate} variant="outline" size="sm" className="h-8 text-xs">Abate</Button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button onClick={onHistorico} variant="outline" size="sm" className="h-8 text-xs">Histórico Mov.</Button>
        <Button onClick={onHistoricoSupl} variant="outline" size="sm" className="h-8 text-xs">Histórico Supl.</Button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Button onClick={onRenomear} variant="outline" size="sm" className="h-8 text-xs">Renomear</Button>
        {lotes.length > 1 && (
          <Button
            onClick={onJuntar}
            variant="outline"
            size="sm"
            className={`h-8 text-xs ${!podeJuntar ? "opacity-50" : ""}`}
            disabled={!podeJuntar}
            title={motivoNaoJuntar || ""}
          >
            Juntar Lotes
          </Button>
        )}
      </div>
    </div>
  );
}
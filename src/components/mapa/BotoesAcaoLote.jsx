import React from "react";
import { Button } from "@/components/ui/button";

/**
 * Botões de ação agrupados por função para o dashboard de lotes.
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
    <div className="space-y-2">
      {/* Manejo */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Manejo</div>
        <div className="grid grid-cols-3 gap-1.5">
          <Button onClick={onMover} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Mover</Button>
          <Button onClick={onPesar} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Pesar</Button>
          <Button onClick={onMudarCategoria} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Mudar Categoria</Button>
        </div>
      </div>

      {/* Eventos */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Eventos</div>
        <div className="grid grid-cols-3 gap-1.5">
          <Button onClick={onNascimento} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Nascimento</Button>
          <Button onClick={onMorte} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Morte</Button>
          <Button onClick={onAbate} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Abate</Button>
        </div>
      </div>

      {/* Histórico */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Histórico</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button onClick={onHistorico} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Histórico Movimentações</Button>
          <Button onClick={onHistoricoSupl} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Histórico Suplementação</Button>
        </div>
      </div>

      {/* Administração */}
      <div>
        <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Administração</div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button onClick={onRenomear} variant="outline" size="sm" className="h-8 text-xs font-semibold border-slate-300">Renomear Lote</Button>
          {lotes.length > 1 && (
            <Button
              onClick={onJuntar}
              variant="outline"
              size="sm"
              className={`h-8 text-xs font-semibold border-slate-300 ${!podeJuntar ? "opacity-50" : ""}`}
              disabled={!podeJuntar}
              title={motivoNaoJuntar || ""}
            >
              Juntar Lotes
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
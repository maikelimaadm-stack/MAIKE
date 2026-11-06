import React from "react";
import { X } from "lucide-react";
import { useCelular } from "@/components/common/MobileSheet";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Filtros do mapa: folha com gestos no celular; painel lateral nas demais telas. */
export default function MapaFiltrosPainel({ open, onOpenChange, children }) {
  const celular = useCelular();
  if (celular) return (
    <LancLoteDialogo open={open} onOpenChange={onOpenChange} titulo="Filtros e Camadas" somenteLeitura folhaMobile>
      <div className="mk-map-filter-mobile">{children}</div>
    </LancLoteDialogo>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="mk-map-filter-sheet overflow-y-auto">
        <SheetHeader className="mk-map-filter-header">
          <button type="button" className="mk-map-panel-close" aria-label="Fechar filtros" onClick={() => onOpenChange(false)}><X size={16} aria-hidden /></button>
          <SheetTitle className="text-sm">Filtros e Camadas</SheetTitle><span aria-hidden />
        </SheetHeader>
        <div className="mt-3">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

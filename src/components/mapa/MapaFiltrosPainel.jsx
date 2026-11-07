import React from "react";
import { X } from "lucide-react";
import { MobileSheetPortalCtx } from "@/components/common/MobileSheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** Painel lateral compartilhado entre filtros e visualização.
 * @param {{open: boolean, onOpenChange: (open: boolean) => void, children: React.ReactNode, side?: "left" | "right", titulo?: string, fecharLabel?: string}} props
 */
export default function MapaFiltrosPainel({ open, onOpenChange, children, side = "left", titulo = "Filtros e Camadas", fecharLabel = "Fechar filtros" }) {
  const [alvoFolha, setAlvoFolha] = React.useState(/** @type {HTMLElement | null} */ (null));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={`mk-map-filter-host mk-map-filter-host--${side}`}
        onEscapeKeyDown={(event) => {
          if (alvoFolha?.querySelector(".mk-sheet-root")) event.preventDefault();
        }}>
        <div className="mk-map-filter-sheet h-full overflow-y-auto">
        <SheetHeader className="mk-map-filter-header">
          <button type="button" className="mk-map-panel-close" aria-label={fecharLabel} onClick={() => onOpenChange(false)}><X size={16} aria-hidden /></button>
          <SheetTitle className="text-sm">{titulo}</SheetTitle><span aria-hidden />
        </SheetHeader>
        <MobileSheetPortalCtx.Provider value={alvoFolha}>
          <div className="mt-3">{children}</div>
        </MobileSheetPortalCtx.Provider>
        </div>
        {/* Fora do recorte/rolagem lateral, mas dentro do modal para foco/toque. */}
        <div ref={setAlvoFolha} />
      </SheetContent>
    </Sheet>
  );
}

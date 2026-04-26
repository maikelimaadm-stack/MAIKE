import React from "react";
import { Button } from "@/components/ui/button";
import { X, Filter, Target, RefreshCw, ClipboardList, Move } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function MapaControlesMobile({
  mapType, setMapType,
  onRefresh, onLocate, onToggleDrag,
  dragEnabled = false,
  onOpenTarefas, onOpenInsights, onOpenFiltros,
  showTarefasButton = true,
  showInsightsButton = true,
  showFiltrosButton = true
}) {
  const navigate = useNavigate();

  return (
    <>
      {/* Top-left: voltar + ações */}
      <div className="bg-slate-700 p-1 rounded-lg absolute top-1 left-1 z-20 flex gap-1.5 spacy-1 gap-1 shadow-md">
        <Button
          variant="secondary"
          size="icon" className="bg-neutral-50 text-secondary-foreground text-sm font-medium rounded-full inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-secondary/80 h-7 w-7 shadow-md"

          onClick={() => navigate(-1)}>
          
          <X className="w-5 h-5 text-slate-700" />
        </Button>
        {showTarefasButton &&
        <Button variant="secondary" size="icon" onClick={onOpenTarefas} className="bg-neutral-50 text-secondary-foreground text-sm font-medium rounded-full inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-secondary/80 h-7 w-7 shadow-md" title="Tarefas">
            <ClipboardList className="w-5 h-5 text-slate-700" />
          </Button>
        }
        



        
        {showFiltrosButton &&
        <Button variant="secondary" size="icon" onClick={onOpenFiltros} className="bg-neutral-50 text-secondary-foreground text-sm font-medium rounded-full inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-secondary/80 h-7 w-7 shadow-md" title="Filtros">
            <Filter className="w-5 h-5 text-slate-700" />
          </Button>
        }
      </div>

      {/* Top-right: mapa/satélite + ações */}
      <div className="absolute top-1 right-1 z-20 flex flex-col items-end gap-1.5">
        <div className="bg-slate-700 p-1 rounded-full flex gap-1 shadow-md pointer-events-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMapType('roadmap')}
            className={`h-9 px-4 text-xs rounded-full border shadow-sm pointer-events-auto ${mapType === 'roadmap' ? 'bg-black text-white border-black hover:bg-black' : 'bg-white text-black border-slate-300 hover:bg-slate-100'}`}>
            Mapa
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMapType('satellite')}
            className={`h-9 px-4 text-xs rounded-full border shadow-sm pointer-events-auto ${mapType === 'satellite' ? 'bg-black text-white border-black hover:bg-black' : 'bg-white text-black border-slate-300 hover:bg-slate-100'}`}>
            Satélite
          </Button>
        </div>
        <div className="bg-slate-700 p-1 rounded-full flex gap-1.5 shadow-md pointer-events-auto">
          <Button type="button" variant="secondary" size="icon" onClick={onRefresh} className="bg-neutral-50 hover:bg-neutral-100 text-slate-700 h-9 w-9 rounded-full shadow-md pointer-events-auto">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button type="button" variant="secondary" size="icon" onClick={onLocate} className="bg-neutral-50 hover:bg-neutral-100 text-slate-700 h-9 w-9 rounded-full shadow-md pointer-events-auto">
            <Target className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={onToggleDrag}
            className={`h-9 w-9 rounded-full shadow-md pointer-events-auto ${dragEnabled ? 'bg-black text-white hover:bg-black' : 'bg-neutral-50 hover:bg-neutral-100 text-slate-700'}`}
            title="Ativar arrasto">
            <Move className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </>);

}
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
      <div className="absolute top-1 left-1 z-20 flex gap-1.5">
        <Button
          variant="secondary"
          size="icon" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground hover:bg-secondary/80 h-7 w-7 rounded-full bg-white/95 shadow-md"

          onClick={() => navigate(-1)}>
          
          <X className="w-5 h-5 text-slate-700" />
        </Button>
        {showTarefasButton &&
        <Button variant="secondary" size="icon" onClick={onOpenTarefas} className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground hover:bg-secondary/80 h-10 w-10 rounded-full bg-white/95 shadow-md" title="Tarefas">
            <ClipboardList className="w-5 h-5 text-slate-700" />
          </Button>
        }
        



        
        {showFiltrosButton &&
        <Button variant="secondary" size="icon" onClick={onOpenFiltros} className="h-10 w-10 rounded-full bg-white/95 shadow-md" title="Filtros">
            <Filter className="w-5 h-5 text-slate-700" />
          </Button>
        }
      </div>

      {/* Top-right: mapa/satélite + refresh + localizar */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5">
        <div className="flex gap-1 bg-white/95 rounded-lg shadow-md p-0.5">
          <Button
            variant={mapType === 'roadmap' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMapType('roadmap')}
            className="h-7 px-2 text-[10px] rounded-md">
            
            Mapa
          </Button>
          <Button
            variant={mapType === 'satellite' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMapType('satellite')}
            className="h-7 px-2 text-[10px] rounded-md">
            
            Sat
          </Button>
        </div>
        <Button variant="secondary" size="icon" onClick={onRefresh} className="h-8 w-8 rounded-full bg-white/95 shadow-md self-end">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
        <Button variant="secondary" size="icon" onClick={onLocate} className="h-8 w-8 rounded-full bg-white/95 shadow-md self-end">
          <Target className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant={dragEnabled ? "default" : "secondary"}
          size="icon"
          onClick={onToggleDrag}
          className={`h-8 w-8 rounded-full shadow-md self-end ${dragEnabled ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-white/95 text-slate-700'}`}
          title="Ativar arrasto">
          <Move className="w-3.5 h-3.5" />
        </Button>
      </div>
    </>);

}
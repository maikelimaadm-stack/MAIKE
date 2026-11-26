import React from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Foto em tela cheia (com anterior/próxima e as miniaturas). Saiu de dentro da `FotosTarefaGaleria` (D-PROD-324)
 * para abrir também as fotos do formulário e as guardadas no aparelho.
 * @param {{ fotos: string[], indice: number | null, onMudar: (i: number) => void, onFechar: () => void, legendas?: Array<string | null | undefined> }} props
 */
export default function VisualizadorDeFotos({ fotos, indice, onMudar, onFechar, legendas = [] }) {
  if (indice === null || indice === undefined || !fotos.length) return null;
  const total = fotos.length;
  const atual = Math.min(Math.max(indice, 0), total - 1);
  const anterior = () => onMudar((atual - 1 + total) % total);
  const proxima = () => onMudar((atual + 1) % total);
  const legenda = legendas[atual];

  return (
    <div
      role="dialog"
      aria-label="Foto da tarefa"
      className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center"
      onClick={onFechar}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") anterior();
        if (e.key === "ArrowRight") proxima();
        if (e.key === "Escape") onFechar();
      }}
      tabIndex={-1}
      ref={(el) => el?.focus()}
    >
      <button type="button" onClick={onFechar} aria-label="Fechar foto" className="absolute top-4 right-4 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors">
        <X className="w-5 h-5" />
      </button>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
        {atual + 1} / {total}
      </div>

      {total > 1 && (
        <button type="button" aria-label="Foto anterior" onClick={(e) => { e.stopPropagation(); anterior(); }} className="absolute left-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      <div className="max-w-[90vw] max-h-[85vh] flex flex-col items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
        <img src={fotos[atual]} alt={`Foto ${atual + 1}`} className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl" />
        {legenda ? <span className="text-amber-200 text-xs font-medium">{legenda}</span> : null}
      </div>

      {total > 1 && (
        <button type="button" aria-label="Próxima foto" onClick={(e) => { e.stopPropagation(); proxima(); }} className="absolute right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 transition-colors">
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {total > 1 && (
        <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 overflow-x-auto">
          {fotos.map((url, idx) => (
            <button
              key={idx}
              type="button"
              onClick={(e) => { e.stopPropagation(); onMudar(idx); }}
              className={`flex-shrink-0 w-12 h-12 rounded-md overflow-hidden border-2 transition-all ${idx === atual ? "border-emerald-400 scale-110" : "border-white/30 hover:border-white/60"}`}
            >
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { X, ChevronLeft, ChevronRight, ImageOff, ZoomIn } from "lucide-react";

/**
 * Galeria de fotos para tarefas com lightbox integrado.
 * Aceita campo `fotos` ou `anexos_urls` (legado).
 */
export default function FotosTarefaGaleria({ tarefa, compact = false }) {
  const [lightboxIdx, setLightboxIdx] = useState(null);

  // Suporta ambos os campos (novo: fotos, legado: anexos_urls)
  const fotos = [...(tarefa?.fotos || []), ...(tarefa?.anexos_urls || [])].filter(Boolean);

  if (!fotos.length) return null;

  const openLightbox = (idx) => setLightboxIdx(idx);
  const closeLightbox = () => setLightboxIdx(null);
  const prev = () => setLightboxIdx((i) => (i - 1 + fotos.length) % fotos.length);
  const next = () => setLightboxIdx((i) => (i + 1) % fotos.length);

  const handleKeyDown = (e) => {
    if (e.key === "ArrowLeft") prev();
    if (e.key === "ArrowRight") next();
    if (e.key === "Escape") closeLightbox();
  };

  return (
    <>
      <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-2 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
            Fotos <span className="text-slate-400 font-normal">({fotos.length})</span>
          </p>
        </div>

        <div className={`grid gap-2 ${compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5"}`}>
          {fotos.map((url, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => openLightbox(idx)}
              className="relative aspect-square rounded-md overflow-hidden border border-slate-200 bg-slate-100 group hover:border-emerald-400 transition-all"
            >
              <img
                src={url}
                alt={`Foto ${idx + 1}`}
                className="w-full h-full object-cover"
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              />
              <div className="hidden w-full h-full items-center justify-center bg-slate-100">
                <ImageOff className="w-5 h-5 text-slate-400" />
              </div>
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
              </div>
              <span className="absolute bottom-0.5 right-1 text-[9px] text-white/80 font-medium drop-shadow">{idx + 1}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
          onClick={closeLightbox}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          {/* Fechar */}
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute top-4 right-4 z-10 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Contador */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm">
            {lightboxIdx + 1} / {fotos.length}
          </div>

          {/* Anterior */}
          {fotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); prev(); }}
              className="absolute left-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 transition-colors"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Imagem principal */}
          <div className="max-w-[90vw] max-h-[85vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img
              src={fotos[lightboxIdx]}
              alt={`Foto ${lightboxIdx + 1}`}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
          </div>

          {/* Próxima */}
          {fotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); next(); }}
              className="absolute right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 transition-colors"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}

          {/* Miniaturas */}
          {fotos.length > 1 && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 px-4 overflow-x-auto">
              {fotos.map((url, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxIdx(idx); }}
                  className={`flex-shrink-0 w-12 h-12 rounded-md overflow-hidden border-2 transition-all ${
                    idx === lightboxIdx ? "border-emerald-400 scale-110" : "border-white/30 hover:border-white/60"
                  }`}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
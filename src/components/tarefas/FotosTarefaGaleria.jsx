import React, { useState } from "react";
import { X, ImageOff, ZoomIn } from "lucide-react";
import VisualizadorDeFotos from "./VisualizadorDeFotos";

/** Texto do selo e da legenda da foto guardada no aparelho (D-PROD-324). */
export const ROTULO_FOTO_GUARDADA = "Aguardando envio";

/**
 * Galeria de fotos para tarefas com a foto em tela cheia.
 * Aceita campo `fotos` ou `anexos_urls` (legado).
 *
 * D-PROD-324: `guardadas` — fotos tiradas sem internet, guardadas no aparelho ({ chave, url }): aparecem depois das
 * enviadas, com o selo "Aguardando envio", abrem em tela cheia como as outras e, com `onExcluirGuardada`, têm o ✕
 * (sempre visível: no celular não há "passar o mouse").
 *
 * @param {{ tarefa: any, compact?: boolean, guardadas?: Array<{ chave: string|number, url: string }>, onExcluirGuardada?: ((chave: string|number) => void) | null }} props
 */
export default function FotosTarefaGaleria({ tarefa, compact = false, guardadas = [], onExcluirGuardada = null }) {
  const [aberta, setAberta] = useState(/** @type {number | null} */ (null));

  // Suporta ambos os campos (novo: fotos, legado: anexos_urls)
  const enviadas = [...(tarefa?.fotos || []), ...(tarefa?.anexos_urls || [])].filter(Boolean);
  const todas = [...enviadas, ...guardadas.map((g) => g.url)];
  const legendas = [...enviadas.map(() => null), ...guardadas.map(() => ROTULO_FOTO_GUARDADA)];

  if (!todas.length) return null;

  return (
    <>
      <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-2 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
            Fotos <span className="text-slate-400 font-normal">({todas.length})</span>
          </p>
        </div>

        <div className={`grid gap-2 ${compact ? "grid-cols-4" : "grid-cols-3 sm:grid-cols-4 md:grid-cols-5"}`}>
          {todas.map((url, idx) => {
            const guardada = idx >= enviadas.length ? guardadas[idx - enviadas.length] : null;
            return (
              <div key={guardada ? `g-${guardada.chave}` : `e-${idx}`} className="relative aspect-square" data-mk-foto-guardada={guardada ? "" : undefined}>
                <button
                  type="button"
                  onClick={() => setAberta(idx)}
                  aria-label={`Abrir foto ${idx + 1}${guardada ? " (aguardando envio)" : ""}`}
                  className={`relative w-full h-full rounded-md overflow-hidden border bg-slate-100 group hover:border-emerald-400 transition-all ${guardada ? "border-amber-400 border-2" : "border-slate-200"}`}
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
                  {guardada ? (
                    <span className="absolute bottom-0 left-0 right-0 bg-amber-500/90 text-white text-[9px] font-semibold text-center leading-tight py-0.5">{ROTULO_FOTO_GUARDADA}</span>
                  ) : (
                    <span className="absolute bottom-0.5 right-1 text-[9px] text-white/80 font-medium drop-shadow">{idx + 1}</span>
                  )}
                </button>
                {guardada && onExcluirGuardada ? (
                  <button
                    type="button"
                    onClick={() => onExcluirGuardada(guardada.chave)}
                    aria-label={`Excluir foto ${idx + 1} (aguardando envio)`}
                    className="absolute -top-1.5 -right-1.5 bg-black/70 text-white rounded-full w-6 h-6 flex items-center justify-center shadow"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <VisualizadorDeFotos fotos={todas} indice={aberta} onMudar={setAberta} onFechar={() => setAberta(null)} legendas={legendas} />
    </>
  );
}

import React from "react";

/**
 * Atribuição dinâmica do satélite (Google Maps + copyright do viewport) e aviso
 * honesto de falha com "Tentar novamente". Texto via React (sem innerHTML).
 *
 * @param {{ atribuicao?: string | null, status?: string, mensagem?: string | null, onRetry?: () => void, className?: string }} props
 */
export default function BasemapAtribuicao({ atribuicao, status, mensagem, onRetry, className = "" }) {
  return (
    <>
      {atribuicao ? (
        <div
          data-testid="basemap-atribuicao"
          className={`pointer-events-none absolute z-20 max-w-[70%] truncate rounded bg-white/80 px-1.5 py-0.5 text-[10px] text-slate-700 ${className}`}
          style={{ right: "max(0.25rem, env(safe-area-inset-right))", bottom: "max(1.75rem, calc(env(safe-area-inset-bottom) + 1.5rem))" }}
          title={atribuicao}
        >
          {atribuicao}
        </div>
      ) : null}
      {status === "carregando" ? (
        <div role="status" className="absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs text-slate-700 shadow">
          Carregando satélite…
        </div>
      ) : null}
      {status === "erro" && mensagem ? (
        <div role="alert" className="absolute left-1/2 top-14 z-30 flex w-[min(92vw,420px)] -translate-x-1/2 items-start gap-2 rounded-lg border border-amber-300 bg-white/95 px-3 py-2 text-xs text-slate-800 shadow">
          <span className="flex-1">{mensagem} Exibindo o mapa de ruas.</span>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="min-h-[32px] shrink-0 rounded-md border border-slate-300 bg-white px-2 font-semibold hover:bg-slate-50">
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

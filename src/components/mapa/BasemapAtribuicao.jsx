import React, { useEffect, useState } from "react";

/** Acima disto, em telas estreitas, o texto vai para "Fontes de dados". */
const LIMITE_TEXTO_CURTO = 48;

/**
 * Atribuição do satélite (Google Maps + copyright do viewport) e aviso honesto
 * de falha com "Tentar novamente" (D-PROD-65 / R1-02).
 *
 * Política Map Tiles: o copyright é exibido por inteiro. Sem `truncate`:
 * em telas largas o texto quebra linha; em telas estreitas (ou texto longo)
 * há o botão acessível "Fontes de dados" que abre o texto integral.
 * Fica à esquerda dos controles nativos (zoom/ⓘ OpenFreeMap) para não cobri-los.
 *
 * @param {{ atribuicao?: string | null, status?: string, mensagem?: string | null, onRetry?: () => void, className?: string }} props
 */
export default function BasemapAtribuicao({ atribuicao, status, mensagem, onRetry, className = "" }) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (!atribuicao) setAberto(false);
  }, [atribuicao]);

  const longo = (atribuicao || "").length > LIMITE_TEXTO_CURTO;

  return (
    <>
      {atribuicao ? (
        <div
          data-testid="basemap-atribuicao"
          className={`absolute z-20 flex max-w-[min(70vw,440px)] flex-col items-end gap-1 ${className}`}
          style={{ right: "calc(3.5rem + env(safe-area-inset-right))", bottom: "calc(2.25rem + env(safe-area-inset-bottom))" }}
        >
          {aberto ? (
            <div
              id="basemap-fontes-dados"
              role="region"
              aria-label="Fontes de dados do mapa"
              className="rounded bg-white/95 px-2 py-1 text-[11px] leading-snug text-slate-800 shadow break-words"
            >
              {atribuicao}
            </div>
          ) : null}
          <div className="flex items-center gap-1 rounded bg-white/85 px-1.5 py-0.5 text-[10px] leading-snug text-slate-800">
            <span data-testid="basemap-atribuicao-texto" className={longo ? "hidden break-words sm:inline" : "break-words"}>
              {atribuicao}
            </span>
            {longo ? <span className="sm:hidden">Google Maps</span> : null}
            {longo ? (
              <button
                type="button"
                className="min-h-[24px] rounded px-1 font-semibold underline sm:hidden"
                aria-expanded={aberto}
                aria-controls="basemap-fontes-dados"
                onClick={() => setAberto((v) => !v)}
              >
                Fontes de dados
              </button>
            ) : null}
          </div>
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

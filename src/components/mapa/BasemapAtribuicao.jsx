import React, { useEffect, useState } from "react";
import { Info } from "lucide-react";

/** Acima disto, o texto completo fica atrás do ⓘ "Fontes de dados". */
const LIMITE_TEXTO_CURTO = 48;

/**
 * Atribuição do satélite (Google Maps + copyright do viewport) e aviso honesto
 * de falha com "Tentar novamente" (D-PROD-65 / R1-02).
 *
 * D-PROD-132: discreta, no rodapé do mapa como nos apps de mapa — letra
 * pequena, sem caixa grande. "Google Maps" segue sempre visível no controle
 * nativo de atribuição do MapLibre; o copyright longo do viewport aparece
 * inteiro (sem cortar) ao tocar em "ⓘ Fontes de dados". Texto curto aparece
 * direto. Fica acima da linha de atribuição nativa, à esquerda do zoom.
 *
 * D-PROD-290 (pedido do proprietário): sem avisos do satélite no mapa — nem
 * "Carregando satélite…" nem "Satélite indisponível". Sem satélite (sem
 * internet, cota, chave), o mapa segue com o fundo normal, em silêncio.
 * `status`, `mensagem` e `onRetry` continuam aceitos pelas telas, sem uso.
 *
 * @param {{ atribuicao?: string | null, status?: string, mensagem?: string | null, onRetry?: () => void, className?: string }} props
 */
export default function BasemapAtribuicao({ atribuicao, className = "" }) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (!atribuicao) setAberto(false);
  }, [atribuicao]);

  const longo = (atribuicao || "").length > LIMITE_TEXTO_CURTO;

  return (
    <>
      {atribuicao ? (
        <div data-testid="basemap-atribuicao" className={`mk-atrib ${className}`}>
          {aberto ? (
            <div id="basemap-fontes-dados" role="region" aria-label="Fontes de dados do mapa" className="mk-atrib__fontes">
              {atribuicao}
            </div>
          ) : null}
          <div className="mk-atrib__linha">
            {longo ? (
              <>
                <span data-testid="basemap-atribuicao-texto" className="sr-only">
                  {atribuicao}
                </span>
                <button
                  type="button"
                  className="mk-atrib__info"
                  aria-expanded={aberto}
                  aria-controls="basemap-fontes-dados"
                  title="Fontes de dados"
                  onClick={() => setAberto((v) => !v)}>
                  <Info size={11} aria-hidden />
                  Fontes de dados
                </button>
              </>
            ) : (
              <span data-testid="basemap-atribuicao-texto">{atribuicao}</span>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

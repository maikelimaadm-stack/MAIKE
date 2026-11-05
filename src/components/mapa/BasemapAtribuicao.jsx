import React, { useEffect, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";

/** Acima disto, o texto completo fica atrás do ⓘ "Fontes de dados". */
const LIMITE_TEXTO_CURTO = 48;

/**
 * Atribuição do satélite (Google Maps + copyright do viewport) e aviso honesto
 * de falha com "Tentar novamente" (D-PROD-65 / R1-02).
 *
 * D-PROD-131: discreta, no rodapé do mapa como nos apps de mapa — letra
 * pequena, sem caixa grande. "Google Maps" segue sempre visível no controle
 * nativo de atribuição do MapLibre; o copyright longo do viewport aparece
 * inteiro (sem cortar) ao tocar em "ⓘ Fontes de dados". Texto curto aparece
 * direto. Fica acima da linha de atribuição nativa, à esquerda do zoom.
 *
 * @param {{ atribuicao?: string | null, status?: string, mensagem?: string | null, onRetry?: () => void, className?: string }} props
 */
export default function BasemapAtribuicao({ atribuicao, status, mensagem, onRetry, className = "" }) {
  const [aberto, setAberto] = useState(false);
  const [avisoFechado, setAvisoFechado] = useState(false);
  useEffect(() => {
    if (!atribuicao) setAberto(false);
  }, [atribuicao]);
  useEffect(() => {
    setAvisoFechado(false);
  }, [status, mensagem]);

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
      {status === "carregando" ? (
        <div role="status" className="mk-mapa-aviso mk-mapa-aviso--info">
          <span className="mk-mapa-aviso__spin" aria-hidden />
          Carregando satélite…
        </div>
      ) : null}
      {status === "erro" && mensagem && !avisoFechado ? (
        <div role="alert" className="mk-mapa-aviso">
          <AlertTriangle size={15} className="mk-mapa-aviso__ic" aria-hidden />
          <span className="mk-mapa-aviso__txt">
            <strong>Satélite indisponível</strong>
            <span title={`${mensagem} Exibindo o mapa de ruas.`}>{mensagem} Exibindo o mapa de ruas.</span>
          </span>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="mk-mapa-aviso__btn" aria-label="Tentar novamente">
              <span className="mk-mapa-aviso__longo">Tentar novamente</span>
              <span className="mk-mapa-aviso__curto" aria-hidden>Tentar</span>
            </button>
          ) : null}
          <button type="button" onClick={() => setAvisoFechado(true)} className="mk-mapa-aviso__x" aria-label="Fechar aviso" title="Fechar aviso">
            <X size={14} aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}

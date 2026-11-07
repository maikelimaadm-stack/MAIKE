import React from "react";
import MapaFiltrosPainel from "./MapaFiltrosPainel";
import { ClipboardList, Layers, Move, RefreshCw, SlidersHorizontal, Target } from "lucide-react";

const CAMADAS = [
  { id: "roadmap", label: "Mapa" },
  { id: "satellite", label: "Satélite" },
];

/**
 * Controles flutuantes do Mapa Geral (D-PROD-132), iguais no celular, tablet e computador.
 *
 * - Alto à esquerda: Tarefas e Filtros (o antigo ✕ saiu).
 * - Alto à direita: Visualização (tipo de mapa, estilo e cores dos pastos, o
 *   que mostrar — `painel`) e Atualizar, Minha localização e Mover lotes num
 *   grupo único.
 */
export default function MapaControlesMobile({
  mapType, setMapType,
  onRefresh, onLocate, onToggleDrag,
  dragEnabled = false,
  onOpenTarefas, onOpenFiltros,
  showTarefasButton = true,
  showFiltrosButton = true,
  // Fecha por padrão (D-PROD-137, PREF-04): sem a permissão, Mover só mudaria
  // uma preferência gravada sem efeito e Localizar ligaria uma camada proibida.
  showLocalizarButton = false,
  showMoverButton = false,
  painel = null
}) {
  const [camadasAberto, setCamadasAberto] = React.useState(false);

  const camadaAtual = CAMADAS.find((c) => c.id === mapType) || CAMADAS[0];

  const conteudoCamadas = painel || (
                  <div className="mk-mapa-camadas__opcoes" role="group" aria-label="Tipo de mapa">
                    {CAMADAS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={mapType === c.id}
                        className={`mk-mapa-camada${mapType === c.id ? " is-on" : ""}`}
                        onClick={() => setMapType(c.id)}>
                        <span className={`mk-mapa-camada__mini mk-mapa-camada__mini--${c.id}`} aria-hidden />
                        {c.label}
                      </button>
                    ))}
                  </div>
                );

  return (
    <>
      <div className="mk-mapa-topo">
        {showTarefasButton || showFiltrosButton ? (
          <div className="mk-mapa-ferramentas">
            {showTarefasButton ? (
              <button type="button" className="mk-mapa-card mk-mapa-chip" onClick={onOpenTarefas} aria-label="Tarefas" title="Tarefas">
                <ClipboardList size={17} aria-hidden />
                <span className="mk-mapa-chip__txt">Tarefas</span>
              </button>
            ) : null}
            {showFiltrosButton ? (
              <button type="button" className="mk-mapa-card mk-mapa-chip" onClick={onOpenFiltros} aria-label="Filtros" title="Filtros">
                <SlidersHorizontal size={17} aria-hidden />
                <span className="mk-mapa-chip__txt">Filtros</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mk-mapa-dir">
        <div className="mk-mapa-camadas">
          <button
            type="button"
            className={`mk-mapa-card mk-mapa-btn mk-mapa-btn--solo${camadasAberto ? " is-on" : ""}`}
            onClick={() => setCamadasAberto((v) => !v)}
            aria-expanded={camadasAberto}
            aria-haspopup="true"
            aria-label={`Visualização do mapa: ${camadaAtual.label}`}
            title="Visualização">
            <Layers size={18} aria-hidden />
          </button>

        </div>

        <div className="mk-mapa-card mk-mapa-pilha">
          <button type="button" className="mk-mapa-btn" onClick={onRefresh} aria-label="Atualizar mapa" title="Atualizar mapa">
            <RefreshCw size={17} aria-hidden />
          </button>
          {showLocalizarButton ? (
            <button type="button" className="mk-mapa-btn" onClick={onLocate} aria-label="Minha localização" title="Minha localização">
              <Target size={17} aria-hidden />
            </button>
          ) : null}
          {showMoverButton ? (
            <button
              type="button"
              className={`mk-mapa-btn${dragEnabled ? " is-on" : ""}`}
              onClick={onToggleDrag}
              aria-pressed={dragEnabled}
              aria-label={dragEnabled ? "Arrasto ativo" : "Ativar arrasto"}
              title={dragEnabled ? "Arrasto ativo" : "Ativar arrasto"}>
              <Move size={17} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      <MapaFiltrosPainel open={camadasAberto} onOpenChange={setCamadasAberto} side="right" titulo="Visualização" fecharLabel="Fechar visualização">
        {conteudoCamadas}
      </MapaFiltrosPainel>
    </>
  );
}

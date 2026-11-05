import React from "react";
import { ChevronDown, ClipboardList, Layers, Menu, Move, RefreshCw, SlidersHorizontal, Target } from "lucide-react";
import { useMapaShell } from "@/lib/mapaShellContext";

const CAMADAS = [
  { id: "roadmap", label: "Mapa" },
  { id: "satellite", label: "Satélite" },
];

/**
 * Controles flutuantes do Mapa Geral (D-PROD-131), iguais no celular, tablet e computador.
 *
 * - Alto à esquerda: ☰ (menu lateral, no lugar do antigo ✕) + nome da fazenda
 *   (troca a empresa) e as ferramentas Tarefas e Filtros.
 * - Alto à direita: Camadas (Mapa/Satélite numa escolha só) e Atualizar,
 *   Minha localização e Mover lotes num grupo único.
 */
export default function MapaControlesMobile({
  mapType, setMapType,
  onRefresh, onLocate, onToggleDrag,
  dragEnabled = false,
  onOpenTarefas, onOpenFiltros,
  showTarefasButton = true,
  showFiltrosButton = true
}) {
  const shell = useMapaShell();
  const [camadasAberto, setCamadasAberto] = React.useState(false);
  const camadasRef = React.useRef(/** @type {HTMLDivElement | null} */ (null));

  React.useEffect(() => {
    if (!camadasAberto) return undefined;
    const fora = (e) => {
      if (!camadasRef.current?.contains(/** @type {Node} */ (e.target))) setCamadasAberto(false);
    };
    const esc = (e) => e.key === "Escape" && setCamadasAberto(false);
    document.addEventListener("pointerdown", fora, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora, true);
      document.removeEventListener("keydown", esc);
    };
  }, [camadasAberto]);

  const camadaAtual = CAMADAS.find((c) => c.id === mapType) || CAMADAS[0];

  return (
    <>
      <div className="mk-mapa-topo">
        {shell ? (
          <div className="mk-mapa-card mk-mapa-fazenda">
            <button type="button" className="mk-mapa-btn" onClick={shell.abrirMenu} aria-label="Abrir menu" title="Menu">
              <Menu size={19} aria-hidden />
            </button>
            <span className="mk-mapa-fazenda__div" aria-hidden />
            {shell.trocarEmpresa ? (
              <button type="button" className="mk-mapa-fazenda__nome" onClick={shell.trocarEmpresa} aria-label="Trocar empresa" title="Trocar empresa">
                <span>{shell.empresaNome}</span>
                <ChevronDown size={14} aria-hidden />
              </button>
            ) : (
              <span className="mk-mapa-fazenda__nome">
                <span>{shell.empresaNome}</span>
              </span>
            )}
          </div>
        ) : null}

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
        <div ref={camadasRef} className="mk-mapa-camadas">
          <button
            type="button"
            className={`mk-mapa-card mk-mapa-btn mk-mapa-btn--solo${camadasAberto ? " is-on" : ""}`}
            onClick={() => setCamadasAberto((v) => !v)}
            aria-expanded={camadasAberto}
            aria-haspopup="true"
            aria-label={`Camadas do mapa: ${camadaAtual.label}`}
            title="Camadas do mapa">
            <Layers size={18} aria-hidden />
          </button>
          {camadasAberto ? (
            <div className="mk-mapa-card mk-mapa-camadas__menu" role="group" aria-label="Tipo de mapa">
              <span className="mk-mapa-camadas__titulo">Tipo de mapa</span>
              <div className="mk-mapa-camadas__opcoes">
                {CAMADAS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={mapType === c.id}
                    className={`mk-mapa-camada${mapType === c.id ? " is-on" : ""}`}
                    onClick={() => {
                      setMapType(c.id);
                      setCamadasAberto(false);
                    }}>
                    <span className={`mk-mapa-camada__mini mk-mapa-camada__mini--${c.id}`} aria-hidden />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mk-mapa-card mk-mapa-pilha">
          <button type="button" className="mk-mapa-btn" onClick={onRefresh} aria-label="Atualizar mapa" title="Atualizar mapa">
            <RefreshCw size={17} aria-hidden />
          </button>
          <button type="button" className="mk-mapa-btn" onClick={onLocate} aria-label="Minha localização" title="Minha localização">
            <Target size={17} aria-hidden />
          </button>
          <button
            type="button"
            className={`mk-mapa-btn${dragEnabled ? " is-on" : ""}`}
            onClick={onToggleDrag}
            aria-pressed={dragEnabled}
            aria-label={dragEnabled ? "Arrasto ativo" : "Ativar arrasto"}
            title={dragEnabled ? "Arrasto ativo" : "Ativar arrasto"}>
            <Move size={17} aria-hidden />
          </button>
        </div>
      </div>
    </>
  );
}

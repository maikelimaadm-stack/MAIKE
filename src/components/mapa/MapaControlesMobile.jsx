/*
 * GUIA DE EDIÇÃO — BOTÕES DO MAPA: ordem, ícones e ações.
 * - Barra do topo (D-PROD-218): filtro (abre o painel Filtros de sempre) · Lotes · Pastos · Tarefas.
 *   Os segmentos e o que cada foco mostra vêm de src/lib/mapaFoco.js.
 * - Visualização fica no fim da barra escura (D-PROD-230).
 * - Coluna da direita: Atualizar, Minha localização e Mover.
 * Posição e espaçamento ficam em mapa-geral.css (.mk-mapa-barra, .mk-mapa-dir) e mk-mapa-superficie.css.
 * Índice completo: docs/design/GUIA-MAPA-E-ICONES.md
 */
import React from "react";
import MapaFiltrosPainel from "./MapaFiltrosPainel";
import { Filter, Map, Move, RefreshCw, Target } from "lucide-react";
import { FOCOS_MAPA } from "@/lib/mapaFoco";

const CAMADAS = [
  { id: "roadmap", label: "Mapa" },
  { id: "satellite", label: "Satélite" },
];

/** Setas, Home e End passam de um botão da barra para outro (`role="toolbar"`). */
function andarNaBarra(event) {
  const botoes = Array.from(event.currentTarget.querySelectorAll("button"));
  const atual = botoes.indexOf(document.activeElement);
  if (atual < 0) return;
  const destino = {
    ArrowRight: (atual + 1) % botoes.length,
    ArrowLeft: (atual - 1 + botoes.length) % botoes.length,
    Home: 0,
    End: botoes.length - 1,
  }[event.key];
  if (destino === undefined) return;
  event.preventDefault();
  botoes[destino].focus();
}

/**
 * Controles flutuantes do Mapa Geral (D-PROD-132), iguais no celular, tablet e computador.
 *
 * - Alto, no centro (celular: da esquerda até a coluna da direita): a barra do
 *   v12 (D-PROD-218) no lugar dos antigos botões Tarefas e Filtros.
 *   - filtro "Filtros" (`showFiltrosButton`) abre o painel Filtro de hoje (`onOpenFiltros`).
 *   - Segmentos `focosPermitidos` (Lotes sempre; Pastos e Tarefas pela
 *     permissão), com `aria-pressed` no `foco` atual; o toque chama `onFoco(id)`.
 *     Tarefas também abre a Gestão de Tarefas (`onOpenTarefas`) a cada toque.
 *   - Visualização fecha a barra, inclusive quando só Lotes está liberado.
 * - Visualização (tipo, estilo e cores — `painel`) fica no fim da barra.
 * - À direita, abaixo dela: Atualizar, Minha localização e Mover lotes.
 */
export default function MapaControlesMobile({
  mapType, setMapType,
  onRefresh, onLocate, onToggleDrag,
  dragEnabled = false,
  onOpenTarefas, onOpenFiltros,
  showFiltrosButton = true,
  foco = "lotes",
  onFoco = null,
  // Fecha por padrão: Pastos e Tarefas só entram com a permissão (D-PROD-218, B2).
  focosPermitidos = ["lotes"],
  // Fecha por padrão (D-PROD-137, PREF-04): sem a permissão, Mover só mudaria
  // uma preferência gravada sem efeito e Localizar ligaria uma camada proibida.
  showLocalizarButton = false,
  showMoverButton = false,
  painel = null
}) {
  const [camadasAberto, setCamadasAberto] = React.useState(false);

  const segmentos = FOCOS_MAPA.filter((f) => f.id !== "tarefas" && focosPermitidos.includes(f.id));

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
      <div
        className={`mk-mapa-barra${showFiltrosButton ? "" : " mk-mapa-barra--sem-cfg"}`}
        role="toolbar"
        aria-label="Mapa"
        onKeyDown={andarNaBarra}>
        {showFiltrosButton ? (
          <button type="button" className="mk-mapa-barra__cfg" onClick={onOpenFiltros} aria-label="Filtros" title="Filtros">
            <Filter size={22} aria-hidden />
          </button>
        ) : null}
        {segmentos.map((f) => (
          <button
            key={f.id}
            type="button"
            className="mk-mapa-barra__seg"
            aria-pressed={foco === f.id}
            onClick={() => {
              onFoco?.(f.id);
              if (f.id === "tarefas") onOpenTarefas?.();
            }}>
            {f.id === "pastos" ? "Pontos" : f.rotulo}
          </button>
        ))}
        <button
          type="button"
          className="mk-mapa-barra__cfg mk-mapa-barra__visualizacao"
          onClick={() => setCamadasAberto((v) => !v)}
          aria-expanded={camadasAberto}
          aria-haspopup="true"
          aria-label={`Visualização do mapa: ${camadaAtual.label}`}
          title="Visualização">
          <Map size={22} aria-hidden />
        </button>
      </div>

      <div className="mk-mapa-dir">
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

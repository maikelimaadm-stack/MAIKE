import React from "react";
import {
  AlertTriangle, ClipboardList, LocateFixed, MapPin, Package, PawPrint, Route, Ruler, Square, Type, Warehouse,
} from "lucide-react";
import { ESTILOS_PASTO } from "@/lib/maplibre/mapaGeralRender";
import { MODOS_COLORACAO } from "./MapaFiltrosAvancados";

const TIPOS_MAPA = [
  { id: "roadmap", label: "Mapa" },
  { id: "satellite", label: "Satélite" },
];

/** Nome curto e ícone de cada camada (ids de `camadasDoMapa`). */
const CAMADA_UI = {
  areas: { label: "Áreas", Icone: Square },
  nomes: { label: "Nomes das áreas", Icone: Type },
  hectares: { label: "Hectares", Icone: Ruler },
  lotes: { label: "Lotes", Icone: PawPrint },
  pontos: { label: "Pontos de referência", Icone: MapPin },
  linhas: { label: "Linhas (cercas, rios)", Icone: Route },
  tarefas: { label: "Tarefas", Icone: ClipboardList },
  cochos: { label: "Cochos", Icone: Package },
  depositos: { label: "Depósitos", Icone: Warehouse },
  alertas: { label: "Alertas", Icone: AlertTriangle },
  localizacao: { label: "Minha localização", Icone: LocateFixed },
};

const ROTULO_MODO = {
  padrao: "Cor da área",
  tipo_cultura: "Cultura",
  aproveitamento: "Aproveitamento",
  ocupacao: "Ocupação",
  categoria_gado: "Categoria",
  tipo_pastagem: "Pastagem",
  ua_ha: "UA/ha",
  situacao_pasto: "Situação",
};

/** Mini desenho de dois pastos no estilo escolhido (traço neutro). */
function MiniEstilo({ estilo }) {
  return (
    <svg viewBox="0 0 20 14" className={`mk-vis__ico mk-vis__ico--${estilo}`} aria-hidden>
      <path d="M1.5 3 L10 1.5 L10.8 8 L2.5 11 Z" />
      <path d="M10 1.5 L18.5 3.2 L17.4 12.5 L10.8 8 Z" />
    </svg>
  );
}

/**
 * Painel "Visualização" do Mapa Geral (D-PROD-132): como o mapa é desenhado,
 * em controles discretos — tipo de mapa e estilo dos pastos em escolhas
 * segmentadas e "colorir pastos por" em fichas pequenas. O "mostrar ou não"
 * (camadas) fica no botão Filtros; `camadas` aqui é opcional.
 *
 * @param {{
 *   mapType: string, setMapType: (t: string) => void,
 *   estiloPasto: string, setEstiloPasto: (e: string) => void,
 *   modoColoracao: string, setModoColoracao: (m: string) => void,
 *   podeColorir?: boolean,
 *   camadas?: Array<{ id: string, label: string, checked: boolean, onChange: () => void }>,
 * }} props
 */
export default function MapaVisualizacao({ mapType, setMapType, estiloPasto, setEstiloPasto, modoColoracao, setModoColoracao, podeColorir = true, camadas = [] }) {
  return (
    <div className="mk-vis">
      <section className="mk-vis__secao" aria-label="Tipo de mapa">
        <h3 className="mk-vis__titulo">Tipo de mapa</h3>
        <div className="mk-vis__seg" role="group">
          {TIPOS_MAPA.map((t) => (
            <button key={t.id} type="button" aria-pressed={mapType === t.id} className="mk-vis__seg-op" onClick={() => setMapType(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {podeColorir ? (
        <>
          <section className="mk-vis__secao" aria-label="Estilo dos pastos">
            <h3 className="mk-vis__titulo">Estilo dos pastos</h3>
            <div className="mk-vis__seg" role="group">
              {ESTILOS_PASTO.map((e) => (
                <button key={e.id} type="button" aria-pressed={estiloPasto === e.id} className="mk-vis__seg-op" onClick={() => setEstiloPasto(e.id)}>
                  <MiniEstilo estilo={e.id} />
                  {e.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mk-vis__secao" aria-label="Colorir pastos por">
            <h3 className="mk-vis__titulo">Colorir pastos por</h3>
            <div className="mk-vis__chips" role="group">
              {MODOS_COLORACAO.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={modoColoracao === m.id}
                  title={m.label}
                  className="mk-vis__chip"
                  onClick={() => setModoColoracao(m.id)}>
                  {ROTULO_MODO[m.id] || m.label}
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {camadas.length ? (
        <section className="mk-vis__secao" aria-label="Mostrar no mapa">
          <h3 className="mk-vis__titulo">Mostrar no mapa</h3>
          <ul className="mk-vis__lista">
            {camadas.map((c) => {
              const ui = CAMADA_UI[c.id] || { label: c.label, Icone: Square };
              const Icone = ui.Icone;
              return (
                <li key={c.id}>
                  <button type="button" role="switch" aria-checked={c.checked} className="mk-vis__linha" onClick={c.onChange}>
                    <Icone size={16} aria-hidden className="mk-vis__linha-ic" />
                    <span className="mk-vis__linha-txt">{ui.label}</span>
                    {/* mesma chave liga/desliga dos cadastros e lançamentos (ToggleSwitch) */}
                    <span className={`mk-ios-switch${c.checked ? " is-on" : ""}`} aria-hidden>
                      <span className="mk-ios-switch__thumb" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

import React from "react";
import {
  AlertTriangle, ClipboardList, LocateFixed, MapPin, Package, PawPrint, Route, Ruler, Square, Type, Warehouse,
} from "lucide-react";
import { ESTILOS_PASTO } from "@/lib/maplibre/mapaGeralRender";
import {
  CORES_APROVEITAMENTO, CORES_OCUPACAO, CORES_SITUACAO_PASTO, CORES_TIPO_CULTURA, CORES_UA_HA, MODOS_COLORACAO,
} from "./MapaFiltrosAvancados";

const TIPOS_MAPA = [
  { id: "roadmap", label: "Mapa" },
  { id: "satellite", label: "Satélite" },
];

/** Nome curto e ícone de cada camada (ids de `camadasDoMapa`). */
const CAMADA_UI = {
  areas: { label: "Áreas", Icone: Square },
  nomes: { label: "Nomes", Icone: Type },
  hectares: { label: "Hectares", Icone: Ruler },
  lotes: { label: "Lotes", Icone: PawPrint },
  pontos: { label: "Pontos", Icone: MapPin },
  linhas: { label: "Linhas", Icone: Route },
  tarefas: { label: "Tarefas", Icone: ClipboardList },
  cochos: { label: "Cochos", Icone: Package },
  depositos: { label: "Depósitos", Icone: Warehouse },
  alertas: { label: "Alertas", Icone: AlertTriangle },
  localizacao: { label: "Localização", Icone: LocateFixed },
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

const tres = (mapa) => Object.values(mapa).slice(0, 3);
/** Amostra de cores de cada modo, para a miniatura. */
const AMOSTRA_MODO = {
  padrao: ["#92ca25", "#61aad9", "#0f766e"],
  tipo_cultura: tres(CORES_TIPO_CULTURA),
  aproveitamento: tres(CORES_APROVEITAMENTO),
  ocupacao: tres(CORES_OCUPACAO),
  categoria_gado: ["#f97316", "#8b5cf6", "#06b6d4"],
  tipo_pastagem: ["#65a30d", "#ca8a04", "#0d9488"],
  ua_ha: tres(CORES_UA_HA),
  situacao_pasto: tres(CORES_SITUACAO_PASTO),
};

/**
 * Painel "Visualização" do Mapa Geral (D-PROD-131): como o mapa é desenhado.
 * Tipo de mapa, estilo dos pastos, "colorir pastos por" e o que aparece.
 * Os Filtros ficam só com o que filtra os dados.
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
        <div className="mk-vis__grade mk-vis__grade--2">
          {TIPOS_MAPA.map((t) => (
            <button key={t.id} type="button" aria-pressed={mapType === t.id} className={`mk-vis__opcao${mapType === t.id ? " is-on" : ""}`} onClick={() => setMapType(t.id)}>
              <span className={`mk-vis__mini mk-mapa-camada__mini--${t.id}`} aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {podeColorir ? (
        <>
          <section className="mk-vis__secao" aria-label="Estilo dos pastos">
            <h3 className="mk-vis__titulo">Estilo dos pastos</h3>
            <div className="mk-vis__grade mk-vis__grade--3">
              {ESTILOS_PASTO.map((e) => (
                <button key={e.id} type="button" aria-pressed={estiloPasto === e.id} className={`mk-vis__opcao${estiloPasto === e.id ? " is-on" : ""}`} onClick={() => setEstiloPasto(e.id)}>
                  <span className={`mk-vis__mini mk-vis__estilo mk-vis__estilo--${e.id}`} aria-hidden>
                    <svg viewBox="0 0 60 40" preserveAspectRatio="none">
                      <path d="M4 8 L30 3 L33 22 L8 30 Z" />
                      <path d="M30 3 L56 9 L52 34 L33 22 Z" />
                      <path d="M8 30 L33 22 L52 34 L12 38 Z" />
                    </svg>
                  </span>
                  {e.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mk-vis__secao" aria-label="Colorir pastos por">
            <h3 className="mk-vis__titulo">Colorir pastos por</h3>
            <div className="mk-vis__grade mk-vis__grade--2">
              {MODOS_COLORACAO.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={modoColoracao === m.id}
                  title={m.label}
                  className={`mk-vis__modo${modoColoracao === m.id ? " is-on" : ""}`}
                  onClick={() => setModoColoracao(m.id)}>
                  <span className="mk-vis__amostra" aria-hidden>
                    {(AMOSTRA_MODO[m.id] || AMOSTRA_MODO.padrao).map((c, i) => <i key={i} style={{ background: c }} />)}
                  </span>
                  <span className="mk-vis__modo-txt">{ROTULO_MODO[m.id] || m.label}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {camadas.length ? (
        <section className="mk-vis__secao" aria-label="Mostrar no mapa">
          <h3 className="mk-vis__titulo">Mostrar no mapa</h3>
          <div className="mk-vis__grade mk-vis__grade--3">
            {camadas.map((c) => {
              const ui = CAMADA_UI[c.id] || { label: c.label, Icone: Square };
              const Icone = ui.Icone;
              return (
                <button key={c.id} type="button" aria-pressed={c.checked} title={c.label} className={`mk-vis__camada${c.checked ? " is-on" : ""}`} onClick={c.onChange}>
                  <Icone size={17} aria-hidden />
                  <span>{ui.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

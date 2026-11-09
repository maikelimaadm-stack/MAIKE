import React from "react";
import { DlUiProvider, useDlUi } from "@/components/mapa/detalhes-lote/pecas";
import { useEstadoLotes } from "./useEstadoLotes";
import { usePreferenciasDetalhes } from "./preferencias";
import AbaLotes from "./AbaLotes";
import ListaCompactaLotes from "./ListaCompactaLotes";
import CartoesLoteTudo from "./CartoesLoteTudo";
import AbaArea from "./AbaArea";
import InformacoesArea from "@/components/mapa/InformacoesArea";

/*
 * Casca do Detalhes do Lote v8 (mockup docs/design/detalhes-do-lote/
 * detalhes-do-lote-v8.dc.html): menu de abas FIXO (fora da rolagem) e, abaixo,
 * o corpo que rola. Componente puro: os dados chegam prontos em `modelo`
 * (montarModeloDetalhes) e a suplementação e as ações chegam montadas.
 * Estilos de casca em src/styles/mk-detalhes-lote.css.
 */

const DESLIZE_MIN = 50;

/**
 * `escopoPreferencias` (fazenda + conta + empresa) liga as preferências do
 * usuário — informações marcadas no Filtrar (Lotes) e no Mostrar informações
 * (Área). Sem ele, vale o padrão (sem filtro) e nada é gravado.
 * @param {{ modelo: any, suplementacao?: React.ReactNode, acoes?: React.ReactNode, escopoPreferencias?: import('./preferencias').EscopoPreferencias | null }} props
 */
export default function PainelDetalhesLote({ modelo, suplementacao = null, acoes = null, escopoPreferencias = null }) {
  return (
    <DlUiProvider>
      <Painel modelo={modelo} suplementacao={suplementacao} acoes={acoes} escopoPreferencias={escopoPreferencias} />
    </DlUiProvider>
  );
}

/**
 * @param {{ modelo: any, suplementacao: React.ReactNode, acoes: React.ReactNode, escopoPreferencias: import('./preferencias').EscopoPreferencias | null }} props
 */
function Painel({ modelo, suplementacao, acoes, escopoPreferencias }) {
  const ui = useDlUi();
  const celular = ui.celular;
  const { preferencias, alterar } = usePreferenciasDetalhes(escopoPreferencias);
  const aoMudarSecoesLote = React.useCallback((/** @type {string[]} */ v) => alterar("secoesLote", v), [alterar]);
  const aoMudarSecoesArea = React.useCallback((/** @type {string[]} */ v) => alterar("secoesArea", v), [alterar]);
  const estado = useEstadoLotes({ modelo, celular, secoes: preferencias.secoesLote, aoMudarSecoes: aoMudarSecoesLote });
  const { setVista } = estado;
  const idBase = `mk-dl8-${React.useId().replace(/:/g, "")}`;
  const temSupl = suplementacao != null && suplementacao !== false;
  const qtdLotes = Array.isArray(modelo?.lotes) ? modelo.lotes.length : 0;

  const abas = React.useMemo(
    () => [
      { id: "tudo", rotulo: "Tudo" },
      { id: "area", rotulo: "Área" },
      { id: "lotes", rotulo: "Lotes", badge: qtdLotes > 0 ? String(qtdLotes) : "" },
      ...(temSupl ? [{ id: "supl", rotulo: celular ? "Supl." : "Suplementação" }] : []),
    ],
    [celular, qtdLotes, temSupl],
  );
  const ids = abas.map((a) => a.id);

  const [abaEscolhida, setAba] = React.useState("tudo");
  const aba = ids.includes(abaEscolhida) ? abaEscolhida : "tudo";

  // Troca de aba: o corpo volta ao topo (o menu fica parado; só o corpo rola).
  const corpo = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  React.useEffect(() => {
    if (corpo.current) corpo.current.scrollTop = 0;
  }, [aba]);

  // Entrar na aba Lotes (menu, deslize ou teclado) sempre abre no Resumo.
  // O atalho do Tudo para um lote (abrirLoteNaVista) não passa por aqui.
  const irAba = React.useCallback((/** @type {string} */ id) => {
    if (id === "lotes") setVista("resumo");
    setAba(id);
  }, [setVista]);

  /** Tudo (celular) → Lotes › Lote naquele lote. */
  const abrirLoteNaVista = React.useCallback(
    (/** @type {string} */ id) => {
      estado?.abrirLoteNaVista?.(id);
      setAba("lotes");
    },
    [estado],
  );

  // Deslize lateral: Lotes › Lote troca de lote; nas outras, troca de aba.
  const inicio = React.useRef(/** @type {{ x: number, y: number } | null} */ (null));
  const aoTocar = (/** @type {React.PointerEvent<HTMLDivElement>} */ e) => {
    const alvo = /** @type {Element | null} */ (e.target instanceof Element ? e.target : null);
    if (e.pointerType === "mouse" || alvo?.closest("[data-sem-deslize]") || estado?.popupAberto) {
      inicio.current = null;
      return;
    }
    inicio.current = { x: e.clientX, y: e.clientY };
  };
  const aoSoltar = (/** @type {React.PointerEvent<HTMLDivElement>} */ e) => {
    const ini = inicio.current;
    inicio.current = null;
    if (!ini) return;
    const dx = e.clientX - ini.x;
    const dy = e.clientY - ini.y;
    if (Math.abs(dx) < DESLIZE_MIN || Math.abs(dx) < Math.abs(dy)) return;
    const passo = dx < 0 ? 1 : -1;
    if (aba === "lotes" && estado?.vista === "lote") {
      estado.passoLote?.(passo);
      return;
    }
    const i = ids.indexOf(aba) + passo;
    if (i >= 0 && i < ids.length) irAba(ids[i]);
  };
  const aoCancelar = () => {
    inicio.current = null;
  };

  // Setas do teclado no menu (padrão de abas).
  const aoTeclar = (/** @type {React.KeyboardEvent<HTMLDivElement>} */ e) => {
    const i = ids.indexOf(aba);
    let novo = -1;
    if (e.key === "ArrowRight") novo = (i + 1) % ids.length;
    else if (e.key === "ArrowLeft") novo = (i - 1 + ids.length) % ids.length;
    else if (e.key === "Home") novo = 0;
    else if (e.key === "End") novo = ids.length - 1;
    if (novo < 0) return;
    e.preventDefault();
    irAba(ids[novo]);
    const botao = /** @type {HTMLElement | null} */ (document.getElementById(`${idBase}-aba-${ids[novo]}`));
    botao?.focus();
  };

  let conteudo = null;
  if (aba === "tudo") {
    conteudo = (
      <>
        <InformacoesArea modelo={modelo} />
        {celular ? <ListaCompactaLotes modelo={modelo} onAbrir={abrirLoteNaVista} /> : <CartoesLoteTudo modelo={modelo} />}
        {temSupl ? suplementacao : null}
      </>
    );
  } else if (aba === "area") {
    conteudo = <AbaArea modelo={modelo} secoes={preferencias.secoesArea} aoMudarSecoes={aoMudarSecoesArea} />;
  } else if (aba === "lotes") {
    conteudo = <AbaLotes modelo={modelo} estado={estado} />;
  } else if (aba === "supl") {
    conteudo = suplementacao;
  }

  return (
    <div className="mk-dl mk-dl8" data-modo={ui.modo} translate="no">
      <div className="mk-dl8__menu">
        <div
          role="tablist"
          aria-label="Seções"
          className="mk-dl8__abas"
          style={{ gridTemplateColumns: `repeat(${abas.length}, max-content)` }}
          onKeyDown={aoTeclar}
        >
          {abas.map((a) => {
            const ativa = a.id === aba;
            return (
              <button
                key={a.id}
                id={`${idBase}-aba-${a.id}`}
                type="button"
                role="tab"
                aria-selected={ativa}
                aria-controls={`${idBase}-painel`}
                tabIndex={ativa ? 0 : -1}
                className="mk-dl8__aba"
                onClick={() => irAba(a.id)}
              >
                <span className="mk-dl8__aba-rotulo">{a.rotulo}</span>
                {!celular && a.badge ? <span className="mk-dl8__badge">{a.badge}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={corpo} className="mk-dl8__corpo">
        <div
          className="mk-dl8__deslize"
          onPointerDown={aoTocar}
          onPointerUp={aoSoltar}
          onPointerCancel={aoCancelar}
        >
          <div
            key={aba}
            id={`${idBase}-painel`}
            role="tabpanel"
            aria-labelledby={`${idBase}-aba-${aba}`}
            className="mk-dl8__painel"
          >
            {conteudo}
          </div>
        </div>
        {acoes}
      </div>
    </div>
  );
}

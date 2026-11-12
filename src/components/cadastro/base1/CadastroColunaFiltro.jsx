import React from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import MobileSheet, { useCelular } from "@/components/common/MobileSheet";
import { casaNoFiltroColuna } from "./cadastroColunaFiltroLogic";
import { ContagemNomesContext, JanelaDoFiltro, semCondicao } from "./FiltrosRapidos";
import { textoDoTotal } from "./contagemBase1";
import {
  deveFecharFiltroPorFora,
  haCamadaAninhadaDoFiltroAberta,
} from "./cadastroColunaFiltroCamada";

/** Altura máxima da janela, a mesma das janelas da faixa (`.mk-sel-pop`). */
const ALTURA_MAX = 380;

/**
 * Filtro do cabeçalho da coluna — a MESMA janela do filtro das pílulas da faixa (D-PROD-166): pesquisa com
 * "Condição ⌄", "Todos" e os valores com ✓ e a contagem; no rodapé ✕ · "5 de 12 lotes" · ✓. Tudo é rascunho até o ✓.
 * Abre logo abaixo do cabeçalho (acima, se não couber); no celular, na folha de baixo, como a pílula.
 *
 * @param {{
 *   rotulo: string,
 *   tipo: 'texto'|'num'|'data',
 *   ancora: string,
 *   valores: string[],
 *   atual: { op: string, v1: string, v2: string, valores: Set<string> | null } | null,
 *   coluna?: { cellKind?: string, corNomes?: Readonly<Record<string, string>> },
 *   totais?: number,
 *   ancoraReserva?: DOMRect | null,
 *   onAplicar: (filtro: { op: string, v1: string, v2: string, valores: Set<string> | null } | null) => void,
 *   onFechar: () => void,
 * }} props
 *   `valores`: o valor da coluna em cada linha que passa pela busca e pelos OUTROS filtros (dá as opções e a contagem);
 *   `totais`: todas as linhas carregadas (o "de 12" da contagem).
 */
export default function CadastroColunaFiltro({
  rotulo,
  tipo,
  ancora,
  valores,
  atual,
  coluna = undefined,
  totais = undefined,
  ancoraReserva = null,
  onAplicar,
  onFechar,
}) {
  const celular = useCelular();
  const nomes = React.useContext(ContagemNomesContext);
  const [pos, setPos] = React.useState(/** @type {React.CSSProperties} */ ({ visibility: "hidden" }));
  const janela = React.useRef(/** @type {HTMLDivElement | null} */ (null));
  const fechar = React.useRef(onFechar);
  fechar.current = onFechar;
  // Celular: o ✓ e a contagem ficam no topo da folha (fora da janela), como na pílula.
  const controleDaFolha = React.useRef(/** @type {null | { aplicar: () => void }} */ (null));
  const [contaDaFolha, setContaDaFolha] = React.useState("");

  const reposicionar = React.useCallback(() => {
    // Sem cabeçalho visível (cards, coluna fora da tela): usa o botão Filtros.
    const el = document.querySelector(ancora)?.closest("th");
    const b = el?.getBoundingClientRect() ?? ancoraReserva;
    if (!b) return;
    const largura = janela.current?.getBoundingClientRect().width || 300;
    const left = Math.max(8, Math.min(b.left, window.innerWidth - largura - 8));
    const abaixo = window.innerHeight - b.bottom - 12;
    const acima = b.top - 12;
    const embaixo = abaixo >= ALTURA_MAX || abaixo >= acima;
    // A altura disponível vai na mesma variável que o Radix dá às janelas da faixa: o CSS delas vale igual aqui.
    const disponivel = /** @type {React.CSSProperties} */ ({ ["--radix-popper-available-height"]: `${Math.round(embaixo ? abaixo : acima)}px` });
    setPos(
      embaixo
        ? { top: b.bottom + 4, left, visibility: "visible", ...disponivel }
        : { bottom: window.innerHeight - b.top + 4, left, visibility: "visible", ...disponivel },
    );
  }, [ancora, ancoraReserva]);

  React.useLayoutEffect(() => {
    if (!celular) reposicionar();
  }, [reposicionar, celular]);

  // Como na janela da pílula: o foco vai para a pesquisa (quando houver) — depois de posicionada, porque uma
  // janela ainda invisível não recebe foco.
  const visivel = pos.visibility === "visible";
  const focou = React.useRef(false);
  React.useEffect(() => {
    if (celular || !visivel || focou.current) return;
    focou.current = true;
    const alvo = janela.current?.querySelector(".b1-fr-campo");
    if (alvo instanceof HTMLElement) alvo.focus({ preventScroll: true });
  }, [celular, visivel]);

  React.useEffect(() => {
    const teclado = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (haCamadaAninhadaDoFiltroAberta()) return;
      e.preventDefault();
      fechar.current();
    };
    const fora = (e) => {
      if (celular) return;
      const th = document.querySelector(ancora)?.closest("th") ?? null;
      if (!deveFecharFiltroPorFora({ alvo: e.target, ponto: e, shell: janela.current, ancora: th })) return;
      fechar.current();
    };
    const scroll = (e) => {
      // Rolar a lista de valores dentro da janela não a move.
      if (e?.target instanceof Node && janela.current?.contains(e.target)) return;
      reposicionar();
    };
    document.addEventListener("keydown", teclado);
    document.addEventListener("pointerdown", fora);
    window.addEventListener("resize", scroll);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("keydown", teclado);
      document.removeEventListener("pointerdown", fora);
      window.removeEventListener("resize", scroll);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [ancora, reposicionar, celular]);

  /** @param {{ op: string, v1: string, v2: string, valores: Set<string> | null } | null} previa */
  const contarComo = (previa) =>
    textoDoTotal({
      mostrados: previa ? valores.filter((v) => casaNoFiltroColuna(previa, tipo, v)).length : valores.length,
      totais: totais ?? valores.length,
      nomes,
    });

  /** @param {boolean} semRodape */
  const corpo = (semRodape) => (
    <JanelaDoFiltro
      rotulo={rotulo}
      tipo={tipo}
      comCondicao={!semCondicao(coluna)}
      corNomes={coluna?.corNomes}
      ehCor={coluna?.cellKind === "cor"}
      valoresDaBase={valores}
      atual={atual}
      contarComo={contarComo}
      onAplicar={onAplicar}
      onCancelar={onFechar}
      semRodape={semRodape}
      controleRef={semRodape ? controleDaFolha : undefined}
      onConta={semRodape ? setContaDaFolha : undefined}
    />
  );

  if (celular) {
    return (
      <MobileSheet
        open
        initialLarge
        onClose={() => fechar.current()}
        label={`Filtrar coluna ${rotulo}`}
        title={rotulo}
        aside={contaDaFolha}
        className="mk-base1-sheet"
        role="dialog"
        headerAction={
          <button
            type="button"
            className="mk-sheet__new mk-btn-ok"
            aria-label="Aplicar"
            title="Aplicar"
            onClick={() => controleDaFolha.current?.aplicar()}
          >
            <Check aria-hidden />
          </button>
        }
      >
        <div className="b1-lista-pop b1-fr-sheet">{corpo(true)}</div>
      </MobileSheet>
    );
  }

  return createPortal(
    <div
      ref={janela}
      className="mk-sel-pop b1-lista-pop b1-fr-pop b1-col-pop"
      role="dialog"
      aria-label={`Filtrar coluna ${rotulo}`}
      style={pos}
    >
      {corpo(false)}
    </div>,
    document.body,
  );
}

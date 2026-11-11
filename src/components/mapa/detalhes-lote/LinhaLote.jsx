import React from "react";
import { useDlUi, COR, TIPO, IconeCategoria, PilulaSituacao, Chevron } from "@/components/mapa/detalhes-lote/pecas";

/** @typedef {import('./catalogo').LoteVm} LoteVm */

/**
 * Linha de um lote (vista Resumo e lista compacta da aba Tudo no celular).
 * Mockup v8, linhas 243–249: ícone 22 · nome + "CATEGORIA · N cab · peso 449,5" ·
 * pílula de situação · seta 18. Altura mínima ui.linhaToque (44 celular / 36 desktop).
 *
 * `expandido` definido → vira `aria-expanded` e a seta gira 90° (acordeão do Resumo).
 * `primeira` → sem linha em cima.
 *
 * @param {{ lote: LoteVm, onClick?: () => void, expandido?: boolean, primeira?: boolean }} props
 */
export default function LinhaLote({ lote, onClick, expandido, primeira = false }) {
  const ui = useDlUi();
  const acordeao = typeof expandido === "boolean";

  /** @type {React.CSSProperties} */
  const estiloBotao = {
    display: "grid",
    gridTemplateColumns: "22px minmax(0, 1fr) auto 22px",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minHeight: ui.linhaToque,
    padding: "5px 0",
    border: 0,
    borderTop: `1px solid ${primeira ? "transparent" : COR.divisor}`,
    background: "transparent",
    textAlign: "left",
    cursor: "pointer",
  };

  /** @type {React.CSSProperties} */
  const umaLinha = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={acordeao ? expandido : undefined}
      style={estiloBotao}
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", width: 22, height: 22 }}>
        <IconeCategoria url={lote.iconeUrl} tamanho={22} alt={lote.categoria} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ ...umaLinha, ...TIPO.item, lineHeight: 1.25, color: COR.titulo }}>{lote.nome}</span>
        <span style={{ ...umaLinha, ...TIPO.rotulo, lineHeight: 1.3, color: COR.meta }}>
          {`${lote.categoria} · ${lote.textos.cab} cab · peso ${lote.textos.peso}`}
        </span>
      </span>
      <PilulaSituacao situacao={lote.situacao} />
      <Chevron direcao="direita" tamanho={18} cor={COR.meta} girar={acordeao && expandido === true} />
    </button>
  );
}

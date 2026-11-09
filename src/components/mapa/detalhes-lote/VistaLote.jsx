import React from "react";
import { useDlUi, COR, CartaoDl, Chevron } from "@/components/mapa/detalhes-lote/pecas";
import CartaoLote from "@/components/mapa/detalhes-lote/CartaoLote";

/** @typedef {import('./catalogo').LoteVm} LoteVm */
/** @typedef {import('./catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * O que a vista Lote lê do estado da aba Lotes (useEstadoLotes).
 * @typedef {import('./CartaoLote').EstadoCartao & {
 *   alertaAtivo: boolean,
 *   lotesVisiveis: LoteVm[],
 *   loteAtivo: LoteVm | null,
 *   indiceAtivo: number,
 *   passoLote: (passo: number) => unknown,
 * }} EstadoVistaLote
 */

/**
 * Vista Lote da aba Lotes (mockup v8, linhas 292–342): barra ‹ nome › com "2 de 6"
 * (+ " · deslize para trocar" no celular) e o card do lote ativo, um por vez.
 * O gesto de deslizar fica no Painel (chama estado.passoLote); aqui só os botões.
 *
 * @param {{ modelo: ModeloDetalhes, estado: EstadoVistaLote }} props
 */
export default function VistaLote({ modelo, estado }) {
  const ui = useDlUi();
  const n = estado.lotesVisiveis.length;
  const lote = estado.loteAtivo;
  const idx = lote ? Math.max(0, estado.indiceAtivo) : 0;
  const temAnterior = !!lote && idx > 0;
  const temProximo = !!lote && idx < n - 1;
  const posicao = n && lote ? `${idx + 1} de ${n}` : "0 de 0";
  const dica = ui.celular ? " · deslize para trocar" : "";

  /**
   * @param {boolean} ativo
   * @returns {React.CSSProperties}
   */
  const estiloSeta = (ativo) => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    padding: 0,
    border: 0,
    borderRadius: 999,
    background: "transparent",
    color: ativo ? COR.titulo : COR.marcador,
    cursor: ativo ? "pointer" : "default",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "36px minmax(0, 1fr) 36px",
          alignItems: "center",
          gap: 6,
          height: 36,
          padding: "0 3px",
          borderRadius: 999,
          background: "#fff",
          boxShadow: ui.sombraBtn,
        }}
      >
        <button
          type="button"
          aria-label="Lote anterior"
          aria-disabled={!temAnterior}
          onClick={() => {
            if (temAnterior) estado.passoLote(-1);
          }}
          style={estiloSeta(temAnterior)}
        >
          <Chevron direcao="esquerda" tamanho={16} cor="currentColor" />
        </button>
        <div style={{ minWidth: 0, textAlign: "center" }}>
          <div
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.2,
              color: COR.titulo,
            }}
          >
            {lote ? lote.nome : "—"}
          </div>
          <div style={{ fontSize: 9, fontWeight: 600, lineHeight: 1.2, color: COR.meta }}>{`${posicao}${dica}`}</div>
        </div>
        <button
          type="button"
          aria-label="Próximo lote"
          aria-disabled={!temProximo}
          onClick={() => {
            if (temProximo) estado.passoLote(1);
          }}
          style={estiloSeta(temProximo)}
        >
          <Chevron direcao="direita" tamanho={16} cor="currentColor" />
        </button>
      </div>

      {lote ? (
        <CartaoLote lote={lote} estado={estado} />
      ) : (
        <CartaoDl padding="10px 12px">
          <span style={{ fontSize: 11, color: COR.meta }}>
            {estado.alertaAtivo || modelo.lotes.length > 0
              ? "Nenhum lote com esse alerta. Troque o filtro para ver os outros."
              : "Nenhum lote na área."}
          </span>
        </CartaoDl>
      )}
    </div>
  );
}

import React from "react";
import { useDlUi, COR, TIPO, CartaoDl, PilulaTitulo, PilulaSituacao, IconeCategoria, GradeCampos } from "@/components/mapa/detalhes-lote/pecas";
import { camposCartaoTudo, VAZIO } from "@/components/mapa/detalhes-lote/catalogo";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Aba Tudo no desktop/tablet: um card por lote em grade de 2 colunas, com a pílula
 * de situação ao lado do nome. Mockup v8, linhas 109–127.
 *
 * @param {{ modelo: ModeloDetalhes }} props
 */
export default function CartoesLoteTudo({ modelo }) {
  const ui = useDlUi();
  const lotes = modelo.lotes;
  if (!lotes.length) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${ui.celular ? 1 : 2}, minmax(0, 1fr))`, gap: 8 }}>
      {lotes.map((lote) => (
        <CartaoDl key={lote.id} gap={8}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
              <PilulaTitulo>{`Lote: ${lote.nome}`}</PilulaTitulo>
              <PilulaSituacao situacao={lote.situacao} />
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", flex: "0 0 auto", height: 22, overflow: "visible" }}>
              <IconeCategoria url={lote.iconeUrl} tamanho={36} alt={lote.categoria} />
            </span>
          </div>
          {/* Meio card no desktop/tablet: 3 colunas, para os rótulos de 13 px do motor (D-PROD-173) caberem inteiros. */}
          <GradeCampos campos={camposCartaoTudo(lote)} colunas={ui.celular ? ui.infoCols : 3} variante="info" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span style={{ display: "inline-flex", gap: 4, padding: "2px 9px", color: COR.meta, ...TIPO.rotulo }}>
              Categoria de Manejo: <strong style={{ color: COR.texto, fontWeight: 600 }}>{lote.ident?.catManejo || VAZIO}</strong>
            </span>
          </div>
        </CartaoDl>
      ))}
    </div>
  );
}

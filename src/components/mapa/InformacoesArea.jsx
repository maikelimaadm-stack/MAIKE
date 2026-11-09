import React from "react";
import { useDlUi, CartaoDl, PilulaTitulo, GradeCampos } from "@/components/mapa/detalhes-lote/pecas";

/** @typedef {import('@/components/mapa/detalhes-lote/catalogo').ModeloDetalhes} ModeloDetalhes */

/**
 * Card "Informações da Área" da aba Tudo (mockup v8, linhas 100–108).
 * Os números já vêm formatados pelo catálogo, sem unidade depois do número
 * (a unidade fica no rótulo). Curral mostra só infraestrutura e tipo de área.
 *
 * @param {{ modelo: ModeloDetalhes | null | undefined }} props
 */
export default function InformacoesArea({ modelo }) {
  const ui = useDlUi();
  const area = modelo?.area;
  if (!area) return null;

  return (
    <CartaoDl gap={8}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <PilulaTitulo>Informações da Área</PilulaTitulo>
      </div>
      {area.ehCurral ? (
        <GradeCampos campos={area.camposCurral} colunas={2} variante="info" />
      ) : (
        <GradeCampos campos={area.camposResumo} colunas={ui.infoCols} variante="info" />
      )}
    </CartaoDl>
  );
}

import React, { useCallback } from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { comparar, ehCanonico } from "@/lib/dinheiroDecimal";
import { valorDoCampoEntrada } from "@/lib/estoqueEntradasRegras";

export const ENTRADAS_ESTOQUE_STORAGE_KEY = "colunas_estoque_entradas_v1";

/** Lista de entradas: Data | Nº | Produto | Motivo | Depósito | Quantidade | Situação. O resto é opcional. */
export const ENTRADAS_ESTOQUE_COLUNAS = [
  { id: "data", label: "Data", default: true, sortable: true, width: 101 },
  { id: "numero", label: "Nº", default: true, sortable: true, width: 80 },
  { id: "produto", label: "Produto", default: true, sortable: true, width: 200 },
  { id: "motivo", label: "Motivo", default: true, sortable: true, width: 170 },
  { id: "deposito", label: "Depósito", default: true, sortable: true, width: 180 },
  { id: "quantidade", label: "Quantidade", default: true, sortable: true, align: "right", width: 130 },
  { id: "situacao", label: "Situação", default: true, sortable: true, width: 110 },
  { id: "valor", label: "Valor", default: false, sortable: true, align: "right", width: 120 },
  { id: "documento", label: "Documento", default: false, sortable: true, width: 140 },
];

/** Além dos filtros da tela, só a Situação fica na faixa. */
const FILTROS_AUTOMATICOS = ["situacao"];

export const ENTRADAS_ESTOQUE_CAMPOS_CARD = ["produto", "quantidade", "data", "motivo", "situacao"];

/** Data e número pelo valor canônico (o texto "10" viria antes de "9"); o resto, pelo texto da célula. @param {any} a @param {any} b @param {string} colId @returns {number|null} */
export const compararEntradasParaOrdenar = (a, b, colId) => {
  if (colId === "data") {
    const va = typeof a?.data_entrada === "string" ? a.data_entrada : null;
    const vb = typeof b?.data_entrada === "string" ? b.data_entrada : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    if (va !== vb) return va < vb ? -1 : 1;
  }
  if (colId === "data" || colId === "numero") {
    const na = ehCanonico(a?.numero) ? a.numero : null;
    const nb = ehCanonico(b?.numero) ? b.numero : null;
    if (na === null || nb === null) return na === nb ? 0 : na === null ? 1 : -1;
    return comparar(na, nb);
  }
  return null;
};

/** @param {any} props */
export default function TabelaEntradasEstoque(props) {
  const renderCell = useCallback((/** @type {any} */ item, /** @type {string} */ colId) => valorDoCampoEntrada(item, colId) || "–", []);
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={ENTRADAS_ESTOQUE_COLUNAS}
      storageKey={ENTRADAS_ESTOQUE_STORAGE_KEY}
      droppableId="colunas-estoque-entradas"
      getFieldValue={valorDoCampoEntrada}
      compararParaOrdenar={compararEntradasParaOrdenar}
      renderCell={renderCell}
      defaultSortKey="data"
      defaultSortDir="desc"
      emptyText={props.emptyText}
      isLoading={props.isLoading}
      onOpen={props.onOpen}
      renderAcoesDaLinha={props.renderAcoesDaLinha}
      showConfigColunas={props.showConfigColunas}
      setShowConfigColunas={props.setShowConfigColunas}
      searchQuery=""
      matchesSearch={props.matchesSearch}
      resetFiltersKey={props.resetFiltersKey}
      onSelectionChange={props.onSelectionChange}
      onFiltersActiveChange={props.onFiltersActiveChange}
      viewMode={props.viewMode}
      cardFields={props.cardFields}
      cardsPerRow={props.cardsPerRow}
      quickFilterIds={FILTROS_AUTOMATICOS}
      cardsTitleColId="produto"
      cardsCodeColId="motivo"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

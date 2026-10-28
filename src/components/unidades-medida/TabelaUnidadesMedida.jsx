import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";

export const UNIDADES_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, align: "left", width: 60 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, align: "left", width: 120 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, align: "left", width: 300 },
  {
    id: "ativo",
    label: "Ativo",
    default: true,
    sortable: true,
    align: "center",
    width: 80,
    cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE,
  },
];

export function getUnidadeFieldValue(item, colId) {
  if (colId === "numero") return item.numero_unidade || "";
  if (colId === "sigla") return item.sigla || "";
  if (colId === "descricao") return item.descricao || "";
  if (colId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

function renderCell(item, colId) {
  if (colId === "numero") return item.numero_unidade || "–";
  if (colId === "sigla") {
    return (
      <span
        className={`uppercase font-mono font-semibold ${item.ativo === false ? "text-slate-400 line-through" : ""}`}
      >
        {item.sigla || "–"}
      </span>
    );
  }
  if (colId === "descricao") return item.descricao || "–";
  return "–";
}

export default function TabelaUnidadesMedida(props) {
  return (
    <CadastroBase1Grade
      rows={props.unidades}
      columns={UNIDADES_COLUNAS}
      storageKey="colunas_unidades_medida"
      droppableId="colunas-unidades-medida"
      getFieldValue={getUnidadeFieldValue}
      renderCell={renderCell}
      defaultSortKey="sigla"
      emptyText="Nenhuma unidade encontrada"
      isLoading={props.isLoading}
      onOpen={props.onEdit}
      showConfigColunas={props.showConfigColunas}
      setShowConfigColunas={props.setShowConfigColunas}
      searchQuery={props.searchQuery}
      matchesSearch={props.matchesSearch}
      resetFiltersKey={props.resetFiltersKey}
      onSelectionChange={props.onSelectionChange}
      onFiltersActiveChange={props.onFiltersActiveChange}
      viewMode={props.viewMode}
      cardFields={props.cardFields}
      cardsPerRow={props.cardsPerRow}
      cardsTitleColId="descricao"
      cardsCodeColId="sigla"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

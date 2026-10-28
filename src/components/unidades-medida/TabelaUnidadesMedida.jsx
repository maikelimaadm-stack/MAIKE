import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { Badge } from "@/components/ui/badge";

export const UNIDADES_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, align: "left", width: 60 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, align: "left", width: 120 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, align: "left", width: 300 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
];

export function getUnidadeFieldValue(item, colId) {
  if (colId === "numero") return item.numero_unidade || "";
  if (colId === "sigla") return item.sigla || "";
  if (colId === "descricao") return item.descricao || "";
  if (colId === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
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
  if (colId === "ativo") {
    return item.ativo !== false ? (
      <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700">
        Ativo
      </Badge>
    ) : (
      <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-500">
        Inativo
      </Badge>
    );
  }
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
      colunaSelecao={false}
      selecaoSticky={false}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

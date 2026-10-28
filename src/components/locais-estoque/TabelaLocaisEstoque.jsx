import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";

export const LOCAIS_ESTOQUE_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, align: "left", width: 60 },
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left", width: 220 },
  { id: "capacidade", label: "Capacidade", default: true, sortable: true, align: "left", width: 150 },
  { id: "descricao", label: "Descrição", default: true, sortable: false, align: "left", width: 250 },
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

export function getLocalEstoqueFieldValue(item, colId) {
  if (colId === "numero") return item.numero_local || "";
  if (colId === "nome") return item.nome || "";
  if (colId === "capacidade") return item.capacidade || "";
  if (colId === "descricao") return item.descricao || "";
  if (colId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

function renderCell(item, colId) {
  if (colId === "numero") return item.numero_local || "–";
  if (colId === "nome") {
    return (
      <span className={`uppercase font-medium ${item.ativo === false ? "text-slate-400 line-through" : ""}`}>
        {item.nome || "–"}
      </span>
    );
  }
  if (colId === "capacidade") return item.capacidade || "–";
  if (colId === "descricao") return item.descricao || "–";
  return "–";
}

export default function TabelaLocaisEstoque(props) {
  return (
    <CadastroBase1Grade
      rows={props.locais}
      columns={LOCAIS_ESTOQUE_COLUNAS}
      storageKey="colunas_locais_estoque"
      droppableId="colunas-locais-estoque"
      getFieldValue={getLocalEstoqueFieldValue}
      renderCell={renderCell}
      defaultSortKey="nome"
      emptyText="Nenhum local encontrado"
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
      cardsTitleColId="nome"
      cardsCodeColId="numero"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      colunaSelecao={false}
      selecaoSticky={false}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

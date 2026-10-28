import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";

export const MARCAS_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 300 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 300 },
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

export function getMarcaFieldValue(item, id) {
  if (id === "numero") return item.numero_marca || "";
  if (id === "nome") return item.nome || "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

function renderCell(item, colId) {
  if (colId === "numero") return <span className="font-mono">{item.numero_marca || "–"}</span>;
  if (colId === "nome") return <span className="uppercase">{item.nome || "–"}</span>;
  if (colId === "descricao") return item.descricao || "–";
  return "–";
}

export default function TabelaMarcas(props) {
  return (
    <CadastroBase1Grade
      rows={props.marcas}
      columns={MARCAS_COLUNAS}
      storageKey="colunas_marcas_v1"
      droppableId="colunas-marcas"
      getFieldValue={getMarcaFieldValue}
      renderCell={renderCell}
      defaultSortKey="nome"
      emptyText="Nenhuma marca encontrada"
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
      displayLimit={props.displayLimit}
      onListMetrics={props.onListMetrics}
      cardFields={props.cardFields}
      cardsPerRow={props.cardsPerRow}
      cardsTitleColId="nome"
      cardsCodeColId="numero"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

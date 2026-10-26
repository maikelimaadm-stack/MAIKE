import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";

export const MARCAS_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 300 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 300 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
];

export function getMarcaFieldValue(item, id) {
  if (id === "numero") return item.numero_marca || "";
  if (id === "nome") return item.nome || "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return item.ativo !== false ? "Sim" : "Não";
  return "";
}

function renderCell(item, colId) {
  if (colId === "numero") return <span className="font-mono">{item.numero_marca || "–"}</span>;
  if (colId === "nome") return <span className="uppercase">{item.nome || "–"}</span>;
  if (colId === "descricao") return item.descricao || "–";
  if (colId === "ativo") {
    const on = item.ativo !== false;
    return (
      <span className={on ? "mg-b1-status--yes" : "mg-b1-status--no"}>
        {on ? "Sim" : "Não"}
      </span>
    );
  }
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
      referenceHeaders
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

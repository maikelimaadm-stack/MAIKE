import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";

export const CENTROS_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "caminho", label: "Hierarquia", default: true, sortable: true, width: 320 },
  { id: "nome", label: "Nome", default: false, sortable: true, width: 220 },
  { id: "pai", label: "Pai", default: true, sortable: true, width: 200 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 260 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

export function getCentroFieldValue(item, id) {
  if (id === "numero") return item.numero != null ? String(item.numero) : "";
  if (id === "caminho") return item.caminho || item.nome || "";
  if (id === "nome") return item.nome || "";
  if (id === "pai") return item.pai_nome || "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

function renderCell(item, colId) {
  if (colId === "numero") return <span className="font-mono">{item.numero ?? "–"}</span>;
  if (colId === "caminho") {
    const nivel = Math.max(0, String(item.caminho || "").split(" / ").length - 1);
    return (
      <span data-testid={`centro-caminho-${item.id}`} className="uppercase" style={{ paddingLeft: `${nivel * 12}px` }} title={item.caminho || item.nome}>
        {nivel ? <span aria-hidden className="text-[var(--mg-text-3,#94a3b8)]">└ </span> : null}
        {item.nome || "–"}
      </span>
    );
  }
  const v = getCentroFieldValue(item, colId);
  return v || "–";
}

export default function TabelaCentros(props) {
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={CENTROS_COLUNAS}
      storageKey={props.storageKey}
      droppableId={props.droppableId}
      getFieldValue={getCentroFieldValue}
      renderCell={renderCell}
      defaultSortKey="caminho"
      emptyText={props.emptyText}
      isLoading={props.isLoading}
      onOpen={props.onEdit}
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
      cardsTitleColId="caminho"
      cardsCodeColId="numero"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

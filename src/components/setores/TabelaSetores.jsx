import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";

export const SETORES_COLUNAS = [
  { id: "sigla", label: "Sigla", default: true, sortable: true, width: 100 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 200 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 140 },
  { id: "responsavel", label: "Responsável", default: true, sortable: true, width: 160 },
  { id: "cidade", label: "Cidade/UF", default: true, sortable: true, width: 160 },
  { id: "area_total", label: "Área (ha)", default: true, sortable: true, align: "right", width: 120 },
  { id: "capacidade_animais", label: "Capacidade", default: true, sortable: true, align: "right", width: 120 },
  { id: "telefone", label: "Telefone", default: false, sortable: true, width: 140 },
  {
    id: "ativo",
    label: "Status",
    default: true,
    sortable: true,
    width: 100,
    cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE,
  },
];

export function getSetorFieldValue(item, colunaId) {
  if (colunaId === "sigla") return item.sigla || "";
  if (colunaId === "nome") return item.nome || "";
  if (colunaId === "tipo") return item.tipo || "";
  if (colunaId === "responsavel") return item.responsavel || "";
  if (colunaId === "cidade")
    return item.cidade && item.estado ? `${item.cidade}/${item.estado}` : item.cidade || item.estado || "";
  if (colunaId === "area_total") return item.area_total ? String(Number(item.area_total).toLocaleString("pt-BR")) : "";
  if (colunaId === "capacidade_animais")
    return item.capacidade_animais ? String(Number(item.capacidade_animais).toLocaleString("pt-BR")) : "";
  if (colunaId === "telefone") return item.telefone || "";
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

function renderCell(item, colunaId) {
  const v = getSetorFieldValue(item, colunaId);
  if (colunaId === "nome") return <span className="uppercase">{v || "–"}</span>;
  if (colunaId === "sigla") return <span className="uppercase font-mono">{v || "–"}</span>;
  return v || "–";
}

export default function TabelaSetores(props) {
  return (
    <CadastroBase1Grade
      rows={props.setores}
      columns={SETORES_COLUNAS}
      storageKey="colunas_largura_setores"
      droppableId="colunas-setores"
      getFieldValue={getSetorFieldValue}
      renderCell={renderCell}
      defaultSortKey="nome"
      emptyText="Nenhum setor encontrado"
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
      cardsCodeColId="sigla"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      colunaSelecao={false}
      selecaoSticky={false}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";

export const GRUPOS_ATIVIDADES_COLUNAS = [
  { id: "nome_grupo", label: "Nome", default: true, sortable: true, width: 220 },
  {
    id: "ativo",
    label: "Ativo",
    default: true,
    sortable: true,
    width: 100,
    align: "center",
    cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE,
  },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 240 },
  { id: "observacoes", label: "Observações", default: true, sortable: true, width: 240 },
  { id: "created_date", label: "Criado em", default: false, sortable: true, width: 170 },
  { id: "updated_date", label: "Atualizado em", default: true, sortable: true, width: 170 },
];

const formatarDataHora = (data) => {
  if (!data) return "-";
  return new Date(data).toLocaleString("pt-BR");
};

export function getGrupoAtividadeFieldValue(item, colunaId) {
  if (colunaId === "nome_grupo") return item.nome_grupo || "";
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  if (colunaId === "descricao") return item.descricao || "";
  if (colunaId === "observacoes") return item.observacoes || "";
  if (colunaId === "created_date") return formatarDataHora(item.created_date);
  if (colunaId === "updated_date") return formatarDataHora(item.updated_date);
  return "";
}

function renderCell(item, colunaId) {
  return getGrupoAtividadeFieldValue(item, colunaId) || "–";
}

export default function TabelaGruposAtividades(props) {
  return (
    <CadastroBase1Grade
      rows={props.grupos}
      columns={GRUPOS_ATIVIDADES_COLUNAS}
      storageKey="colunas_grupos_atividades"
      droppableId="colunas-grupos-atividades"
      getFieldValue={getGrupoAtividadeFieldValue}
      renderCell={renderCell}
      defaultSortKey="nome_grupo"
      emptyText="Nenhum grupo encontrado"
      onOpen={props.onEdit}
      showConfigColunas={props.showConfigColunas}
      setShowConfigColunas={props.setShowConfigColunas}
      searchQuery={props.searchQuery}
      resetFiltersKey={props.resetFiltersKey}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
      isLoading={props.isLoading}
      onSelectionChange={props.onSelectionChange}
      onFiltersActiveChange={props.onFiltersActiveChange}
      viewMode={props.viewMode}
      displayLimit={props.displayLimit}
      onListMetrics={props.onListMetrics}
      cardFields={props.cardFields}
      cardsPerRow={props.cardsPerRow}
      matchesSearch={
        props.matchesSearch ??
        ((item, q) => {
          const hay = [item.nome_grupo, item.descricao, item.observacoes]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      }
    />
  );
}

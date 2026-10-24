import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";

export const TIPOS_TAREFA_COLUNAS = [
  { id: "nome_tipo", label: "Tipo", default: true, sortable: true, width: 220 },
  { id: "grupo_atividade_nome", label: "Grupo", default: true, sortable: true, width: 220 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, width: 100 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 260 },
  { id: "created_date", label: "Criado em", default: false, sortable: true, width: 170 },
  { id: "updated_date", label: "Atualizado em", default: true, sortable: true, width: 170 },
];

const formatarDataHora = (data) => {
  if (!data) return "-";
  return new Date(data).toLocaleString("pt-BR");
};

/** @param {object[]} [grupos] */
export function getTipoTarefaFieldValue(item, colunaId, grupos = []) {
    if (colunaId === "nome_tipo") return item.nome_tipo || "";
    if (colunaId === "grupo_atividade_nome")
      return item.grupo_atividade_nome || grupos.find((g) => g.id === item.grupo_atividade_id)?.nome_grupo || "";
    if (colunaId === "ativo") return item.ativo ? "Sim" : "Não";
    if (colunaId === "descricao") return item.descricao || "";
    if (colunaId === "created_date") return formatarDataHora(item.created_date);
    if (colunaId === "updated_date") return formatarDataHora(item.updated_date);
  return "";
}

export default function TabelaTiposTarefa({ tipos = [], grupos = [], ...props }) {
  const getFieldValue = (item, colunaId) => getTipoTarefaFieldValue(item, colunaId, grupos);

  return (
    <CadastroBase1Grade
      rows={tipos}
      columns={TIPOS_TAREFA_COLUNAS}
      storageKey="colunas_largura_tipos_tarefa"
      droppableId="colunas-tipos-tarefa"
      getFieldValue={getFieldValue}
      renderCell={(item, colId) => getFieldValue(item, colId) || "–"}
      defaultSortKey="nome_tipo"
      emptyText="Nenhum tipo encontrado"
      onOpen={props.onEdit}
      showConfigColunas={props.showConfigColunas}
      setShowConfigColunas={props.setShowConfigColunas}
      searchQuery={props.searchQuery}
      resetFiltersKey={props.resetFiltersKey}
      onSelectionChange={props.onSelectionChange}
      onFiltersActiveChange={props.onFiltersActiveChange}
      matchesSearch={(item, q) => {
        const grupoNome =
          item.grupo_atividade_nome || grupos.find((g) => g.id === item.grupo_atividade_id)?.nome_grupo || "";
        const hay = [item.nome_tipo, grupoNome, item.descricao].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      }}
    />
  );
}

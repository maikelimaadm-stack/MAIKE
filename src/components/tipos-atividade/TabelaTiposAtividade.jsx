import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { rotuloDaCategoriaTipoAtividade } from "@/components/tipos-atividade/FormularioTipoAtividade";

/**
 * Prefixo das preferências da grade e dos cards. D-PROD-195: a coluna Categoria
 * entrou visível por padrão, e a preferência salva na chave antiga a esconderia
 * (a lista de visíveis gravada não a tem) — por isso a chave passou a `_v2`.
 */
export const TIPOS_ATIVIDADE_STORAGE_KEY = "colunas_largura_tipos_atividade_v2";

export const TIPOS_ATIVIDADE_COLUNAS = [
  { id: "grupo_atividade_nome", label: "Grupo", default: true, sortable: true, width: 220 },
  { id: "nome_tipo", label: "Tipo de atividade", default: true, sortable: true, width: 240 },
  { id: "categoria", label: "Categoria", default: true, sortable: true, width: 170 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 260 },
  {
    id: "ativo",
    label: "Ativo",
    default: true,
    sortable: true,
    width: 100,
    align: "center",
    cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE,
  },
  { id: "created_date", label: "Criado em", default: false, sortable: true, width: 170 },
  { id: "updated_date", label: "Atualizado em", default: true, sortable: true, width: 170 },
];

/** @param {string | null | undefined} data */
const formatarDataHora = (data) => {
  if (!data) return "-";
  return new Date(data).toLocaleString("pt-BR");
};

/**
 * @typedef {{ id: string, nome_grupo?: string }} GrupoOpcao
 * @param {any} item
 * @param {string} colunaId
 * @param {GrupoOpcao[]} [grupos]
 * @returns {string}
 */
export function getTipoAtividadeFieldValue(item, colunaId, grupos = []) {
  if (colunaId === "nome_tipo") return item.nome_tipo || "";
  if (colunaId === "grupo_atividade_nome")
    return item.grupo_atividade_nome || grupos.find((g) => g.id === item.grupo_atividade_id)?.nome_grupo || "";
  if (colunaId === "categoria") return rotuloDaCategoriaTipoAtividade(item.categoria);
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  if (colunaId === "descricao") return item.descricao || "";
  if (colunaId === "created_date") return formatarDataHora(item.created_date);
  if (colunaId === "updated_date") return formatarDataHora(item.updated_date);
  return "";
}

/** @param {{ tipos?: any[], grupos?: GrupoOpcao[], [prop: string]: any }} props */
export default function TabelaTiposAtividade({ tipos = [], grupos = [], ...props }) {
  /** @param {any} item @param {string} colunaId */
  const getFieldValue = (item, colunaId) => getTipoAtividadeFieldValue(item, colunaId, grupos);
  /** @type {any} */
  const Grade = CadastroBase1Grade;

  return (
    <Grade
      rows={tipos}
      columns={TIPOS_ATIVIDADE_COLUNAS}
      storageKey={TIPOS_ATIVIDADE_STORAGE_KEY}
      droppableId="colunas-tipos-atividade"
      getFieldValue={getFieldValue}
      renderCell={(/** @type {any} */ item, /** @type {string} */ colId) => getFieldValue(item, colId) || "–"}
      defaultSortKey="nome_tipo"
      emptyText="Nenhum tipo de atividade encontrado"
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
        ((/** @type {any} */ item, /** @type {string} */ q) => {
          const grupoNome =
            item.grupo_atividade_nome ||
            grupos.find((g) => g.id === item.grupo_atividade_id)?.nome_grupo ||
            "";
          const hay = [item.nome_tipo, grupoNome, item.descricao].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(q);
        })
      }
    />
  );
}

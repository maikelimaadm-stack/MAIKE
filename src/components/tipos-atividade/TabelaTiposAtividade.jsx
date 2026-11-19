import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { rotuloDaCategoriaTipoAtividade } from "@/components/tipos-atividade/FormularioTipoAtividade";

/**
 * Prefixo das preferências da grade e dos cards. D-PROD-197: a coluna Categoria
 * entrou visível por padrão, e a preferência salva na chave antiga a esconderia
 * (a lista de visíveis gravada não a tem) — por isso a chave passou a `_v2`.
 */
export const TIPOS_ATIVIDADE_STORAGE_KEY = "colunas_largura_tipos_atividade_v4";

export const TIPOS_ATIVIDADE_COLUNAS = [
  { id: "categoria", label: "Tipo", default: true, sortable: true, width: 240 },
  { id: "nome_tipo", label: "Operação", default: true, sortable: true, width: 280 },
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
 * @param {any} item
 * @param {string} colunaId
 * @returns {string}
 */
export function getTipoAtividadeFieldValue(item, colunaId) {
  if (colunaId === "nome_tipo") return item.nome_tipo || "";
  // Operação antiga sem tipo fixo aparece como "Outros" até o script de dados (ou a edição) corrigir.
  if (colunaId === "categoria") return rotuloDaCategoriaTipoAtividade(item.categoria || "OUTROS");
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  if (colunaId === "created_date") return formatarDataHora(item.created_date);
  if (colunaId === "updated_date") return formatarDataHora(item.updated_date);
  return "";
}

/** @param {{ tipos?: any[], [prop: string]: any }} props */
export default function TabelaTiposAtividade({ tipos = [], ...props }) {
  /** @param {any} item @param {string} colunaId */
  const getFieldValue = (item, colunaId) => getTipoAtividadeFieldValue(item, colunaId);
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
          const hay = [item.nome_tipo, getFieldValue(item, "categoria")].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(q);
        })
      }
    />
  );
}

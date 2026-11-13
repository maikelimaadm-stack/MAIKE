import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { diasEntre, ehDiaValido, formatarDia } from "@/lib/diaCivil";
import { rotuloTipoEstacao } from "@/services/estacaoCadastroService";

export const ESTACOES_STORAGE_KEY = "colunas_largura_estacoes";

export const ESTACOES_COLUNAS = [
  { id: "nome", label: "Nome", default: true, sortable: true, width: 220 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 140 },
  { id: "data_inicio", label: "Início", default: true, sortable: true, width: 120 },
  { id: "data_fim", label: "Fim", default: true, sortable: true, width: 120 },
  { id: "duracao_dias", label: "Dias", default: true, sortable: true, width: 90, align: "right" },
  { id: "observacoes", label: "Observações", default: false, sortable: true, width: 260 },
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
  { id: "updated_date", label: "Atualizado em", default: false, sortable: true, width: 170 },
];

/** @param {string | null | undefined} data */
const formatarDataHora = (data) => {
  if (!data) return "-";
  return new Date(data).toLocaleString("pt-BR");
};

/**
 * Dias corridos da estação, contando o primeiro e o último (01/11 a 01/11 = 1).
 * @param {any} item
 * @returns {number | null}
 */
export const duracaoEstacaoEmDias = (item) => {
  const d = diasEntre(item?.data_inicio, item?.data_fim);
  return d === null || d < 0 ? null : d + 1;
};

/**
 * @param {any} item
 * @param {string} colunaId
 * @returns {string}
 */
export function getEstacaoFieldValue(item, colunaId) {
  if (colunaId === "nome") return item.nome || "";
  if (colunaId === "tipo") return rotuloTipoEstacao(item.tipo);
  if (colunaId === "data_inicio") return ehDiaValido(item.data_inicio) ? formatarDia(item.data_inicio) : "";
  if (colunaId === "data_fim") return ehDiaValido(item.data_fim) ? formatarDia(item.data_fim) : "";
  if (colunaId === "duracao_dias") {
    const d = duracaoEstacaoEmDias(item);
    return d === null ? "" : String(d);
  }
  if (colunaId === "observacoes") return item.observacoes || "";
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  if (colunaId === "created_date") return formatarDataHora(item.created_date);
  if (colunaId === "updated_date") return formatarDataHora(item.updated_date);
  return "";
}

/**
 * Datas e duração ordenam pelo valor canônico (AAAA-MM-DD e número), nunca
 * pelo texto formatado ("dd/mm/aaaa" ordenaria errado). Vazio por último.
 * Demais colunas: regra da grade.
 * @param {any} a @param {any} b @param {string} colId
 * @returns {number|null}
 */
export const compararEstacoesParaOrdenar = (a, b, colId) => {
  if (colId === "data_inicio" || colId === "data_fim") {
    const va = ehDiaValido(a?.[colId]) ? a[colId] : null;
    const vb = ehDiaValido(b?.[colId]) ? b[colId] : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return va < vb ? -1 : va > vb ? 1 : 0;
  }
  if (colId === "duracao_dias") {
    const va = duracaoEstacaoEmDias(a);
    const vb = duracaoEstacaoEmDias(b);
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return va - vb;
  }
  return null;
};

/** @param {{ rows?: any[], emptyText?: string, [prop: string]: any }} props */
export default function TabelaEstacoes({ rows = [], emptyText = "Nenhuma estação encontrada", ...props }) {
  /** @type {any} */
  const Grade = CadastroBase1Grade;

  return (
    <Grade
      rows={rows}
      columns={ESTACOES_COLUNAS}
      storageKey={ESTACOES_STORAGE_KEY}
      droppableId="colunas-estacoes"
      getFieldValue={getEstacaoFieldValue}
      compararParaOrdenar={compararEstacoesParaOrdenar}
      renderCell={(/** @type {any} */ item, /** @type {string} */ colId) => getEstacaoFieldValue(item, colId) || "–"}
      defaultSortKey="data_inicio"
      defaultSortDir="desc"
      emptyText={emptyText}
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
          const hay = [item.nome, rotuloTipoEstacao(item.tipo), item.observacoes].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(q);
        })
      }
    />
  );
}

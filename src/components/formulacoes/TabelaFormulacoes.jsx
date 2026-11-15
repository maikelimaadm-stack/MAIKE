import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { formatarNumero, rotuloDoTipo } from "@/services/formulacaoCadastroService";

/** Chave das preferências de colunas da grade de Formulações (D-PROD-203). */
export const FORMULACOES_STORAGE_KEY = "colunas_largura_formulacoes_v1";

export const FORMULACOES_COLUNAS = [
  { id: "nome", label: "Nome", default: true, sortable: true, width: 240 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 140 },
  { id: "produto_nome", label: "Produto", default: true, sortable: true, width: 220 },
  { id: "percentual_pv_padrao", label: "% PV padrão", default: true, sortable: true, width: 120, align: "right" },
  { id: "regras", label: "Regras", default: true, sortable: true, width: 100, align: "right" },
  { id: "ingredientes", label: "Ingredientes / batida", default: true, sortable: true, width: 180, align: "right" },
  { id: "consumo_objetivo_g_cab_dia", label: "Objetivo (g/cab/dia)", default: false, sortable: true, width: 160, align: "right" },
  // D-PROD-206: faixa do farol de consumo (vazio = 15%).
  { id: "faixa_tolerancia_percentual", label: "Faixa (%)", default: false, sortable: true, width: 110, align: "right" },
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
const formatarDataHora = (data) => (data ? new Date(data).toLocaleString("pt-BR") : "-");

/**
 * Texto de uma coluna (grade, cartões e CSV).
 * @param {any} item
 * @param {string} colunaId
 * @returns {string}
 */
export function getFormulacaoFieldValue(item, colunaId) {
  if (colunaId === "nome") return item.nome || "";
  if (colunaId === "tipo") return rotuloDoTipo(item.tipo);
  if (colunaId === "produto_nome") return item.produto_nome || "";
  if (colunaId === "percentual_pv_padrao") return typeof item.percentual_pv_padrao === "number" ? `${formatarNumero(item.percentual_pv_padrao)}%` : "";
  if (colunaId === "regras") return String((item.regras || []).length);
  if (colunaId === "ingredientes") {
    if (item.tipo !== "BATELADA") return "–";
    const n = (item.ingredientes || []).length;
    return `${n} / ${formatarNumero(item.total_batida_kg ?? 0, { casasMax: 3 })} kg`;
  }
  if (colunaId === "consumo_objetivo_g_cab_dia") return formatarNumero(item.consumo_objetivo_g_cab_dia, { casasMax: 2 });
  if (colunaId === "faixa_tolerancia_percentual") return typeof item.faixa_tolerancia_percentual === "number" ? `${formatarNumero(item.faixa_tolerancia_percentual, { casasMax: 2 })}%` : "15% (padrão)";
  if (colunaId === "observacoes") return item.observacoes || "";
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  if (colunaId === "created_date") return formatarDataHora(item.created_date);
  if (colunaId === "updated_date") return formatarDataHora(item.updated_date);
  return "";
}

/** Número de uma coluna numérica para ordenar (`null` = vazio, por último). @param {any} item @param {string} colId */
const numeroDaColuna = (item, colId) => {
  if (colId === "regras") return (item?.regras || []).length;
  if (colId === "ingredientes") return item?.tipo === "BATELADA" ? Number(item.total_batida_kg ?? 0) : null;
  const v = item?.[colId];
  return typeof v === "number" ? v : null;
};
const NUMERICAS = new Set(["percentual_pv_padrao", "regras", "ingredientes", "consumo_objetivo_g_cab_dia", "faixa_tolerancia_percentual"]);

/**
 * Colunas numéricas ordenam pelo número; as demais, pela regra da grade.
 * @param {any} a @param {any} b @param {string} colId
 * @returns {number|null}
 */
export const compararFormulacoesParaOrdenar = (a, b, colId) => {
  if (!NUMERICAS.has(colId)) return null;
  const va = numeroDaColuna(a, colId);
  const vb = numeroDaColuna(b, colId);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  return va - vb;
};

/** @param {{ rows?: any[], emptyText?: string, [prop: string]: any }} props */
export default function TabelaFormulacoes({ rows = [], emptyText = "Nenhuma formulação encontrada", ...props }) {
  /** @type {any} */
  const Grade = CadastroBase1Grade;

  return (
    <Grade
      rows={rows}
      columns={FORMULACOES_COLUNAS}
      storageKey={FORMULACOES_STORAGE_KEY}
      droppableId="colunas-formulacoes"
      getFieldValue={getFormulacaoFieldValue}
      compararParaOrdenar={compararFormulacoesParaOrdenar}
      renderCell={(/** @type {any} */ item, /** @type {string} */ colId) => getFormulacaoFieldValue(item, colId) || "–"}
      defaultSortKey="nome"
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
          const hay = [item.nome, item.produto_nome, item.observacoes].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(q);
        })
      }
    />
  );
}

import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { formatarGmd } from "@/services/curvaGanhoCadastroService";

export const CURVAS_GANHO_STORAGE_KEY = "colunas_largura_curvas_ganho";

export const CURVAS_GANHO_COLUNAS = [
  { id: "nome", label: "Nome", default: true, sortable: true, width: 240 },
  { id: "gmd_aguas", label: "GMD Águas (kg/dia)", default: true, sortable: true, width: 150, align: "right" },
  { id: "gmd_transicao", label: "GMD Transição (kg/dia)", default: true, sortable: true, width: 170, align: "right" },
  { id: "gmd_seca", label: "GMD Seca (kg/dia)", default: true, sortable: true, width: 150, align: "right" },
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

const COLUNAS_GMD = new Set(["gmd_aguas", "gmd_transicao", "gmd_seca"]);

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
export function getCurvaGanhoFieldValue(item, colunaId) {
  if (colunaId === "nome") return item.nome || "";
  if (COLUNAS_GMD.has(colunaId)) return formatarGmd(item[colunaId], { casasMin: 2 });
  if (colunaId === "observacoes") return item.observacoes || "";
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  if (colunaId === "created_date") return formatarDataHora(item.created_date);
  if (colunaId === "updated_date") return formatarDataHora(item.updated_date);
  return "";
}

/**
 * GMD ordena pelo número (o texto "-0,15" e "0,65" ordenaria errado) e os
 * instantes pelo ISO do servidor. Vazio por último. Demais colunas: regra da grade.
 * @param {any} a @param {any} b @param {string} colId
 * @returns {number|null}
 */
export const compararCurvasParaOrdenar = (a, b, colId) => {
  if (COLUNAS_GMD.has(colId)) {
    const va = typeof a?.[colId] === "number" ? a[colId] : null;
    const vb = typeof b?.[colId] === "number" ? b[colId] : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return va - vb;
  }
  if (colId === "created_date" || colId === "updated_date") {
    const va = typeof a?.[colId] === "string" && a[colId] ? a[colId] : null;
    const vb = typeof b?.[colId] === "string" && b[colId] ? b[colId] : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    return va < vb ? -1 : va > vb ? 1 : 0;
  }
  return null;
};

/** @param {{ rows?: any[], emptyText?: string, [prop: string]: any }} props */
export default function TabelaCurvasGanho({ rows = [], emptyText = "Nenhuma curva de ganho encontrada", ...props }) {
  /** @type {any} */
  const Grade = CadastroBase1Grade;

  return (
    <Grade
      rows={rows}
      columns={CURVAS_GANHO_COLUNAS}
      storageKey={CURVAS_GANHO_STORAGE_KEY}
      droppableId="colunas-curvas-ganho"
      getFieldValue={getCurvaGanhoFieldValue}
      compararParaOrdenar={compararCurvasParaOrdenar}
      renderCell={(/** @type {any} */ item, /** @type {string} */ colId) => getCurvaGanhoFieldValue(item, colId) || "–"}
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
          const hay = [item.nome, item.observacoes].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(q);
        })
      }
    />
  );
}

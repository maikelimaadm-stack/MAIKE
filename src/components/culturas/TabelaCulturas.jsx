import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { formatarAlturaCm, rotuloTipoCultura } from "@/services/culturaCadastroService";

export const CULTURAS_STORAGE_KEY = "colunas_largura_culturas";

export const CULTURAS_COLUNAS = [
  { id: "codigo", label: "Código", default: true, sortable: true, width: 100 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 260 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 130 },
  { id: "especie", label: "Espécie", default: true, sortable: true, width: 190 },
  { id: "cultivar", label: "Cultivar", default: false, sortable: true, width: 150 },
  { id: "altura_entrada_cm", label: "Entrada (cm)", default: true, sortable: true, width: 120, align: "right" },
  { id: "altura_saida_cm", label: "Saída (cm)", default: true, sortable: true, width: 110, align: "right" },
  { id: "observacoes", label: "Observações", default: false, sortable: true, width: 300 },
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
 * @param {any} item
 * @param {string} colunaId
 * @returns {string}
 */
export function getCulturaFieldValue(item, colunaId) {
  if (colunaId === "codigo") return item.codigo || "";
  if (colunaId === "nome") return item.nome || "";
  if (colunaId === "tipo") return rotuloTipoCultura(item.tipo);
  if (colunaId === "especie") return item.especie || "";
  if (colunaId === "cultivar") return item.cultivar || "";
  if (colunaId === "altura_entrada_cm") return formatarAlturaCm(item.altura_entrada_cm);
  if (colunaId === "altura_saida_cm") return formatarAlturaCm(item.altura_saida_cm);
  if (colunaId === "observacoes") return item.observacoes || "";
  if (colunaId === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  if (colunaId === "created_date") return formatarDataHora(item.created_date);
  if (colunaId === "updated_date") return formatarDataHora(item.updated_date);
  return "";
}

/** @param {unknown} v @returns {number|null} */
const numeroOuNulo = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Alturas ordenam pelo número (o texto "100" viria antes de "25"); instantes
 * pelo ISO. Vazio por último. Demais colunas: regra da grade.
 * @param {any} a @param {any} b @param {string} colId
 * @returns {number|null}
 */
export const compararCulturasParaOrdenar = (a, b, colId) => {
  if (colId === "altura_entrada_cm" || colId === "altura_saida_cm") {
    const va = numeroOuNulo(a?.[colId]);
    const vb = numeroOuNulo(b?.[colId]);
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

/** @param {any} item */
export const textoBuscaCultura = (item) =>
  [item.codigo, item.nome, rotuloTipoCultura(item.tipo), item.especie, item.cultivar, item.observacoes].filter(Boolean).join(" ");

/** @param {{ rows?: any[], emptyText?: string, [prop: string]: any }} props */
export default function TabelaCulturas({ rows = [], emptyText = "Nenhuma cultura encontrada", ...props }) {
  /** @type {any} */
  const Grade = CadastroBase1Grade;

  return (
    <Grade
      rows={rows}
      columns={CULTURAS_COLUNAS}
      storageKey={CULTURAS_STORAGE_KEY}
      droppableId="colunas-culturas"
      getFieldValue={getCulturaFieldValue}
      compararParaOrdenar={compararCulturasParaOrdenar}
      renderCell={(/** @type {any} */ item, /** @type {string} */ colId) => getCulturaFieldValue(item, colId) || "–"}
      defaultSortKey="codigo"
      defaultSortDir="asc"
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
        ((/** @type {any} */ item, /** @type {string} */ q) => textoBuscaCultura(item).toLowerCase().includes(q))
      }
    />
  );
}

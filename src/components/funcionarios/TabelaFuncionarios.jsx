import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { formatarMoeda, paraUnidades } from "@/lib/dinheiroDecimal";
import { rotuloTipoFuncionario } from "@/services/funcionarioCadastroService";

export const FUNCIONARIOS_STORAGE_KEY = "colunas_funcionarios_v1";

export const FUNCIONARIOS_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 240 },
  { id: "cargo", label: "Cargo", default: true, sortable: true, width: 180 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 130 },
  { id: "custo_hora", label: "Custo/hora", default: true, sortable: true, width: 120, align: "right" },
  { id: "custo_diaria", label: "Custo/diária", default: true, sortable: true, width: 120, align: "right" },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/** Campos padrão dos cards (Motor Base1): o nome é o título; o número, o código. */
export const FUNCIONARIOS_CAMPOS_CARD = ["numero", "tipo", "cargo", "ativo", "nome", "custo_hora", "custo_diaria"];

/** @param {unknown} v */
const custo = (v) => (typeof v === "string" && v ? formatarMoeda(v, { casasMax: 4 }) : "");

/** @param {any} item @param {string} id @returns {string} */
export function getFuncionarioFieldValue(item, id) {
  if (id === "numero") return item.numero != null ? String(item.numero) : "";
  if (id === "nome") return item.nome || "";
  if (id === "cargo") return item.cargo || "";
  if (id === "tipo") return rotuloTipoFuncionario(item.tipo);
  if (id === "custo_hora") return custo(item.custo_hora);
  if (id === "custo_diaria") return custo(item.custo_diaria);
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

/** Texto canônico → BigInt em 4 casas (vazio ou inválido = null). @param {unknown} v */
const unidadesDe = (v) => {
  if (typeof v !== "string" || !v) return null;
  try {
    return paraUnidades(v, 4);
  } catch {
    return null;
  }
};

/**
 * Valores decimais ordenam pelo valor (nunca pelo texto "R$ …"); vazio por último.
 * Demais colunas: regra da grade.
 * @param {any} a @param {any} b @param {string} colId @returns {number|null}
 */
export const compararDecimaisParaOrdenar = (a, b, colId, colunas = ["custo_hora", "custo_diaria"]) => {
  if (!colunas.includes(colId)) return null;
  const va = unidadesDe(a?.[colId]);
  const vb = unidadesDe(b?.[colId]);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  return va < vb ? -1 : va > vb ? 1 : 0;
};

/** @param {any} item @param {string} colId */
function renderCell(item, colId) {
  if (colId === "numero") return <span className="font-mono">{item.numero ?? "–"}</span>;
  return getFuncionarioFieldValue(item, colId) || "–";
}

/** @param {Record<string, any>} props */
export default function TabelaFuncionarios(props) {
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={FUNCIONARIOS_COLUNAS}
      storageKey={FUNCIONARIOS_STORAGE_KEY}
      droppableId="colunas-funcionarios"
      getFieldValue={getFuncionarioFieldValue}
      renderCell={renderCell}
      compararParaOrdenar={compararDecimaisParaOrdenar}
      defaultSortKey="nome"
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
      cardsTitleColId="nome"
      cardsCodeColId="numero"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { formatarMoeda, paraUnidades } from "@/lib/dinheiroDecimal";
import { rotuloDoCentro } from "@/lib/lancamentoAtividadesRegras";

export const SERVICOS_STORAGE_KEY = "colunas_servicos_v1";

export const SERVICOS_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 260 },
  { id: "unidade", label: "Unidade", default: true, sortable: true, width: 110 },
  { id: "centro_custo_padrao", label: "Centro de custo padrão", default: true, sortable: true, width: 220 },
  { id: "valor_referencia", label: "Valor de referência", default: true, sortable: true, width: 150, align: "right" },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/** Campos padrão dos cards (Motor Base1): o nome é o título; o número, o código. */
export const SERVICOS_CAMPOS_CARD = ["numero", "unidade", "valor_referencia", "ativo", "nome", "centro_custo_padrao"];

/** @param {any} item @param {string} id @returns {string} */
export function getServicoFieldValue(item, id) {
  if (id === "numero") return item.numero != null ? String(item.numero) : "";
  if (id === "nome") return item.nome || "";
  if (id === "unidade") return item.unidade_medida?.sigla || "";
  if (id === "centro_custo_padrao") return rotuloDoCentro(item.centro_custo_padrao) || "";
  if (id === "valor_referencia") return typeof item.valor_referencia === "string" && item.valor_referencia ? formatarMoeda(item.valor_referencia, { casasMax: 4 }) : "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

/** @param {any} item @param {string} colId */
function renderCell(item, colId) {
  if (colId === "numero") return <span className="font-mono">{item.numero ?? "–"}</span>;
  return getServicoFieldValue(item, colId) || "–";
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
 * Valores decimais ordenam pelo valor (nunca pelo texto "R$ …"); vazio por último. Demais colunas: regra da grade.
 * @param {any} a @param {any} b @param {string} colId @param {string[]} [colunas] @returns {number|null}
 */
export const compararDecimaisParaOrdenar = (a, b, colId, colunas = ["valor_referencia"]) => {
  if (!colunas.includes(colId)) return null;
  const va = unidadesDe(a?.[colId]);
  const vb = unidadesDe(b?.[colId]);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  return va < vb ? -1 : va > vb ? 1 : 0;
};

/** @param {any} a @param {any} b @param {string} colId */
const comparar = (a, b, colId) => compararDecimaisParaOrdenar(a, b, colId, ["valor_referencia"]);

/** @param {Record<string, any>} props */
export default function TabelaServicos(props) {
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={SERVICOS_COLUNAS}
      storageKey={SERVICOS_STORAGE_KEY}
      droppableId="colunas-servicos"
      getFieldValue={getServicoFieldValue}
      renderCell={renderCell}
      compararParaOrdenar={comparar}
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

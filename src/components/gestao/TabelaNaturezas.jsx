import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { CADASTRO_BASE1_CELL_KIND } from "@/components/cadastro/base1/cadastroBase1CellKind";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { getCadastroAtivoFieldValue } from "@/lib/cadastroAtivoStatus";
import { ROTULO_TIPO_NATUREZA } from "@/services/naturezaFinanceiraService";

export const NATUREZAS_STORAGE_KEY = "colunas_naturezas_financeiras_v1";

export const NATUREZAS_COLUNAS = [
  { id: "numero", label: "Código", default: true, sortable: true, width: 80 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 100 },
  { id: "caminho", label: "Natureza", default: true, sortable: true, width: 340 },
  { id: "nome", label: "Nome", default: false, sortable: true, width: 220 },
  { id: "pai", label: "Pai", default: true, sortable: true, width: 220 },
  { id: "descricao", label: "Descrição", default: false, sortable: true, width: 260 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80, cellKind: CADASTRO_BASE1_CELL_KIND.ATIVO_BADGE },
];

/**
 * Campos padrão dos cards (Motor Base1). A natureza (caminho) é o título do
 * card (por isso "nome" não entra no padrão: repetiria o título); no celular
 * os 3 campos são Tipo, Pai e Ativo (Sim/Não).
 */
export const NATUREZAS_CAMPOS_CARD = ["numero", "tipo", "pai", "ativo", "descricao"];

export function getNaturezaFieldValue(item, id) {
  if (id === "numero") return item.numero != null ? String(item.numero) : "";
  if (id === "tipo") return ROTULO_TIPO_NATUREZA[item.tipo] || "";
  if (id === "caminho") return item.caminho || item.nome || "";
  if (id === "nome") return item.nome || "";
  if (id === "pai") return item.pai_nome || "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return getCadastroAtivoFieldValue(item, "ativo");
  return "";
}

/** Nível (0 = raiz): do servidor (`nivel`), senão pelo caminho. */
const nivelDe = (item) => {
  const n = Number(item.nivel);
  if (Number.isFinite(n) && n >= 1) return n - 1;
  return Math.max(0, String(item.caminho || "").split(" / ").length - 1);
};

function renderCell(item, colId) {
  if (colId === "numero") return <span className="font-mono">{item.numero ?? "–"}</span>;
  if (colId === "caminho") {
    const nivel = nivelDe(item);
    return (
      <span data-testid={`natureza-caminho-${item.id}`} className="uppercase" style={{ paddingLeft: `${nivel * 12}px` }} title={item.caminho || item.nome}>
        {nivel ? <span aria-hidden className="text-[var(--mg-text-3,#94a3b8)]">└ </span> : null}
        {item.nome || "–"}
      </span>
    );
  }
  const v = getNaturezaFieldValue(item, colId);
  return v || "–";
}

export default function TabelaNaturezas(props) {
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={NATUREZAS_COLUNAS}
      storageKey={NATUREZAS_STORAGE_KEY}
      droppableId="colunas-naturezas-financeiras"
      getFieldValue={getNaturezaFieldValue}
      renderCell={renderCell}
      defaultSortKey="caminho"
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
      cardsTitleColId="caminho"
      cardsCodeColId="numero"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

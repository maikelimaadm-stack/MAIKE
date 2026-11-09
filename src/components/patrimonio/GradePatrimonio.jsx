import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";

/**
 * @typedef {{
 *   colunas: Array<{ id: string, label: string, default: boolean, sortable: boolean, width: number, align?: string, cellKind?: string }>,
 *   storageKey: string,
 *   droppableId: string,
 *   getFieldValue: (item: any, colId: string) => string,
 *   testIdPrefix: string,
 *   defaultSortKey?: string,
 * }} DefinicaoGradePatrimonio
 */

/**
 * Grade Motor Base1 dos cadastros de Patrimônio e Frota (D-PROD-157): mesma
 * composição de `TabelaNaturezas`, com as colunas da definição de cada tela.
 * Código em fonte mono e nome com `data-testid` estável (`<prefixo>-nome-<id>`).
 *
 * @param {{ definicao: DefinicaoGradePatrimonio } & Record<string, any>} props
 */
export default function GradePatrimonio({ definicao, ...props }) {
  const renderCell = (item, colId) => {
    if (colId === "codigo" || colId === "numero") {
      return (
        <span className="font-mono" data-testid={`${definicao.testIdPrefix}-${colId}-${item.id}`}>
          {definicao.getFieldValue(item, colId) || "–"}
        </span>
      );
    }
    if (colId === "nome") {
      return (
        <span data-testid={`${definicao.testIdPrefix}-nome-${item.id}`} className="uppercase" title={item.nome || undefined}>
          {item.nome || "–"}
        </span>
      );
    }
    return definicao.getFieldValue(item, colId) || "–";
  };

  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={/** @type {any[]} */ (definicao.colunas)}
      storageKey={definicao.storageKey}
      droppableId={definicao.droppableId}
      getFieldValue={definicao.getFieldValue}
      renderCell={renderCell}
      defaultSortKey={definicao.defaultSortKey ?? "nome"}
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
      cardsCodeColId={definicao.colunas.some((c) => c.id === "numero") ? "numero" : "codigo"}
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

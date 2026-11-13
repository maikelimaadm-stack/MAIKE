import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { rotuloFaixaIdade } from "@/domain/lotes/categoriaOficialDerivada";

export const CATEGORIAS_MANEJO_COLUNAS = [
  { id: "nome", label: "Nome", default: true, sortable: true, width: 180 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, width: 100 },
  { id: "sexo", label: "Sexo", default: true, sortable: true, width: 100 },
  { id: "idade", label: "Faixa Idade", default: true, sortable: true, width: 140 },
  { id: "especie", label: "Espécie", default: false, sortable: true, width: 120 },
];

export function getCategoriaManejoFieldValue(item, colunaId) {
  if (colunaId === "nome") return item.nome || "";
  if (colunaId === "sigla") return item.sigla || "";
  if (colunaId === "sexo") return item.sexo || "";
  // Rótulo da faixa fixa ("25 a 36 meses"); par legado fora da lista → "X a Y meses". Grade e CSV.
  if (colunaId === "idade") return rotuloFaixaIdade(item);
  if (colunaId === "especie") return item.especie || "";
  return "";
}

export default function TabelaCategoriasManejo(props) {
  return (
    <CadastroBase1Grade
      rows={props.categorias}
      columns={CATEGORIAS_MANEJO_COLUNAS}
      storageKey="colunas_largura_categorias_manejo"
      droppableId="colunas-categorias-manejo"
      getFieldValue={getCategoriaManejoFieldValue}
      renderCell={(item, colId) => getCategoriaManejoFieldValue(item, colId) || "–"}
      defaultSortKey="nome"
      emptyText="Nenhuma categoria encontrada"
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
        ((item, q) => {
          const hay = [item.nome, item.sigla]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      }
    />
  );
}

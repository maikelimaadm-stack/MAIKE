import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { rotuloFaixaIdade } from "@/domain/lotes/categoriaOficialDerivada";

/**
 * Chave das preferências de colunas. Mudou para `_v2` na D-PROD-195: uma
 * preferência salva antes trazia a lista de colunas visíveis sem "Curva de
 * ganho", e a grade esconderia a coluna nova.
 */
export const CATEGORIAS_MANEJO_STORAGE_KEY = "colunas_largura_categorias_manejo_v3";

export const CATEGORIAS_MANEJO_COLUNAS = [
  { id: "nome", label: "Nome", default: true, sortable: true, width: 180 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, width: 100 },
  { id: "sexo", label: "Sexo", default: true, sortable: true, width: 100 },
  { id: "idade", label: "Faixa Idade", default: true, sortable: true, width: 140 },
  // D-PROD-195: nome da curva de ganho da fazenda ligada à categoria (grade e CSV).
  { id: "curva_ganho", label: "Curva de ganho", default: true, sortable: true, width: 180 },
  // D-PROD-198: chave `_v3` para a preferência salva não esconder a coluna nova.
  { id: "peso_objetivo", label: "Peso objetivo (kg)", default: true, sortable: true, align: "right", width: 140 },
  { id: "especie", label: "Espécie", default: false, sortable: true, width: 120 },
];

export function getCategoriaManejoFieldValue(item, colunaId) {
  if (colunaId === "nome") return item.nome || "";
  if (colunaId === "sigla") return item.sigla || "";
  if (colunaId === "sexo") return item.sexo || "";
  // Rótulo da faixa fixa ("25 a 36 meses"); par legado fora da lista → "X a Y meses". Grade e CSV.
  if (colunaId === "idade") return rotuloFaixaIdade(item);
  if (colunaId === "curva_ganho") return item.curva_ganho_nome || "";
  if (colunaId === "peso_objetivo") return item.peso_objetivo_kg === null || item.peso_objetivo_kg === undefined ? "" : Number(item.peso_objetivo_kg).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  if (colunaId === "especie") return item.especie || "";
  return "";
}

export default function TabelaCategoriasManejo(props) {
  return (
    <CadastroBase1Grade
      rows={props.categorias}
      columns={CATEGORIAS_MANEJO_COLUNAS}
      storageKey={CATEGORIAS_MANEJO_STORAGE_KEY}
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
          const hay = [item.nome, item.sigla, item.curva_ganho_nome]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      }
    />
  );
}

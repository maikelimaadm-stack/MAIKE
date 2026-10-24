import React from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";

export const CATEGORIAS_MANEJO_COLUNAS = [
  { id: "nome", label: "Nome", default: true, sortable: true, width: 180 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, width: 100 },
  { id: "sexo", label: "Sexo", default: true, sortable: true, width: 100 },
  { id: "raca", label: "Raça", default: true, sortable: true, width: 140 },
  { id: "idade", label: "Faixa Idade", default: true, sortable: true, width: 140 },
  { id: "especie", label: "Espécie", default: false, sortable: true, width: 120 },
  { id: "categoria_oficial", label: "Categoria Oficial", default: true, sortable: true, width: 180 },
  { id: "ganho_anual", label: "Ganho Anual (kg)", default: false, sortable: true, align: "right", width: 140 },
  { id: "gmd_jan", label: "GMD Jan", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_fev", label: "GMD Fev", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_mar", label: "GMD Mar", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_abr", label: "GMD Abr", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_mai", label: "GMD Mai", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_jun", label: "GMD Jun", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_jul", label: "GMD Jul", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_ago", label: "GMD Ago", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_set", label: "GMD Set", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_out", label: "GMD Out", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_nov", label: "GMD Nov", default: false, sortable: true, align: "right", width: 100 },
  { id: "gmd_dez", label: "GMD Dez", default: false, sortable: true, align: "right", width: 100 },
];

export function getCategoriaManejoFieldValue(item, colunaId) {
  if (colunaId === "nome") return item.nome || "";
  if (colunaId === "sigla") return item.sigla || "";
  if (colunaId === "sexo") return item.sexo || "";
  if (colunaId === "raca") return item.raca || "";
  if (colunaId === "idade") {
    if (!item.idade_minima_meses && !item.idade_maxima_meses) return "";
    return `${item.idade_minima_meses || 0} - ${item.idade_maxima_meses || "∞"} meses`;
  }
  if (colunaId === "especie") return item.especie || "";
  if (colunaId === "categoria_oficial") return item.categoria_oficial || "";
  if (colunaId === "ganho_anual") return item.ganho_peso_anual_kg != null ? String(item.ganho_peso_anual_kg) : "";
  const gmdMap = {
    gmd_jan: "gmd_janeiro",
    gmd_fev: "gmd_fevereiro",
    gmd_mar: "gmd_marco",
    gmd_abr: "gmd_abril",
    gmd_mai: "gmd_maio",
    gmd_jun: "gmd_junho",
    gmd_jul: "gmd_julho",
    gmd_ago: "gmd_agosto",
    gmd_set: "gmd_setembro",
    gmd_out: "gmd_outubro",
    gmd_nov: "gmd_novembro",
    gmd_dez: "gmd_dezembro",
  };
  if (gmdMap[colunaId]) return item[gmdMap[colunaId]] != null ? String(item[gmdMap[colunaId]]) : "";
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
      onSelectionChange={props.onSelectionChange}
      onFiltersActiveChange={props.onFiltersActiveChange}
      matchesSearch={(item, q) => {
        const hay = [item.nome, item.sigla, item.raca, item.categoria_oficial].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      }}
    />
  );
}

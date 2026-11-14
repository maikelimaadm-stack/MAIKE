import React, { useCallback } from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { SeloAbastecimento } from "@/components/patrimonio/TabelaAbastecimentos";
import { comparar, ehCanonico } from "@/lib/dinheiroDecimal";
import { ehDiaValido } from "@/lib/diaCivil";
import {
  ROTULO_STATUS_APONTAMENTO,
  formatarDiaApontamento,
  formatarProducao,
  rotuloDaArea,
  rotuloDoBem,
  rotuloDoCentro,
  rotuloDoOperador,
} from "@/lib/apontamentoAtividadeRegras";

export const APONTAMENTOS_ATIVIDADE_STORAGE_KEY = "colunas_apontamentos_atividade_v1";

/**
 * Padrão: Nº | Data | Tipo | Máquina/veículo | Área | Produção | Situação.
 * Os demais dados ficam como colunas opcionais (desligadas). O tipo, o grupo
 * e os centros mostram o que ficou GRAVADO no apontamento (snapshot): renomear
 * o tipo depois não reescreve o histórico.
 */
export const APONTAMENTOS_ATIVIDADE_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "data_operacional", label: "Data", default: true, sortable: true, width: 101 },
  { id: "tipo", label: "Tipo de atividade", default: true, sortable: true, width: 180 },
  { id: "bem", label: "Máquina/veículo", default: true, sortable: true, width: 160 },
  { id: "area", label: "Área", default: true, sortable: true, width: 140 },
  { id: "producao", label: "Produção", default: true, sortable: true, align: "right", width: 110 },
  { id: "status", label: "Situação", default: true, sortable: true, width: 103 },
  { id: "grupo", label: "Grupo", default: false, sortable: true, width: 150 },
  { id: "implemento", label: "Implemento", default: false, sortable: true, width: 150 },
  { id: "operador", label: "Operador", default: false, sortable: true, width: 150 },
  { id: "centro_custo", label: "Centro de custo", default: false, sortable: true, width: 160 },
  { id: "centro_resultado", label: "Centro de resultado", default: false, sortable: true, width: 160 },
  { id: "observacao", label: "Observação", default: false, sortable: true, width: 200 },
];

/** Cards (celular): o tipo é o título e a Situação vai no subtítulo. */
export const APONTAMENTOS_ATIVIDADE_CAMPOS_CARD = ["data_operacional", "bem", "producao", "status"];

/** @param {any} item @param {string} id */
export const valorDoCampoApontamento = (item, id) => {
  if (id === "numero") return item.numero != null ? String(item.numero) : "";
  if (id === "data_operacional") return formatarDiaApontamento(item.data_operacional);
  if (id === "tipo") return String(item.tipo_atividade_nome ?? "");
  if (id === "grupo") return String(item.grupo_atividade_nome ?? "");
  if (id === "bem") return rotuloDoBem(item.bem);
  if (id === "implemento") return rotuloDoBem(item.implemento);
  if (id === "operador") return rotuloDoOperador(item.operador);
  if (id === "area") return rotuloDaArea(item.area);
  if (id === "producao") return formatarProducao(item.quantidade_produzida, item.unidade_producao);
  if (id === "centro_custo") return rotuloDoCentro(item.centro_custo);
  if (id === "centro_resultado") return rotuloDoCentro(item.centro_resultado);
  if (id === "observacao") return String(item.observacao ?? "");
  if (id === "status") return /** @type {Record<string, string>} */ (ROTULO_STATUS_APONTAMENTO)[item.status] ?? String(item.status ?? "");
  return "";
};

/** @param {any} item @param {string} colId */
const canonicoDa = (item, colId) => {
  const v = colId === "numero" ? item?.numero : colId === "producao" ? item?.quantidade_produzida : null;
  return ehCanonico(v) ? v : null;
};

/**
 * Ordenação de número, produção e dia pelo valor CANÔNICO do servidor, nunca
 * pelo texto formatado. Vazio por último. Produção agrupa pela unidade.
 * @param {any} a @param {any} b @param {string} colId
 * @returns {number|null}
 */
export const compararApontamentosParaOrdenar = (a, b, colId) => {
  if (colId === "data_operacional") {
    const va = ehDiaValido(a?.data_operacional) ? a.data_operacional : null;
    const vb = ehDiaValido(b?.data_operacional) ? b.data_operacional : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    if (va !== vb) return va < vb ? -1 : 1;
    const na = canonicoDa(a, "numero");
    const nb = canonicoDa(b, "numero");
    return na === null || nb === null ? 0 : comparar(na, nb);
  }
  if (colId !== "numero" && colId !== "producao") return null;
  const va = canonicoDa(a, colId);
  const vb = canonicoDa(b, colId);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  if (colId === "producao" && a?.unidade_producao !== b?.unidade_producao) {
    return String(a?.unidade_producao ?? "").localeCompare(String(b?.unidade_producao ?? ""));
  }
  return comparar(va, vb);
};

/**
 * Lista de apontamentos de atividade (tabela no desktop, cards no celular).
 * Ordem padrão: Nº desc — a mesma em que o servidor pagina (o nº é reservado
 * na criação e acompanha `createdAt desc`).
 * @param {any} props
 */
export default function TabelaApontamentosAtividade(props) {
  const renderCell = useCallback((/** @type {any} */ item, /** @type {string} */ colId) => {
    if (colId === "numero") return <span className="font-mono" data-testid={`apontamento-numero-${item.id}`}>{item.numero ?? "–"}</span>;
    if (colId === "status") return <SeloAbastecimento status={item.status} testId={`apontamento-situacao-${item.id}`} />;
    const v = valorDoCampoApontamento(item, colId);
    return v || "–";
  }, []);
  /** @type {any} */
  const Grade = CadastroBase1Grade;
  return (
    <Grade
      rows={props.rows}
      columns={APONTAMENTOS_ATIVIDADE_COLUNAS}
      storageKey={APONTAMENTOS_ATIVIDADE_STORAGE_KEY}
      droppableId="colunas-apontamentos-atividade"
      getFieldValue={valorDoCampoApontamento}
      compararParaOrdenar={compararApontamentosParaOrdenar}
      renderCell={renderCell}
      defaultSortKey="numero"
      defaultSortDir="desc"
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
      cardsTitleColId="tipo"
      cardsCodeColId="status"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

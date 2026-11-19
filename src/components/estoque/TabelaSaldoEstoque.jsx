import React, { useCallback } from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { comparar, ehCanonico } from "@/lib/dinheiroDecimal";
import { formatarCustoUnitario, formatarQtd, formatarReais } from "@/lib/estoqueConsultaRegras";

/** Chave nova a cada mudança do conjunto de colunas (uma preferência antiga não ressuscita coluna que saiu). */
export const SALDO_ESTOQUE_STORAGE_KEY = "colunas_estoque_saldo_v1";

/**
 * Produto × depósito, derivado das camadas disponíveis (D-PROD-255). Quantidade na unidade do
 * produto; Custo = custo médio ponderado das camadas que restam (método oficial do estoque desde a D-PROD-256);
 * Valor = Σ(quantidade da camada × custo da camada).
 */
export const SALDO_ESTOQUE_COLUNAS = [
  { id: "produto", label: "Produto", default: true, sortable: true, width: 240 },
  { id: "deposito", label: "Depósito", default: true, sortable: true, width: 200 },
  { id: "quantidade", label: "Quantidade", default: true, sortable: true, align: "right", width: 130 },
  { id: "custo", label: "Custo", default: true, sortable: true, align: "right", width: 120 },
  { id: "valor", label: "Valor", default: true, sortable: true, align: "right", width: 130 },
  { id: "codigo", label: "Código", default: false, sortable: true, width: 100 },
  { id: "camadas", label: "Camadas", default: false, sortable: true, align: "right", width: 100 },
];

/** Os filtros da faixa são os da tela (depósito, saldo); nada automático por coluna. */
const SEM_FILTROS_AUTOMATICOS = /** @type {string[]} */ ([]);

export const SALDO_ESTOQUE_CAMPOS_CARD = ["produto", "deposito", "quantidade", "valor"];

/** @param {any} item @param {string} id */
export const valorDoCampoSaldo = (item, id) => {
  if (id === "produto") return String(item.produto_nome ?? "");
  if (id === "deposito") return String(item.local_estoque_nome ?? "");
  if (id === "quantidade") return formatarQtd(item.quantidade, item.unidade);
  if (id === "custo") return item.custo_medio ? formatarCustoUnitario(item.custo_medio) : "";
  if (id === "valor") return formatarReais(item.valor);
  if (id === "codigo") return String(item.produto_codigo ?? "");
  if (id === "camadas") return item.camadas == null ? "" : String(item.camadas);
  return "";
};

const CAMPO_DECIMAL = Object.freeze({ quantidade: "quantidade", custo: "custo_medio", valor: "valor" });

/**
 * Decimais pelo valor CANÔNICO do servidor, nunca pelo texto formatado; vazio por último. Demais colunas: regra da grade.
 * @param {any} a @param {any} b @param {string} colId @returns {number|null}
 */
export const compararSaldoParaOrdenar = (a, b, colId) => {
  if (colId === "camadas") return Number(a?.camadas ?? 0) - Number(b?.camadas ?? 0);
  const campo = /** @type {Record<string, string>} */ (CAMPO_DECIMAL)[colId];
  if (!campo) return null;
  const va = ehCanonico(a?.[campo]) ? a[campo] : null;
  const vb = ehCanonico(b?.[campo]) ? b[campo] : null;
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  // L e kg não se comparam: agrupa pela unidade ao ordenar a quantidade.
  if (colId === "quantidade" && a?.unidade !== b?.unidade) return String(a?.unidade).localeCompare(String(b?.unidade));
  return comparar(va, vb);
};

/** @param {any} item */
export const textoBuscaSaldo = (item) => [item.produto_nome, item.produto_codigo, item.local_estoque_nome].filter(Boolean).join(" ");

/** @param {any} props */
export default function TabelaSaldoEstoque(props) {
  const renderCell = useCallback((/** @type {any} */ item, /** @type {string} */ colId) => valorDoCampoSaldo(item, colId) || "–", []);
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={SALDO_ESTOQUE_COLUNAS}
      storageKey={SALDO_ESTOQUE_STORAGE_KEY}
      droppableId="colunas-estoque-saldo"
      getFieldValue={valorDoCampoSaldo}
      compararParaOrdenar={compararSaldoParaOrdenar}
      renderCell={renderCell}
      defaultSortKey="produto"
      defaultSortDir="asc"
      emptyText={props.emptyText}
      isLoading={props.isLoading}
      onOpen={props.onOpen}
      renderAcoesDaLinha={props.renderAcoesDaLinha}
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
      quickFilterIds={SEM_FILTROS_AUTOMATICOS}
      cardsTitleColId="produto"
      cardsCodeColId="deposito"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

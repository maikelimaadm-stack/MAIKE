import React, { useCallback } from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { comparar, ehCanonico } from "@/lib/dinheiroDecimal";
import {
  ROTULO_ORIGEM,
  depositoDoMovimento,
  formatarCustoUnitario,
  formatarDia,
  formatarQtd,
  formatarReais,
  quantidadeComSinal,
  rotuloDoMovimento,
} from "@/lib/estoqueConsultaRegras";

export const MOVIMENTOS_ESTOQUE_STORAGE_KEY = "colunas_estoque_movimentos_v1";

/** Kardex: Data | Nº | Produto | Tipo | Depósito | Quantidade | Saldo. O resto é opcional. */
export const MOVIMENTOS_ESTOQUE_COLUNAS = [
  { id: "data", label: "Data", default: true, sortable: true, width: 101 },
  { id: "numero", label: "Nº", default: true, sortable: true, width: 80 },
  { id: "produto", label: "Produto", default: true, sortable: true, width: 200 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 190 },
  { id: "deposito", label: "Depósito", default: true, sortable: true, width: 200 },
  { id: "quantidade", label: "Quantidade", default: true, sortable: true, align: "right", width: 130 },
  { id: "saldo_depois", label: "Saldo", default: true, sortable: true, align: "right", width: 120 },
  { id: "situacao", label: "Situação", default: true, sortable: true, width: 110 },
  { id: "valor_unitario", label: "Custo", default: false, sortable: true, align: "right", width: 110 },
  { id: "valor_total", label: "Valor", default: false, sortable: true, align: "right", width: 120 },
  { id: "origem", label: "Origem", default: false, sortable: true, width: 150 },
];

/** Além dos filtros da tela, só a Situação (ativa, estorno, estornada) fica na faixa. */
const FILTROS_AUTOMATICOS = ["situacao"];

export const MOVIMENTOS_ESTOQUE_CAMPOS_CARD = ["produto", "quantidade", "data", "tipo", "situacao"];

/** @param {any} m */
export const rotuloSituacao = (m) => (m?.status === "Estornada" ? "Estornada" : m?.estorno ? "Estorno" : "Ativa");

/** @param {any} item @param {string} id */
export const valorDoCampoMovimento = (item, id) => {
  if (id === "data") return formatarDia(item.data);
  if (id === "numero") return String(item.numero ?? "");
  if (id === "produto") return String(item.produto_nome ?? "");
  if (id === "tipo") return rotuloDoMovimento(item);
  if (id === "deposito") return depositoDoMovimento(item);
  if (id === "quantidade") return quantidadeComSinal(item);
  if (id === "saldo_depois") return item.saldo_depois ? formatarQtd(item.saldo_depois, item.unidade) : "";
  if (id === "situacao") return rotuloSituacao(item);
  if (id === "valor_unitario") return item.valor_unitario ? formatarCustoUnitario(item.valor_unitario) : "";
  if (id === "valor_total") return formatarReais(item.valor_total);
  if (id === "origem") return ROTULO_ORIGEM[item.origem_sistema] ?? String(item.origem_sistema ?? "");
  return "";
};

const CAMPO_DECIMAL = Object.freeze({ quantidade: "quantidade", saldo_depois: "saldo_depois", valor_unitario: "valor_unitario", valor_total: "valor_total" });

/**
 * Data e número pelo valor canônico (o texto "10" viria antes de "9"), decimais pelo canônico do servidor; vazio por último.
 * @param {any} a @param {any} b @param {string} colId @returns {number|null}
 */
export const compararMovimentosParaOrdenar = (a, b, colId) => {
  if (colId === "data") {
    const va = typeof a?.data === "string" ? a.data : null;
    const vb = typeof b?.data === "string" ? b.data : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    if (va !== vb) return va < vb ? -1 : 1;
    const na = ehCanonico(a?.numero) ? a.numero : null;
    const nb = ehCanonico(b?.numero) ? b.numero : null;
    return na === null || nb === null ? 0 : comparar(na, nb);
  }
  if (colId === "numero") {
    const na = ehCanonico(a?.numero) ? a.numero : null;
    const nb = ehCanonico(b?.numero) ? b.numero : null;
    if (na === null || nb === null) return na === nb ? 0 : na === null ? 1 : -1;
    return comparar(na, nb);
  }
  const campo = /** @type {Record<string, string>} */ (CAMPO_DECIMAL)[colId];
  if (!campo) return null;
  const va = ehCanonico(a?.[campo]) ? a[campo] : null;
  const vb = ehCanonico(b?.[campo]) ? b[campo] : null;
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  if ((colId === "quantidade" || colId === "saldo_depois") && a?.unidade !== b?.unidade) return String(a?.unidade).localeCompare(String(b?.unidade));
  return comparar(va, vb);
};

/** @param {any} item */
export const textoBuscaMovimento = (item) =>
  [item.numero, item.produto_nome, item.produto_codigo, rotuloDoMovimento(item), depositoDoMovimento(item)].filter(Boolean).join(" ");

/** @param {any} props */
export default function TabelaMovimentosEstoque(props) {
  const renderCell = useCallback((/** @type {any} */ item, /** @type {string} */ colId) => valorDoCampoMovimento(item, colId) || "–", []);
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={MOVIMENTOS_ESTOQUE_COLUNAS}
      storageKey={MOVIMENTOS_ESTOQUE_STORAGE_KEY}
      droppableId="colunas-estoque-movimentos"
      getFieldValue={valorDoCampoMovimento}
      compararParaOrdenar={compararMovimentosParaOrdenar}
      renderCell={renderCell}
      defaultSortKey="data"
      defaultSortDir="desc"
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
      quickFilterIds={FILTROS_AUTOMATICOS}
      cardsTitleColId="produto"
      cardsCodeColId="tipo"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

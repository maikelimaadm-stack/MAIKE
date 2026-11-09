import React, { useCallback } from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { comparar, ehCanonico, formatarMoeda } from "@/lib/dinheiroDecimal";
import { ehDiaValido, formatarDia } from "@/lib/diaCivil";
import { ROTULO_CONDICAO, ROTULO_CONTEUDO, ROTULO_DIRECAO } from "@/services/operacaoFinanceiraService";
import { ROTULO_SITUACAO_REGISTRO, Selo } from "@/components/financeiroGestao/ConsultaLancamento";
import { situacaoDoLancamento } from "@/components/financeiroGestao/lancamentoModelo";

export const LANCAMENTOS_STORAGE_KEY = "colunas_lancamentos_financeiros_v1";

export const LANCAMENTOS_COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 80 },
  { id: "status", label: "Situação", default: true, sortable: true, width: 110 },
  { id: "direcao", label: "Direção", default: true, sortable: true, width: 100 },
  { id: "parceiro", label: "Parceiro", default: true, sortable: true, width: 240 },
  { id: "data_emissao", label: "Emissão", default: true, sortable: true, width: 100 },
  { id: "valor_total", label: "Total", default: true, sortable: true, align: "right", width: 130 },
  { id: "saldo_aberto", label: "Em aberto", default: true, sortable: true, align: "right", width: 130 },
  { id: "proximo_vencimento", label: "Próx. vencimento", default: true, sortable: true, width: 120 },
  { id: "condicao", label: "Condição", default: false, sortable: true, width: 100 },
  { id: "conteudo", label: "Conteúdo", default: false, sortable: true, width: 120 },
  { id: "tem_estoque", label: "Estoque", default: false, sortable: true, align: "center", width: 80 },
];

/** Cards: parceiro é o título e o nº é o código; no celular, Situação, Total e Próx. vencimento. */
export const LANCAMENTOS_CAMPOS_CARD = ["numero", "status", "valor_total", "proximo_vencimento", "direcao", "saldo_aberto"];

const COLUNAS_DINHEIRO = new Set(["valor_total", "saldo_aberto"]);
const COLUNAS_DIA = new Set(["data_emissao", "proximo_vencimento"]);

/**
 * Ordenação de dinheiro e de dia pelo valor CANÔNICO do servidor ("1000.00",
 * "2027-01-15"), não pelo texto formatado ("R$ 1.000,00", "15/01/2027"), que
 * depende do locale e põe o dia antes do mês. Vazio fica por último na ordem
 * crescente, como na coluna numérica da grade. Outras colunas: regra da grade.
 * @param {any} a @param {any} b @param {string} colId
 * @returns {number|null}
 */
export const compararLancamentosParaOrdenar = (a, b, colId) => {
  const dinheiro = COLUNAS_DINHEIRO.has(colId);
  if (!dinheiro && !COLUNAS_DIA.has(colId)) return null;
  /** @param {any} item */
  const valor = (item) => {
    const v = item?.[colId];
    return dinheiro ? (ehCanonico(v) ? v : null) : ehDiaValido(v) ? v : null;
  };
  const va = valor(a);
  const vb = valor(b);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  if (dinheiro) return comparar(va, vb);
  return va === vb ? 0 : va < vb ? -1 : 1;
};

/** @param {any} item @param {string} locale */
const dinheiroDa = (item, campo, locale) =>
  item?.[campo] == null ? "" : formatarMoeda(String(item[campo]), { locale, moeda: item.moeda || "BRL", casas: Number.isInteger(item.moeda_casas) ? item.moeda_casas : 2 });

/** @param {string} locale */
export const valorDoCampoLancamento = (locale) => (/** @type {any} */ item, /** @type {string} */ id) => {
  if (id === "numero") return item.numero != null ? String(item.numero) : "";
  // D-PROD-157: excluído e versão substituída por correção têm rótulo próprio (no servidor ficam CANCELADO).
  if (id === "status") return ROTULO_SITUACAO_REGISTRO[situacaoDoLancamento(item)] ?? item.status ?? "";
  if (id === "direcao") return ROTULO_DIRECAO[/** @type {keyof typeof ROTULO_DIRECAO} */ (item.direcao)] ?? "";
  if (id === "parceiro") return item.parceiro_nome || "";
  if (id === "data_emissao") return item.data_emissao ? formatarDia(item.data_emissao, locale) : "";
  if (id === "valor_total") return dinheiroDa(item, "valor_total", locale);
  if (id === "saldo_aberto") return dinheiroDa(item, "saldo_aberto", locale);
  if (id === "proximo_vencimento") return item.proximo_vencimento ? formatarDia(item.proximo_vencimento, locale) : "";
  if (id === "condicao") return ROTULO_CONDICAO[/** @type {keyof typeof ROTULO_CONDICAO} */ (item.condicao)] ?? "";
  if (id === "conteudo") return ROTULO_CONTEUDO[/** @type {keyof typeof ROTULO_CONTEUDO} */ (item.conteudo)] ?? "";
  if (id === "tem_estoque") return item.tem_estoque ? "Sim" : "Não";
  return "";
};

/**
 * Lista da Central de Lançamentos (tabela no desktop, cards no celular).
 * @param {any} props
 */
export default function TabelaLancamentos(props) {
  const locale = props.locale || "pt-BR";
  const valorDoCampo = useCallback((/** @type {any} */ item, /** @type {string} */ id) => valorDoCampoLancamento(locale)(item, id), [locale]);
  const renderCell = useCallback(
    (/** @type {any} */ item, /** @type {string} */ colId) => {
      if (colId === "numero") return <span className="font-mono" data-testid={`lancamento-numero-${item.id}`}>{item.numero ?? "–"}</span>;
      if (colId === "status") return <Selo status={situacaoDoLancamento(item)} rotulo={valorDoCampo(item, "status")} testId={`lancamento-situacao-${item.id}`} />;
      if (colId === "parceiro") return <span className="uppercase">{item.parceiro_nome || "–"}</span>;
      const v = valorDoCampo(item, colId);
      return v || "–";
    },
    [valorDoCampo],
  );
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={LANCAMENTOS_COLUNAS}
      storageKey={LANCAMENTOS_STORAGE_KEY}
      droppableId="colunas-lancamentos-financeiros"
      getFieldValue={valorDoCampo}
      compararParaOrdenar={compararLancamentosParaOrdenar}
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
      cardsTitleColId="parceiro"
      cardsCodeColId="numero"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

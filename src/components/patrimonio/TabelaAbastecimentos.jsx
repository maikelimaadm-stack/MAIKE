import React, { useCallback } from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import { comparar, ehCanonico } from "@/lib/dinheiroDecimal";
import { ehDiaValido } from "@/lib/diaCivil";
import {
  UNIDADE_MEDIDOR,
  formatarCusto,
  formatarDiaAbastecimento,
  formatarKg,
  formatarLeitura,
  formatarLitros,
  rotuloDoBem,
} from "@/lib/abastecimentoRegras";
import { ROTULO_STATUS_ABASTECIMENTO } from "@/services/abastecimentoService";

/**
 * UX-02 (D-PROD-160): preferências de coluna em chave NOVA — a v1 guardava a
 * coluna "Combustível", que saiu da lista (o operador vê o PRODUTO).
 */
export const ABASTECIMENTOS_STORAGE_KEY = "colunas_abastecimentos_v2";

/**
 * Padrão: Data | Máquina/Veículo | Produto | Litros | Medidor | Situação. Os
 * dados técnicos ficam como colunas opcionais (desligadas); o tipo de
 * combustível aparece só na consulta (detalhe técnico).
 */
export const ABASTECIMENTOS_COLUNAS = [
  { id: "data_operacional", label: "Data", default: true, sortable: true, width: 100 },
  { id: "bem", label: "Máquina/Veículo", default: true, sortable: true, width: 220 },
  { id: "produto", label: "Produto", default: true, sortable: true, width: 200 },
  { id: "quantidade_litros", label: "Litros", default: true, sortable: true, align: "right", width: 110 },
  { id: "leitura", label: "Medidor", default: true, sortable: true, align: "right", width: 120 },
  { id: "status", label: "Situação", default: true, sortable: true, width: 110 },
  { id: "numero", label: "Nº", default: false, sortable: true, width: 70 },
  { id: "tanque", label: "Tanque", default: false, sortable: true, width: 140 },
  { id: "quantidade_kg", label: "KG", default: false, sortable: true, align: "right", width: 110 },
  { id: "custo_total", label: "Custo", default: false, sortable: true, align: "right", width: 120 },
  { id: "tanque_cheio", label: "Tanque cheio", default: false, sortable: true, align: "center", width: 100 },
  { id: "referencia_externa", label: "Referência", default: false, sortable: true, width: 120 },
];

/**
 * Cards (celular): a máquina é o título e a Situação vai no subtítulo
 * (`cardsCodeColId="status"`); os campos são Produto, Litros e Data. No celular
 * a grade só mostra 3 campos (D-PROD-88), então a Situação não pode depender
 * da lista de campos: sem ela um Cancelado não se distingue de um Confirmado.
 */
export const ABASTECIMENTOS_CAMPOS_CARD = ["produto", "quantidade_litros", "data_operacional", "status"];

const COLUNAS_DECIMAIS = Object.freeze({ quantidade_litros: "quantidade_litros", quantidade_kg: "quantidade_kg", custo_total: "custo_total", numero: "numero" });

/** @param {any} item @param {string} colId */
const canonicoDa = (item, colId) => {
  if (colId === "leitura") return ehCanonico(item?.medidor?.leitura) ? item.medidor.leitura : null;
  const campo = /** @type {Record<string, string>} */ (COLUNAS_DECIMAIS)[colId];
  if (!campo) return null;
  const v = item?.[campo];
  return ehCanonico(v) ? v : null;
};

/**
 * Ordenação de decimal e de dia pelo valor CANÔNICO do servidor ("80.0000",
 * "2027-06-10"), nunca pelo texto formatado. Vazio por último. Demais colunas:
 * regra da grade.
 * @param {any} a @param {any} b @param {string} colId
 * @returns {number|null}
 */
export const compararAbastecimentosParaOrdenar = (a, b, colId) => {
  if (colId === "data_operacional") {
    const va = ehDiaValido(a?.data_operacional) ? a.data_operacional : null;
    const vb = ehDiaValido(b?.data_operacional) ? b.data_operacional : null;
    if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
    if (va !== vb) return va < vb ? -1 : 1;
    // Mesmo dia: o nº (sequência do servidor) desempata — "mais recente primeiro" na ordem padrão.
    const na = ehCanonico(a?.numero) ? a.numero : null;
    const nb = ehCanonico(b?.numero) ? b.numero : null;
    return na === null || nb === null ? 0 : comparar(na, nb);
  }
  if (colId !== "leitura" && !Object.prototype.hasOwnProperty.call(COLUNAS_DECIMAIS, colId)) return null;
  const va = canonicoDa(a, colId);
  const vb = canonicoDa(b, colId);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
  return comparar(va, vb);
};

/** @param {any} item @param {string} id */
export const valorDoCampoAbastecimento = (item, id) => {
  if (id === "numero") return item.numero != null ? String(item.numero) : "";
  if (id === "data_operacional") return item.data_operacional ? formatarDiaAbastecimento(item.data_operacional) : "";
  if (id === "bem") return rotuloDoBem(item.bem);
  if (id === "tanque") return String(item.tanque?.identificador ?? "");
  if (id === "produto") return String(item.produto?.nome ?? "");
  if (id === "quantidade_litros") return item.quantidade_litros ? `${formatarLitros(item.quantidade_litros)} L` : "";
  if (id === "quantidade_kg") return item.quantidade_kg ? `${formatarKg(item.quantidade_kg)} kg` : "";
  if (id === "custo_total") return item.custo_total ? formatarCusto(item.custo_total) : "";
  if (id === "leitura") {
    const leitura = item.medidor?.leitura;
    if (!leitura) return "";
    const unidade = UNIDADE_MEDIDOR[String(item.medidor?.tipo ?? "")];
    return `${formatarLeitura(leitura)}${unidade ? ` ${unidade}` : ""}`;
  }
  if (id === "status") return /** @type {Record<string, string>} */ (ROTULO_STATUS_ABASTECIMENTO)[item.status] ?? String(item.status ?? "");
  if (id === "tanque_cheio") return item.tanque_cheio ? "Sim" : "Não";
  if (id === "referencia_externa") return String(item.referencia_externa ?? "");
  return "";
};

/** @param {{ status: string, testId?: string }} props */
export function SeloAbastecimento({ status, testId = undefined }) {
  const cancelado = status === "CANCELADO";
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        cancelado ? "border-slate-300 bg-slate-100 text-slate-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {/** @type {Record<string, string>} */ (ROTULO_STATUS_ABASTECIMENTO)[status] ?? status}
    </span>
  );
}

/**
 * Lista de abastecimentos (tabela no desktop, cards no celular). Ordem padrão:
 * data mais recente primeiro (o nº desempata no mesmo dia).
 * @param {any} props
 */
export default function TabelaAbastecimentos(props) {
  const renderCell = useCallback((/** @type {any} */ item, /** @type {string} */ colId) => {
    if (colId === "numero") return <span className="font-mono" data-testid={`abastecimento-numero-${item.id}`}>{item.numero ?? "–"}</span>;
    if (colId === "bem") return <span data-testid={`abastecimento-bem-${item.id}`}>{rotuloDoBem(item.bem) || "–"}</span>;
    if (colId === "status") return <SeloAbastecimento status={item.status} testId={`abastecimento-situacao-${item.id}`} />;
    const v = valorDoCampoAbastecimento(item, colId);
    return v || "–";
  }, []);
  return (
    <CadastroBase1Grade
      rows={props.rows}
      columns={ABASTECIMENTOS_COLUNAS}
      storageKey={ABASTECIMENTOS_STORAGE_KEY}
      droppableId="colunas-abastecimentos"
      getFieldValue={valorDoCampoAbastecimento}
      compararParaOrdenar={compararAbastecimentosParaOrdenar}
      renderCell={renderCell}
      defaultSortKey="data_operacional"
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
      cardsTitleColId="bem"
      cardsCodeColId="status"
      {...BASE1_LISTA_INTEGRADA_VISUAL.grade}
      configureColumnsAnchorRef={props.configureColumnsAnchorRef}
    />
  );
}

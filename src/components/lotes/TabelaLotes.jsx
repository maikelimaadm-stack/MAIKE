import React, { useCallback, useEffect, useMemo, useState } from "react";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { BASE1_LISTA_INTEGRADA_VISUAL } from "@/components/cadastro/base1/base1VisualPreset";
import campoEngine from "@/services/campoEngine";

export const COLUNAS_DISPONIVEIS = [
  { id: "codigo", label: "Código", default: true, sortable: true, align: "left", width: 100 },
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left", width: 200 },
  { id: "identificador", label: "Identificador", default: true, sortable: true, align: "left", width: 180 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, align: "left", width: 90 },
  { id: "cor", label: "Cor", default: true, sortable: true, align: "left", width: 100 },
  { id: "cabecas", label: "Cabeças", default: true, sortable: true, align: "right", width: 100 },
  { id: "categoria", label: "Categoria", default: true, sortable: true, align: "left", width: 160 },
  { id: "categoria_manejo", label: "Categoria Manejo", default: true, sortable: true, align: "left", width: 180 },
  { id: "sexo", label: "Sexo", default: true, sortable: true, align: "left", width: 100 },
  { id: "peso", label: "Peso Médio", default: true, sortable: true, align: "right", width: 120 },
  { id: "setor", label: "Setor", default: true, sortable: true, align: "left", width: 160 },
  { id: "area", label: "Área Entrada", default: true, sortable: true, align: "left", width: 160 },
  { id: "sistema_produtivo", label: "Sistema Reprodutivo", default: true, sortable: true, align: "left", width: 180 },
  { id: "motivo", label: "Motivo", default: true, sortable: true, align: "left", width: 140 },
  { id: "data", label: "Data Entrada", default: true, sortable: true, align: "left", width: 120 },
  { id: "status", label: "Status", default: true, sortable: true, align: "left", width: 100 },
  { id: "valor", label: "Valor Total", default: true, sortable: true, align: "right", width: 140 },
  { id: "fornecedor", label: "Fornecedor", default: true, sortable: true, align: "left", width: 160 },
  { id: "origem", label: "Origem", default: true, sortable: true, align: "left", width: 140 },
  { id: "raca", label: "Raça Predominante", default: true, sortable: true, align: "left", width: 160 },
  { id: "nota_fiscal", label: "Nota Fiscal", default: true, sortable: true, align: "left", width: 130 },
  { id: "numero_gta", label: "GTA", default: true, sortable: true, align: "left", width: 120 },
  { id: "cidade_origem", label: "Cidade Origem", default: true, sortable: true, align: "left", width: 150 },
  { id: "estado_origem", label: "UF Origem", default: true, sortable: true, align: "left", width: 90 },
  { id: "valor_por_cabeca", label: "Valor/Cabeça", default: true, sortable: true, align: "right", width: 140 },
  { id: "valor_frete", label: "Valor Frete", default: true, sortable: true, align: "right", width: 130 },
  { id: "observacoes", label: "Observações", default: true, sortable: false, align: "left", width: 220 },
];

/** @param {object} lote @param {string} colId */
export const getLoteFieldValue = (lote, colId) => {
  const coluna = COLUNAS_DISPONIVEIS.find((item) => item.id === colId);
  if (colId === "cabecas") {
    return String(Number(lote.quantidade_entrada || lote.quantidade_cabecas || 0));
  }
  return String(campoEngine.getValorCampo(lote, coluna || { id: colId }, {}) ?? "");
};

const STORAGE_KEY = "colunas_cadastro_lotes";

/** Referência estável quando a prop `lotes` é omitida (evita ciclo via matchesSearch). */
const EMPTY_LOTES = [];

/**
 * @param {{ rows: object[]; selectedIds: string[] }} prev
 * @param {{ rows: object[]; selectedIds: string[] }} next
 */
function displayPayloadEquivalent(prev, next) {
  if (prev.rows === next.rows && prev.selectedIds === next.selectedIds) return true;
  const { rows: prevRows, selectedIds: prevIds } = prev;
  const { rows: nextRows, selectedIds: nextIds } = next;
  if (prevRows.length !== nextRows.length || prevIds.length !== nextIds.length) return false;
  for (let i = 0; i < prevRows.length; i += 1) {
    if (prevRows[i] !== nextRows[i]) return false;
  }
  for (let i = 0; i < prevIds.length; i += 1) {
    if (prevIds[i] !== nextIds[i]) return false;
  }
  return true;
}

/**
 * @typedef {object} ColunaLote
 * @property {string} id
 * @property {string} label
 * @property {boolean} [default]
 * @property {string} [align]
 * @property {number} [width]
 * @property {string} [agregacao_tipo]
 * @property {string} [agregacao]
 * @property {string} [tipo]
 * @property {string} [field_type]
 * @property {string} [field_name]
 * @property {number} [decimal_places]
 * @property {number} [casas_decimais]
 * @property {boolean} [usar_decimal]
 * @property {boolean} [usar_mascara]
 */

/**
 * @param {number} valor
 * @param {ColunaLote} coluna
 */
const formatTotalValue = (valor, coluna) => {
  const tipo = String(coluna.tipo || coluna.field_type || "").toLowerCase();
  const integerColumns = ["cabecas", "quantidade_cabecas", "quantidade_entrada"];
  const isInteger = integerColumns.includes(coluna.id) || integerColumns.includes(coluna.field_name);
  const decimalPlaces = Math.min(6, Math.max(0, Number(coluna.decimal_places ?? coluna.casas_decimais ?? 2)));
  const isDecimal =
    !isInteger &&
    (coluna.usar_decimal === true ||
      tipo.includes("decimal") ||
      tipo.includes("moeda") ||
      tipo.includes("currency") ||
      ["peso", "valor", "valor_por_cabeca", "valor_frete"].includes(coluna.id));

  return Number(valor).toLocaleString(
    "pt-BR",
    isDecimal
      ? {
          minimumFractionDigits: decimalPlaces,
          maximumFractionDigits: decimalPlaces,
        }
      : {
          maximumFractionDigits: 0,
        },
  );
};

/**
 * @param {ColunaLote[]} colunasDisponiveis
 * @returns {{ ordenadas: ColunaLote[]; todas: ColunaLote[]; widths: Record<string, number> }}
 */
function readColumnLayout(colunasDisponiveis) {
  const defaults = Object.fromEntries(colunasDisponiveis.map((c) => [c.id, c.width || 160]));
  let ordem = colunasDisponiveis.map((c) => c.id);
  let visiveis = colunasDisponiveis.filter((c) => c.default !== false).map((c) => c.id);
  let widths = { ...defaults };
  try {
    const savedOrdem = localStorage.getItem(`${STORAGE_KEY}_ordem`);
    if (savedOrdem) ordem = JSON.parse(savedOrdem);
    const savedVisiveis = localStorage.getItem(`${STORAGE_KEY}_visiveis`);
    if (savedVisiveis) visiveis = JSON.parse(savedVisiveis);
    const savedLargura = localStorage.getItem(`${STORAGE_KEY}_largura`);
    if (savedLargura) widths = { ...widths, ...JSON.parse(savedLargura) };
  } catch {
    /* layout best-effort */
  }
  const ordenadas = ordem
    .map((id) => colunasDisponiveis.find((c) => c.id === id))
    .filter((c) => c && visiveis.includes(c.id));
  const todas = ordem.map((id) => colunasDisponiveis.find((c) => c.id === id)).filter(Boolean);
  return { ordenadas, todas, widths };
}

export default function TabelaLotes({
  lotes = EMPTY_LOTES,
  areas: _areas = [],
  onEdit,
  showConfigColunas,
  setShowConfigColunas,
  searchTerm = "",
  searchQuery = "",
  selectedRecordId = undefined,
  onSelectionChange = undefined,
  onVisibleDataChange = undefined,
  resetFiltersKey = 0,
  onFiltersActiveChange,
  isLoading = false,
  viewMode,
  displayLimit = undefined,
  onListMetrics = undefined,
  cardFields,
  cardsPerRow,
  configureColumnsAnchorRef,
}) {
  const globalSearch = searchQuery || searchTerm;

  const [layoutAggregationConfig, setLayoutAggregationConfig] = useState(() => {
    const saved = localStorage.getItem("cadastro_lotes_table_aggregation_config");
    if (!saved) return {};
    try {
      return JSON.parse(saved);
    } catch {
      return {};
    }
  });

  const [displayState, setDisplayState] = useState(/** @type {{ rows: object[]; selectedIds: string[] }} */ ({ rows: [], selectedIds: [] }));

  useEffect(() => {
    const handleStorage = () => {
      const saved = localStorage.getItem("cadastro_lotes_table_aggregation_config");
      try {
        setLayoutAggregationConfig(saved ? JSON.parse(saved) : {});
      } catch {
        setLayoutAggregationConfig({});
      }
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("cadastro-lotes-layout-updated", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("cadastro-lotes-layout-updated", handleStorage);
    };
  }, []);

  const colunasDisponiveis = useMemo(() => {
    const formFieldToColumnId = {
      quantidade_cabecas: "cabecas",
      peso_medio_kg: "peso",
      valor_total_compra: "valor",
    };
    const aggregationByColumn = { ...layoutAggregationConfig };
    Object.entries(formFieldToColumnId).forEach(([fieldId, columnId]) => {
      if (layoutAggregationConfig[fieldId]?.enabled) aggregationByColumn[columnId] = layoutAggregationConfig[fieldId];
    });

    return COLUNAS_DISPONIVEIS.map((coluna) => {
      const config = aggregationByColumn[coluna.id];
      const base = { ...coluna, fixo: false };
      if (coluna.tipo === "number" && coluna.usar_mascara) {
        return { ...base, agregacao_tipo: "", agregacao: "", align: "left" };
      }
      return config?.enabled
        ? { ...base, agregacao_tipo: config.type, agregacao: config.type, usar_decimal: true }
        : { ...base, agregacao_tipo: "", agregacao: "" };
    });
  }, [layoutAggregationConfig]);

  const getFieldValue = useCallback(
    (lote, colunaId) => {
      const coluna = colunasDisponiveis.find((item) => item.id === colunaId);
      return campoEngine.getValorCampo(lote, coluna || { id: colunaId }, {});
    },
    [colunasDisponiveis],
  );

  const renderCell = useCallback(
    (lote, colunaId) => {
      if (colunaId === "cabecas") {
        return Number(lote.quantidade_entrada || lote.quantidade_cabecas || 0).toLocaleString("pt-BR", {
          maximumFractionDigits: 0,
        });
      }
      const coluna = colunasDisponiveis.find((item) => item.id === colunaId);
      return campoEngine.getValorCampo(lote, coluna || { id: colunaId }, {});
    },
    [colunasDisponiveis],
  );

  const { ordenadas: colunasVisiveisLayout } = useMemo(
    () => readColumnLayout(colunasDisponiveis),
    [colunasDisponiveis, displayState.rows],
  );

  const agregacoes = useMemo(
    () => campoEngine.calcularAgregacoes(displayState.rows, colunasVisiveisLayout),
    [displayState.rows, colunasVisiveisLayout],
  );

  const gridFooter = useMemo(() => {
    if (!Object.keys(agregacoes).length) return null;
    return (
      <tr className="bg-slate-200">
        <td className="bg-slate-200" />
        {colunasVisiveisLayout.map((coluna, index) => (
          <td
            key={`total-${coluna.id}`}
            className={`px-2 py-0 text-[11px] bg-slate-200 text-slate-900 tabular-nums ${coluna.align === "right" ? "text-right" : coluna.align === "center" ? "text-center" : "text-left"}`}
          >
            {agregacoes[coluna.id] !== undefined
              ? formatTotalValue(agregacoes[coluna.id], coluna)
              : index === 0
                ? "Totais"
                : ""}
          </td>
        ))}
      </tr>
    );
  }, [agregacoes, colunasVisiveisLayout]);

  const notifyVisibleDataChange = useCallback(
    (rows, selectedIds) => {
      if (!onVisibleDataChange) return;
      const { ordenadas, todas, widths } = readColumnLayout(colunasDisponiveis);
      const agreg = campoEngine.calcularAgregacoes(rows, ordenadas);
      const agregTodas = campoEngine.calcularAgregacoes(rows, todas);

      const buildColumns = (cols) =>
        cols.map((coluna) => ({
          id: coluna.id,
          label: coluna.label,
          width: widths[coluna.id] || coluna.width || 160,
        }));
      const buildRows = (items, cols) => items.map((lote) => cols.map((coluna) => getFieldValue(lote, coluna.id)));
      const buildTotalRow = (cols, totals) =>
        Object.keys(totals).length > 0
          ? cols.map((coluna, index) => {
              if (index === 0) return "Totais";
              return totals[coluna.id] !== undefined ? formatTotalValue(totals[coluna.id], coluna) : "";
            })
          : null;

      const selectedSet = new Set(selectedIds.map(String));
      const selectedLotes = rows.filter((lote) => selectedSet.has(String(lote.id)));
      const totalRow = buildTotalRow(ordenadas, agreg);
      const allTotalRow = buildTotalRow(todas, agregTodas);

      onVisibleDataChange({
        columns: buildColumns(ordenadas),
        rows: buildRows(rows, ordenadas),
        selectedRows: buildRows(selectedLotes, ordenadas),
        totalRows: totalRow ? [totalRow] : [],
        allColumns: buildColumns(todas),
        allRows: buildRows(rows, todas),
        allSelectedRows: buildRows(selectedLotes, todas),
        allTotalRows: allTotalRow ? [allTotalRow] : [],
      });
    },
    [colunasDisponiveis, getFieldValue, onVisibleDataChange],
  );

  const handleDisplayChange = useCallback((payload) => {
    setDisplayState((prev) => (displayPayloadEquivalent(prev, payload) ? prev : payload));
  }, []);

  useEffect(() => {
    notifyVisibleDataChange(displayState.rows, displayState.selectedIds);
  }, [displayState, notifyVisibleDataChange]);

  useEffect(() => {
    if (!selectedRecordId) return;
    onSelectionChange?.([selectedRecordId]);
  }, [selectedRecordId, onSelectionChange]);

  const matchesSearch = useCallback(
    (lote, q) =>
      colunasDisponiveis.some((col) => String(getFieldValue(lote, col.id) || "").toLowerCase().includes(q)),
    [colunasDisponiveis, getFieldValue],
  );

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-white select-none">
      <CadastroBase1Grade
        rows={lotes}
        columns={colunasDisponiveis}
        storageKey={STORAGE_KEY}
        droppableId="colunas-cadastro-lotes"
        getFieldValue={getFieldValue}
        renderCell={renderCell}
        defaultSortKey="nome"
        emptyText="Nenhum lote encontrado"
        isLoading={isLoading}
        onOpen={onEdit}
        showConfigColunas={showConfigColunas}
        setShowConfigColunas={setShowConfigColunas}
        searchQuery={globalSearch}
        resetFiltersKey={resetFiltersKey}
        onSelectionChange={onSelectionChange}
        onFiltersActiveChange={onFiltersActiveChange}
        viewMode={viewMode}
        displayLimit={displayLimit}
        onListMetrics={onListMetrics}
        cardFields={cardFields}
        cardsPerRow={cardsPerRow}
        cardsTitleColId="nome"
        cardsCodeColId="numero_lote"
        referenceHeaders={BASE1_LISTA_INTEGRADA_VISUAL.grade.referenceHeaders}
        gridFooter={gridFooter}
        onDisplayChange={handleDisplayChange}
        matchesSearch={matchesSearch}
        configureColumnsAnchorRef={configureColumnsAnchorRef}
      />
    </div>
  );
}

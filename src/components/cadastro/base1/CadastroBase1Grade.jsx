import React, { useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ConfiguracaoColunasLegacyDialog from "@/components/cadastro/base1/ConfiguracaoColunasLegacyDialog";
import ConfiguracaoColunasB1Dialog from "@/components/cadastro/base1/ConfiguracaoColunasB1Dialog";
import Base1Grid from "@/components/cadastro/base1/Base1Grid";
import { Base1Cards } from "@/components/cadastro/base1/Base1Cards";
import CadastroColunaFiltro from "@/components/cadastro/base1/CadastroColunaFiltro";
import { casaNoFiltroColuna, tipoFiltroDaColuna } from "@/components/cadastro/base1/cadastroColunaFiltroLogic";
import { MgCheck } from "@/components/cadastro/base1/Base1Ui";
import {
  clampColumnPrefsToVisible,
  loadCadastroBase1ColumnPrefs,
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  normalizeFrozenCount,
  persistCadastroBase1ColumnPrefs,
} from "@/lib/cadastroBase1ColumnPrefs";
import { ArrowDownAZ, ArrowUpZA, Check, X } from "lucide-react";
import { composeCadastroBase1RenderCell } from "@/components/cadastro/base1/cadastroBase1CellKind";

/** Referência estável para listas vazias — evita ciclo de reconciliação de seleção. */
const EMPTY_ROWS = [];

/** @param {Array<{ id: string; label: string; default?: boolean; sortable?: boolean; align?: string; width?: number; filterKind?: 'texto'|'num'|'data'; cellKind?: import('./cadastroBase1CellKind').CadastroBase1CellKind; statusField?: string }>} defs */
export function colunasBase1(defs) {
  return defs.filter((c) => c.id !== "selecao" && c.id !== "acoes");
}

/**
 * Grade cadastro Modelo Base1 (motor compartilhado — frota/equipamentos).
 *
 * @param {object} props
 * @param {object[]} props.rows
 * @param {Array<{ id: string; label: string; default?: boolean; sortable?: boolean; align?: string; width?: number; filterKind?: 'texto'|'num'|'data'; cellKind?: import('./cadastroBase1CellKind').CadastroBase1CellKind; statusField?: string }>} props.columns
 * @param {string} props.storageKey prefixo localStorage (ordem/visíveis/largura)
 * @param {string} props.droppableId id dnd colunas
 * @param {(item: object, colId: string) => string} props.getFieldValue
 * @param {(item: object, colId: string) => import('react').ReactNode} [props.renderCell]
 * @param {string} props.defaultSortKey
 * @param {'asc'|'desc'} [props.defaultSortDir]
 * @param {string} [props.emptyText]
 * @param {boolean} [props.isLoading]
 * @param {(row: object) => void} [props.onOpen]
 * @param {boolean} [props.showConfigColunas]
 * @param {(open: boolean) => void} [props.setShowConfigColunas]
 * @param {string} [props.searchQuery]
 * @param {number} [props.resetFiltersKey]
 * @param {(ids: string[]) => void} [props.onSelectionChange]
 * @param {(active: boolean) => void} [props.onFiltersActiveChange]
 * @param {(item: object, query: string) => boolean} [props.matchesSearch]
 * @param {(row: object) => string} [props.rowKey]
 * @param {import('react').ReactNode} [props.gridFooter] rodapé `<tfoot>` da grade
 * @param {(payload: { rows: object[]; selectedIds: string[] }) => void} [props.onDisplayChange]
 * @param {'table'|'cards'} [props.viewMode]
 * @param {number} [props.displayLimit] limite de linhas visíveis (paginação incremental)
 * @param {(m: { filtrados: number; totais: number; listados: number }) => void} [props.onListMetrics]
 * @param {string[]} [props.cardFields]
 * @param {1|2|3|4} [props.cardsPerRow]
 * @param {string} [props.cardsTitleColId]
 * @param {string} [props.cardsCodeColId]
 * @param {boolean} [props.referenceHeaders] filtro de cabeçalho `fpop` (frota/equipamentos)
 * @param {import('react').RefObject<HTMLElement | null>} [props.configureColumnsAnchorRef] âncora do popover de colunas (referenceHeaders)
 * @param {boolean} [props.colunaSelecao] coluna de checkbox (SSOT `BASE1_GRADE_REFERENCE_HEADERS`)
 * @param {boolean} [props.selecaoSticky] checkbox sticky à esquerda (SSOT preset Base1)
 */
export default function CadastroBase1Grade({
  rows = EMPTY_ROWS,
  columns,
  storageKey,
  droppableId,
  getFieldValue,
  renderCell,
  defaultSortKey,
  defaultSortDir = "asc",
  emptyText = "Nenhum registro encontrado",
  isLoading,
  onOpen,
  showConfigColunas,
  setShowConfigColunas,
  searchQuery = "",
  resetFiltersKey = 0,
  onSelectionChange,
  onFiltersActiveChange,
  matchesSearch,
  rowKey,
  gridFooter,
  onDisplayChange,
  viewMode = "table",
  displayLimit,
  onListMetrics,
  cardFields,
  cardsPerRow = 4,
  cardsTitleColId,
  cardsCodeColId,
  referenceHeaders = false,
  configureColumnsAnchorRef,
  colunaSelecao = true,
  selecaoSticky = true,
}) {
  const dataCols = useMemo(() => colunasBase1(columns), [columns]);
  const defaultVisible = useMemo(
    () => dataCols.filter((c) => c.default !== false).map((c) => c.id),
    [dataCols],
  );

  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: defaultSortKey, direction: defaultSortDir });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const [headerFilters, setHeaderFilters] = useState({});
  const prefsOnce = useRef(null);
  if (!prefsOnce.current) {
    prefsOnce.current = loadCadastroBase1ColumnPrefs(storageKey, dataCols);
  }
  const initialPrefs = prefsOnce.current;

  const [frozenCount, setFrozenCount] = useState(initialPrefs.frozenCount);
  const [autoFitKeys, setAutoFitKeys] = useState(initialPrefs.autoFitKeys);
  const lastPick = useRef(null);

  const [columnWidths, setColumnWidths] = useState(initialPrefs.columnWidths);
  const [colunasOrdem, setColunasOrdem] = useState(initialPrefs.colunasOrdem);
  const [colunasVisiveis, setColunasVisiveis] = useState(initialPrefs.colunasVisiveis);

  useEffect(() => {
    persistCadastroBase1ColumnPrefs(storageKey, {
      columnWidths,
      colunasOrdem,
      colunasVisiveis,
      frozenCount,
      autoFitKeys,
    });
  }, [columnWidths, colunasOrdem, colunasVisiveis, frozenCount, autoFitKeys, storageKey]);

  const idOf = rowKey ?? ((r) => String(r.id));

  useEffect(() => {
    setSelectedItems((p) => {
      const next = p.filter((id) => rows.some((m) => idOf(m) === String(id)));
      if (next.length === p.length) return p;
      return next;
    });
  }, [rows, rowKey]);

  useEffect(() => {
    if (resetFiltersKey > 0) {
      setFiltrosColunas({});
      setHeaderFilters({});
      setSortConfig({ key: defaultSortKey, direction: defaultSortDir });
    }
  }, [resetFiltersKey, defaultSortKey, defaultSortDir]);

  useEffect(() => {
    onSelectionChange?.(selectedItems);
  }, [selectedItems, onSelectionChange]);

  useEffect(() => {
    const activeLegacy = Object.values(filtrosColunas).some((v) => (v || []).length > 0);
    const activeHeader = Object.keys(headerFilters).length > 0;
    onFiltersActiveChange?.(referenceHeaders ? activeHeader : activeLegacy);
  }, [filtrosColunas, headerFilters, referenceHeaders, onFiltersActiveChange]);

  const defaultMatchesSearch = (item, q) => {
    const hay = dataCols
      .map((c) => getFieldValue(item, c.id))
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  };

  const filtrados = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((m) => {
      if (q) {
        const ok = matchesSearch ? matchesSearch(m, q) : defaultMatchesSearch(m, q);
        if (!ok) return false;
      }
      if (referenceHeaders) {
        for (const col of dataCols) {
          const filtro = headerFilters[col.id];
          if (!filtro) continue;
          const tipo = tipoFiltroDaColuna(col.id, col);
          const valor = String(getFieldValue(m, col.id) ?? "");
          if (!casaNoFiltroColuna(filtro, tipo, valor)) return false;
        }
        return true;
      }
      return dataCols.every((col) => {
        const f = filtrosColunas[col.id] || [];
        if (!f.length) return true;
        return f.includes(getFieldValue(m, col.id));
      });
    });
  }, [rows, filtrosColunas, headerFilters, referenceHeaders, searchQuery, dataCols, matchesSearch, getFieldValue]);

  const ordenados = useMemo(() => {
    const s = [...filtrados];
    const colDef = dataCols.find((c) => c.id === sortConfig.key);
    const tipoSort = referenceHeaders ? tipoFiltroDaColuna(sortConfig.key, colDef) : "texto";
    const numDeSort = (v) => {
      const t = String(v ?? "").trim();
      if (!/[0-9]/.test(t)) return null;
      const n = Number(t.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", "."));
      return Number.isNaN(n) ? null : n;
    };
    s.sort((a, b) => {
      const rawA = getFieldValue(a, sortConfig.key);
      const rawB = getFieldValue(b, sortConfig.key);
      let cmp = 0;
      if (tipoSort === "num") {
        const na = numDeSort(rawA);
        const nb = numDeSort(rawB);
        if (na === null && nb === null) cmp = 0;
        else if (na === null) cmp = 1;
        else if (nb === null) cmp = -1;
        else cmp = na - nb;
      } else {
        const av = String(rawA ?? "").toLowerCase();
        const bv = String(rawB ?? "").toLowerCase();
        cmp = av.localeCompare(bv, "pt-BR", { numeric: true });
      }
      return sortConfig.direction === "asc" ? cmp : -cmp;
    });
    return s;
  }, [filtrados, sortConfig, getFieldValue, dataCols, referenceHeaders]);

  const cardFieldKeys = useMemo(() => {
    if (cardFields?.length) return cardFields;
    return dataCols.slice(0, 7).map((c) => c.id);
  }, [cardFields, dataCols]);

  const visibleRows = useMemo(() => {
    if (displayLimit == null || displayLimit <= 0) return ordenados;
    return ordenados.slice(0, displayLimit);
  }, [ordenados, displayLimit]);

  useEffect(() => {
    onDisplayChange?.({ rows: ordenados, selectedIds: selectedItems.map(String) });
  }, [ordenados, selectedItems, onDisplayChange]);

  useEffect(() => {
    onListMetrics?.({
      filtrados: ordenados.length,
      totais: rows.length,
      listados: visibleRows.length,
    });
  }, [ordenados.length, rows.length, visibleRows.length, onListMetrics]);

  const colunasOrdenadas = useMemo(
    () =>
      colunasOrdem
        .map((id) => dataCols.find((c) => c.id === id))
        .filter((c) => c && colunasVisiveis.includes(c.id)),
    [colunasOrdem, colunasVisiveis, dataCols],
  );

  const composedRenderCell = useMemo(
    () => composeCadastroBase1RenderCell(dataCols, renderCell),
    [dataCols, renderCell],
  );

  const gridColumns = useMemo(
    () =>
      colunasOrdenadas.map((c) => ({
        key: c.id,
        label: c.label,
        sortable: c.sortable !== false,
        align: c.align,
        width: columnWidths[c.id] || c.width,
        text: (r) => getFieldValue(r, c.id),
        render: (r) => {
          const node = composedRenderCell(r, c.id);
          if (node !== undefined && node !== null) return node;
          return getFieldValue(r, c.id) || "–";
        },
      })),
    [colunasOrdenadas, columnWidths, getFieldValue, composedRenderCell],
  );

  const selectedSet = useMemo(() => new Set(selectedItems.map(String)), [selectedItems]);
  const filteredKeys = useMemo(() => {
    if (referenceHeaders) return new Set(Object.keys(headerFilters));
    return new Set(Object.entries(filtrosColunas).filter(([, v]) => (v || []).length).map(([k]) => k));
  }, [filtrosColunas, headerFilters, referenceHeaders]);

  const renderReferenceFilter = (colunaId) => {
    if (!referenceHeaders || menuFiltroAberto !== colunaId) return null;
    const col = dataCols.find((c) => c.id === colunaId);
    const colLabel = col?.label ?? colunaId;
    const valores = rows.map((r) => String(getFieldValue(r, colunaId) ?? ""));
    const ancora = `[data-testid="b1-list"] [data-b1-col-menu="${colunaId}"]`;
    return (
      <CadastroColunaFiltro
        key={colunaId}
        rotulo={colLabel}
        tipo={tipoFiltroDaColuna(colunaId, col)}
        ancora={ancora}
        valores={valores}
        atual={headerFilters[colunaId] ?? null}
        onAplicar={(f) => {
          setHeaderFilters((p) => {
            const n = { ...p };
            if (f) n[colunaId] = f;
            else delete n[colunaId];
            return n;
          });
          setMenuFiltroAberto(null);
        }}
        onFechar={() => setMenuFiltroAberto(null)}
      />
    );
  };

  const onSelectClick = (id, mod) => {
    setSelectedItems((prev) => {
      if (mod.shift && lastPick.current) {
        const ids = ordenados.map(idOf);
        const a = ids.indexOf(lastPick.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const n = new Set(mod.ctrl ? prev.map(String) : []);
          for (const x of ids.slice(lo, hi + 1)) n.add(x);
          return [...n];
        }
      }
      lastPick.current = id;
      if (mod.ctrl) {
        const n = new Set(prev.map(String));
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return [...n];
      }
      return prev.length === 1 && String(prev[0]) === id ? [] : [id];
    });
  };

  const onToggle = (id) => {
    lastPick.current = id;
    setSelectedItems((prev) => {
      const n = new Set(prev.map(String));
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return [...n];
    });
  };

  const onToggleAll = (on) => {
    const visibleIds = visibleRows.map((r) => idOf(r));
    setSelectedItems((prev) => {
      const n = new Set(prev.map(String));
      if (on) {
        for (const id of visibleIds) n.add(id);
        return [...n];
      }
      for (const id of visibleIds) n.delete(id);
      return [...n];
    });
  };

  const handleSort = (k) =>
    setSortConfig((p) => ({
      key: k,
      direction: p.key === k && p.direction === "asc" ? "desc" : "asc",
    }));

  const applyVisibleKeys = (keys) => {
    setColunasVisiveis(keys);
  };

  const toggleColuna = (id) => {
    const n = colunasVisiveis.includes(id) ? colunasVisiveis.filter((i) => i !== id) : [...colunasVisiveis, id];
    applyVisibleKeys(n);
  };

  const ocultarColuna = (colKey) => {
    const keys = colunasOrdenadas.map((c) => c.id);
    const idx = keys.indexOf(colKey);
    if (idx < 0) return;
    const visiveis = colunasVisiveis.filter((id) => id !== colKey);
    setColunasVisiveis(visiveis);
    const ajuste = clampColumnPrefsToVisible(
      {
        frozenCount: idx < frozenCount ? frozenCount - 1 : frozenCount,
        autoFitKeys,
      },
      visiveis,
    );
    setFrozenCount(ajuste.frozenCount);
    setAutoFitKeys(ajuste.autoFitKeys);
  };

  const handleColumnResize = (k, w) => {
    const clamped = Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(w)));
    setColumnWidths((p) => ({ ...p, [k]: clamped }));
  };

  const handleFreeze = (n) => {
    setFrozenCount(normalizeFrozenCount(n, colunasOrdenadas.length));
  };

  const handleDragEnd = (r) => {
    if (!r.destination) return;
    const items = Array.from(colunasOrdem);
    const [x] = items.splice(r.source.index, 1);
    items.splice(r.destination.index, 0, x);
    setColunasOrdem(items);
  };

  const hasActiveFilter = (id) => (filtrosColunas[id] || []).length > 0;
  const columnOptions = useMemo(() => {
    const o = {};
    dataCols.forEach((c) => {
      o[c.id] = [...new Set(rows.map((m) => getFieldValue(m, c.id)).filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b), "pt-BR"),
      );
    });
    return o;
  }, [rows, dataCols, getFieldValue]);

  const renderFilterPopover = (colunaId) => {
    const options = columnOptions[colunaId] || [];
    const valoresSelecionados =
      filtroTemp.colunaId === colunaId ? filtroTemp.valores : filtrosColunas[colunaId] || [];
    const filtered = options.filter((o) =>
      String(o).toLowerCase().includes(buscaFiltroMenu.toLowerCase()),
    );
    const allSel = filtered.length > 0 && filtered.every((o) => valoresSelecionados.includes(o));
    const colLabel = dataCols.find((c) => c.id === colunaId)?.label ?? colunaId;

    return (
      <Popover
        key={colunaId}
        open={menuFiltroAberto === colunaId}
        onOpenChange={(open) => {
          setMenuFiltroAberto(open ? colunaId : null);
          setBuscaFiltroMenu("");
          setFiltroTemp(
            open ? { colunaId, valores: [...(filtrosColunas[colunaId] || [])] } : { colunaId: null, valores: [] },
          );
        }}
      >
        <PopoverTrigger asChild>
          <span className="sr-only">Filtro {colLabel}</span>
        </PopoverTrigger>
        {/* @ts-expect-error PopoverContent sem props tipadas */}
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={4}
          className="cadastro-b1 w-[310px] p-0 z-[9999] rounded-[10px] border border-[var(--mg-divider)] bg-[var(--mg-bg-card)] shadow-md"
        >
          <div className="mg-b1-col-filter-menu">
            <button
              type="button"
              className="mg-b1-col-filter-action"
              onClick={() => {
                handleSort(colunaId);
                setMenuFiltroAberto(null);
              }}
            >
              <ArrowDownAZ aria-hidden /> Menor para Maior
            </button>
            <button
              type="button"
              className="mg-b1-col-filter-action"
              onClick={() => {
                setSortConfig({ key: colunaId, direction: "desc" });
                setMenuFiltroAberto(null);
              }}
            >
              <ArrowUpZA aria-hidden /> Maior para Menor
            </button>
            <button
              type="button"
              className="mg-b1-col-filter-action"
              disabled={!hasActiveFilter(colunaId)}
              onClick={() => {
                setFiltrosColunas((p) => ({ ...p, [colunaId]: [] }));
                setMenuFiltroAberto(null);
              }}
            >
              <X aria-hidden /> Limpar Filtro
            </button>
          </div>
          <div className="mg-b1-col-filter-body">
            <input
              type="text"
              value={buscaFiltroMenu}
              onChange={(e) => setBuscaFiltroMenu(e.target.value)}
              placeholder="PESQUISAR"
              className="mg-field h-8 w-full text-xs uppercase"
              aria-label={`Pesquisar valores de ${colLabel}`}
            />
            <div className="mg-b1-col-filter-list">
              <label className="mg-b1-col-filter-row mg-b1-col-filter-row--header">
                <MgCheck
                  checked={allSel}
                  indeterminate={!allSel && filtered.some((opt) => valoresSelecionados.includes(opt))}
                  onChange={(checked) =>
                    setFiltroTemp((p) => {
                      const rest = p.valores.filter((v) => !filtered.includes(v));
                      return {
                        ...p,
                        valores: checked ? [...new Set([...rest, ...filtered])] : rest,
                      };
                    })
                  }
                />
                <span>(Selecionar Tudo)</span>
              </label>
              {filtered.map((opt) => (
                <label key={String(opt)} className="mg-b1-col-filter-row">
                  <MgCheck
                    checked={valoresSelecionados.includes(opt)}
                    onChange={(checked) =>
                      setFiltroTemp((p) => ({
                        ...p,
                        valores: checked ? [...p.valores, opt] : p.valores.filter((i) => i !== opt),
                      }))
                    }
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            <div className="mg-b1-col-filter-footer">
              <button
                type="button"
                className="tb-btn tb-btn-gray h-8 text-xs"
                onClick={() => setMenuFiltroAberto(null)}
              >
                <X className="h-4 w-4" aria-hidden />
                Cancelar
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-green h-8 text-xs"
                onClick={() => {
                  setFiltrosColunas((p) => ({ ...p, [colunaId]: filtroTemp.valores }));
                  setMenuFiltroAberto(null);
                }}
              >
                <Check className="h-4 w-4" aria-hidden />
                OK
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const ocultasSet = useMemo(
    () => new Set(dataCols.filter((c) => !colunasVisiveis.includes(c.id)).map((c) => c.id)),
    [dataCols, colunasVisiveis],
  );
  const colunasParaDialogo = useMemo(
    () =>
      colunasOrdem
        .map((id) => dataCols.find((c) => c.id === id))
        .filter(Boolean)
        .map((c) => ({ id: c.id, label: c.label })),
    [colunasOrdem, dataCols],
  );

  const restaurarColunas = () => {
    applyVisibleKeys(defaultVisible);
    setColunasOrdem(dataCols.map((c) => c.id));
    setColumnWidths(Object.fromEntries(dataCols.map((c) => [c.id, c.width || 160])));
    setFrozenCount(0);
    setAutoFitKeys(new Set());
  };

  const toggleAutoFit = (colKey) => {
    setAutoFitKeys((prev) => {
      const n = new Set(prev);
      if (n.has(colKey)) n.delete(colKey);
      else n.add(colKey);
      return n;
    });
  };

  if (viewMode === "cards") {
    return (
      <>
        <Base1Cards
          rows={visibleRows}
          columns={dataCols}
          fields={cardFieldKeys}
          perRow={cardsPerRow}
          loading={isLoading}
          onOpen={onOpen}
          selected={selectedSet}
          onSelectClick={onSelectClick}
          onToggle={onToggle}
          getFieldValue={getFieldValue}
          renderCell={composedRenderCell}
          rowKey={rowKey}
          titleColId={cardsTitleColId}
          codeColId={cardsCodeColId}
          emptyText={emptyText}
        />
        {referenceHeaders
          ? dataCols.map((c) => renderReferenceFilter(c.id))
          : dataCols.map((c) => renderFilterPopover(c.id))}
      </>
    );
  }

  return (
    <>
      <Base1Grid
        referenceHeaders={referenceHeaders}
        referenceExtendedColumnMenu={referenceHeaders}
        columns={gridColumns}
        rows={visibleRows}
        loading={isLoading}
        sort={{ key: sortConfig.key, dir: sortConfig.direction === "desc" ? "desc" : "asc" }}
        onSort={handleSort}
        selected={selectedSet}
        onSelectClick={onSelectClick}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
        onOpen={onOpen}
        frozen={frozenCount}
        onFreeze={handleFreeze}
        onHide={ocultarColuna}
        onResize={handleColumnResize}
        onAutoFit={toggleAutoFit}
        colunaSelecao={colunaSelecao}
        selecaoSticky={selecaoSticky}
        autoFitKeys={autoFitKeys}
        onFilter={(k) => setMenuFiltroAberto(k)}
        onClearFilter={(k) => {
          if (referenceHeaders) {
            setHeaderFilters((p) => {
              if (!(k in p)) return p;
              const n = { ...p };
              delete n[k];
              return n;
            });
            return;
          }
          setFiltrosColunas((p) => {
            if (!(k in p)) return p;
            const n = { ...p };
            delete n[k];
            return n;
          });
        }}
        filteredKeys={filteredKeys}
        emptyText={emptyText}
        rowKey={rowKey ? (r) => rowKey(r) : undefined}
        footer={gridFooter}
      />
      {referenceHeaders
        ? dataCols.map((c) => renderReferenceFilter(c.id))
        : dataCols.map((c) => renderFilterPopover(c.id))}
      {setShowConfigColunas && referenceHeaders ? (
        <ConfiguracaoColunasB1Dialog
          open={showConfigColunas}
          onFechar={() => setShowConfigColunas(false)}
          titulo="Colunas da tabela"
          colunas={colunasParaDialogo}
          ocultas={ocultasSet}
          onAplicar={(visiveis, ordemCompleta) => {
            setColunasVisiveis(visiveis);
            setColunasOrdem(ordemCompleta);
            const ajuste = clampColumnPrefsToVisible({ frozenCount, autoFitKeys }, visiveis);
            setFrozenCount(ajuste.frozenCount);
            setAutoFitKeys(ajuste.autoFitKeys);
          }}
          onRestaurar={restaurarColunas}
        />
      ) : null}
      {setShowConfigColunas && !referenceHeaders ? (
        <ConfiguracaoColunasLegacyDialog
          open={showConfigColunas}
          onOpenChange={setShowConfigColunas}
          colunasDisponiveis={dataCols}
          colunasVisiveis={colunasVisiveis}
          colunasOrdem={colunasOrdem}
          toggleColuna={toggleColuna}
          handleDragEnd={handleDragEnd}
          droppableId={droppableId}
        />
      ) : null}
    </>
  );
}

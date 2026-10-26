import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import ConfiguracaoColunasB1Dialog from "@/components/cadastro/base1/ConfiguracaoColunasB1Dialog";
import Base1Grid from "@/components/cadastro/base1/Base1Grid";
import { Base1Cards } from "@/components/cadastro/base1/Base1Cards";
import CadastroColunaFiltro from "@/components/cadastro/base1/CadastroColunaFiltro";
import { casaNoFiltroColuna, tipoFiltroDaColuna } from "@/components/cadastro/base1/cadastroColunaFiltroLogic";
import { MgCheck } from "@/components/cadastro/base1/Base1Ui";
import { ArrowDownAZ, ArrowUpZA, X } from "lucide-react";

/** @param {Array<{ id: string; label: string; default?: boolean; sortable?: boolean; align?: string; width?: number; filterKind?: 'texto'|'num'|'data' }>} defs */
export function colunasBase1(defs) {
  return defs.filter((c) => c.id !== "selecao" && c.id !== "acoes");
}

/**
 * Grade cadastro Modelo Base1 (motor compartilhado — frota/equipamentos).
 *
 * @param {object} props
 * @param {object[]} props.rows
 * @param {Array<{ id: string; label: string; default?: boolean; sortable?: boolean; align?: string; width?: number; filterKind?: 'texto'|'num'|'data' }>} props.columns
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
 */
export default function CadastroBase1Grade({
  rows = [],
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
  const [frozenCount, setFrozenCount] = useState(() => {
    const saved = localStorage.getItem(`${storageKey}_congeladas`);
    if (!saved) return 0;
    const n = Number.parseInt(saved, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  const [autoFitKeys, setAutoFitKeys] = useState(() => {
    const saved = localStorage.getItem(`${storageKey}_autofit`);
    if (!saved) return new Set();
    try {
      const ids = JSON.parse(saved);
      return new Set(Array.isArray(ids) ? ids : []);
    } catch {
      return new Set();
    }
  });
  const lastPick = useRef(null);

  const [columnWidths, setColumnWidths] = useState(() => {
    const defs = Object.fromEntries(dataCols.map((c) => [c.id, c.width || 160]));
    const saved = localStorage.getItem(`${storageKey}_largura`);
    if (!saved) return defs;
    try {
      return { ...defs, ...JSON.parse(saved) };
    } catch {
      return defs;
    }
  });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem(`${storageKey}_ordem`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return dataCols.map((c) => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem(`${storageKey}_visiveis`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return defaultVisible;
  });

  useEffect(() => {
    localStorage.setItem(`${storageKey}_largura`, JSON.stringify(columnWidths));
  }, [columnWidths, storageKey]);

  useEffect(() => {
    localStorage.setItem(`${storageKey}_congeladas`, String(frozenCount));
  }, [frozenCount, storageKey]);

  useEffect(() => {
    localStorage.setItem(`${storageKey}_autofit`, JSON.stringify([...autoFitKeys]));
  }, [autoFitKeys, storageKey]);

  const idOf = rowKey ?? ((r) => String(r.id));

  useEffect(() => {
    setSelectedItems((p) => p.filter((id) => rows.some((m) => idOf(m) === String(id))));
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
    s.sort((a, b) => {
      const av = String(getFieldValue(a, sortConfig.key) ?? "").toLowerCase();
      const bv = String(getFieldValue(b, sortConfig.key) ?? "").toLowerCase();
      if (av < bv) return sortConfig.direction === "asc" ? -1 : 1;
      if (av > bv) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return s;
  }, [filtrados, sortConfig, getFieldValue]);

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

  const gridColumns = useMemo(
    () =>
      colunasOrdenadas.map((c) => ({
        key: c.id,
        label: c.label,
        sortable: c.sortable !== false,
        align: c.align,
        width: columnWidths[c.id] || c.width,
        text: (r) => getFieldValue(r, c.id),
        render: renderCell ? (r) => renderCell(r, c.id) : undefined,
      })),
    [colunasOrdenadas, columnWidths, getFieldValue, renderCell],
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
    setSelectedItems(on ? ordenados.map((r) => idOf(r)) : []);
  };

  const handleSort = (k) =>
    setSortConfig((p) => ({
      key: k,
      direction: p.key === k && p.direction === "asc" ? "desc" : "asc",
    }));

  const applyVisibleKeys = (keys) => {
    setColunasVisiveis(keys);
    localStorage.setItem(`${storageKey}_visiveis`, JSON.stringify(keys));
  };

  const toggleColuna = (id) => {
    const n = colunasVisiveis.includes(id) ? colunasVisiveis.filter((i) => i !== id) : [...colunasVisiveis, id];
    applyVisibleKeys(n);
  };

  const handleDragEnd = (r) => {
    if (!r.destination) return;
    const items = Array.from(colunasOrdem);
    const [x] = items.splice(r.source.index, 1);
    items.splice(r.destination.index, 0, x);
    setColunasOrdem(items);
    localStorage.setItem(`${storageKey}_ordem`, JSON.stringify(items));
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
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMenuFiltroAberto(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                className="tb-btn tb-btn-green h-8 text-xs"
                onClick={() => {
                  setFiltrosColunas((p) => ({ ...p, [colunaId]: filtroTemp.valores }));
                  setMenuFiltroAberto(null);
                }}
              >
                OK
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const headerFiltersActive = referenceHeaders && Object.keys(headerFilters).length > 0;
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
    localStorage.setItem(`${storageKey}_ordem`, JSON.stringify(dataCols.map((c) => c.id)));
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
          getFieldValue={getFieldValue}
          renderCell={renderCell}
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
      {headerFiltersActive ? (
        <div className="mg-header-filter-hint no-print">
          <span>
            Filtro de cabeçalho: {ordenados.length} de {rows.length} registros carregados
          </span>
          <button
            type="button"
            className="fchip-lim"
            onClick={() => setHeaderFilters({})}
          >
            Limpar filtros de cabeçalho
          </button>
        </div>
      ) : null}
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
        onFreeze={setFrozenCount}
        onHide={(k) => toggleColuna(k)}
        onResize={(k, w) => setColumnWidths((p) => ({ ...p, [k]: w }))}
        onAutoFit={toggleAutoFit}
        autoFitKeys={autoFitKeys}
        onFilter={(k) => setMenuFiltroAberto(k)}
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
          onMudar={(id, ocultar) => {
            const visivel = colunasVisiveis.includes(id);
            if (ocultar && visivel) toggleColuna(id);
            if (!ocultar && !visivel) toggleColuna(id);
          }}
          onOrdenar={(ids) => {
            setColunasOrdem(ids);
            localStorage.setItem(`${storageKey}_ordem`, JSON.stringify(ids));
          }}
          onRestaurar={restaurarColunas}
        />
      ) : null}
      {setShowConfigColunas && !referenceHeaders ? (
        <ConfiguracaoColunasMapaDialog
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

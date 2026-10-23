import React, { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import Base1Grid from "@/components/cadastro/base1/Base1Grid";
import { ArrowDownAZ, ArrowUpZA, X } from "lucide-react";

const COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 300 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 300 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
];

const DEFAULT_VIS = COLUNAS.filter((c) => c.default).map((c) => c.id);
const STORAGE = "colunas_marcas_v1";

function getFieldValue(item, id) {
  if (id === "numero") return item.numero_marca || "";
  if (id === "nome") return item.nome || "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
  return "";
}

export default function TabelaMarcas({
  marcas = [],
  onEdit,
  onDelete,
  isLoading,
  showConfigColunas,
  setShowConfigColunas,
  searchQuery = "",
  resetFiltersKey = 0,
  onSelectionChange,
  onFiltersActiveChange,
}) {
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [frozenCount, setFrozenCount] = useState(0);
  const lastPick = useRef(null);

  const [columnWidths, setColumnWidths] = useState(() => {
    const defs = Object.fromEntries(COLUNAS.map((c) => [c.id, c.width || 160]));
    const saved = localStorage.getItem(`${STORAGE}_largura`);
    if (!saved) return defs;
    try {
      return { ...defs, ...JSON.parse(saved) };
    } catch {
      return defs;
    }
  });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE}_ordem`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return COLUNAS.map((c) => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE}_visiveis`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return DEFAULT_VIS;
  });

  useEffect(() => {
    localStorage.setItem(`${STORAGE}_largura`, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    setSelectedItems((p) => p.filter((id) => marcas.some((m) => m.id === id)));
  }, [marcas]);

  useEffect(() => {
    if (resetFiltersKey > 0) {
      setFiltrosColunas({});
      setSortConfig({ key: "nome", direction: "asc" });
    }
  }, [resetFiltersKey]);

  useEffect(() => {
    onSelectionChange?.(selectedItems);
  }, [selectedItems, onSelectionChange]);

  useEffect(() => {
    const active = Object.values(filtrosColunas).some((v) => (v || []).length > 0);
    onFiltersActiveChange?.(active);
  }, [filtrosColunas, onFiltersActiveChange]);

  const filtrados = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return marcas.filter((m) => {
      if (q) {
        const hay = [m.nome, m.descricao, m.numero_marca].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return COLUNAS.every((col) => {
        const f = filtrosColunas[col.id] || [];
        if (!f.length) return true;
        return f.includes(getFieldValue(m, col.id));
      });
    });
  }, [marcas, filtrosColunas, searchQuery]);

  const ordenados = useMemo(() => {
    const s = [...filtrados];
    s.sort((a, b) => {
      const av = getFieldValue(a, sortConfig.key).toLowerCase();
      const bv = getFieldValue(b, sortConfig.key).toLowerCase();
      if (av < bv) return sortConfig.direction === "asc" ? -1 : 1;
      if (av > bv) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return s;
  }, [filtrados, sortConfig]);

  const colunasOrdenadas = useMemo(
    () =>
      colunasOrdem
        .map((id) => COLUNAS.find((c) => c.id === id))
        .filter((c) => c && colunasVisiveis.includes(c.id)),
    [colunasOrdem, colunasVisiveis],
  );

  const gridColumns = useMemo(
    () =>
      colunasOrdenadas.map((c) => ({
        key: c.id,
        label: c.label,
        sortable: c.sortable,
        align: c.align,
        width: columnWidths[c.id] || c.width,
        text: (r) => getFieldValue(r, c.id),
        render: (item) => {
          if (c.id === "numero") return <span className="font-mono">{item.numero_marca || "–"}</span>;
          if (c.id === "nome") return <span className="uppercase">{item.nome || "–"}</span>;
          if (c.id === "descricao") return item.descricao || "–";
          if (c.id === "ativo") {
            return item.ativo !== false ? (
              <Badge variant="secondary" className="text-[10px] bg-emerald-100 text-emerald-700 border-0">
                Ativo
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-500 border-0">
                Inativo
              </Badge>
            );
          }
          return "–";
        },
      })),
    [colunasOrdenadas, columnWidths],
  );

  const selectedSet = useMemo(() => new Set(selectedItems), [selectedItems]);
  const filteredKeys = useMemo(
    () => new Set(Object.entries(filtrosColunas).filter(([, v]) => (v || []).length).map(([k]) => k)),
    [filtrosColunas],
  );

  const rowId = (r) => String(r.id);

  const onSelectClick = (id, mod) => {
    setSelectedItems((prev) => {
      if (mod.shift && lastPick.current) {
        const ids = ordenados.map(rowId);
        const a = ids.indexOf(lastPick.current);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const n = new Set(mod.ctrl ? prev : []);
          for (const x of ids.slice(lo, hi + 1)) n.add(x);
          return [...n];
        }
      }
      lastPick.current = id;
      if (mod.ctrl) {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return [...n];
      }
      return prev.length === 1 && prev[0] === id ? [] : [id];
    });
  };

  const onToggle = (id) => {
    lastPick.current = id;
    setSelectedItems((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return [...n];
    });
  };

  const onToggleAll = (on) => {
    setSelectedItems(on ? ordenados.map((r) => r.id) : []);
  };

  const handleSort = (k) =>
    setSortConfig((p) => ({
      key: k,
      direction: p.key === k && p.direction === "asc" ? "desc" : "asc",
    }));

  const toggleColuna = (id) => {
    const n = colunasVisiveis.includes(id) ? colunasVisiveis.filter((i) => i !== id) : [...colunasVisiveis, id];
    setColunasVisiveis(n);
    localStorage.setItem(`${STORAGE}_visiveis`, JSON.stringify(n));
  };

  const handleDragEnd = (r) => {
    if (!r.destination) return;
    const items = Array.from(colunasOrdem);
    const [x] = items.splice(r.source.index, 1);
    items.splice(r.destination.index, 0, x);
    setColunasOrdem(items);
    localStorage.setItem(`${STORAGE}_ordem`, JSON.stringify(items));
  };

  const hasActiveFilter = (id) => (filtrosColunas[id] || []).length > 0;
  const columnOptions = useMemo(() => {
    const o = {};
    COLUNAS.forEach((c) => {
      o[c.id] = [...new Set(marcas.map((m) => getFieldValue(m, c.id)).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      );
    });
    return o;
  }, [marcas]);

  const renderFilterPopover = (colunaId) => {
    const options = columnOptions[colunaId] || [];
    const valoresSelecionados =
      filtroTemp.colunaId === colunaId ? filtroTemp.valores : filtrosColunas[colunaId] || [];
    const filtered = options.filter((o) =>
      String(o).toLowerCase().includes(buscaFiltroMenu.toLowerCase()),
    );
    const allSel = filtered.length > 0 && filtered.every((o) => valoresSelecionados.includes(o));
    const colLabel = COLUNAS.find((c) => c.id === colunaId)?.label ?? colunaId;

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
        <PopoverContent align="end" side="bottom" sideOffset={4} className="w-[310px] p-0 z-[9999]">
          <div className="p-1 space-y-0.5 border-b">
            <button
              type="button"
              className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded"
              onClick={() => {
                handleSort(colunaId);
                setMenuFiltroAberto(null);
              }}
            >
              <ArrowDownAZ className="w-4 h-4 mr-2" /> Menor para Maior
            </button>
            <button
              type="button"
              className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded"
              onClick={() => {
                setSortConfig({ key: colunaId, direction: "desc" });
                setMenuFiltroAberto(null);
              }}
            >
              <ArrowUpZA className="w-4 h-4 mr-2" /> Maior para Menor
            </button>
            <button
              type="button"
              className={`flex items-center w-full px-2 h-8 text-xs rounded ${hasActiveFilter(colunaId) ? "hover:bg-slate-100" : "text-slate-300 cursor-not-allowed"}`}
              disabled={!hasActiveFilter(colunaId)}
              onClick={() => {
                setFiltrosColunas((p) => ({ ...p, [colunaId]: [] }));
                setMenuFiltroAberto(null);
              }}
            >
              <X className="w-4 h-4 mr-2" /> Limpar Filtro
            </button>
          </div>
          <div className="p-2 space-y-2">
            <Input
              value={buscaFiltroMenu}
              onChange={(e) => setBuscaFiltroMenu(e.target.value)}
              placeholder="PESQUISAR"
              className="h-8 text-xs uppercase"
            />
            <div className="border border-slate-300 rounded-sm max-h-64 overflow-y-auto p-1 bg-white">
              <label className="flex h-8 items-center gap-2 px-2 py-0 text-xs text-slate-700 border-b border-slate-200">
                <Checkbox
                  checked={allSel}
                  onCheckedChange={(checked) =>
                    setFiltroTemp((p) => {
                      const rest = p.valores.filter((v) => !filtered.includes(v));
                      return {
                        ...p,
                        valores: checked ? [...new Set([...rest, ...filtered])] : rest,
                      };
                    })
                  }
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span>(Selecionar Tudo)</span>
              </label>
              {filtered.map((opt) => (
                <label
                  key={opt}
                  className="flex h-6 items-center gap-2 px-2 py-0 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Checkbox
                    checked={valoresSelecionados.includes(opt)}
                    onCheckedChange={(checked) =>
                      setFiltroTemp((p) => ({
                        ...p,
                        valores: checked ? [...p.valores, opt] : p.valores.filter((i) => i !== opt),
                      }))
                    }
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMenuFiltroAberto(null)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
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

  return (
    <>
      <Base1Grid
        columns={gridColumns}
        rows={ordenados}
        loading={isLoading}
        sort={{ key: sortConfig.key, dir: sortConfig.direction === "desc" ? "desc" : "asc" }}
        onSort={handleSort}
        selected={selectedSet}
        onSelectClick={onSelectClick}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
        onOpen={onEdit}
        frozen={frozenCount}
        onFreeze={setFrozenCount}
        onHide={(k) => toggleColuna(k)}
        onResize={(k, w) => setColumnWidths((p) => ({ ...p, [k]: w }))}
        onAutoFit={(k) =>
          setColumnWidths((p) => {
            const next = { ...p };
            delete next[k];
            return next;
          })
        }
        onFilter={(k) => setMenuFiltroAberto(k)}
        filteredKeys={filteredKeys}
        emptyText="Nenhuma marca encontrada"
      />
      {COLUNAS.map((c) => renderFilterPopover(c.id))}
      <ConfiguracaoColunasMapaDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd}
        droppableId="colunas-marcas"
      />
      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Confirmar exclusão"
        description="Deseja excluir esta marca?"
        onConfirm={() => {
          onDelete(deleteConfirm.id);
          setDeleteConfirm(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </>
  );
}

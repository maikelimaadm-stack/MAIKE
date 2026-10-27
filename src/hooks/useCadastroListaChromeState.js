import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Estado compartilhado do chrome Base1 em telas lista/detalhe.
 * @param {{ initialViewMode?: 'table'|'record'|'cards' }} [opts]
 */
export function useCadastroListaChromeState({ initialViewMode = "table" } = {}) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filtersActive, setFiltersActive] = useState(false);
  const [resetFiltersKey, setResetFiltersKey] = useState(0);
  const [viewMode, setViewMode] = useState(
    /** @type {'table'|'record'|'cards'} */ (initialViewMode),
  );

  const onSelectionChange = useCallback((ids) => {
    setSelectedIds((prev) => {
      if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) {
        return prev;
      }
      return ids;
    });
  }, []);

  const applySearch = useCallback((next) => {
    setAppliedSearch(typeof next === "string" ? next : searchInput);
  }, [searchInput]);

  const clearFilters = useCallback(() => {
    setResetFiltersKey((k) => k + 1);
  }, []);

  /**
   * @param {'table'|'record'|'cards'} mode
   * @param {{ onOpenRecord?: (id: string) => void; onExitRecord?: () => void }} [options]
   */
  const handleViewModeChange = useCallback((mode, options) => {
    const { onOpenRecord, onExitRecord } = options ?? {};
    if (mode === "record") {
      if (selectedIds.length !== 1) {
        toast.info("Selecione um registro para abrir no modo Registro.");
        return;
      }
      setViewMode("record");
      onOpenRecord?.(selectedIds[0]);
      return;
    }
    if (viewMode === "record" && mode !== "record") {
      onExitRecord?.();
    }
    setViewMode(mode);
  }, [selectedIds, viewMode]);

  const exitRecordView = useCallback(() => {
    setViewMode("table");
  }, []);

  return {
    selectedIds,
    setSelectedIds,
    searchInput,
    setSearchInput,
    appliedSearch,
    applySearch,
    searchActive: Boolean(appliedSearch.trim()),
    filtersActive,
    setFiltersActive,
    resetFiltersKey,
    clearFilters,
    viewMode,
    setViewMode,
    onSelectionChange,
    handleViewModeChange,
    exitRecordView,
  };
}

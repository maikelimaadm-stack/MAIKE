import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * Estado compartilhado do chrome Base1 em telas lista/detalhe.
 */
export function useCadastroListaChromeState() {
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filtersActive, setFiltersActive] = useState(false);
  const [resetFiltersKey, setResetFiltersKey] = useState(0);
  const [viewMode, setViewMode] = useState("table");

  const onSelectionChange = useCallback((ids) => {
    setSelectedIds(ids);
  }, []);

  const applySearch = useCallback((next) => {
    setAppliedSearch(typeof next === "string" ? next : searchInput);
  }, [searchInput]);

  const clearFilters = useCallback(() => {
    setResetFiltersKey((k) => k + 1);
  }, []);

  const handleViewModeChange = useCallback((mode, { onOpenRecord }) => {
    if (mode === "record") {
      if (selectedIds.length !== 1) {
        toast.info("Selecione um registro para abrir no modo Registro.");
        return;
      }
      onOpenRecord?.(selectedIds[0]);
      return;
    }
    setViewMode(mode);
  }, [selectedIds]);

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
  };
}

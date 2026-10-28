import { useCallback, useMemo, useRef, useState } from "react";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroCardsPrefs } from "@/hooks/useCadastroCardsPrefs";
import { useCadastroBase1FullList } from "@/hooks/useCadastroBase1FullList";
import { clearCadastroListaFiltersAndSearch } from "@/lib/cadastroListaClearFilters";
import { prepareCadastroDuplicate } from "@/components/cadastro/base1/cadastroDuplicateHelpers";
import { exportCadastroCsv } from "@/components/cadastro/base1/cadastroExportCsv";

/**
 * Motor Base1 — orquestração para cadastro hierárquico (lista completa, sem keyset falso).
 * Mesma API de superfície que `useCadastroBase1Controller` para `CadastroBase1Screen`.
 *
 * @template {{ id?: string }} T
 * @param {{
 *   storageKey: string,
 *   columnIds: string[],
 *   listEnabled?: boolean,
 *   queryKey: unknown[],
 *   fetchAll: () => Promise<T[]>,
 *   filterRecordNavRows: (items: T[], ctx: { appliedSearch: string, searchPickId: string|null }) => T[],
 *   prepareExportRows: (items: T[], ctx: { appliedSearch: string, searchPickId: string|null }) => T[],
 *   getListFooterMetrics?: (items: T[], ctx: { appliedSearch: string, searchPickId: string|null, matchCount: number }) => {
 *     listados: number,
 *     filtrados: number,
 *     totais: number,
 *   },
 *   duplicateLabelField: string,
 *   exportFileName: string,
 *   exportColumns: object[],
 *   getExportFieldValue: (item: T, colId: string) => string,
 *   getRecordTitle: (item: T|null, isNew: boolean) => string,
 *   getRecordCode: (item: T|null) => string|undefined,
 *   getSearchHaystack: (item: T) => string,
 *   mapSearchSuggestion: (item: T) => { id: string, label: string, secondary?: string },
 *   matchRowId: (item: T, id: string) => boolean,
 *   getRowId: (item: T) => string,
 *   findRowById: (rows: T[], id: string) => T|undefined,
 *   onSubmitRecord: (data: object, editingItem: T|null) => void,
 *   onRequestDeleteMutation: (ids: string[]) => void,
 *   onRevealRowId?: (id: string|null) => void,
 * }} config
 */
export function useCadastroBase1HierarchicalController(config) {
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState(/** @type {T|null} */ (null));
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const configureColumnsAnchorRef = useRef(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [formEpoch, setFormEpoch] = useState(0);
  const [searchPickId, setSearchPickId] = useState(/** @type {string | null} */ (null));
  const [revealRowId, setRevealRowId] = useState(/** @type {string | null} */ (null));
  const recordBeforeNewRef = useRef(/** @type {T|null} */ (null));

  const chrome = useCadastroListaChromeState({
    initialViewMode:
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 639px)").matches
        ? "cards"
        : "table",
  });

  const bumpFormEpoch = () => setFormEpoch((n) => n + 1);

  const cardsPrefs = useCadastroCardsPrefs(config.storageKey, config.columnIds);

  const lista = useCadastroBase1FullList({
    queryKey: config.queryKey,
    enabled: config.listEnabled !== false,
    fetchAll: config.fetchAll,
  });

  const listCtx = useMemo(
    () => ({ appliedSearch: chrome.appliedSearch, searchPickId }),
    [chrome.appliedSearch, searchPickId],
  );

  const recordNavRows = useMemo(
    () => config.filterRecordNavRows(lista.items, listCtx),
    [lista.items, listCtx, config],
  );

  const visibleRows = useMemo(() => recordNavRows, [recordNavRows]);

  const searchMatchCount = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (searchPickId) return 1;
    if (!q) return lista.items.length;
    return lista.items.filter((row) => config.getSearchHaystack(row).toLowerCase().includes(q)).length;
  }, [lista.items, chrome.appliedSearch, searchPickId, config]);

  const revealRow = useCallback(
    (id) => {
      setRevealRowId(id);
      config.onRevealRowId?.(id);
    },
    [config],
  );

  const closeForm = useCallback(() => {
    recordBeforeNewRef.current = null;
    setShowForm(false);
    setIsEditing(false);
    setEditingItem(null);
    chrome.exitRecordView();
  }, [chrome]);

  const cancelForm = useCallback(() => {
    if (isEditing && editingItem?.id) {
      setIsEditing(false);
      return;
    }
    const previous = recordBeforeNewRef.current;
    recordBeforeNewRef.current = null;
    if (previous?.id) {
      bumpFormEpoch();
      setEditingItem(previous);
      setIsEditing(false);
      setShowForm(true);
      chrome.setViewMode("record");
      chrome.onSelectionChange([config.getRowId(previous)]);
      return;
    }
    closeForm();
  }, [isEditing, editingItem, chrome, closeForm, config]);

  const openNew = useCallback(() => {
    bumpFormEpoch();
    recordBeforeNewRef.current = showForm && editingItem?.id ? editingItem : null;
    setEditingItem(null);
    setIsEditing(true);
    setShowForm(true);
    chrome.setViewMode("record");
  }, [showForm, editingItem, chrome]);

  const handleSubmit = useCallback(
    (data) => {
      config.onSubmitRecord(data, editingItem);
    },
    [config, editingItem],
  );

  const searchSuggestions = useMemo(() => {
    const q = chrome.searchInput.trim().toLowerCase();
    if (!q) return [];
    return lista.items
      .filter((row) => config.getSearchHaystack(row).toLowerCase().includes(q))
      .slice(0, 8)
      .map((row) => config.mapSearchSuggestion(row));
  }, [lista.items, chrome.searchInput, config]);

  const matchesSearch = useCallback(
    (item) => {
      if (searchPickId) return config.matchRowId(item, searchPickId);
      const q = chrome.appliedSearch.trim().toLowerCase();
      if (!q) return true;
      return config.getSearchHaystack(item).toLowerCase().includes(q);
    },
    [searchPickId, chrome.appliedSearch, config],
  );

  const handleEdit = useCallback(
    (item) => {
      setEditingItem(item);
      setIsEditing(!item?.id);
      setShowForm(true);
      chrome.setViewMode("record");
      if (item?.id) {
        chrome.onSelectionChange([config.getRowId(item)]);
        revealRow(String(item.id));
      }
    },
    [chrome, config, revealRow],
  );

  const handleSearchApply = useCallback(
    (next) => {
      const texto = typeof next === "string" ? next : chrome.searchInput;
      setSearchPickId(null);
      chrome.applySearch(texto);
      if (!showForm || isEditing) return;
      if (editingItem?.id) {
        chrome.onSelectionChange([config.getRowId(editingItem)]);
      }
    },
    [chrome, showForm, isEditing, editingItem, config],
  );

  const handleSearchSuggestionPick = useCallback(
    (item) => {
      const id = String(item.id);
      setSearchPickId(id);
      revealRow(id);
      chrome.applySearch(item.label || chrome.searchInput);
      chrome.onSelectionChange([id]);
      if (showForm && !isEditing) {
        const row = config.findRowById(lista.items, id);
        if (row) {
          setEditingItem(row);
          setIsEditing(false);
        }
      }
    },
    [chrome, showForm, isEditing, lista.items, config, revealRow],
  );

  const handleClearFilters = useCallback(() => {
    setSearchPickId(null);
    setRevealRowId(null);
    config.onRevealRowId?.(null);
    clearCadastroListaFiltersAndSearch(chrome);
  }, [chrome, config]);

  const handleSearchInputChange = useCallback(
    (v) => {
      setSearchPickId(null);
      chrome.setSearchInput(v);
    },
    [chrome],
  );

  const handleEditSelected = useCallback(() => {
    if (showForm && editingItem?.id && !isEditing) {
      setIsEditing(true);
      return true;
    }
    const selectedId = chrome.selectedIds[0];
    const selected = selectedId
      ? config.findRowById(recordNavRows, String(selectedId))
      : null;
    const item = selected ?? (chrome.selectedIds.length === 0 ? recordNavRows[0] : null);
    if (!item) return false;
    setEditingItem(item);
    setIsEditing(true);
    setShowForm(true);
    chrome.setViewMode("record");
    if (item.id) chrome.onSelectionChange([config.getRowId(item)]);
    return true;
  }, [
    showForm,
    editingItem,
    isEditing,
    chrome.selectedIds,
    chrome.setViewMode,
    chrome.onSelectionChange,
    recordNavRows,
    config,
  ]);

  const handleOpenRecordSelected = useCallback(() => {
    if (showForm && editingItem?.id) {
      setIsEditing(false);
      return true;
    }
    const selectedId = chrome.selectedIds[0];
    const selected = selectedId
      ? config.findRowById(recordNavRows, String(selectedId))
      : null;
    const item = selected ?? (chrome.selectedIds.length === 0 ? recordNavRows[0] : null);
    if (!item) return false;
    handleEdit(item);
    return true;
  }, [showForm, editingItem, chrome.selectedIds, recordNavRows, handleEdit, config]);

  const handleDuplicateSelected = useCallback(() => {
    const item =
      config.findRowById(visibleRows, String(chrome.selectedIds[0])) ||
      (editingItem?.id ? editingItem : null);
    const draft = prepareCadastroDuplicate(item, { labelField: config.duplicateLabelField });
    if (!draft) return;
    bumpFormEpoch();
    recordBeforeNewRef.current =
      showForm && editingItem?.id ? editingItem : item?.id ? item : null;
    setEditingItem(draft);
    setIsEditing(true);
    setShowForm(true);
    chrome.setViewMode("record");
  }, [visibleRows, chrome.selectedIds, editingItem, showForm, chrome, config]);

  const exportCsv = useCallback(() => {
    const rows = config.prepareExportRows(lista.items, listCtx);
    exportCadastroCsv(
      config.exportFileName,
      config.exportColumns,
      rows,
      config.getExportFieldValue,
    );
  }, [config, lista.items, listCtx]);

  const footerMetrics = useMemo(() => {
    if (config.getListFooterMetrics) {
      return config.getListFooterMetrics(lista.items, { ...listCtx, matchCount: searchMatchCount });
    }
    const totais = lista.items.length;
    const filtrados = searchMatchCount;
    return {
      listados: filtrados,
      filtrados,
      totais,
    };
  }, [config, lista.items, listCtx, searchMatchCount]);

  const chromeFooter = {
    pageSize: totaisFooterPageSize(lista.items.length),
    onPageSizeChange: () => {},
    hasMore: false,
    loadingMore: false,
    onLoadMore: () => {},
    listados: footerMetrics.listados,
    filtrados: footerMetrics.filtrados,
    totais: footerMetrics.totais,
  };

  const handleRequestDelete = useCallback((id) => {
    const ids = Array.isArray(id) ? id : [id];
    setDeleteState({ open: true, ids });
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (!chrome.selectedIds.length) return;
    handleRequestDelete(chrome.selectedIds);
  }, [chrome.selectedIds, handleRequestDelete]);

  const handleConfirmDelete = useCallback(() => {
    config.onRequestDeleteMutation(deleteState.ids);
    setDeleteState({ open: false, ids: [] });
  }, [config, deleteState.ids]);

  const onViewModeChange = useCallback(
    (mode) => {
      chrome.handleViewModeChange(mode, {
        onOpenRecord: () => handleOpenRecordSelected(),
        onExitRecord: closeForm,
      });
    },
    [chrome, handleOpenRecordSelected, closeForm],
  );

  const detailTitle = config.getRecordTitle(editingItem, !editingItem?.id);

  const recordIndex = editingItem?.id
    ? Math.max(
        0,
        recordNavRows.findIndex((row) => config.getRowId(row) === config.getRowId(editingItem)),
      )
    : 0;

  const goRecord = useCallback(
    (index) => {
      const row = recordNavRows[index];
      if (row) handleEdit(row);
    },
    [recordNavRows, handleEdit],
  );

  const recordHelpers = useMemo(
    () => ({
      chrome,
      setShowForm,
      setIsEditing,
      setEditingItem,
      recordBeforeNewRef,
      bumpFormEpoch,
      closeForm,
      visibleRows,
      editingItem,
      showForm,
      revealRow,
    }),
    [chrome, visibleRows, editingItem, showForm, closeForm, revealRow],
  );

  return {
    chrome,
    cardsPrefs,
    lista,
    allItems: lista.items,
    visibleRows,
    isLoading: lista.isLoading,
    listaErro: lista.isError,
    listaQueryError: lista.error,
    recarregarLista: lista.refetch,
    listaFetching: lista.isFetching,
    showForm,
    isEditing,
    editingItem,
    setEditingItem,
    setIsEditing,
    setShowForm,
    formEpoch,
    showConfigColunas,
    setShowConfigColunas,
    configureColumnsAnchorRef,
    deleteState,
    setDeleteState,
    searchPickId,
    revealRowId,
    recordHelpers,
    closeForm,
    cancelForm,
    openNew,
    handleSubmit,
    handleEdit,
    handleSearchApply,
    handleSearchSuggestionPick,
    handleClearFilters,
    handleSearchInputChange,
    handleEditSelected,
    handleOpenRecordSelected,
    handleDuplicateSelected,
    exportCsv,
    chromeFooter,
    handleRequestDelete,
    handleDeleteSelected,
    handleConfirmDelete,
    onViewModeChange,
    detailTitle,
    recordIndex,
    recordNavRows,
    goRecord,
    matchesSearch,
    searchSuggestions,
    saving: false,
  };
}

/** Exibe pageSize estável no rodapé sem paginação real (lista já completa). */
function totaisFooterPageSize(total) {
  if (total <= 0) return 100;
  if (total <= 100) return 100;
  if (total <= 250) return 250;
  return 500;
}

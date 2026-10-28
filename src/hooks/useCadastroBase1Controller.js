import { useCallback, useMemo, useRef, useState } from "react";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroListaPagination } from "@/hooks/useCadastroListaPagination";
import { useCadastroCardsPrefs } from "@/hooks/useCadastroCardsPrefs";
import { useCadastroInfiniteList } from "@/hooks/useCadastroInfiniteList";
import { clearCadastroListaFiltersAndSearch } from "@/lib/cadastroListaClearFilters";
import { prepareCadastroDuplicate } from "@/components/cadastro/base1/cadastroDuplicateHelpers";
import { exportCadastroCsv } from "@/components/cadastro/base1/cadastroExportCsv";
import { notifyWarning } from "@/lib/maikeNotify";

/**
 * Motor Base1 — orquestração compartilhada de cadastro lista/registro (D-PROD-55).
 * Domínio entra só por config/callbacks; este hook não importa entidades nem services.
 *
 * @template T extends { id?: string }
 * @param {{
 *   storageKey: string,
 *   columnIds: string[],
 *   listEnabled?: boolean,
 *   queryKey: unknown[],
 *   fetchPage: (args: { limit: number, cursor: string|null }) => Promise<{
 *     items: T[],
 *     next_cursor: string|null,
 *     has_more: boolean,
 *     total: number,
 *     limit: number,
 *   }>,
 *   duplicateLabelField: string,
 *   searchPlaceholder: string,
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
 *   saving?: boolean,
 *   deleteDialog?: {
 *     title: string,
 *     descriptionOne: string,
 *     descriptionMany: (n: number) => string,
 *   },
 *   onRequestDeleteMutation: (ids: string[]) => void,
 * }} config
 */
export function useCadastroBase1Controller(config) {
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState(/** @type {T|null} */ (null));
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const configureColumnsAnchorRef = useRef(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [formEpoch, setFormEpoch] = useState(0);
  const [searchPickId, setSearchPickId] = useState(/** @type {string | null} */ (null));
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

  const qBusca = chrome.appliedSearch;
  const { pageSize, setPageSize } = useCadastroListaPagination(
    config.storageKey,
    `${chrome.resetFiltersKey}:${chrome.appliedSearch}`,
  );

  const cardsPrefs = useCadastroCardsPrefs(config.storageKey, config.columnIds);

  const fetchPageWrapped = useCallback(
    ({ limit, cursor }) =>
      config.fetchPage({ limit, cursor, q: qBusca || undefined }),
    [config.fetchPage, qBusca],
  );

  const lista = useCadastroInfiniteList({
    queryKey: [...config.queryKey, qBusca],
    enabled: config.listEnabled !== false,
    pageSize,
    fetchPage: fetchPageWrapped,
  });

  const visibleRows = useMemo(() => {
    if (!searchPickId) return lista.items;
    return lista.items.filter((row) => config.matchRowId(row, searchPickId));
  }, [lista.items, searchPickId, config]);

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

  const recordNavRows = useMemo(() => visibleRows, [visibleRows]);

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
      return true;
    },
    [searchPickId, config],
  );

  const handleEdit = useCallback(
    (item) => {
      setEditingItem(item);
      setIsEditing(!item?.id);
      setShowForm(true);
      chrome.setViewMode("record");
      if (item?.id) chrome.onSelectionChange([config.getRowId(item)]);
    },
    [chrome, config],
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
      chrome.applySearch(item.label || chrome.searchInput);
      chrome.onSelectionChange([id]);
      if (showForm && !isEditing) {
        const row = config.findRowById(visibleRows, id);
        if (row) {
          setEditingItem(row);
          setIsEditing(false);
        }
      }
    },
    [chrome, showForm, isEditing, visibleRows, config],
  );

  const handleClearFilters = useCallback(() => {
    setSearchPickId(null);
    clearCadastroListaFiltersAndSearch(chrome);
  }, [chrome]);

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
    if (lista.serverHasMore || lista.janelaCheia) {
      notifyWarning(
        "Atenção",
        "Exporta só a janela carregada. Refine a busca para reduzir o conjunto antes de exportar tudo.",
      );
    }
    exportCadastroCsv(
      config.exportFileName,
      config.exportColumns,
      visibleRows,
      config.getExportFieldValue,
    );
  }, [lista.serverHasMore, lista.janelaCheia, config, visibleRows]);

  const chromeFooter = {
    pageSize,
    onPageSizeChange: setPageSize,
    hasMore: lista.hasMore,
    loadingMore: lista.isFetchingNextPage,
    onLoadMore: () => {
      if (lista.janelaCheia) {
        notifyWarning(
          "Atenção",
          "Janela máxima no navegador. Refine a busca para continuar navegando em escala.",
        );
        return;
      }
      lista.loadMore();
    },
    listados: visibleRows.length,
    filtrados: searchPickId ? visibleRows.length : lista.total,
    totais: lista.total,
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

  /** Helpers expostos para callbacks de mutação no adapter */
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
    }),
    [chrome, visibleRows, editingItem, showForm, closeForm],
  );

  return {
    chrome,
    cardsPrefs,
    lista,
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
    saving: Boolean(config.saving),
  };
}

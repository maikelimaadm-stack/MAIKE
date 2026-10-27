import React, { useCallback, useMemo, useState } from "react";
import {
  listarTodasCategorias,
  criarCategoria,
  atualizarCategoria,
  excluirCategorias,
} from "@/services/categoriaProdutoService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import { useCadastroDuplicateAction } from "@/hooks/useCadastroDuplicateAction";
import FormularioCategoriaProduto from "../components/categorias-produto/FormularioCategoriaProduto";
import TabelaCategoriasProduto, {
  CATEGORIAS_PRODUTO_COLUNAS,
  getCategoriaProdutoFieldValue,
} from "../components/categorias-produto/TabelaCategoriasProduto";
import { exportCadastroCsv } from "@/components/cadastro/base1/cadastroExportCsv";

const EMPTY_CATEGORIAS = Object.freeze([]);

export default function Categorias() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const chrome = useCadastroListaChromeState();
  const listBindings = useCadastroPageListBindings({
    storageKey: "colunas_categorias_produto",
    columns: CATEGORIAS_PRODUTO_COLUNAS,
    chrome,
  });

  const handleDuplicateSelected = useCadastroDuplicateAction({
    chrome,
    findById: (id) => categorias.find((row) => row.id === id),
    openDraft: (draft) => {
      setEditingItem(draft);
      setShowForm(true);
    },
    labelField: "nome",
  });
  const queryClient = useQueryClient();

  const { data: categoriasData } = useQuery({
    queryKey: ["categorias_produto"],
    queryFn: () => listarTodasCategorias(),
  });
  const categorias = categoriasData ?? EMPTY_CATEGORIAS;

  const createMutation = useMutation({
    mutationFn: (data) => criarCategoria(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias_produto"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Categoria criada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível concluir a operação.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => atualizarCategoria(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias_produto"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Categoria atualizada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível concluir a operação.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (/** @type {string[]} */ ids) => excluirCategorias(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias_produto"] });
      chrome.setSelectedIds([]);
      toast.success("Categoria(s) excluída(s)!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Erro ao excluir")),
  });

  const closeForm = () => {
    setShowForm(false);
    setEditingItem(null);
    chrome.exitRecordView();
  };

  const openNew = () => {
    setEditingItem(null);
    setShowForm(true);
    chrome.setViewMode("record");
  };

  const handleSubmit = (data) => {
    if (editingItem?.id) updateMutation.mutate({ id: editingItem.id, data });
    else createMutation.mutate(data);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
    chrome.setViewMode("record");
    if (item?.id) chrome.onSelectionChange([item.id]);
  };

  const handleEditSelected = () => {
    const item = categorias.find((c) => c.id === chrome.selectedIds[0]);
    if (item) handleEdit(item);
  };

  const handleRequestDelete = (id) => {
    const ids = Array.isArray(id) ? id : [id];
    setDeleteState({ open: true, ids });
  };

  const handleDeleteSelected = () => {
    if (!chrome.selectedIds.length) return;
    handleRequestDelete(chrome.selectedIds);
  };

  const handleConfirmDelete = () => {
    deleteMutation.mutate(deleteState.ids);
    setDeleteState({ open: false, ids: [] });
  };

  const onViewModeChange = useCallback(
    (mode) => {
      chrome.handleViewModeChange(mode, {
        onOpenRecord: () => handleEditSelected(),
        onExitRecord: closeForm,
      });
    },
    [chrome, handleEditSelected, closeForm],
  );

  const filtradosCount = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return categorias.length;
    return categorias.filter((c) => {
      const hay = [c.nome, c.descricao].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [categorias, chrome.appliedSearch]);

  const detailTitle = editingItem?.id ? editingItem.nome || "Categoria" : "Nova categoria";

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return categorias;
    return categorias.filter((c) => {
      const hay = [c.nome, c.descricao].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [categorias, chrome.appliedSearch]);

  const recordIndex = editingItem?.id
    ? Math.max(0, recordNavRows.findIndex((c) => c.id === editingItem.id))
    : 0;

  const goRecord = (index) => {
    const row = recordNavRows[index];
    if (row) handleEdit(row);
  };

  return (
    <>
      <CadastroWorkspace
        mode="list"
        title="Categorias de produtos"
        subtitle="Cadastro global de categorias usadas em produtos."
        toolbar={null}
      >
        <CadastroListaChrome
          recordMode={showForm}
          secondaryToolsLocked={showForm}
          recordHeader={
            showForm ? (
              <CadastroRecordHeader
                title={detailTitle}
                index={recordIndex}
                total={recordNavRows.length}
                onGo={editingItem?.id ? goRecord : undefined}
                navDisabled={!editingItem?.id}
              />
            ) : null
          }
          recordBody={
            showForm ? (
              <FormularioCategoriaProduto
                variant="embedded"
                initialData={editingItem}
                onSubmit={handleSubmit}
                onCancel={closeForm}
                categoriasExistentes={categorias}
              />
            ) : null
          }
          selectedCount={chrome.selectedIds.length}
          {...listBindings.listFooter.chromeFooter}
          onNew={openNew}
          onEdit={handleEditSelected}
          onDelete={handleDeleteSelected}
          onDuplicate={handleDuplicateSelected}
          onPrint={() => window.print()}
          cardsModeAvailable
          cardsToolbar={listBindings.cardsToolbar}
          searchValue={chrome.searchInput}
          onSearchChange={chrome.setSearchInput}
          onSearchApply={chrome.applySearch}
          searchActive={chrome.searchActive}
          searchPlaceholder="Buscar categorias…"
          onConfigureColumns={() => setShowConfigColunas(true)}
          onExportCsv={() =>
            exportCadastroCsv(
              "categorias-produto.csv",
              CATEGORIAS_PRODUTO_COLUNAS,
              categorias,
              getCategoriaProdutoFieldValue,
            )
          }
          onClearFilters={chrome.clearFilters}
          filtersActive={chrome.filtersActive}
          viewMode={showForm ? "record" : chrome.viewMode}
          onViewModeChange={onViewModeChange}
        >
          {!showForm ? (
            <TabelaCategoriasProduto
              categorias={categorias}
              onEdit={handleEdit}
              onDelete={handleRequestDelete}
              showConfigColunas={showConfigColunas}
              setShowConfigColunas={setShowConfigColunas}
              searchQuery={chrome.appliedSearch}
              resetFiltersKey={chrome.resetFiltersKey}
              onSelectionChange={chrome.onSelectionChange}
              onFiltersActiveChange={chrome.setFiltersActive}
              viewMode={chrome.viewMode === "cards" ? "cards" : "table"}
              displayLimit={listBindings.listFooter.gradePaging.displayLimit}
              onListMetrics={listBindings.listFooter.gradePaging.onListMetrics}
              cardFields={listBindings.cardsPrefs.cardFields}
              cardsPerRow={listBindings.cardsPrefs.cardsPerRow}
            />
          ) : null}
        </CadastroListaChrome>
      </CadastroWorkspace>

      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Confirmar exclusão"
        description={
          deleteState.ids.length > 1
            ? `Deseja excluir ${deleteState.ids.length} categorias selecionadas?`
            : "Deseja excluir esta categoria?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

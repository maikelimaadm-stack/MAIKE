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
import { AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import FormularioCategoriaProduto from "../components/categorias-produto/FormularioCategoriaProduto";
import TabelaCategoriasProduto from "../components/categorias-produto/TabelaCategoriasProduto";

export default function Categorias() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const chrome = useCadastroListaChromeState();
  const queryClient = useQueryClient();

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias_produto"],
    queryFn: () => listarTodasCategorias(),
  });

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
    chrome.setViewMode("table");
  };

  const openNew = () => {
    setEditingItem(null);
    setShowForm(true);
  };

  const handleSubmit = (data) => {
    if (editingItem?.id) updateMutation.mutate({ id: editingItem.id, data });
    else createMutation.mutate(data);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
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

  const onViewModeChange = useCallback((mode) => {
    chrome.handleViewModeChange(mode, {
      onOpenRecord: () => handleEditSelected(),
    });
  }, [chrome, handleEditSelected]);

  const filtradosCount = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return categorias.length;
    return categorias.filter((c) => {
      const hay = [c.nome, c.descricao].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [categorias, chrome.appliedSearch]);

  const detailTitle = editingItem?.id ? "Editar categoria" : "Nova categoria";

  return (
    <>
      <CadastroWorkspace
        mode={showForm ? "detail" : "list"}
        title={showForm ? detailTitle : "Categorias de produtos"}
        subtitle={
          showForm
            ? "Hierarquia e descrição; salve para voltar à lista."
            : "Cadastro global de categorias usadas em produtos."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={null}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <FormularioCategoriaProduto
              key="form"
              variant="embedded"
              initialData={editingItem}
              onSubmit={handleSubmit}
              onCancel={closeForm}
              categoriasExistentes={categorias}
            />
          ) : (
            <CadastroListaChrome
              key="chrome"
              selectedCount={chrome.selectedIds.length}
              listados={categorias.length}
              filtrados={filtradosCount}
              totais={categorias.length}
              onNew={openNew}
              onEdit={handleEditSelected}
              onDelete={handleDeleteSelected}
              searchValue={chrome.searchInput}
              onSearchChange={chrome.setSearchInput}
              onSearchApply={chrome.applySearch}
              searchActive={chrome.searchActive}
              searchPlaceholder="Buscar categorias…"
              onConfigureColumns={() => setShowConfigColunas(true)}
              onClearFilters={chrome.clearFilters}
              filtersActive={chrome.filtersActive}
              viewMode={chrome.viewMode}
              onViewModeChange={onViewModeChange}
            >
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
              />
            </CadastroListaChrome>
          )}
        </AnimatePresence>
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

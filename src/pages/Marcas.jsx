import React, { useCallback, useMemo, useState } from "react";
import { listarMarcasDaEmpresa, criarMarca, atualizarMarca, excluirMarcas } from "@/services/marcaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import FormularioMarca from "@/components/marcas/FormularioMarca";
import TabelaMarcas from "@/components/marcas/TabelaMarcas";
import { MARCAS_COLUNAS, getMarcaFieldValue } from "@/components/marcas/TabelaMarcas";
import { exportCadastroCsv } from "@/components/cadastro/base1/cadastroExportCsv";

export default function Marcas() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const chrome = useCadastroListaChromeState();
  const queryClient = useQueryClient();
  const empresaId = localStorage.getItem("empresa_selecionada_id");

  const { data: marcas = [], isLoading } = useQuery({
    queryKey: ["marcas", empresaId],
    queryFn: () => listarMarcasDaEmpresa(empresaId),
    enabled: !!empresaId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => criarMarca({ dados: data, empresaId, marcasDaEmpresa: marcas }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Marca criada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar a marca.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string; data: object }} vars */
    mutationFn: ({ id, data }) => atualizarMarca(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Marca atualizada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar a marca.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => excluirMarcas(ids),
    onSuccess: ({ excluidas, falhas }) => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      chrome.setSelectedIds([]);
      if (excluidas.length) {
        toast.success(
          excluidas.length === 1 ? "Marca excluída!" : `${excluidas.length} marcas excluídas!`,
        );
      }
      if (falhas.length) {
        toast.error(
          falhas.length === 1 ? "1 marca não pôde ser excluída." : `${falhas.length} marcas não puderam ser excluídas.`,
        );
      }
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível excluir.")),
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
    const item = marcas.find((m) => m.id === chrome.selectedIds[0]);
    if (item) handleEdit(item);
  };

  const handleDuplicateSelected = () => {
    const item = marcas.find((m) => m.id === chrome.selectedIds[0]);
    if (!item) return;
    setEditingItem({
      ...item,
      id: undefined,
      nome: item.nome ? `${item.nome} (cópia)` : "",
    });
    setShowForm(true);
  };

  const exportCsv = () =>
    exportCadastroCsv("marcas.csv", MARCAS_COLUNAS, marcas, getMarcaFieldValue);

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
      chrome.handleViewModeChange(mode, { onOpenRecord: () => handleEditSelected() });
    },
    [chrome, handleEditSelected]
  );

  const filtradosCount = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return marcas.length;
    return marcas.filter((m) => {
      const hay = [m.nome, m.descricao, m.numero_marca].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [marcas, chrome.appliedSearch]);

  const detailTitle = editingItem?.id ? "Editar marca" : "Nova marca";

  return (
    <>
      <CadastroWorkspace
        mode={showForm ? "detail" : "list"}
        title={showForm ? detailTitle : "Marcas"}
        subtitle={
          showForm
            ? "Preencha os dados e salve para voltar à lista."
            : "Marcas de produto vinculadas à empresa selecionada."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={null}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <FormularioMarca
              key="form"
              variant="embedded"
              initialData={editingItem}
              onSubmit={handleSubmit}
              onCancel={closeForm}
            />
          ) : (
            <CadastroListaChrome
              key="chrome"
              selectedCount={chrome.selectedIds.length}
              listados={marcas.length}
              filtrados={filtradosCount}
              totais={marcas.length}
              createLabel="Novo"
              onNew={openNew}
              onEdit={handleEditSelected}
              onDuplicate={handleDuplicateSelected}
              onDelete={handleDeleteSelected}
              onExportCsv={exportCsv}
              searchValue={chrome.searchInput}
              onSearchChange={chrome.setSearchInput}
              onSearchApply={chrome.applySearch}
              searchActive={chrome.searchActive}
              searchPlaceholder="Buscar marcas…"
              onConfigureColumns={() => setShowConfigColunas(true)}
              onClearFilters={chrome.clearFilters}
              filtersActive={chrome.filtersActive}
              viewMode={chrome.viewMode}
              onViewModeChange={onViewModeChange}
            >
              <TabelaMarcas
                marcas={marcas}
                onEdit={handleEdit}
                onDelete={handleRequestDelete}
                isLoading={isLoading}
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
            ? `Deseja excluir ${deleteState.ids.length} marcas?`
            : "Deseja excluir esta marca?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

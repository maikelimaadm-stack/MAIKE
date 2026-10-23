import React, { useCallback, useMemo, useState } from "react";
import { listarMarcasDaEmpresa, criarMarca, atualizarMarca, excluirMarcas } from "@/services/marcaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import FormularioMarca from "@/components/marcas/FormularioMarca";
import TabelaMarcas from "@/components/marcas/TabelaMarcas";

export default function Marcas() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filtersActive, setFiltersActive] = useState(false);
  const [resetFiltersKey, setResetFiltersKey] = useState(0);
  const [viewMode, setViewMode] = useState("table");
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
      setSelectedIds([]);
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
    setViewMode("table");
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
    const id = selectedIds[0];
    const item = marcas.find((m) => m.id === id);
    if (item) handleEdit(item);
  };

  const handleRequestDelete = (id) => {
    const ids = Array.isArray(id) ? id : [id];
    setDeleteState({ open: true, ids });
  };

  const handleDeleteSelected = () => {
    if (!selectedIds.length) return;
    handleRequestDelete(selectedIds);
  };

  const handleConfirmDelete = () => {
    deleteMutation.mutate(deleteState.ids);
    setDeleteState({ open: false, ids: [] });
  };

  const handleSelectionChange = useCallback((ids) => {
    setSelectedIds(ids);
  }, []);

  const handleViewModeChange = (mode) => {
    if (mode === "record") {
      if (selectedIds.length !== 1) {
        toast.info("Selecione um registro para abrir no modo Registro.");
        return;
      }
      handleEditSelected();
      return;
    }
    setViewMode(mode);
  };

  const filtradosCount = useMemo(() => {
    const q = appliedSearch.trim().toLowerCase();
    if (!q) return marcas.length;
    return marcas.filter((m) => {
      const hay = [m.nome, m.descricao, m.numero_marca].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [marcas, appliedSearch]);

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
              selectedCount={selectedIds.length}
              listados={marcas.length}
              filtrados={filtradosCount}
              totais={marcas.length}
              createLabel="Novo"
              onNew={openNew}
              onEdit={handleEditSelected}
              onDelete={handleDeleteSelected}
              searchValue={searchInput}
              onSearchChange={setSearchInput}
              onSearchApply={(next) => setAppliedSearch(typeof next === "string" ? next : searchInput)}
              searchActive={Boolean(appliedSearch.trim())}
              searchPlaceholder="Buscar marcas…"
              onConfigureColumns={() => setShowConfigColunas(true)}
              onClearFilters={() => setResetFiltersKey((k) => k + 1)}
              filtersActive={filtersActive}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
            >
              <TabelaMarcas
                marcas={marcas}
                onEdit={handleEdit}
                onDelete={handleRequestDelete}
                isLoading={isLoading}
                showConfigColunas={showConfigColunas}
                setShowConfigColunas={setShowConfigColunas}
                searchQuery={appliedSearch}
                resetFiltersKey={resetFiltersKey}
                onSelectionChange={handleSelectionChange}
                onFiltersActiveChange={setFiltersActive}
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

import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import FormularioEmpresa from "../components/empresa/FormularioEmpresa";
import TabelaEmpresas from "../components/empresa/TabelaEmpresas";
import * as empresaService from "@/services/empresaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";

export default function Empresa() {
  const [showForm, setShowForm] = useState(false);
  const [editingEmpresa, setEditingEmpresa] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const chrome = useCadastroListaChromeState();
  const queryClient = useQueryClient();

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => empresaService.listEmpresas(),
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => empresaService.createEmpresa(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresas"] });
      setShowForm(false);
      setEditingEmpresa(null);
      toast.success("Empresa cadastrada!");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Erro.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => empresaService.updateEmpresa(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresas"] });
      setShowForm(false);
      setEditingEmpresa(null);
      toast.success("Empresa atualizada!");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Erro.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => empresaService.deleteEmpresa(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["empresas"] });
      chrome.setSelectedIds([]);
      toast.success("Empresa excluída!");
    },
    onError: () => toast.error("Erro."),
  });

  const closeForm = () => {
    setShowForm(false);
    setEditingEmpresa(null);
    chrome.setViewMode("table");
  };

  const openNew = () => {
    setEditingEmpresa(null);
    setShowForm(true);
  };

  const handleSubmit = (data) => {
    if (editingEmpresa?.id) updateMutation.mutate({ id: editingEmpresa.id, data });
    else createMutation.mutate(data);
  };

  const handleEdit = (empresa) => {
    setEditingEmpresa(empresa);
    setShowForm(true);
  };

  const handleEditSelected = () => {
    const item = empresas.find((e) => e.id === chrome.selectedIds[0]);
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

  const handleConfirmDelete = async () => {
    for (const id of deleteState.ids) {
      try {
        await deleteMutation.mutateAsync(id);
      } catch {
        /* toast no onError */
      }
    }
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
    if (!q) return empresas.length;
    return empresas.filter((e) => {
      const hay = [e.nome, e.apelido, e.cidade, e.cpf, e.cnpj, e.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    }).length;
  }, [empresas, chrome.appliedSearch]);

  const detailTitle = editingEmpresa?.id ? "Editar empresa" : "Nova empresa";

  return (
    <>
      <CadastroWorkspace
        mode={showForm ? "detail" : "list"}
        title={showForm ? detailTitle : "Empresas"}
        subtitle={
          showForm
            ? "Preencha os dados e salve para voltar à lista."
            : "Cadastro de empresas (fazendas) vinculadas ao tenant."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={null}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <FormularioEmpresa
              key="form"
              variant="embedded"
              onSubmit={handleSubmit}
              onCancel={closeForm}
              initialData={editingEmpresa}
              isEditing={!!editingEmpresa}
            />
          ) : (
            <CadastroListaChrome
              key="chrome"
              selectedCount={chrome.selectedIds.length}
              listados={empresas.length}
              filtrados={filtradosCount}
              totais={empresas.length}
              createLabel="Novo"
              onNew={openNew}
              onEdit={handleEditSelected}
              onDelete={handleDeleteSelected}
              searchValue={chrome.searchInput}
              onSearchChange={chrome.setSearchInput}
              onSearchApply={chrome.applySearch}
              searchActive={chrome.searchActive}
              searchPlaceholder="Buscar empresas…"
              onConfigureColumns={() => setShowConfigColunas(true)}
              onClearFilters={chrome.clearFilters}
              filtersActive={chrome.filtersActive}
              viewMode={chrome.viewMode}
              onViewModeChange={onViewModeChange}
            >
              <TabelaEmpresas
                empresas={empresas}
                onEdit={handleEdit}
                onDelete={(id) => handleRequestDelete(id)}
                isLoading={isLoading}
                chromeLayout
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
            ? `Deseja excluir ${deleteState.ids.length} empresas?`
            : "Deseja excluir esta empresa?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

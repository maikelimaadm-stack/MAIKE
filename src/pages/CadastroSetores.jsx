import React, { useCallback, useMemo, useState } from "react";
import {
  listarSetoresDaEmpresa,
  criarSetor,
  atualizarSetor,
  excluirSetor,
} from "@/services/setorService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import TabelaSetores from "@/components/setores/TabelaSetores";
import FormularioSetor from "@/components/setores/FormularioSetor";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { useCadastroListaChromeState, countSearchFiltered } from "@/hooks/useCadastroListaChromeState";
import { AnimatePresence } from "framer-motion";

const getInitialFormData = () => ({
  nome: "",
  sigla: "",
  tipo: "Próprio",
  responsavel: "",
  telefone: "",
  endereco: "",
  cidade: "",
  estado: "",
  area_total: "",
  capacidade_animais: "",
  observacoes: "",
  ativo: true,
});

export default function CadastroSetores() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [editando, setEditando] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const chrome = useCadastroListaChromeState();

  const { data: setores = [], isLoading } = useQuery({
    queryKey: ["setores", empresaSelecionadaId],
    queryFn: async () => listarSetoresDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => criarSetor(data, { empresaId: empresaSelecionadaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores", empresaSelecionadaId] });
      toast.success("Setor cadastrado com sucesso!");
      setShowForm(false);
      setEditando(null);
    },
    onError: () => toast.error("Erro ao cadastrar setor"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarSetor(id, data, { registroAnterior: oldData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores", empresaSelecionadaId] });
      toast.success("Setor atualizado!");
      setShowForm(false);
      setEditando(null);
    },
    onError: () => toast.error("Erro ao atualizar setor"),
  });

  const deleteMutation = useMutation({
    /** @param {string} id */
    mutationFn: (id) => excluirSetor(id),
    onError: (error) => {
      setDeleteState({ open: false, ids: [] });
      toast.error(getApiErrorMessage(error, "Erro ao excluir setor"));
    },
  });

  const closeForm = () => {
    setShowForm(false);
    setEditando(null);
    chrome.setViewMode("table");
  };

  const openNew = () => {
    setEditando(null);
    setShowForm(true);
  };

  const handleEdit = (setor) => {
    setEditando({
      ...getInitialFormData(),
      ...setor,
      area_total: setor.area_total || "",
      capacidade_animais: setor.capacidade_animais || "",
    });
    setShowForm(true);
  };

  const handleEditSelected = useCallback(() => {
    const item = setores.find((s) => s.id === chrome.selectedIds[0]);
    if (item) handleEdit(item);
  }, [setores, chrome.selectedIds]);

  const handleRequestDelete = (id) => {
    const ids = Array.isArray(id) ? id : [id];
    setDeleteState({ open: true, ids });
  };

  const handleDeleteSelected = () => {
    if (!chrome.selectedIds.length) return;
    handleRequestDelete(chrome.selectedIds);
  };

  const handleConfirmDelete = () => {
    const [firstId] = deleteState.ids;
    if (firstId) deleteMutation.mutate(firstId);
    setDeleteState({ open: false, ids: [] });
    chrome.setSelectedIds([]);
  };

  const handleSubmit = (data) => {
    if (editando) {
      updateMutation.mutate({ id: editando.id, data, oldData: editando });
      return;
    }
    createMutation.mutate(data);
  };

  const onViewModeChange = useCallback((mode) => {
    chrome.handleViewModeChange(mode, { onOpenRecord: () => handleEditSelected() });
  }, [chrome, handleEditSelected]);

  const filtradosCount = useMemo(
    () =>
      countSearchFiltered(setores, chrome.appliedSearch, (s) => [
        s.nome,
        s.sigla,
        s.cidade,
        s.responsavel,
      ]),
    [setores, chrome.appliedSearch],
  );

  const detailTitle = editando?.id ? "Editar setor / fazenda" : "Novo setor / fazenda";

  return (
    <>
      <CadastroWorkspace
        mode={showForm ? "detail" : "list"}
        title={showForm ? detailTitle : "Setores / fazendas"}
        subtitle={
          showForm
            ? "Preencha os dados e salve para voltar à lista."
            : "Setores vinculados à empresa selecionada."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={null}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <FormularioSetor
              key="form"
              variant="embedded"
              initialData={editando || getInitialFormData()}
              isEditing={!!editando}
              onSubmit={handleSubmit}
              onCancel={closeForm}
            />
          ) : (
            <CadastroListaChrome
              key="chrome"
              selectedCount={chrome.selectedIds.length}
              listados={setores.length}
              filtrados={filtradosCount}
              totais={setores.length}
              onNew={openNew}
              onEdit={handleEditSelected}
              onDelete={handleDeleteSelected}
              searchValue={chrome.searchInput}
              onSearchChange={chrome.setSearchInput}
              onSearchApply={chrome.applySearch}
              searchActive={chrome.searchActive}
              searchPlaceholder="Buscar setores…"
              onConfigureColumns={() => setShowConfigColunas(true)}
              onClearFilters={chrome.clearFilters}
              filtersActive={chrome.filtersActive}
              viewMode={chrome.viewMode}
              onViewModeChange={onViewModeChange}
            >
              <TabelaSetores
                setores={setores}
                isLoading={isLoading}
                onEdit={handleEdit}
                onDelete={(id) => handleRequestDelete(id)}
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
        title="Exclusão indisponível"
        description={
          deleteState.ids.length > 1
            ? `A exclusão de ${deleteState.ids.length} setores está indisponível enquanto o cadastro é migrado para o sistema próprio.`
            : "A exclusão de setores está indisponível enquanto o cadastro é migrado para o sistema próprio. As áreas, tarefas e movimentações que apontam para o setor ainda vivem na plataforma antiga, e apagá-lo agora deixaria esses vínculos apontando para o vazio."
        }
        onConfirm={handleConfirmDelete}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </>
  );
}

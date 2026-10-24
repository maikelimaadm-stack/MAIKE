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
import TabelaSetores, { SETORES_COLUNAS, getSetorFieldValue } from "@/components/setores/TabelaSetores";
import { exportCadastroCsv } from "@/components/cadastro/base1/cadastroExportCsv";
import FormularioSetor from "@/components/setores/FormularioSetor";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import { useCadastroDuplicateAction } from "@/hooks/useCadastroDuplicateAction";

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
  const listBindings = useCadastroPageListBindings({ storageKey: "colunas_largura_setores", columns: SETORES_COLUNAS, chrome });

  const handleDuplicateSelected = useCadastroDuplicateAction({
    chrome,
    findById: (id) => setores.find((row) => row.id === id),
    openDraft: (draft) => {
      setEditando(draft);
      setShowForm(true);
    },
    labelField: "nome",
  });

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
    chrome.exitRecordView();
  };

  const openNew = () => {
    setEditando(null);
    setShowForm(true);
    chrome.setViewMode("record");
  };

  const handleEdit = (setor) => {
    setEditando({
      ...getInitialFormData(),
      ...setor,
      area_total: setor.area_total || "",
      capacidade_animais: setor.capacidade_animais || "",
    });
    setShowForm(true);
    chrome.setViewMode("record");
    if (setor?.id) chrome.onSelectionChange([setor.id]);
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
    if (!q) return setores.length;
    return setores.filter((s) => {
      const hay = [s.nome, s.sigla, s.cidade, s.responsavel].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [setores, chrome.appliedSearch]);

  const detailTitle = editando?.id ? editando.nome || "Setor" : "Novo setor / fazenda";

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return setores;
    return setores.filter((s) => {
      const hay = [s.nome, s.sigla, s.cidade, s.responsavel].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [setores, chrome.appliedSearch]);

  const recordIndex = editando?.id
    ? Math.max(0, recordNavRows.findIndex((s) => s.id === editando.id))
    : 0;

  const goRecord = (index) => {
    const row = recordNavRows[index];
    if (row) handleEdit(row);
  };

  return (
    <>
      <CadastroWorkspace
        mode="list"
        title="Setores / fazendas"
        subtitle="Setores vinculados à empresa selecionada."
        toolbar={null}
      >
        <CadastroListaChrome
          recordMode={showForm}
          secondaryToolsLocked={showForm}
          recordHeader={
            showForm ? (
              <CadastroRecordHeader
                title={detailTitle}
                code={editando?.sigla ? String(editando.sigla) : undefined}
                index={recordIndex}
                total={recordNavRows.length}
                onGo={editando?.id ? goRecord : undefined}
                navDisabled={!editando?.id}
              />
            ) : null
          }
          recordBody={
            showForm ? (
              <FormularioSetor
                variant="embedded"
                initialData={editando || getInitialFormData()}
                isEditing={!!editando}
                onSubmit={handleSubmit}
                onCancel={closeForm}
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
          searchPlaceholder="Buscar setores…"
          onConfigureColumns={() => setShowConfigColunas(true)}
          onExportCsv={() => exportCadastroCsv("setores.csv", SETORES_COLUNAS, setores, getSetorFieldValue)}
          onClearFilters={chrome.clearFilters}
          filtersActive={chrome.filtersActive}
          viewMode={showForm ? "record" : chrome.viewMode}
          onViewModeChange={onViewModeChange}
        >
          {!showForm ? (
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

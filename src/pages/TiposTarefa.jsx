import React, { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import TabelaTiposTarefa, { TIPOS_TAREFA_COLUNAS } from "@/components/tipos-tarefa/TabelaTiposTarefa";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import FormularioTipoTarefa from "@/components/tipos-tarefa/FormularioTipoTarefa";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import { useCadastroDuplicateAction } from "@/hooks/useCadastroDuplicateAction";
import { listarGruposSimples, listarTipos, criarTipo, atualizarTipo, excluirTipos } from "@/services/tarefaCadastroService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";

export default function TiposTarefa() {
  const [showForm, setShowForm] = useState(false);
  const [editingTipo, setEditingTipo] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const queryClient = useQueryClient();
  const chrome = useCadastroListaChromeState();
  const listBindings = useCadastroPageListBindings({
    storageKey: "colunas_largura_tipos_tarefa",
    columns: TIPOS_TAREFA_COLUNAS,
    chrome,
  });

  const handleDuplicateSelected = useCadastroDuplicateAction({
    chrome,
    findById: (id) => tipos.find((row) => row.id === id),
    openDraft: (draft) => {
      setEditingTipo(draft);
      setShowForm(true);
    },
    labelField: "nome_tipo",
  });

  const { data: grupos = [] } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => listarGruposSimples(),
    initialData: [],
  });

  const { data: tipos = [] } = useQuery({
    queryKey: ["tipos-tarefa"],
    queryFn: () => listarTipos(),
    initialData: [],
  });

  const createTipoMutation = useMutation({
    mutationFn: (data) => criarTipo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      setShowForm(false);
      setEditingTipo(null);
      toast.success("Tipo cadastrado!");
    },
  });

  const updateTipoMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarTipo({ id, dados: data, oldData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      setShowForm(false);
      setEditingTipo(null);
      toast.success("Tipo atualizado!");
    },
  });

  const closeForm = () => {
    setShowForm(false);
    setEditingTipo(null);
    chrome.exitRecordView();
  };

  const openNew = () => {
    setEditingTipo(null);
    setShowForm(true);
    chrome.setViewMode("record");
  };

  const handleSubmit = (data) => {
    if (editingTipo) updateTipoMutation.mutate({ id: editingTipo.id, data, oldData: editingTipo });
    else createTipoMutation.mutate(data);
  };

  const handleEdit = (tipo) => {
    setEditingTipo(tipo);
    setShowForm(true);
    chrome.setViewMode("record");
    if (tipo?.id) chrome.onSelectionChange([tipo.id]);
  };

  const handleEditSelected = () => {
    const item = tipos.find((t) => t.id === chrome.selectedIds[0]);
    if (item) handleEdit(item);
  };

  const handleRequestDelete = (ids) => {
    setDeleteState({ open: true, ids: Array.isArray(ids) ? ids : [ids] });
  };

  const handleDeleteSelected = () => {
    if (!chrome.selectedIds.length) return;
    handleRequestDelete(chrome.selectedIds);
  };

  const handleConfirmDelete = async () => {
    const ids = deleteState.ids;
    setDeleteState({ open: false, ids: [] });

    try {
      const { excluidos, bloqueados } = await excluirTipos(ids, { tipos });

      if (excluidos.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
        chrome.setSelectedIds([]);
        toast.success(excluidos.length === 1 ? "Tipo excluído!" : `${excluidos.length} tipos excluídos!`);
      }
      if (bloqueados.length > 0) {
        toast.error(
          bloqueados.length === 1
            ? "1 tipo não pôde ser excluído: existem registros vinculados."
            : `${bloqueados.length} tipos não puderam ser excluídos: existem registros vinculados.`
        );
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível excluir."));
    }
  };

  const handleExport = () => {
    const csv = [
      ["Tipo", "Grupo", "Ativo", "Descrição", "Criado em", "Atualizado em"].join(";"),
      ...tipos.map((t) =>
        [
          t.nome_tipo || "",
          t.grupo_atividade_nome || grupos.find((g) => g.id === t.grupo_atividade_id)?.nome_grupo || "",
          t.ativo ? "SIM" : "NÃO",
          t.descricao || "",
          t.created_date || "",
          t.updated_date || "",
        ].join(";")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `tipos_tarefa_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast.success("Exportado!");
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
    if (!q) return tipos.length;
    return tipos.filter((t) => {
      const grupoNome = t.grupo_atividade_nome || grupos.find((g) => g.id === t.grupo_atividade_id)?.nome_grupo || "";
      const hay = [t.nome_tipo, grupoNome, t.descricao].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [tipos, grupos, chrome.appliedSearch]);

  const detailTitle = editingTipo?.id ? editingTipo.nome_tipo || "Tipo" : "Novo tipo de tarefa";

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return tipos;
    return tipos.filter((t) => {
      const grupoNome = t.grupo_atividade_nome || grupos.find((g) => g.id === t.grupo_atividade_id)?.nome_grupo || "";
      const hay = [t.nome_tipo, grupoNome, t.descricao].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [tipos, grupos, chrome.appliedSearch]);

  const recordIndex = editingTipo?.id
    ? Math.max(0, recordNavRows.findIndex((t) => t.id === editingTipo.id))
    : 0;

  const goRecord = (index) => {
    const row = recordNavRows[index];
    if (row) handleEdit(row);
  };

  const extraToolbar = (
    <button type="button" className="tb-btn tb-btn-gray" onClick={handleExport}>
      <Download aria-hidden />
      Exportar
    </button>
  );

  return (
    <>
      <CadastroWorkspace
        mode="list"
        title="Tipos de tarefa"
        subtitle="Tipos usados em tarefas do mapa, vinculados a grupos de atividade."
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
                onGo={editingTipo?.id ? goRecord : undefined}
                navDisabled={!editingTipo?.id}
              />
            ) : null
          }
          recordBody={
            showForm ? (
              <FormularioTipoTarefa
                variant="embedded"
                initialData={editingTipo}
                grupos={grupos}
                isEditing={!!editingTipo}
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
          searchPlaceholder="Buscar tipos…"
          onConfigureColumns={() => setShowConfigColunas(true)}
          onExportCsv={handleExport}
          onClearFilters={chrome.clearFilters}
          filtersActive={chrome.filtersActive}
          viewMode={showForm ? "record" : chrome.viewMode}
          onViewModeChange={onViewModeChange}
          extraToolbar={extraToolbar}
        >
          {!showForm ? (
            <TabelaTiposTarefa
              tipos={tipos}
              grupos={grupos}
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
            ? `Deseja realmente excluir ${deleteState.ids.length} tipos selecionados?`
            : "Deseja realmente excluir este tipo de tarefa?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

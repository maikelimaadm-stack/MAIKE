import React, { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import TabelaTiposTarefa from "@/components/tipos-tarefa/TabelaTiposTarefa";
import FormularioTipoTarefa from "@/components/tipos-tarefa/FormularioTipoTarefa";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { listarGruposSimples, listarTipos, criarTipo, atualizarTipo, excluirTipos } from "@/services/tarefaCadastroService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";

export default function TiposTarefa() {
  const [showForm, setShowForm] = useState(false);
  const [editingTipo, setEditingTipo] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const queryClient = useQueryClient();
  const chrome = useCadastroListaChromeState();

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
    chrome.setViewMode("table");
  };

  const openNew = () => {
    setEditingTipo(null);
    setShowForm(true);
  };

  const handleSubmit = (data) => {
    if (editingTipo) updateTipoMutation.mutate({ id: editingTipo.id, data, oldData: editingTipo });
    else createTipoMutation.mutate(data);
  };

  const handleEdit = (tipo) => {
    setEditingTipo(tipo);
    setShowForm(true);
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
      chrome.handleViewModeChange(mode, { onOpenRecord: () => handleEditSelected() });
    },
    [chrome, handleEditSelected]
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

  const detailTitle = editingTipo?.id ? "Editar tipo de tarefa" : "Novo tipo de tarefa";

  const extraToolbar = (
    <button type="button" className="tb-btn tb-btn-gray" onClick={handleExport}>
      <Download aria-hidden />
      Exportar
    </button>
  );

  return (
    <>
      <CadastroWorkspace
        mode={showForm ? "detail" : "list"}
        title={showForm ? detailTitle : "Tipos de tarefa"}
        subtitle={
          showForm
            ? "Preencha os dados e salve para voltar à lista."
            : "Tipos usados em tarefas do mapa, vinculados a grupos de atividade."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={null}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <FormularioTipoTarefa
              key="form"
              variant="embedded"
              initialData={editingTipo}
              grupos={grupos}
              isEditing={!!editingTipo}
              onSubmit={handleSubmit}
              onCancel={closeForm}
            />
          ) : (
            <CadastroListaChrome
              key="chrome"
              selectedCount={chrome.selectedIds.length}
              listados={tipos.length}
              filtrados={filtradosCount}
              totais={tipos.length}
              onNew={openNew}
              onEdit={handleEditSelected}
              onDelete={handleDeleteSelected}
              searchValue={chrome.searchInput}
              onSearchChange={chrome.setSearchInput}
              onSearchApply={chrome.applySearch}
              searchActive={chrome.searchActive}
              searchPlaceholder="Buscar tipos…"
              onConfigureColumns={() => setShowConfigColunas(true)}
              onExportCsv={handleExport}
              onClearFilters={chrome.clearFilters}
              filtersActive={chrome.filtersActive}
              viewMode={chrome.viewMode}
              onViewModeChange={onViewModeChange}
              extraToolbar={extraToolbar}
            >
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

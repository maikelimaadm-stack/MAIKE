import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";
import FormularioGrupoAtividade from "@/components/grupos-atividades/FormularioGrupoAtividade";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import TabelaGruposAtividades from "@/components/grupos-atividades/TabelaGruposAtividades";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { listarGrupos, criarGrupo, atualizarGrupo, excluirGrupos } from "@/services/tarefaCadastroService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";

export default function GruposAtividades() {
  const [showForm, setShowForm] = useState(false);
  const [editingGrupo, setEditingGrupo] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const queryClient = useQueryClient();
  const chrome = useCadastroListaChromeState();

  const { data: grupos = [] } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => listarGrupos(),
    initialData: [],
  });

  const createGrupoMutation = useMutation({
    mutationFn: (data) => criarGrupo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      setShowForm(false);
      setEditingGrupo(null);
      toast.success("Grupo cadastrado!");
    },
  });

  const updateGrupoMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarGrupo({ id, dados: data, oldData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      setShowForm(false);
      setEditingGrupo(null);
      toast.success("Grupo atualizado!");
    },
  });

  const closeForm = () => {
    setShowForm(false);
    setEditingGrupo(null);
    chrome.exitRecordView();
  };

  const openNew = () => {
    setEditingGrupo(null);
    setShowForm(true);
    chrome.setViewMode("record");
  };

  const handleSubmit = (data) => {
    if (editingGrupo) {
      updateGrupoMutation.mutate({ id: editingGrupo.id, data, oldData: editingGrupo });
    } else {
      createGrupoMutation.mutate(data);
    }
  };

  const handleEdit = (grupo) => {
    setEditingGrupo(grupo);
    setShowForm(true);
    chrome.setViewMode("record");
    if (grupo?.id) chrome.onSelectionChange([grupo.id]);
  };

  const handleEditSelected = () => {
    const item = grupos.find((g) => g.id === chrome.selectedIds[0]);
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
      const { excluidos, bloqueados } = await excluirGrupos(ids, { grupos });

      if (excluidos.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
        chrome.setSelectedIds([]);
        toast.success(excluidos.length === 1 ? "Grupo excluído!" : `${excluidos.length} grupos excluídos!`);
      }
      if (bloqueados.length > 0) {
        toast.error(
          bloqueados.length === 1
            ? "1 grupo não pôde ser excluído: existem registros vinculados."
            : `${bloqueados.length} grupos não puderam ser excluídos: existem registros vinculados.`
        );
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível excluir."));
    }
  };

  const handleExport = () => {
    const csv = [
      ["Nome", "Ativo", "Descrição", "Observações", "Criado em", "Atualizado em"].join(";"),
      ...grupos.map((g) =>
        [
          g.nome_grupo || "",
          g.ativo ? "SIM" : "NÃO",
          g.descricao || "",
          g.observacoes || "",
          g.created_date || "",
          g.updated_date || "",
        ].join(";")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `grupos_atividades_${new Date().toISOString().split("T")[0]}.csv`;
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
    if (!q) return grupos.length;
    return grupos.filter((g) => {
      const hay = [g.nome_grupo, g.descricao, g.observacoes].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [grupos, chrome.appliedSearch]);

  const detailTitle = editingGrupo?.id ? editingGrupo.nome_grupo || "Grupo" : "Novo grupo de atividades";

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return grupos;
    return grupos.filter((g) => {
      const hay = [g.nome_grupo, g.descricao, g.observacoes].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [grupos, chrome.appliedSearch]);

  const recordIndex = editingGrupo?.id
    ? Math.max(0, recordNavRows.findIndex((g) => g.id === editingGrupo.id))
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
        title="Grupos de atividades"
        subtitle="Agrupamento de tipos de tarefa do mapa e do manejo."
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
                onGo={editingGrupo?.id ? goRecord : undefined}
                navDisabled={!editingGrupo?.id}
              />
            ) : null
          }
          recordBody={
            showForm ? (
              <FormularioGrupoAtividade
                variant="embedded"
                initialData={editingGrupo}
                isEditing={!!editingGrupo}
                onSubmit={handleSubmit}
                onCancel={closeForm}
              />
            ) : null
          }
          selectedCount={chrome.selectedIds.length}
          listados={grupos.length}
          filtrados={filtradosCount}
          totais={grupos.length}
          onNew={openNew}
          onEdit={handleEditSelected}
          onDelete={handleDeleteSelected}
          searchValue={chrome.searchInput}
          onSearchChange={chrome.setSearchInput}
          onSearchApply={chrome.applySearch}
          searchActive={chrome.searchActive}
          searchPlaceholder="Buscar grupos…"
          onConfigureColumns={() => setShowConfigColunas(true)}
          onExportCsv={handleExport}
          onClearFilters={chrome.clearFilters}
          filtersActive={chrome.filtersActive}
          viewMode={showForm ? "record" : chrome.viewMode}
          onViewModeChange={onViewModeChange}
          extraToolbar={extraToolbar}
        >
          {!showForm ? (
            <TabelaGruposAtividades
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
          ) : null}
        </CadastroListaChrome>
      </CadastroWorkspace>

      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Confirmar exclusão"
        description={
          deleteState.ids.length > 1
            ? `Deseja realmente excluir ${deleteState.ids.length} grupos selecionados?`
            : "Deseja realmente excluir este grupo?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

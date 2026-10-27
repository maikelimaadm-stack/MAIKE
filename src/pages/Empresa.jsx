import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import { useCadastroDuplicateAction } from "@/hooks/useCadastroDuplicateAction";
import FormularioEmpresa from "../components/empresa/FormularioEmpresa";
import TabelaEmpresas, { EMPRESAS_COLUNAS, getEmpresaFieldValue } from "../components/empresa/TabelaEmpresas";
import { exportCadastroCsv } from "@/components/cadastro/base1/cadastroExportCsv";
import * as empresaService from "@/services/empresaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";

const EMPTY_EMPRESAS = [];

const toastPersistenciaEmpresa = (registro, mensagemOk) => {
  if (registro?._isOffline || String(registro?.id || "").startsWith("offline_")) {
    toast.message("Pendente de sincronização — será enviada quando a conexão voltar.");
    return;
  }
  toast.success(mensagemOk);
};

export default function Empresa() {
  const [showForm, setShowForm] = useState(false);
  const [editingEmpresa, setEditingEmpresa] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const chrome = useCadastroListaChromeState();
  const listBindings = useCadastroPageListBindings({ storageKey: "colunas_empresas_v2", columns: EMPRESAS_COLUNAS, chrome });

  const handleDuplicateSelected = useCadastroDuplicateAction({
    chrome,
    findById: (id) => empresas.find((row) => row.id === id),
    openDraft: (draft) => {
      setEditingEmpresa(draft);
      setShowForm(true);
    },
    labelField: "nome",
  });
  const queryClient = useQueryClient();

  const {
    data: empresasData,
    isLoading,
    isError: listaErro,
    error: listaQueryError,
    refetch: recarregarLista,
    isFetching: listaFetching,
  } = useQuery({
    queryKey: ["empresas"],
    queryFn: () => empresaService.listEmpresas(),
  });
  const empresas = listaErro ? EMPTY_EMPRESAS : (empresasData ?? EMPTY_EMPRESAS);

  const createMutation = useMutation({
    mutationFn: (data) => empresaService.createEmpresa(data),
    onSuccess: async (criada) => {
      if (!criada?._isOffline && (!criada?.id || !(Number(criada.numero_empresa) > 0))) {
        toast.error("Resposta incompleta ao salvar. Recarregue a lista.");
        return;
      }
      await queryClient.refetchQueries({ queryKey: ["empresas"] });
      if (criada?.id) chrome.onSelectionChange([criada.id]);
      if (criada?._isOffline || String(criada?.id || "").startsWith("offline_")) {
        setEditingEmpresa(criada);
        setShowForm(true);
      } else {
        setEditingEmpresa(criada);
        setShowForm(true);
      }
      toastPersistenciaEmpresa(criada, "Empresa cadastrada!");
    },
    onError: (error) =>
      toast.error(getApiErrorMessage(error, "Não foi possível cadastrar a empresa.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => empresaService.updateEmpresa(id, data),
    onSuccess: async (atualizada) => {
      await queryClient.refetchQueries({ queryKey: ["empresas"] });
      if (atualizada?.id) chrome.onSelectionChange([atualizada.id]);
      setShowForm(false);
      setEditingEmpresa(null);
      toastPersistenciaEmpresa(atualizada, "Empresa atualizada!");
    },
    onError: (error) =>
      toast.error(getApiErrorMessage(error, "Não foi possível atualizar a empresa.")),
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
    chrome.exitRecordView();
  };

  const openNew = () => {
    setEditingEmpresa(null);
    setShowForm(true);
    chrome.setViewMode("record");
  };

  const handleSubmit = (data) => {
    if (editingEmpresa?.id) updateMutation.mutate({ id: editingEmpresa.id, data });
    else createMutation.mutate(data);
  };

  const handleEdit = (empresa) => {
    setEditingEmpresa(empresa);
    setShowForm(true);
    chrome.setViewMode("record");
    if (empresa?.id) chrome.onSelectionChange([empresa.id]);
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
      chrome.handleViewModeChange(mode, {
        onOpenRecord: () => handleEditSelected(),
        onExitRecord: closeForm,
      });
    },
    [chrome, handleEditSelected, closeForm],
  );

  const filtradosCount = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return empresas.length;
    return empresas.filter((e) => {
      const hay = [e.numero_empresa, e.nome, e.apelido, e.cidade, e.cpf, e.cnpj, e.email]
        .filter((v) => v != null && v !== "")
        .join(" ")
        .toLowerCase();
      return hay.includes(q) || String(e.numero_empresa ?? "").includes(chrome.appliedSearch.trim());
    }).length;
  }, [empresas, chrome.appliedSearch]);

  const detailTitle = editingEmpresa?.id ? editingEmpresa.nome || editingEmpresa.apelido || "Empresa" : "Nova empresa";

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return empresas;
    return empresas.filter((e) => {
      const hay = [e.numero_empresa, e.nome, e.apelido, e.cidade, e.cpf, e.cnpj, e.email]
        .filter((v) => v != null && v !== "")
        .join(" ")
        .toLowerCase();
      return hay.includes(q) || String(e.numero_empresa ?? "").includes(chrome.appliedSearch.trim());
    });
  }, [empresas, chrome.appliedSearch]);

  const recordIndex = editingEmpresa?.id
    ? Math.max(0, recordNavRows.findIndex((e) => e.id === editingEmpresa.id))
    : 0;

  const goRecord = (index) => {
    const row = recordNavRows[index];
    if (row) handleEdit(row);
  };

  return (
    <>
      <CadastroWorkspace
        mode="list"
        title="Empresas"
        subtitle="Cadastro de empresas (fazendas) vinculadas ao tenant."
        toolbar={null}
      >
        {listaErro && !listaFetching ? (
          <div className="cadastro-b1 mg-card p-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 mb-2 flex flex-wrap items-center gap-2">
            <span>
              {getApiErrorMessage(
                listaQueryError,
                "Não foi possível carregar as empresas. Verifique sua conexão e tente novamente.",
              )}
            </span>
            <button type="button" className="tb-btn tb-btn-gray" onClick={() => recarregarLista()}>
              Tentar novamente
            </button>
          </div>
        ) : null}
        <CadastroListaChrome
          recordMode={showForm}
          secondaryToolsLocked={showForm}
          recordHeader={
            showForm ? (
              <CadastroRecordHeader
                title={detailTitle}
                code={
                  editingEmpresa?.numero_empresa > 0
                    ? `Nº ${editingEmpresa.numero_empresa}`
                    : editingEmpresa?.id
                      ? "Aguardando número"
                      : undefined
                }
                index={recordIndex}
                total={recordNavRows.length}
                onGo={editingEmpresa?.id ? goRecord : undefined}
                navDisabled={!editingEmpresa?.id}
              />
            ) : null
          }
          recordBody={
            showForm ? (
              <FormularioEmpresa
                variant="embedded"
                onSubmit={handleSubmit}
                onCancel={closeForm}
                initialData={editingEmpresa}
                isEditing={!!editingEmpresa?.id}
                saving={createMutation.isPending || updateMutation.isPending}
              />
            ) : null
          }
          selectedCount={chrome.selectedIds.length}
          {...listBindings.listFooter.chromeFooter}
          createLabel="Novo"
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
          searchPlaceholder="Buscar empresas…"
          onConfigureColumns={() => setShowConfigColunas(true)}
          onExportCsv={() => exportCadastroCsv("empresas.csv", EMPRESAS_COLUNAS, empresas, getEmpresaFieldValue)}
          onClearFilters={chrome.clearFilters}
          filtersActive={chrome.filtersActive}
          viewMode={showForm ? "record" : chrome.viewMode}
          onViewModeChange={onViewModeChange}
        >
          {!showForm ? (
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

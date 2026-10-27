import React, { useCallback, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import FormularioLote from "@/components/lotes/FormularioLote";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import TabelaLotes, { COLUNAS_DISPONIVEIS } from "@/components/lotes/TabelaLotes";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import RegistroAnexosDialog from "@/components/common/RegistroAnexosDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import { useCadastroDuplicateAction } from "@/hooks/useCadastroDuplicateAction";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import {
  listarLotes,
  listarAreasAtivas,
  criarLote,
  atualizarLote,
  excluirLote,
  validarExclusaoDeLote,
} from "@/services/loteCadastroService";
import { persistirAnexosPendentes } from "@/services/anexoService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

export default function CadastroLotes() {
  const [showForm, setShowForm] = useState(false);
  const [editingLote, setEditingLote] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [attachmentsRecord, setAttachmentsRecord] = useState(null);
  const [newRecordAttachmentsOpen, setNewRecordAttachmentsOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [formVersion, setFormVersion] = useState(0);
  const chrome = useCadastroListaChromeState();
  const listBindings = useCadastroPageListBindings({
    storageKey: "colunas_cadastro_lotes",
    columns: COLUNAS_DISPONIVEIS,
    chrome,
  });

  const handleDuplicateSelected = useCadastroDuplicateAction({
    chrome,
    findById: (id) => lotes.find((row) => row.id === id),
    openDraft: (draft) => {
      setEditingLote(draft);
      setShowForm(true);
    },
    labelField: "nome",
  });
  const queryClient = useQueryClient();
  const empresaSelecionadaId = useEmpresaSelecionadaId();

  const { data: lotes = [], isLoading } = useQuery({
    queryKey: ["lotes-cadastro", empresaSelecionadaId],
    queryFn: () => listarLotes({ empresaId: empresaSelecionadaId, incluirSistema: false }),
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", empresaSelecionadaId],
    queryFn: () => listarAreasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const invalidateLotes = async () => {
    await queryClient.invalidateQueries({ queryKey: ["lotes-cadastro", empresaSelecionadaId] });
    await queryClient.refetchQueries({ queryKey: ["lotes-cadastro", empresaSelecionadaId], exact: true });
    await refreshMapaCacheEntry("lotes", empresaSelecionadaId, { force: true });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  const createLoteMutation = useMutation({
    mutationFn: (data) => criarLote(data, { empresaId: empresaSelecionadaId }),
    onSuccess: async (created) => {
      if (pendingAttachments.length) {
        await persistirAnexosPendentes({
          entityName: "Lote",
          recordId: created.id,
          pendentes: pendingAttachments,
        });
        setPendingAttachments([]);
      }
      await invalidateLotes();
      setShowForm(false);
      setEditingLote(null);
      chrome.exitRecordView();
      toast.success("Lote cadastrado!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar o lote.")),
  });

  const updateLoteMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarLote(id, data, { registroAnterior: oldData }),
    onSuccess: async () => {
      await invalidateLotes();
      setShowForm(false);
      setEditingLote(null);
      chrome.exitRecordView();
      toast.success("Lote atualizado!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível atualizar o lote.")),
  });

  const deleteLoteMutation = useMutation({
    mutationFn: (id) => excluirLote(id),
  });

  const closeForm = () => {
    setShowForm(false);
    setEditingLote(null);
    setPendingAttachments([]);
    setNewRecordAttachmentsOpen(false);
    chrome.exitRecordView();
  };

  const openNew = () => {
    setEditingLote(null);
    setPendingAttachments([]);
    setFormVersion((v) => v + 1);
    setShowForm(true);
    chrome.setViewMode("record");
  };

  const handleSubmit = (data) => {
    if (editingLote?.id && !editingLote._isDuplicate) {
      updateLoteMutation.mutate({ id: editingLote.id, data, oldData: editingLote });
      return;
    }
    const { _isDuplicate, ...cleanData } = data;
    createLoteMutation.mutate(cleanData);
  };

  const handleEdit = (lote) => {
    setEditingLote(lote);
    setFormVersion((v) => v + 1);
    setShowForm(true);
    chrome.setViewMode("record");
    if (lote?.id) chrome.onSelectionChange([lote.id]);
  };

  const handleEditSelected = () => {
    const item = lotes.find((l) => l.id === chrome.selectedIds[0]);
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

    let deletedCount = 0;
    for (const id of ids) {
      try {
        await validarExclusaoDeLote(id);
        await deleteLoteMutation.mutateAsync(id);
        deletedCount += 1;
      } catch {
        /* best-effort por registro */
      }
    }

    if (deletedCount > 0) {
      await invalidateLotes();
      chrome.setSelectedIds([]);
      toast.success(deletedCount === 1 ? "Lote excluído!" : `${deletedCount} lotes excluídos!`);
    } else if (ids.length) {
      toast.error("Nenhum lote pôde ser excluído.");
    }
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
    if (!q) return lotes.length;
    return lotes.filter((lote) => {
      const hay = [
        lote.numero_lote,
        lote.nome,
        lote.identificador_nome,
        lote.identificador_sigla,
        lote.categoria,
        lote.status,
        lote.area_entrada_nome,
        lote.area_atual_nome,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    }).length;
  }, [lotes, chrome.appliedSearch]);

  const detailTitle = editingLote?.id
    ? editingLote._isDuplicate
      ? "Duplicar lote"
      : editingLote.nome || editingLote.numero_lote || "Lote"
    : "Novo lote";

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return lotes;
    return lotes.filter((lote) => {
      const hay = [
        lote.numero_lote,
        lote.nome,
        lote.identificador_nome,
        lote.identificador_sigla,
        lote.categoria,
        lote.status,
        lote.area_entrada_nome,
        lote.area_atual_nome,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [lotes, chrome.appliedSearch]);

  const recordIndex =
    editingLote?.id && !editingLote._isDuplicate
      ? Math.max(0, recordNavRows.findIndex((l) => l.id === editingLote.id))
      : 0;

  const goRecord = (index) => {
    const row = recordNavRows[index];
    if (row) handleEdit(row);
  };

  const attachLabel =
    editingLote?.nome || editingLote?.numero_lote || (showForm && !editingLote?.id ? "Novo lote" : "Lote");

  return (
    <>
      <CadastroWorkspace
        mode="list"
        title="Cadastro de Lotes"
        subtitle="Lotes pecuários da empresa selecionada — busca global e filtros por coluna na grade."
      >
        <CadastroListaChrome
          recordMode={showForm}
          secondaryToolsLocked={showForm}
          recordHeader={
            showForm ? (
              <CadastroRecordHeader
                title={detailTitle}
                code={editingLote?.numero_lote ? String(editingLote.numero_lote) : undefined}
                index={recordIndex}
                total={recordNavRows.length}
                onGo={editingLote?.id && !editingLote._isDuplicate ? goRecord : undefined}
                navDisabled={!editingLote?.id || editingLote._isDuplicate}
              />
            ) : null
          }
          recordBody={
            showForm ? (
              <FormularioLote
                key={`form-${formVersion}-${editingLote?.id || "new"}`}
                variant="embedded"
                initialData={editingLote}
                isEditing={!!editingLote?.id && !editingLote?._isDuplicate}
                onSubmit={handleSubmit}
                onCancel={closeForm}
                onAttachClick={() =>
                  editingLote?.id ? setAttachmentsRecord(editingLote) : setNewRecordAttachmentsOpen(true)
                }
                attachDisabled={false}
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
          searchPlaceholder="Buscar lotes…"
          onConfigureColumns={() => setShowConfigColunas(true)}
          onClearFilters={chrome.clearFilters}
          filtersActive={chrome.filtersActive}
          viewMode={showForm ? "record" : chrome.viewMode}
          onViewModeChange={onViewModeChange}
          recordModeAvailable
        >
          {!showForm ? (
            <TabelaLotes
              lotes={lotes}
              areas={areas}
              onEdit={handleEdit}
              isLoading={isLoading}
              showConfigColunas={showConfigColunas}
              setShowConfigColunas={setShowConfigColunas}
              searchTerm={chrome.appliedSearch}
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

      <RegistroAnexosDialog
        open={!!attachmentsRecord?.id || newRecordAttachmentsOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAttachmentsRecord(null);
            setNewRecordAttachmentsOpen(false);
          }
        }}
        entityName="Lote"
        recordId={attachmentsRecord?.id}
        title={attachLabel}
        pendingAnexos={pendingAttachments}
        onPendingChange={setPendingAttachments}
      />

      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Confirmar exclusão"
        description={
          deleteState.ids.length > 1
            ? `Deseja realmente excluir ${deleteState.ids.length} lotes selecionados?`
            : "Deseja realmente excluir este lote?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

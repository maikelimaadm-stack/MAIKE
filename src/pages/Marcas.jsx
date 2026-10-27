import React, { useCallback, useMemo, useRef, useState } from "react";
import { listarMarcasDaEmpresa, criarMarca, atualizarMarca, excluirMarcas } from "@/services/marcaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import TabelaMarcas from "@/components/marcas/TabelaMarcas";
import { MARCAS_COLUNAS, getMarcaFieldValue } from "@/components/marcas/TabelaMarcas";
import { exportCadastroCsv } from "@/components/cadastro/base1/cadastroExportCsv";
import { Base1CardsToolbar } from "@/components/cadastro/base1/Base1Cards";
import { prepareCadastroDuplicate } from "@/components/cadastro/base1/cadastroDuplicateHelpers";
import { Check, X } from "lucide-react";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";
import FormularioMarca, { FORMULARIO_MARCA_ID } from "@/components/marcas/FormularioMarca";
import { useCadastroListaFooter } from "@/hooks/useCadastroListaFooter";
import { useCadastroCardsPrefs } from "@/hooks/useCadastroCardsPrefs";
import { clearCadastroListaFiltersAndSearch } from "@/lib/cadastroListaClearFilters";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

const MARCAS_STORAGE_KEY = "colunas_marcas_v1";
const EMPTY_MARCAS = [];

export default function Marcas() {
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const configureColumnsAnchorRef = useRef(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [formEpoch, setFormEpoch] = useState(0);
  /** Registro em visualização antes de clicar Novo — restaurado no Cancelar. */
  const recordBeforeNewRef = useRef(null);
  const chrome = useCadastroListaChromeState({
    initialViewMode:
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 639px)").matches
        ? "cards"
        : "table",
  });
  const bumpFormEpoch = () => setFormEpoch((n) => n + 1);
  const listFooter = useCadastroListaFooter(
    MARCAS_STORAGE_KEY,
    `${chrome.resetFiltersKey}:${chrome.appliedSearch}`,
  );
  const cardsPrefs = useCadastroCardsPrefs(
    MARCAS_STORAGE_KEY,
    MARCAS_COLUNAS.map((c) => c.id),
  );
  const queryClient = useQueryClient();
  const empresaId = useEmpresaSelecionadaId();

  const { data: marcasData, isLoading } = useQuery({
    queryKey: ["marcas", empresaId],
    queryFn: () => listarMarcasDaEmpresa(empresaId),
    enabled: !!empresaId,
  });
  const marcas = marcasData ?? EMPTY_MARCAS;

  const createMutation = useMutation({
    mutationFn: (data) => criarMarca({ dados: data, empresaId, marcasDaEmpresa: marcas }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      recordBeforeNewRef.current = null;
      // Após Novo → Salvar, permanece em modo registro (leitura do criado).
      if (created && typeof created === "object" && created.id) {
        setEditingItem(created);
        setIsEditing(false);
        setShowForm(true);
        chrome.setViewMode("record");
        chrome.onSelectionChange([String(created.id)]);
      } else {
        setShowForm(false);
        setEditingItem(null);
        chrome.exitRecordView();
      }
      toast.success("Marca criada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar a marca.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string; data: object }} vars */
    mutationFn: ({ id, data }) => atualizarMarca(id, data, marcas),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      const merged = {
        ...(editingItem?.id === id ? editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      setEditingItem(merged);
      setIsEditing(false);
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
    recordBeforeNewRef.current = null;
    setShowForm(false);
    setIsEditing(false);
    setEditingItem(null);
    chrome.exitRecordView();
  };

  const cancelForm = () => {
    if (isEditing && editingItem?.id) {
      setIsEditing(false);
      return;
    }
    // Cancelar um Novo aberto a partir de um registro: volta para ele em visualização.
    const previous = recordBeforeNewRef.current;
    recordBeforeNewRef.current = null;
    if (previous?.id) {
      bumpFormEpoch();
      setEditingItem(previous);
      setIsEditing(false);
      setShowForm(true);
      chrome.setViewMode("record");
      chrome.onSelectionChange([String(previous.id)]);
      return;
    }
    closeForm();
  };

  const openNew = () => {
    bumpFormEpoch();
    recordBeforeNewRef.current = showForm && editingItem?.id ? editingItem : null;
    setEditingItem(null);
    setIsEditing(true);
    setShowForm(true);
    chrome.setViewMode("record");
  };

  const handleSubmit = (data) => {
    if (editingItem?.id) updateMutation.mutate({ id: editingItem.id, data });
    else createMutation.mutate(data);
  };

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return marcas;
    return marcas.filter((m) => {
      const hay = [m.nome, m.descricao, m.numero_marca].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [marcas, chrome.appliedSearch]);

  const handleEdit = useCallback(
    (item) => {
      setEditingItem(item);
      setIsEditing(!item?.id);
      setShowForm(true);
      chrome.setViewMode("record");
      if (item?.id) chrome.onSelectionChange([String(item.id)]);
    },
    [chrome.setViewMode, chrome.onSelectionChange],
  );

  const handleEditSelected = useCallback(() => {
    if (showForm && editingItem?.id && !isEditing) {
      setIsEditing(true);
      return true;
    }
    const selectedId = chrome.selectedIds[0];
    const selected = selectedId
      ? recordNavRows.find((m) => String(m.id) === String(selectedId))
      : null;
    const item = selected ?? (chrome.selectedIds.length === 0 ? recordNavRows[0] : null);
    if (item) {
      handleEdit(item);
      return true;
    }
    return false;
  }, [showForm, editingItem, isEditing, chrome.selectedIds, recordNavRows, handleEdit]);

  const handleDuplicateSelected = () => {
    const item = marcas.find((m) => String(m.id) === String(chrome.selectedIds[0]));
    const draft = prepareCadastroDuplicate(item, { labelField: "nome" });
    if (!draft) return;
    bumpFormEpoch();
    setEditingItem(draft);
    setIsEditing(true);
    setShowForm(true);
    chrome.setViewMode("record");
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
      chrome.handleViewModeChange(mode, {
        onOpenRecord: () => handleEditSelected(),
        onExitRecord: closeForm,
      });
    },
    [chrome, handleEditSelected, closeForm],
  );

  const detailTitle = editingItem?.id ? editingItem.nome || "Marca" : "Nova marca";
  const saving = createMutation.isPending || updateMutation.isPending;

  const recordIndex = editingItem?.id
    ? Math.max(0, recordNavRows.findIndex((m) => m.id === editingItem.id))
    : 0;

  const goRecord = (index) => {
    const row = recordNavRows[index];
    if (row) handleEdit(row);
  };

  return (
    <>
      <CadastroWorkspace mode="list" title="Marcas" pageLayout="base1-list">
        <CadastroListaChrome
          showFilterRail={false}
          joinTableToolbar
          portalComprasSkin
          recordMode={showForm}
          recordEditing={isEditing}
          secondaryToolsLocked={showForm && isEditing}
          recordToolbar={
            showForm && isEditing ? (
              <>
                <PillBtn type="submit" form={FORMULARIO_MARCA_ID} disabled={saving}>
                  <Check className="h-4 w-4" aria-hidden />
                  {saving ? "Salvando…" : "Salvar"}
                </PillBtn>
                <PillBtn type="button" tone="gray" onClick={cancelForm} disabled={saving}>
                  <X className="h-4 w-4" aria-hidden />
                  Cancelar
                </PillBtn>
              </>
            ) : null
          }
          recordHeader={
            showForm ? (
              <CadastroRecordHeader
                title={detailTitle}
                code={editingItem?.numero_marca ? String(editingItem.numero_marca) : undefined}
                index={recordIndex}
                total={recordNavRows.length}
                onGo={editingItem?.id ? goRecord : undefined}
                navDisabled={showForm && isEditing}
              />
            ) : null
          }
          recordBody={
            showForm ? (
              <FormularioMarca
                key={`${editingItem?.id ?? "marca-nova"}-${formEpoch}`}
                variant="embedded"
                toolbarActions
                readOnly={!isEditing}
                isSubmitting={saving}
                initialData={editingItem}
                onSubmit={handleSubmit}
                onCancel={cancelForm}
              />
            ) : null
          }
          attachDisabledReason="Anexos disponíveis quando o cadastro tiver auditoria nativa."
          selectedCount={chrome.selectedIds.length}
          {...listFooter.chromeFooter}
          createLabel="Novo"
          onNew={openNew}
          onEdit={handleEditSelected}
          onDuplicate={handleDuplicateSelected}
          onDelete={handleDeleteSelected}
          onExportCsv={exportCsv}
          onPrint={() => window.print()}
          cardsModeAvailable
          cardsToolbar={
            <Base1CardsToolbar columns={MARCAS_COLUNAS} cardsPrefs={cardsPrefs} />
          }
          searchValue={chrome.searchInput}
          onSearchChange={chrome.setSearchInput}
          onSearchApply={chrome.applySearch}
          searchActive={chrome.searchActive}
          searchPlaceholder="Buscar marcas…"
          configureColumnsAnchorRef={configureColumnsAnchorRef}
          onConfigureColumns={() => setShowConfigColunas(true)}
          onClearFilters={() => clearCadastroListaFiltersAndSearch(chrome)}
          filtersActive={chrome.filtersActive || chrome.searchActive}
          viewMode={showForm ? "record" : chrome.viewMode}
          onViewModeChange={onViewModeChange}
        >
          {!showForm ? (
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
              viewMode={chrome.viewMode === "cards" ? "cards" : "table"}
              displayLimit={listFooter.gradePaging.displayLimit}
              onListMetrics={listFooter.gradePaging.onListMetrics}
              cardFields={cardsPrefs.cardFields}
              cardsPerRow={cardsPrefs.cardsPerRow}
              configureColumnsAnchorRef={configureColumnsAnchorRef}
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

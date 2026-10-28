import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip } from "lucide-react";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import FormularioLote, { FORMULARIO_LOTE_ID } from "@/components/lotes/FormularioLote";
import TabelaLotes, { COLUNAS_DISPONIVEIS, getLoteFieldValue } from "@/components/lotes/TabelaLotes";
import RegistroAnexosDialog from "@/components/common/RegistroAnexosDialog";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import {
  listarLotes,
  criarLote,
  atualizarLote,
  excluirLotes,
} from "@/services/loteCadastroService";
import { persistirAnexosPendentes } from "@/services/anexoService";
import { getApiErrorMessage, hasApiErrorCode, API_ERROR_CODES } from "@/apis/_core/ApiError";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";

const STORAGE_KEY = "colunas_cadastro_lotes";

export default function CadastroLotes() {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const prevEmpresaRef = useRef(empresaSelecionadaId);

  const [attachmentsRecord, setAttachmentsRecord] = useState(null);
  const [newRecordAttachmentsOpen, setNewRecordAttachmentsOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);

  const fetchAll = useCallback(
    () => listarLotes({ empresaId: empresaSelecionadaId, incluirSistema: false }),
    [empresaSelecionadaId],
  );

  const controller = useCadastroBase1FullListController({
    storageKey: STORAGE_KEY,
    columnIds: COLUNAS_DISPONIVEIS.map((c) => c.id),
    listEnabled: Boolean(empresaSelecionadaId),
    queryKey: ["lotes-cadastro", empresaSelecionadaId],
    fetchAll,
    duplicateLabelField: "nome",
    exportFileName: "lotes.csv",
    exportColumns: COLUNAS_DISPONIVEIS,
    getExportFieldValue: getLoteFieldValue,
    getRecordTitle: (/** @type {any} */ item) => {
      if (item?._isDuplicate) return "Duplicar lote";
      if (item?.id) return item.nome || item.numero_lote || "Lote";
      return "Novo lote";
    },
    getRecordCode: (/** @type {any} */ item) =>
      item?.numero_lote ? String(item.numero_lote) : undefined,
    getSearchHaystack: (/** @type {any} */ lote) =>
      [
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
        .join(" "),
    mapSearchSuggestion: (/** @type {any} */ lote) => ({
      id: String(lote.id),
      label: lote.nome || lote.numero_lote || "Lote",
      secondary: lote.numero_lote ? String(lote.numero_lote) : undefined,
    }),
    matchRowId: (/** @type {any} */ lote, id) => String(lote.id) === String(id),
    getRowId: (/** @type {any} */ lote) => String(lote.id),
    findRowById: (/** @type {any} */ rows, id) => rows.find((l) => String(l.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  useEffect(() => {
    if (prevEmpresaRef.current === empresaSelecionadaId) return;
    prevEmpresaRef.current = empresaSelecionadaId;
    controller.recordHelpers.closeForm();
    controller.chrome.setSelectedIds([]);
    controller.handleClearFilters();
    setPendingAttachments([]);
    setAttachmentsRecord(null);
    setNewRecordAttachmentsOpen(false);
  }, [empresaSelecionadaId, controller]);

  const invalidateLotesComMapa = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["lotes-cadastro", empresaSelecionadaId] });
    await refreshMapaCacheEntry("lotes", empresaSelecionadaId, { force: true });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  }, [queryClient, empresaSelecionadaId]);

  const createMutation = useMutation({
    /** @param {object} data */
    mutationFn: (data) => {
      const { _isDuplicate, ...cleanData } = data;
      return criarLote(cleanData, { empresaId: empresaSelecionadaId });
    },
    onSuccess: async (created) => {
      if (pendingAttachments.length) {
        await persistirAnexosPendentes({
          entityName: "Lote",
          recordId: created.id,
          pendentes: pendingAttachments,
        });
        setPendingAttachments([]);
      }
      await invalidateLotesComMapa();
      controller.recordHelpers.recordBeforeNewRef.current = null;
      if (created?.id) {
        controller.recordHelpers.setEditingItem(created);
        controller.recordHelpers.setIsEditing(false);
        controller.recordHelpers.setShowForm(true);
        controller.recordHelpers.chrome.setViewMode("record");
        controller.recordHelpers.chrome.onSelectionChange([String(created.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", "Lote cadastrado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o lote.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: object, oldData?: object }} vars */
    mutationFn: ({ id, data, oldData }) => atualizarLote(id, data, { registroAnterior: oldData }),
    onSuccess: async (updated, { id, data }) => {
      await invalidateLotesComMapa();
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Lote atualizado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível atualizar o lote.")),
  });

  const deleteMutation = useMutation({
    /** @param {string[]} ids */
    mutationFn: (ids) => excluirLotes(ids, { lotes: controller.allItems }),
    onSuccess: async ({ excluidos, bloqueados }) => {
      if (excluidos.length) {
        await invalidateLotesComMapa();
      }
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidos.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidos.length) {
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Lote excluído" });
      }
      if (bloqueados.length) {
        const soBloqueio = bloqueados.every((b) =>
          hasApiErrorCode(b.erro, API_ERROR_CODES.LOTE_DELETE_BLOCKED),
        );
        notifyError(
          "Atenção",
          soBloqueio
            ? bloqueados.length === 1
              ? "Este lote não pôde ser excluído: existem registros vinculados."
              : `${bloqueados.length} lotes não puderam ser excluídos: existem registros vinculados.`
            : "Alguns lotes não puderam ser excluídos.",
        );
      }
    },
    onError: (err) => {
      controller.setDeleteState({ open: false, ids: [] });
      if (hasApiErrorCode(err, API_ERROR_CODES.LOTE_DELETE_BLOCKED)) return;
      notifyError("Atenção", getApiErrorMessage(err, "Não foi possível excluir."));
    },
  });

  submitRef.current = (data) => {
    const editing = /** @type {any} */ (controller.editingItem);
    if (editing?.id && !editing._isDuplicate) {
      updateMutation.mutate({ id: editing.id, data, oldData: editing });
      return;
    }
    createMutation.mutate(data);
  };
  deleteRef.current = (ids) => deleteMutation.mutate(ids);

  const saving = createMutation.isPending || updateMutation.isPending;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar os lotes. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const editingRecord = /** @type {any} */ (controller.editingItem);
  const attachLabel =
    editingRecord?.nome ||
    editingRecord?.numero_lote ||
    (controller.showForm && !editingRecord?.id ? "Novo lote" : "Lote");

  const openAttachments = () => {
    if (controller.editingItem?.id) {
      setAttachmentsRecord(controller.editingItem);
    } else {
      setNewRecordAttachmentsOpen(true);
    }
  };

  const recordCode = editingRecord?.numero_lote ? String(editingRecord.numero_lote) : undefined;

  const screenController = { ...controller, saving };

  return (
    <>
      <CadastroBase1Screen
        workspaceTitle="Cadastro de Lotes"
        searchPlaceholder="Buscar lotes…"
        formId={FORMULARIO_LOTE_ID}
        attachDisabledReason=""
        columnsForCardsToolbar={COLUNAS_DISPONIVEIS}
        controller={screenController}
        listErrorMessage={listErrorMessage}
        recordCode={recordCode}
        extraToolbar={
          controller.showForm ? (
            <PillBtn type="button" tone="gray" onClick={openAttachments}>
              <Paperclip className="h-4 w-4" aria-hidden />
              Anexos
            </PillBtn>
          ) : null
        }
        deleteDialog={{
          title: "Confirmar exclusão",
          descriptionOne: "Deseja realmente excluir este lote?",
          descriptionMany: (n) => `Deseja realmente excluir ${n} lotes selecionados?`,
        }}
        recordForm={
          <FormularioLote
            key={`${controller.editingItem?.id ?? "lote-novo"}-${controller.formEpoch}`}
            variant="embedded"
            visualVariant="base1"
            toolbarActions
            readOnly={!controller.isEditing}
            isSubmitting={saving}
            initialData={controller.editingItem}
            isEditing={!!editingRecord?.id && !editingRecord?._isDuplicate}
            onSubmit={controller.handleSubmit}
            onCancel={controller.cancelForm}
          />
        }
        listSlot={
          <TabelaLotes
            lotes={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            showConfigColunas={controller.showConfigColunas}
            setShowConfigColunas={controller.setShowConfigColunas}
            searchTerm={controller.chrome.appliedSearch}
            resetFiltersKey={controller.chrome.resetFiltersKey}
            onSelectionChange={controller.chrome.onSelectionChange}
            onFiltersActiveChange={controller.chrome.setFiltersActive}
            viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
            cardFields={controller.cardsPrefs.cardFields}
            cardsPerRow={controller.cardsPrefs.cardsPerRow}
            configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
          />
        }
      />

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
    </>
  );
}

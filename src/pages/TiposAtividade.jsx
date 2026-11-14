import React, { useCallback, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import { API_ERROR_CODES, getApiErrorMessage } from "@/apis/_core/ApiError";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import FormularioTipoAtividade, {
  FORMULARIO_TIPO_ATIVIDADE_ID,
} from "@/components/tipos-atividade/FormularioTipoAtividade";
import TabelaTiposAtividade, {
  TIPOS_ATIVIDADE_COLUNAS,
  TIPOS_ATIVIDADE_STORAGE_KEY,
  getTipoAtividadeFieldValue,
} from "@/components/tipos-atividade/TabelaTiposAtividade";
import {
  listarGruposSimples,
  listarTiposAtividade,
  criarTipoAtividade,
  atualizarTipoAtividade,
  excluirTiposAtividade,
} from "@/services/tipoAtividadeCadastroService";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";
import { useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";

const QUERY_KEY = ["tipos-atividade"];

/**
 * Cadastro de tipos de atividade (D-PROD-182; padrões e flags, D-PROD-196).
 *
 * O tipo é do cliente; os centros padrão são da fazenda: o formulário oferece
 * os da fazenda SELECIONADA (a mesma empresa real do Apontamento de Atividade).
 */
export default function TiposAtividade() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));

  const { data: grupos = [] } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => listarGruposSimples(),
    initialData: [],
  });

  const fetchAll = useCallback(() => listarTiposAtividade(), []);

  const controller = useCadastroBase1FullListController({
    storageKey: TIPOS_ATIVIDADE_STORAGE_KEY,
    columnIds: TIPOS_ATIVIDADE_COLUNAS.map((c) => c.id),
    queryKey: QUERY_KEY,
    fetchAll,
    duplicateLabelField: "nome_tipo",
    exportFileName: "tipos-atividade.csv",
    exportColumns: TIPOS_ATIVIDADE_COLUNAS,
    getExportFieldValue: (/** @type {any} */ item, /** @type {string} */ colId) =>
      getTipoAtividadeFieldValue(item, colId, grupos),
    getRecordTitle: (/** @type {any} */ item) =>
      item?.id ? item.nome_tipo || "Tipo de atividade" : "Novo tipo de atividade",
    getRecordCode: () => undefined,
    getSearchHaystack: (/** @type {any} */ t) =>
      [t.nome_tipo, t.grupo_atividade_nome, t.descricao].filter(Boolean).join(" "),
    mapSearchSuggestion: (/** @type {any} */ t) => ({
      id: String(t.id),
      label: t.nome_tipo || "Tipo de atividade",
      secondary: t.grupo_atividade_nome || undefined,
    }),
    matchRowId: (/** @type {any} */ t, /** @type {string} */ id) => String(t.id) === String(id),
    getRowId: (/** @type {any} */ t) => String(t.id),
    findRowById: (/** @type {any} */ rows, /** @type {string} */ id) =>
      rows.find((/** @type {any} */ t) => String(t.id) === String(id)),
    onSubmitRecord: (/** @type {object} */ data) => submitRef.current(data),
    onRequestDeleteMutation: (/** @type {string[]} */ ids) => deleteRef.current(ids),
  });

  const createMutation = useMutation({
    /** @param {Record<string, unknown>} data */
    mutationFn: (data) => criarTipoAtividade(data),
    onSuccess: (/** @type {any} */ created) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
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
      notifySuccess("Sucesso", "Tipo de atividade cadastrado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o tipo de atividade.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: Record<string, unknown>, oldData?: object }} vars */
    mutationFn: ({ id, data, oldData }) => atualizarTipoAtividade({ id, dados: data, oldData }),
    onSuccess: (/** @type {any} */ updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Tipo de atividade atualizado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o tipo de atividade.")),
  });

  const deleteMutation = useMutation({
    /** @param {string[]} ids */
    mutationFn: (ids) => excluirTiposAtividade(ids),
    onSuccess: ({ excluidos, bloqueados }) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidos.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidos.length) {
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Tipo de atividade excluído" });
      }
      if (bloqueados.length) {
        // D-PROD-190: tipo com apontamento de atividade não sai (FK RESTRICT); a saída é inativá-lo.
        const porApontamento = bloqueados.some((b) => b.code === API_ERROR_CODES.TIPO_ATIVIDADE_DELETE_BLOCKED)
          ? " Há apontamentos de atividade vinculados: inative o tipo em vez de excluir."
          : "";
        notifyError(
          "Atenção",
          (bloqueados.length === 1
            ? "1 tipo de atividade não pôde ser excluído."
            : `${bloqueados.length} tipos de atividade não puderam ser excluídos.`) + porApontamento,
        );
      }
    },
    onError: (err) =>
      notifyError("Atenção", getApiErrorMessage(err, "Não foi possível excluir.")),
  });

  submitRef.current = (/** @type {any} */ data) => {
    if (controller.editingItem?.id) {
      updateMutation.mutate({
        id: controller.editingItem.id,
        data,
        oldData: controller.editingItem,
      });
    } else {
      createMutation.mutate(data);
    }
  };
  deleteRef.current = (ids) => deleteMutation.mutate(ids);

  const saving = createMutation.isPending || updateMutation.isPending;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar os tipos de atividade. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Tipos de atividade"
      searchPlaceholder="Buscar tipos de atividade…"
      formId={FORMULARIO_TIPO_ATIVIDADE_ID}
      columnsForCardsToolbar={TIPOS_ATIVIDADE_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja realmente excluir este tipo de atividade?",
        descriptionMany: (/** @type {number} */ n) =>
          `Deseja realmente excluir ${n} tipos de atividade selecionados?`,
      }}
      recordForm={
        <FormularioTipoAtividade
          key={`${controller.editingItem?.id ?? "tipo-atividade-novo"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={controller.editingItem}
          grupos={grupos}
          empresaId={empresaId}
          isEditing={!!controller.editingItem?.id}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
        />
      }
      listSlot={
        <TabelaTiposAtividade
          tipos={controller.visibleRows}
          grupos={grupos}
          onEdit={controller.handleEdit}
          onDelete={controller.handleRequestDelete}
          isLoading={controller.isLoading}
          showConfigColunas={controller.showConfigColunas}
          setShowConfigColunas={controller.setShowConfigColunas}
          searchQuery=""
          matchesSearch={controller.matchesSearch}
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
  );
}

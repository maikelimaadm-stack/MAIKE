import React, { useCallback, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import FormularioTipoTarefa, { FORMULARIO_TIPO_TAREFA_ID } from "@/components/tipos-tarefa/FormularioTipoTarefa";
import TabelaTiposTarefa, {
  TIPOS_TAREFA_COLUNAS,
  getTipoTarefaFieldValue,
} from "@/components/tipos-tarefa/TabelaTiposTarefa";
import {
  listarGruposSimples,
  listarTipos,
  criarTipo,
  atualizarTipo,
  excluirTipos,
} from "@/services/tarefaCadastroService";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";

export default function TiposTarefa() {
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));

  const { data: grupos = [] } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => listarGruposSimples(),
    initialData: [],
  });

  const fetchAll = useCallback(() => listarTipos(), []);

  const controller = useCadastroBase1FullListController({
    storageKey: "colunas_largura_tipos_tarefa",
    columnIds: TIPOS_TAREFA_COLUNAS.map((c) => c.id),
    queryKey: ["tipos-tarefa"],
    fetchAll,
    duplicateLabelField: "nome_tipo",
    exportFileName: "tipos-tarefa.csv",
    exportColumns: TIPOS_TAREFA_COLUNAS,
    getExportFieldValue: (item, colId) => getTipoTarefaFieldValue(item, colId, grupos),
    getRecordTitle: (item) => (item?.id ? item.nome_tipo || "Tipo" : "Novo tipo de tarefa"),
    getSearchHaystack: (t) =>
      [t.nome_tipo, t.grupo_atividade_nome, t.descricao].filter(Boolean).join(" "),
    mapSearchSuggestion: (t) => ({
      id: String(t.id),
      label: t.nome_tipo || "Tipo",
      secondary: t.grupo_atividade_nome || undefined,
    }),
    matchRowId: (t, id) => String(t.id) === String(id),
    getRowId: (t) => String(t.id),
    findRowById: (rows, id) => rows.find((t) => String(t.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  const createMutation = useMutation({
    mutationFn: (data) => criarTipo(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
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
      notifySuccess("Sucesso", "Tipo cadastrado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o tipo.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarTipo({ id, dados: data, oldData }),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Tipo atualizado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o tipo.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => excluirTipos(ids, { tipos: controller.allItems }),
    onSuccess: ({ excluidos, bloqueados }) => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidos.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidos.length) {
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Tipo excluído" });
      }
      if (bloqueados.length) {
        notifyError(
          "Atenção",
          bloqueados.length === 1
            ? "1 tipo não pôde ser excluído: existem registros vinculados."
            : `${bloqueados.length} tipos não puderam ser excluídos: existem registros vinculados.`,
        );
      }
    },
    onError: (err) =>
      notifyError("Atenção", getApiErrorMessage(err, "Não foi possível excluir.")),
  });

  submitRef.current = (data) => {
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
        "Não foi possível carregar os tipos. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Tipos de tarefa"
      searchPlaceholder="Buscar tipos…"
      formId={FORMULARIO_TIPO_TAREFA_ID}
      columnsForCardsToolbar={TIPOS_TAREFA_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja realmente excluir este tipo?",
        descriptionMany: (n) => `Deseja realmente excluir ${n} tipos selecionados?`,
      }}
      recordForm={
        <FormularioTipoTarefa
          key={`${controller.editingItem?.id ?? "tipo-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={controller.editingItem}
          grupos={grupos}
          isEditing={!!controller.editingItem?.id}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
        />
      }
      listSlot={
        <TabelaTiposTarefa
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

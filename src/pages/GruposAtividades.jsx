import React, { useCallback, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import FormularioGrupoAtividade, {
  FORMULARIO_GRUPO_ATIVIDADE_ID,
} from "@/components/grupos-atividades/FormularioGrupoAtividade";
import TabelaGruposAtividades, {
  GRUPOS_ATIVIDADES_COLUNAS,
  getGrupoAtividadeFieldValue,
} from "@/components/grupos-atividades/TabelaGruposAtividades";
import { listarGrupos, criarGrupo, atualizarGrupo, excluirGrupos } from "@/services/tarefaCadastroService";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";

export default function GruposAtividades() {
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));

  const fetchAll = useCallback(() => listarGrupos(), []);

  const controller = useCadastroBase1FullListController({
    storageKey: "colunas_grupos_atividades",
    columnIds: GRUPOS_ATIVIDADES_COLUNAS.map((c) => c.id),
    queryKey: ["grupos-atividades"],
    fetchAll,
    duplicateLabelField: "nome_grupo",
    exportFileName: "grupos-atividades.csv",
    exportColumns: GRUPOS_ATIVIDADES_COLUNAS,
    getExportFieldValue: getGrupoAtividadeFieldValue,
    getRecordTitle: (item) =>
      item?.id ? item.nome_grupo || "Grupo" : "Novo grupo de atividades",
    getSearchHaystack: (g) =>
      [g.nome_grupo, g.descricao, g.observacoes].filter(Boolean).join(" "),
    mapSearchSuggestion: (g) => ({
      id: String(g.id),
      label: g.nome_grupo || "Grupo",
      secondary: g.descricao || undefined,
    }),
    matchRowId: (g, id) => String(g.id) === String(id),
    getRowId: (g) => String(g.id),
    findRowById: (rows, id) => rows.find((g) => String(g.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  const createMutation = useMutation({
    mutationFn: (data) => criarGrupo(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      controller.recordHelpers.recordBeforeNewRef.current = null;
      if (created && typeof created === "object" && created.id) {
        controller.recordHelpers.setEditingItem(created);
        controller.recordHelpers.setIsEditing(false);
        controller.recordHelpers.setShowForm(true);
        controller.recordHelpers.chrome.setViewMode("record");
        controller.recordHelpers.chrome.onSelectionChange([String(created.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", "Grupo cadastrado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o grupo.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarGrupo({ id, dados: data, oldData }),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Grupo atualizado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o grupo.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => excluirGrupos(ids, { grupos: controller.allItems }),
    onSuccess: ({ excluidos, bloqueados }) => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidos.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidos.length) {
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Grupo excluído" });
      }
      if (bloqueados.length) {
        notifyError(
          "Atenção",
          bloqueados.length === 1
            ? "1 grupo não pôde ser excluído: existem registros vinculados."
            : `${bloqueados.length} grupos não puderam ser excluídos: existem registros vinculados.`,
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
        "Não foi possível carregar os grupos. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Grupos de atividades"
      searchPlaceholder="Buscar grupos…"
      formId={FORMULARIO_GRUPO_ATIVIDADE_ID}
      columnsForCardsToolbar={GRUPOS_ATIVIDADES_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja realmente excluir este grupo?",
        descriptionMany: (n) => `Deseja realmente excluir ${n} grupos selecionados?`,
      }}
      recordForm={
        <FormularioGrupoAtividade
          key={`${controller.editingItem?.id ?? "grupo-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={controller.editingItem}
          isEditing={!!controller.editingItem?.id}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
        />
      }
      listSlot={
        <TabelaGruposAtividades
          grupos={controller.visibleRows}
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

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  listarSetoresPagina,
  criarSetor,
  atualizarSetor,
  excluirSetor,
} from "@/services/setorService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifyError, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaSetores, { SETORES_COLUNAS, getSetorFieldValue } from "@/components/setores/TabelaSetores";
import FormularioSetor, { FORMULARIO_SETOR_ID } from "@/components/setores/FormularioSetor";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

const SETORES_STORAGE_KEY = "colunas_largura_setores";

const normalizeSetorForForm = (setor) => {
  if (!setor) return setor;
  return {
    ...setor,
    area_total: setor.area_total != null && setor.area_total !== "" ? setor.area_total : "",
    capacidade_animais:
      setor.capacidade_animais != null && setor.capacidade_animais !== "" ? setor.capacidade_animais : "",
  };
};

export default function CadastroSetores() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaSelecionadaId();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const prevEmpresaRef = useRef(empresaId);

  const fetchSetoresPage = useCallback(
    ({ limit, cursor, q }) =>
      listarSetoresPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
      }),
    [empresaId],
  );

  const controller = useCadastroBase1Controller({
    storageKey: SETORES_STORAGE_KEY,
    columnIds: SETORES_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaId),
    queryKey: ["setores", "page", empresaId],
    fetchPage: fetchSetoresPage,
    duplicateLabelField: "nome",
    searchPlaceholder: "Buscar setores…",
    exportFileName: "setores.csv",
    exportColumns: SETORES_COLUNAS,
    getExportFieldValue: getSetorFieldValue,
    getRecordTitle: (item) =>
      item?.id ? item.nome || "Setor / fazenda" : "Novo setor / fazenda",
    getRecordCode: (item) => (item?.sigla ? String(item.sigla) : undefined),
    getSearchHaystack: (s) =>
      [s.nome, s.sigla, s.cidade, s.responsavel, s.numero_setor].filter(Boolean).join(" "),
    mapSearchSuggestion: (s) => ({
      id: String(s.id),
      label: s.nome || "Setor",
      secondary: s.sigla ? s.sigla : s.numero_setor ? `Nº ${s.numero_setor}` : undefined,
    }),
    matchRowId: (s, id) => String(s.id) === String(id),
    getRowId: (s) => String(s.id),
    findRowById: (rows, id) => rows.find((s) => String(s.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  useEffect(() => {
    if (prevEmpresaRef.current === empresaId) return;
    prevEmpresaRef.current = empresaId;
    controller.recordHelpers.closeForm();
    controller.chrome.setSelectedIds([]);
    controller.handleClearFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset só quando empresa muda
  }, [empresaId]);

  const createMutation = useMutation({
    mutationFn: (data) => criarSetor(data, { empresaId }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["setores"] });
      controller.recordHelpers.recordBeforeNewRef.current = null;
      if (created && typeof created === "object" && created.id) {
        controller.recordHelpers.setEditingItem(normalizeSetorForForm(created));
        controller.recordHelpers.setIsEditing(false);
        controller.recordHelpers.setShowForm(true);
        controller.recordHelpers.chrome.setViewMode("record");
        controller.recordHelpers.chrome.onSelectionChange([String(created.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", "Setor cadastrado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o setor.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarSetor(id, data, { registroAnterior: oldData }),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ["setores"] });
      const merged = normalizeSetorForForm({
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      });
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Setor atualizado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o setor.")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) {
        await excluirSetor(id);
      }
    },
    onError: (err) => {
      controller.setDeleteState({ open: false, ids: [] });
      notifyError("Atenção", getApiErrorMessage(err, "Exclusão indisponível."));
    },
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

  const recordCode = controller.editingItem?.sigla ? String(controller.editingItem.sigla) : undefined;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar os setores. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const screenController = { ...controller, saving };

  const editingForForm = normalizeSetorForForm(controller.editingItem);

  return (
    <CadastroBase1Screen
      workspaceTitle="Setores / fazendas"
      searchPlaceholder="Buscar setores…"
      formId={FORMULARIO_SETOR_ID}
      columnsForCardsToolbar={SETORES_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      recordCode={recordCode}
      deleteDialog={{
        title: "Exclusão indisponível",
        descriptionOne:
          "A exclusão de setores está indisponível enquanto o cadastro é migrado para o sistema próprio. As áreas, tarefas e movimentações que apontam para o setor ainda vivem na plataforma antiga, e apagá-lo agora deixaria esses vínculos apontando para o vazio.",
        descriptionMany: (n) =>
          `A exclusão de ${n} setores está indisponível enquanto o cadastro é migrado para o sistema próprio.`,
      }}
      recordForm={
        <FormularioSetor
          key={`${controller.editingItem?.id ?? "setor-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={editingForForm}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
        />
      }
      listSlot={
        <TabelaSetores
          setores={controller.visibleRows}
          onEdit={(setor) => controller.handleEdit(normalizeSetorForForm(setor))}
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

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  listarUnidadesPagina,
  criarUnidade,
  atualizarUnidade,
  numerarUnidadesSemNumero,
  excluirUnidades,
} from "@/services/unidadeMedidaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaUnidadesMedida, {
  UNIDADES_COLUNAS,
  getUnidadeFieldValue,
} from "@/components/unidades-medida/TabelaUnidadesMedida";
import FormularioUnidadeMedida, {
  FORMULARIO_UNIDADE_MEDIDA_ID,
} from "@/components/unidades-medida/FormularioUnidadeMedida";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";

const UNIDADES_STORAGE_KEY = "colunas_unidades_medida";

export default function UnidadesMedida() {
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));

  const fetchUnidadesPage = useCallback(
    ({ limit, cursor, q }) =>
      listarUnidadesPagina({
        limit,
        cursor,
        q: q || undefined,
      }),
    [],
  );

  const controller = useCadastroBase1Controller({
    storageKey: UNIDADES_STORAGE_KEY,
    columnIds: UNIDADES_COLUNAS.map((c) => c.id),
    queryKey: ["unidades_medida", "page"],
    fetchPage: fetchUnidadesPage,
    duplicateLabelField: "descricao",
    searchPlaceholder: "Buscar unidades…",
    exportFileName: "unidades-medida.csv",
    exportColumns: UNIDADES_COLUNAS,
    getExportFieldValue: getUnidadeFieldValue,
    getRecordTitle: (item) =>
      item?.id ? item.descricao || item.sigla || "Unidade" : "Nova unidade de medida",
    getRecordCode: (item) => (item?.sigla ? String(item.sigla) : undefined),
    getSearchHaystack: (u) => [u.sigla, u.descricao, u.numero_unidade].filter(Boolean).join(" "),
    mapSearchSuggestion: (u) => ({
      id: String(u.id),
      label: u.descricao || u.sigla || "Unidade",
      secondary: u.sigla ? u.sigla : u.numero_unidade ? `Nº ${u.numero_unidade}` : undefined,
    }),
    matchRowId: (u, id) => String(u.id) === String(id),
    getRowId: (u) => String(u.id),
    findRowById: (rows, id) => rows.find((u) => String(u.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  useEffect(() => {
    const numerar = async () => {
      const { numeradas } = await numerarUnidadesSemNumero(controller.visibleRows);
      if (numeradas.length) queryClient.invalidateQueries({ queryKey: ["unidades_medida"] });
    };
    if (!controller.isLoading && controller.visibleRows.length > 0) numerar();
  }, [controller.visibleRows, controller.isLoading, queryClient]);

  const createMutation = useMutation({
    mutationFn: (data) => criarUnidade(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["unidades_medida"] });
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
      notifySuccess("Sucesso", "Unidade cadastrada");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a unidade.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => atualizarUnidade(id, data),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ["unidades_medida"] });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Unidade atualizada");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a unidade.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => excluirUnidades(ids, { unidades: controller.visibleRows }),
    onSuccess: ({ excluidas, bloqueadas }) => {
      queryClient.invalidateQueries({ queryKey: ["unidades_medida"] });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidas.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidas.length) {
        notifyExclusoesEmpilhadas(excluidas.length, { singular: "Unidade excluída" });
      }
      if (bloqueadas.length) {
        notifyError(
          "Atenção",
          bloqueadas.length === 1
            ? "1 unidade não pôde ser excluída: existem registros vinculados."
            : `${bloqueadas.length} unidades não puderam ser excluídas: existem registros vinculados.`,
        );
      }
    },
    onError: (err) =>
      notifyError("Atenção", getApiErrorMessage(err, "Não foi possível excluir.")),
  });

  submitRef.current = (data) => {
    if (controller.editingItem?.id) {
      updateMutation.mutate({ id: controller.editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };
  deleteRef.current = (ids) => deleteMutation.mutate(ids);

  const saving = createMutation.isPending || updateMutation.isPending;

  const recordCode =
    controller.editingItem?.sigla != null
      ? String(controller.editingItem.sigla)
      : undefined;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar as unidades. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  return (
    <CadastroBase1Screen
      workspaceTitle="Unidades de medida"
      searchPlaceholder="Buscar unidades…"
      formId={FORMULARIO_UNIDADE_MEDIDA_ID}
      columnsForCardsToolbar={UNIDADES_COLUNAS}
      controller={{ ...controller, saving }}
      listErrorMessage={listErrorMessage}
      recordCode={recordCode}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja excluir esta unidade?",
        descriptionMany: (n) => `Deseja excluir ${n} unidades selecionadas?`,
      }}
      recordForm={
        <FormularioUnidadeMedida
          key={`${controller.editingItem?.id ?? "unidade-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={controller.editingItem}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
        />
      }
      listSlot={
        <TabelaUnidadesMedida
          unidades={controller.visibleRows}
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

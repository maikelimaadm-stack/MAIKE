import React, { useCallback, useMemo, useRef } from "react";
import {
  criarMarca,
  atualizarMarca,
  excluirMarcas,
  listarMarcasPagina,
} from "@/services/marcaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaMarcas, { MARCAS_COLUNAS, getMarcaFieldValue } from "@/components/marcas/TabelaMarcas";
import FormularioMarca, { FORMULARIO_MARCA_ID } from "@/components/marcas/FormularioMarca";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

const MARCAS_STORAGE_KEY = "colunas_marcas_v1";

export default function Marcas() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaSelecionadaId();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));

  const fetchMarcasPage = useCallback(
    ({ limit, cursor, q }) =>
      listarMarcasPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
      }),
    [empresaId],
  );

  const controller = useCadastroBase1Controller({
    storageKey: MARCAS_STORAGE_KEY,
    columnIds: MARCAS_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaId),
    queryKey: ["marcas", "page", empresaId],
    fetchPage: fetchMarcasPage,
    duplicateLabelField: "nome",
    searchPlaceholder: "Buscar marcas…",
    exportFileName: "marcas.csv",
    exportColumns: MARCAS_COLUNAS,
    getExportFieldValue: getMarcaFieldValue,
    getRecordTitle: (item) => (item?.id ? item.nome || "Marca" : "Nova marca"),
    getRecordCode: (item) => (item?.numero_marca ? String(item.numero_marca) : undefined),
    getSearchHaystack: (m) => [m.nome, m.descricao, m.numero_marca].filter(Boolean).join(" "),
    mapSearchSuggestion: (m) => ({
      id: String(m.id),
      label: m.nome || "Marca",
      secondary: m.numero_marca ? `Nº ${m.numero_marca}` : m.descricao || undefined,
    }),
    matchRowId: (m, id) => String(m.id) === String(id),
    getRowId: (m) => String(m.id),
    findRowById: (rows, id) => rows.find((m) => String(m.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  const createMutation = useMutation({
    /** @param {object} data */
    mutationFn: (data) => criarMarca({ dados: data, empresaId, marcasDaEmpresa: controller.visibleRows }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
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
      notifySuccess("Sucesso", "Marca criada");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a marca.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: object }} vars */
    mutationFn: ({ id, data }) => atualizarMarca(id, data, controller.visibleRows),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Marca atualizada");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a marca.")),
  });

  const deleteMutation = useMutation({
    /** @param {string[]} ids */
    mutationFn: (ids) => excluirMarcas(ids),
    onSuccess: ({ excluidas, falhas }) => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidas.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidas.length) {
        notifyExclusoesEmpilhadas(excluidas.length, { singular: "Registro excluído" });
      }
      if (falhas.length) {
        notifyError(
          "Atenção",
          falhas.length === 1
            ? "1 marca não pôde ser excluída."
            : `${falhas.length} marcas não puderam ser excluídas.`,
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

  const recordCode = controller.editingItem?.numero_marca
    ? String(controller.editingItem.numero_marca)
    : undefined;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar as marcas. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Marcas"
      searchPlaceholder="Buscar marcas…"
      formId={FORMULARIO_MARCA_ID}
      columnsForCardsToolbar={MARCAS_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      recordCode={recordCode}
      deleteDialog={{
        title: "Confirme a exclusão",
        descriptionOne: "Excluir este registro de marca? A ação fica registrada na auditoria.",
        descriptionMany: (n) =>
          `Excluir ${n} registros de marca? A ação fica registrada na auditoria.`,
      }}
      recordForm={
        <FormularioMarca
          key={`${controller.editingItem?.id ?? "marca-nova"}-${controller.formEpoch}`}
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
        <TabelaMarcas
          marcas={controller.visibleRows}
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

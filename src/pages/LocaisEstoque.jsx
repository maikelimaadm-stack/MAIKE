import React, { useCallback, useEffect, useMemo, useRef } from "react";
import {
  listarLocaisPagina,
  criarLocal,
  atualizarLocal,
  numerarLocaisSemNumero,
  excluirLocais,
} from "@/services/localEstoqueService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaLocaisEstoque, {
  LOCAIS_ESTOQUE_COLUNAS,
  getLocalEstoqueFieldValue,
} from "@/components/locais-estoque/TabelaLocaisEstoque";
import FormularioLocalEstoque, {
  FORMULARIO_LOCAL_ESTOQUE_ID,
} from "@/components/locais-estoque/FormularioLocalEstoque";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";

const LOCAIS_STORAGE_KEY = "colunas_locais_estoque";

export default function LocaisEstoque() {
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));

  const fetchLocaisPage = useCallback(
    ({ limit, cursor, q }) =>
      listarLocaisPagina({
        limit,
        cursor,
        q: q || undefined,
      }),
    [],
  );

  const controller = useCadastroBase1Controller({
    storageKey: LOCAIS_STORAGE_KEY,
    columnIds: LOCAIS_ESTOQUE_COLUNAS.map((c) => c.id),
    queryKey: ["locais_estoque", "page"],
    fetchPage: fetchLocaisPage,
    duplicateLabelField: "nome",
    searchPlaceholder: "Buscar locais…",
    exportFileName: "locais-estoque.csv",
    exportColumns: LOCAIS_ESTOQUE_COLUNAS,
    getExportFieldValue: getLocalEstoqueFieldValue,
    getRecordTitle: (item) =>
      item?.id ? item.nome || "Local" : "Novo local de estoque",
    getRecordCode: (item) =>
      item?.numero_local != null ? String(item.numero_local) : undefined,
    getSearchHaystack: (l) =>
      [l.nome, l.descricao, l.capacidade, l.numero_local].filter(Boolean).join(" "),
    mapSearchSuggestion: (l) => ({
      id: String(l.id),
      label: l.nome || "Local",
      secondary: l.numero_local ? `Nº ${l.numero_local}` : undefined,
    }),
    matchRowId: (l, id) => String(l.id) === String(id),
    getRowId: (l) => String(l.id),
    findRowById: (rows, id) => rows.find((l) => String(l.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  useEffect(() => {
    const numerar = async () => {
      const { numerados } = await numerarLocaisSemNumero(controller.visibleRows);
      if (numerados.length) queryClient.invalidateQueries({ queryKey: ["locais_estoque"] });
    };
    if (!controller.isLoading && controller.visibleRows.length > 0) numerar();
  }, [controller.visibleRows, controller.isLoading, queryClient]);

  const invalidateMapa = () => {
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        [
          "pontos",
          "pontos-suplementacao-form",
          "mapa-pontos",
          "mapa-pontos-supl",
          "pontos-suplementacao",
        ].includes(q.queryKey[0]),
    });
    window.dispatchEvent(new CustomEvent("atualizar-mapa"));
  };

  const createMutation = useMutation({
    /** @param {object} data */
    mutationFn: (data) => criarLocal(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["locais_estoque"] });
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
      notifySuccess("Sucesso", "Local cadastrado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o local.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: object }} vars */
    mutationFn: ({ id, data }) =>
      atualizarLocal({ id, dados: data, locais: controller.visibleRows }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locais_estoque"] });
      invalidateMapa();
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Local atualizado");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o local.")),
  });

  const deleteMutation = useMutation({
    /** @param {string[]} ids */
    mutationFn: (ids) => excluirLocais(ids, { locais: controller.visibleRows }),
    onSuccess: ({ excluidos, bloqueados }) => {
      queryClient.invalidateQueries({ queryKey: ["locais_estoque"] });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidos.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidos.length) {
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Local excluído" });
      }
      if (bloqueados.length) {
        notifyError(
          "Atenção",
          bloqueados.length === 1
            ? "1 local não pôde ser excluído: existem registros vinculados."
            : `${bloqueados.length} locais não puderam ser excluídos: existem registros vinculados.`,
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
    controller.editingItem?.numero_local != null
      ? String(controller.editingItem.numero_local)
      : undefined;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar os locais. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  return (
    <CadastroBase1Screen
      workspaceTitle="Locais de estoque"
      searchPlaceholder="Buscar locais…"
      formId={FORMULARIO_LOCAL_ESTOQUE_ID}
      columnsForCardsToolbar={LOCAIS_ESTOQUE_COLUNAS}
      controller={{ ...controller, saving }}
      listErrorMessage={listErrorMessage}
      recordCode={recordCode}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja excluir este local?",
        descriptionMany: (n) => `Deseja excluir ${n} locais selecionados?`,
      }}
      recordForm={
        <FormularioLocalEstoque
          key={`${controller.editingItem?.id ?? "local-novo"}-${controller.formEpoch}`}
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
        <TabelaLocaisEstoque
          locais={controller.visibleRows}
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

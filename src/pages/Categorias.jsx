import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  listarTodasCategorias,
  criarCategoria,
  atualizarCategoria,
  excluirCategorias,
} from "@/services/categoriaProdutoService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { ApiError, API_ERROR_CODES } from "@/apis/_core/ApiError";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaCategoriasProduto, {
  CATEGORIAS_PRODUTO_COLUNAS,
  getCategoriaProdutoFieldValue,
  filterCategoriasRecordNavRows,
  prepareCategoriasExportRows,
  getCategoriasListFooterMetrics,
} from "@/components/categorias-produto/TabelaCategoriasProduto";
import FormularioCategoriaProduto, {
  FORMULARIO_CATEGORIA_ID,
} from "@/components/categorias-produto/FormularioCategoriaProduto";
import { useCadastroBase1HierarchicalController } from "@/hooks/useCadastroBase1HierarchicalController";

const toastPersistencia = (registro, mensagemOk) => {
  if (registro?._isOffline || String(registro?.id || "").startsWith("offline_")) {
    toast.message("Pendente de sincronização — será enviado quando a conexão voltar.");
    return;
  }
  notifySuccess("Sucesso", mensagemOk);
};

export default function Categorias() {
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const [renderedListados, setRenderedListados] = useState(0);
  const revealRowIdRef = useRef(/** @type {string|null} */ (null));

  const fetchAll = useCallback(() => listarTodasCategorias(), []);

  const filterRecordNavRows = useCallback(
    (items, ctx) => filterCategoriasRecordNavRows(items, ctx),
    [],
  );

  const prepareExportRows = useCallback(
    (items, ctx) => prepareCategoriasExportRows(items, ctx),
    [],
  );

  const getListFooterMetrics = useCallback(
    (items, ctx) => {
      const base = getCategoriasListFooterMetrics(items, {
        ...ctx,
        revealRowId: revealRowIdRef.current,
      });
      if (renderedListados > 0) {
        return { ...base, listados: renderedListados };
      }
      return base;
    },
    [renderedListados],
  );

  const controller = useCadastroBase1HierarchicalController({
    storageKey: "colunas_categorias_produto",
    columnIds: CATEGORIAS_PRODUTO_COLUNAS.map((c) => c.id),
    queryKey: ["categorias_produto"],
    fetchAll,
    filterRecordNavRows,
    prepareExportRows,
    getListFooterMetrics,
    duplicateLabelField: "nome",
    exportFileName: "categorias-produto.csv",
    exportColumns: CATEGORIAS_PRODUTO_COLUNAS,
    getExportFieldValue: getCategoriaProdutoFieldValue,
    getRecordTitle: (item) =>
      item?.id ? item.nome || "Categoria" : "Nova categoria",
    getRecordCode: (item) =>
      item?.numero_categoria != null ? String(item.numero_categoria) : undefined,
    getSearchHaystack: (c) => [c.nome, c.descricao].filter(Boolean).join(" "),
    mapSearchSuggestion: (c) => ({
      id: String(c.id),
      label: c.nome || "Categoria",
      secondary: c.numero_categoria ? `Nº ${c.numero_categoria}` : c.descricao || undefined,
    }),
    matchRowId: (c, id) => String(c.id) === String(id),
    getRowId: (c) => String(c.id),
    findRowById: (rows, id) => rows.find((c) => String(c.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  revealRowIdRef.current = controller.revealRowId;

  const createMutation = useMutation({
    /** @param {object} data */
    mutationFn: (data) => criarCategoria(data),
    onSuccess: async (criada) => {
      await queryClient.refetchQueries({ queryKey: ["categorias_produto"] });
      controller.recordHelpers.recordBeforeNewRef.current = null;
      if (criada?.id) {
        controller.recordHelpers.revealRow(String(criada.id));
        controller.recordHelpers.setEditingItem(criada);
        controller.recordHelpers.setIsEditing(false);
        controller.recordHelpers.setShowForm(true);
        controller.recordHelpers.chrome.setViewMode("record");
        controller.recordHelpers.chrome.onSelectionChange([String(criada.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      toastPersistencia(criada, "Categoria criada");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível concluir a operação.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: object }} vars */
    mutationFn: ({ id, data }) => atualizarCategoria(id, data),
    onSuccess: async (atualizada, { id, data }) => {
      await queryClient.refetchQueries({ queryKey: ["categorias_produto"] });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(atualizada && typeof atualizada === "object" ? atualizada : {}),
      };
      if (atualizada?.id) {
        controller.recordHelpers.revealRow(String(atualizada.id));
        controller.recordHelpers.chrome.onSelectionChange([String(atualizada.id)]);
      }
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      toastPersistencia(atualizada, "Categoria atualizada");
    },
    onError: (err) =>
      notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível concluir a operação.")),
  });

  const deleteMutation = useMutation({
    /** @param {string[]} ids */
    mutationFn: (ids) => excluirCategorias(ids),
    /** @param {{ excluidas: string[] }} result */
    onSuccess: ({ excluidas }) => {
      queryClient.invalidateQueries({ queryKey: ["categorias_produto"] });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidas.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidas.length) {
        notifyExclusoesEmpilhadas(excluidas.length, { singular: "Categoria excluída" });
      }
    },
    onError: (err) => {
      controller.setDeleteState({ open: false, ids: [] });
      if (err instanceof ApiError && err.code === API_ERROR_CODES.CATEGORIA_HAS_CHILDREN) {
        notifyError(
          "Atenção",
          "Não é possível excluir categorias que ainda possuem subcategorias.",
        );
        return;
      }
      if (err instanceof ApiError && err.code === API_ERROR_CODES.CATEGORIA_PARTIAL_DELETE) {
        queryClient.invalidateQueries({ queryKey: ["categorias_produto"] });
        notifyWarning(
          "Atenção",
          "Exclusão parcial — algumas categorias não puderam ser removidas. A lista foi atualizada.",
        );
        return;
      }
      notifyError("Atenção", getApiErrorMessage(err, "Erro ao excluir"));
    },
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

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar as categorias. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const screenController = /** @type {import('@/hooks/useCadastroBase1Controller').CadastroBase1ControllerSurface} */ ({
    ...controller,
    saving,
  });

  const recordCode = controller.editingItem?.numero_categoria
    ? String(controller.editingItem.numero_categoria)
    : undefined;

  const handleListMetrics = useCallback((metrics) => {
    if (typeof metrics?.listados === "number") {
      setRenderedListados(metrics.listados);
    }
  }, []);

  return (
    <CadastroBase1Screen
      workspaceTitle="Categorias de produtos"
      searchPlaceholder="Buscar categorias…"
      createLabel="Novo"
      formId={FORMULARIO_CATEGORIA_ID}
      columnsForCardsToolbar={CATEGORIAS_PRODUTO_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      recordCode={recordCode}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja excluir esta categoria?",
        descriptionMany: (n) => `Deseja excluir ${n} categorias selecionadas?`,
      }}
      recordForm={
        <FormularioCategoriaProduto
          key={`${controller.editingItem?.id ?? "cat-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={controller.editingItem}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
          categoriasExistentes={controller.allItems}
        />
      }
      listSlot={
        <TabelaCategoriasProduto
          categorias={controller.allItems}
          revealCategoriaId={controller.revealRowId}
          onEdit={controller.handleEdit}
          onDelete={controller.handleRequestDelete}
          isLoading={controller.isLoading}
          showConfigColunas={controller.showConfigColunas}
          setShowConfigColunas={controller.setShowConfigColunas}
          searchQuery={controller.chrome.appliedSearch}
          searchPickId={controller.searchPickId}
          resetFiltersKey={controller.chrome.resetFiltersKey}
          onSelectionChange={controller.chrome.onSelectionChange}
          onFiltersActiveChange={controller.chrome.setFiltersActive}
          viewMode={controller.chrome.viewMode === "cards" ? "cards" : "table"}
          cardFields={controller.cardsPrefs.cardFields}
          cardsPerRow={controller.cardsPrefs.cardsPerRow}
          configureColumnsAnchorRef={controller.configureColumnsAnchorRef}
          onListMetrics={handleListMetrics}
        />
      }
    />
  );
}

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import {
  listarCategoriasManejoDaEmpresa,
  listarIconesDeLoteDaEmpresa,
  criarCategoriaManejo,
  atualizarCategoriaManejo,
  excluirCategoriaManejo,
} from "@/services/categoriaManejoService";
import { getApiErrorMessage, hasApiErrorCode, API_ERROR_CODES } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  notifyError,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaCategoriasManejo, {
  CATEGORIAS_MANEJO_COLUNAS,
  getCategoriaManejoFieldValue,
} from "@/components/categorias-manejo/TabelaCategoriasManejo";
import FormularioCategoriaManejo, {
  FORMULARIO_CATEGORIA_MANEJO_ID,
  getInitialFormData,
  buildFormInitialFromRecord,
} from "@/components/categorias-manejo/FormularioCategoriaManejo";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";

const EMPTY_ICONES_CONFIG = [];

export default function CategoriasManejo() {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const queryClient = useQueryClient();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const prevEmpresaRef = useRef(empresaSelecionadaId);

  const fetchAll = useCallback(
    () => listarCategoriasManejoDaEmpresa(empresaSelecionadaId),
    [empresaSelecionadaId],
  );

  const controller = useCadastroBase1FullListController({
    storageKey: "colunas_largura_categorias_manejo",
    columnIds: CATEGORIAS_MANEJO_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaSelecionadaId),
    queryKey: ["categorias-manejo", empresaSelecionadaId],
    fetchAll,
    duplicateLabelField: "nome",
    exportFileName: "categorias-manejo.csv",
    exportColumns: CATEGORIAS_MANEJO_COLUNAS,
    getExportFieldValue: getCategoriaManejoFieldValue,
    getRecordTitle: (item) =>
      item?.id ? item.nome || "Categoria" : "Nova categoria de manejo",
    getRecordCode: (item) => (item?.sigla ? String(item.sigla) : undefined),
    getSearchHaystack: (c) =>
      [c.nome, c.sigla, c.raca, c.categoria_oficial, c.especie, c.sexo].filter(Boolean).join(" "),
    mapSearchSuggestion: (c) => ({
      id: String(c.id),
      label: c.nome || "Categoria",
      secondary: c.sigla ? String(c.sigla) : undefined,
    }),
    matchRowId: (c, id) => String(c.id) === String(id),
    getRowId: (c) => String(c.id),
    findRowById: (rows, id) => rows.find((c) => String(c.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  useEffect(() => {
    if (prevEmpresaRef.current === empresaSelecionadaId) return;
    prevEmpresaRef.current = empresaSelecionadaId;
    controller.recordHelpers.closeForm();
    controller.chrome.setSelectedIds([]);
    controller.handleClearFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- troca de empresa
  }, [empresaSelecionadaId]);

  const { data: iconesConfigData } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => listarIconesDeLoteDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });
  const iconesConfig = iconesConfigData ?? EMPTY_ICONES_CONFIG;

  const categoriasOficiaisDisponiveis = useMemo(() => {
    const categoriasPadrao = [
      "Bezerro 0 a 12 meses",
      "Bezerra 0 a 12 meses",
      "Garrote 13 a 24 meses",
      "Novilha 13 a 24 meses",
      "Boi 25 a 36 meses",
      "Vaca 25 a 36 meses",
      "Touro + 36 meses",
      "Vaca + 36 meses",
    ];
    const categoriasIcones = iconesConfig
      .filter((ic) => ic.tipo_entidade === "Lote")
      .map((ic) => ic.categoria)
      .filter((cat) => cat && cat.toUpperCase() !== "MISTO");
    return [...new Set([...categoriasPadrao, ...categoriasIcones])].sort();
  }, [iconesConfig]);

  const createMutation = useMutation({
    mutationFn: (formData) => criarCategoriaManejo(formData, { empresaId: empresaSelecionadaId }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["categorias-manejo"] });
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
      notifySuccess("Sucesso", "Categoria cadastrada");
    },
    onError: (error) =>
      notifyWarning("Atenção", getApiErrorMessage(error, "Não foi possível cadastrar a categoria.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, oldData }) =>
      atualizarCategoriaManejo(id, data, { empresaId: empresaSelecionadaId, oldData }),
    onSuccess: (updated, { id, data }) => {
      queryClient.invalidateQueries({ queryKey: ["categorias-manejo"] });
      const merged = {
        ...(controller.editingItem?.id === id ? controller.editingItem : {}),
        id,
        ...data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Categoria atualizada");
    },
    onError: (error) =>
      notifyWarning("Atenção", getApiErrorMessage(error, "Não foi possível atualizar a categoria.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => {
      const [firstId] = ids;
      if (!firstId) return Promise.resolve({ excluidos: [], bloqueados: ids });
      if (ids.length > 1) {
        return Promise.resolve({ excluidos: [], bloqueados: ids.slice(1) });
      }
      return excluirCategoriaManejo(firstId).then(() => ({ excluidos: [firstId], bloqueados: [] }));
    },
    onSuccess: ({ excluidos, bloqueados }) => {
      queryClient.invalidateQueries({ queryKey: ["categorias-manejo"] });
      controller.chrome.setSelectedIds([]);
      if (
        controller.showForm &&
        controller.editingItem?.id &&
        excluidos.some((id) => String(id) === String(controller.editingItem.id))
      ) {
        controller.recordHelpers.closeForm();
      }
      if (excluidos.length) {
        notifySuccess("Sucesso", "Categoria excluída");
      }
      if (bloqueados.length) {
        notifyError(
          "Atenção",
          "Exclusão em lote não disponível — exclua um registro por vez. Registros vinculados são bloqueados automaticamente.",
        );
      }
    },
    onError: (error) => {
      if (hasApiErrorCode(error, API_ERROR_CODES.CATEGORIA_MANEJO_DELETE_BLOCKED)) return;
      notifyError("Atenção", getApiErrorMessage(error, "Erro ao excluir."));
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

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar as categorias. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const formInitialData = controller.editingItem?.id
    ? buildFormInitialFromRecord(controller.editingItem)
    : getInitialFormData();

  const recordCode = controller.editingItem?.sigla ? String(controller.editingItem.sigla) : undefined;

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Categorias de manejo"
      searchPlaceholder="Buscar categorias…"
      formId={FORMULARIO_CATEGORIA_MANEJO_ID}
      columnsForCardsToolbar={CATEGORIAS_MANEJO_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      recordCode={recordCode}
      deleteDialog={{
        title: "Excluir categoria de manejo",
        descriptionOne:
          "Se esta categoria possuir registros lançados, a exclusão será bloqueada automaticamente.",
        descriptionMany: () =>
          "Exclusão em lote não está disponível nesta tela — selecione um registro por vez.",
      }}
      recordForm={
        <FormularioCategoriaManejo
          key={`${controller.editingItem?.id ?? "cat-manejo-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={formInitialData}
          isEditing={!!controller.editingItem?.id}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
          categoriasOficiaisDisponiveis={categoriasOficiaisDisponiveis}
        />
      }
      listSlot={
        <TabelaCategoriasManejo
          categorias={controller.visibleRows}
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

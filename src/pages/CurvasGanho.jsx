import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  notifyError,
  notifyExclusoesEmpilhadas,
  notifyInfo,
  notifySuccess,
  notifyWarning,
} from "@/lib/maikeNotify";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import FormularioCurvaGanho, { FORMULARIO_CURVA_GANHO_ID } from "@/components/curvas-ganho/FormularioCurvaGanho";
import TabelaCurvasGanho, {
  CURVAS_GANHO_COLUNAS,
  CURVAS_GANHO_STORAGE_KEY,
  getCurvaGanhoFieldValue,
} from "@/components/curvas-ganho/TabelaCurvasGanho";
import {
  listarCurvasGanho,
  criarCurvaGanho,
  atualizarCurvaGanho,
  excluirCurvasGanho,
} from "@/services/curvaGanhoCadastroService";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";
import { useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";

const QUERY_RAIZ = "curvas-ganho";

/**
 * Cadastro de Curvas de Ganho de Peso da fazenda (D-PROD-189; mensal desde a
 * D-PROD-190), tabela CADCURVAGANHO.
 *
 * GMD (kg/dia) de cada mês, de janeiro a dezembro, da fazenda selecionada no
 * topo. A curva não depende das Estações, e nada mais lê as curvas ainda: é só
 * o cadastro.
 */
export default function CurvasGanho() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

  const fetchAll = useCallback(() => listarCurvasGanho(/** @type {string} */ (empresaId)), [empresaId]);

  const controller = useCadastroBase1FullListController({
    storageKey: CURVAS_GANHO_STORAGE_KEY,
    columnIds: CURVAS_GANHO_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaId),
    queryKey: [QUERY_RAIZ, empresaId],
    fetchAll,
    duplicateLabelField: "nome",
    exportFileName: "curvas-ganho.csv",
    exportColumns: CURVAS_GANHO_COLUNAS,
    getExportFieldValue: (/** @type {any} */ item, /** @type {string} */ colId) => getCurvaGanhoFieldValue(item, colId),
    getRecordTitle: (/** @type {any} */ item) => (item?.id ? item.nome || "Curva de ganho" : "Nova curva de ganho"),
    getRecordCode: () => undefined,
    getSearchHaystack: (/** @type {any} */ e) =>
      [e.nome, e.observacoes].filter(Boolean).join(" "),
    mapSearchSuggestion: (/** @type {any} */ e) => ({
      id: String(e.id),
      label: e.nome || "Curva de ganho",
      secondary: undefined,
    }),
    matchRowId: (/** @type {any} */ e, /** @type {string} */ id) => String(e.id) === String(id),
    getRowId: (/** @type {any} */ e) => String(e.id),
    findRowById: (/** @type {any} */ rows, /** @type {string} */ id) =>
      rows.find((/** @type {any} */ e) => String(e.id) === String(id)),
    onSubmitRecord: (/** @type {object} */ data) => submitRef.current(data),
    onRequestDeleteMutation: (/** @type {string[]} */ ids) => deleteRef.current(ids),
  });

  // Trocar de fazenda: a curva aberta, a seleção e a busca (inclusive a
  // sugestão escolhida, que filtra por id) são da fazenda anterior. Fecha o
  // registro só se havia um aberto, para não tirar a lista do modo cartões.
  const empresaAnterior = useRef(empresaId);
  const controllerAtual = useRef(controller);
  controllerAtual.current = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    const c = controllerAtual.current;
    if (c.showForm) c.recordHelpers.closeForm();
    c.chrome.setSelectedIds([]);
    c.handleClearFilters();
  }, [empresaId]);

  // Resposta de gravação que chega depois de trocar a fazenda não mexe no
  // registro aberto da fazenda nova: só relê as listas.
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {string|null|undefined} id */
  const daEmpresaAtual = (id) => Boolean(id) && id === empresaAtual.current;
  const avisarEmpresaAnterior = () =>
    notifyInfo("Gravação concluída", "A gravação feita na fazenda anterior foi concluída.");
  const invalidar = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });

  const createMutation = useMutation({
    /** @param {{ data: Record<string, unknown>, empresaId: string }} vars */
    mutationFn: ({ data, empresaId: empresa }) => criarCurvaGanho(data, { empresaId: empresa }),
    onSuccess: (/** @type {any} */ created, vars) => {
      invalidar();
      if (!daEmpresaAtual(vars.empresaId)) {
        avisarEmpresaAnterior();
        return;
      }
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
      notifySuccess("Sucesso", "Curva de ganho cadastrada");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a curva de ganho.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: Record<string, unknown>, empresaId: string }} vars */
    mutationFn: ({ id, data, empresaId: empresa }) => atualizarCurvaGanho({ id, dados: data, empresaId: empresa }),
    onSuccess: (/** @type {any} */ updated, vars) => {
      invalidar();
      if (!daEmpresaAtual(vars.empresaId)) {
        avisarEmpresaAnterior();
        return;
      }
      const merged = {
        ...(controller.editingItem?.id === vars.id ? controller.editingItem : {}),
        id: vars.id,
        ...vars.data,
        ...(updated && typeof updated === "object" ? updated : {}),
      };
      controller.setEditingItem(merged);
      controller.setIsEditing(false);
      notifySuccess("Sucesso", "Curva de ganho atualizada");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a curva de ganho.")),
  });

  const deleteMutation = useMutation({
    /** @param {{ ids: string[], empresaId: string }} vars */
    mutationFn: ({ ids, empresaId: empresa }) => excluirCurvasGanho(ids, { empresaId: empresa }),
    onSuccess: ({ excluidos, bloqueados }, vars) => {
      invalidar();
      if (daEmpresaAtual(vars.empresaId)) {
        controller.chrome.setSelectedIds([]);
        if (
          controller.showForm &&
          controller.editingItem?.id &&
          excluidos.some((id) => String(id) === String(controller.editingItem.id))
        ) {
          controller.recordHelpers.closeForm();
        }
      }
      if (excluidos.length) {
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Curva de ganho excluída" });
      }
      if (bloqueados.length) {
        notifyError(
          "Atenção",
          bloqueados.length === 1
            ? "1 curva de ganho não pôde ser excluída."
            : `${bloqueados.length} curvas de ganho não puderam ser excluídas.`,
        );
      }
    },
    onError: (err) => notifyError("Atenção", getApiErrorMessage(err, "Não foi possível excluir.")),
  });

  submitRef.current = (/** @type {any} */ data) => {
    if (!empresaId) {
      notifyWarning("Atenção", "Selecione uma fazenda antes de gravar.");
      return;
    }
    if (controller.editingItem?.id) {
      updateMutation.mutate({ id: controller.editingItem.id, data, empresaId });
    } else {
      createMutation.mutate({ data, empresaId });
    }
  };
  deleteRef.current = (ids) => {
    if (!empresaId) return;
    deleteMutation.mutate({ ids, empresaId });
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const listErrorMessage = useMemo(
    () =>
      getApiErrorMessage(
        controller.listaQueryError,
        "Não foi possível carregar as curvas de ganho. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const aviso = empresaId ? null : (
    <AvisoGestao testId="curvas-ganho-sem-fazenda">
      Selecione uma fazenda no topo da tela para ver e cadastrar curvas de ganho.
    </AvisoGestao>
  );

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Curvas de Ganho"
      searchPlaceholder="Buscar curvas de ganho…"
      formId={FORMULARIO_CURVA_GANHO_ID}
      columnsForCardsToolbar={CURVAS_GANHO_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      listBanner={aviso}
      showCreate={podeGravar}
      showDuplicate={podeGravar}
      showEdit={podeGravar}
      showDelete={podeGravar}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja realmente excluir esta curva de ganho?",
        descriptionMany: (/** @type {number} */ n) => `Deseja realmente excluir ${n} curvas de ganho selecionadas?`,
      }}
      recordForm={
        <FormularioCurvaGanho
          key={`${controller.editingItem?.id ?? "curva-ganho-nova"}-${controller.formEpoch}`}
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
        <TabelaCurvasGanho
          rows={controller.visibleRows}
          emptyText={empresaId ? "Nenhuma curva de ganho encontrada" : "Selecione uma fazenda"}
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

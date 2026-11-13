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
import FormularioEstacao, { FORMULARIO_ESTACAO_ID } from "@/components/estacoes/FormularioEstacao";
import TabelaEstacoes, {
  ESTACOES_COLUNAS,
  ESTACOES_STORAGE_KEY,
  getEstacaoFieldValue,
} from "@/components/estacoes/TabelaEstacoes";
import {
  listarEstacoes,
  criarEstacao,
  atualizarEstacao,
  excluirEstacoes,
  rotuloTipoEstacao,
} from "@/services/estacaoCadastroService";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";
import { useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";

const QUERY_RAIZ = "estacoes";

/**
 * Cadastro de Estações da fazenda (D-PROD-188), tabela CADESTACOES.
 *
 * Períodos de ÁGUAS, TRANSIÇÃO e SECA da fazenda selecionada no topo. Nesta
 * primeira fatia nada mais lê as estações: é só o registro dos períodos.
 */
export default function Estacoes() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

  const fetchAll = useCallback(() => listarEstacoes(/** @type {string} */ (empresaId)), [empresaId]);

  const controller = useCadastroBase1FullListController({
    storageKey: ESTACOES_STORAGE_KEY,
    columnIds: ESTACOES_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaId),
    queryKey: [QUERY_RAIZ, empresaId],
    fetchAll,
    duplicateLabelField: "nome",
    exportFileName: "estacoes.csv",
    exportColumns: ESTACOES_COLUNAS,
    getExportFieldValue: (/** @type {any} */ item, /** @type {string} */ colId) => getEstacaoFieldValue(item, colId),
    getRecordTitle: (/** @type {any} */ item) => (item?.id ? item.nome || "Estação" : "Nova estação"),
    getRecordCode: () => undefined,
    getSearchHaystack: (/** @type {any} */ e) =>
      [e.nome, rotuloTipoEstacao(e.tipo), e.observacoes].filter(Boolean).join(" "),
    mapSearchSuggestion: (/** @type {any} */ e) => ({
      id: String(e.id),
      label: e.nome || "Estação",
      secondary: rotuloTipoEstacao(e.tipo) || undefined,
    }),
    matchRowId: (/** @type {any} */ e, /** @type {string} */ id) => String(e.id) === String(id),
    getRowId: (/** @type {any} */ e) => String(e.id),
    findRowById: (/** @type {any} */ rows, /** @type {string} */ id) =>
      rows.find((/** @type {any} */ e) => String(e.id) === String(id)),
    onSubmitRecord: (/** @type {object} */ data) => submitRef.current(data),
    onRequestDeleteMutation: (/** @type {string[]} */ ids) => deleteRef.current(ids),
  });

  // Trocar de fazenda fecha o registro aberto e limpa a seleção: a estação
  // aberta é da fazenda anterior.
  const empresaAnterior = useRef(empresaId);
  const { closeForm } = controller.recordHelpers;
  const { setSelectedIds } = controller.chrome;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
    setSelectedIds([]);
  }, [empresaId, closeForm, setSelectedIds]);

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
    mutationFn: ({ data, empresaId: empresa }) => criarEstacao(data, { empresaId: empresa }),
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
      notifySuccess("Sucesso", "Estação cadastrada");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a estação.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: Record<string, unknown>, empresaId: string }} vars */
    mutationFn: ({ id, data, empresaId: empresa }) => atualizarEstacao({ id, dados: data, empresaId: empresa }),
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
      notifySuccess("Sucesso", "Estação atualizada");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a estação.")),
  });

  const deleteMutation = useMutation({
    /** @param {{ ids: string[], empresaId: string }} vars */
    mutationFn: ({ ids, empresaId: empresa }) => excluirEstacoes(ids, { empresaId: empresa }),
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
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Estação excluída" });
      }
      if (bloqueados.length) {
        notifyError(
          "Atenção",
          bloqueados.length === 1
            ? "1 estação não pôde ser excluída."
            : `${bloqueados.length} estações não puderam ser excluídas.`,
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
        "Não foi possível carregar as estações. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const aviso = empresaId ? null : (
    <AvisoGestao testId="estacoes-sem-fazenda">
      Selecione uma fazenda no topo da tela para ver e cadastrar estações.
    </AvisoGestao>
  );

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Estações"
      searchPlaceholder="Buscar estações…"
      formId={FORMULARIO_ESTACAO_ID}
      columnsForCardsToolbar={ESTACOES_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      listBanner={aviso}
      showCreate={podeGravar}
      showDuplicate={podeGravar}
      showEdit={podeGravar}
      showDelete={podeGravar}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja realmente excluir esta estação?",
        descriptionMany: (/** @type {number} */ n) => `Deseja realmente excluir ${n} estações selecionadas?`,
      }}
      recordForm={
        <FormularioEstacao
          key={`${controller.editingItem?.id ?? "estacao-nova"}-${controller.formEpoch}`}
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
        <TabelaEstacoes
          rows={controller.visibleRows}
          emptyText={empresaId ? "Nenhuma estação encontrada" : "Selecione uma fazenda"}
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

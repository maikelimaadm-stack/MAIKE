import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import FormularioFormulacao, { FORMULARIO_FORMULACAO_ID } from "@/components/formulacoes/FormularioFormulacao";
import TabelaFormulacoes, {
  FORMULACOES_COLUNAS,
  FORMULACOES_STORAGE_KEY,
  getFormulacaoFieldValue,
} from "@/components/formulacoes/TabelaFormulacoes";
import {
  listarFormulacoes,
  criarFormulacao,
  atualizarFormulacao,
  excluirFormulacoes,
  mensagemExclusaoBloqueada,
  QUERY_FORMULACOES_LANCAMENTO,
} from "@/services/formulacaoCadastroService";
import { listarProdutosDaEmpresa } from "@/services/produtoService";
import { listarCategoriasManejoDaEmpresa } from "@/services/categoriaManejoService";
import { useCadastroBase1FullListController } from "@/hooks/useCadastroBase1FullListController";
import { useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";

const QUERY_RAIZ = "formulacoes";

/**
 * Cadastro de Formulações de suplemento da fazenda (D-PROD-202, etapa 2a da
 * suplementação), tabelas CADFORMULACAO, CADFORMULACAOINGREDIENTE e
 * CADFORMULACAOREGRA.
 *
 * PRONTO (produto comprado pronto) ou BATELADA (ingredientes em kg por batida),
 * com o produto que vai ao cocho, o % PV padrão e as exceções por Categoria de
 * Manejo, da fazenda selecionada no topo. O lançamento de suplementação exige
 * uma formulação ativa. Excluir formulação já usada em lançamento é recusado
 * (409 `FORMULACAO_EM_USO`): a saída é inativar.
 */
export default function Formulacoes() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

  const fetchAll = useCallback(() => listarFormulacoes(/** @type {string} */ (empresaId)), [empresaId]);

  // Opções dos selects: produtos e categorias de manejo da fazenda (a validação final é do servidor).
  const { data: produtos = [] } = useQuery({
    queryKey: ["formulacoes-produtos", empresaId],
    queryFn: () => listarProdutosDaEmpresa(/** @type {string} */ (empresaId)),
    enabled: Boolean(empresaId),
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ["formulacoes-categorias-manejo", empresaId],
    queryFn: () => listarCategoriasManejoDaEmpresa(/** @type {string} */ (empresaId)),
    enabled: Boolean(empresaId),
  });

  const controller = useCadastroBase1FullListController({
    storageKey: FORMULACOES_STORAGE_KEY,
    columnIds: FORMULACOES_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaId),
    queryKey: [QUERY_RAIZ, empresaId],
    fetchAll,
    duplicateLabelField: "nome",
    exportFileName: "formulacoes.csv",
    exportColumns: FORMULACOES_COLUNAS,
    getExportFieldValue: (/** @type {any} */ item, /** @type {string} */ colId) => getFormulacaoFieldValue(item, colId),
    getRecordTitle: (/** @type {any} */ item) => (item?.id ? item.nome || "Formulação" : "Nova formulação"),
    getRecordCode: () => undefined,
    getSearchHaystack: (/** @type {any} */ e) =>
      [e.nome, e.produto_nome, e.observacoes].filter(Boolean).join(" "),
    mapSearchSuggestion: (/** @type {any} */ e) => ({
      id: String(e.id),
      label: e.nome || "Formulação",
      secondary: e.produto_nome || undefined,
    }),
    matchRowId: (/** @type {any} */ e, /** @type {string} */ id) => String(e.id) === String(id),
    getRowId: (/** @type {any} */ e) => String(e.id),
    findRowById: (/** @type {any} */ rows, /** @type {string} */ id) =>
      rows.find((/** @type {any} */ e) => String(e.id) === String(id)),
    onSubmitRecord: (/** @type {object} */ data) => submitRef.current(data),
    onRequestDeleteMutation: (/** @type {string[]} */ ids) => deleteRef.current(ids),
  });

  // Trocar de fazenda: a formulação aberta, a seleção e a busca (inclusive a
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
  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
    // O lançamento de suplementação lê as ativas com chave própria.
    queryClient.invalidateQueries({ queryKey: [QUERY_FORMULACOES_LANCAMENTO] });
  };

  const createMutation = useMutation({
    /** @param {{ data: Record<string, unknown>, empresaId: string }} vars */
    mutationFn: ({ data, empresaId: empresa }) => criarFormulacao(data, { empresaId: empresa }),
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
      notifySuccess("Sucesso", "Formulação cadastrada");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a formulação.")),
  });

  const updateMutation = useMutation({
    /** @param {{ id: string, data: Record<string, unknown>, empresaId: string }} vars */
    mutationFn: ({ id, data, empresaId: empresa }) => atualizarFormulacao({ id, dados: data, empresaId: empresa }),
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
      notifySuccess("Sucesso", "Formulação atualizada");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar a formulação.")),
  });

  const deleteMutation = useMutation({
    /** @param {{ ids: string[], empresaId: string }} vars */
    mutationFn: ({ ids, empresaId: empresa }) => excluirFormulacoes(ids, { empresaId: empresa }),
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
        notifyExclusoesEmpilhadas(excluidos.length, { singular: "Formulação excluída" });
      }
      if (bloqueados.length) {
        // Formulação já usada em lançamento: inativar em vez de excluir.
        notifyError("Atenção", mensagemExclusaoBloqueada(bloqueados));
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
        "Não foi possível carregar as formulações. Verifique sua conexão e tente novamente.",
      ),
    [controller.listaQueryError],
  );

  const aviso = empresaId ? null : (
    <AvisoGestao testId="formulacoes-sem-fazenda">
      Selecione uma fazenda no topo da tela para ver e cadastrar formulações.
    </AvisoGestao>
  );

  const screenController = { ...controller, saving };

  return (
    <CadastroBase1Screen
      workspaceTitle="Formulações"
      searchPlaceholder="Buscar formulações…"
      formId={FORMULARIO_FORMULACAO_ID}
      columnsForCardsToolbar={FORMULACOES_COLUNAS}
      controller={screenController}
      listErrorMessage={listErrorMessage}
      listBanner={aviso}
      showCreate={podeGravar}
      showDuplicate={podeGravar}
      showEdit={podeGravar}
      showDelete={podeGravar}
      deleteDialog={{
        title: "Confirmar exclusão",
        descriptionOne: "Deseja realmente excluir esta formulação?",
        descriptionMany: (/** @type {number} */ n) => `Deseja realmente excluir ${n} formulações selecionadas?`,
      }}
      recordForm={
        <FormularioFormulacao
          key={`${controller.editingItem?.id ?? "formulacao-nova"}-${controller.formEpoch}`}
          variant="embedded"
          toolbarActions
          readOnly={!controller.isEditing}
          isSubmitting={saving}
          initialData={controller.editingItem}
          isEditing={!!controller.editingItem?.id}
          produtos={produtos}
          categorias={categorias}
          onSubmit={controller.handleSubmit}
          onCancel={controller.cancelForm}
        />
      }
      listSlot={
        <TabelaFormulacoes
          rows={controller.visibleRows}
          emptyText={empresaId ? "Nenhuma formulação encontrada" : "Selecione uma fazenda"}
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

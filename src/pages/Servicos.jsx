import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import { AvisoGestao, ativoDoFiltro, filtroSituacaoDaTela } from "@/components/gestao/GestaoFormParts";
import FormularioServico, { FORMULARIO_SERVICO_ID } from "@/components/servicos/FormularioServico";
import TabelaServicos, {
  SERVICOS_CAMPOS_CARD,
  SERVICOS_COLUNAS,
  getServicoFieldValue,
} from "@/components/servicos/TabelaServicos";
import {
  alterarSituacaoServico,
  atualizarServico,
  criarServico,
  inativarServicos,
  listarServicosPagina,
} from "@/services/servicoCadastroService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";

const QUERY_RAIZ = "servicos";

/**
 * Cadastro de Serviços da fazenda (D-PROD-207, Fatia 4 do Lançamento de
 * Atividades).
 *
 * O que um terceiro executa na atividade, na fazenda selecionada no topo: nome,
 * unidade de medida (cadastro de Unidades de Medida), centro de custo padrão e
 * valor de referência. Sem exclusão: o botão de excluir da tela INATIVA (nada é
 * apagado); "Reativar" fica no menu de ações do registro inativo.
 */
export default function Servicos() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const [situacao, setSituacao] = useState("ativos");
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

  const fetchPage = useCallback(
    (/** @type {any} */ { limit, cursor, q }) =>
      listarServicosPagina(empresaId, { limit, cursor, q: q || undefined, ativo: ativoDoFiltro(situacao) }),
    [empresaId, situacao],
  );

  const controller = useCadastroBase1Controller({
    storageKey: "colunas_servicos_v1",
    columnIds: SERVICOS_CAMPOS_CARD,
    listEnabled: Boolean(empresaId),
    queryKey: [QUERY_RAIZ, "page", empresaId, situacao],
    fetchPage,
    duplicateLabelField: "nome",
    searchPlaceholder: "Buscar serviços…",
    exportFileName: "servicos.csv",
    exportColumns: SERVICOS_COLUNAS,
    getExportFieldValue: getServicoFieldValue,
    getRecordTitle: (/** @type {any} */ item) => (item?.id ? item.nome || "Serviço" : "Novo serviço"),
    getRecordCode: (/** @type {any} */ item) => (item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (/** @type {any} */ s) =>
      [s.nome, s.numero, s.unidade_medida?.sigla, s.centro_custo_padrao?.nome].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (/** @type {any} */ s) => ({ id: String(s.id), label: s.nome || "Serviço", secondary: s.unidade_medida?.sigla || undefined }),
    matchRowId: (/** @type {any} */ f, /** @type {string} */ id) => String(f.id) === String(id),
    getRowId: (/** @type {any} */ f) => String(f.id),
    findRowById: (/** @type {any[]} */ rows, /** @type {string} */ id) => rows.find((f) => String(f.id) === String(id)),
    onSubmitRecord: (/** @type {object} */ data) => submitRef.current(data),
    onRequestDeleteMutation: (/** @type {string[]} */ ids) => deleteRef.current(ids),
  });

  // Trocar de fazenda fecha o registro aberto (ele é da fazenda anterior).
  const empresaAnterior = useRef(empresaId);
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
  }, [empresaId, closeForm]);
  // Resposta de gravação que chega depois de trocar a fazenda não mexe no
  // registro aberto da fazenda nova: só relê as listas.
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {{ empresaId?: string|null } | undefined} v */
  const daEmpresaAtual = (v) => Boolean(v) && v.empresaId === empresaAtual.current;
  const avisarEmpresaAnterior = () => notifyInfo("Gravação concluída", "A gravação feita na fazenda anterior foi concluída.");
  const invalidar = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });

  const registroAtual = controller.editingItem;

  /** @param {any} registro */
  const mostrarRegistro = (registro) => {
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.bumpFormEpoch();
  };

  const createMutation = useMutation({
    /** @param {{ empresaId: string, data: object }} v */
    mutationFn: ({ empresaId: emp, data }) => criarServico(emp, data),
    onSuccess: (/** @type {any} */ criado, v) => {
      invalidar();
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      if (criado?.id) {
        mostrarRegistro(criado);
        controller.recordHelpers.chrome.onSelectionChange([String(criado.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", "Serviço cadastrado");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o serviço.")),
  });

  const updateMutation = useMutation({
    /** @param {{ empresaId: string, original: any, data: object }} v */
    mutationFn: ({ empresaId: emp, original, data }) => atualizarServico(emp, original, data),
    onSuccess: ({ alterado, registro }, v) => {
      if (!daEmpresaAtual(v)) {
        invalidar();
        return avisarEmpresaAnterior();
      }
      if (!alterado) {
        controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      invalidar();
      mostrarRegistro(registro);
      notifySuccess("Sucesso", "Serviço atualizado");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível salvar o serviço.")),
  });

  const inativarMutation = useMutation({
    /** @param {{ empresaId: string, ids: string[] }} v */
    mutationFn: ({ empresaId: emp, ids }) => inativarServicos(emp, ids),
    onSuccess: ({ ok, falhas }, v) => {
      invalidar();
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      controller.chrome.setSelectedIds([]);
      if (controller.showForm && ok.some((id) => String(id) === String(controller.editingItem?.id))) {
        controller.recordHelpers.closeForm();
      }
      if (ok.length) notifySuccess("Sucesso", ok.length === 1 ? "Serviço inativado" : `${ok.length} serviços inativados`);
      if (falhas.length) {
        const motivo = getApiErrorMessage(falhas[0].erro, "Não foi possível inativar o serviço.");
        notifyError("Atenção", falhas.length === 1 ? motivo : `${falhas.length} serviços não puderam ser inativados. ${motivo}`);
      }
    },
    onError: (err) => notifyError("Atenção", getApiErrorMessage(err, "Não foi possível inativar.")),
  });

  const reativarMutation = useMutation({
    /** @param {{ empresaId: string, id: string }} v */
    mutationFn: ({ empresaId: emp, id }) => alterarSituacaoServico(emp, id, true),
    onSuccess: (/** @type {any} */ registro, v) => {
      invalidar();
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      if (registro && typeof registro === "object") mostrarRegistro(registro);
      notifySuccess("Sucesso", "Serviço reativado");
    },
    onError: (err) => notifyWarning("Atenção", getApiErrorMessage(err, "Não foi possível reativar.")),
  });

  submitRef.current = (data) => {
    if (!podeGravar) {
      notifyWarning("Atenção", "Selecione uma fazenda antes de gravar.");
      return;
    }
    const original = controller.editingItem;
    if (original?.id) updateMutation.mutate({ empresaId: /** @type {string} */ (empresaId), original, data });
    else createMutation.mutate({ empresaId: /** @type {string} */ (empresaId), data });
  };
  deleteRef.current = (ids) => {
    if (!podeGravar) return;
    inativarMutation.mutate({ empresaId: /** @type {string} */ (empresaId), ids });
  };

  const saving = createMutation.isPending || updateMutation.isPending || inativarMutation.isPending || reativarMutation.isPending;
  const podeReativar = podeGravar && controller.showForm && registroAtual?.id && registroAtual.ativo === false;

  const listErrorMessage = useMemo(
    () => getApiErrorMessage(controller.listaQueryError, "Não foi possível carregar os serviços. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  const aviso = empresaId ? null : (
    <AvisoGestao testId="servicos-sem-fazenda">Selecione uma fazenda no topo da tela para ver e cadastrar serviços.</AvisoGestao>
  );

  const filtrosDaTela = [filtroSituacaoDaTela(situacao, setSituacao)];

  return (
    <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
      <CadastroBase1Screen
        workspaceTitle="Serviços"
        searchPlaceholder="Buscar serviços…"
        formId={FORMULARIO_SERVICO_ID}
        columnsForCardsToolbar={SERVICOS_COLUNAS}
        controller={{ ...controller, saving }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.numero != null ? String(registroAtual.numero) : undefined}
        listBanner={aviso}
        showCreate={podeGravar}
        showDuplicate={podeGravar}
        showEdit={podeGravar}
        showDelete={podeGravar}
        additionalMoreActions={
          podeReativar
            ? [{ key: "reativar", label: "Reativar serviço", onSelect: () => reativarMutation.mutate({ empresaId: /** @type {string} */ (empresaId), id: String(registroAtual.id) }) }]
            : null
        }
        deleteDialog={{
          title: "Inativar serviço",
          confirmText: "Inativar",
          descriptionOne: "Inativar este serviço? Nada é apagado; ele deixa de ser oferecido para novos lançamentos e pode ser reativado.",
          descriptionMany: (/** @type {number} */ n) => `Inativar ${n} serviços? Nada é apagado; eles podem ser reativados.`,
        }}
        recordForm={
          <FormularioServico
            key={`${registroAtual?.id ?? "servico-novo"}-${controller.formEpoch}`}
            readOnly={!controller.isEditing}
            initialData={registroAtual}
            empresaId={empresaId}
            onSubmit={controller.handleSubmit}
          />
        }
        listSlot={
          <TabelaServicos
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={empresaId ? "Nenhum serviço encontrado" : "Selecione uma fazenda"}
            showConfigColunas={controller.showConfigColunas}
            setShowConfigColunas={controller.setShowConfigColunas}
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
    </FiltrosDaTelaContext.Provider>
  );
}

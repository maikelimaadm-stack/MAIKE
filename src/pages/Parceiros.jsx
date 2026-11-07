import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  alterarSituacaoParceiro,
  atualizarParceiro,
  criarParceiro,
  inativarParceiros,
  listarParceirosPagina,
} from "@/services/parceiroService";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaParceiros, {
  PARCEIROS_COLUNAS,
  PARCEIROS_STORAGE_KEY,
  getParceiroFieldValue,
} from "@/components/gestao/TabelaParceiros";
import FormularioParceiro, { FORMULARIO_PARCEIRO_ID } from "@/components/gestao/FormularioParceiro";
import { AvisoGestao, FiltroSituacao, ativoDoFiltro } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaGestao, useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";
import { TELAS_GESTAO } from "@/lib/gestaoPermissions";
import { ehNaoEncontradoGestao, mensagemErroGestao } from "@/lib/gestaoErros";

const QUERY_RAIZ = "parceiros-gestao";

/**
 * Parceiros (D-PROD-145) — pessoa física/jurídica com papéis múltiplos, sobre o
 * cadastro de Fornecedor do servidor (mesmo id e número). Sem exclusão física:
 * "Excluir" = inativar, com confirmação. Online só.
 */
export default function Parceiros() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaGestao(TELAS_GESTAO.PARCEIROS);
  const [situacao, setSituacao] = useState("ativos");
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarParceirosPagina(empresaId, { limit, cursor, q: q || undefined, ativo: ativoDoFiltro(situacao) }),
    [empresaId, situacao],
  );

  const controller = useCadastroBase1Controller({
    storageKey: PARCEIROS_STORAGE_KEY,
    columnIds: PARCEIROS_COLUNAS.map((c) => c.id),
    listEnabled: Boolean(empresaId) && acoes.ver,
    queryKey: [QUERY_RAIZ, "page", empresaId, situacao],
    fetchPage,
    duplicateLabelField: "nome",
    searchPlaceholder: "Buscar parceiros…",
    exportFileName: "parceiros.csv",
    exportColumns: PARCEIROS_COLUNAS,
    getExportFieldValue: getParceiroFieldValue,
    getRecordTitle: (item) => (item?.id ? item.nome || "Parceiro" : "Novo parceiro"),
    getRecordCode: (item) => (item?.numero_cadastro ? String(item.numero_cadastro) : undefined),
    getSearchHaystack: (p) => [p.nome, p.razao_social, p.numero_cadastro, p.cpf, p.cnpj, p.cidade].filter(Boolean).join(" "),
    mapSearchSuggestion: (p) => ({
      id: String(p.id),
      label: p.nome || "Parceiro",
      secondary: p.numero_cadastro ? `Nº ${p.numero_cadastro}` : undefined,
    }),
    matchRowId: (p, id) => String(p.id) === String(id),
    getRowId: (p) => String(p.id),
    findRowById: (rows, id) => rows.find((p) => String(p.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(data),
    onRequestDeleteMutation: (ids) => deleteRef.current(ids),
  });

  // Troca de empresa: nada da empresa anterior continua na tela.
  const empresaAnterior = useRef(empresaId);
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
  }, [empresaId, closeForm]);

  const tratarErro = (err, fallback) => {
    if (ehNaoEncontradoGestao(err)) {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
      controller.recordHelpers.closeForm();
    }
    notifyWarning("Atenção", mensagemErroGestao(err, fallback));
  };

  const mostrarRegistro = (registro) => {
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.bumpFormEpoch();
  };

  const createMutation = useMutation({
    /** @param {object} data */
    mutationFn: (data) => criarParceiro(empresaId, data),
    onSuccess: (criado) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
      if (criado && typeof criado === "object" && "id" in criado && criado.id) {
        mostrarRegistro(criado);
        controller.recordHelpers.chrome.onSelectionChange([String(criado.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", "Parceiro criado");
    },
    onError: (err) => tratarErro(err, "Não foi possível salvar o parceiro."),
  });

  const updateMutation = useMutation({
    /** @param {{ original: any, data: object }} vars */
    mutationFn: ({ original, data }) => atualizarParceiro(empresaId, original, data),
    onSuccess: ({ alterado, registro }) => {
      if (!alterado) {
        controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
      mostrarRegistro(registro);
      notifySuccess("Sucesso", "Parceiro atualizado");
    },
    onError: (err) => tratarErro(err, "Não foi possível salvar o parceiro."),
  });

  const inativarMutation = useMutation({
    /** @param {string[]} ids */
    mutationFn: (ids) => inativarParceiros(empresaId, ids),
    onSuccess: ({ ok, falhas }) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
      controller.chrome.setSelectedIds([]);
      if (controller.showForm && ok.some((id) => String(id) === String(controller.editingItem?.id))) {
        controller.recordHelpers.closeForm();
      }
      if (ok.length) notifySuccess("Sucesso", ok.length === 1 ? "Parceiro inativado" : `${ok.length} parceiros inativados`);
      if (falhas.length) {
        notifyError("Atenção", falhas.length === 1 ? mensagemErroGestao(falhas[0].erro, "Não foi possível inativar o parceiro.") : `${falhas.length} parceiros não puderam ser inativados. ${mensagemErroGestao(falhas[0].erro, "")}`.trim());
      }
    },
    onError: (err) => tratarErro(err, "Não foi possível inativar."),
  });

  const reativarMutation = useMutation({
    /** @param {string} id */
    mutationFn: (id) => alterarSituacaoParceiro(empresaId, id, true),
    onSuccess: (registro) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });
      if (registro && typeof registro === "object") mostrarRegistro(registro);
      notifySuccess("Sucesso", "Parceiro reativado");
    },
    onError: (err) => tratarErro(err, "Não foi possível reativar."),
  });

  submitRef.current = async (data) => {
    if (!podeGravar) {
      notifyWarning("Atenção", "Selecione uma empresa antes de gravar.");
      return;
    }
    const original = controller.editingItem;
    if (original?.id) {
      if (!acoes.editar) return;
      if (original.ativo !== false && /** @type {any} */ (data).ativo === false) {
        const ok = await confirmar({
          titulo: "Inativar parceiro",
          descricao: "Inativar este parceiro? Ele deixa de ser oferecido para novos vínculos; o histórico continua.",
          textoConfirmar: "Inativar",
          perigo: true,
        });
        if (!ok) return;
      }
      updateMutation.mutate({ original, data });
    } else {
      if (!acoes.criar) return;
      createMutation.mutate(data);
    }
  };
  deleteRef.current = (ids) => {
    if (!podeGravar || !acoes.editar) return;
    inativarMutation.mutate(ids);
  };

  const saving = createMutation.isPending || updateMutation.isPending || inativarMutation.isPending || reativarMutation.isPending;
  const registroAtual = controller.editingItem;
  const podeReativar = acoes.editar && podeGravar && controller.showForm && registroAtual?.id && registroAtual.ativo === false;

  const listErrorMessage = useMemo(
    () => mensagemErroGestao(controller.listaQueryError, "Não foi possível carregar os parceiros. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = (
      <AvisoGestao testId="gestao-sem-empresa">
        Selecione uma empresa no topo da tela para ver e gravar parceiros.
      </AvisoGestao>
    );
  } else if (!acoes.carregando && !acoes.ver) {
    aviso = <AvisoGestao testId="gestao-sem-permissao">Você não tem permissão para visualizar Parceiros.</AvisoGestao>;
  }

  return (
    // A visibilidade dos botões já segue a regra EXATA do servidor (editar OU
    // salvar; novo OU salvar) — a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <CadastroBase1Screen
        workspaceTitle="Parceiros"
        searchPlaceholder="Buscar parceiros…"
        formId={FORMULARIO_PARCEIRO_ID}
        columnsForCardsToolbar={PARCEIROS_COLUNAS}
        controller={{ ...controller, saving }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.numero_cadastro ? String(registroAtual.numero_cadastro) : undefined}
        listBanner={aviso}
        showCreate={podeGravar && acoes.criar}
        showDuplicate={podeGravar && acoes.criar}
        showEdit={podeGravar && acoes.editar}
        showDelete={podeGravar && acoes.editar}
        extraToolbar={<FiltroSituacao value={situacao} onChange={setSituacao} />}
        additionalMoreActions={
          podeReativar
            ? [{ key: "reativar", label: "Reativar parceiro", onSelect: () => reativarMutation.mutate(String(registroAtual.id)) }]
            : null
        }
        deleteDialog={{
          title: "Inativar parceiro",
          confirmText: "Inativar",
          descriptionOne: "Inativar este parceiro? Nada é apagado: ele sai das novas escolhas e pode ser reativado.",
          descriptionMany: (n) => `Inativar ${n} parceiros? Nada é apagado: eles saem das novas escolhas e podem ser reativados.`,
        }}
        recordForm={
          <FormularioParceiro
            key={`${registroAtual?.id ?? "parceiro-novo"}-${controller.formEpoch}`}
            variant="embedded"
            readOnly={!controller.isEditing}
            initialData={registroAtual}
            onSubmit={controller.handleSubmit}
          />
        }
        listSlot={
          <TabelaParceiros
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={empresaId ? "Nenhum parceiro encontrado" : "Selecione uma empresa"}
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
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  alterarSituacaoNatureza,
  atualizarNatureza,
  criarNatureza,
  inativarNaturezas,
  listarNaturezasPagina,
} from "@/services/naturezaFinanceiraService";
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import TabelaNaturezas, {
  NATUREZAS_CAMPOS_CARD,
  NATUREZAS_COLUNAS,
  NATUREZAS_STORAGE_KEY,
  getNaturezaFieldValue,
} from "@/components/gestao/TabelaNaturezas";
import FormularioNatureza, { FORMULARIO_NATUREZA_ID } from "@/components/gestao/FormularioNatureza";
import { AvisoGestao, ativoDoFiltro, filtroSituacaoDaTela } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaGestao, useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";
import { TELAS_GESTAO } from "@/lib/gestaoPermissions";
import { ehNaoEncontradoGestao, mensagemErroGestao } from "@/lib/gestaoErros";

const QUERY_RAIZ = "naturezas-financeiras-gestao";

/**
 * Naturezas Financeiras gerenciais (D-PROD-153) — catálogo RECEITA/DESPESA com
 * hierarquia opcional, por empresa. Sem exclusão física: "Excluir" = inativar,
 * com confirmação. Online só. Mesmas salvaguardas da P1 (empresa real, resposta
 * atrasada de outra empresa não mexe no registro aberto, permissão explícita).
 */
export default function NaturezasFinanceirasTela() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaGestao(TELAS_GESTAO.NATUREZAS_FINANCEIRAS);
  const [situacao, setSituacao] = useState("ativos");
  const [tipoFiltro, setTipoFiltro] = useState("DESPESA");
  const submitRef = useRef(/** @type {(data: object) => void} */ (() => {}));
  const deleteRef = useRef(/** @type {(ids: string[]) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarNaturezasPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
        ativo: ativoDoFiltro(situacao),
        tipo: tipoFiltro === "TODOS" ? undefined : tipoFiltro,
      }),
    [empresaId, situacao, tipoFiltro],
  );

  const controller = useCadastroBase1Controller({
    storageKey: NATUREZAS_STORAGE_KEY,
    columnIds: NATUREZAS_CAMPOS_CARD,
    listEnabled: Boolean(empresaId) && acoes.ver,
    queryKey: [QUERY_RAIZ, "page", empresaId, tipoFiltro, situacao],
    fetchPage,
    duplicateLabelField: "nome",
    searchPlaceholder: "Buscar naturezas…",
    exportFileName: "naturezas-financeiras.csv",
    exportColumns: NATUREZAS_COLUNAS,
    getExportFieldValue: getNaturezaFieldValue,
    getRecordTitle: (item) => (item?.id ? item.nome || "Natureza financeira" : "Nova natureza financeira"),
    // Rascunho de "Duplicar" herda `numero` do original: código só de registro gravado (R1).
    getRecordCode: (item) => (item?.id && item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (n) => [n.nome, n.descricao, n.numero, n.pai_nome, n.caminho].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (n) => ({ id: String(n.id), label: n.nome || "Natureza", secondary: n.pai_nome ? `em ${n.pai_nome}` : undefined }),
    matchRowId: (n, id) => String(n.id) === String(id),
    getRowId: (n) => String(n.id),
    findRowById: (rows, id) => rows.find((n) => String(n.id) === String(id)),
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
  // Resposta de gravação que chega depois de trocar a empresa não mexe no
  // registro aberto da empresa nova — só relê as listas (R2 da P1).
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {{ empresaId?: string|null } | undefined} v */
  const daEmpresaAtual = (v) => Boolean(v) && v.empresaId === empresaAtual.current;
  const avisarEmpresaAnterior = () => notifyInfo("Gravação concluída", "A gravação feita na empresa anterior foi concluída.");

  const invalidar = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });

  const tratarErro = (err, fallback, v) => {
    if (ehNaoEncontradoGestao(err) && daEmpresaAtual(v)) {
      invalidar();
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
    /** @param {{ empresaId: string, data: object }} v */
    mutationFn: ({ empresaId: emp, data }) => criarNatureza(emp, data),
    onSuccess: (criado, v) => {
      invalidar();
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      if (criado && typeof criado === "object" && "id" in criado && criado.id) {
        mostrarRegistro(criado);
        controller.recordHelpers.chrome.onSelectionChange([String(criado.id)]);
      } else {
        controller.recordHelpers.closeForm();
      }
      notifySuccess("Sucesso", "Natureza financeira criada");
    },
    onError: (err, v) => tratarErro(err, "Não foi possível salvar a natureza financeira.", v),
  });

  const updateMutation = useMutation({
    /** @param {{ empresaId: string, original: any, data: object }} vars */
    mutationFn: ({ empresaId: emp, original, data }) => atualizarNatureza(emp, original, data),
    onSuccess: ({ alterado, registro }, v) => {
      if (!daEmpresaAtual(v)) {
        avisarEmpresaAnterior();
        invalidar();
        return;
      }
      if (!alterado) {
        controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      invalidar();
      mostrarRegistro(registro);
      notifySuccess("Sucesso", "Natureza financeira atualizada");
    },
    onError: (err, v) => tratarErro(err, "Não foi possível salvar a natureza financeira.", v),
  });

  const inativarMutation = useMutation({
    /** @param {{ empresaId: string, ids: string[] }} v */
    mutationFn: ({ empresaId: emp, ids }) => inativarNaturezas(emp, ids),
    onSuccess: ({ ok, falhas }, v) => {
      invalidar();
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      controller.chrome.setSelectedIds([]);
      if (controller.showForm && ok.some((id) => String(id) === String(controller.editingItem?.id))) {
        controller.recordHelpers.closeForm();
      }
      if (ok.length) notifySuccess("Sucesso", ok.length === 1 ? "Natureza financeira inativada" : `${ok.length} naturezas financeiras inativadas`);
      if (falhas.length) {
        const motivo = mensagemErroGestao(falhas[0].erro, "Não foi possível inativar a natureza financeira.");
        notifyError("Atenção", falhas.length === 1 ? motivo : `${falhas.length} naturezas não puderam ser inativadas. ${motivo}`);
      }
    },
    onError: (err, v) => tratarErro(err, "Não foi possível inativar.", v),
  });

  const reativarMutation = useMutation({
    /** @param {{ empresaId: string, id: string }} v */
    mutationFn: ({ empresaId: emp, id }) => alterarSituacaoNatureza(emp, id, true),
    onSuccess: (registro, v) => {
      invalidar();
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      if (registro && typeof registro === "object") mostrarRegistro(registro);
      notifySuccess("Sucesso", "Natureza financeira reativada");
    },
    onError: (err, v) => tratarErro(err, "Não foi possível reativar.", v),
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
          titulo: "Inativar natureza financeira",
          descricao: "Inativar esta natureza financeira? Ela deixa de ser oferecida para novas escolhas; nada é apagado.",
          textoConfirmar: "Inativar",
          perigo: true,
        });
        if (!ok) return;
      }
      updateMutation.mutate({ empresaId: /** @type {string} */ (empresaId), original, data });
    } else {
      if (!acoes.criar) return;
      createMutation.mutate({ empresaId: /** @type {string} */ (empresaId), data });
    }
  };
  deleteRef.current = (ids) => {
    if (!podeGravar || !acoes.editar) return;
    inativarMutation.mutate({ empresaId: /** @type {string} */ (empresaId), ids });
  };

  const saving = createMutation.isPending || updateMutation.isPending || inativarMutation.isPending || reativarMutation.isPending;
  const registroAtual = controller.editingItem;
  const podeReativar = acoes.editar && podeGravar && controller.showForm && registroAtual?.id && registroAtual.ativo === false;

  const listErrorMessage = useMemo(
    () => mensagemErroGestao(controller.listaQueryError, "Não foi possível carregar as naturezas financeiras. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="gestao-sem-empresa">Selecione uma empresa no topo da tela para ver e gravar naturezas financeiras.</AvisoGestao>;
  } else if (!acoes.carregando && !acoes.ver) {
    aviso = <AvisoGestao testId="gestao-sem-permissao">Você não tem permissão para visualizar Naturezas Financeiras.</AvisoGestao>;
  }

  // Filtros da consulta como pílulas na faixa do motor, não na barra (D-PROD-172).
  const filtrosDaTela = [
    {
      id: "tipo",
      rotulo: "Tipo",
      nome: "Filtrar por tipo",
      opcoes: [
        { value: "DESPESA", label: "Despesa" },
        { value: "RECEITA", label: "Receita" },
        { value: "TODOS", label: "Todos" },
      ],
      valor: tipoFiltro,
      padrao: "DESPESA",
      onChange: setTipoFiltro,
      coluna: "tipo",
    },
    filtroSituacaoDaTela(situacao, setSituacao),
  ];

  return (
    // A visibilidade dos botões já segue a regra EXATA do servidor (editar OU
    // salvar; novo OU salvar) — a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle="Naturezas Financeiras"
        searchPlaceholder="Buscar naturezas…"
        formId={FORMULARIO_NATUREZA_ID}
        columnsForCardsToolbar={NATUREZAS_COLUNAS}
        controller={{ ...controller, saving }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.id && registroAtual?.numero != null ? String(registroAtual.numero) : undefined}
        listBanner={aviso}
        showCreate={podeGravar && acoes.criar}
        showDuplicate={podeGravar && acoes.criar}
        showEdit={podeGravar && acoes.editar}
        showDelete={podeGravar && acoes.editar}
        additionalMoreActions={
          podeReativar
            ? [{ key: "reativar", label: "Reativar natureza financeira", onSelect: () => reativarMutation.mutate({ empresaId: /** @type {string} */ (empresaId), id: String(registroAtual.id) }) }]
            : null
        }
        deleteDialog={{
          title: "Inativar natureza financeira",
          confirmText: "Inativar",
          descriptionOne: "Inativar esta natureza financeira? Nada é apagado; ela pode ser reativada. Naturezas com filhas ativas não podem ser inativadas.",
          descriptionMany: (n) => `Inativar ${n} naturezas financeiras? Nada é apagado; elas podem ser reativadas.`,
        }}
        recordForm={
          <FormularioNatureza
            key={`${registroAtual?.id ?? "natureza-nova"}-${controller.formEpoch}`}
            empresaId={empresaId}
            readOnly={!controller.isEditing}
            initialData={registroAtual}
            onSubmit={controller.handleSubmit}
          />
        }
        listSlot={
          <TabelaNaturezas
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={empresaId ? "Nenhuma natureza financeira encontrada" : "Selecione uma empresa"}
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
    </div>
  );
}

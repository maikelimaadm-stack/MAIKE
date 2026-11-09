import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { alterarSituacaoBem, listarBensPagina } from "@/services/bemPatrimonialService";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import GradePatrimonio from "@/components/patrimonio/GradePatrimonio";
import { BENS_CAMPOS_CARD, GRADE_BENS } from "@/components/patrimonio/TabelaBens";
import ResumoBemPatrimonial from "@/components/patrimonio/ResumoBemPatrimonial";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoGestao, FiltroSituacao, ativoDoFiltro } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaPatrimonio, useEmpresaRealSelecionadaId } from "@/hooks/usePatrimonioSessao";
import { TELAS_PATRIMONIO } from "@/lib/patrimonioPermissions";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { ehConflitoDeVersaoPatrimonio, ehNaoEncontradoPatrimonio, mensagemErroPatrimonio } from "@/lib/patrimonioErros";

const QUERY_RAIZ = "bens-patrimoniais";

const OPCOES_FILTRO_NATUREZA = [{ value: "TODAS", label: "Todas as naturezas" }, ...NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }))];

/**
 * Bens Patrimoniais (D-PROD-156) — inventário da EMPRESA selecionada: lista
 * keyset com busca no servidor (nome, número, código de frota, placa, série) e
 * filtros de natureza e situação; ficha somente leitura do bem; inativar e
 * reativar pelo menu, com confirmação, só com a ação `inativar`.
 *
 * Mesmas salvaguardas de Gestão: sem empresa real nada é lido nem gravado;
 * trocar de empresa fecha o registro; resposta atrasada da empresa anterior
 * não mexe no registro aberto da empresa nova.
 */
export default function BensPatrimoniaisTela() {
  const queryClient = useQueryClient();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaPatrimonio(TELAS_PATRIMONIO.BENS);
  const [situacao, setSituacao] = useState("ativos");
  const [natureza, setNatureza] = useState("TODAS");

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarBensPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
        ativo: ativoDoFiltro(situacao),
        natureza: natureza !== "TODAS" ? natureza : undefined,
      }),
    [empresaId, situacao, natureza],
  );

  const controller = useCadastroBase1Controller({
    storageKey: GRADE_BENS.storageKey,
    columnIds: BENS_CAMPOS_CARD,
    listEnabled: Boolean(empresaId) && acoes.ver,
    queryKey: [QUERY_RAIZ, "page", empresaId, situacao, natureza],
    fetchPage,
    duplicateLabelField: "nome",
    searchPlaceholder: "Buscar bens…",
    exportFileName: "bens-patrimoniais.csv",
    exportColumns: GRADE_BENS.colunas,
    getExportFieldValue: GRADE_BENS.getFieldValue,
    getRecordTitle: (item) => (item?.id ? item.nome || "Bem patrimonial" : "Novo bem patrimonial"),
    getRecordCode: (item) => (item?.id && item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (b) => [b.numero, b.codigo_frota, b.nome, b.tipo?.nome, b.familia?.nome].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (b) => ({ id: String(b.id), label: b.nome || "Bem patrimonial", secondary: b.codigo_frota || (b.numero != null ? String(b.numero) : undefined) }),
    matchRowId: (b, id) => String(b.id) === String(id),
    getRowId: (b) => String(b.id),
    findRowById: (rows, id) => rows.find((b) => String(b.id) === String(id)),
    // A ficha é somente leitura e não há exclusão física (inativar é ação própria).
    onSubmitRecord: () => {},
    onRequestDeleteMutation: () => {},
  });

  // Troca de empresa: nada da empresa anterior continua na tela.
  const empresaAnterior = useRef(empresaId);
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
  }, [empresaId, closeForm]);
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {{ empresaId?: string|null } | undefined} v */
  const daEmpresaAtual = (v) => Boolean(v) && v.empresaId === empresaAtual.current;

  const invalidar = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ] });

  const mostrarRegistro = (registro) => {
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.bumpFormEpoch();
  };

  const situacaoMutation = useMutation({
    /** @param {{ empresaId: string, alvo: any, ativo: boolean }} v */
    mutationFn: ({ empresaId: emp, alvo, ativo }) => alterarSituacaoBem(emp, alvo, ativo),
    onSuccess: (registro, v) => {
      invalidar();
      if (!daEmpresaAtual(v)) {
        notifyInfo("Gravação concluída", "A gravação feita na empresa anterior foi concluída.");
        return;
      }
      const aberto = controller.showForm && String(controller.editingItem?.id) === String(v.alvo.id);
      // A resposta é o detalhe; a ficha usa o resumo — o aberto só troca a situação e a versão.
      if (aberto && registro && typeof registro === "object") {
        mostrarRegistro({ ...controller.editingItem, ativo: /** @type {any} */ (registro).ativo, versao: /** @type {any} */ (registro).versao });
      }
      notifySuccess("Sucesso", v.ativo ? "Bem patrimonial reativado" : "Bem patrimonial inativado");
    },
    onError: (err, v) => {
      if ((ehNaoEncontradoPatrimonio(err) || ehConflitoDeVersaoPatrimonio(err)) && daEmpresaAtual(v)) {
        invalidar();
        if (ehNaoEncontradoPatrimonio(err)) controller.recordHelpers.closeForm();
      }
      notifyWarning("Atenção", mensagemErroPatrimonio(err, v.ativo ? "Não foi possível reativar o bem." : "Não foi possível inativar o bem."));
    },
  });

  /** @param {any} alvo @param {boolean} ativo */
  const pedirSituacao = async (alvo, ativo) => {
    if (!empresaId) return;
    const verbo = ativo ? "Reativar" : "Inativar";
    const ok = await confirmar({
      titulo: `${verbo} bem patrimonial`,
      descricao: ativo
        ? `Reativar "${alvo.nome || "bem"}"? Ele volta a aparecer entre os bens ativos (a família e o tipo precisam estar ativos).`
        : `Inativar "${alvo.nome || "bem"}"? Ele sai da lista de ativos, mas continua legível com medições, medidor e tanques. Nada é apagado.`,
      textoConfirmar: verbo,
      perigo: !ativo,
    });
    if (ok) situacaoMutation.mutate({ empresaId, alvo, ativo });
  };

  const registroAtual = controller.editingItem;

  // Alvo de inativar/reativar: o registro aberto ou a única linha selecionada.
  const alvo = useMemo(() => {
    if (controller.showForm) return registroAtual?.id ? registroAtual : null;
    const ids = controller.chrome.selectedIds;
    if (ids.length !== 1) return null;
    return controller.visibleRows.find((b) => String(b.id) === String(ids[0])) ?? null;
  }, [controller.showForm, registroAtual, controller.chrome.selectedIds, controller.visibleRows]);

  const acoesDoMenu =
    empresaId && acoes.inativar && alvo && Number.isInteger(alvo.versao)
      ? [
          {
            key: alvo.ativo === false ? "reativar" : "inativar",
            label: alvo.ativo === false ? "Reativar bem patrimonial" : "Inativar bem patrimonial",
            disabled: situacaoMutation.isPending,
            onSelect: () => {
              pedirSituacao(alvo, alvo.ativo === false);
            },
          },
        ]
      : null;

  const listErrorMessage = useMemo(
    () => mensagemErroPatrimonio(controller.listaQueryError, "Não foi possível carregar os bens patrimoniais. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="patrimonio-sem-empresa">Selecione uma empresa no topo da tela para ver os bens patrimoniais.</AvisoGestao>;
  } else if (!acoes.carregando && !acoes.ver) {
    aviso = <AvisoGestao testId="patrimonio-sem-permissao">Você não tem permissão para visualizar Bens Patrimoniais.</AvisoGestao>;
  }

  return (
    <div data-permissao-explicita="" className="contents">
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle="Bens Patrimoniais"
        searchPlaceholder="Buscar bens…"
        columnsForCardsToolbar={GRADE_BENS.colunas}
        controller={{ ...controller, saving: situacaoMutation.isPending }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.id && registroAtual?.numero != null ? String(registroAtual.numero) : undefined}
        listBanner={aviso}
        showCreate={false}
        showDuplicate={false}
        showEdit={false}
        showDelete={false}
        extraToolbar={
          <>
            <FiltroOpcoes rotulo="Filtrar por natureza" value={natureza} onChange={setNatureza} opcoes={OPCOES_FILTRO_NATUREZA} />
            <FiltroSituacao value={situacao} onChange={setSituacao} />
          </>
        }
        additionalMoreActions={acoesDoMenu}
        deleteDialog={{
          title: "Inativar bem patrimonial",
          confirmText: "Inativar",
          descriptionOne: "Inativar este bem? Nada é apagado.",
          descriptionMany: (n) => `Inativar ${n} bens? Nada é apagado.`,
        }}
        recordForm={<ResumoBemPatrimonial key={`${registroAtual?.id ?? "bem"}-${controller.formEpoch}`} registro={registroAtual} />}
        listSlot={
          <GradePatrimonio
            definicao={GRADE_BENS}
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={empresaId ? "Nenhum bem patrimonial encontrado" : "Selecione uma empresa"}
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

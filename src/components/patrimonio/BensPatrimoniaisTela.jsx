import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alterarSituacaoBem, atualizarBem, criarBem, detalharBem, listarBensPagina } from "@/services/bemPatrimonialService";
import { listEmpresas } from "@/services/empresaService";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import GradePatrimonio from "@/components/patrimonio/GradePatrimonio";
import { BENS_CAMPOS_CARD, GRADE_BENS } from "@/components/patrimonio/TabelaBens";
import FormularioBem, { FORMULARIO_BEM_ID } from "@/components/patrimonio/FormularioBem";
import GerenciarTiposDialog from "@/components/patrimonio/GerenciarTiposDialog";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoGestao, FiltroSituacao, ativoDoFiltro } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaPatrimonio, useEmpresaRealSelecionadaId } from "@/hooks/usePatrimonioSessao";
import { TELAS_PATRIMONIO } from "@/lib/patrimonioPermissions";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { ehConflitoDeVersaoPatrimonio, ehNaoEncontradoPatrimonio, mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import { lerErroGestao } from "@/lib/gestaoErros";

const QUERY_RAIZ = "bens-patrimoniais";

/** Filtro pelo "Tipo de bem" (a natureza, D-PROD-163). */
const OPCOES_FILTRO_TIPO_DE_BEM = [{ value: "TODAS", label: "Todos os tipos de bem" }, ...NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }))];

const MENSAGEM_VERSAO =
  "Este bem foi alterado por outra pessoa enquanto você editava. O registro foi recarregado com a versão atual: confira e refaça a alteração. Nada foi gravado.";

/**
 * Produto aceito que o servidor recusou (422 `TANQUE_PRODUTO_INVALIDO`, que
 * aponta `tanques[i].produto_ids` e o `produto_id`): a aba Operação o marca
 * com o motivo para o usuário retirá-lo no mesmo envio (achado D1).
 * @param {unknown} erro
 * @returns {{ indice: number, produto_id: string, reason: string } | null}
 */
const produtoRecusadoDoErro = (erro) => {
  const { code, field, reason, details } = lerErroGestao(erro);
  if (code !== "TANQUE_PRODUTO_INVALIDO" || typeof details.produto_id !== "string" || !details.produto_id) return null;
  const m = /^tanques\[(\d+)\]/.exec(String(field ?? details.field ?? ""));
  if (!m) return null;
  return { indice: Number(m[1]), produto_id: details.produto_id, reason: reason ?? "inexistente" };
};

/**
 * Bens Patrimoniais (D-PROD-157) — inventário da EMPRESA selecionada.
 *
 * Lista keyset com busca no servidor (nome, número, código de frota, placa,
 * série) e filtros de Tipo de bem e situação. O registro aberto lê o
 * DETALHE completo (a lista traz só o resumo) e mostra o `FormularioBem` em
 * abas; criar manda o corpo completo e editar manda o PATCH mínimo com
 * `versao` (blocos aninhados inteiros, listas completas). Duplicar parte do
 * detalhe do bem de origem, sem o que identifica o bem físico.
 *
 * Inativar/reativar é ação do menu, com confirmação, e exige a ação extra
 * `inativar` (nada é apagado). Conflito de versão recarrega o registro.
 *
 * D-PROD-162/163: os tipos vivem aqui. O "⋯" traz "Gerenciar tipos" (para quem
 * vê Bens: listar, renomear, excluir); o formulário tem o "Tipo de bem" (a
 * natureza, lista fixa), o Tipo com "+ Novo tipo" e os Produtos aceitos de cada
 * tanque. Sem família na tela (nem coluna, nem filtro) e sem "Instalar catálogo
 * padrão": o servidor garante o catálogo sozinho.
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
  const [origemDuplicacao, setOrigemDuplicacao] = useState(/** @type {string|null} */ (null));
  const [gerenciarAberto, setGerenciarAberto] = useState(false);
  const [produtoRecusado, setProdutoRecusado] = useState(/** @type {ReturnType<typeof produtoRecusadoDoErro>} */ (null));
  const submitRef = useRef(/** @type {(forma: Record<string, any>) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

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
    getSearchHaystack: (b) => [b.numero, b.codigo_frota, b.nome, b.tipo?.nome].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (b) => ({ id: String(b.id), label: b.nome || "Bem patrimonial", secondary: b.codigo_frota || (b.numero != null ? String(b.numero) : undefined) }),
    matchRowId: (b, id) => String(b.id) === String(id),
    getRowId: (b) => String(b.id),
    findRowById: (rows, id) => rows.find((b) => String(b.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(/** @type {Record<string, any>} */ (data)),
    // Sem exclusão física: a grade não oferece "Excluir" (inativar é ação própria).
    onRequestDeleteMutation: () => {},
  });

  // Fuso da FAZENDA para o "hoje" da leitura do medidor (o servidor valida no dia
  // da empresa): o mesmo resumo de empresas do Layout (mesma chave, sem guarda de
  // tela). Sem fuso, o formulário usa o relógio do navegador.
  const empresasQuery = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: Boolean(empresaId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fusoDaEmpresa = useMemo(() => {
    const empresa = (Array.isArray(empresasQuery.data) ? empresasQuery.data : []).find((e) => String(e?.id) === String(empresaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresasQuery.data, empresaId]);

  // Troca de empresa: nada da empresa anterior continua na tela.
  const empresaAnterior = useRef(empresaId);
  // Na renderização da troca o registro aberto ainda é o da empresa anterior:
  // o detalhe não pode ser pedido com a empresa nova (404 no servidor real).
  const trocandoEmpresa = empresaAnterior.current !== empresaId;
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
    setOrigemDuplicacao(null);
    setProdutoRecusado(null);
  }, [empresaId, closeForm]);
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {{ empresaId?: string|null } | undefined} v */
  const daEmpresaAtual = (v) => Boolean(v) && v.empresaId === empresaAtual.current;

  const invalidarLista = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "page"] });

  // Registro aberto: a lista traz o RESUMO; o formulário usa o DETALHE (A13).
  // Ao duplicar, o detalhe lido é o do bem de origem.
  const registroLista = controller.editingItem;
  const idAberto = controller.showForm && registroLista?.id ? String(registroLista.id) : null;
  const duplicando = Boolean(controller.showForm && registroLista && !registroLista.id && origemDuplicacao);
  const idDetalhe = idAberto ?? (duplicando ? origemDuplicacao : null);
  const detalheQuery = useQuery({
    queryKey: [QUERY_RAIZ, "detalhe", empresaId, idDetalhe],
    queryFn: () => detalharBem(empresaId, /** @type {string} */ (idDetalhe)),
    enabled: Boolean(empresaId && idDetalhe && acoes.ver && !trocandoEmpresa),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const detalhe = /** @type {any} */ (detalheQuery.data ?? null);

  useEffect(() => {
    if (!detalheQuery.error) return;
    if (ehNaoEncontradoPatrimonio(detalheQuery.error)) {
      invalidarLista();
      closeForm();
    }
    notifyWarning("Atenção", mensagemErroPatrimonio(detalheQuery.error, "Não foi possível abrir o bem patrimonial."));
  }, [detalheQuery.error]);

  /** Mostra o detalhe devolvido pelo servidor (somente leitura). @param {any} registro @param {string} emp */
  const aplicarDetalhe = (registro, emp) => {
    if (!registro || typeof registro !== "object" || !registro.id) return;
    queryClient.setQueryData([QUERY_RAIZ, "detalhe", emp, String(registro.id)], registro);
    if (!daEmpresaAtual({ empresaId: emp })) return;
    setOrigemDuplicacao(null);
    setProdutoRecusado(null);
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.bumpFormEpoch();
    controller.recordHelpers.chrome.onSelectionChange([String(registro.id)]);
  };

  /**
   * Erro de gravação: a mensagem do patrimônio e o formulário continua aberto
   * (com o que foi digitado). Registro que sumiu fecha; conflito de versão
   * relê o detalhe (o formulário volta com a versão atual).
   * @param {unknown} err @param {string} fallback @param {{ empresaId: string, comRegistro: boolean }} v
   */
  const tratarErro = (err, fallback, v) => {
    if (!daEmpresaAtual(v)) {
      notifyWarning("Atenção", mensagemErroPatrimonio(err, fallback));
      return;
    }
    if (v.comRegistro && ehNaoEncontradoPatrimonio(err)) {
      invalidarLista();
      controller.recordHelpers.closeForm();
    } else if (v.comRegistro && ehConflitoDeVersaoPatrimonio(err)) {
      invalidarLista();
      setProdutoRecusado(null);
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "detalhe", v.empresaId] });
      notifyWarning("Atenção", MENSAGEM_VERSAO);
      return;
    }
    // O formulário continua aberto: o Produto recusado fica marcado no tanque.
    setProdutoRecusado(produtoRecusadoDoErro(err));
    notifyWarning("Atenção", mensagemErroPatrimonio(err, fallback));
  };

  const createMutation = useMutation({
    /** @param {{ empresaId: string, forma: Record<string, any> }} v */
    mutationFn: (v) => criarBem(v.empresaId, v.forma),
    onSuccess: (registro, v) => {
      invalidarLista();
      if (!daEmpresaAtual(v)) {
        notifyInfo("Gravação concluída", "A gravação feita na empresa anterior foi concluída.");
        return;
      }
      aplicarDetalhe(registro, v.empresaId);
      notifySuccess("Sucesso", "Bem patrimonial criado");
    },
    onError: (err, v) => tratarErro(err, "Não foi possível salvar o bem patrimonial.", { empresaId: v.empresaId, comRegistro: false }),
  });

  const updateMutation = useMutation({
    /** @param {{ empresaId: string, original: any, forma: Record<string, any> }} v */
    mutationFn: (v) => atualizarBem(v.empresaId, v.original, v.forma),
    onSuccess: ({ alterado, registro }, v) => {
      if (!alterado) {
        if (daEmpresaAtual(v)) controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      invalidarLista();
      if (!daEmpresaAtual(v)) {
        notifyInfo("Gravação concluída", "A gravação feita na empresa anterior foi concluída.");
        return;
      }
      aplicarDetalhe(registro, v.empresaId);
      notifySuccess("Sucesso", "Bem patrimonial atualizado");
    },
    onError: (err, v) => tratarErro(err, "Não foi possível salvar o bem patrimonial.", { empresaId: v.empresaId, comRegistro: true }),
  });

  const situacaoMutation = useMutation({
    /** @param {{ empresaId: string, alvo: any, ativo: boolean }} v */
    mutationFn: ({ empresaId: emp, alvo, ativo }) => alterarSituacaoBem(emp, alvo, ativo),
    onSuccess: (registro, v) => {
      invalidarLista();
      if (!daEmpresaAtual(v)) {
        notifyInfo("Gravação concluída", "A gravação feita na empresa anterior foi concluída.");
        return;
      }
      const aberto = controller.showForm && String(controller.editingItem?.id) === String(v.alvo.id);
      if (aberto) aplicarDetalhe(registro, v.empresaId);
      else if (registro && typeof registro === "object" && /** @type {any} */ (registro).id) {
        queryClient.setQueryData([QUERY_RAIZ, "detalhe", v.empresaId, String(/** @type {any} */ (registro).id)], registro);
      }
      notifySuccess("Sucesso", v.ativo ? "Bem patrimonial reativado" : "Bem patrimonial inativado");
    },
    onError: (err, v) =>
      tratarErro(err, v.ativo ? "Não foi possível reativar o bem." : "Não foi possível inativar o bem.", { empresaId: v.empresaId, comRegistro: true }),
  });

  submitRef.current = (forma) => {
    if (!empresaId) {
      notifyWarning("Atenção", "Selecione uma empresa antes de gravar.");
      return;
    }
    if (createMutation.isPending || updateMutation.isPending) return;
    if (idAberto) {
      if (!acoes.editar || !detalhe) return;
      updateMutation.mutate({ empresaId, original: detalhe, forma });
    } else {
      if (!acoes.criar) return;
      createMutation.mutate({ empresaId, forma });
    }
  };

  /** Duplicar lembra o bem de origem: o formulário parte do detalhe dele. */
  const duplicar = () => {
    const ids = controller.chrome.selectedIds;
    const linha = ids.length ? controller.visibleRows.find((b) => String(b.id) === String(ids[0])) : null;
    const origem = linha ?? (controller.editingItem?.id ? controller.editingItem : null);
    setOrigemDuplicacao(origem?.id ? String(origem.id) : null);
    controller.handleDuplicateSelected();
  };

  /** @param {any} alvo @param {boolean} ativo */
  const pedirSituacao = async (alvo, ativo) => {
    if (!empresaId) return;
    const verbo = ativo ? "Reativar" : "Inativar";
    const ok = await confirmar({
      titulo: `${verbo} bem patrimonial`,
      descricao: ativo
        ? `Reativar "${alvo.nome || "bem"}"? Ele volta a aparecer entre os bens ativos (o tipo dele precisa estar ativo).`
        : `Inativar "${alvo.nome || "bem"}"? Ele sai da lista de ativos, mas continua legível com medidor e tanques. Nada é apagado.`,
      textoConfirmar: verbo,
      perigo: !ativo,
    });
    if (ok) situacaoMutation.mutate({ empresaId, alvo, ativo });
  };

  // Alvo de inativar/reativar: o registro aberto (fora da edição; com o
  // detalhe, que tem a versão mais nova) ou a única linha selecionada.
  const alvo = useMemo(() => {
    if (controller.showForm) {
      if (!idAberto || controller.isEditing) return null;
      return detalhe?.id && String(detalhe.id) === idAberto ? detalhe : registroLista;
    }
    const ids = controller.chrome.selectedIds;
    if (ids.length !== 1) return null;
    return controller.visibleRows.find((b) => String(b.id) === String(ids[0])) ?? null;
  }, [controller.showForm, controller.isEditing, idAberto, detalhe, registroLista, controller.chrome.selectedIds, controller.visibleRows]);

  /** @type {Array<{ key: string, label: string, disabled?: boolean, onSelect: () => void }>} */
  const acoesDoMenu = [];
  if (empresaId && acoes.inativar && alvo && Number.isInteger(alvo.versao)) {
    acoesDoMenu.push({
      key: alvo.ativo === false ? "reativar" : "inativar",
      label: alvo.ativo === false ? "Reativar bem patrimonial" : "Inativar bem patrimonial",
      disabled: situacaoMutation.isPending,
      onSelect: () => {
        pedirSituacao(alvo, alvo.ativo === false);
      },
    });
  }
  // D-PROD-162/163: os tipos (catálogo do tenant, não pedem empresa) são do cadastro de Bens.
  if (acoes.ver) {
    acoesDoMenu.push({ key: "gerenciar-tipos", label: "Gerenciar tipos", onSelect: () => setGerenciarAberto(true) });
  }

  const listErrorMessage = useMemo(
    () => mensagemErroPatrimonio(controller.listaQueryError, "Não foi possível carregar os bens patrimoniais. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="patrimonio-sem-empresa">Selecione uma empresa no topo da tela para ver e cadastrar os bens patrimoniais.</AvisoGestao>;
  } else if (!acoes.carregando && !acoes.ver) {
    aviso = <AvisoGestao testId="patrimonio-sem-permissao">Você não tem permissão para visualizar Bens Patrimoniais.</AvisoGestao>;
  }
  const banner = aviso;

  // ─── Conteúdo do registro ─────────────────────────────────────────────
  let conteudoRegistro = null;
  if (controller.showForm) {
    if (idDetalhe && !detalhe) {
      conteudoRegistro = (
        <p className="p-3 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="bem-carregando" role="status">
          {detalheQuery.isError ? "Não foi possível abrir o bem patrimonial." : "Carregando bem patrimonial…"}
        </p>
      );
    } else {
      const chave = idAberto ? `${idAberto}-${detalhe?.versao ?? 0}` : duplicando ? `copia-${origemDuplicacao}` : "bem-novo";
      conteudoRegistro = (
        <FormularioBem
          key={`${chave}-${controller.formEpoch}`}
          detalhe={idAberto ? detalhe : null}
          duplicarDe={duplicando ? detalhe : null}
          empresaId={empresaId}
          fuso={fusoDaEmpresa}
          readOnly={!controller.isEditing}
          onSubmit={controller.handleSubmit}
          acoesCatalogo={{ criarCatalogo: acoes.criarCatalogo, produtosDoTanque: acoes.produtosDoTanque }}
          produtoRecusado={produtoRecusado}
          onRetirarRecusado={() => setProdutoRecusado(null)}
        />
      );
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending || situacaoMutation.isPending;
  const registroAtual = idAberto ? (detalhe ?? registroLista) : null;

  /** Cancelar a edição de um registro gravado descarta o digitado: o formulário remonta do detalhe. */
  const cancelarEdicao = () => {
    if (controller.isEditing && controller.editingItem?.id) controller.recordHelpers.bumpFormEpoch();
    setProdutoRecusado(null);
    controller.cancelForm();
  };

  return (
    // Os botões já seguem a regra EXATA do servidor (novo|salvar, editar|salvar,
    // inativar) — a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle="Bens Patrimoniais"
        searchPlaceholder="Buscar bens…"
        formId={FORMULARIO_BEM_ID}
        columnsForCardsToolbar={GRADE_BENS.colunas}
        controller={{ ...controller, saving, handleDuplicateSelected: duplicar, cancelForm: cancelarEdicao }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.numero != null ? String(registroAtual.numero) : undefined}
        listBanner={banner}
        showCreate={podeGravar && acoes.criar}
        showDuplicate={podeGravar && acoes.criar}
        showEdit={podeGravar && acoes.editar}
        showDelete={false}
        extraToolbar={
          <>
            <FiltroOpcoes rotulo="Filtrar por tipo de bem" value={natureza} onChange={setNatureza} opcoes={OPCOES_FILTRO_TIPO_DE_BEM} />
            <FiltroSituacao value={situacao} onChange={setSituacao} />
          </>
        }
        additionalMoreActions={acoesDoMenu.length ? acoesDoMenu : null}
        deleteDialog={{
          title: "Inativar bem patrimonial",
          confirmText: "Inativar",
          descriptionOne: "Inativar este bem? Nada é apagado.",
          descriptionMany: (n) => `Inativar ${n} bens? Nada é apagado.`,
        }}
        recordForm={conteudoRegistro}
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
      {gerenciarAberto ? (
        <GerenciarTiposDialog
          aberto
          onFechar={() => setGerenciarAberto(false)}
          acoes={{
            criarCatalogo: acoes.criarCatalogo,
            editarCatalogo: acoes.editarCatalogo,
            excluirCatalogo: acoes.excluirCatalogo,
            inativarCatalogo: acoes.inativarCatalogo,
          }}
        />
      ) : null}
    </div>
  );
}

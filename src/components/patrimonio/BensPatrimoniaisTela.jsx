import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { alterarSituacaoBem, atualizarBem, criarBem, detalharBem, listarBensPagina, listarOpcoesCompletasBem } from "@/services/bemPatrimonialService";
import { listEmpresas } from "@/services/empresaService";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { confirmar } from "@/lib/maikeConfirmar";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import GradePatrimonio from "@/components/patrimonio/GradePatrimonio";
import { BENS_CAMPOS_CARD, GRADE_BENS } from "@/components/patrimonio/TabelaBens";
import FormularioBem, { FORMULARIO_BEM_ID } from "@/components/patrimonio/FormularioBem";
import GerenciarFamiliasTiposDialog, { QUERY_CATALOGO } from "@/components/patrimonio/GerenciarFamiliasTiposDialog";
import { CHAVE_OPCOES_PATRIMONIO } from "@/components/patrimonio/bemFormulario";
import { FiltroOpcoes } from "@/components/patrimonio/PatrimonioFormParts";
import { AvisoGestao, FiltroSituacao, ativoDoFiltro } from "@/components/gestao/GestaoFormParts";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaPatrimonio, useEmpresaRealSelecionadaId } from "@/hooks/usePatrimonioSessao";
import { TELAS_PATRIMONIO } from "@/lib/patrimonioPermissions";
import { NATUREZAS_PATRIMONIO, ROTULO_NATUREZA } from "@/lib/patrimonioDominio";
import { ehConflitoDeVersaoPatrimonio, ehNaoEncontradoPatrimonio, mensagemErroPatrimonio } from "@/lib/patrimonioErros";
import { lerErroGestao } from "@/lib/gestaoErros";
import { instalarCatalogoPadrao, resumoCatalogoPadrao } from "@/services/patrimonioCatalogoService";

const QUERY_RAIZ = "bens-patrimoniais";

const OPCOES_FILTRO_NATUREZA = [{ value: "TODAS", label: "Todas as naturezas" }, ...NATUREZAS_PATRIMONIO.map((n) => ({ value: n, label: ROTULO_NATUREZA[n] }))];

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
 * Resumo da instalação do catálogo padrão (D-PROD-162: só famílias e tipos).
 * @param {{ resumo: { criados: string, existentes: string, conflitos: string[] }, onFechar: () => void }} props
 */
function ResumoCatalogoPadrao({ resumo, onFechar }) {
  return (
    <AvisoGestao tone="blue" testId="patrimonio-catalogo-padrao-resumo">
      <p className="font-semibold">Catálogo padrão instalado.</p>
      <p>Criados: {resumo.criados}.</p>
      <p>Já existiam: {resumo.existentes}.</p>
      {resumo.conflitos.length ? (
        <>
          <p>Conflitos ({resumo.conflitos.length}) — nada foi alterado nesses itens:</p>
          <ul className="list-disc pl-5">
            {resumo.conflitos.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : (
        <p>Sem conflitos.</p>
      )}
      <button type="button" className="mt-1 underline" onClick={onFechar}>
        Fechar resumo
      </button>
    </AvisoGestao>
  );
}

/**
 * Bens Patrimoniais (D-PROD-157) — inventário da EMPRESA selecionada.
 *
 * Lista keyset com busca no servidor (nome, número, código de frota, placa,
 * série) e filtros de natureza, família e situação. O registro aberto lê o
 * DETALHE completo (a lista traz só o resumo) e mostra o `FormularioBem` em
 * abas; criar manda o corpo completo e editar manda o PATCH mínimo com
 * `versao` (blocos aninhados inteiros, listas completas). Duplicar parte do
 * detalhe do bem de origem, sem o que identifica o bem físico.
 *
 * Inativar/reativar é ação do menu, com confirmação, e exige a ação extra
 * `inativar` (nada é apagado). Conflito de versão recarrega o registro.
 *
 * D-PROD-162: famílias e tipos vivem aqui. O "⋯" traz "Gerenciar famílias e
 * tipos" (para quem vê Bens) e "Instalar catálogo padrão" (só administrador,
 * P-06); o formulário tem "+ Nova família"/"+ Novo tipo" e os Produtos aceitos
 * de cada tanque.
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
  const [familiaFiltro, setFamiliaFiltro] = useState("TODAS");
  const [origemDuplicacao, setOrigemDuplicacao] = useState(/** @type {string|null} */ (null));
  const [gerenciarAberto, setGerenciarAberto] = useState(false);
  const [resumoPadrao, setResumoPadrao] = useState(/** @type {ReturnType<typeof resumoCatalogoPadrao>|null} */ (null));
  const [produtoRecusado, setProdutoRecusado] = useState(/** @type {ReturnType<typeof produtoRecusadoDoErro>} */ (null));
  const submitRef = useRef(/** @type {(forma: Record<string, any>) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);

  // Famílias do filtro: catálogo do tenant (pequeno), só as ativas.
  const familiasQuery = useQuery({
    queryKey: [...CHAVE_OPCOES_PATRIMONIO, "familias-filtro"],
    queryFn: () => listarOpcoesCompletasBem("familias", null),
    enabled: acoes.ver,
    staleTime: 60 * 1000,
  });
  const opcoesFamilia = useMemo(() => {
    const itens = (familiasQuery.data?.itens ?? []).filter((f) => natureza === "TODAS" || f?.natureza === natureza);
    return [{ value: "TODAS", label: "Todas as famílias" }, ...itens.map((f) => ({ value: String(f.id), label: String(f.nome ?? "") }))];
  }, [familiasQuery.data, natureza]);
  // Família de outra natureza (ou que saiu da lista) deixa de filtrar.
  const familiaEfetiva = opcoesFamilia.some((o) => o.value === familiaFiltro) ? familiaFiltro : "TODAS";
  /** Trocar a natureza esquece a família de outra natureza (ela não volta sozinha depois). @param {string} valor */
  const mudarNatureza = (valor) => {
    setNatureza(valor);
    const familia = (familiasQuery.data?.itens ?? []).find((f) => String(f?.id) === familiaFiltro);
    if (valor !== "TODAS" && familia && familia.natureza !== valor) setFamiliaFiltro("TODAS");
  };

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarBensPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
        ativo: ativoDoFiltro(situacao),
        natureza: natureza !== "TODAS" ? natureza : undefined,
        familiaId: familiaEfetiva !== "TODAS" ? familiaEfetiva : undefined,
      }),
    [empresaId, situacao, natureza, familiaEfetiva],
  );

  const controller = useCadastroBase1Controller({
    storageKey: GRADE_BENS.storageKey,
    columnIds: BENS_CAMPOS_CARD,
    listEnabled: Boolean(empresaId) && acoes.ver,
    queryKey: [QUERY_RAIZ, "page", empresaId, situacao, natureza, familiaEfetiva],
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
        ? `Reativar "${alvo.nome || "bem"}"? Ele volta a aparecer entre os bens ativos (a família e o tipo precisam estar ativos).`
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

  const padraoMutation = useMutation({
    mutationFn: () => instalarCatalogoPadrao(),
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_CATALOGO] });
      queryClient.invalidateQueries({ queryKey: CHAVE_OPCOES_PATRIMONIO });
      setResumoPadrao(resumoCatalogoPadrao(resultado));
      notifySuccess("Catálogo padrão", "Instalação concluída. Confira o resumo acima da lista.");
    },
    onError: (err) => notifyWarning("Atenção", mensagemErroPatrimonio(err, "Não foi possível instalar o catálogo padrão.")),
  });

  const pedirCatalogoPadrao = async () => {
    const ok = await confirmar({
      titulo: "Instalar catálogo padrão",
      descricao:
        "Cria só o que ainda falta, pelo código: famílias e tipos de uso comum. Nada do que já existe é alterado; itens com o mesmo código e outra classificação aparecem como conflito.",
      textoConfirmar: "Instalar",
    });
    if (ok) padraoMutation.mutate();
  };

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
  // D-PROD-162: famílias e tipos (catálogo do tenant, não pedem empresa) são do cadastro de Bens.
  if (acoes.ver) {
    acoesDoMenu.push({ key: "gerenciar-catalogo", label: "Gerenciar famílias e tipos", onSelect: () => setGerenciarAberto(true) });
  }
  if (acoes.administrador) {
    acoesDoMenu.push({
      key: "catalogo-padrao",
      label: "Instalar catálogo padrão",
      disabled: padraoMutation.isPending,
      onSelect: () => {
        pedirCatalogoPadrao();
      },
    });
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
  const banner =
    aviso || resumoPadrao ? (
      <>
        {aviso}
        {resumoPadrao ? <ResumoCatalogoPadrao resumo={resumoPadrao} onFechar={() => setResumoPadrao(null)} /> : null}
      </>
    ) : null;

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
            <FiltroOpcoes rotulo="Filtrar por natureza" value={natureza} onChange={mudarNatureza} opcoes={OPCOES_FILTRO_NATUREZA} />
            <FiltroOpcoes rotulo="Filtrar por família" value={familiaEfetiva} onChange={setFamiliaFiltro} opcoes={opcoesFamilia} />
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
        <GerenciarFamiliasTiposDialog
          aberto
          onFechar={() => setGerenciarAberto(false)}
          acoes={{ criarCatalogo: acoes.criarCatalogo, editarCatalogo: acoes.editarCatalogo, inativarCatalogo: acoes.inativarCatalogo }}
        />
      ) : null}
    </div>
  );
}

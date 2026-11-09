import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import B1Select from "@/components/cadastro/base1/B1Select";
import { AvisoGestao } from "@/components/gestao/GestaoFormParts";
import TabelaLancamentos, {
  LANCAMENTOS_CAMPOS_CARD,
  LANCAMENTOS_COLUNAS,
  LANCAMENTOS_STORAGE_KEY,
  valorDoCampoLancamento,
} from "@/components/financeiroGestao/TabelaLancamentos";
import FormularioLancamento, { FORMULARIO_LANCAMENTO_ID } from "@/components/financeiroGestao/FormularioLancamento";
import ConsultaLancamento from "@/components/financeiroGestao/ConsultaLancamento";
import PerfilFinanceiroPainel from "@/components/financeiroGestao/PerfilFinanceiroPainel";
import { DialogoAcao, DialogoConfirmacao, DialogoLiquidacao } from "@/components/financeiroGestao/DialogosLancamento";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaGestao, useEmpresaRealSelecionadaId } from "@/hooks/useGestaoSessao";
import { useAuth } from "@/lib/AuthContext";
import { TELAS_GESTAO } from "@/lib/gestaoPermissions";
import { ehNaoEncontradoGestao, lerErroGestao, mensagemErroGestao } from "@/lib/gestaoErros";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { hojeNoFuso } from "@/lib/diaCivil";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import {
  CODIGO_ENVIO_PENDENTE,
  ROTULO_DIRECAO,
  cancelarLancamento,
  confirmarLancamento,
  descartarRascunho,
  ehRecusaDefinitiva,
  ehResultadoIncerto,
  estornarLiquidacao,
  listarLancamentosPagina,
  obterLancamento,
  obterPerfilFinanceiro,
  previaLancamento,
  registrarLiquidacao,
  resolverPendenciaConsultada,
  salvarPerfilFinanceiro,
  salvarRascunho,
} from "@/services/operacaoFinanceiraService";

const QUERY_RAIZ = "lancamentos-financeiros-gestao";

/**
 * Consultas que as telas antigas de estoque invalidam depois de gravar
 * (FormularioTransferenciaDeposito, FormularioLancamentoSuplementacao,
 * HistoricoSuplementacaoPonto, HistoricoDepositoSuplementacao) e, do cache do
 * Mapa, a de lotes de estoque (a que o "atualizar-mapa" relê).
 * @param {unknown} chave
 */
const ehConsultaDeEstoque = (chave) =>
  Array.isArray(chave) &&
  ([
    "estoque-lotes-transferencia",
    "saldo-deposito",
    "lotes-nota-suplementacao",
    "produtos",
    "movimentacoes",
    "historico-deposito",
    "movimentacoes-deposito-detalhe",
    "mapa-estoque-lotes",
  ].includes(chave[0]) ||
    (chave[0] === "mapa-cache" && chave[1] === "estoqueLotes"));

/** Documento com mercadoria: confirmar/cancelar mexe no estoque físico. @param {any} registro */
const temMercadoria = (registro) => Array.isArray(registro?.itens) && registro.itens.some((/** @type {any} */ i) => i?.tipo_item === "MERCADORIA");

const PERFIL_SEM_CONFIGURACAO = Object.freeze({ locale: "pt-BR", moeda: "BRL", moeda_casas: 2, metodos_permitidos: /** @type {string[]} */ ([]) });

/** @param {{ rotulo: string, value: string, onChange: (v: string) => void, opcoes: Array<[string, string]> }} props */
function FiltroLista({ rotulo, value, onChange, opcoes }) {
  return (
    <div className="inline-flex h-8 min-w-[104px] items-center rounded-full border border-[var(--mg-divider,#cbd5e1)] bg-white px-3 text-xs font-medium">
      <B1Select aria-label={rotulo} value={value} onChange={(e) => onChange(e.target.value)} className="flex w-full items-center justify-between gap-1.5 whitespace-nowrap bg-transparent text-xs">
        {opcoes.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </B1Select>
    </div>
  );
}

/**
 * Central Única de Lançamentos (D-PROD-155) — documento gerencial único para
 * pagar/receber, com ou sem produtos, à vista/a prazo/parcelado: rascunho
 * completo → prévia → confirmação (títulos + estoque) → baixas manuais.
 * Sem conciliação bancária, fiscal ou contabilidade. Mesmas salvaguardas da
 * Gestão P1/P2: empresa real, resposta de outra empresa não mexe no registro
 * aberto, permissão explícita (ações extras próprias da tela).
 */
export default function LancamentosFinanceirosTela() {
  const queryClient = useQueryClient();
  const { clienteId } = useAuth();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaGestao(TELAS_GESTAO.LANCAMENTOS_FINANCEIROS);
  const escopo = `${clienteId || "sem-tenant"}:${acoes.login || "sem-login"}`;
  const [direcaoFiltro, setDirecaoFiltro] = useState("TODAS");
  const [statusFiltro, setStatusFiltro] = useState("TODOS");
  const [dialogo, setDialogo] = useState(/** @type {any} */ (null));
  const [preparando, setPreparando] = useState(false);
  const preparandoRef = useRef(false);
  const submitRef = useRef(/** @type {(doc: Record<string, unknown>) => void} */ (() => {}));
  const podeGravar = Boolean(empresaId);
  // Última recusa do servidor ao GRAVAR o formulário aberto (D-PROD-156): o
  // formulário aponta o item e a linha do rateio por item (`indice`/`subindice`).
  const [erroDoFormulario, setErroDoFormulario] = useState(/** @type {{ erro: unknown, seq: number } | null} */ (null));
  const seqErroDoFormulario = useRef(0);
  /** @param {unknown} erro */
  const entregarErroAoFormulario = (erro) => {
    seqErroDoFormulario.current += 1;
    setErroDoFormulario({ erro, seq: seqErroDoFormulario.current });
  };

  const perfilQuery = useQuery({
    queryKey: [QUERY_RAIZ, "perfil", empresaId],
    queryFn: () => obterPerfilFinanceiro(empresaId),
    enabled: Boolean(empresaId) && acoes.ver,
    staleTime: 60 * 1000,
  });
  const perfil = perfilQuery.data?.perfil ?? null;
  const fuso = perfilQuery.data?.fuso_horario ?? null;
  const catalogo = perfilQuery.data?.catalogo ?? null;
  const perfilUi = perfil
    ? { locale: perfil.locale, moeda: perfil.moeda, moeda_casas: perfil.moeda_casas, metodos_permitidos: perfil.metodos_permitidos }
    : PERFIL_SEM_CONFIGURACAO;
  // Comandos desta tela reenviam com o MESMO operation_id (ou CAS por versao): repetir é seguro.
  const contextoMoeda = { locale: perfilUi.locale, moeda: perfilUi.moeda, casas: perfilUi.moeda_casas, comandoIdempotente: true };
  const hoje = hojeNoFuso(fuso);

  const fetchPage = useCallback(
    ({ limit, cursor, q }) =>
      listarLancamentosPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
        direcao: direcaoFiltro === "TODAS" ? undefined : direcaoFiltro,
        status: statusFiltro === "TODOS" ? undefined : statusFiltro,
      }),
    [empresaId, direcaoFiltro, statusFiltro],
  );

  const controller = useCadastroBase1Controller({
    storageKey: LANCAMENTOS_STORAGE_KEY,
    columnIds: LANCAMENTOS_CAMPOS_CARD,
    listEnabled: Boolean(empresaId) && acoes.ver,
    queryKey: [QUERY_RAIZ, "page", empresaId, direcaoFiltro, statusFiltro],
    fetchPage,
    duplicateLabelField: "parceiro_nome",
    searchPlaceholder: "Buscar lançamentos…",
    exportFileName: "lancamentos-financeiros.csv",
    exportColumns: LANCAMENTOS_COLUNAS,
    getExportFieldValue: valorDoCampoLancamento(perfilUi.locale),
    getRecordTitle: (item) =>
      item?.id ? `${ROTULO_DIRECAO[/** @type {keyof typeof ROTULO_DIRECAO} */ (item.direcao)] ?? "Lançamento"} · ${item.parceiro_nome || "—"}` : "Novo lançamento",
    getRecordCode: (item) => (item?.id && item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (n) => [n.numero, n.parceiro_nome, n.documento_referencia, n.descricao].filter((v) => v != null).join(" "),
    mapSearchSuggestion: (n) => ({ id: String(n.id), label: `${n.numero ?? ""} ${n.parceiro_nome || ""}`.trim() || "Lançamento", secondary: n.status }),
    matchRowId: (n, id) => String(n.id) === String(id),
    getRowId: (n) => String(n.id),
    findRowById: (rows, id) => rows.find((n) => String(n.id) === String(id)),
    onSubmitRecord: (data) => submitRef.current(/** @type {Record<string, unknown>} */ (data)),
    onRequestDeleteMutation: () => {},
  });

  // Troca de empresa: nada da empresa anterior continua na tela.
  const empresaAnterior = useRef(empresaId);
  // Na renderização da troca o registro aberto ainda é o da empresa anterior:
  // o detalhe não pode ser pedido com a empresa nova (404 no servidor real).
  const trocandoEmpresa = empresaAnterior.current !== empresaId;
  const { closeForm } = controller;
  useEffect(() => {
    const anterior = empresaAnterior.current;
    if (anterior === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
    setDialogo(null);
    // Só as consultas da empresa ANTERIOR (perfil, lista, detalhe e opções dos
    // seletores levam a empresa na chave): as da nova (perfil e lista, hooks
    // acima) já começaram neste mesmo ciclo, e cancelá-las as deixava
    // "pendentes" sem dados e sem nova busca até sair da tela.
    if (anterior) queryClient.cancelQueries({ predicate: (q) => q.queryKey[0] === QUERY_RAIZ && q.queryKey.includes(anterior) });
  }, [empresaId, closeForm, queryClient]);
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {{ empresaId?: string|null } | undefined} v */
  const daEmpresaAtual = (v) => Boolean(v) && v.empresaId === empresaAtual.current;
  const avisarEmpresaAnterior = () => notifyInfo("Gravação concluída", "A gravação feita na empresa anterior foi concluída.");

  const invalidarLista = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "page"] });

  // Registro aberto: a lista traz o RESUMO; o documento completo vem do detalhe.
  const registroLista = controller.editingItem;
  const idAberto = controller.showForm && registroLista?.id ? String(registroLista.id) : null;
  const detalheQuery = useQuery({
    queryKey: [QUERY_RAIZ, "detalhe", empresaId, idAberto],
    queryFn: () => obterLancamento(empresaId, /** @type {string} */ (idAberto)),
    enabled: Boolean(empresaId && idAberto && acoes.ver && !trocandoEmpresa),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const detalhe = /** @type {any} */ (detalheQuery.data ?? null);
  const statusAberto = detalhe?.status ?? registroLista?.status ?? null;

  useEffect(() => {
    if (!detalheQuery.error) return;
    if (ehNaoEncontradoGestao(detalheQuery.error)) {
      invalidarLista();
      closeForm();
    }
    notifyWarning("Atenção", mensagemErroGestao(detalheQuery.error, "Não foi possível abrir o lançamento."));
  }, [detalheQuery.error]);

  // Documento que deixou de ser rascunho não fica em modo de edição.
  const { isEditing, setIsEditing } = controller;
  useEffect(() => {
    if (isEditing && idAberto && detalhe && detalhe.status !== "RASCUNHO") setIsEditing(false);
  }, [isEditing, idAberto, detalhe, setIsEditing]);

  /** Mostra o documento devolvido pelo servidor (somente leitura). @param {any} registro @param {string} emp */
  const aplicarDetalhe = (registro, emp) => {
    if (!registro || typeof registro !== "object" || !registro.id) return;
    queryClient.setQueryData([QUERY_RAIZ, "detalhe", emp, String(registro.id)], registro);
    if (!daEmpresaAtual({ empresaId: emp })) return;
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.bumpFormEpoch();
    controller.recordHelpers.chrome.onSelectionChange([String(registro.id)]);
  };

  /** @param {unknown} err @param {string} fallback @param {{ empresaId?: string|null }} v */
  const tratarErro = (err, fallback, v) => {
    if (/** @type {any} */ (err)?.code === CODIGO_ENVIO_PENDENTE) {
      notifyInfo("Envio mantido", "Nada foi enviado agora. Confira a lista; para concluir o envio anterior sem duplicar, repita com o MESMO conteúdo neste formulário.");
      return;
    }
    const { code } = lerErroGestao(err);
    if (daEmpresaAtual(v)) {
      if (ehNaoEncontradoGestao(err)) {
        invalidarLista();
        controller.recordHelpers.closeForm();
      } else if (code === "OPERACAO_VERSAO_CONFLITO" || code === "OPERACAO_STATUS_INVALIDO") {
        invalidarLista();
        queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "detalhe"] });
      }
    }
    if (ehResultadoIncerto(err)) {
      notifyWarning("Resultado incerto", "Sem resposta do servidor: pode ter sido gravado. Confira a lista; se repetir com o mesmo conteúdo, o envio não duplica.");
      return;
    }
    notifyWarning("Atenção", mensagemErroGestao(err, fallback, contextoMoeda));
  };

  // Formulário NOVO cujo último salvar ficou sem resposta definitiva (a
  // pendência de "criar" ficou) ou que escolheu "Manter" o envio pendente:
  // salvar de novo NESTE formulário é a retentativa daquele envio. Outro
  // formulário (outro "Novo", outra visita à tela) é um envio novo — com
  // conteúdo igual, pergunta (§8.7).
  const criarIncertoNoFormulario = useRef(/** @type {number|null} */ (null));
  /** @param {string} emp @param {{ id: string|null, versao: number|null, doc: Record<string, unknown>, formulario: number }} v */
  const salvarComRetentativa = async (emp, v) => {
    const novoDoc = !v.id;
    try {
      const r = await salvarRascunho(emp, { id: v.id, versao: v.versao, doc: v.doc, escopo, retentativa: novoDoc && criarIncertoNoFormulario.current === v.formulario });
      if (novoDoc) criarIncertoNoFormulario.current = null;
      return r;
    } catch (err) {
      if (novoDoc) criarIncertoNoFormulario.current = /** @type {any} */ (err)?.code !== CODIGO_ENVIO_PENDENTE && ehRecusaDefinitiva(err) ? null : v.formulario;
      throw err;
    }
  };

  const salvarMutation = useMutation({
    /** @param {{ empresaId: string, id: string|null, versao: number|null, doc: Record<string, unknown>, formulario: number }} v */
    mutationFn: (v) => salvarComRetentativa(v.empresaId, v),
    onSuccess: (registro, v) => {
      invalidarLista();
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      aplicarDetalhe(registro, v.empresaId);
      notifySuccess("Sucesso", v.id ? "Rascunho atualizado" : "Rascunho salvo (ainda não gera título nem mexe no estoque)");
    },
    onError: (err, v) => {
      if (daEmpresaAtual(v)) entregarErroAoFormulario(err);
      tratarErro(err, "Não foi possível salvar o rascunho. Nada foi gravado.", v);
    },
  });

  const perfilMutation = useMutation({
    /** @param {{ empresaId: string, dados: { pais: string, moeda: string, locale: string } }} v */
    mutationFn: (v) => salvarPerfilFinanceiro(v.empresaId, v.dados),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "perfil", v.empresaId] });
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      setDialogo((d) => (d?.tipo === "perfil" ? null : d));
      notifySuccess("Sucesso", "Perfil financeiro salvo");
    },
    onError: (err, v) => tratarErro(err, "Não foi possível salvar o perfil financeiro.", v),
  });

  submitRef.current = (doc) => {
    if (!podeGravar) {
      notifyWarning("Atenção", "Selecione uma empresa antes de gravar.");
      return;
    }
    if (salvarMutation.isPending) return;
    if (idAberto) {
      if (!acoes.editar || !detalhe) return;
      salvarMutation.mutate({ empresaId: /** @type {string} */ (empresaId), id: idAberto, versao: detalhe.versao, doc, formulario: controller.formEpoch });
    } else {
      if (!acoes.criar) return;
      salvarMutation.mutate({ empresaId: /** @type {string} */ (empresaId), id: null, versao: null, doc, formulario: controller.formEpoch });
    }
  };

  /** "Confirmar lançamento": salva SÓ se mudou (§8.7), chama a prévia e abre o diálogo. */
  const iniciarConfirmacao = async (/** @type {{ doc: Record<string, unknown>|null, alterado: boolean }} */ { doc, alterado }) => {
    if (preparandoRef.current || !empresaId) return;
    preparandoRef.current = true;
    setPreparando(true);
    const emp = empresaId;
    try {
      let registro = idAberto ? detalhe : null;
      if (!registro?.id || (alterado && doc)) {
        if (!doc) return;
        if (registro?.id ? !acoes.editar : !acoes.criar) {
          notifyWarning("Atenção", "Você não tem permissão para gravar alterações neste rascunho.");
          return;
        }
        registro = await salvarComRetentativa(emp, { id: registro?.id ?? null, versao: registro?.versao ?? null, doc, formulario: controller.formEpoch });
        invalidarLista();
        if (!daEmpresaAtual({ empresaId: emp })) return avisarEmpresaAnterior();
        aplicarDetalhe(registro, emp);
      }
      const previa = await previaLancamento(emp, String(registro.id));
      if (!daEmpresaAtual({ empresaId: emp })) return;
      setDialogo({ tipo: "confirmar", registro, previa });
    } catch (err) {
      if (daEmpresaAtual({ empresaId: emp })) entregarErroAoFormulario(err);
      tratarErro(err, "Não foi possível preparar a confirmação. Nada foi gravado.", { empresaId: emp });
    } finally {
      preparandoRef.current = false;
      setPreparando(false);
    }
  };

  /** Depois de um comando: mostra o documento novo e relê a lista. @param {any} registro @param {string} emp @param {string} mensagem */
  const concluirComando = (registro, emp, mensagem) => {
    invalidarLista();
    if (!daEmpresaAtual({ empresaId: emp })) return avisarEmpresaAnterior();
    aplicarDetalhe(registro, emp);
    setDialogo(null);
    notifySuccess("Sucesso", registro?.replay ? `${mensagem} (envio repetido: nada foi duplicado)` : mensagem);
  };

  /** Erro de comando: o diálogo mostra; aqui só relemos o que pode ter mudado. @param {unknown} err @param {string} emp */
  const reagirAoErro = (err, emp) => {
    if (!daEmpresaAtual({ empresaId: emp })) return;
    const { code } = lerErroGestao(err);
    if (ehNaoEncontradoGestao(err) || code === "OPERACAO_VERSAO_CONFLITO" || code === "OPERACAO_STATUS_INVALIDO" || code === "TITULO_NAO_LIQUIDAVEL" || code === "LIQUIDACAO_JA_ESTORNADA") {
      invalidarLista();
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "detalhe", emp] });
    }
  };

  /**
   * Confirmar/cancelar com mercadoria mexeu no estoque físico: o MESMO aviso das
   * telas antigas que gravam estoque — refresh FORÇADO do cache do Mapa (fura o
   * intervalo mínimo de 60 s do mapaCacheService), consultas de estoque
   * invalidadas (o Mapa guarda as suas por 5 min) e o evento "atualizar-mapa".
   * @param {any} registro @param {string} emp
   */
  const avisarEstoqueAlterado = (registro, emp) => {
    if (!temMercadoria(registro)) return;
    Promise.all([
      refreshMapaCacheEntry("estoqueLotes", emp, { force: true }),
      refreshMapaCacheEntry("movimentacaoEstoque", emp, { force: true }),
    ]).catch(() => {});
    queryClient.invalidateQueries({ predicate: (q) => ehConsultaDeEstoque(q.queryKey) });
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["estoqueLotes"] } }));
  };

  /**
   * "Consultar" do resultado incerto: relê o documento, resolve a pendência do
   * envio quando o efeito dele aparece (§8.7) e fecha o diálogo.
   * @param {string} acao @param {string} alvo @param {{ liquidacoesAntes?: string[] }} [extra]
   */
  const consultarDepoisDeIncerto = async (acao, alvo, extra = {}) => {
    const emp = empresaId;
    if (!emp || !idAberto) return;
    const r = await detalheQuery.refetch();
    // Releitura que falhou devolve o dado ANTIGO: não serve de prova.
    const novo = /** @type {any} */ (r.status === "success" ? r.data : null);
    invalidarLista();
    if (novo) {
      const resolvida = resolverPendenciaConsultada({ escopo, acao, empresaId: emp, alvo, detalhe: novo, liquidacoesAntes: extra.liquidacoesAntes });
      if (resolvida && (acao === "confirmar" || acao === "cancelar")) avisarEstoqueAlterado(novo, emp);
      aplicarDetalhe(novo, emp);
    }
    setDialogo(null);
  };

  const ocupado = salvarMutation.isPending || preparando;
  const registroAtual = detalhe;
  const ehRascunho = statusAberto === "RASCUNHO";
  const selecionado = !controller.showForm && controller.chrome.selectedIds.length === 1
    ? controller.visibleRows.find((/** @type {any} */ r) => String(r.id) === String(controller.chrome.selectedIds[0]))
    : null;
  const editavel = controller.showForm ? ehRascunho : selecionado?.status === "RASCUNHO";

  const listErrorMessage = useMemo(
    () => mensagemErroGestao(controller.listaQueryError, "Não foi possível carregar os lançamentos. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  // ─── Avisos do topo (empresa, permissão, perfil, fuso) ───────────────
  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="gestao-sem-empresa">Selecione uma empresa no topo da tela para ver e gravar lançamentos.</AvisoGestao>;
  } else if (!acoes.carregando && !acoes.ver) {
    aviso = <AvisoGestao testId="gestao-sem-permissao">Você não tem permissão para visualizar Lançamentos Financeiros.</AvisoGestao>;
  } else if (perfilQuery.isError) {
    aviso = <AvisoGestao testId="perfil-financeiro-erro">{mensagemErroGestao(perfilQuery.error, "Não foi possível ler o perfil financeiro da empresa.")}</AvisoGestao>;
  } else if (perfilQuery.data && !perfil && catalogo) {
    aviso = (
      <PerfilFinanceiroPainel
        catalogo={catalogo}
        podeEditar={acoes.administrador}
        salvando={perfilMutation.isPending}
        onSalvar={(dados) => perfilMutation.mutate({ empresaId: /** @type {string} */ (empresaId), dados })}
      />
    );
  } else if (perfil && catalogo && dialogo?.tipo === "perfil") {
    aviso = (
      <div data-testid="perfil-financeiro-edicao">
        <PerfilFinanceiroPainel
          catalogo={catalogo}
          perfilAtual={perfil}
          podeEditar={acoes.administrador}
          salvando={perfilMutation.isPending}
          onSalvar={(dados) => perfilMutation.mutate({ empresaId: /** @type {string} */ (empresaId), dados })}
          onFechar={() => setDialogo(null)}
        />
      </div>
    );
  } else if (perfil && !fuso) {
    aviso = (
      <AvisoGestao testId="gestao-sem-fuso">
        A empresa não tem fuso horário configurado: confirmar lançamento com mercadoria e registrar pagamento/recebimento exigem o fuso. O administrador configura em
        Administração › Empresa.
      </AvisoGestao>
    );
  }

  // ─── Conteúdo do registro ─────────────────────────────────────────────
  let conteudoRegistro = null;
  if (controller.showForm) {
    if (!perfil) {
      conteudoRegistro = <AvisoGestao testId="registro-sem-perfil">Configure o perfil financeiro da empresa para lançar.</AvisoGestao>;
    } else if (idAberto && !detalhe) {
      conteudoRegistro = (
        <p className="p-3 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="carregando-lancamento">
          {detalheQuery.isError ? "Não foi possível abrir o lançamento." : "Carregando lançamento…"}
        </p>
      );
    } else if (!idAberto || detalhe?.status === "RASCUNHO") {
      conteudoRegistro = (
        <FormularioLancamento
          key={`${idAberto ?? "lancamento-novo"}-${controller.formEpoch}-${detalhe?.versao ?? 0}`}
          empresaId={empresaId}
          perfil={perfilUi}
          hoje={hoje}
          fusoConfigurado={Boolean(fuso)}
          initialData={idAberto ? detalhe : null}
          readOnly={!controller.isEditing}
          ocupado={ocupado}
          onSubmit={controller.handleSubmit}
          onConfirmar={acoes.confirmar && podeGravar ? iniciarConfirmacao : null}
          onDescartar={idAberto && acoes.editar && podeGravar ? () => setDialogo({ tipo: "descartar", registro: detalhe }) : null}
          erroServidor={erroDoFormulario}
        />
      );
    } else {
      conteudoRegistro = (
        <ConsultaLancamento
          detalhe={detalhe}
          perfil={perfilUi}
          fuso={fuso}
          acoes={{ liquidar: acoes.liquidar, estornar: acoes.estornar, cancelar: acoes.cancelar }}
          ocupado={ocupado}
          onLiquidar={(titulo) => setDialogo({ tipo: "liquidar", registro: detalhe, titulo })}
          onEstornar={(liquidacao, titulo) => setDialogo({ tipo: "estornar", registro: detalhe, liquidacao, titulo })}
          onCancelar={() => setDialogo({ tipo: "cancelar", registro: detalhe })}
        />
      );
    }
  }

  const fecharDialogo = () => setDialogo(null);
  const emp = /** @type {string} */ (empresaId);
  const pagar = dialogo?.registro?.direcao === "PAGAR";

  return (
    // Botões e diálogos seguem a regra EXATA do servidor (ações extras da tela);
    // a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <CadastroBase1Screen
        permissaoExplicita
        workspaceTitle="Lançamentos Financeiros"
        searchPlaceholder="Buscar lançamentos…"
        formId={FORMULARIO_LANCAMENTO_ID}
        columnsForCardsToolbar={LANCAMENTOS_COLUNAS}
        controller={{ ...controller, saving: ocupado }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.numero != null ? String(registroAtual.numero) : registroLista?.numero != null ? String(registroLista.numero) : undefined}
        listBanner={aviso}
        showCreate={podeGravar && acoes.criar && Boolean(perfil)}
        showDuplicate={false}
        showEdit={podeGravar && acoes.editar && Boolean(perfil) && Boolean(editavel)}
        showDelete={false}
        extraToolbar={
          <>
            <FiltroLista
              rotulo="Filtrar por direção"
              value={direcaoFiltro}
              onChange={setDirecaoFiltro}
              opcoes={[
                ["TODAS", "Pagar e receber"],
                ["PAGAR", "A pagar"],
                ["RECEBER", "A receber"],
              ]}
            />
            <FiltroLista
              rotulo="Filtrar por situação"
              value={statusFiltro}
              onChange={setStatusFiltro}
              opcoes={[
                ["TODOS", "Todas"],
                ["RASCUNHO", "Rascunhos"],
                ["CONFIRMADO", "Confirmados"],
                ["CANCELADO", "Cancelados"],
              ]}
            />
          </>
        }
        additionalMoreActions={
          perfil && acoes.administrador && podeGravar
            ? [{ key: "perfil-financeiro", label: "Perfil financeiro da empresa", icon: <Settings2 className="h-4 w-4" aria-hidden />, onSelect: () => setDialogo({ tipo: "perfil" }) }]
            : null
        }
        deleteDialog={{
          title: "Descartar rascunho",
          confirmText: "Descartar",
          descriptionOne: "Descartar este rascunho?",
          descriptionMany: (n) => `Descartar ${n} rascunhos?`,
        }}
        recordForm={conteudoRegistro}
        listSlot={
          <TabelaLancamentos
            locale={perfilUi.locale}
            rows={controller.visibleRows}
            onEdit={controller.handleEdit}
            isLoading={controller.isLoading}
            emptyText={empresaId ? "Nenhum lançamento encontrado" : "Selecione uma empresa"}
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

      {dialogo?.tipo === "confirmar" ? (
        <DialogoConfirmacao
          aberto
          registro={dialogo.registro}
          previa={dialogo.previa}
          perfil={perfilUi}
          hoje={hoje}
          fusoConfigurado={Boolean(fuso)}
          podeLiquidar={Boolean(acoes.liquidar)}
          onFechar={fecharDialogo}
          onConsultar={() => consultarDepoisDeIncerto("confirmar", String(dialogo.registro.id))}
          onConfirmar={async ({ baixa_no_ato }, { retentativa }) => {
            try {
              const r = await confirmarLancamento(emp, String(dialogo.registro.id), { versao: dialogo.registro.versao, baixa_no_ato, escopo, retentativa });
              avisarEstoqueAlterado(r, emp);
              concluirComando(r, emp, baixa_no_ato ? "Lançamento confirmado e baixa registrada" : "Lançamento confirmado");
            } catch (err) {
              reagirAoErro(err, emp);
              throw err;
            }
          }}
        />
      ) : null}
      {dialogo?.tipo === "liquidar" ? (
        <DialogoLiquidacao
          aberto
          titulo={dialogo.titulo}
          registro={dialogo.registro}
          perfil={perfilUi}
          hoje={hoje}
          fusoConfigurado={Boolean(fuso)}
          onFechar={fecharDialogo}
          onConsultar={() =>
            consultarDepoisDeIncerto("liquidar", String(dialogo.titulo.id), {
              liquidacoesAntes: (Array.isArray(dialogo.titulo.liquidacoes) ? dialogo.titulo.liquidacoes : []).map((/** @type {any} */ l) => String(l.id)),
            })
          }
          onRegistrar={async (dados, { retentativa }) => {
            try {
              const r = await registrarLiquidacao(emp, String(dialogo.titulo.id), { ...dados, escopo, retentativa });
              concluirComando(r, emp, pagar ? "Pagamento registrado" : "Recebimento registrado");
            } catch (err) {
              reagirAoErro(err, emp);
              throw err;
            }
          }}
        />
      ) : null}
      {dialogo?.tipo === "estornar" ? (
        <DialogoAcao
          aberto
          testId="dialogo-estorno"
          titulo="Estornar baixa"
          descricao="O estorno não apaga a baixa: registra um fato novo que devolve o saldo à parcela. Informe o motivo."
          rotuloBotao="Estornar baixa"
          contexto={contextoMoeda}
          onFechar={fecharDialogo}
          onConsultar={() => consultarDepoisDeIncerto("estornar", String(dialogo.liquidacao.id))}
          onEnviar={async (motivo, { retentativa }) => {
            try {
              const r = await estornarLiquidacao(emp, String(dialogo.liquidacao.id), { motivo, escopo, retentativa });
              concluirComando(r, emp, "Baixa estornada");
            } catch (err) {
              reagirAoErro(err, emp);
              throw err;
            }
          }}
        />
      ) : null}
      {dialogo?.tipo === "cancelar" ? (
        <DialogoAcao
          aberto
          testId="dialogo-cancelamento"
          titulo="Cancelar lançamento"
          descricao="Cancela os títulos e estorna os efeitos no estoque. Só é possível sem baixas ativas e com a mercadoria ainda disponível. Informe o motivo."
          rotuloBotao="Cancelar lançamento"
          contexto={contextoMoeda}
          onFechar={fecharDialogo}
          onConsultar={() => consultarDepoisDeIncerto("cancelar", String(dialogo.registro.id))}
          onEnviar={async (motivo, { retentativa }) => {
            try {
              const r = await cancelarLancamento(emp, String(dialogo.registro.id), { motivo, escopo, retentativa });
              avisarEstoqueAlterado(r, emp);
              concluirComando(r, emp, "Lançamento cancelado");
            } catch (err) {
              reagirAoErro(err, emp);
              throw err;
            }
          }}
        />
      ) : null}
      {dialogo?.tipo === "descartar" ? (
        <DialogoAcao
          aberto
          testId="dialogo-descarte"
          titulo="Descartar rascunho"
          descricao="O rascunho é apagado (ele ainda não gerou título nem mexeu no estoque). Esta ação não pode ser desfeita."
          rotuloBotao="Descartar rascunho"
          comMotivo={false}
          contexto={contextoMoeda}
          onFechar={fecharDialogo}
          onEnviar={async () => {
            try {
              await descartarRascunho(emp, String(dialogo.registro.id), dialogo.registro.versao);
              // Fecha o registro ANTES de mexer no cache: com o registro ainda
              // aberto, tirar o detalhe do cache fazia a tela reler o documento
              // apagado (GET → 404, visto na prova com o backend real). O
              // detalhe fica sem observador e o cache o descarta sozinho.
              setDialogo(null);
              if (daEmpresaAtual({ empresaId: emp })) controller.recordHelpers.closeForm();
              invalidarLista();
              notifySuccess("Sucesso", "Rascunho descartado");
            } catch (err) {
              reagirAoErro(err, emp);
              throw err;
            }
          }}
        />
      ) : null}
    </div>
  );
}

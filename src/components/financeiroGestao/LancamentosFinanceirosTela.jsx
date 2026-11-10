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
import { DialogoAcao, DialogoConfirmacao, DialogoLiquidacao, DialogoMotivos } from "@/components/financeiroGestao/DialogosLancamento";
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
  ROTULO_SITUACAO,
  SITUACOES_LISTA,
  cancelarLancamento,
  confirmarLancamento,
  descartarRascunho,
  ehRecusaDefinitiva,
  ehResultadoIncerto,
  estornarLiquidacao,
  excluirLancamento,
  listarLancamentosPagina,
  obterElegibilidade,
  obterLancamento,
  obterPerfilFinanceiro,
  previaLancamento,
  registrarLiquidacao,
  resolverPendenciaConsultada,
  retificarLancamento,
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

/** "nº 12" do documento (ou vazio). @param {any} registro */
const numeroDe = (registro) => (registro?.numero != null && String(registro.numero) ? `nº ${String(registro.numero)}` : "");

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
 *
 * D-PROD-158 (P3-03): Duplicar (detalhe completo do servidor → formulário NOVO),
 * Editar confirmado (elegibilidade → o MESMO formulário em modo correção →
 * motivo → `/retificar`) e Excluir confirmado (elegibilidade → efeitos + motivo
 * + confirmação → `/excluir`), filtro de situação do registro e histórico de
 * revisões. A tela só explica a elegibilidade observada; quem decide é o
 * servidor, dentro da transação do comando.
 */
export default function LancamentosFinanceirosTela() {
  const queryClient = useQueryClient();
  const { clienteId } = useAuth();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaGestao(TELAS_GESTAO.LANCAMENTOS_FINANCEIROS);
  const escopo = `${clienteId || "sem-tenant"}:${acoes.login || "sem-login"}`;
  const [direcaoFiltro, setDirecaoFiltro] = useState("TODAS");
  const [statusFiltro, setStatusFiltro] = useState("TODOS");
  // D-PROD-158: OPERACIONAIS (padrão) | EXCLUIDOS | TODOS.
  const [situacaoFiltro, setSituacaoFiltro] = useState("OPERACIONAIS");
  const [dialogo, setDialogo] = useState(/** @type {any} */ (null));
  // Cópia aberta (Duplicar): o DETALHE da origem lido do servidor da empresa atual.
  // `semVinculo` (revisão TELA-04): a origem não existe mais (descartada em outra aba); a cópia salva sem `duplicado_de_id`.
  const [copia, setCopia] = useState(/** @type {{ origemId: string, numero: string|null, detalhe: any, empresaId: string, semVinculo?: boolean } | null} */ (null));
  // Correção de confirmado aberta: versão e detalhe do momento da elegibilidade.
  const [correcao, setCorrecao] = useState(
    /** @type {{ id: string, versao: number, detalhe: any, empresaId: string, efeitoFisicoPermitido: boolean, motivos: any[] } | null} */ (null),
  );
  // Sequência das leituras de Duplicar/Editar/Excluir: troca de empresa, de
  // sessão ou um clique mais novo descartam a resposta antiga.
  const acaoSeq = useRef(0);
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
        situacao: situacaoFiltro,
      }),
    [empresaId, direcaoFiltro, statusFiltro, situacaoFiltro],
  );

  const controller = useCadastroBase1Controller({
    storageKey: LANCAMENTOS_STORAGE_KEY,
    columnIds: LANCAMENTOS_CAMPOS_CARD,
    listEnabled: Boolean(empresaId) && acoes.ver,
    queryKey: [QUERY_RAIZ, "page", empresaId, direcaoFiltro, statusFiltro, situacaoFiltro],
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
    setCopia(null);
    setCorrecao(null);
    acaoSeq.current += 1;
    // Só as consultas da empresa ANTERIOR (perfil, lista, detalhe e opções dos
    // seletores levam a empresa na chave): as da nova (perfil e lista, hooks
    // acima) já começaram neste mesmo ciclo, e cancelá-las as deixava
    // "pendentes" sem dados e sem nova busca até sair da tela.
    if (anterior) queryClient.cancelQueries({ predicate: (q) => q.queryKey[0] === QUERY_RAIZ && q.queryKey.includes(anterior) });
  }, [empresaId, closeForm, queryClient]);
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  // Troca de sessão (tenant/login): nada aberto da sessão anterior continua.
  const escopoAtual = useRef(escopo);
  useEffect(() => {
    const anterior = escopoAtual.current;
    escopoAtual.current = escopo;
    if (anterior === escopo || anterior.endsWith(":sem-login")) return;
    acaoSeq.current += 1;
    setCopia(null);
    setCorrecao(null);
    setDialogo(null);
  }, [escopo]);
  /** A resposta ainda vale (mesma empresa, mesma sessão, nenhum clique mais novo)? @param {string} emp @param {string} esc @param {number} seq */
  const respostaVale = (emp, esc, seq) => empresaAtual.current === emp && escopoAtual.current === esc && acaoSeq.current === seq;
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

  // Documento que deixou de ser rascunho não fica em modo de edição — exceto a
  // correção de confirmado aberta pela elegibilidade (D-PROD-158).
  const { isEditing, setIsEditing } = controller;
  const corrigindoAberto = Boolean(correcao && idAberto && correcao.id === idAberto && correcao.empresaId === empresaId);
  useEffect(() => {
    if (isEditing && idAberto && detalhe && detalhe.status !== "RASCUNHO" && !corrigindoAberto) setIsEditing(false);
  }, [isEditing, idAberto, detalhe, setIsEditing, corrigindoAberto]);
  // Correção sai quando a edição sai (✕), o registro muda ou a empresa muda.
  useEffect(() => {
    if (correcao && (!isEditing || !corrigindoAberto)) setCorrecao(null);
  }, [correcao, isEditing, corrigindoAberto]);
  // Cópia sai quando o formulário novo fecha ou vira documento salvo.
  const copiaAberta = Boolean(copia && controller.showForm && !idAberto && copia.empresaId === empresaId);
  useEffect(() => {
    if (copia && !copiaAberta) setCopia(null);
  }, [copia, copiaAberta]);

  /**
   * Abre (em consulta, ou em edição) um documento lido do servidor — também a
   * partir da lista (Excluir, links entre versões, correção).
   * @param {any} registro @param {string} emp @param {boolean} [editando]
   */
  const abrirRegistro = (registro, emp, editando = false) => {
    if (!registro || typeof registro !== "object" || !registro.id) return;
    queryClient.setQueryData([QUERY_RAIZ, "detalhe", emp, String(registro.id)], registro);
    if (!daEmpresaAtual({ empresaId: emp })) return;
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(editando);
    controller.setShowForm(true);
    controller.recordHelpers.chrome.setViewMode("record");
    controller.recordHelpers.bumpFormEpoch();
    controller.recordHelpers.chrome.onSelectionChange([String(registro.id)]);
  };

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

  /**
   * Falha de LEITURA (detalhe/elegibilidade antes de Duplicar, Editar ou
   * Excluir): nada foi enviado, então nunca "resultado incerto".
   * @param {unknown} err @param {string} fallback @param {{ empresaId?: string|null }} v
   */
  const tratarErroDeLeitura = (err, fallback, v) => {
    if (ehResultadoIncerto(err)) {
      notifyWarning("Atenção", `${fallback} Verifique a conexão e tente de novo.`);
      return;
    }
    tratarErro(err, fallback, v);
  };

  // Formulário NOVO cujo último salvar ficou sem resposta definitiva (a
  // pendência de "criar" ficou) ou que escolheu "Manter" o envio pendente:
  // salvar de novo NESTE formulário é a retentativa daquele envio. Outro
  // formulário (outro "Novo", outra visita à tela) é um envio novo — com
  // conteúdo igual, pergunta (§8.7).
  const criarIncertoNoFormulario = useRef(/** @type {number|null} */ (null));
  /** @param {string} emp @param {{ id: string|null, versao: number|null, doc: Record<string, unknown>, formulario: number, duplicadoDeId?: string|null }} v */
  const salvarComRetentativa = async (emp, v) => {
    const novoDoc = !v.id;
    try {
      const r = await salvarRascunho(emp, {
        id: v.id,
        versao: v.versao,
        doc: v.doc,
        escopo,
        retentativa: novoDoc && criarIncertoNoFormulario.current === v.formulario,
        duplicadoDeId: novoDoc ? v.duplicadoDeId ?? null : null,
      });
      if (novoDoc) criarIncertoNoFormulario.current = null;
      return r;
    } catch (err) {
      if (novoDoc) criarIncertoNoFormulario.current = /** @type {any} */ (err)?.code !== CODIGO_ENVIO_PENDENTE && ehRecusaDefinitiva(err) ? null : v.formulario;
      throw err;
    }
  };

  /**
   * Revisão TELA-04: a origem da cópia não existe mais (rascunho descartado em
   * outra aba ou por outra pessoa) → o servidor recusa `duplicado_de_id`. A
   * proveniência é só registro: a cópia continua aberta (nada digitado se
   * perde) e o próximo Salvar vai sem o vínculo, com `operation_id` novo.
   * @param {unknown} err @param {{ empresaId: string }} v
   */
  const soltarOrigemDaCopia = (err, v) => {
    if (lerErroGestao(err).field !== "duplicado_de_id" || !daEmpresaAtual(v)) return;
    setCopia((c) => (c ? { ...c, semVinculo: true } : c));
  };

  const salvarMutation = useMutation({
    /** @param {{ empresaId: string, id: string|null, versao: number|null, doc: Record<string, unknown>, formulario: number, duplicadoDeId?: string|null }} v */
    mutationFn: (v) => salvarComRetentativa(v.empresaId, v),
    onSuccess: (registro, v) => {
      invalidarLista();
      if (!daEmpresaAtual(v)) return avisarEmpresaAnterior();
      aplicarDetalhe(registro, v.empresaId);
      notifySuccess(
        "Sucesso",
        v.id ? "Rascunho atualizado" : v.duplicadoDeId ? "Cópia salva como rascunho novo (ainda não gera título nem mexe no estoque)" : "Rascunho salvo (ainda não gera título nem mexe no estoque)",
      );
    },
    onError: (err, v) => {
      if (daEmpresaAtual(v)) entregarErroAoFormulario(err);
      soltarOrigemDaCopia(err, v);
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
      salvarMutation.mutate({
        empresaId: /** @type {string} */ (empresaId),
        id: null,
        versao: null,
        doc,
        formulario: controller.formEpoch,
        duplicadoDeId: copiaAberta && copia && !copia.semVinculo ? copia.origemId : null,
      });
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
        registro = await salvarComRetentativa(emp, {
          id: registro?.id ?? null,
          versao: registro?.versao ?? null,
          doc,
          formulario: controller.formEpoch,
          duplicadoDeId: !registro?.id && copiaAberta && copia && !copia.semVinculo ? copia.origemId : null,
        });
        invalidarLista();
        if (!daEmpresaAtual({ empresaId: emp })) return avisarEmpresaAnterior();
        aplicarDetalhe(registro, emp);
      }
      const previa = await previaLancamento(emp, String(registro.id));
      if (!daEmpresaAtual({ empresaId: emp })) return;
      setDialogo({ tipo: "confirmar", registro, previa });
    } catch (err) {
      if (daEmpresaAtual({ empresaId: emp })) entregarErroAoFormulario(err);
      soltarOrigemDaCopia(err, { empresaId: emp });
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
    if (
      ehNaoEncontradoGestao(err) ||
      [
        "OPERACAO_VERSAO_CONFLITO",
        "OPERACAO_STATUS_INVALIDO",
        "TITULO_NAO_LIQUIDAVEL",
        "LIQUIDACAO_JA_ESTORNADA",
        // D-PROD-158: a elegibilidade mudou desde a leitura — relê o que a tela mostra.
        "OPERACAO_RETIFICACAO_BLOQUEADA",
        "OPERACAO_EXCLUSAO_BLOQUEADA",
      ].includes(code ?? "")
    ) {
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
   * envio quando o efeito dele aparece (§8.7) e fecha o diálogo. `docId`: o
   * documento do comando quando ele não é o registro aberto (exclusão pela lista).
   * @param {string} acao @param {string} alvo @param {{ liquidacoesAntes?: string[], docId?: string, registroAntes?: any }} [extra]
   */
  const consultarDepoisDeIncerto = async (acao, alvo, extra = {}) => {
    const emp = empresaId;
    const docId = extra.docId ?? idAberto;
    if (!emp || !docId) return;
    /** @type {any} */
    let novo = null;
    if (docId === idAberto) {
      const r = await detalheQuery.refetch();
      // Releitura que falhou devolve o dado ANTIGO: não serve de prova.
      novo = r.status === "success" ? r.data : null;
    } else {
      try {
        novo = await obterLancamento(emp, docId);
      } catch {
        novo = null;
      }
    }
    if (!daEmpresaAtual({ empresaId: emp })) return;
    invalidarLista();
    if (novo) {
      const resolvida = resolverPendenciaConsultada({ escopo, acao, empresaId: emp, alvo, detalhe: novo, liquidacoesAntes: extra.liquidacoesAntes });
      if (resolvida && (acao === "confirmar" || acao === "cancelar" || acao === "excluir")) avisarEstoqueAlterado(novo, emp);
      if (acao === "retificar") {
        setDialogo(null);
        if (!resolvida) {
          // A correção não aparece no documento: o formulário (com as alterações) continua aberto.
          notifyInfo("Correção ainda não aparece", "O lançamento continua na versão anterior. Para concluir sem duplicar, salve de novo com o MESMO conteúdo e o mesmo motivo.");
          return;
        }
        setCorrecao(null);
        const atualId = novo.substituido_por?.id ? String(novo.substituido_por.id) : null;
        if (atualId) {
          avisarEstoqueAlterado(temMercadoria(novo) ? novo : extra.registroAntes, emp);
          queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "detalhe", emp] });
          try {
            const atual = await obterLancamento(emp, atualId);
            if (daEmpresaAtual({ empresaId: emp })) abrirRegistro(atual, emp);
            return;
          } catch {
            /* sem o documento novo: mostra a versão anterior, que aponta para ele */
          }
        }
        abrirRegistro(novo, emp);
        return;
      }
      if (docId === idAberto) aplicarDetalhe(novo, emp);
      else abrirRegistro(novo, emp);
    }
    setDialogo(null);
  };

  // ─── D-PROD-158 — Duplicar, Editar confirmado, Excluir confirmado ───────

  /**
   * Duplicar: lê SEMPRE o detalhe completo e atual do servidor da empresa
   * atual (nunca o resumo da lista nem o cache) e abre o formulário NOVO
   * pré-preenchido. Nada é gravado até "Salvar".
   * @param {string} id
   */
  const duplicar = async (id) => {
    if (!empresaId || !perfil || !acoes.ver || !acoes.criar || preparandoRef.current) return;
    const emp = empresaId;
    const esc = escopo;
    const seq = ++acaoSeq.current;
    preparandoRef.current = true;
    setPreparando(true);
    try {
      const origem = /** @type {any} */ (await obterLancamento(emp, id));
      if (!respostaVale(emp, esc, seq)) return;
      if (!origem?.id) return;
      queryClient.setQueryData([QUERY_RAIZ, "detalhe", emp, String(origem.id)], origem);
      // Valores na escala de OUTRA moeda não viram cópia (nada de converter em silêncio).
      if ((origem.moeda && origem.moeda !== perfil.moeda) || (Number.isInteger(origem.moeda_casas) && origem.moeda_casas !== perfil.moeda_casas)) {
        notifyWarning("Atenção", `O lançamento ${numeroDe(origem)} está em ${origem.moeda} e a empresa usa ${perfil.moeda}: a cópia não converte valores. Lance um novo.`);
        return;
      }
      setDialogo(null);
      controller.openNew();
      setCopia({ origemId: String(origem.id), numero: origem.numero != null ? String(origem.numero) : null, detalhe: origem, empresaId: emp });
    } catch (err) {
      if (respostaVale(emp, esc, seq)) tratarErroDeLeitura(err, "Não foi possível ler o lançamento de origem. Nada foi gravado.", { empresaId: emp });
    } finally {
      preparandoRef.current = false;
      setPreparando(false);
    }
  };

  /**
   * Elegibilidade + detalhe frescos do servidor (os dois da empresa atual).
   * @param {string} id
   * @returns {Promise<{ eleg: Awaited<ReturnType<typeof obterElegibilidade>>, det: any, emp: string } | null>}
   */
  const lerElegibilidade = async (id) => {
    if (!empresaId || preparandoRef.current) return null;
    const emp = empresaId;
    const esc = escopo;
    const seq = ++acaoSeq.current;
    preparandoRef.current = true;
    setPreparando(true);
    try {
      const [eleg, det] = await Promise.all([obterElegibilidade(emp, id), obterLancamento(emp, id)]);
      if (!respostaVale(emp, esc, seq)) return null;
      queryClient.setQueryData([QUERY_RAIZ, "detalhe", emp, String(/** @type {any} */ (det).id)], det);
      return { eleg, det: /** @type {any} */ (det), emp };
    } catch (err) {
      if (respostaVale(emp, esc, seq)) tratarErroDeLeitura(err, "Não foi possível verificar o lançamento agora. Nada foi alterado.", { empresaId: emp });
      return null;
    } finally {
      preparandoRef.current = false;
      setPreparando(false);
    }
  };

  /** Editar: rascunho como hoje; confirmado só depois da elegibilidade. @param {string} id */
  const iniciarCorrecao = async (id) => {
    const lido = await lerElegibilidade(id);
    if (!lido) return;
    const { eleg, det, emp } = lido;
    if (!eleg.editar.permitido) {
      setDialogo({ tipo: "bloqueio", acao: "editar", motivos: eleg.editar.motivos, registro: det });
      return;
    }
    if (eleg.editar.modo === "RASCUNHO" && det.status === "RASCUNHO") {
      abrirRegistro(det, emp, true);
      return;
    }
    if (eleg.editar.modo !== "RETIFICACAO" || det.status !== "CONFIRMADO" || (eleg.versao !== null && eleg.versao !== det.versao)) {
      invalidarLista();
      notifyWarning("Atenção", "O lançamento mudou enquanto era verificado. Confira e tente de novo. Nada foi alterado.");
      abrirRegistro(det, emp);
      return;
    }
    abrirRegistro(det, emp, true);
    setCorrecao({
      id: String(det.id),
      versao: det.versao,
      detalhe: det,
      empresaId: emp,
      efeitoFisicoPermitido: eleg.editar.efeito_fisico_permitido,
      motivos: eleg.editar.motivos,
    });
  };

  /** Excluir confirmado: elegibilidade → diálogo com efeitos, motivo e confirmação. Nada é enviado no clique. @param {string} id */
  const iniciarExclusao = async (id) => {
    const lido = await lerElegibilidade(id);
    if (!lido) return;
    const { eleg, det } = lido;
    if (!eleg.excluir.permitido) {
      setDialogo({ tipo: "bloqueio", acao: "excluir", motivos: eleg.excluir.motivos, registro: det });
      return;
    }
    if (eleg.excluir.modo === "DESCARTE" && det.status === "RASCUNHO") {
      if (acoes.editar) setDialogo({ tipo: "descartar", registro: det });
      return;
    }
    // Revisão TELA-03: a mesma guarda da correção — o diálogo mostra o DETALHE, então o CAS
    // vai com a versão dele; se a elegibilidade leu outra versão, o conteúdo mostrado não é o que seria excluído.
    if (eleg.excluir.modo !== "LOGICA" || det.status !== "CONFIRMADO" || (eleg.versao !== null && eleg.versao !== det.versao)) {
      invalidarLista();
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "detalhe", lido.emp, String(det.id)] });
      notifyWarning("Atenção", "O lançamento mudou enquanto era verificado. Confira e tente de novo. Nada foi alterado.");
      return;
    }
    setDialogo({ tipo: "excluir", registro: det });
  };

  /** Links do histórico de revisões: abre outra versão do mesmo lançamento lógico. @param {string} id */
  const abrirLancamento = async (id) => {
    if (!empresaId) return;
    const emp = empresaId;
    const esc = escopo;
    const seq = ++acaoSeq.current;
    try {
      const det = await obterLancamento(emp, id);
      if (respostaVale(emp, esc, seq)) abrirRegistro(det, emp);
    } catch (err) {
      if (respostaVale(emp, esc, seq)) tratarErroDeLeitura(err, "Não foi possível abrir esta versão do lançamento.", { empresaId: emp });
    }
  };

  /**
   * Correção gravada: mostra o documento ATUAL (o novo, na substituição),
   * relê lista e detalhes e avisa o estoque quando ele foi refeito.
   * @param {any} r @param {string} emp @param {any} anterior
   */
  const concluirCorrecao = (r, emp, anterior) => {
    const modo = r?.retificacao?.modo;
    const substituiu = modo === "SUBSTITUICAO" || (anterior?.id && r?.id && String(r.id) !== String(anterior.id));
    setCorrecao(null);
    if (substituiu) {
      avisarEstoqueAlterado(temMercadoria(r) ? r : anterior, emp);
      queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "detalhe", emp, String(anterior?.id)] });
    }
    invalidarLista();
    if (!daEmpresaAtual({ empresaId: emp })) return avisarEmpresaAnterior();
    abrirRegistro(r, emp);
    setDialogo(null);
    const mensagem = substituiu
      ? `Lançamento ${numeroDe(r)} corrigido: a versão anterior foi estornada e os efeitos novos foram registrados (versão ${r?.versao ?? "—"})`
      : `Lançamento ${numeroDe(r)} corrigido (versão ${r?.versao ?? "—"}); o estoque não mudou`;
    notifySuccess("Sucesso", r?.replay ? `${mensagem} (envio repetido: nada foi duplicado)` : mensagem);
  };

  const ocupado = salvarMutation.isPending || preparando;
  const registroAtual = detalhe;
  const selecionado = !controller.showForm && controller.chrome.selectedIds.length === 1
    ? controller.visibleRows.find((/** @type {any} */ r) => String(r.id) === String(controller.chrome.selectedIds[0]))
    : null;
  // Alvo das ações da barra (Editar, Duplicar, Excluir): o registro aberto ou a linha/card selecionado.
  const alvoDaBarra = /** @type {any} */ (controller.showForm ? (idAberto ? { ...(registroLista ?? {}), ...(detalhe ?? {}), status: statusAberto } : null) : selecionado);
  const statusDoAlvo = alvoDaBarra?.status ?? null;
  // Editar: rascunho como hoje; confirmado abre a correção depois da elegibilidade (D-PROD-158).
  const editavel = statusDoAlvo === "RASCUNHO" || statusDoAlvo === "CONFIRMADO";
  const podeDuplicar = podeGravar && acoes.ver && acoes.criar && Boolean(perfil) && Boolean(alvoDaBarra?.id) && !(controller.showForm && controller.isEditing);
  const podeExcluirConfirmado = podeGravar && Boolean(acoes.excluir) && Boolean(perfil) && statusDoAlvo === "CONFIRMADO" && !(controller.showForm && controller.isEditing);

  const editarDaBarra = () => {
    if (statusDoAlvo === "CONFIRMADO" && alvoDaBarra?.id) {
      void iniciarCorrecao(String(alvoDaBarra.id));
      return true;
    }
    return controller.handleEditSelected();
  };
  const duplicarDaBarra = () => {
    if (alvoDaBarra?.id) void duplicar(String(alvoDaBarra.id));
  };
  const excluirDaBarra = () => {
    if (statusDoAlvo === "CONFIRMADO" && alvoDaBarra?.id) void iniciarExclusao(String(alvoDaBarra.id));
  };
  // "Novo" sempre abre um formulário em branco (nunca a cópia anterior).
  const abrirNovo = () => {
    setCopia(null);
    controller.openNew();
  };

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
    } else if (corrigindoAberto && correcao && controller.isEditing) {
      // Correção de confirmado (D-PROD-158): o MESMO formulário, com a versão lida na elegibilidade.
      conteudoRegistro = (
        <FormularioLancamento
          key={`correcao-${correcao.id}-${correcao.versao}-${controller.formEpoch}`}
          empresaId={empresaId}
          perfil={perfilUi}
          hoje={hoje}
          fusoConfigurado={Boolean(fuso)}
          initialData={correcao.detalhe}
          readOnly={false}
          ocupado={ocupado}
          onSubmit={controller.handleSubmit}
          retificacao={{ efeitoFisicoPermitido: correcao.efeitoFisicoPermitido, motivos: correcao.motivos }}
          onRetificar={({ doc, mudaEstoque, diferencas }) => setDialogo({ tipo: "retificar", registro: correcao.detalhe, versao: correcao.versao, doc, mudaEstoque, diferencas })}
          erroServidor={erroDoFormulario}
        />
      );
    } else if (idAberto && !detalhe) {
      conteudoRegistro = (
        <p className="p-3 text-[13px] text-[var(--mg-text-2,#475569)]" data-testid="carregando-lancamento">
          {detalheQuery.isError ? "Não foi possível abrir o lançamento." : "Carregando lançamento…"}
        </p>
      );
    } else if (!idAberto || detalhe?.status === "RASCUNHO") {
      conteudoRegistro = (
        <FormularioLancamento
          key={`${idAberto ?? (copiaAberta && copia ? `copia-${copia.origemId}` : "lancamento-novo")}-${controller.formEpoch}-${detalhe?.versao ?? 0}`}
          empresaId={empresaId}
          perfil={perfilUi}
          hoje={hoje}
          fusoConfigurado={Boolean(fuso)}
          initialData={idAberto ? detalhe : null}
          duplicarDe={!idAberto && copiaAberta && copia ? { detalhe: copia.detalhe, numero: copia.numero } : null}
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
          acoes={{ liquidar: acoes.liquidar, estornar: acoes.estornar, cancelar: acoes.cancelar, excluir: Boolean(acoes.excluir) && podeGravar }}
          ocupado={ocupado}
          onLiquidar={(titulo) => setDialogo({ tipo: "liquidar", registro: detalhe, titulo })}
          onEstornar={(liquidacao, titulo) => setDialogo({ tipo: "estornar", registro: detalhe, liquidacao, titulo })}
          onCancelar={() => setDialogo({ tipo: "cancelar", registro: detalhe })}
          onExcluir={() => void iniciarExclusao(String(detalhe.id))}
          onAbrirLancamento={(id) => void abrirLancamento(id)}
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
        controller={{
          ...controller,
          saving: ocupado,
          openNew: abrirNovo,
          handleEditSelected: editarDaBarra,
          handleDuplicateSelected: duplicarDaBarra,
          handleDeleteSelected: excluirDaBarra,
        }}
        listErrorMessage={listErrorMessage}
        recordCode={registroAtual?.numero != null ? String(registroAtual.numero) : registroLista?.numero != null ? String(registroLista.numero) : undefined}
        listBanner={aviso}
        showCreate={podeGravar && acoes.criar && Boolean(perfil)}
        showDuplicate={podeDuplicar}
        showEdit={podeGravar && acoes.editar && Boolean(perfil) && Boolean(editavel)}
        showDelete={podeExcluirConfirmado}
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
            <FiltroLista
              rotulo="Filtrar por situação do registro"
              value={situacaoFiltro}
              onChange={setSituacaoFiltro}
              opcoes={/** @type {Array<[string, string]>} */ (SITUACOES_LISTA.map((s) => [s, ROTULO_SITUACAO[/** @type {keyof typeof ROTULO_SITUACAO} */ (s)]]))}
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
      {dialogo?.tipo === "bloqueio" ? (
        <DialogoMotivos
          aberto
          titulo={dialogo.acao === "editar" ? "Correção bloqueada" : "Exclusão bloqueada"}
          descricao={
            dialogo.acao === "editar"
              ? `O lançamento ${numeroDe(dialogo.registro)} não pode ser corrigido agora. Nada foi aberto nem alterado:`
              : `O lançamento ${numeroDe(dialogo.registro)} não pode ser excluído agora. Nada foi alterado:`
          }
          motivos={dialogo.motivos}
          contexto={{ ...contextoMoeda, direcao: dialogo.registro?.direcao ?? null }}
          onFechar={fecharDialogo}
          rodape={acoes.criar ? "Para lançar de novo a partir deste documento, use Duplicar: a cópia é um rascunho novo e independente." : null}
        />
      ) : null}
      {dialogo?.tipo === "retificar" ? (
        <DialogoAcao
          aberto
          testId="dialogo-retificacao"
          titulo={`Salvar correção do lançamento ${numeroDe(dialogo.registro)}`}
          descricao="Informe o motivo da correção. Tudo é gravado de uma vez: ou a correção inteira, ou nada."
          rotuloBotao="Salvar correção"
          perigo={false}
          contexto={{ ...contextoMoeda, direcao: dialogo.registro?.direcao ?? null }}
          conteudo={
            <ul className="list-disc space-y-1 pl-5" data-testid="dialogo-retificacao-efeitos">
              <li className="break-words">As parcelas (títulos, todas sem baixa) são recriadas com os valores e vencimentos novos.</li>
              {dialogo.mudaEstoque ? (
                <li className="break-words font-medium" data-testid="dialogo-retificacao-estoque">
                  O estoque muda: {dialogo.registro?.direcao === "PAGAR" ? "a entrada anterior é estornada e uma nova entrada" : "a saída anterior é estornada e uma nova saída"} é
                  registrada. O lançamento continua com o MESMO número, numa versão nova; a versão anterior fica no histórico.
                </li>
              ) : (
                <li className="break-words" data-testid="dialogo-retificacao-estoque">
                  O estoque não muda: lotes e movimentos continuam os mesmos. É a previsão da tela; quem decide é o servidor, ao gravar (se ele refizer o
                  estoque, a tela avisa).
                </li>
              )}
              {!dialogo.mudaEstoque && dialogo.doc?.direcao && dialogo.doc.direcao !== dialogo.registro?.direcao ? (
                <li className="break-words font-medium" data-testid="dialogo-retificacao-versao">
                  A direção muda: o lançamento ganha uma versão nova com o MESMO número; a versão anterior fica no histórico.
                </li>
              ) : null}
              <li className="break-words">O motivo, o autor e a versão anterior ficam no histórico de revisões.</li>
            </ul>
          }
          onFechar={fecharDialogo}
          onConsultar={() => consultarDepoisDeIncerto("retificar", String(dialogo.registro.id), { docId: String(dialogo.registro.id), registroAntes: dialogo.registro })}
          onEnviar={async (motivo, { retentativa }) => {
            try {
              const r = await retificarLancamento(emp, String(dialogo.registro.id), { versao: dialogo.versao, doc: dialogo.doc, motivo, escopo, retentativa });
              concluirCorrecao(r, emp, dialogo.registro);
            } catch (err) {
              if (daEmpresaAtual({ empresaId: emp })) entregarErroAoFormulario(err);
              reagirAoErro(err, emp);
              throw err;
            }
          }}
        />
      ) : null}
      {dialogo?.tipo === "excluir" ? (
        <DialogoAcao
          aberto
          testId="dialogo-exclusao"
          titulo={`Excluir lançamento ${numeroDe(dialogo.registro)}`}
          descricao="Para um lançamento CONFIRMADO lançado por engano. Não é Cancelar (operação real desfeita) nem Descartar rascunho: nada é apagado."
          rotuloBotao="Excluir lançamento"
          contexto={{ ...contextoMoeda, direcao: dialogo.registro?.direcao ?? null }}
          confirmacaoExplicita="Confirmo que este lançamento foi lançado por engano e deve ser excluído."
          conteudo={
            <ul className="list-disc space-y-1 pl-5" data-testid="dialogo-exclusao-efeitos">
              <li className="break-words">
                {(() => {
                  const n = Array.isArray(dialogo.registro?.titulos) ? dialogo.registro.titulos.length : 0;
                  return `${n === 1 ? "A parcela é cancelada" : `As ${n} parcelas são canceladas`} (nenhuma tem baixa).`;
                })()}
              </li>
              {temMercadoria(dialogo.registro) ? (
                <li className="break-words font-medium">
                  {dialogo.registro?.direcao === "PAGAR" ? "A entrada" : "A saída"} da mercadoria no estoque é estornada (o movimento original e o estorno ficam no histórico).
                </li>
              ) : (
                <li className="break-words">Sem mercadoria: o estoque não muda.</li>
              )}
              <li className="break-words">O lançamento sai da lista operacional e continua consultável no filtro “Excluídos”, com motivo, autor e data.</li>
            </ul>
          }
          onFechar={fecharDialogo}
          onConsultar={() => consultarDepoisDeIncerto("excluir", String(dialogo.registro.id), { docId: String(dialogo.registro.id) })}
          onEnviar={async (motivo, { retentativa }) => {
            try {
              const r = /** @type {any} */ (await excluirLancamento(emp, String(dialogo.registro.id), { versao: dialogo.registro.versao, motivo, escopo, retentativa }));
              avisarEstoqueAlterado(temMercadoria(r) ? r : dialogo.registro, emp);
              invalidarLista();
              if (!daEmpresaAtual({ empresaId: emp })) return avisarEmpresaAnterior();
              abrirRegistro(r, emp);
              setDialogo(null);
              notifySuccess("Sucesso", r?.replay ? "Lançamento excluído (envio repetido: nada foi duplicado)" : "Lançamento excluído: títulos cancelados e estoque estornado");
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

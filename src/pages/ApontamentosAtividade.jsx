import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FiltrosDaTelaContext } from "@/components/cadastro/base1/FiltrosRapidos";
import CadastroBase1Screen from "@/components/cadastro/base1/CadastroBase1Screen";
import { AvisoGestao, CampoSelect } from "@/components/gestao/GestaoFormParts";
import { CampoDia } from "@/components/financeiroGestao/CamposLancamento";
import SeletorPaginadoGestao from "@/components/financeiroGestao/SeletorPaginadoGestao";
import { DialogoAcao } from "@/components/financeiroGestao/DialogosLancamento";
import FormularioApontamentoAtividade, {
  FORMULARIO_APONTAMENTO_ATIVIDADE_ID,
} from "@/components/apontamentos-atividade/FormularioApontamentoAtividade";
import TabelaApontamentosAtividade, {
  APONTAMENTOS_ATIVIDADE_CAMPOS_CARD,
  APONTAMENTOS_ATIVIDADE_COLUNAS,
  APONTAMENTOS_ATIVIDADE_STORAGE_KEY,
  valorDoCampoApontamento,
} from "@/components/apontamentos-atividade/TabelaApontamentosAtividade";
import { useCadastroBase1Controller } from "@/hooks/useCadastroBase1Controller";
import { useAcoesTelaApontamento, useEmpresaRealSelecionadaId } from "@/hooks/useApontamentoAtividadeSessao";
import { useAuth } from "@/lib/AuthContext";
import { notifyInfo, notifySuccess, notifyWarning } from "@/lib/maikeNotify";
import { hojeNoFuso } from "@/lib/diaCivil";
import {
  CODIGOS_RELER_APONTAMENTO,
  ITEM_PRODUTO,
  NATUREZAS_MAQUINA,
  ROTULO_TIPO_ITEM,
  STATUS_CANCELADO,
  STATUS_CONFIRMADO,
  campoDoErroApontamento,
  cancelamentoDevolveuProduto,
  codigoDoErroApontamento,
  formatarQuantidadeItem,
  formatarValorItem,
  itensDoRegistro,
  mensagemErroApontamento,
  rotuloDaArea,
  rotuloDoBem,
} from "@/lib/apontamentoAtividadeRegras";
import { listEmpresas } from "@/services/empresaService";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import {
  ACAO_CANCELAR,
  adicionarItemApontamento,
  alvoDoItem,
  atualizarApontamento,
  cancelarApontamento,
  cancelarItemApontamento,
  criarApontamento,
  detalharApontamento,
  limparPendenciaDoApontamento,
  listarApontamentosPagina,
  listarAreasDoApontamento,
  listarOpcoesApontamento,
  listarTiposAtividade,
} from "@/services/apontamentoAtividadeService";

const QUERY_RAIZ = "apontamentos-atividade";

/**
 * Consultas que as telas de estoque e o Mapa leem (cópia local do predicado do
 * abastecimento): depois de baixa ou estorno de item de Produto ficam velhas.
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

const OPCOES_SITUACAO = [
  { value: "TODOS", label: "Todas as situações" },
  { value: STATUS_CONFIRMADO, label: "Confirmados" },
  { value: STATUS_CANCELADO, label: "Cancelados" },
];

/** Formatação das mensagens do diálogo de ação (não há dinheiro neste diálogo). */
const CONTEXTO_MENSAGENS = Object.freeze({ locale: "pt-BR", moeda: "BRL", casas: 2 });

/**
 * Apontamentos de Atividade (D-PROD-190, Fatia C) — a EXECUÇÃO de um Tipo de
 * Atividade na EMPRESA selecionada. A TAREFA é a demanda; a ATIVIDADE é a
 * operação feita (máquina, implemento, operador, área, horário e produção).
 *
 * Lista keyset com filtros (tipo, máquina, área, período e situação) e busca
 * pelo nº no servidor. Novo e editar no formulário Base1; sem exclusão física:
 * o apontamento CONFIRMADO se cancela com motivo (ação Excluir da tela) e o
 * CANCELADO abre só leitura. Edição e cancelamento levam a `versao` lida.
 *
 * Itens (D-PROD-191, Fatia D): o registro aberto é o DETALHE do servidor (com
 * `itens` e `custo_itens`), não a linha da lista. Lançar item, cancelar item e
 * cancelar o apontamento levam `operation_id` persistente (sem resposta =
 * resultado incerto, nunca sucesso; repetir não duplica) e a resposta, que é o
 * detalhe, vai para o cache do detalhe; a lista é relida (a `versao` mudou).
 * No REPLAY a resposta é o corpo gravado no recibo, que pode ser mais velho que
 * o cache: o detalhe é relido em vez de sobrescrito. "Cancelar apontamento" só
 * aparece com os itens conhecidos (o detalhe chegou), e a devolução ao estoque
 * é decidida pela resposta do servidor.
 *
 * Salvaguardas de Gestão: sem empresa real nada é lido; trocar de empresa
 * fecha o registro e os diálogos; sem fuso da fazenda não há "hoje" nem hora,
 * então novo, editar, cancelar o apontamento e cancelar item ficam fechados (o
 * servidor recusaria: o estorno usa o "hoje" da fazenda).
 */
export default function ApontamentosAtividade() {
  const queryClient = useQueryClient();
  const { clienteId } = useAuth();
  const empresaId = useEmpresaRealSelecionadaId();
  const acoes = useAcoesTelaApontamento();
  // Escopo da pendência de `operation_id` (o service prefixa `apontamento:`).
  const escopo = `${clienteId || "sem-tenant"}:${acoes.login || "sem-login"}`;
  const submitRef = useRef(/** @type {(data: any) => void} */ (() => {}));

  const [tipoFiltro, setTipoFiltro] = useState("");
  const [bemFiltro, setBemFiltro] = useState(/** @type {{ id: string, rotulo: string } | null} */ (null));
  const [areaFiltro, setAreaFiltro] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("TODOS");
  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const periodoInvertido = Boolean(dataDe && dataAte && dataDe > dataAte);
  const [cancelando, setCancelando] = useState(/** @type {any} */ (null));
  // Item a cancelar (D-PROD-191): o detalhe aberto e o item, lidos no clique.
  const [cancelandoItem, setCancelandoItem] = useState(/** @type {{ registro: any, item: any } | null} */ (null));
  // Recusa do servidor que aponta um campo, presa ao registro em que aconteceu ('novo' ou o id).
  const [erroDoServidor, setErroDoServidor] = useState(/** @type {{ campo: string, mensagem: string, alvo: string } | null} */ (null));

  // Fuso da FAZENDA (o "hoje" e a hora do apontamento): o mesmo resumo de empresas do Layout.
  const empresasQuery = useQuery({
    queryKey: ["empresas"],
    queryFn: () => listEmpresas(),
    enabled: Boolean(empresaId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const fuso = useMemo(() => {
    const empresa = (Array.isArray(empresasQuery.data) ? empresasQuery.data : []).find((e) => String(e?.id) === String(empresaId));
    return typeof empresa?.fuso_horario === "string" && empresa.fuso_horario ? empresa.fuso_horario : null;
  }, [empresasQuery.data, empresaId]);
  const fusoOk = Boolean(fuso);
  const semFuso = Boolean(empresaId) && empresasQuery.isSuccess && !fuso;
  const hoje = hojeNoFuso(fuso);

  const { data: tipos = [] } = useQuery({
    queryKey: [QUERY_RAIZ, "tipos"],
    queryFn: () => listarTiposAtividade(),
    enabled: acoes.ver,
    staleTime: 30 * 1000,
  });
  const { data: areas = [] } = useQuery({
    queryKey: [QUERY_RAIZ, "areas", empresaId],
    queryFn: () => listarAreasDoApontamento(empresaId),
    enabled: Boolean(empresaId) && acoes.ver,
    staleTime: 30 * 1000,
  });

  const listEnabled = Boolean(empresaId) && acoes.ver && !periodoInvertido;

  const fetchPage = useCallback(
    (/** @type {{ limit: number, cursor: string|null, q?: string }} */ { limit, cursor, q }) =>
      listarApontamentosPagina(empresaId, {
        limit,
        cursor,
        q: q || undefined,
        tipoAtividadeId: tipoFiltro || null,
        bemId: bemFiltro?.id ?? null,
        areaId: areaFiltro || null,
        status: statusFiltro !== "TODOS" ? statusFiltro : null,
        dataDe: dataDe || null,
        dataAte: dataAte || null,
      }),
    [empresaId, tipoFiltro, bemFiltro, areaFiltro, statusFiltro, dataDe, dataAte],
  );

  const controller = useCadastroBase1Controller({
    storageKey: APONTAMENTOS_ATIVIDADE_STORAGE_KEY,
    columnIds: APONTAMENTOS_ATIVIDADE_CAMPOS_CARD,
    listEnabled,
    queryKey: [QUERY_RAIZ, "page", empresaId, tipoFiltro, bemFiltro?.id ?? null, areaFiltro, statusFiltro, dataDe, dataAte],
    fetchPage,
    duplicateLabelField: "numero",
    searchPlaceholder: "Buscar nº…",
    exportFileName: "apontamentos-atividade.csv",
    exportColumns: APONTAMENTOS_ATIVIDADE_COLUNAS,
    getExportFieldValue: valorDoCampoApontamento,
    getRecordTitle: (/** @type {any} */ item) => (item?.id ? `Apontamento nº ${item.numero ?? ""}` : "Novo apontamento de atividade"),
    getRecordCode: (/** @type {any} */ item) => (item?.id && item?.numero != null ? String(item.numero) : undefined),
    getSearchHaystack: (/** @type {any} */ a) =>
      [a.numero, a.tipo_atividade_nome, rotuloDoBem(a.bem), rotuloDaArea(a.area)].filter((v) => v != null && v !== "").join(" "),
    mapSearchSuggestion: (/** @type {any} */ a) => ({
      id: String(a.id),
      label: `Nº ${a.numero ?? ""} — ${a.tipo_atividade_nome ?? ""}`,
      secondary: rotuloDoBem(a.bem) || undefined,
    }),
    matchRowId: (/** @type {any} */ a, /** @type {string} */ id) => String(a.id) === String(id),
    getRowId: (/** @type {any} */ a) => String(a.id),
    findRowById: (/** @type {any[]} */ rows, /** @type {string} */ id) => rows.find((a) => String(a.id) === String(id)),
    onSubmitRecord: (/** @type {any} */ data) => submitRef.current(data),
    // Apontamento não se apaga: cancela com motivo (ação própria).
    onRequestDeleteMutation: () => {},
  });

  // Troca de empresa: nada da empresa anterior continua na tela.
  const empresaAnterior = useRef(empresaId);
  const trocandoEmpresa = empresaAnterior.current !== empresaId;
  const { closeForm } = controller;
  useEffect(() => {
    if (empresaAnterior.current === empresaId) return;
    empresaAnterior.current = empresaId;
    closeForm();
    setCancelando(null);
    setCancelandoItem(null);
    setBemFiltro(null);
    setAreaFiltro("");
    setErroDoServidor(null);
  }, [empresaId, closeForm]);
  // Resposta que chega depois de trocar a empresa não mexe no registro aberto da empresa nova.
  const empresaAtual = useRef(empresaId);
  empresaAtual.current = empresaId;
  /** @param {string|null|undefined} emp */
  const daEmpresaAtual = (emp) => Boolean(emp) && emp === empresaAtual.current;

  const invalidar = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "page"] });
  /** @param {string|null|undefined} emp @param {string} id */
  const chaveDetalhe = (emp, id) => [QUERY_RAIZ, "detalhe", emp ?? null, id];
  const relerDetalhes = () => queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "detalhe"] });

  // Registro aberto (D-PROD-191): a lista traz o RESUMO; os itens vêm do DETALHE.
  const registroLista = /** @type {any} */ (controller.editingItem);
  const idAberto = controller.showForm && registroLista?.id ? String(registroLista.id) : null;
  const detalheQuery = useQuery({
    queryKey: chaveDetalhe(empresaId, idAberto ?? ""),
    queryFn: () => detalharApontamento(empresaId, /** @type {string} */ (idAberto)),
    enabled: Boolean(empresaId && idAberto && acoes.ver && !trocandoEmpresa),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
  const detalheBruto = /** @type {any} */ (detalheQuery.data ?? null);
  const detalhe = detalheBruto && idAberto && String(detalheBruto.id) === idAberto ? detalheBruto : null;
  // O detalhe vale quando é da mesma versão (ou mais nova) que o resumo aberto; senão, o resumo até o detalhe ser relido.
  const registroAberto = /** @type {any} */ (
    idAberto ? (detalhe && Number(detalhe.versao ?? 0) >= Number(registroLista?.versao ?? 0) ? detalhe : registroLista) : null
  );
  useEffect(() => {
    if (!detalheQuery.error) return;
    if (codigoDoErroApontamento(detalheQuery.error) === "APONTAMENTO_ATIVIDADE_NOT_FOUND") {
      invalidar();
      closeForm();
    }
    notifyWarning("Atenção", mensagemErroApontamento(detalheQuery.error, "Não foi possível ler os itens do apontamento."));
  }, [detalheQuery.error]);

  /**
   * Resposta do servidor no cache do detalhe. Com `itens` (o detalhe), ela vai
   * para o cache sem nova leitura. No REPLAY (`replay: true`) o corpo é o
   * gravado no recibo, que pode ser mais velho que o cache: o detalhe é
   * invalidado e relido, nunca sobrescrito. Sem `itens` (resposta de criar ou
   * editar o cabeçalho), o detalhe também é relido.
   * @param {any} registro @param {string|null} emp
   */
  const guardarDetalhe = (registro, emp) => {
    const chave = chaveDetalhe(emp, String(registro.id));
    if (Array.isArray(registro.itens) && registro.replay !== true) queryClient.setQueryData(chave, registro);
    else queryClient.invalidateQueries({ queryKey: chave });
  };

  /**
   * Mostra o registro devolvido pelo servidor (somente leitura); o cache do
   * detalhe segue `guardarDetalhe`. O registro aberto é o mais novo entre o
   * detalhe e esta resposta (pela `versao`), então o replay mais velho que o
   * cache não volta a tela para trás.
   * @param {any} registro @param {string|null} [emp]
   */
  const mostrarRegistro = (registro, emp = empresaId) => {
    if (!registro || typeof registro !== "object" || !registro.id) {
      controller.recordHelpers.closeForm();
      return;
    }
    guardarDetalhe(registro, emp);
    controller.recordHelpers.recordBeforeNewRef.current = null;
    controller.setEditingItem(registro);
    controller.setIsEditing(false);
    controller.recordHelpers.setShowForm(true);
    controller.recordHelpers.bumpFormEpoch();
    controller.recordHelpers.chrome.setViewMode("record");
    controller.recordHelpers.chrome.onSelectionChange([String(registro.id)]);
  };

  /**
   * Recusa do servidor: relê o que mudou e destaca o campo apontado.
   * @param {unknown} erro @param {string} fallback @param {string} emp @param {string} alvo 'novo' ou o id do apontamento
   */
  const reagirAoErro = (erro, fallback, emp, alvo) => {
    const code = codigoDoErroApontamento(erro);
    if (code && CODIGOS_RELER_APONTAMENTO.includes(code)) {
      invalidar();
      relerDetalhes();
      if (code === "APONTAMENTO_ATIVIDADE_NOT_FOUND" && daEmpresaAtual(emp)) {
        setCancelando(null);
        setCancelandoItem(null);
        closeForm();
      }
    }
    const mensagem = mensagemErroApontamento(erro, fallback);
    const campo = campoDoErroApontamento(erro);
    if (campo && daEmpresaAtual(emp)) setErroDoServidor({ campo, mensagem, alvo });
    return mensagem;
  };

  const createMutation = useMutation({
    /** @param {{ empresaId: string, data: Record<string, unknown> }} v */
    mutationFn: ({ empresaId: emp, data }) => criarApontamento(emp, data),
    onSuccess: (/** @type {any} */ criado, v) => {
      invalidar();
      if (!daEmpresaAtual(v.empresaId)) return notifyInfo("Gravação concluída", "O apontamento feito na empresa anterior foi gravado.");
      mostrarRegistro(criado);
      notifySuccess("Sucesso", `Apontamento nº ${criado?.numero ?? ""} registrado`);
    },
    onError: (err, v) => notifyWarning("Atenção", reagirAoErro(err, "Não foi possível salvar o apontamento.", v.empresaId, "novo")),
  });

  const updateMutation = useMutation({
    /** @param {{ empresaId: string, original: any, data: Record<string, any> }} v */
    mutationFn: ({ empresaId: emp, original, data }) => atualizarApontamento(emp, original, data),
    onSuccess: ({ alterado, registro }, v) => {
      if (!daEmpresaAtual(v.empresaId)) {
        invalidar();
        return notifyInfo("Gravação concluída", "O apontamento da empresa anterior foi atualizado.");
      }
      if (!alterado) {
        controller.setIsEditing(false);
        notifyInfo("Sem alterações", "Nada foi alterado.");
        return;
      }
      invalidar();
      mostrarRegistro(registro);
      notifySuccess("Sucesso", "Apontamento atualizado");
    },
    onError: (err, v) =>
      notifyWarning("Atenção", reagirAoErro(err, "Não foi possível salvar o apontamento.", v.empresaId, String(v.original?.id ?? "novo"))),
  });

  submitRef.current = (/** @type {Record<string, any>} */ data) => {
    if (!empresaId) {
      notifyWarning("Atenção", "Selecione uma fazenda antes de gravar.");
      return;
    }
    setErroDoServidor(null);
    // O registro aberto (o detalhe, com a `versao` mais nova que a tela leu) é a base do PATCH mínimo.
    const original = registroAberto ?? controller.editingItem;
    if (original?.id) {
      // Cancelado não aceita edição (o servidor também recusa).
      if (!acoes.editar || original.status !== STATUS_CONFIRMADO) return;
      updateMutation.mutate({ empresaId, original, data });
    } else {
      if (!acoes.criar) return;
      createMutation.mutate({ empresaId, data });
    }
  };

  /**
   * Baixa ou devolução física de estoque (item de Produto): relê os saldos da
   * tela, as consultas de estoque e o cache do Mapa (refresh FORÇADO), como o
   * abastecimento.
   * @param {string} emp
   */
  const avisarEstoqueAlterado = (emp) => {
    queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "locais"] });
    queryClient.invalidateQueries({ predicate: (q) => ehConsultaDeEstoque(q.queryKey) });
    Promise.all([refreshMapaCacheEntry("estoqueLotes", emp, { force: true }), refreshMapaCacheEntry("movimentacaoEstoque", emp, { force: true })]).catch(() => {});
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["estoqueLotes"] } }));
  };

  /** " (envio repetido: nada foi duplicado)" quando o servidor devolveu o gravado. @param {any} r */
  const textoDoReplay = (r) => (r?.replay === true ? " (envio repetido: nada foi duplicado)" : "");

  /**
   * Resposta de um comando de item (o DETALHE): vai para o cache (no replay, o
   * detalhe é relido: `guardarDetalhe`), a lista é relida (a `versao` mudou) e
   * o registro aberto passa a ser ela.
   * @param {any} registro @param {string} emp @param {boolean} mexeuNoEstoque
   */
  const aplicarDetalhe = (registro, emp, mexeuNoEstoque) => {
    invalidar();
    if (mexeuNoEstoque) avisarEstoqueAlterado(emp);
    if (!daEmpresaAtual(emp)) {
      if (registro && typeof registro === "object" && registro.id) guardarDetalhe(registro, emp);
      return;
    }
    mostrarRegistro(registro, emp);
  };

  // ─── Cancelamento ───────────────────────────────────────────────────
  /**
   * Cancelamento concluído. Se os itens de Produto voltaram ao estoque decide a
   * RESPOSTA (ou o detalhe relido), não o registro aberto: com devolução, as
   * consultas de estoque e o cache do Mapa são relidos.
   * @param {any} registro a resposta do servidor (o detalhe cancelado) @param {string} emp
   */
  const concluirCancelamento = (registro, emp) => {
    setCancelando(null);
    const voltouAoEstoque = cancelamentoDevolveuProduto(registro);
    const devolveu = voltouAoEstoque ? " Os itens de Produto voltaram aos lotes de origem." : "";
    notifySuccess(
      "Apontamento cancelado",
      `Apontamento nº ${registro?.numero ?? ""} cancelado. Ele continua no histórico; nada foi apagado.${devolveu}${textoDoReplay(registro)}`,
    );
    aplicarDetalhe(registro, emp, voltouAoEstoque);
  };

  /** Recusa de comando que estorna: o motivo exato do bloqueio vai num aviso (o diálogo mostra o resumo). @param {unknown} erro */
  const avisarBloqueioDoEstorno = (erro) => {
    if (codigoDoErroApontamento(erro) === "APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO") {
      notifyWarning("Atenção", mensagemErroApontamento(erro, "O estorno exato não é seguro agora. Nada foi alterado."));
    }
  };

  /** @param {string} motivo @param {{ retentativa: boolean }} [opcoes] */
  const enviarCancelamento = async (motivo, opcoes = { retentativa: false }) => {
    const registro = cancelando;
    const emp = empresaId;
    if (!registro || !emp) return;
    try {
      const r = await cancelarApontamento(emp, registro, motivo, { escopo, retentativa: opcoes.retentativa });
      concluirCancelamento(r, emp);
    } catch (erro) {
      reagirAoErro(erro, "Não foi possível cancelar o apontamento. Nada foi alterado.", emp, String(registro.id));
      avisarBloqueioDoEstorno(erro);
      throw erro;
    }
  };

  /** "Consultar" depois de um envio sem resposta: relê o apontamento. */
  const consultarCancelamento = async () => {
    const registro = cancelando;
    const emp = empresaId;
    if (!registro || !emp) return;
    try {
      const atual = /** @type {any} */ (await detalharApontamento(emp, String(registro.id)));
      if (atual?.status === STATUS_CANCELADO) {
        // O efeito do envio pendente está no apontamento: a pendência sai (o próximo envio é NOVO).
        // A devolução ao estoque é decidida pelo detalhe relido (`atual`), não pelo registro do diálogo.
        limparPendenciaDoApontamento(escopo, ACAO_CANCELAR, emp, String(registro.id));
        concluirCancelamento(atual, emp);
      } else notifyInfo("Ainda confirmado", "O cancelamento não aparece gravado. Repita o mesmo envio: ele não duplica.");
    } catch (erro) {
      notifyWarning("Atenção", mensagemErroApontamento(erro, "Não foi possível consultar agora. Tente de novo."));
    }
  };

  // ─── Itens (D-PROD-191) ─────────────────────────────────────────────
  /** Recusa de comando de item: relê o que mudou; quando a releitura remonta o formulário, o aviso fica. @param {unknown} erro @param {string} emp */
  const reagirAoErroDoItem = (erro, emp) => {
    const code = codigoDoErroApontamento(erro);
    if (code && CODIGOS_RELER_APONTAMENTO.includes(code)) {
      notifyWarning("Atenção", mensagemErroApontamento(erro, "Não foi possível concluir. Nada foi gravado.", { comandoIdempotente: true }));
    }
    reagirAoErro(erro, "Não foi possível concluir. Nada foi gravado.", emp, "item");
    if (code === "ESTOQUE_SALDO_INSUFICIENTE") queryClient.invalidateQueries({ queryKey: [QUERY_RAIZ, "locais"] });
  };

  /**
   * Lança o item do card de rascunho no apontamento aberto (com a `versao` lida).
   * @param {Record<string, string>} corpo @param {{ retentativa: boolean }} opcoes
   */
  const adicionarItem = async (corpo, { retentativa }) => {
    const registro = registroAberto;
    const emp = empresaId;
    if (!registro?.id || !emp || !acoes.editar) return;
    try {
      const r = /** @type {any} */ (await adicionarItemApontamento(emp, registro, corpo, { escopo, retentativa }));
      const item = itensDoRegistro(r).find((i) => String(i?.id) === String(r?.item_id ?? "")) ?? null;
      const produto = (item?.tipo ?? corpo.tipo) === ITEM_PRODUTO;
      const quanto = item
        ? produto
          ? `: ${formatarQuantidadeItem(item.quantidade, item.unidade)} baixados do estoque, custo ${formatarValorItem(item.valor_total)}`
          : `: total ${formatarValorItem(item.valor_total)}`
        : "";
      notifySuccess(
        "Item lançado",
        `${ROTULO_TIPO_ITEM[String(item?.tipo ?? corpo.tipo)] ?? "Item"}${item?.ordem != null ? ` (item ${item.ordem})` : ""} lançado no apontamento nº ${r?.numero ?? ""}${quanto}.${textoDoReplay(r)}`,
      );
      aplicarDetalhe(r, emp, produto);
    } catch (erro) {
      reagirAoErroDoItem(erro, emp);
      throw erro;
    }
  };

  /**
   * "Consultar" depois de um item sem resposta: relê o apontamento SEM mexer no
   * formulário. A `versao` só sobe quando algo foi gravado; repetir o mesmo
   * envio é sempre seguro (o servidor devolve o gravado ou recusa sem gravar).
   * @param {number} versaoEnviada
   */
  const consultarItem = async (versaoEnviada) => {
    const registro = registroAberto;
    const emp = empresaId;
    if (!registro?.id || !emp) return "Selecione a fazenda.";
    try {
      const atual = /** @type {any} */ (await detalharApontamento(emp, String(registro.id)));
      if (Number(atual?.versao) === Number(versaoEnviada)) return "O item ainda não aparece gravado. Repita o mesmo envio: ele não duplica.";
      return "O apontamento mudou depois do envio. Repita o mesmo envio para saber se o item foi gravado: se foi, o servidor devolve o gravado e nada é duplicado.";
    } catch (erro) {
      return mensagemErroApontamento(erro, "Não foi possível consultar agora. Tente de novo.");
    }
  };

  /** @param {any} registro @param {any} item @param {string} emp @param {any} r */
  const concluirCancelamentoDoItem = (registro, item, emp, r) => {
    setCancelandoItem(null);
    const produto = item?.tipo === ITEM_PRODUTO;
    const volta = produto ? `: ${formatarQuantidadeItem(item.quantidade, item.unidade)} devolvidos aos lotes de origem` : "";
    notifySuccess("Item cancelado", `Item ${item?.ordem ?? ""} do apontamento nº ${registro?.numero ?? ""} cancelado${volta}. Ele continua no histórico.${textoDoReplay(r)}`);
    aplicarDetalhe(r, emp, produto);
  };

  /** @param {string} motivo @param {{ retentativa: boolean }} opcoes */
  const enviarCancelamentoDoItem = async (motivo, { retentativa }) => {
    const alvo = cancelandoItem;
    const emp = empresaId;
    if (!alvo || !emp) return;
    try {
      const r = await cancelarItemApontamento(emp, alvo.registro, alvo.item, motivo, { escopo, retentativa });
      concluirCancelamentoDoItem(alvo.registro, alvo.item, emp, r);
    } catch (erro) {
      reagirAoErro(erro, "Não foi possível cancelar o item. Nada foi alterado.", emp, String(alvo.registro.id));
      if (codigoDoErroApontamento(erro) === "APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND" && daEmpresaAtual(emp)) setCancelandoItem(null);
      avisarBloqueioDoEstorno(erro);
      throw erro;
    }
  };

  /** "Consultar" o cancelamento do item sem resposta: relê o apontamento. */
  const consultarCancelamentoDoItem = async () => {
    const alvo = cancelandoItem;
    const emp = empresaId;
    if (!alvo || !emp) return;
    try {
      const atual = /** @type {any} */ (await detalharApontamento(emp, String(alvo.registro.id)));
      const item = itensDoRegistro(atual).find((i) => String(i?.id) === String(alvo.item.id));
      if (item?.status === STATUS_CANCELADO) {
        limparPendenciaDoApontamento(escopo, ACAO_CANCELAR, emp, alvoDoItem(String(alvo.item.id)));
        concluirCancelamentoDoItem(alvo.registro, alvo.item, emp, atual);
      } else notifyInfo("Item ainda confirmado", "O cancelamento do item não aparece gravado. Repita o mesmo envio: ele não duplica.");
    } catch (erro) {
      notifyWarning("Atenção", mensagemErroApontamento(erro, "Não foi possível consultar agora. Tente de novo."));
    }
  };

  // ─── Avisos e filtros ───────────────────────────────────────────────
  const saving = createMutation.isPending || updateMutation.isPending;
  const registroCancelado = registroAberto?.status === STATUS_CANCELADO;

  const listErrorMessage = useMemo(
    () => mensagemErroApontamento(controller.listaQueryError, "Não foi possível carregar os apontamentos. Verifique sua conexão e tente novamente."),
    [controller.listaQueryError],
  );

  let aviso = null;
  if (!empresaId) {
    aviso = <AvisoGestao testId="apontamento-sem-empresa">Selecione uma fazenda para ver e lançar apontamentos de atividade.</AvisoGestao>;
  } else if (acoes.carregando) {
    aviso = (
      <AvisoGestao tone="blue" testId="apontamento-carregando">
        Carregando permissões…
      </AvisoGestao>
    );
  } else if (!acoes.ver) {
    aviso = <AvisoGestao testId="apontamento-sem-permissao">Você não tem permissão para ver os apontamentos de atividade desta fazenda.</AvisoGestao>;
  }

  const opcoesTipoFiltro = useMemo(
    () =>
      /** @type {any[]} */ (tipos).map((t) => ({
        value: String(t.id),
        label: `${String(t.nome_tipo ?? "")}${t.ativo === false ? " (INATIVO)" : ""}`,
      })),
    [tipos],
  );
  const opcoesAreaFiltro = useMemo(
    () => /** @type {any[]} */ (areas).map((a) => ({ value: String(a.id), label: rotuloDaArea(a) || String(a.id) })),
    [areas],
  );

  const filtros =
    empresaId && acoes.ver && !controller.showForm ? (
      <div className="cadastro-b1 mg-card mb-2 p-2" data-testid="apontamento-filtros">
        <div className="mg-b1-form-grid grid grid-cols-12 gap-x-3 gap-y-2">
          <CampoSelect label="Tipo de atividade" value={tipoFiltro} onChange={setTipoFiltro} options={opcoesTipoFiltro} placeholder="Todos os tipos" span={3} />
          <SeletorPaginadoGestao
            rotulo="Máquina/veículo"
            testId="apontamento-filtro-bem"
            chave={[QUERY_RAIZ, "bens-filtro", empresaId]}
            buscar={({ q, cursor, limit }) => listarOpcoesApontamento("bens", empresaId, { q, cursor, limit, natureza: NATUREZAS_MAQUINA })}
            value={bemFiltro}
            onChange={(o) => setBemFiltro(o ? { id: String(o.id), rotulo: rotuloDoBem(o) } : null)}
            rotuloDaOpcao={rotuloDoBem}
            permitirLimpar
            textoVazio="Todas as máquinas"
            span={3}
            maiusculas={false}
          />
          <CampoSelect label="Área" value={areaFiltro} onChange={setAreaFiltro} options={opcoesAreaFiltro} placeholder="Todas as áreas" span={2} />
          <CampoDia label="De" value={dataDe} onChange={setDataDe} span={2} testId="apontamento-filtro-de" />
          <CampoDia label="Até" value={dataAte} onChange={setDataAte} span={2} testId="apontamento-filtro-ate" />
        </div>
        {periodoInvertido ? (
          <p role="alert" className="mt-1 text-[12px] text-red-700" data-testid="apontamento-periodo-invertido">
            A data final do período é anterior à inicial.
          </p>
        ) : null}
      </div>
    ) : null;

  const listaVazia = listEnabled && !controller.showForm && !controller.isLoading && !controller.listaErro && controller.visibleRows.length === 0;

  const banner = (
    <>
      {aviso}
      {semFuso && acoes.ver ? (
        <AvisoGestao testId="apontamento-sem-fuso">
          Configure o fuso horário da fazenda (Empresa → Fuso horário) antes de lançar, editar ou cancelar apontamentos e de cancelar itens: o
          servidor recusa sem ele.
        </AvisoGestao>
      ) : null}
      {filtros}
      {listaVazia ? <AvisoGestao testId="apontamento-lista-vazia">Nenhum apontamento encontrado com estes filtros.</AvisoGestao> : null}
    </>
  );

  const podeGravar = Boolean(empresaId) && fusoOk;
  const filtrosDaTela =
    empresaId && acoes.ver
      ? [{ id: "status", rotulo: "Situação", nome: "Filtrar por situação", opcoes: OPCOES_SITUACAO, valor: statusFiltro, padrao: "TODOS", onChange: setStatusFiltro, coluna: "status" }]
      : [];

  const alvoAberto = registroAberto ? String(registroAberto.id) : "novo";
  // Cancelar o apontamento e cancelar item estornam no "hoje" da fazenda: sem fuso, o servidor recusa (podeGravar).
  // "Cancelar apontamento" espera os itens (o DETALHE): sem eles o diálogo não saberia avisar da devolução ao estoque.
  const itensConhecidos = Array.isArray(registroAberto?.itens);
  const recordForm = controller.showForm ? (
    <FormularioApontamentoAtividade
      // Entrar ou sair da edição (✕) e a chegada do fuso remontam o formulário a partir do GRAVADO.
      key={`${registroAberto?.id ?? "apontamento-novo"}-${registroAberto?.versao ?? 0}-${controller.formEpoch}-${controller.isEditing ? "e" : "l"}-${fuso ?? "sem-fuso"}`}
      initialData={registroAberto}
      empresaId={empresaId}
      tipos={/** @type {any[]} */ (tipos)}
      areas={/** @type {any[]} */ (areas)}
      hoje={hoje}
      fuso={fuso}
      readOnly={!controller.isEditing}
      isSubmitting={saving}
      onSubmit={controller.handleSubmit}
      podeCancelar={acoes.cancelar && podeGravar && itensConhecidos}
      onCancelar={() => setCancelando(registroAberto)}
      erroDoServidor={erroDoServidor?.alvo === alvoAberto ? erroDoServidor : null}
      podeLancarItens={acoes.editar && Boolean(empresaId)}
      podeCancelarItens={acoes.cancelar && podeGravar}
      itensCarregando={detalheQuery.isFetching}
      erroDosItens={detalheQuery.isError ? mensagemErroApontamento(detalheQuery.error, "Não foi possível ler os itens do apontamento.") : null}
      onRecarregarItens={() => detalheQuery.refetch()}
      onAdicionarItem={adicionarItem}
      onConsultarItem={consultarItem}
      onCancelarItem={(item) => setCancelandoItem({ registro: registroAberto, item })}
    />
  ) : null;

  return (
    // Os botões seguem a regra EXATA do servidor (novo|salvar, editar|salvar,
    // excluir = cancelar): a heurística de texto do Layout não se aplica.
    <div data-permissao-explicita="" className="contents">
      <FiltrosDaTelaContext.Provider value={filtrosDaTela}>
        <CadastroBase1Screen
          permissaoExplicita
          workspaceTitle="Apontamentos de atividade"
          searchPlaceholder="Buscar nº…"
          createLabel="Novo apontamento"
          formId={registroCancelado ? undefined : FORMULARIO_APONTAMENTO_ATIVIDADE_ID}
          columnsForCardsToolbar={APONTAMENTOS_ATIVIDADE_COLUNAS}
          controller={{ ...controller, saving }}
          listErrorMessage={listErrorMessage}
          recordCode={registroAberto?.numero != null ? String(registroAberto.numero) : undefined}
          listBanner={banner}
          showCreate={podeGravar && acoes.criar}
          showEdit={podeGravar && acoes.editar && !registroCancelado}
          showDuplicate={false}
          showDelete={false}
          deleteDialog={{
            title: "Cancelar apontamento",
            confirmText: "Cancelar",
            descriptionOne: "Apontamento não se exclui: use Cancelar apontamento.",
            descriptionMany: () => "Apontamento não se exclui: use Cancelar apontamento.",
          }}
          recordForm={recordForm}
          listSlot={
            <TabelaApontamentosAtividade
              rows={controller.visibleRows}
              onEdit={controller.handleEdit}
              isLoading={controller.isLoading}
              emptyText={empresaId ? "Nenhum apontamento encontrado com estes filtros." : "Selecione uma fazenda"}
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

        {cancelando ? (
          <DialogoAcao
            key={`cancelar-${cancelando.id}-${cancelando.versao}`}
            aberto
            titulo={`Cancelar apontamento ${cancelando.numero ? `nº ${cancelando.numero}` : ""}`.trim()}
            descricao={`O apontamento continua no histórico como cancelado; nada é apagado e ele não aceita mais edição.${
              !Array.isArray(cancelando.itens)
                ? // Itens ainda não lidos (o botão espera por eles; isto é só a salvaguarda): o texto não afirma nem nega.
                  " Se houver itens, eles são cancelados junto: os itens de produto voltam ao estoque, exatamente aos lotes de origem."
                : itensDoRegistro(cancelando).some((/** @type {any} */ i) => i?.status === STATUS_CONFIRMADO)
                  ? " Os itens são cancelados junto: os itens de produto voltam ao estoque, exatamente aos lotes de origem."
                  : ""
            } Informe o motivo (pelo menos 3 caracteres).`}
            rotuloBotao="Cancelar apontamento"
            testId="dialogo-cancelar-apontamento"
            contexto={CONTEXTO_MENSAGENS}
            onFechar={() => setCancelando(null)}
            onEnviar={enviarCancelamento}
            onConsultar={consultarCancelamento}
          />
        ) : null}

        {cancelandoItem ? (
          <DialogoAcao
            key={`cancelar-item-${cancelandoItem.item?.id}-${cancelandoItem.registro?.versao}`}
            aberto
            titulo={`Cancelar item ${cancelandoItem.item?.ordem ?? ""} do apontamento ${cancelandoItem.registro?.numero ? `nº ${cancelandoItem.registro.numero}` : ""}`.trim()}
            descricao={
              cancelandoItem.item?.tipo === ITEM_PRODUTO
                ? `O item continua no histórico como cancelado; nada é apagado. ${formatarQuantidadeItem(cancelandoItem.item.quantidade, cancelandoItem.item.unidade)} de ${
                    cancelandoItem.item.produto?.nome ?? "Produto"
                  } voltam exatamente aos lotes de origem. Para corrigir, cancele e lance de novo. Informe o motivo (pelo menos 3 caracteres).`
                : "O item continua no histórico como cancelado; nada é apagado, e ele deixa de contar no custo do apontamento. Para corrigir, cancele e lance de novo. Informe o motivo (pelo menos 3 caracteres)."
            }
            rotuloBotao="Cancelar item"
            testId="dialogo-cancelar-item"
            contexto={CONTEXTO_MENSAGENS}
            onFechar={() => setCancelandoItem(null)}
            onEnviar={enviarCancelamentoDoItem}
            onConsultar={consultarCancelamentoDoItem}
          />
        ) : null}
      </FiltrosDaTelaContext.Provider>
    </div>
  );
}

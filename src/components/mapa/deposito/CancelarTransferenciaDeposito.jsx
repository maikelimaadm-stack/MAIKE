import { MOTIVO_EXCLUSAO_MAPA } from "@/domain/mapa/motivoExclusaoMapa";
import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button as ButtonUi } from "@/components/ui/button";
import {
  Dialog as DialogUi,
  DialogContent as DialogContentUi,
  DialogDescription as DialogDescriptionUi,
  DialogHeader as DialogHeaderUi,
  DialogTitle as DialogTitleUi,
} from "@/components/ui/dialog";
import { cancelarTransferenciaEntreDepositos, cancelarTransferenciaSemInternet, consultarCancelamentoTransferencia } from "@/services/suplementacaoEstoqueService";
import { confirmar as pedirConfirmacaoSemInternet } from "@/lib/maikeConfirmar";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { invalidarCachesDoMapa } from "@/components/mapa/invalidarCachesMapa";
import PreviaRecalculoExclusao from "@/components/estoque/PreviaRecalculoExclusao";
import { mensagemRecalculoDaExclusao } from "@/lib/gestaoErros";

// Componentes de `ui/*` são forwardRef sem tipos de props: o checkJs não enxerga `children`.
/** @type {React.ComponentType<any>} */ const Button = ButtonUi;
/** @type {React.ComponentType<any>} */ const Dialog = DialogUi;
/** @type {React.ComponentType<any>} */ const DialogContent = DialogContentUi;
/** @type {React.ComponentType<any>} */ const DialogDescription = DialogDescriptionUi;
/** @type {React.ComponentType<any>} */ const DialogHeader = DialogHeaderUi;
/** @type {React.ComponentType<any>} */ const DialogTitle = DialogTitleUi;

/*
 * "Excluir transferência" no Histórico do depósito do mapa (D-PROD-268): o estorno EXATO da transferência
 * entre depósitos, feito pelo servidor numa transação (POST /movimentacoes-estoque/:id/cancelar-transferencia).
 * O navegador não desfaz nada: só pede, com o motivo e uma `operation_id`.
 *
 * Para o usuário, no mapa, isto é EXCLUSÃO (pedido do proprietário: "eu não tenho cancelamentos, eu tenho
 * exclusão"): todo texto visível fala em excluir/excluída; por baixo é o mesmo estorno seguro do servidor, com a
 * mesma rota, os mesmos códigos e a mesma chave de permissão (`cancelar_lancamentos_estoque`). A transferência
 * excluída (as duas pernas 'Estornada') e os movimentos `estorno_transferencia_*` saem do histórico do depósito
 * do mapa (`movimentacoesDoHistoricoDeposito`): depois da releitura, o cartão some.
 *
 *  - Só online: sem conexão o botão fica desligado com o motivo; nada vai para a fila offline.
 *  - Ao abrir, o servidor ensaia o cancelamento (GET de elegibilidade) e diz o que acontece — ou por que não pode
 *    (saldo que ficaria negativo, contagem de inventário depois, transferência antiga sem rastreio, origem inativa...);
 *    com outro movimento depois nos depósitos, o servidor recalcula o custo deles (D-PROD-273, fatia 5) e a prévia mostra.
 *  - A chave é criada uma vez por diálogo e GRAVADA (com o motivo) antes do envio; resultado desconhecido (rede,
 *    5xx, conflito transitório) mantém a MESMA chave e o MESMO motivo, inclusive ao fechar e reabrir: o servidor
 *    nunca cancela duas vezes. Só uma resposta definitiva limpa a pendência. `replay` conta como sucesso.
 *  - Depois do sucesso: relê do servidor (force) as movimentações e os lotes do mapa e invalida as consultas dos dois
 *    depósitos; quem chama recebe `onCancelado` (o histórico e o nível do mapa se atualizam). O foco vai ao
 *    histórico do depósito (`.mk-dp-hist`; sem ele, à lista), porque o cartão da transferência some.
 *  - Ensaio que já diz "excluída", "não ativa" ou "não encontrada": ao fechar, o mesmo recarregamento (o cartão
 *    deixa de oferecer a ação). Falha de rede no ensaio: "Conferir de novo".
 *  - 403 num REENVIO de resultado desconhecido não é conclusivo (a permissão pode ter sido revogada depois do
 *    commit, e a guarda da rota nega antes do recibo): a pendência fica e a tela manda conferir o histórico.
 *
 * Marcação, no pé do cartão (`acoes` da LinhaDoTempo, div.mk-dp-tl__acoes):
 *   div.mk-dp-hist__excluir[data-estado-cancelamento] > div > button + p (motivo de estar desligado)
 */

/** D-PROD-298: sem internet, a exclusão fica no aparelho e sobe quando a internet voltar. */
export const TEXTO_SEM_CONEXAO_TRANSFERENCIA = "Sem internet: a exclusão fica no celular e vai ao sistema quando a internet voltar.";
export const MOTIVO_MINIMO_TRANSFERENCIA = 3;
export const MOTIVO_MAXIMO_TRANSFERENCIA = 500;

/** Consultas (React Query) que mostram estoque dos dois depósitos — as mesmas da Entrada/Saída do depósito. */
export const CONSULTAS_APOS_CANCELAR_TRANSFERENCIA = Object.freeze([
  "estoque-lotes-transferencia",
  "saldo-deposito",
  "cochos-vinculados-deposito",
  "lotes-nota-suplementacao",
  "mapa-pontos-supl",
  "movimentacoes",
  "produtos",
  "historico-deposito",
  "movimentacoes-deposito-detalhe",
]);

const estaOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

const useEstaOnline = () => {
  const [online, setOnline] = React.useState(estaOnline());
  React.useEffect(() => {
    const atualizar = () => setOnline(estaOnline());
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);
  return online;
};

const novaChave = () =>
  `cancelar-transf-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/** Operação pendente por tenant + usuário + movimento: sobrevive a fechar, reabrir e recarregar. */
const chavePendente = (escopo, id) => `maike_cancelar_transferencia_pendente:${escopo}:${id}`;
export const lerPendenteTransferencia = (escopo, id) => {
  try {
    const bruto = window.localStorage.getItem(chavePendente(escopo, id));
    const dados = bruto ? JSON.parse(bruto) : null;
    return dados && typeof dados.operation_id === "string" && typeof dados.motivo === "string" ? dados : null;
  } catch {
    return null;
  }
};
const gravarPendente = (escopo, id, dados) => {
  try {
    window.localStorage.setItem(chavePendente(escopo, id), JSON.stringify({ ...dados, em: new Date().toISOString() }));
  } catch {
    /* sem storage: a chave fica só na memória do diálogo */
  }
};
const limparPendente = (escopo, id) => {
  try {
    window.localStorage.removeItem(chavePendente(escopo, id));
  } catch {
    /* idem */
  }
};

/** Código do servidor preservado no `cause` do ApiError (o corpo da resposta). */
const codigoDoServidor = (erro) => (typeof erro?.cause?.code === "string" ? erro.cause.code : null);
/** `field`/`reason` do envelope e os `details` do servidor, juntos. */
const detalhesDoServidor = (erro) => {
  const corpo = erro?.cause && typeof erro.cause === "object" ? erro.cause : {};
  return { ...(erro?.details ?? {}), ...(corpo.details ?? {}), ...(corpo.reason ? { reason: corpo.reason } : {}), ...(corpo.field ? { field: corpo.field } : {}) };
};

/** Recusas DEFINITIVAS (o servidor respondeu e nada foi gravado): a próxima tentativa é outra operação. */
const RECUSAS_DEFINITIVAS = new Set([
  "TRANSFERENCIA_CANCELAMENTO_BLOQUEADO",
  "ESTOQUE_LOCAL_INVALIDO",
  "OPERACAO_VALORES_INVALIDOS",
  "MOVIMENTACAO_ESTOQUE_NOT_FOUND",
  "EMPRESA_NOT_FOUND",
  "PRODUTO_NOT_FOUND",
  "ACAO_NAO_PERMITIDA",
  "REQUEST_VALIDATION_FAILED",
  "IDEMPOTENCY_CONFLICT",
  "IDEMPOTENCY_EFEITO_EXCLUIDO",
  "IDEMPOTENCY_EFEITO_DESFEITO",
]);

/** Respostas do ensaio que tornam a ação obsoleta no cartão: ao fechar, relê o histórico. */
const ENSAIO_OBSOLETO = new Set(["original_ja_estornado", "original_nao_ativo"]);
const CODIGOS_NAO_ENCONTRADO = new Set(["MOVIMENTACAO_ESTOQUE_NOT_FOUND", "EMPRESA_NOT_FOUND", "PRODUTO_NOT_FOUND"]);
export const TEXTO_PERMISSAO_REVOGADA_REENVIO =
  "Você não tem mais permissão para excluir transferências. A exclusão enviada antes pode ter sido concluída: confira o histórico do depósito.";

const MENSAGEM_PADRAO = "Não foi possível excluir a transferência. Nada foi alterado.";
const MENSAGEM_LOTES = "Esta transferência não pode ser excluída com segurança porque os lotes dela mudaram fora do controle do estoque. Nada foi alterado.";

/** Mensagem em português por código/`reason` da recusa do servidor. */
export const mensagemDaRecusaTransferencia = (codigo, detalhes) => {
  const d = detalhes && typeof detalhes === "object" ? detalhes : {};
  // D-PROD-273 (fatia 5): com movimento depois, a exclusão recalcula; recusa só por saldo negativo, contagem ou inviável.
  const recalculo = mensagemRecalculoDaExclusao(codigo ?? null, d.reason ?? null, d);
  if (recalculo) return recalculo;
  if (codigo === "TRANSFERENCIA_CANCELAMENTO_BLOQUEADO") {
    switch (d.reason) {
      case "movimento_posterior": {
        const lado = d.lado === "origem" ? "de origem" : "de destino";
        const numero = d.movimento_numero ? ` (nº ${d.movimento_numero})` : "";
        return `Esta transferência não pode ser excluída porque o produto já teve outro movimento no depósito ${lado}${numero} depois dela. Para corrigir, lance uma transferência de volta. Nada foi alterado.`;
      }
      case "camada_consumida":
      case "saldo_local_divergente":
        return "Esta transferência não pode ser excluída porque o estoque recebido já foi usado. Nada foi alterado.";
      case "fatias_ausentes":
      case "par_incoerente":
        return "Esta transferência não pode ser excluída porque é antiga, sem rastreio de lotes. Nada foi alterado.";
      case "original_ja_estornado":
        return "Esta transferência já foi excluída.";
      case "original_nao_ativo":
        return "Esta transferência não pode ser excluída porque não está ativa. Nada foi alterado.";
      case "nao_e_transferencia":
        return "Este registro não é uma transferência entre depósitos. Nada foi alterado.";
      case "linhagem_divergente":
      case "camada_divergente":
      case "lote_indisponivel_para_devolucao":
      case "devolucao_excede_entrada":
        return MENSAGEM_LOTES;
      default:
        return MENSAGEM_PADRAO;
    }
  }
  if (codigo === "ESTOQUE_LOCAL_INVALIDO") {
    return d.reason === "local_inativo"
      ? "Esta transferência não pode ser excluída porque o depósito de origem está inativo e não pode receber o estoque de volta. Reative-o, exclua e desative de novo. Nada foi alterado."
      : "Esta transferência não pode ser excluída porque um dos depósitos dela não existe mais. Nada foi alterado.";
  }
  if (codigo === "OPERACAO_VALORES_INVALIDOS") return "Esta transferência não pode ser excluída porque a devolução passaria do limite de estoque do depósito de origem. Nada foi alterado.";
  if (codigo === "ACAO_NAO_PERMITIDA") return "Você não tem permissão para excluir transferências entre depósitos.";
  if (codigo === "MOVIMENTACAO_ESTOQUE_NOT_FOUND" || codigo === "EMPRESA_NOT_FOUND" || codigo === "PRODUTO_NOT_FOUND") return "Transferência não encontrada nesta fazenda. Nada foi alterado.";
  if (codigo === "IDEMPOTENCY_CONFLICT") return "Esta exclusão já foi enviada com outro motivo. Feche e abra de novo para recomeçar.";
  if (codigo === "REQUEST_VALIDATION_FAILED") return `Informe o motivo da exclusão (${MOTIVO_MINIMO_TRANSFERENCIA} a ${MOTIVO_MAXIMO_TRANSFERENCIA} caracteres).`;
  return MENSAGEM_PADRAO;
};

const fmtKg = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }) : "—";
};
const fmtMoeda = (v) => {
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

/**
 * Relê do servidor (force) o que o mapa mostra de estoque e invalida as consultas dos dois depósitos.
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {string} empresaId
 */
export const recarregarAposCancelarTransferencia = async (queryClient, empresaId) => {
  await Promise.all([
    refreshMapaCacheEntry("movimentacaoEstoque", empresaId, { force: true }),
    refreshMapaCacheEntry("estoqueLotes", empresaId, { force: true }),
  ]).catch(() => {});
  await invalidarCachesDoMapa(queryClient, [...CONSULTAS_APOS_CANCELAR_TRANSFERENCIA]);
};

/**
 * @param {{ movimento: any, empresaId: string, escopo: string, onCancelado?: () => void }} props
 *   `movimento`: a perna da transferência que o cartão mostra (Saída na origem ou Entrada no destino), 'Ativa'.
 *   `escopo`: tenant + usuário (a pendência de um nunca aparece para outro no mesmo aparelho).
 */
export default function CancelarTransferenciaDeposito({ movimento, empresaId, escopo, onCancelado }) {
  const queryClient = useQueryClient();
  const online = useEstaOnline();
  const [aberto, setAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState(MOTIVO_EXCLUSAO_MAPA);
  const [enviando, setEnviando] = React.useState(false);
  const [desconhecido, setDesconhecido] = React.useState(false);
  const [recusa, setRecusa] = React.useState(/** @type {string|null} */ (null));
  const [cancelada, setCancelada] = React.useState(false);
  const chaveRef = React.useRef(/** @type {string|null} */ (null));
  const raizRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));
  /** Para onde o foco vai quando o diálogo fecha depois do sucesso (o histórico: o cartão excluído some). */
  const focoAposFecharRef = React.useRef(/** @type {HTMLElement|null} */ (null));
  const recarregarAoFecharRef = React.useRef(false);
  const id = movimento?.id;

  const elegibilidade = useQuery({
    queryKey: ["elegibilidade-cancelamento-transferencia", escopo, empresaId, id],
    queryFn: ({ signal }) => consultarCancelamentoTransferencia({ movimentacaoId: id, empresaId, signal }),
    enabled: aberto && online && Boolean(id) && Boolean(empresaId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  // Ensaio que torna a ação obsoleta (já excluída / não ativa / não encontrada): relê ao fechar.
  const ensaioReason = elegibilidade.data?.elegivel === false ? elegibilidade.data?.detalhes?.reason : null;
  const ensaioErroCodigo = elegibilidade.isError ? codigoDoServidor(elegibilidade.error) : null;

  if (!id) return null;
  const pendente = cancelada ? null : lerPendenteTransferencia(escopo, id);

  // D-PROD-298: sem internet, confirma e guarda a exclusão (o servidor confere tudo quando ela subir).
  const excluirSemInternet = async () => {
    const ok = await pedirConfirmacaoSemInternet({
      titulo: "Excluir transferência sem internet?",
      descricao:
        "A exclusão fica guardada neste celular e vai ao sistema quando a internet voltar. Lá, o produto volta ao local de origem. Se o sistema recusar, ela aparece em \"Sincronização\".",
      textoConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    const p = lerPendenteTransferencia(escopo, id);
    try {
      await cancelarTransferenciaSemInternet({ movimento, empresaId, motivo: p?.motivo || MOTIVO_EXCLUSAO_MAPA, operationId: p?.operation_id || novaChave() });
      limparPendente(escopo, id);
      setCancelada(true);
      toast.success("Transferência excluída.");
      await recarregarAposCancelarTransferencia(queryClient, empresaId);
      onCancelado?.();
    } catch (erro) {
      toast.error(/** @type {any} */ (erro)?.message || "Não foi possível excluir agora.");
    }
  };

  const abrir = () => {
    if (!online) {
      void excluirSemInternet();
      return;
    }
    const p = lerPendenteTransferencia(escopo, id);
    if (p) {
      // Resultado anterior desconhecido: mesma chave e mesmo motivo, nunca outra operação.
      chaveRef.current = p.operation_id;
      setMotivo(p.motivo);
      setDesconhecido(true);
    } else {
      chaveRef.current = novaChave();
      setMotivo(MOTIVO_EXCLUSAO_MAPA);
      setDesconhecido(false);
    }
    setRecusa(null);
    setAberto(true);
  };

  const fechar = (valor) => {
    if (!valor && enviando) return;
    setAberto(Boolean(valor));
    const obsoleto = ENSAIO_OBSOLETO.has(ensaioReason) || CODIGOS_NAO_ENCONTRADO.has(ensaioErroCodigo);
    if (!valor && (obsoleto || recarregarAoFecharRef.current)) {
      recarregarAoFecharRef.current = false;
      void recarregarAposCancelarTransferencia(queryClient, empresaId).then(() => onCancelado?.());
    }
  };

  /**
   * O cartão (li) da LinhaDoTempo SOME depois do recarregamento (a transferência excluída sai do histórico):
   * o foco vai ao histórico do depósito (`.mk-dp-hist`, que continua na tela mesmo sem nenhum cartão); sem ele,
   * à lista de cartões. Foco estável para teclado e leitor de tela.
   */
  const alvoDoFoco = () => {
    const raiz = raizRef.current;
    const alvo = raiz?.closest(".mk-dp-hist") ?? raiz?.closest("ol, ul") ?? null;
    if (alvo instanceof HTMLElement) {
      if (!alvo.hasAttribute("tabindex")) alvo.setAttribute("tabindex", "-1");
      return alvo;
    }
    return raiz;
  };

  const concluir = async (mensagem) => {
    limparPendente(escopo, id);
    recarregarAoFecharRef.current = false;
    focoAposFecharRef.current = alvoDoFoco();
    setDesconhecido(false);
    setAberto(false);
    setCancelada(true);
    toast.success(mensagem);
    await recarregarAposCancelarTransferencia(queryClient, empresaId);
    onCancelado?.();
  };

  /** @type {any} */
  const e = elegibilidade.data;
  const conferindo = elegibilidade.isFetching;
  const elegivelAgora = elegibilidade.isSuccess && e?.elegivel === true && !conferindo;
  const motivoPronto = motivo.trim().length >= MOTIVO_MINIMO_TRANSFERENCIA;
  // Reenvio de resultado desconhecido não depende do ensaio (o servidor responde replay ou a recusa).
  const podeEnviar = online && !enviando && motivoPronto && Boolean(chaveRef.current) && (elegivelAgora || desconhecido);

  const confirmar = async () => {
    if (!podeEnviar) return;
    const chave = /** @type {string} */ (chaveRef.current);
    const texto = motivo.trim();
    setEnviando(true);
    setRecusa(null);
    gravarPendente(escopo, id, { operation_id: chave, motivo: texto });
    try {
      const r = await cancelarTransferenciaEntreDepositos({ movimentacaoId: id, empresaId, motivo: texto, operationId: chave });
      await concluir(r.replay ? "Transferência excluída (confirmado pelo servidor)." : "Transferência excluída.");
    } catch (erro) {
      const codigo = codigoDoServidor(erro);
      const detalhes = detalhesDoServidor(erro);
      if (codigo === "TRANSFERENCIA_CANCELAMENTO_BLOQUEADO" && detalhes.reason === "original_ja_estornado") {
        // Já excluída (por esta ou outra tela): relê e o cartão sai do histórico.
        await concluir("Esta transferência já estava excluída.");
      } else if (codigo === "ACAO_NAO_PERMITIDA" && desconhecido) {
        // Reenvio de resultado desconhecido negado: o envio anterior pode ter sido concluído antes da revogação.
        // Não conclusivo: a pendência (mesma chave, mesmo motivo) fica; ao fechar, relê o histórico (mostra o que houve).
        setRecusa(TEXTO_PERMISSAO_REVOGADA_REENVIO);
        recarregarAoFecharRef.current = true;
      } else if (codigo && RECUSAS_DEFINITIVAS.has(codigo)) {
        limparPendente(escopo, id);
        setDesconhecido(false);
        setRecusa(mensagemDaRecusaTransferencia(codigo, detalhes));
        chaveRef.current = novaChave();
        setMotivo(MOTIVO_EXCLUSAO_MAPA); // D-PROD-270: operação nova = motivo fixo
        elegibilidade.refetch();
      } else {
        // Rede, timeout, 5xx, conflito transitório: resultado desconhecido → a MESMA chave no reenvio.
        setDesconhecido(true);
      }
    } finally {
      setEnviando(false);
    }
  };

  const estado = cancelada
    ? { habilitado: false, motivo: null }
    : !online
    ? { habilitado: true, motivo: TEXTO_SEM_CONEXAO_TRANSFERENCIA }
    : pendente
      ? { habilitado: true, motivo: "Exclusão anterior sem confirmação do servidor: abra para reenviar a mesma operação." }
      : { habilitado: true, motivo: null };
  const idMotivo = `motivo-cancelar-transferencia-${id}`;
  const efeitos = e?.efeitos ?? null;
  const origemNome = efeitos?.origem?.nome || movimento?.local_origem || "origem";
  const destinoNome = efeitos?.destino?.nome || movimento?.local_destino || "destino";
  const quantidade = efeitos?.quantidade ?? movimento?.quantidade;
  const unidade = (efeitos?.unidade || movimento?.unidade_medida) === "L" ? "L" : "kg";
  const valor = fmtMoeda(efeitos?.valor_total ?? movimento?.valor_total);
  const semPermissaoNoServidor = ensaioErroCodigo === "ACAO_NAO_PERMITIDA";
  const naoEncontradaNoServidor = CODIGOS_NAO_ENCONTRADO.has(ensaioErroCodigo);

  return (
    <div
      ref={raizRef}
      className="mk-dp-hist__excluir"
      data-estado-cancelamento={cancelada ? "cancelada" : estado.habilitado ? (pendente ? "pendente" : "disponivel") : "sem-conexao"}
    >
      {cancelada ? (
        <p role="status" className="max-w-full text-[11px] leading-snug text-slate-600">
          Transferência excluída.
        </p>
      ) : (
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`h-8 text-xs ${estado.habilitado ? "text-red-700" : "text-slate-500"}`}
          disabled={!estado.habilitado}
          aria-describedby={estado.motivo ? idMotivo : undefined}
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (estado.habilitado) abrir();
          }}
        >
          Excluir transferência
        </Button>
        {estado.motivo ? (
          <p id={idMotivo} className="max-w-full text-[11px] leading-snug text-slate-600">
            {estado.motivo}
          </p>
        ) : null}
      </div>
      )}
      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent
          className="max-w-md"
          onCloseAutoFocus={(ev) => {
            // Depois do sucesso o botão e o cartão somem: o foco vai ao histórico, não ao <body>.
            const alvo = focoAposFecharRef.current;
            if (!alvo || !alvo.isConnected) return;
            ev.preventDefault();
            focoAposFecharRef.current = null;
            alvo.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Excluir transferência</DialogTitle>
            <DialogDescription>
              {movimento?.produto_nome || "Produto"} · {fmtKg(quantidade)} {unidade} · {origemNome} → {destinoNome}
              {movimento?.numero_movimentacao ? ` · nº ${movimento.numero_movimentacao}` : ""}. Ao excluir, o produto volta ao depósito de origem e
              sai do de destino, e a transferência sai do histórico do depósito. Se o produto teve outros movimentos depois dela nesses depósitos,
              o custo médio deles é recalculado.
            </DialogDescription>
          </DialogHeader>

          {!online ? <div role="alert" className="text-sm text-amber-800">{TEXTO_SEM_CONEXAO_TRANSFERENCIA}</div> : null}
          {online && conferindo ? <div role="status" className="text-sm text-slate-500">Conferindo no servidor...</div> : null}
          {semPermissaoNoServidor ? (
            <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {mensagemDaRecusaTransferencia("ACAO_NAO_PERMITIDA")}
            </div>
          ) : null}
          {naoEncontradaNoServidor && !desconhecido ? (
            <div role="alert" data-testid="recusa-elegibilidade-transferencia" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {mensagemDaRecusaTransferencia(ensaioErroCodigo)}
            </div>
          ) : null}
          {elegibilidade.isError && !semPermissaoNoServidor && !naoEncontradaNoServidor && !desconhecido ? (
            <div role="alert" className="flex items-center justify-between gap-2 text-sm text-red-700">
              <span>Não foi possível conferir agora.</span>
              <Button type="button" variant="outline" size="sm" disabled={conferindo} onClick={() => elegibilidade.refetch()}>
                Conferir de novo
              </Button>
            </div>
          ) : null}
          {e && !e.elegivel && !conferindo && !desconhecido ? (
            <div role="alert" data-testid="recusa-elegibilidade-transferencia" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {mensagemDaRecusaTransferencia(e.codigo, e.detalhes)}
            </div>
          ) : null}

          {(elegivelAgora || desconhecido) ? (
            <div className="space-y-2">
              <div className="rounded-md border border-slate-200 bg-[#FAFCFE] px-2 py-1.5 text-xs text-slate-700">
                <div className="font-semibold">Efeito ao excluir</div>
                <div>{`${origemNome}: +${fmtKg(quantidade)} ${unidade} (volta ao depósito de origem)`}</div>
                <div>{`${destinoNome}: −${fmtKg(quantidade)} ${unidade} (sai do depósito de destino)`}</div>
                {valor ? <div>{`Valor devolvido à origem: ${valor}`}</div> : null}
              </div>
              {elegivelAgora && efeitos?.recalculo ? (
                <div className="grid grid-cols-12">
                  <PreviaRecalculoExclusao empresaId={empresaId} movimentoIds={[id]} />
                </div>
              ) : null}
              {desconhecido ? (
                <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  Sem confirmação do servidor. A exclusão pode ou não ter sido concluída. Reenvie: a MESMA operação é repetida e nunca é aplicada duas vezes.
                </div>
              ) : null}
              {recusa ? (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                  {recusa}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={enviando} onClick={() => fechar(false)}>
                  Voltar
                </Button>
                <Button type="button" variant="destructive" size="sm" disabled={!podeEnviar} onClick={confirmar}>
                  {enviando ? "Excluindo..." : desconhecido ? "Tentar de novo" : "Excluir transferência"}
                </Button>
              </div>
            </div>
          ) : recusa && !(e && !e.elegivel && !conferindo) ? (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
              {recusa}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

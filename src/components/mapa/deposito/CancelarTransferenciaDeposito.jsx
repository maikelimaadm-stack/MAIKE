import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button as ButtonUi } from "@/components/ui/button";
import { Textarea as TextareaUi } from "@/components/ui/textarea";
import {
  Dialog as DialogUi,
  DialogContent as DialogContentUi,
  DialogDescription as DialogDescriptionUi,
  DialogHeader as DialogHeaderUi,
  DialogTitle as DialogTitleUi,
} from "@/components/ui/dialog";
import { cancelarTransferenciaEntreDepositos, consultarCancelamentoTransferencia } from "@/services/suplementacaoEstoqueService";
import { refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { invalidarCachesDoMapa } from "@/components/mapa/invalidarCachesMapa";

// Componentes de `ui/*` são forwardRef sem tipos de props: o checkJs não enxerga `children`.
/** @type {React.ComponentType<any>} */ const Button = ButtonUi;
/** @type {React.ComponentType<any>} */ const Textarea = TextareaUi;
/** @type {React.ComponentType<any>} */ const Dialog = DialogUi;
/** @type {React.ComponentType<any>} */ const DialogContent = DialogContentUi;
/** @type {React.ComponentType<any>} */ const DialogDescription = DialogDescriptionUi;
/** @type {React.ComponentType<any>} */ const DialogHeader = DialogHeaderUi;
/** @type {React.ComponentType<any>} */ const DialogTitle = DialogTitleUi;

/*
 * "Cancelar transferência" no Histórico do depósito (D-PROD-268): o estorno EXATO da transferência
 * entre depósitos, feito pelo servidor numa transação (POST /movimentacoes-estoque/:id/cancelar-transferencia).
 * O navegador não desfaz nada: só pede, com o motivo e uma `operation_id`.
 *
 *  - Só online: sem conexão o botão fica desligado com o motivo; nada vai para a fila offline.
 *  - Ao abrir, o servidor ensaia o cancelamento (GET de elegibilidade) e diz o que acontece — ou por que não pode
 *    (outro movimento depois nos depósitos, estoque já usado, transferência antiga sem rastreio, origem inativa...).
 *  - A chave é criada uma vez por diálogo e GRAVADA (com o motivo) antes do envio; resultado desconhecido (rede,
 *    5xx, conflito transitório) mantém a MESMA chave e o MESMO motivo, inclusive ao fechar e reabrir: o servidor
 *    nunca cancela duas vezes. Só uma resposta definitiva limpa a pendência. `replay` conta como sucesso.
 *  - Depois do sucesso: relê do servidor (force) as movimentações e os lotes do mapa e invalida as consultas dos dois
 *    depósitos; quem chama recebe `onCancelado` (o histórico e o nível do mapa se atualizam). O foco volta ao
 *    cartão da transferência (o botão que abriu o diálogo deixa de existir).
 *  - Ensaio que já diz "cancelada", "não ativa" ou "não encontrada": ao fechar, o mesmo recarregamento (o cartão
 *    deixa de oferecer a ação). Falha de rede no ensaio: "Conferir de novo".
 *  - 403 num REENVIO de resultado desconhecido não é conclusivo (a permissão pode ter sido revogada depois do
 *    commit, e a guarda da rota nega antes do recibo): a pendência fica e a tela manda conferir o histórico.
 *
 * Marcação, no pé do cartão (`acoes` da LinhaDoTempo, div.mk-dp-tl__acoes):
 *   div.mk-dp-hist__excluir[data-estado-cancelamento] > div > button + p (motivo de estar desligado)
 */

export const TEXTO_SEM_CONEXAO_TRANSFERENCIA = "Requer conexão: o cancelamento só é feito online e não entra na fila offline.";
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
  "Você não tem mais permissão para cancelar transferências. O cancelamento enviado antes pode ter sido concluído: confira o histórico do depósito.";

const MENSAGEM_PADRAO = "Não foi possível cancelar a transferência. Nada foi alterado.";
const MENSAGEM_LOTES = "Os lotes desta transferência mudaram fora do controle do estoque; não é possível cancelar com segurança. Nada foi alterado.";

/** Mensagem em português por código/`reason` da recusa do servidor. */
export const mensagemDaRecusaTransferencia = (codigo, detalhes) => {
  const d = detalhes && typeof detalhes === "object" ? detalhes : {};
  if (codigo === "TRANSFERENCIA_CANCELAMENTO_BLOQUEADO") {
    switch (d.reason) {
      case "movimento_posterior": {
        const lado = d.lado === "origem" ? "de origem" : "de destino";
        const numero = d.movimento_numero ? ` (nº ${d.movimento_numero})` : "";
        return `O produto já teve outro movimento no depósito ${lado}${numero} depois desta transferência. Para corrigir, lance uma transferência de volta. Nada foi alterado.`;
      }
      case "camada_consumida":
      case "saldo_local_divergente":
        return "O estoque recebido já foi usado; não é possível cancelar. Nada foi alterado.";
      case "fatias_ausentes":
      case "par_incoerente":
        return "Transferência antiga, sem rastreio de lotes; não pode ser cancelada. Nada foi alterado.";
      case "original_ja_estornado":
        return "Esta transferência já foi cancelada.";
      case "original_nao_ativo":
        return "Esta transferência não está ativa; não pode ser cancelada. Nada foi alterado.";
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
      ? "O depósito de origem está inativo e não pode receber o estoque de volta. Reative-o, cancele e desative de novo. Nada foi alterado."
      : "Um dos depósitos desta transferência não existe mais. Nada foi alterado.";
  }
  if (codigo === "OPERACAO_VALORES_INVALIDOS") return "A devolução passaria do limite de estoque do depósito de origem. Nada foi alterado.";
  if (codigo === "ACAO_NAO_PERMITIDA") return "Você não tem permissão para cancelar transferências entre depósitos.";
  if (codigo === "MOVIMENTACAO_ESTOQUE_NOT_FOUND" || codigo === "EMPRESA_NOT_FOUND" || codigo === "PRODUTO_NOT_FOUND") return "Transferência não encontrada nesta fazenda. Nada foi alterado.";
  if (codigo === "IDEMPOTENCY_CONFLICT") return "Este cancelamento já foi enviado com outro motivo. Feche e abra de novo para recomeçar.";
  if (codigo === "REQUEST_VALIDATION_FAILED") return `Informe o motivo do cancelamento (${MOTIVO_MINIMO_TRANSFERENCIA} a ${MOTIVO_MAXIMO_TRANSFERENCIA} caracteres).`;
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
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [desconhecido, setDesconhecido] = React.useState(false);
  const [recusa, setRecusa] = React.useState(/** @type {string|null} */ (null));
  const [cancelada, setCancelada] = React.useState(false);
  const chaveRef = React.useRef(/** @type {string|null} */ (null));
  const raizRef = React.useRef(/** @type {HTMLDivElement|null} */ (null));
  /** Para onde o foco vai quando o diálogo fecha depois do sucesso (o cartão, que continua na lista). */
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

  // Ensaio que torna a ação obsoleta (já cancelada / não ativa / não encontrada): relê ao fechar.
  const ensaioReason = elegibilidade.data?.elegivel === false ? elegibilidade.data?.detalhes?.reason : null;
  const ensaioErroCodigo = elegibilidade.isError ? codigoDoServidor(elegibilidade.error) : null;

  if (!id) return null;
  const pendente = cancelada ? null : lerPendenteTransferencia(escopo, id);

  const abrir = () => {
    const p = lerPendenteTransferencia(escopo, id);
    if (p) {
      // Resultado anterior desconhecido: mesma chave e mesmo motivo, nunca outra operação.
      chaveRef.current = p.operation_id;
      setMotivo(p.motivo);
      setDesconhecido(true);
    } else {
      chaveRef.current = novaChave();
      setMotivo("");
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

  /** O cartão (li) da LinhaDoTempo fica na lista depois do recarregamento: foco estável para teclado e leitor de tela. */
  const alvoDoFoco = () => {
    const cartao = raizRef.current?.closest("li");
    if (cartao instanceof HTMLElement) {
      if (!cartao.hasAttribute("tabindex")) cartao.setAttribute("tabindex", "-1");
      return cartao;
    }
    return raizRef.current;
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
      await concluir(r.replay ? "Transferência cancelada (confirmado pelo servidor)." : "Transferência cancelada.");
    } catch (erro) {
      const codigo = codigoDoServidor(erro);
      const detalhes = detalhesDoServidor(erro);
      if (codigo === "TRANSFERENCIA_CANCELAMENTO_BLOQUEADO" && detalhes.reason === "original_ja_estornado") {
        // Já cancelada (por esta ou outra tela): o cartão passa a "Cancelado".
        await concluir("Esta transferência já estava cancelada.");
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
    ? { habilitado: false, motivo: TEXTO_SEM_CONEXAO_TRANSFERENCIA }
    : pendente
      ? { habilitado: true, motivo: "Cancelamento anterior sem confirmação do servidor: abra para reenviar a mesma operação." }
      : { habilitado: true, motivo: null };
  const idMotivo = `motivo-cancelar-transferencia-${id}`;
  const idCampo = `campo-motivo-cancelar-transferencia-${id}`;
  const idAjuda = `ajuda-motivo-cancelar-transferencia-${id}`;
  const motivoCurto = motivo.trim().length > 0 && !motivoPronto;
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
          Transferência cancelada.
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
          Cancelar transferência
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
            // Depois do sucesso o botão que abriu o diálogo some: o foco vai ao cartão, não ao <body>.
            const alvo = focoAposFecharRef.current;
            if (!alvo || !alvo.isConnected) return;
            ev.preventDefault();
            focoAposFecharRef.current = null;
            alvo.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Cancelar transferência</DialogTitle>
            <DialogDescription>
              {movimento?.produto_nome || "Produto"} · {fmtKg(quantidade)} {unidade} · {origemNome} → {destinoNome}
              {movimento?.numero_movimentacao ? ` · nº ${movimento.numero_movimentacao}` : ""}. O servidor desfaz as duas pernas pelo valor gravado:
              o produto volta ao depósito de origem e sai do de destino. Nada é apagado: a transferência fica como cancelada no histórico.
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
                <div className="font-semibold">Efeito ao cancelar</div>
                <div>{`${origemNome}: +${fmtKg(quantidade)} ${unidade} (volta ao depósito de origem)`}</div>
                <div>{`${destinoNome}: −${fmtKg(quantidade)} ${unidade} (sai do depósito de destino)`}</div>
                {valor ? <div>{`Valor estornado: ${valor}`}</div> : null}
              </div>
              <label className="block text-xs font-medium text-slate-700" htmlFor={idCampo}>
                Motivo do cancelamento
              </label>
              <Textarea
                id={idCampo}
                aria-describedby={idAjuda}
                aria-invalid={motivoCurto ? true : undefined}
                value={motivo}
                disabled={enviando || desconhecido}
                onChange={(ev) => setMotivo(ev.target.value)}
                maxLength={MOTIVO_MAXIMO_TRANSFERENCIA}
                className="text-sm"
              />
              <p id={idAjuda} className={`text-[11px] leading-snug ${motivoCurto ? "text-red-700" : "text-slate-600"}`}>
                {desconhecido
                  ? "O motivo enviado antes é mantido no reenvio."
                  : `Obrigatório: de ${MOTIVO_MINIMO_TRANSFERENCIA} a ${MOTIVO_MAXIMO_TRANSFERENCIA} caracteres.`}
              </p>
              {desconhecido ? (
                <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  Sem confirmação do servidor. O cancelamento pode ou não ter sido concluído. Reenvie: a MESMA operação é repetida e nunca é aplicada duas vezes.
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
                  {enviando ? "Cancelando..." : desconhecido ? "Tentar de novo" : "Cancelar transferência"}
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

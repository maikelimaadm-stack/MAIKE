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
import { getCurrentUser, ehAdministrador } from "@/services/sessionService";
import { cancelarMovimentacaoMapa, consultarCancelamentoMovimentacao } from "@/services/loteManejoService";
import { tipoTemCancelamento } from "@/domain/lotes/situacaoMovimento";

// Componentes de `ui/*` são forwardRef sem tipos de props: o checkJs não enxerga `children`.
/** @type {React.ComponentType<any>} */ const Button = ButtonUi;
/** @type {React.ComponentType<any>} */ const Textarea = TextareaUi;
/** @type {React.ComponentType<any>} */ const Dialog = DialogUi;
/** @type {React.ComponentType<any>} */ const DialogContent = DialogContentUi;
/** @type {React.ComponentType<any>} */ const DialogDescription = DialogDescriptionUi;
/** @type {React.ComponentType<any>} */ const DialogHeader = DialogHeaderUi;
/** @type {React.ComponentType<any>} */ const DialogTitle = DialogTitleUi;

/**
 * Cancelar movimentação (R2A, D-PROD-95).
 *
 * Nenhuma reversão acontece no navegador: o botão chama o comando do servidor,
 * que revalida tudo numa transação. A `operation_id` é gerada ao abrir e
 * mantida enquanto o resultado for desconhecido (rede, 5xx, timeout): repetir
 * com a mesma chave nunca reverte duas vezes. Offline: só leitura.
 */

/** Mensagens em português para as recusas estáveis do servidor. */
export const MENSAGENS_RECUSA = Object.freeze({
  CANCELAMENTO_TIPO_NAO_SUPORTADO: "Cancelamento não disponível para este tipo de movimentação.",
  CANCELAMENTO_VINCULO_AMBIGUO: "Registro sem vínculo comprovado do lote (registro antigo ou unificação sem destino gravado). Não é possível cancelar com segurança.",
  CANCELAMENTO_DEPENDENCIA_POSTERIOR: "Há registros posteriores deste lote ou desta área. Cancele-os antes, do mais recente para o mais antigo.",
  CANCELAMENTO_JA_REALIZADO: "Esta movimentação já está cancelada.",
  CANCELAMENTO_ESTADO_DIVERGENTE: "O estado atual do lote não corresponde ao efeito desta movimentação. Nada foi alterado.",
  CANCELAMENTO_SALDO_INSUFICIENTE: "O lote não tem cabeças suficientes para desfazer esta movimentação. Nada foi alterado.",
  CANCELAMENTO_EFEITO_NAO_COMPROVADO: "Não há registro provando que esta movimentação alterou o lote. Nada foi alterado.",
  TENANT_ADMIN_REQUIRED: "Somente o administrador da fazenda pode cancelar movimentações.",
  IDEMPOTENCY_CONFLICT: "Esta operação já foi enviada com outro motivo. Feche e abra de novo para recomeçar.",
});

/** Código do servidor preservado no `cause` do ApiError (corpo da resposta). */
const codigoDoServidor = (erro) => (typeof erro?.cause?.code === "string" ? erro.cause.code : null);

/** Recusa definitiva: o servidor respondeu e nada foi gravado. Qualquer outra coisa é resultado desconhecido. */
const ehRecusaDefinitiva = (codigo) => !!codigo && (codigo in MENSAGENS_RECUSA || codigo === "MOVIMENTACAOMAPA_NOT_FOUND" || codigo === "REQUEST_VALIDATION_FAILED");

const novaChave = () =>
  `cancel-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const estaOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

const descreverEfeito = (efeito) => {
  const a = efeito?.antes || {};
  const d = efeito?.depois || {};
  const partes = [];
  if (typeof a.quantidade_cabecas === "number" && typeof d.quantidade_cabecas === "number") {
    partes.push(`${a.quantidade_cabecas} → ${d.quantidade_cabecas} cab`);
  }
  if (a.area_atual_nome !== undefined || d.area_atual_nome !== undefined) {
    partes.push(`área ${a.area_atual_nome || "-"} → ${d.area_atual_nome || "-"}`);
  }
  if (a.status && d.status && a.status !== d.status) partes.push(`${a.status} → ${d.status}`);
  return partes.join(" · ");
};

/**
 * @param {{ movimento: any, onCancelado?: () => void }} props
 */
export default function CancelarMovimentacao({ movimento, onCancelado }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [desconhecido, setDesconhecido] = React.useState(false);
  const [recusa, setRecusa] = React.useState(null);
  const chaveRef = React.useRef(null);

  const { data: usuario } = useQuery({ queryKey: ["usuario-atual-cancelamento"], queryFn: () => getCurrentUser(), staleTime: 60_000 });
  const admin = ehAdministrador(usuario);

  const elegibilidade = useQuery({
    queryKey: ["elegibilidade-cancelamento", movimento?.id],
    queryFn: () => consultarCancelamentoMovimentacao(movimento.id),
    enabled: aberto && !!movimento?.id && estaOnline(),
    staleTime: 0,
    retry: false,
  });

  if (!movimento || !tipoTemCancelamento(movimento)) return null;
  // Só o administrador ativo vê a ação (o servidor reautoriza no POST).
  if (!admin) return null;

  const online = estaOnline();

  const abrir = () => {
    chaveRef.current = novaChave();
    setMotivo("");
    setRecusa(null);
    setDesconhecido(false);
    setAberto(true);
  };

  const fechar = (valor) => {
    if (!valor && enviando) return;
    if (!valor && desconhecido) {
      // Resultado desconhecido: a chave fica guardada para o próximo envio deste
      // mesmo movimento; ao reabrir, o GET de elegibilidade mostra se já cancelou.
      queryClient.invalidateQueries({ queryKey: ["historico-movimentacoes"] });
    }
    setAberto(valor);
  };

  const confirmar = async () => {
    if (enviando || motivo.trim().length < 3) return;
    setEnviando(true);
    setRecusa(null);
    try {
      await cancelarMovimentacaoMapa(movimento.id, { operation_id: chaveRef.current, motivo: motivo.trim() });
      toast.success("Movimentação cancelada.");
      setDesconhecido(false);
      setAberto(false);
      await Promise.all(
        ["historico-movimentacoes", "historico-registros-lote", "historico-abate-curral", "mapa-cache", "mapa-lotes", "lotes", "elegibilidade-cancelamento"].map(
          (chave) => queryClient.invalidateQueries({ queryKey: [chave] })
        )
      );
      try {
        window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["lotes", "movimentacoes"] } }));
      } catch {
        /* best-effort */
      }
      onCancelado?.();
    } catch (erro) {
      const codigo = codigoDoServidor(erro);
      if (ehRecusaDefinitiva(codigo)) {
        setRecusa(MENSAGENS_RECUSA[codigo] || "Não foi possível cancelar. Nada foi alterado.");
        setDesconhecido(false);
        chaveRef.current = novaChave();
      } else {
        setDesconhecido(true);
      }
    } finally {
      setEnviando(false);
    }
  };

  /** @type {{elegivel?: boolean, codigo?: string|null, motivo?: string|null, efeitos?: any[]} | undefined} */
  const e = /** @type {any} */ (elegibilidade.data);
  const motivoPronto = motivo.trim().length >= 3;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        disabled={!online}
        title={online ? undefined : "Cancelamento só com conexão"}
        onClick={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          abrir();
        }}
      >
        Cancelar movimentação
      </Button>
      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar movimentação</DialogTitle>
            <DialogDescription>
              {movimento.tipo} · {movimento.lote || "Sem lote"} · {movimento.quantidade_animais} cab. O registro original continua no histórico, marcado como cancelado.
            </DialogDescription>
          </DialogHeader>

          {elegibilidade.isLoading && <div role="status" className="text-sm text-slate-500">Conferindo no servidor...</div>}
          {elegibilidade.isError && (
            <div role="alert" className="text-sm text-red-700">Não foi possível conferir agora. Tente novamente.</div>
          )}
          {e && !e.elegivel && (
            <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {MENSAGENS_RECUSA[e.codigo] || e.motivo || "Cancelamento indisponível."}
            </div>
          )}
          {e?.elegivel && (
            <div className="space-y-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                <div className="font-semibold">Efeito ao cancelar</div>
                {(e.efeitos || []).map((efeito) => (
                  <div key={efeito.lote_id}>{descreverEfeito(efeito)}</div>
                ))}
              </div>
              <label className="block text-xs font-medium text-slate-700" htmlFor={`motivo-${movimento.id}`}>
                Motivo do cancelamento
              </label>
              <Textarea
                id={`motivo-${movimento.id}`}
                value={motivo}
                disabled={enviando || desconhecido}
                onChange={(ev) => setMotivo(ev.target.value)}
                maxLength={500}
                className="text-sm"
              />
              {desconhecido && (
                <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  Sem resposta do servidor. O cancelamento pode ou não ter sido concluído. Tente de novo: a mesma operação é reenviada e nunca é aplicada duas vezes.
                </div>
              )}
              {recusa && (
                <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                  {recusa}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={enviando} onClick={() => fechar(false)}>
                  Voltar
                </Button>
                <Button type="button" variant="destructive" size="sm" disabled={!motivoPronto || enviando || !online} onClick={confirmar}>
                  {enviando ? "Cancelando..." : desconhecido ? "Tentar de novo" : "Confirmar cancelamento"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

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
import { getCurrentUser, carregarPermissaoEfetiva } from "@/services/sessionService";
import { podeCancelarLancamentosEstoque } from "@/lib/mapaGeralPermissions";
import { cancelarLancamentoCocho, cancelarLancamentoCochoSemInternet, consultarElegibilidadeCancelamentoCocho } from "@/services/suplementacaoCancelamentoService";
import { refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import { CANCELAMENTO_COCHO_HABILITADO } from "@/domain/estornos/politicaEstorno";
import { invalidarCachesDoMapa } from "@/components/mapa/invalidarCachesMapa";
import { confirmar as pedirConfirmacao } from "@/lib/maikeConfirmar";
import { mensagemRecalculoDaExclusao } from "@/lib/gestaoErros";
import PreviaRecalculoExclusao from "@/components/estoque/PreviaRecalculoExclusao";

// Componentes de `ui/*` são forwardRef sem tipos de props: o checkJs não enxerga `children`.
/** @type {React.ComponentType<any>} */ const Button = ButtonUi;
/** @type {React.ComponentType<any>} */ const Dialog = DialogUi;
/** @type {React.ComponentType<any>} */ const DialogContent = DialogContentUi;
/** @type {React.ComponentType<any>} */ const DialogDescription = DialogDescriptionUi;
/** @type {React.ComponentType<any>} */ const DialogHeader = DialogHeaderUi;
/** @type {React.ComponentType<any>} */ const DialogTitle = DialogTitleUi;

/**
 * Excluir lançamento do cocho — D-PROD-268 (o comando do servidor é o cancelamento com estorno
 * exato; na tela o usuário só vê EXCLUSÃO: botão, diálogo, avisos e recusas falam "excluir").
 *
 * Um comando do servidor faz tudo numa transação: devolve ao depósito a baixa EXATA do
 * lançamento (pelo motor do estoque), cancela o evento e o rateio dele (somem dos históricos do
 * cocho, do pasto e do lote; ficam na auditoria e, no depósito, como saída estornada + entrada de
 * estorno) e reabre o período anterior quando o servidor prova que foi este lançamento que o
 * fechou. Nada é desfeito no navegador.
 *
 * Quem vê: administrador real, `is_admin` ou a chave `cancelar_lancamentos_estoque` do Mapa Geral
 * (o servidor relê a regra no GET e no POST). Só online (nunca na fila offline). A elegibilidade
 * (ensaio no servidor, nada gravado) é consultada antes de habilitar; o motivo é obrigatório; a
 * `operation_id` nasce ao abrir e fica guardada enquanto o resultado for desconhecido (rede, 5xx,
 * timeout): "tentar de novo" reenvia a MESMA operação, que nunca estorna duas vezes.
 */

const DIGA_AJUSTE = "Para corrigir, faça um ajuste de estoque no depósito.";
const NADA = "Nada foi alterado.";

/** Frase em linguagem de campo para cada `reason` do servidor (nada foi alterado). */
export const MENSAGENS_REASON = Object.freeze({
  lancamento_posterior: `Há um lançamento mais novo neste cocho. Exclua primeiro o mais recente. ${NADA}`,
  periodo_fechado: `O período deste lançamento já foi fechado (o gado saiu ou o consumo foi fechado): o consumo virou fato. ${DIGA_AJUSTE} ${NADA}`,
  gado_movimentado: `O gado das áreas deste cocho foi movimentado depois do lançamento. Desfaça a movimentação antes ou corrija por ajuste de estoque. ${NADA}`,
  sem_recibo: `Este lançamento não foi feito pelo lançamento do cocho (é antigo ou automático) e não pode ser excluído. ${DIGA_AJUSTE} ${NADA}`,
  rateio_divergente: `O rateio deste lançamento entre os lotes foi alterado fora do lançamento. ${DIGA_AJUSTE} ${NADA}`,
  saida_nao_comprovada: `Não há prova de qual baixa do depósito é deste lançamento. ${DIGA_AJUSTE} ${NADA}`,
  saida_sem_fatias: `A baixa do depósito é anterior ao controle por nota e não pode ser devolvida com exatidão. ${DIGA_AJUSTE} ${NADA}`,
  movimento_posterior_no_deposito: `O depósito teve outro movimento deste produto depois do lançamento (outro cocho, compra ou transferência). Exclua primeiro o mais recente. ${NADA}`,
  periodo_anterior_nao_comprovado: `Não há prova de que este lançamento fechou o período anterior do cocho; ele não pode ser reaberto com segurança. ${NADA}`,
  periodo_anterior_alterado: `O período anterior do cocho foi alterado depois do fechamento; ele não pode ser reaberto com segurança. ${NADA}`,
  lote_periodo_anterior_nao_comprovado: `Um lote do período anterior foi fechado sem prova deste lançamento; o período não pode ser reaberto com segurança. ${NADA}`,
  movimento_estornado: `A baixa do depósito deste lançamento já foi devolvida ao depósito. ${NADA}`,
  lote_indisponivel_para_devolucao: `Uma nota que forneceu este produto não está mais disponível para receber a devolução. ${NADA}`,
  devolucao_excede_entrada: `A devolução passaria do que entrou na nota. ${NADA}`,
  fatias_inconsistentes: `Os registros da baixa no depósito estão inconsistentes. ${NADA}`,
  vinculo_divergente: `A baixa do depósito não corresponde a este lançamento. ${NADA}`,
  camada_divergente: `Uma nota mudou de produto, depósito ou custo depois da baixa. ${NADA}`,
  estoque_excede_limite: `A devolução passaria do limite de estoque do produto. ${NADA}`,
});

/** Recusas estáveis por código (sem `reason`). */
export const MENSAGENS_CODIGO = Object.freeze({
  CANCELAMENTO_JA_REALIZADO: "Este lançamento já foi excluído.",
  SUPLEMENTACAOEVENTO_NOT_FOUND: "Este lançamento não existe mais.",
  ACAO_NAO_PERMITIDA: "Você não tem permissão para excluir lançamentos.",
  EMPRESA_NOT_FOUND: `Fazenda não encontrada. ${NADA}`,
  REQUEST_VALIDATION_FAILED: `Informe o motivo (de 3 a 500 caracteres). ${NADA}`,
  IDEMPOTENCY_CONFLICT: "Esta exclusão já foi enviada com outro motivo. Feche e abra de novo para recomeçar.",
  CONCURRENCY_CONFLICT: `Outra operação alterava este cocho ao mesmo tempo. Tente de novo. ${NADA}`,
  ESTOQUE_LOCAL_INVALIDO: `O depósito deste lançamento não foi encontrado. ${NADA}`,
  // D-PROD-273 (fatia 4): recusas do recálculo do que veio depois (a frase com o motivo vem de `mensagemRecalculoDaExclusao`).
  ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL: `A exclusão com recálculo não é segura para este lançamento. ${NADA}`,
  ESTOQUE_EXCLUSAO_SALDO_NEGATIVO: `Sem este lançamento o saldo do depósito ficaria negativo. ${NADA}`,
  ESTOQUE_RECALCULO_VOLUME_EXCEDIDO: `Há movimentos demais deste produto depois deste lançamento para recalcular de uma vez. ${NADA}`,
});

/**
 * Mensagem em português da recusa do servidor.
 * @param {string|null|undefined} codigo @param {string|null|undefined} reason
 */
export const mensagemDoCancelamento = (codigo, reason) => {
  const recalculo = mensagemRecalculoDaExclusao(codigo ?? null, reason ?? null, {});
  if (recalculo) return recalculo;
  if (codigo === "SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO") return (reason && MENSAGENS_REASON[reason]) || `O lançamento não pode ser excluído com segurança agora. ${NADA}`;
  return (codigo && MENSAGENS_CODIGO[codigo]) || `Não foi possível excluir. ${NADA}`;
};

/** Código e `reason` do corpo de erro do servidor (preservado no `cause` do ApiError). @param {any} erro */
const doServidor = (erro) => ({
  codigo: typeof erro?.cause?.code === "string" ? erro.cause.code : null,
  reason: typeof erro?.cause?.reason === "string" ? erro.cause.reason : typeof erro?.cause?.details?.reason === "string" ? erro.cause.details.reason : null,
});

/** Recusa definitiva: o servidor respondeu e nada foi gravado. O resto é resultado desconhecido. @param {string|null} codigo */
const ehRecusaDefinitiva = (codigo) => !!codigo && (codigo === "SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO" || codigo in MENSAGENS_CODIGO);

/** 403 da guarda da rota (permissão revogada depois que a tela leu a efetiva). @param {unknown} erro */
const ehRecusaDePermissao = (erro) => ["ACAO_NAO_PERMITIDA", "TENANT_ADMIN_REQUIRED"].includes(/** @type {string} */ (doServidor(erro).codigo));

const novaChave = () =>
  `cancelar-cocho-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/** Escopo por tenant + usuário (a pendência de um usuário nunca aparece na sessão de outro). @param {any} usuario */
const escopoDoUsuario = (usuario) => `${usuario?.cliente_id ?? "-"}:${usuario?.id ?? usuario?.usuario_id ?? "-"}`;

const estaOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** Operação pendente (chave + motivo) por usuário e lançamento: sobrevive a fechar e recarregar. */
const chavePendente = (escopo, id) => `maike_cancelamento_cocho_pendente:${escopo}:${id}`;
/** @param {string} escopo @param {string} id */
export const lerPendenteCocho = (escopo, id) => {
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

const kg = (v) => `${Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;
const reais = (v) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const diaBR = (d) => String(d ?? "").slice(0, 10).split("-").reverse().join("/");

/** Linhas do que a exclusão faz (vindas do ensaio do servidor). @param {any} efeitos */
export const descreverEfeitos = (efeitos) => {
  const linhas = [];
  if (efeitos?.estorno) {
    linhas.push(`Devolve ${kg(efeitos.estorno.quantidade)}${efeitos.estorno.produto_nome ? ` de ${efeitos.estorno.produto_nome}` : ""} ao ${efeitos.estorno.local_nome || "depósito"} (${reais(efeitos.estorno.valor_total)}).`);
  } else {
    linhas.push("Não mexe no estoque (o lançamento não baixou do depósito).");
  }
  if (efeitos?.periodo_reaberto) {
    linhas.push(`Reabre o período de ${diaBR(efeitos.periodo_reaberto.data_lancamento)} com sobra inicial de ${kg(efeitos.periodo_reaberto.sobra_inicial_restaurada_kg)}.`);
  }
  const n = Number(efeitos?.lotes_a_cancelar ?? 0);
  if (n > 0) linhas.push(`Tira o lançamento do rateio de ${n} lote${n === 1 ? "" : "s"}.`);
  // D-PROD-273 (fatia 4): o que veio depois no depósito tem o custo médio recalculado (outros cochos, saídas, vendas…).
  const m = Number(efeitos?.recalculo?.movimentos ?? 0);
  const d = Number(efeitos?.recalculo?.dependentes ?? 0);
  if (m > 0) linhas.push(`Recalcula o custo de ${m} movimento${m === 1 ? "" : "s"} lançado${m === 1 ? "" : "s"} depois no depósito${d > 0 ? ` e de ${d} registro${d === 1 ? "" : "s"} que usa${d === 1 ? "" : "m"} esse custo` : ""}.`);
  return linhas;
};

/** Limpa as cópias do aparelho e relê do servidor o que o cancelamento mudou. */
const recarregar = async (queryClient, evento) => {
  const empresaId = evento.empresa_id;
  const semEste = (items) => (Array.isArray(items) ? items : []).filter((item) => item?.id !== evento.id);
  await updateMapaCachedData("eventosSuplementacao", empresaId, semEste).catch(() => {});
  await Promise.all(
    ["eventosSuplementacao", "suplementacaoLote", "movimentacaoEstoque", "estoqueLotes", "produtos"].map((chave) =>
      refreshMapaCacheEntry(chave, empresaId, { force: true }).catch(() => null)
    )
  );
  await invalidarCachesDoMapa(queryClient, [
    "suplementacao-ponto", "eventos-ponto", "ultimo-evento-ponto", "eventos-recentes-ponto", "mapa-eventos-supl", "mapa-pontos-supl",
    "lotes-nota-suplementacao", "movimentacoes", "produtos", "saldo-deposito", "movimentacoes-deposito-detalhe", "mapa-eventosSuplementacao",
    "historico-movimentacoes", "elegibilidade-cancelamento-cocho", "estoqueLotes",
  ]);
  window.dispatchEvent(new CustomEvent("atualizar-mapa"));
};

/**
 * D-PROD-268 — o usuário atual pode cancelar lançamento de cocho? (admin real, `is_admin` ou a chave
 * `cancelar_lancamentos_estoque`; a MESMA permissão efetiva e chave de cache do Mapa Geral). Só
 * interface: o servidor reautoriza no GET e no POST. Falha ao ler = não (a ação não aparece).
 * @returns {{ usuario: any, autorizado: boolean }}
 */
export function usePermissaoCancelarCocho() {
  const { data: usuario } = useQuery({ queryKey: ["usuario-atual-exclusao"], queryFn: () => getCurrentUser(), staleTime: 60_000 });
  const admin = usuario?.administrador_fazenda === true;
  const login = usuario?.login || usuario?.email || null;
  // A MESMA consulta (e chave) da permissão efetiva do Mapa Geral.
  const { data: permissaoEfetiva = null } = useQuery({
    queryKey: ["permissao-efetiva", login, admin],
    // Falha ao ler a permissão = sem permissão (fail-closed: a ação não aparece).
    queryFn: async () => {
      try {
        return await carregarPermissaoEfetiva(usuario);
      } catch {
        return null;
      }
    },
    enabled: Boolean(login) && !admin,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const autorizado = podeCancelarLancamentosEstoque(usuario, permissaoEfetiva);
  return { usuario, autorizado };
}

/** D-PROD-298 — o que o botão diz sem internet. */
export const TEXTO_EXCLUSAO_SEM_INTERNET = "Sem internet: a exclusão fica no celular e vai ao sistema quando a internet voltar.";

/**
 * @param {{ evento: any, onCancelado?: () => void, rotulo?: string }} props
 */
export default function CancelarLancamentoCocho({ evento, onCancelado, rotulo = "Excluir lançamento" }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState(MOTIVO_EXCLUSAO_MAPA);
  const [enviando, setEnviando] = React.useState(false);
  const [desconhecido, setDesconhecido] = React.useState(false);
  const [recusa, setRecusa] = React.useState(/** @type {string|null} */ (null));
  const [online, setOnline] = React.useState(estaOnline());
  const [cancelado, setCancelado] = React.useState(false);
  const chaveRef = React.useRef(/** @type {string|null} */ (null));

  React.useEffect(() => {
    const atualizar = () => setOnline(estaOnline());
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  const { usuario, autorizado } = usePermissaoCancelarCocho();
  const escopo = escopoDoUsuario(usuario);
  // D-PROD-296: o lançamento feito sem internet que ainda não subiu não existe no servidor —
  // não há o que excluir lá (o "Excluir" da fila vem na próxima etapa).
  const suportado = CANCELAMENTO_COCHO_HABILITADO && !!evento?.id && !!evento?.empresa_id && evento?.situacao !== "cancelado" && !evento?._aguardandoEnvio;

  const elegibilidade = useQuery({
    queryKey: ["elegibilidade-cancelamento-cocho", usuario?.cliente_id ?? null, usuario?.id ?? null, evento?.empresa_id ?? null, evento?.id],
    // Só o lançamento mais recente de cada cocho monta esta ação: poucas consultas por tela.
    queryFn: ({ signal }) => consultarElegibilidadeCancelamentoCocho({ evento, signal }),
    enabled: suportado && autorizado && !!usuario && online && !cancelado,
    staleTime: 30_000,
    refetchOnMount: "always",
    retry: false,
  });

  // A guarda do GET nega 403 antes do serviço: é a permissão revogada no servidor. Relê a
  // permissão efetiva (a ação some) em vez de oferecer "Verificar de novo" sem fim — o molde do
  // ExcluirMovimentacao (D-PROD-266).
  const negadoNoServidor = elegibilidade.isError && ehRecusaDePermissao(elegibilidade.error);
  React.useEffect(() => {
    if (negadoNoServidor) queryClient.invalidateQueries({ queryKey: ["permissao-efetiva"] });
  }, [negadoNoServidor, queryClient]);

  if (!suportado || cancelado || !autorizado) return null;

  /** @type {any} */
  const e = elegibilidade.data;
  const pendenteAgora = lerPendenteCocho(escopo, evento.id);
  const elegivelAgora = elegibilidade.isSuccess && e?.elegivel === true && !elegibilidade.isFetching;
  const motivoPronto = motivo.trim().length >= 3 && motivo.trim().length <= 500;
  const podeEnviar = online && motivoPronto && !enviando && (elegivelAgora || desconhecido);

  const estado = (() => {
    // D-PROD-298: sem internet, a exclusão fica no aparelho e sobe quando a internet voltar.
    if (!online) return { habilitado: true, motivo: TEXTO_EXCLUSAO_SEM_INTERNET };
    if (pendenteAgora) return { habilitado: true, motivo: "Exclusão anterior sem confirmação do servidor: abra para reenviar a mesma operação." };
    if (negadoNoServidor) return { habilitado: false, motivo: MENSAGENS_CODIGO.ACAO_NAO_PERMITIDA };
    if (elegibilidade.isError) return { habilitado: false, motivo: "Não foi possível verificar no servidor. Nada foi alterado.", tentarDeNovo: true };
    if (!e || elegibilidade.isFetching) return { habilitado: false, motivo: "Conferindo no servidor…", verificando: true };
    if (!e.elegivel) return { habilitado: false, motivo: mensagemDoCancelamento(e.codigo, e.reason) };
    return { habilitado: true, motivo: null };
  })();

  // D-PROD-298: sem internet, confirma e guarda a exclusão (o servidor confere tudo quando ela subir).
  const excluirSemInternet = async () => {
    const ok = await pedirConfirmacao({
      titulo: "Excluir lançamento sem internet?",
      descricao:
        "A exclusão fica guardada neste celular e vai ao sistema quando a internet voltar. Lá, o estoque volta ao depósito e o período anterior é reaberto. Se o sistema recusar, ela aparece em \"Sincronização\".",
      textoConfirmar: "Excluir",
      perigo: true,
    });
    if (!ok) return;
    const pendente = lerPendenteCocho(escopo, evento.id);
    try {
      await cancelarLancamentoCochoSemInternet({ evento, motivo: pendente?.motivo || MOTIVO_EXCLUSAO_MAPA, operationId: pendente?.operation_id || novaChave() });
      limparPendente(escopo, evento.id);
      setCancelado(true);
      toast.success("Lançamento excluído.");
      // Sem gravar no cache: as telas releem e a visão do que espera envio tira o lançamento.
      await invalidarCachesDoMapa(queryClient, [
        "suplementacao-ponto", "eventos-ponto", "ultimo-evento-ponto", "eventos-recentes-ponto", "mapa-eventos-supl", "mapa-pontos-supl",
        "lotes-nota-suplementacao", "saldo-deposito", "movimentacoes-deposito-detalhe", "mapa-eventosSuplementacao", "estoqueLotes",
      ]);
      window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["eventosSuplementacao", "estoqueLotes"] } }));
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
    const pendente = lerPendenteCocho(escopo, evento.id);
    if (pendente) {
      chaveRef.current = pendente.operation_id;
      setMotivo(pendente.motivo);
      setDesconhecido(true);
    } else {
      chaveRef.current = novaChave();
      setMotivo(MOTIVO_EXCLUSAO_MAPA);
      setDesconhecido(false);
    }
    setRecusa(null);
    setAberto(true);
    elegibilidade.refetch();
  };

  const fechar = (valor) => {
    if (!valor && enviando) return;
    if (!valor && desconhecido) {
      pedirConfirmacao({
        titulo: "Exclusão sem confirmação",
        descricao: "O servidor ainda não confirmou esta exclusão. A operação fica guardada e será reenviada com a mesma chave quando você abrir de novo. Fechar mesmo assim?",
        textoConfirmar: "Fechar",
        textoCancelar: "Voltar",
      }).then((ok) => {
        if (ok) setAberto(false);
      });
      return;
    }
    setAberto(valor);
  };

  const confirmar = async () => {
    if (!podeEnviar) return;
    setEnviando(true);
    setRecusa(null);
    const operationId = chaveRef.current || novaChave();
    chaveRef.current = operationId;
    gravarPendente(escopo, evento.id, { operation_id: operationId, motivo: motivo.trim() });
    try {
      await cancelarLancamentoCocho({ evento, motivo: motivo.trim(), operationId });
      limparPendente(escopo, evento.id);
      setDesconhecido(false);
      setAberto(false);
      setCancelado(true);
      toast.success("Lançamento excluído.");
      await recarregar(queryClient, evento);
      onCancelado?.();
    } catch (erro) {
      const { codigo, reason } = doServidor(erro);
      if (codigo === "CANCELAMENTO_JA_REALIZADO" || codigo === "SUPLEMENTACAOEVENTO_NOT_FOUND") {
        limparPendente(escopo, evento.id);
        setDesconhecido(false);
        setAberto(false);
        setCancelado(true);
        toast.success(MENSAGENS_CODIGO[codigo]);
        await recarregar(queryClient, evento);
        onCancelado?.();
      } else if (ehRecusaDefinitiva(codigo)) {
        // O servidor respondeu: nada foi gravado; a próxima tentativa é outra operação.
        limparPendente(escopo, evento.id);
        setDesconhecido(false);
        setRecusa(mensagemDoCancelamento(codigo, reason));
        chaveRef.current = novaChave();
        setMotivo(MOTIVO_EXCLUSAO_MAPA); // D-PROD-270: operação nova = motivo fixo
        if (ehRecusaDePermissao(erro)) queryClient.invalidateQueries({ queryKey: ["permissao-efetiva"] });
        else elegibilidade.refetch();
        if (codigo === "SUPLEMENTACAO_CANCELAMENTO_BLOQUEADO") invalidarCachesDoMapa(queryClient, ["suplementacao-ponto", "mapa-eventos-supl"]);
      } else {
        setDesconhecido(true);
      }
    } finally {
      setEnviando(false);
    }
  };

  const idMotivo = `motivo-cancelamento-cocho-${evento.id}`;
  return (
    <div className="flex flex-col items-start gap-1" data-estado-cancelamento={estado.habilitado ? "elegivel" : estado.verificando ? "verificando" : "bloqueado"}>
      <div className="flex flex-wrap items-center gap-1">
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
          {rotulo}
        </Button>
        {estado.tentarDeNovo ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs text-slate-600" onClick={() => elegibilidade.refetch()}>
            Verificar de novo
          </Button>
        ) : null}
      </div>
      {estado.motivo ? (
        <p id={idMotivo} className="max-w-full text-[11px] leading-snug text-slate-600">
          {estado.motivo}
        </p>
      ) : null}
      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir lançamento do cocho</DialogTitle>
            <DialogDescription>
              {evento.ponto_nome ? `${evento.ponto_nome} · ` : ""}
              {evento.produto || "Suplementação"}
              {evento.data_lancamento ? ` · ${diaBR(evento.data_lancamento)}` : ""}. O lançamento sai dos históricos do cocho, do pasto e do lote e o estoque volta ao depósito; o registro da exclusão fica na auditoria.
            </DialogDescription>
          </DialogHeader>
          {!online ? <div role="alert" className="text-sm text-amber-800">Sem conexão. A exclusão só é feita online.</div> : null}
          {online && elegibilidade.isFetching ? <div role="status" className="text-sm text-slate-500">Conferindo no servidor...</div> : null}
          {elegivelAgora ? (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-700" aria-label="O que a exclusão faz">
              {descreverEfeitos(e.efeitos).map((linha) => (
                <li key={linha}>{linha}</li>
              ))}
            </ul>
          ) : null}
          {elegivelAgora && e?.efeitos?.recalculo ? (
            <PreviaRecalculoExclusao empresaId={evento.empresa_id} movimentoIds={[evento.movimentacao_estoque_id]} className="text-xs" />
          ) : null}
          {e && e.elegivel === false && !elegibilidade.isFetching && !desconhecido ? (
            <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {mensagemDoCancelamento(e.codigo, e.reason)}
            </div>
          ) : null}
          <div className="space-y-2">
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
                {enviando ? "Excluindo..." : desconhecido ? "Tentar de novo" : "Excluir lançamento"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

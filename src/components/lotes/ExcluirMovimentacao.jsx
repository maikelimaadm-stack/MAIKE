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
import {
  excluirMovimentacaoMapa,
  consultarExclusaoMovimentacao,
  removerMovimentacaoExcluidaDoCacheOffline,
  pendenciasOfflineDaMovimentacao,
  eventoMudancaFilaOffline,
} from "@/services/loteManejoService";
import { refreshMapaCacheEntry, updateMapaCachedData } from "@/services/mapaCacheService";
import { tipoTemExclusao } from "@/domain/lotes/situacaoMovimento";

// Componentes de `ui/*` são forwardRef sem tipos de props: o checkJs não enxerga `children`.
/** @type {React.ComponentType<any>} */ const Button = ButtonUi;
/** @type {React.ComponentType<any>} */ const Textarea = TextareaUi;
/** @type {React.ComponentType<any>} */ const Dialog = DialogUi;
/** @type {React.ComponentType<any>} */ const DialogContent = DialogContentUi;
/** @type {React.ComponentType<any>} */ const DialogDescription = DialogDescriptionUi;
/** @type {React.ComponentType<any>} */ const DialogHeader = DialogHeaderUi;
/** @type {React.ComponentType<any>} */ const DialogTitle = DialogTitleUi;

/**
 * Excluir movimentação — exclusão DEFINITIVA segura (D-PROD-110).
 *
 * Não há edição de movimento confirmado: para corrigir, exclui-se e lança-se a
 * operação certa. Nada é desfeito no navegador: o botão chama o comando do
 * servidor, que revalida tudo numa transação (dependências causais, saldo por
 * data, peso, vínculos) e apaga o fato inteiro ou nada. A `operation_id` é
 * gerada ao abrir e mantida enquanto o resultado for desconhecido (rede, 5xx,
 * timeout): repetir com a mesma chave nunca estorna duas vezes. Offline: só
 * leitura, botão desabilitado com o motivo; nunca vai para a fila.
 */

/** Mensagens em português para as recusas estáveis do servidor (nada foi alterado). */
export const MENSAGENS_RECUSA = Object.freeze({
  EXCLUSAO_JA_REALIZADA: "Esta movimentação já foi excluída.",
  EXCLUSAO_MOVIMENTO_LEGADO: "Registro anterior ao controle por posições: fica no histórico e não pode ser excluído. Registre a correção como um manejo novo. Nada foi alterado.",
  EXCLUSAO_MOVIMENTO_CANCELADO: "Esta movimentação foi cancelada pelo mecanismo anterior e fica no histórico. Nada foi alterado.",
  EXCLUSAO_REFERENCIA_DOCUMENTAL: "Há registros de outros módulos (mesmo cancelados) que citam esta movimentação. Trate-os antes. Nada foi alterado.",
  REBANHO_CANCELAMENTO_VINCULO_POSTERIOR: "Há lançamentos de outros módulos (tarefa, suplementação, sanidade...) ligados a esta movimentação. Trate-os antes. Nada foi alterado.",
  CANCELAMENTO_SALDO_HISTORICO_NEGATIVO: "Um registro posterior usa estas cabeças. Exclua-o antes, do mais recente para o mais antigo. Nada foi alterado.",
  REBANHO_DEPENDENCIA_FATO_SEM_SALDO: "Uma pesagem ou nascimento posterior depende deste registro. Exclua-o antes, do mais recente para o mais antigo. Nada foi alterado.",
  REBANHO_PESO_DEPENDENCIA_CAUSAL: "Um registro posterior calculou o peso a partir deste. Exclua-o antes, do mais recente para o mais antigo. Nada foi alterado.",
  CANCELAMENTO_EFEITO_NAO_COMPROVADO: "Não há prova de que esta movimentação gerou o registro do rebanho. Nada foi alterado.",
  CANCELAMENTO_JA_REALIZADO: "Esta movimentação já está cancelada. Nada foi alterado.",
  TENANT_ADMIN_REQUIRED: "Somente o administrador da fazenda pode excluir movimentações.",
  IDEMPOTENCY_CONFLICT: "Esta exclusão já foi enviada com outro motivo. Feche e abra de novo para recomeçar.",
  IDEMPOTENCY_EFEITO_EXCLUIDO: "Esta operação já foi excluída. Feche e abra de novo.",
});

const diaBR = (d) => String(d ?? "").split("-").reverse().join("/");
/** Recusa com o detalhe do servidor (data/área/peso) quando houver. */
export const mensagemDeRecusa = (codigo, detalhes) => {
  const d = detalhes && typeof detalhes === "object" ? detalhes : null;
  if (codigo === "CANCELAMENTO_SALDO_HISTORICO_NEGATIVO" && d?.data) {
    return `Excluir deixaria saldo negativo em ${d.area_nome ?? "uma área"} no dia ${diaBR(d.data)}. Exclua antes o registro posterior que usa estas cabeças. Nada foi alterado.`;
  }
  if (codigo === "REBANHO_DEPENDENCIA_FATO_SEM_SALDO" && d?.data) {
    return d.tipo === "NASCIMENTO"
      ? `O nascimento do dia ${diaBR(d.data)} ficaria sem as matrizes registradas nele. Exclua-o antes. Nada foi alterado.`
      : `A pesagem do dia ${diaBR(d.data)} ficaria numa posição sem cabeças. Exclua-a antes. Nada foi alterado.`;
  }
  if (codigo === "REBANHO_PESO_DEPENDENCIA_CAUSAL" && d?.data) {
    const kg = (v) => (v === null || v === undefined ? "desconhecido" : `${Number(v).toLocaleString("pt-BR")} kg`);
    return `O registro do dia ${diaBR(d.data)} calculou o peso a partir deste (registrado ${kg(d.peso_registrado_kg)}; passaria a ${kg(d.peso_recalculado_kg)}). Exclua-o antes. Nada foi alterado.`;
  }
  if ((codigo === "REBANHO_CANCELAMENTO_VINCULO_POSTERIOR" || codigo === "EXCLUSAO_REFERENCIA_DOCUMENTAL") && Array.isArray(d?.bloqueadores) && d.bloqueadores.length) {
    const lista = d.bloqueadores.slice(0, 3).map((b) => `${b.tipo}${b.data ? ` de ${diaBR(b.data)}` : ""}`).join(", ");
    return `${MENSAGENS_RECUSA[codigo]} (${lista}${d.bloqueadores.length > 3 ? "..." : ""})`;
  }
  return MENSAGENS_RECUSA[codigo] || "Não foi possível excluir. Nada foi alterado.";
};

/** Código do servidor preservado no `cause` do ApiError (corpo da resposta). */
const codigoDoServidor = (erro) => (typeof erro?.cause?.code === "string" ? erro.cause.code : null);

/** Recusa definitiva: o servidor respondeu e nada foi gravado. Qualquer outra coisa é resultado desconhecido. */
const ehRecusaDefinitiva = (codigo) =>
  !!codigo && (codigo in MENSAGENS_RECUSA || codigo === "MOVIMENTACAOMAPA_NOT_FOUND" || codigo === "REQUEST_VALIDATION_FAILED");

const novaChave = () =>
  `excluir-${typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

const estaOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/**
 * Escopo por tenant + usuário: no mesmo aparelho, a pendência de um usuário
 * nunca aparece (nem é reenviada) na sessão de outro.
 * @param {any} usuario
 */
export const escopoDoUsuario = (usuario) => `${usuario?.cliente_id ?? "-"}:${usuario?.id ?? usuario?.usuario_id ?? "-"}`;

/**
 * Operação pendente: chave + motivo gravados ANTES do envio e mantidos
 * enquanto o resultado for desconhecido — sobrevive a fechar, reabrir e
 * recarregar. Só sai com resposta definitiva do servidor.
 */
const chavePendente = (escopo, id) => `maike_exclusao_movimentacao_pendente:${escopo}:${id}`;
export const lerPendente = (escopo, id) => {
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

/** Linha de efeito vinda do servidor (o navegador não calcula saldo). */
export const descreverEfeito = (efeito) => {
  const onde = [efeito?.nome, efeito?.area_nome].filter(Boolean).join(" · ") || "Posição";
  const partes = [];
  const delta = Number(efeito?.delta_desfeito ?? 0);
  if (delta !== 0) partes.push(`${delta > 0 ? "+" : ""}${delta} cab (fica ${efeito?.quantidade_depois ?? 0})`);
  if (efeito?.peso_revertido) partes.push(`peso volta a ${efeito?.peso_depois_kg === null || efeito?.peso_depois_kg === undefined ? "desconhecido" : `${Number(efeito.peso_depois_kg).toLocaleString("pt-BR")} kg`}`);
  if (efeito?.removida) partes.push("posição criada por este registro deixa de existir");
  return `${onde}: ${partes.join(" · ") || "sem alteração de saldo"}`;
};

/** Limpa caches do TENANT + EMPRESA: cópias offline, listas do mapa e consultas. */
const limparCaches = async (queryClient, movimento) => {
  const semEste = (items) => (Array.isArray(items) ? items : []).filter((m) => m?.id !== movimento.id);
  await removerMovimentacaoExcluidaDoCacheOffline(movimento.id).catch(() => {});
  for (const chave of ["movimentacoes", "movimentacoesHistorico"]) {
    await updateMapaCachedData(chave, movimento.empresa_id, semEste).catch(() => {});
    await refreshMapaCacheEntry(chave, movimento.empresa_id, { force: true }).catch(() => {});
  }
  await refreshMapaCacheEntry("lotes", movimento.empresa_id, { force: true }).catch(() => {});
  await Promise.all(
    [
      "historico-movimentacoes",
      "historico-registros-lote",
      "historico-abate-curral",
      "mapa-cache",
      "mapa-lotes",
      "lotes",
      "posicoes-rebanho",
      "elegibilidade-exclusao-movimentacao",
    ].map((chave) => queryClient.invalidateQueries({ queryKey: [chave] }))
  );
  try {
    window.dispatchEvent(new CustomEvent("atualizar-mapa", { detail: { cacheKeys: ["lotes", "movimentacoes", "movimentacoesHistorico"] } }));
  } catch {
    /* best-effort */
  }
};

/**
 * Pré-validação no histórico (MAIKE-POS178-UX): a elegibilidade de cada card é
 * consultada ANTES do clique, mas o GET faz um ensaio transacional real no
 * servidor. Para não disparar 100 ensaios de uma vez:
 *  - só consulta o card visível (IntersectionObserver, margem de 200px);
 *  - no máximo `MAX_CONSULTAS_SIMULTANEAS` consultas em voo por página;
 *  - React Query por usuário + tenant + empresa + id (sem request duplicado);
 *  - `staleTime` evita reconsulta a cada render/foco.
 * A resposta é SÓ indicativa: o POST revalida tudo na transação.
 */
export const MAX_CONSULTAS_SIMULTANEAS = 2;
export const ELEGIBILIDADE_STALE_MS = 30_000;
/**
 * D-PROD-113 (UX-3): teto de cada consulta DENTRO do limite. Uma resposta que
 * nunca chega (corpo travado depois dos cabeçalhos, por exemplo) não pode
 * segurar uma das 2 vagas para sempre: a vaga é liberada e a consulta falha
 * fechada ("Não foi possível verificar", com "Verificar de novo").
 */
export const LIMITE_CONSULTA_MS = 30_000;
/**
 * PR181-R2: limitador com cancelamento REAL. Cada consulta recebe o `signal`
 * de um AbortController próprio, que chega ao transporte HTTP (fetch e leitura
 * do corpo). Prazo vencido ou cancelamento do React Query (card desmontado,
 * troca de escopo) chamam `abort()` de fato antes de liberar a vaga; consulta
 * cancelada ainda na fila sai da fila e nunca dispara GET. A vaga é liberada
 * exatamente uma vez (`finalizar` idempotente); resposta tardia é ignorada.
 */
const fila = { ativos: 0, espera: [] };
/**
 * Depois do `abort()`, a vaga só volta quando o transporte confirma o fim da
 * requisição abortada (o fetch rejeita) — assim nunca há mais de 2 em voo de
 * verdade. Teto de segurança para transporte que não coopere com o abort.
 */
export const GRACA_ABORT_MS = 2_000;
const proximoDaFila = () => {
  while (fila.ativos < MAX_CONSULTAS_SIMULTANEAS && fila.espera.length) fila.espera.shift().iniciar();
};
const erroCancelada = () => Object.assign(new Error("consulta cancelada"), { name: "AbortError" });
/** Só para testes: estado do limitador. */
export const __estadoLimiteConsultas = () => ({ ativos: fila.ativos, espera: fila.espera.length });
/**
 * @param {(signal: AbortSignal) => Promise<any>} fn recebe o signal do TRANSPORTE
 * @param {AbortSignal} [signal] cancelamento vindo de fora (React Query)
 */
export const comLimiteDeConsultas = (fn, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(erroCancelada());
      return;
    }
    const controle = new AbortController();
    let ocupando = false;
    let respondido = false;
    let teto = null;
    let graca = null;
    // Libera a vaga EXATAMENTE uma vez; a redistribuição vai para microtask para que
    // um fechamento (vários cancelamentos no mesmo tick) não inicie quem também será cancelado.
    const liberarVaga = () => {
      if (!ocupando) return;
      ocupando = false;
      clearTimeout(graca);
      fila.ativos -= 1;
      queueMicrotask(proximoDaFila);
    };
    // Responde a quem chamou EXATAMENTE uma vez (resposta tardia é ignorada).
    const responder = (ok, valor) => {
      if (respondido) return;
      respondido = true;
      clearTimeout(teto);
      signal?.removeEventListener("abort", aoCancelar);
      if (ok) resolve(valor);
      else reject(valor);
    };
    /** Aborta o transporte, falha fechado já, e devolve a vaga quando o transporte terminar (ou no teto). */
    const abortarAtiva = (erro) => {
      controle.abort();
      responder(false, erro);
      if (ocupando) graca = setTimeout(liberarVaga, GRACA_ABORT_MS);
    };
    const item = {
      iniciar: () => {
        if (respondido) return;
        if (signal?.aborted) {
          aoCancelar();
          return;
        }
        fila.ativos += 1;
        ocupando = true;
        teto = setTimeout(() => abortarAtiva(new Error("tempo esgotado na conferência da exclusão")), LIMITE_CONSULTA_MS);
        Promise.resolve()
          .then(() => fn(controle.signal))
          .then((v) => responder(true, v), (e) => responder(false, e))
          .finally(liberarVaga);
      },
    };
    function aoCancelar() {
      const i = fila.espera.indexOf(item);
      if (i >= 0) {
        fila.espera.splice(i, 1);
        responder(false, erroCancelada());
        return;
      }
      abortarAtiva(erroCancelada());
    }
    signal?.addEventListener("abort", aoCancelar, { once: true });
    fila.espera.push(item);
    proximoDaFila();
  });

/** Card dentro (ou perto) da área visível? Sem IntersectionObserver: considera visível (o limite global segue valendo). */
const useVisivel = (el) => {
  const [visivel, setVisivel] = React.useState(typeof IntersectionObserver === "undefined");
  React.useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) setVisivel(e.isIntersecting);
    }, { rootMargin: "200px 0px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [el]);
  return visivel;
};

/** Texto curto do bloqueio para o card (data, área, tipo quando o servidor manda). */
export const motivoCurtoDoBloqueio = (e) => {
  if (!e || e.elegivel) return null;
  const d = e.detalhes && typeof e.detalhes === "object" ? e.detalhes : null;
  const dependente = ["CANCELAMENTO_SALDO_HISTORICO_NEGATIVO", "REBANHO_DEPENDENCIA_FATO_SEM_SALDO", "REBANHO_PESO_DEPENDENCIA_CAUSAL"].includes(e.codigo);
  const base = dependente
    ? "Existe pesagem/manejo posterior dependente; exclua o lançamento dependente primeiro."
    : (e.codigo && e.codigo in MENSAGENS_RECUSA ? mensagemDeRecusa(e.codigo, d) : e.motivo) || "Exclusão indisponível.";
  if (!dependente) return base;
  const extra = [
    d?.tipo ? String(d.tipo).toLowerCase() : null,
    d?.data ? `em ${diaBR(d.data)}` : null,
    d?.area_nome ? `(${d.area_nome})` : null,
  ].filter(Boolean).join(" ");
  return extra ? `${base} Bloqueador: ${extra}.` : base;
};

/**
 * @param {{ movimento: any, onExcluido?: () => void }} props
 */
export default function ExcluirMovimentacao({ movimento, onExcluido }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [confirmado, setConfirmado] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [desconhecido, setDesconhecido] = React.useState(false);
  const [recusa, setRecusa] = React.useState(null);
  const [online, setOnline] = React.useState(estaOnline());
  const chaveRef = React.useRef(null);

  React.useEffect(() => {
    const atualizar = () => setOnline(estaOnline());
    window.addEventListener("online", atualizar);
    window.addEventListener("offline", atualizar);
    return () => {
      window.removeEventListener("online", atualizar);
      window.removeEventListener("offline", atualizar);
    };
  }, []);

  const { data: usuario } = useQuery({ queryKey: ["usuario-atual-exclusao"], queryFn: () => getCurrentUser(), staleTime: 60_000 });
  const admin = ehAdministrador(usuario);
  const escopo = escopoDoUsuario(usuario);

  const [cardEl, setCardEl] = React.useState(null);
  const visivel = useVisivel(cardEl);
  const suportado = !!movimento && tipoTemExclusao(movimento);
  // Escopo da resposta: usuário + tenant + empresa + movimento (nunca reaproveita outro escopo).
  const elegibilidade = useQuery({
    queryKey: ["elegibilidade-exclusao-movimentacao", usuario?.cliente_id ?? null, usuario?.id ?? null, movimento?.empresa_id ?? null, movimento?.id],
    // O `signal` do React Query cancela a consulta ainda na fila quando o card some (UX-2).
    // PR181-R2: o signal do TRANSPORTE desce até o fetch (prazo e desmontagem abortam o GET de verdade).
    queryFn: ({ signal }) => comLimiteDeConsultas((sinal) => consultarExclusaoMovimentacao(movimento.id, { signal: sinal }), signal),
    enabled: suportado && admin && !!usuario && online && (visivel || aberto),
    staleTime: ELEGIBILIDADE_STALE_MS,
    // Reabrir o histórico confere de novo (um manejo feito com ele fechado não deixa verde velho).
    refetchOnMount: "always",
    retry: false,
  });
  // Operação legada na fila offline para este registro: falha fechada.
  const pendencias = useQuery({
    queryKey: ["pendencias-offline-movimentacao", usuario?.cliente_id ?? null, movimento?.id],
    // Formato inesperado vira ERRO (fail-closed), nunca "fila vazia".
    queryFn: async () => {
      const lidas = await pendenciasOfflineDaMovimentacao(movimento.id);
      if (!Array.isArray(lidas)) throw new Error("formato inesperado da fila offline");
      return lidas;
    },
    enabled: suportado && admin && !!usuario && (visivel || aberto),
    staleTime: ELEGIBILIDADE_STALE_MS,
    retry: false,
  });

  // D-PROD-113 (UX-1): a fila offline mudou (enfileirou, sincronizou, descartou) →
  // relê as pendências deste registro. Sem isso, um card bloqueado por pendência
  // ficava bloqueado depois da sincronização até remontar.
  const chavePendencias = pendencias.refetch;
  React.useEffect(() => {
    if (!suportado || !admin) return undefined;
    const nome = eventoMudancaFilaOffline();
    const reler = () => { chavePendencias(); };
    window.addEventListener(nome, reler);
    return () => window.removeEventListener(nome, reler);
  }, [suportado, admin, chavePendencias]);

  if (!suportado) return null;
  // Só o administrador ativo vê a ação (o servidor reautoriza no POST).
  if (!admin) return null;

  const abrir = () => {
    const pendente = lerPendente(escopo, movimento.id);
    if (pendente) {
      // Resultado anterior desconhecido: mesma chave e mesmo motivo, nunca outra operação.
      chaveRef.current = pendente.operation_id;
      setMotivo(pendente.motivo);
      setConfirmado(true);
      setDesconhecido(true);
    } else {
      chaveRef.current = novaChave();
      setMotivo("");
      setConfirmado(false);
      setDesconhecido(false);
    }
    setRecusa(null);
    setAberto(true);
    // Revalida imediatamente antes de permitir confirmar (a do card pode estar velha).
    elegibilidade.refetch();
    pendencias.refetch();
  };

  const fechar = (valor) => {
    if (!valor && enviando) return;
    if (!valor && desconhecido) {
      const ok = window.confirm(
        "O servidor ainda não confirmou esta exclusão. A operação fica guardada e será reenviada com a mesma chave quando você abrir de novo. Fechar mesmo assim?"
      );
      if (!ok) return;
      queryClient.invalidateQueries({ queryKey: ["historico-movimentacoes"] });
    }
    setAberto(valor);
  };

  /*
   * FAIL-CLOSED (PR180-R2): a fila offline só conta como "vazia" quando a
   * leitura TERMINOU com sucesso e devolveu explicitamente um array vazio.
   * Ainda não respondeu, falhou, está relendo ou veio em formato inesperado
   * (undefined/null/objeto) nunca vira "[]": o card fica em verificação ou
   * erro, e nada habilita a exclusão.
   */
  const filaComFormato = pendencias.isSuccess && Array.isArray(pendencias.data);
  const pendenciasNaFila = filaComFormato ? pendencias.data : [];
  const filaFalhou = pendencias.isError || (pendencias.isSuccess && !Array.isArray(pendencias.data));
  const filaVaziaConfirmada = filaComFormato && !pendencias.isFetching && pendencias.data.length === 0;

  /** @type {{elegivel?: boolean, pode_excluir?: boolean, codigo?: string|null, motivo?: string|null, detalhes?: any, efeitos?: any[]} | undefined} */
  const e = /** @type {any} */ (elegibilidade.data);
  const motivoPronto = motivo.trim().length >= 3;
  // Elegibilidade FRESCA: resposta do servidor sem releitura em voo e sem erro (nunca a verde antiga).
  const elegivelAgora = elegibilidade.isSuccess && e?.elegivel === true && e?.pode_excluir === true && !elegibilidade.isFetching && !elegibilidade.isError;
  // Mesmas pré-condições no botão e no guard de `confirmar` (não confiar só em `disabled`).
  // Resultado desconhecido (`desconhecido`) reenvia a MESMA operação mesmo que o GET
  // dê 404 (já excluída), mas nunca sem a fila confirmada vazia.
  const podeEnviar = motivoPronto && confirmado && !enviando && online && filaVaziaConfirmada && (elegivelAgora || desconhecido);

  const confirmar = async () => {
    if (!podeEnviar) return;
    setEnviando(true);
    setRecusa(null);
    gravarPendente(escopo, movimento.id, { operation_id: chaveRef.current, motivo: motivo.trim() });
    try {
      await excluirMovimentacaoMapa(movimento.id, { operation_id: chaveRef.current, motivo: motivo.trim() });
      limparPendente(escopo, movimento.id);
      toast.success("Movimentação excluída.");
      setDesconhecido(false);
      setAberto(false);
      await limparCaches(queryClient, movimento);
      onExcluido?.();
    } catch (erro) {
      const codigo = codigoDoServidor(erro);
      if (codigo === "EXCLUSAO_JA_REALIZADA" || codigo === "MOVIMENTACAOMAPA_NOT_FOUND") {
        // Já não existe no servidor: tira das telas e dos caches (sem ressurreição).
        limparPendente(escopo, movimento.id);
        setDesconhecido(false);
        setAberto(false);
        toast.success("Esta movimentação já não existe.");
        await limparCaches(queryClient, movimento);
        onExcluido?.();
      } else if (ehRecusaDefinitiva(codigo)) {
        // Resposta estável do servidor: nada foi gravado; a próxima tentativa é outra operação.
        limparPendente(escopo, movimento.id);
        setRecusa(mensagemDeRecusa(codigo, /** @type {any} */ (erro)?.details ?? /** @type {any} */ (erro)?.cause?.details));
        setDesconhecido(false);
        chaveRef.current = novaChave();
        // O estado mudou entre o GET e o POST (409): o card e o diálogo reconsultam.
        elegibilidade.refetch();
      } else {
        setDesconhecido(true);
      }
    } finally {
      setEnviando(false);
    }
  };


  /**
   * Estado do card ANTES do clique. Só "elegível" habilita a ação; todo o
   * resto é um controle desabilitado com o motivo visível no próprio card.
   * @type {{rotulo: string, habilitado: boolean, motivo: string|null, tentarDeNovo?: boolean, destrutivo?: boolean}}
   */
  const estado = (() => {
    if (!online) return { rotulo: "Exclusão indisponível", habilitado: false, motivo: "Sem conexão: a exclusão só é feita online e não entra na fila offline." };
    if (pendenciasNaFila.length) return { rotulo: "Exclusão bloqueada", habilitado: false, motivo: "Há operação offline ainda não sincronizada para este registro. Sincronize antes de excluir." };
    if (filaFalhou) return { rotulo: "Não foi possível verificar", habilitado: false, motivo: "Não foi possível ler a fila offline deste aparelho. Nada foi alterado.", tentarDeNovo: true };
    if (!filaVaziaConfirmada) return { rotulo: "Verificando exclusão…", habilitado: false, motivo: null };
    // Resultado anterior desconhecido: reabrir reenvia a MESMA operação (a fila já foi conferida acima).
    if (lerPendente(escopo, movimento.id)) return { rotulo: "Excluir movimentação", habilitado: true, motivo: "Exclusão anterior sem confirmação do servidor: abra para reenviar a mesma operação.", destrutivo: true };
    if (elegibilidade.isError) return { rotulo: "Não foi possível verificar", habilitado: false, motivo: "A conferência no servidor falhou. Nada foi alterado.", tentarDeNovo: true };
    // Releitura em voo: nunca expor a resposta antiga (potencialmente verde).
    if (!e || !elegibilidade.isSuccess || elegibilidade.isFetching) return { rotulo: "Verificando exclusão…", habilitado: false, motivo: null };
    if (!e.elegivel) return { rotulo: "Exclusão bloqueada", habilitado: false, motivo: motivoCurtoDoBloqueio(e) };
    if (e.pode_excluir !== true) return { rotulo: "Exclusão bloqueada", habilitado: false, motivo: MENSAGENS_RECUSA.TENANT_ADMIN_REQUIRED };
    return { rotulo: "Excluir movimentação", habilitado: true, motivo: null, destrutivo: true };
  })();
  const idMotivo = `motivo-bloqueio-${movimento.id}`;

  return (
    <div ref={setCardEl} className="flex flex-col items-start gap-1" data-estado-exclusao={estado.habilitado ? "elegivel" : estado.rotulo}>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`h-8 text-xs ${estado.destrutivo && estado.habilitado ? "text-red-700" : "text-slate-500"}`}
          disabled={!estado.habilitado}
          aria-describedby={estado.motivo ? idMotivo : undefined}
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (estado.habilitado) abrir();
          }}
        >
          {estado.rotulo}
        </Button>
        {estado.tentarDeNovo && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-slate-600"
            onClick={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              // Refaz só o que falhou (nunca exclui).
              if (filaFalhou) pendencias.refetch();
              if (elegibilidade.isError || !filaFalhou) elegibilidade.refetch();
            }}
          >
            Verificar de novo
          </Button>
        )}
      </div>
      {estado.motivo && (
        <p id={idMotivo} className="max-w-full text-[11px] leading-snug text-slate-600">
          {estado.motivo}
        </p>
      )}
      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir movimentação</DialogTitle>
            <DialogDescription>
              {movimento.tipo} · {movimento.lote || "Sem lote"}
              {movimento.quantidade_animais ? ` · ${movimento.quantidade_animais} cab` : ""}
              {movimento.data_movimentacao ? ` · ${diaBR(movimento.data_movimentacao)}` : ""}. A exclusão é definitiva: o registro sai do histórico e os saldos voltam ao que eram. Para corrigir, lance depois a operação certa.
            </DialogDescription>
          </DialogHeader>

          {!online && (
            <div role="alert" className="text-sm text-amber-800">Sem conexão. A exclusão só é feita online e não entra na fila offline.</div>
          )}
          {pendenciasNaFila.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              Há operação offline ainda não sincronizada para este registro. Sincronize antes de excluir.
            </div>
          )}
          {filaFalhou && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
              Não foi possível ler a fila offline deste aparelho. A exclusão fica bloqueada até a leitura dar certo. Nada foi alterado.
            </div>
          )}
          {online && (elegibilidade.isFetching || pendencias.isFetching) && <div role="status" className="text-sm text-slate-500">Conferindo no servidor...</div>}
          {elegibilidade.isError && (
            <div role="alert" className="text-sm text-red-700">Não foi possível conferir agora. Tente novamente.</div>
          )}
          {e && !e.elegivel && !desconhecido && (
            <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              {(e.codigo && e.codigo in MENSAGENS_RECUSA ? mensagemDeRecusa(e.codigo, e.detalhes) : null) || e.motivo || "Exclusão indisponível."}
            </div>
          )}
          {(e?.elegivel || desconhecido) && (
            <div className="space-y-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-700">
                <div className="font-semibold">Efeito ao excluir</div>
                {(e?.efeitos || []).map((efeito) => (
                  <div key={efeito.posicao_id}>{descreverEfeito(efeito)}</div>
                ))}
              </div>
              <label className="block text-xs font-medium text-slate-700" htmlFor={`motivo-exclusao-${movimento.id}`}>
                Motivo da exclusão
              </label>
              <Textarea
                id={`motivo-exclusao-${movimento.id}`}
                value={motivo}
                disabled={enviando || desconhecido}
                onChange={(ev) => setMotivo(ev.target.value)}
                maxLength={500}
                className="text-sm"
              />
              <label className="flex items-start gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={confirmado}
                  disabled={enviando || desconhecido}
                  onChange={(ev) => setConfirmado(ev.target.checked)}
                  className="mt-0.5"
                />
                Entendo que a exclusão é definitiva e não pode ser desfeita.
              </label>
              {desconhecido && (
                <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  Sem confirmação do servidor. A exclusão pode ou não ter sido concluída. Reenvie: a MESMA operação é repetida e nunca é aplicada duas vezes.
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
                <Button type="button" variant="destructive" size="sm" disabled={!podeEnviar} onClick={confirmar}>
                  {enviando ? "Excluindo..." : desconhecido ? "Tentar de novo" : "Excluir definitivamente"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { Check, CircleX, ClipboardList, FileText, History, MapPin, MessageSquare, MessageSquarePlus, Plus, Repeat, SquarePen, Trash2 } from "lucide-react";
import { atualizarTarefa, enviarAnexo, excluirTarefa } from "@/services/tarefasMapaService";
import { confirmarExclusao } from "@/lib/maikeConfirmar";
import { excluirFotoGuardada, guardarFotosDaTarefa } from "@/services/fotosDeTarefaAguardandoService";
import useFotosGuardadasDaTarefa from "@/hooks/useFotosGuardadasDaTarefa";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { toast } from "sonner";
import { formatarDia } from "@/lib/diaCivil";
import { useDiaCivil } from "@/hooks/useDiaCivil";
import { usePodeExcluirEventoTarefa } from "@/hooks/usePodeExcluirEventoTarefa";
import { LancLoteDialogo, LancLoteForm, LancLoteRodape, LancLoteSegmento, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";
import CascaDetalhe from "@/components/mapa/detalhes-lote/CascaDetalhe";
import LinhaDoTempo from "@/components/mapa/detalhes-lote/LinhaDoTempo";
import { Cartao, Celula, Chip, Grade, Linha, Nota, RodapePilulas, TituloBloco, Vazio } from "@/components/mapa/detalhes-lote/blocos";
import { VAZIO, rotuloDoDia } from "@/components/mapa/detalhes-lote/historicoDoPasto";
import { TONS } from "@/components/mapa/detalhes-lote/catalogo";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";
import HistoricoTarefaPanel from "./HistoricoTarefaPanel";
// Sem uso (o stub devolve null), como antes: a importação só mantém o arquivo
// alcançável (`gate:source-closure`) até ele sair junto com esta linha.
import TarefaResumoVisual from "./TarefaResumoVisual";
import FotosTarefaGaleria from "@/components/tarefas/FotosTarefaGaleria";
import "@/styles/mk-dp-tarefa.css";

/*
 * Detalhe da TAREFA aberto pelo mapa no desenho do Detalhes do Lote v12
 * (D-PROD-220, tela `telaTarefa`): a casca de uma tela (`CascaDetalhe`)
 * publica o título (a tarefa) e o sub "Detalhes da tarefa" no cabeçalho do
 * diálogo — no lugar do `setTitulo("Tarefa: …")` da D-PROD-118 — e o corpo
 * segue a ordem do v12:
 *   cartão da tarefa (tipo base · local, chip do status)
 *   › Informações da tarefa (grade; o que o MAIKE tem a mais entra no fim:
 *     Tipo base quando difere do tipo de tarefa, Coordenadas)
 *   › Descrição (descrição, Observações, Obs. conclusão)
 *   › Fotos (a galeria de hoje, só com foto)
 *   › Últimos eventos (linha do tempo; "Ver histórico" abre o histórico completo)
 *   › rodapé Editar · Registrar evento · Concluir.
 * Concluir abre o MESMO "Registrar evento" já em "Concluída" (não conclui
 * direto). Os diálogos (Editar tarefa, Registrar evento, Histórico da tarefa),
 * as mutações, as invalidações e os tipos de evento permitidos (D-PROD-118)
 * são os de antes; os diálogos são irmãos da casca porque vão por portal.
 * D-PROD-266 (etapa 1): o "Excluir" do evento no "Ver histórico" só aparece
 * para quem o servidor deixa excluir (administrador real ou `is_admin`,
 * `usePodeExcluirEventoTarefa`), seja o detalhe aberto pelo mapa ou pela
 * Gestão de Tarefas.
 */

/** Últimos eventos no corpo; o histórico inteiro fica no "Ver histórico". */
const ULTIMOS_EVENTOS = 5;

/** Chip do status com as cores do v12 (`.v11-chip--t0…t3`), em mk-dp-tarefa.css. */
const CLASSE_DO_STATUS = {
  Pendente: "mk-dp-tarefa__status--pendente",
  "Em Andamento": "mk-dp-tarefa__status--andamento",
  Concluída: "mk-dp-tarefa__status--concluida",
  Cancelada: "mk-dp-tarefa__status--cancelada",
};

/**
 * Bolinha da prioridade (v12 `COR_PRIORIDADE`). A chave é a prioridade de
 * `normalizeTaskPriority`, que hoje junta "Urgente" com "Alta".
 */
const COR_PRIORIDADE = { Urgente: "#dc2626", Alta: "#f59e0b", Média: "#0ea5e9", Baixa: "#64748b" };

/** Prazo vencido de tarefa em aberto (v12: o valor do Prazo em vermelho). */
// O vermelho de atraso do v12 (COR_INVESTIGAR), o mesmo da pesagem atrasada do Detalhes do Lote.
const COR_PRAZO_VENCIDO = TONS.investigar.texto;

/** Ícone de cada evento do histórico (os nomes que o servidor aceita); outro nome: relógio. */
const ICONE_DO_EVENTO = {
  Criação: Plus,
  Edição: SquarePen,
  "Mudança de Local": MapPin,
  "Mudança de Status": Repeat,
  Registro: FileText,
  Conclusão: Check,
  Cancelamento: CircleX,
  Comentário: MessageSquare,
};

const getDateTimeLocal = (value) => {
  if (!value) return new Date().toISOString().slice(0, 16);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
/** @param {number} n */
const doisDigitos = (n) => String(n).padStart(2, "0");

/**
 * Dia (AAAA-MM-DD) de uma data da tarefa. Os campos de DIA (`data_pedido`,
 * `data_prevista`, `data_conclusao`) já chegam como "AAAA-MM-DD" e ficam como
 * estão — `new Date("2026-11-10")` é meia-noite em UTC e virava 09/11 no fuso
 * do Brasil. Os INSTANTES (`data_inicio`, `data_evento`, `created_date`) viram
 * o dia no relógio do aparelho, como antes.
 * @param {unknown} valor
 * @returns {string | null}
 */
function diaDe(valor) {
  if (valor == null || valor === "") return null;
  if (typeof valor === "string" && RE_DIA.test(valor.trim())) return valor.trim();
  const d = new Date(/** @type {string | number | Date} */ (valor));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

/**
 * "10/11/2026"; sem data, "—"; texto que não é data aparece como veio (como antes).
 * @param {unknown} valor
 */
function dataBR(valor) {
  const dia = diaDe(valor);
  if (dia) return formatarDia(dia);
  return typeof valor === "string" && valor.trim() ? valor : VAZIO;
}

/** Instante de um evento para ordenar (sem data: o mais antigo). @param {any} item */
const instanteDoEvento = (item) => new Date(item?.data_evento || item?.created_date || 0).getTime() || 0;

/**
 * Eventos desta tarefa, o mais recente primeiro (mesma regra de antes).
 * @param {any} lista
 * @param {string} tarefaId
 * @returns {any[]}
 */
const eventosDaTarefa = (lista, tarefaId) =>
  (Array.isArray(lista) ? lista : []).filter((item) => item.tarefa_id === tarefaId).sort((a, b) => instanteDoEvento(b) - instanteDoEvento(a));

/**
 * Linha do tempo do v12 com os eventos dados (já em ordem): um grupo por dia
 * ("12 NOV. 2026"), um cartão por evento com ícone, nome e a linha "Detalhe".
 * @param {any[]} eventos
 */
function diasDosEventos(eventos) {
  /** @type {Array<{ chave: string, rotulo: string, cartoes: Array<{ chave: string, Icone: import("lucide-react").LucideIcon, titulo: string, linhas: Array<{ rotulo: string, valor: string }> }> }>} */
  const dias = [];
  eventos.forEach((item, i) => {
    const dia = diaDe(item?.data_evento || item?.created_date);
    const chave = dia || "sem-data";
    let grupo = dias[dias.length - 1];
    if (!grupo || grupo.chave !== chave) {
      grupo = { chave, rotulo: rotuloDoDia(dia), cartoes: [] };
      dias.push(grupo);
    }
    grupo.cartoes.push({
      chave: String(item?.id ?? `evento-${i}`),
      Icone: ICONE_DO_EVENTO[item?.evento] || History,
      titulo: item?.evento || "Evento",
      linhas: [{ rotulo: "Detalhe", valor: item?.descricao || VAZIO }],
    });
  });
  return dias;
}

/** @param {unknown} v */
const textoLimpo = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
/** @param {string} v */
const comparavel = (v) => v.toLocaleLowerCase("pt-BR");
/** @param {unknown} v */
const coordenada = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(6) : String(v));

/**
 * @param {{
 *   tarefa: any,
 *   onClose?: () => void,
 *   onSaved?: (tarefa: any) => void,
 *   onRequestSelectLocation?: any,
 *   hoje?: string | null,
 * }} props
 *   `onClose`: aceito por compatibilidade (a tela não se fecha sozinha).
 *   `hoje`: dia civil da fazenda (AAAA-MM-DD), o mesmo do mapa, para o prazo
 *   vencido; sem ele, o dia do relógio do aparelho.
 */
/**
 * D-PROD-321: `onExcluida` — a tarefa foi excluída aqui (o "Excluir" saiu da grade antiga para os detalhes).
 */
export default function DetalhesTarefaMapa({ tarefa, onSaved, onRequestSelectLocation, hoje = null, onExcluida = null, onVoltar = null, anim = null }) {
  const queryClient = useQueryClient();
  const [currentTarefa, setCurrentTarefa] = useState(tarefa);
  const diaDoAparelho = useDiaCivil(null);
  const podeExcluirEvento = usePodeExcluirEventoTarefa();
  const [showEdit, setShowEdit] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  // D-PROD-324: fotos desta tarefa tiradas sem internet, guardadas no aparelho esperando a internet: aparecem na
  // galeria (abrem em tela cheia) e podem ser excluídas antes de subir.
  const fotosGuardadas = useFotosGuardadasDaTarefa(tarefa?.id);
  const excluirGuardada = async (chave) => {
    const ok = await confirmarExclusao("Excluir esta foto? Ela ainda não foi enviada e sai do celular.");
    if (ok) await excluirFotoGuardada(chave);
  };
  const [showEvento, setShowEvento] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [eventoTipo, setEventoTipo] = useState(tarefa.status === "Em Andamento" ? "Registro" : "Em Andamento");
  const [eventoData, setEventoData] = useState(getDateTimeLocal());
  const [eventoDescricao, setEventoDescricao] = useState("");

  useEffect(() => {
    setCurrentTarefa(tarefa);
  }, [tarefa]);

  const { data: historico = [], isLoading: loadingHistorico, isError: erroHistorico, error: causaErroHistorico, refetch: refetchHistorico } = useQuery({
    queryKey: ["historico-tarefa-detalhe", currentTarefa.id],
    queryFn: async () => {
      const cached = await getMapaCachedData('historicoTarefa', currentTarefa.empresa_id);

      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('historicoTarefa', currentTarefa.empresa_id).then(fresh => {
            if (fresh?.length) {
              queryClient.setQueryData(["historico-tarefa-detalhe", currentTarefa.id], eventosDaTarefa(fresh, currentTarefa.id));
            }
          });
          return eventosDaTarefa(cached, currentTarefa.id);
        } else {
          const fresh = await refreshMapaCacheEntry('historicoTarefa', currentTarefa.empresa_id);
          return eventosDaTarefa(fresh, currentTarefa.id);
        }
      }

      return eventosDaTarefa(cached, currentTarefa.id);
    },
    // Sem initialData: com ele o React Query tratava a lista vazia como dado
    // novo e não buscava ao montar (staleTime), e os "Últimos eventos" abriam
    // vazios na primeira vez — a mesma correção da Gestão de Tarefas
    // (D-PROD-217). O padrão `= []` cobre o carregamento.
    staleTime: 60 * 1000
  });

  const prioridade = normalizeTaskPriority(currentTarefa?.prioridade);
  const podeRegistrar = currentTarefa.status === "Em Andamento";
  const podeEntrarEmAndamento = !currentTarefa.data_inicio && currentTarefa.status === "Pendente";
  const podeConcluir = currentTarefa.status !== "Concluída" && currentTarefa.status !== "Cancelada";
  const podeCancelar = currentTarefa.status !== "Cancelada" && currentTarefa.status !== "Concluída";
  const opcoesEvento = [
    podeRegistrar && { value: "Registro", label: "Registro" },
    podeEntrarEmAndamento && { value: "Em Andamento", label: "Em andamento" },
    podeCancelar && { value: "Cancelada", label: "Cancelada" },
    podeConcluir && { value: "Concluída", label: "Concluída" },
  ].filter(Boolean);
  // D-PROD-118: o tipo escolhido precisa estar entre os permitidos (antes podia
  // abrir em "Em Andamento" numa tarefa que já tinha início, e gravar assim).
  const tipoEventoValido = opcoesEvento.some((o) => o.value === eventoTipo) ? eventoTipo : opcoesEvento[0]?.value || "";
  useEffect(() => {
    if (tipoEventoValido !== eventoTipo) setEventoTipo(tipoEventoValido);
  }, [tipoEventoValido, eventoTipo]);

  /**
   * Abre o "Registrar evento" limpo (data de agora, sem descrição) no tipo
   * pedido — o Concluir pede "Concluída" — ou no padrão de antes: "Registro"
   * com a tarefa em andamento, senão "Em Andamento". O tipo continua passando
   * por `tipoEventoValido`.
   * @param {string} [tipo]
   */
  const abrirEvento = (tipo) => {
    setEventoTipo(tipo || (currentTarefa.status === "Em Andamento" ? "Registro" : "Em Andamento"));
    setEventoData(getDateTimeLocal());
    setEventoDescricao("");
    setShowEvento(true);
  };

  const updateMutation = useMutation({
    /** @param {{ id: string, data: any, pendingImageFiles?: File[] }} variaveis */
    mutationFn: async ({ id, data, pendingImageFiles = [] }) => {
      // D-PROD-324: sem internet a alteração vai para a fila e as fotos novas ficam guardadas no aparelho (sobem
      // sozinhas quando a internet voltar).
      const guardar = pendingImageFiles.length > 0 && typeof navigator !== "undefined" && navigator.onLine === false;
      // Upload de novas imagens antes de salvar
      const uploadedUrls = [];
      for (const file of guardar ? [] : pendingImageFiles) {
        const { file_url } = await enviarAnexo({ file });
        uploadedUrls.push(file_url);
      }
      const finalData = uploadedUrls.length > 0
        ? { ...data, fotos: [...(data.fotos || []), ...uploadedUrls] }
        : data;
      const mudouLocal = data.coordenadas?.lat !== currentTarefa?.coordenadas?.lat || data.coordenadas?.lng !== currentTarefa?.coordenadas?.lng;
      const mudouStatus = data.status && data.status !== currentTarefa?.status;
      const evento = mudouLocal ?
      "Mudança de Local" :
      finalData.status === "Concluída" && mudouStatus ?
      "Conclusão" :
      finalData.status === "Cancelada" && mudouStatus ?
      "Cancelamento" :
      mudouStatus ?
      "Mudança de Status" :
      "Edição";
      const descricao = mudouLocal ?
      "Local da tarefa alterado no mapa." :
      finalData.status === "Concluída" && mudouStatus ?
      "Tarefa concluída pelo mapa." :
      finalData.status === "Cancelada" && mudouStatus ?
      "Tarefa cancelada pelo mapa." :
      mudouStatus ?
      `Status alterado para ${finalData.status}.` :
      "Tarefa editada.";
      const atualizada = await atualizarTarefa(id, {
        ...finalData,
        historico_evento: evento,
        historico_descricao: descricao,
        historico_data_evento: new Date().toISOString(),
      });
      if (guardar) await guardarFotosDaTarefa(id, pendingImageFiles);
      return atualizada;
    },
    onSuccess: (updated) => {
      // Otimista no mapa e nas listas
      const empresaId = updated?.empresa_id || currentTarefa?.empresa_id;
      if (empresaId) {
        queryClient.setQueryData(["mapa-tarefas", empresaId], (/** @type {any[] | undefined} */ old = []) => (old || []).map((t) => t.id === updated.id ? updated : t));
      }
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", updated.id] });
      setCurrentTarefa(updated);
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Tarefa atualizada.");
      setShowEdit(false);
      onSaved?.(updated);
    },
    onError: (err) => {
      toast.error(`Erro ao salvar: ${err?.message || 'Tente novamente'}`);
    }
  });

  const eventoMutation = useMutation({
    mutationFn: async () => {
      const dataEventoIso = new Date(eventoData).toISOString();
      let registroAtualizado = currentTarefa;

      if (eventoTipo === "Registro") {
        if (currentTarefa.status !== "Em Andamento") {
          toast.error("Registro só pode ser lançado depois que a tarefa estiver em andamento.");
          return currentTarefa;
        }
        registroAtualizado = await atualizarTarefa(currentTarefa.id, {
          historico_evento: "Registro",
          historico_descricao: eventoDescricao || "Registro manual da tarefa.",
          historico_data_evento: dataEventoIso,
        });
      } else {
        const novoStatus = eventoTipo;
        const payload = {
          status: novoStatus,
          data_inicio: novoStatus === "Em Andamento" ? dataEventoIso : currentTarefa.data_inicio,
          data_conclusao: novoStatus === "Concluída" ? dataEventoIso.split("T")[0] : currentTarefa.data_conclusao,
          observacoes_conclusao: eventoDescricao || currentTarefa.observacoes_conclusao || ""
        };
        const evento = novoStatus === "Concluída" ? "Conclusão" : novoStatus === "Cancelada" ? "Cancelamento" : "Mudança de Status";
        registroAtualizado = await atualizarTarefa(currentTarefa.id, {
          ...payload,
          historico_evento: evento,
          historico_descricao: eventoDescricao || `Status alterado para ${novoStatus}.`,
          historico_data_evento: dataEventoIso,
        });
      }

      return registroAtualizado;
    },
    onSuccess: (updated) => {
      const empresaId = updated?.empresa_id || currentTarefa?.empresa_id;
      if (empresaId) {
        queryClient.setQueryData(["mapa-tarefas", empresaId], (/** @type {any[] | undefined} */ old = []) => (old || []).map((t) => t.id === updated.id ? updated : t));
      }
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", updated.id] });
      setCurrentTarefa(updated);
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Evento registrado.");
      setShowEvento(false);
      setEventoDescricao("");
      onSaved?.(updated);
    }
  });

  // ── O que a tela mostra (só apresentação; os dados são os mesmos de antes) ──
  const titulo = textoLimpo(currentTarefa.titulo);
  const status = textoLimpo(currentTarefa.status);
  const encerrada = status === "Concluída" || status === "Cancelada";
  const tipoDaTarefa = textoLimpo(currentTarefa.tipo_tarefa_nome) || textoLimpo(currentTarefa.tipo);
  const tipoBase = textoLimpo(currentTarefa.tipo);
  const mostrarTipoBase = Boolean(tipoBase) && comparavel(tipoBase) !== comparavel(tipoDaTarefa);
  const local = textoLimpo(currentTarefa.area_nome) || textoLimpo(currentTarefa.lote_nome);
  const areaLocal = [local, textoLimpo(currentTarefa.setor_nome)].filter(Boolean).join(" · ") || VAZIO;
  const solicitante = textoLimpo(currentTarefa.solicitante) || textoLimpo(currentTarefa.responsavel_geral);
  const responsavel = textoLimpo(currentTarefa.responsavel);
  const solicitanteResponsavel = solicitante || responsavel ? `${solicitante || VAZIO} / ${responsavel || VAZIO}` : VAZIO;
  // Vencido = o dia do prazo já passou (vencer hoje ainda não é atraso).
  const diaDoPrazo = diaDe(currentTarefa.data_prevista);
  const prazoVencido = Boolean(diaDoPrazo) && !encerrada && diaDoPrazo < (hoje || diaDoAparelho);
  const coord = currentTarefa.coordenadas;
  const coordenadas = coord && coord.lat != null && coord.lng != null ? `${coordenada(coord.lat)}, ${coordenada(coord.lng)}` : "";
  const descricao = textoLimpo(currentTarefa.descricao);
  const observacoes = textoLimpo(currentTarefa.observacoes);
  const obsConclusao = textoLimpo(currentTarefa.observacoes_conclusao);
  // Mesma conta da galeria (`fotos` + o legado `anexos_urls`): sem foto ela não desenha nada.
  const temFotos = [...(currentTarefa.fotos || []), ...(currentTarefa.anexos_urls || [])].filter(Boolean).length > 0;
  const ultimosDias = diasDosEventos(historico.slice(0, ULTIMOS_EVENTOS));

  const motivoEncerrada = status === "Concluída" ? "A tarefa já está concluída." : "A tarefa está cancelada.";
  // D-PROD-321: excluir a tarefa (antes, só pela grade antiga da Gestão de Tarefas).
  const excluir = async () => {
    if (excluindo) return;
    const ok = await confirmarExclusao(`Excluir a tarefa "${titulo || "Tarefa"}"? O histórico dela também sai.`);
    if (!ok) return;
    setExcluindo(true);
    try {
      await excluirTarefa(currentTarefa.id);
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Tarefa excluída.");
      onExcluida?.(currentTarefa);
    } catch (erro) {
      toast.error(`Erro ao excluir: ${getApiErrorMessage(erro, "Tente novamente")}`);
    } finally {
      setExcluindo(false);
    }
  };
  const semTipoDeEvento = opcoesEvento.length === 0;
  const concluirPermitido = opcoesEvento.some((o) => o.value === "Concluída");
  const rodape = (
    <RodapePilulas
      rotulo="Ações da tarefa"
      itens={[
        { chave: "editar", rotulo: "Editar", icone: SquarePen, onClick: () => setShowEdit(true), title: "Editar tarefa" },
        {
          chave: "evento",
          rotulo: "Registrar evento",
          icone: MessageSquarePlus,
          onClick: () => abrirEvento(),
          // Sem tipo permitido (tarefa concluída ou cancelada) não há o que registrar.
          desabilitado: semTipoDeEvento,
          title: semTipoDeEvento ? motivoEncerrada : "Registrar evento",
        },
        {
          chave: "concluir",
          rotulo: "Concluir",
          icone: Check,
          onClick: () => abrirEvento("Concluída"),
          desabilitado: !concluirPermitido,
          title: concluirPermitido ? "Concluir tarefa" : motivoEncerrada,
        },
        { chave: "excluir", rotulo: "Excluir", icone: Trash2, onClick: excluir, desabilitado: excluindo, title: "Excluir tarefa" },
      ]}
    />
  );

  let eventos;
  if (loadingHistorico) {
    eventos = (
      <div role="status" className="mk-dp-hist__estado">
        Carregando histórico...
      </div>
    );
  } else if (erroHistorico && !historico.length) {
    eventos = (
      <div role="alert" className="mk-dp-hist__estado">
        Não foi possível carregar o histórico.
      </div>
    );
  } else if (ultimosDias.length) {
    eventos = <LinhaDoTempo dias={ultimosDias} rotulo="Últimos eventos da tarefa" />;
  } else {
    eventos = <Vazio icone={History}>Nenhum evento registrado.</Vazio>;
  }

  return (
    <>
      {/* D-PROD-325: aberta pela lista, a tarefa entra na MESMA janela (sem a lista atrás) e o ‹ volta para ela. */}
      <CascaDetalhe titulo={titulo} sub="Detalhes da tarefa" rodape={rodape} className="mk-dp-tarefa" onVoltar={onVoltar} anim={anim}>
        <Cartao
          icone={ClipboardList}
          titulo={titulo || "Tarefa"}
          // "Manutenção · Pasto 04": a categoria (tipo base) cabe numa linha; o tipo de tarefa está na grade.
          sub={[tipoBase || tipoDaTarefa, local].filter(Boolean).join(" · ") || undefined}
          chip={status ? <Chip className={["mk-dp-tarefa__status", CLASSE_DO_STATUS[status]].filter(Boolean).join(" ")}>{status}</Chip> : null}
        />

        <TituloBloco>Informações da tarefa</TituloBloco>
        <Cartao>
          <Grade>
            <Celula rotulo="Prioridade" valor={prioridade.toUpperCase()} bolinha={COR_PRIORIDADE[prioridade]} />
            <Celula rotulo="Tipo de tarefa" valor={tipoDaTarefa || VAZIO} />
            <Celula rotulo="Grupo" valor={textoLimpo(currentTarefa.grupo_atividade_nome) || VAZIO} />
            <Celula rotulo="Área/Local" valor={areaLocal} />
            <Celula rotulo="Solicitante / Responsável" valor={solicitanteResponsavel} />
            <Celula rotulo="Data do pedido" valor={dataBR(currentTarefa.data_pedido)} />
            <Celula
              rotulo="Prazo"
              cor={prazoVencido ? COR_PRAZO_VENCIDO : null}
              valor={
                prazoVencido ? (
                  <>
                    {dataBR(currentTarefa.data_prevista)}
                    <span className="mk-dp-tarefa__leitor"> (vencido)</span>
                  </>
                ) : (
                  dataBR(currentTarefa.data_prevista)
                )
              }
            />
            <Celula rotulo="Data de início" valor={dataBR(currentTarefa.data_inicio)} />
            <Celula rotulo="Data de conclusão" valor={dataBR(currentTarefa.data_conclusao)} />
            {mostrarTipoBase ? <Celula rotulo="Tipo base" valor={tipoBase} /> : null}
            {coordenadas ? <Celula rotulo="Coordenadas" valor={coordenadas} /> : null}
          </Grade>
        </Cartao>

        <TituloBloco>Descrição</TituloBloco>
        <Cartao className="mk-dp-tarefa__textos">
          <Linha rotulo={descricao || "Sem descrição."} quebra className={descricao ? "mk-dp-tarefa__descricao" : "mk-dp-tarefa__descricao mk-dp-tarefa__fraco"} />
          <Linha rotulo="Observações" valor={observacoes || VAZIO} quebra />
          {obsConclusao ? <Linha rotulo="Obs. conclusão" valor={obsConclusao} quebra /> : null}
        </Cartao>

        {temFotos || fotosGuardadas.length > 0 ? (
          <>
            <TituloBloco>Fotos</TituloBloco>
            <div className="mk-dp-tarefa__fotos">
              <FotosTarefaGaleria tarefa={currentTarefa} guardadas={fotosGuardadas} onExcluirGuardada={excluirGuardada} />
            </div>
            {fotosGuardadas.length > 0 ? (
              <Nota data-mk-fotos-guardadas="">
                {fotosGuardadas.length === 1 ? "1 foto aguardando envio" : `${fotosGuardadas.length} fotos aguardando envio`} — sobe quando a internet voltar.
              </Nota>
            ) : null}
          </>
        ) : null}

        <TituloBloco link="Ver histórico" onLink={() => setShowHistorico(true)}>
          Últimos eventos
        </TituloBloco>
        {eventos}
      </CascaDetalhe>

      <LancLoteDialogo open={showEdit} onOpenChange={setShowEdit} titulo="Editar tarefa" lotes={[{ nome: currentTarefa.titulo }]} largo>
            <FormularioTarefaMapa
              key={`${currentTarefa.id}-${currentTarefa.coordenadas?.lat || 'sem-lat'}-${currentTarefa.coordenadas?.lng || 'sem-lng'}`}
              tarefa={currentTarefa}
              onSubmit={(data, pendingImageFiles = []) => {
                const payload = {
                  ...data,
                  prioridade: normalizeTaskPriority(data.prioridade),
                  responsavel: data.responsavel || "",
                  responsavel_geral: data.responsavel_geral || "",
                  observacoes: data.observacoes || "",
                  coordenadas: data.coordenadas,
                };
                updateMutation.mutate({ id: data.id || currentTarefa.id, data: payload, pendingImageFiles });
              }}
              onCancel={() => setShowEdit(false)}
              onRequestSelectLocation={onRequestSelectLocation}
              externalSubmitting={updateMutation.isPending}
            />
      </LancLoteDialogo>

      <LancLoteDialogo open={showHistorico} onOpenChange={setShowHistorico} titulo="Histórico da tarefa" lotes={[{ nome: currentTarefa.titulo }]} largo somenteLeitura>
        <HistoricoTarefaPanel
          tarefaId={currentTarefa.id}
          empresaId={currentTarefa.empresa_id ?? null}
          tarefaTitulo={currentTarefa.titulo}
          podeExcluir={podeExcluirEvento}
          historico={historico}
          carregando={loadingHistorico}
          erro={erroHistorico}
          causaDoErro={causaErroHistorico}
          onTentarDeNovo={() => refetchHistorico()}
        />
      </LancLoteDialogo>

      <LancLoteDialogo open={showEvento} onOpenChange={setShowEvento} titulo="Registrar evento" lotes={[{ nome: currentTarefa.titulo }]}>
        <LancLoteForm onSubmit={(e) => { e.preventDefault(); if (!eventoMutation.isPending) eventoMutation.mutate(); }}>
          <LancLoteSegmento
            rotulo="Tipo de evento"
            valor={tipoEventoValido}
            onChange={setEventoTipo}
            opcoes={opcoesEvento}
          />
          <LancField label="Data do evento">
            <input type="datetime-local" value={eventoData} onChange={(e) => setEventoData(e.target.value)} className={LL_CTL} />
          </LancField>
          <LancField label="Descrição">
            <textarea value={eventoDescricao} onChange={(e) => setEventoDescricao(e.target.value)} className={LL_CTL} rows={4} placeholder="Ex: foi fazer o serviço e quebrou o trator" />
          </LancField>
          <LancLoteRodape onCancelar={() => setShowEvento(false)} cancelarDesabilitado={eventoMutation.isPending} textoAcao="Salvar evento" textoEnviando="Salvando..." enviando={eventoMutation.isPending} />
        </LancLoteForm>
      </LancLoteDialogo>
    </>
  );
}

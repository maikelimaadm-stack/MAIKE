import React, { useEffect, useState } from "react";
import { atualizarTarefa, enviarAnexo } from "@/services/tarefasMapaService";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/services/mapaCacheService";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { LancLoteDialogo, LancLoteForm, LancLoteRodape, LancLoteSegmento, LL_CTL, useLancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";
import HistoricoTarefaPanel from "./HistoricoTarefaPanel";
import TarefaResumoVisual from "./TarefaResumoVisual";
import FotosTarefaGaleria from "@/components/tarefas/FotosTarefaGaleria";

const PRIORIDADE_CORES = {
  Baixa: "!bg-blue-300 !text-black hover:!bg-blue-300",
  Média: "!bg-yellow-300 !text-black hover:!bg-yellow-300",
  Alta: "!bg-red-400 !text-black hover:!bg-red-400",
  Concluida: "!bg-slate-300 !text-black hover:!bg-slate-300"
};

const STATUS_CORES = {
  Pendente: "!bg-yellow-300 !text-black hover:!bg-yellow-300",
  "Em Andamento": "!bg-blue-300 !text-black hover:!bg-blue-300",
  Concluída: "!bg-emerald-300 !text-black hover:!bg-emerald-300",
  Cancelada: "!bg-slate-300 !text-black hover:!bg-slate-300"
};


const getDateTimeLocal = (value) => {
  if (!value) return new Date().toISOString().slice(0, 16);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
};

const formatDateBR = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
};

export default function DetalhesTarefaMapa({ tarefa, onClose, onSaved, onRequestSelectLocation }) {
  const queryClient = useQueryClient();
  const [currentTarefa, setCurrentTarefa] = useState(tarefa);
  // D-PROD-118: aberta no diálogo padrão, o título do diálogo é a tarefa.
  const noDialogo = useLancLoteDialogo();
  useEffect(() => {
    if (!noDialogo) return undefined;
    noDialogo.setTitulo(currentTarefa?.titulo ? `Tarefa: ${currentTarefa.titulo}` : null);
    return () => noDialogo.setTitulo(null);
  }, [noDialogo, currentTarefa?.titulo]);
  const [showEdit, setShowEdit] = useState(false);
  const [showEvento, setShowEvento] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [eventoTipo, setEventoTipo] = useState(tarefa.status === "Em Andamento" ? "Registro" : "Em Andamento");
  const [eventoData, setEventoData] = useState(getDateTimeLocal());
  const [eventoDescricao, setEventoDescricao] = useState("");

  useEffect(() => {
    setCurrentTarefa(tarefa);
  }, [tarefa]);

  useEffect(() => {
    if (showEvento) {
      setEventoTipo(currentTarefa.status === "Em Andamento" ? "Registro" : "Em Andamento");
      setEventoData(getDateTimeLocal());
      setEventoDescricao("");
    }
  }, [showEvento, currentTarefa.status]);

  const { data: historico = [], isLoading: loadingHistorico } = useQuery({
    queryKey: ["historico-tarefa-detalhe", currentTarefa.id],
    queryFn: async () => {
      const cached = await getMapaCachedData('historicoTarefa', currentTarefa.empresa_id);
      
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('historicoTarefa', currentTarefa.empresa_id).then(fresh => {
            if (fresh?.length) {
              queryClient.setQueryData(["historico-tarefa-detalhe", currentTarefa.id], fresh.filter((item) => item.tarefa_id === currentTarefa.id).sort((a, b) => new Date(b.data_evento || b.created_date || 0) - new Date(a.data_evento || a.created_date || 0)));
            }
          });
          return cached.filter((item) => item.tarefa_id === currentTarefa.id).sort((a, b) => new Date(b.data_evento || b.created_date || 0) - new Date(a.data_evento || a.created_date || 0));
        } else {
          const fresh = await refreshMapaCacheEntry('historicoTarefa', currentTarefa.empresa_id);
          return fresh.filter((item) => item.tarefa_id === currentTarefa.id).sort((a, b) => new Date(b.data_evento || b.created_date || 0) - new Date(a.data_evento || a.created_date || 0));
        }
      }
      
      return (cached || []).filter((item) => item.tarefa_id === currentTarefa.id).sort((a, b) => new Date(b.data_evento || b.created_date || 0) - new Date(a.data_evento || a.created_date || 0));
    },
    initialData: [],
    staleTime: 60 * 1000
  });

  const { data: iconesPrioridade = [] } = useQuery({
    queryKey: ["mapa-icones"],
    queryFn: async () => {
      // Ícones são do tenant: o cache resolve o dono pela sessão (D-PROD-137).
      const cached = await getMapaCachedData('icones', null);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('icones', null).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(["mapa-icones"], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('icones', null);
      }
      return cached || [];
    },
    initialData: [],
    staleTime: 10 * 60 * 1000
  });

  const prioridade = normalizeTaskPriority(currentTarefa?.prioridade);
  const prioridadeClassName = currentTarefa.status === "Concluída" ? PRIORIDADE_CORES.Concluida : PRIORIDADE_CORES[prioridade] || PRIORIDADE_CORES.Baixa;
  const iconePrioridade = iconesPrioridade.find((icone) => normalizeTaskPriority(icone.categoria) === prioridade);
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

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, pendingImageFiles = [] }) => {
      // Upload de novas imagens antes de salvar
      const uploadedUrls = [];
      for (const file of pendingImageFiles) {
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
      return atualizarTarefa(id, {
        ...finalData,
        historico_evento: evento,
        historico_descricao: descricao,
        historico_data_evento: new Date().toISOString(),
      });
    },
    onSuccess: (updated) => {
      // Otimista no mapa e nas listas
      const empresaId = updated?.empresa_id || currentTarefa?.empresa_id;
      if (empresaId) {
        queryClient.setQueryData(["mapa-tarefas", empresaId], (old = []) => (old || []).map((t) => t.id === updated.id ? updated : t));
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
        queryClient.setQueryData(["mapa-tarefas", empresaId], (old = []) => (old || []).map((t) => t.id === updated.id ? updated : t));
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

  return (
    <div className="mk-hist mk-map-details" translate="no">
      {/* D-PROD-118: dentro do diálogo o título é a tarefa; aqui ficam status, prioridade e as ações. */}
      {!noDialogo ? <div className="mk-hist__secao-titulo">Tarefa: {currentTarefa.titulo}</div> : null}
      <div className="mk-tar__chips">
        <Badge variant="outline" className={`rounded-full text-[11px] border-transparent shadow-none ${STATUS_CORES[currentTarefa.status] || STATUS_CORES.Pendente}`}>
          Status: {currentTarefa.status}
        </Badge>
        <Badge variant="outline" className={`rounded-full text-[11px] border-transparent shadow-none ${prioridadeClassName}`}>
          Prioridade: {prioridade}
        </Badge>
      </div>

      <div className="mk-tar__acoes">
        <button type="button" className="mk-ll__btn mk-ll__btn--cinza" onClick={() => setShowEdit(true)}>Editar</button>
        <button type="button" className="mk-ll__btn mk-ll__btn--cinza" onClick={() => setShowEvento(true)}>Evento</button>
        <button type="button" className="mk-ll__btn mk-ll__btn--cinza" onClick={() => setShowHistorico(true)}>Histórico</button>
      </div>

      <section className="mk-ll__item">
        <header className="mk-ll__item-head"><div className="mk-ll__item-titulo">Informações da tarefa</div></header>
        <dl className="mk-tar__info">
          <div className="mk-tar__campo"><dt>Grupo</dt><dd>{currentTarefa.grupo_atividade_nome || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Tipo base</dt><dd>{currentTarefa.tipo || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Tipo de tarefa</dt><dd>{currentTarefa.tipo_tarefa_nome || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Solicitante / Responsável</dt><dd>{currentTarefa.solicitante || currentTarefa.responsavel_geral || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Responsável execução</dt><dd>{currentTarefa.responsavel || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Data do pedido</dt><dd>{formatDateBR(currentTarefa.data_pedido)}</dd></div>
          <div className="mk-tar__campo"><dt>Prazo</dt><dd>{formatDateBR(currentTarefa.data_prevista)}</dd></div>
          <div className="mk-tar__campo"><dt>Data de início</dt><dd>{formatDateBR(currentTarefa.data_inicio)}</dd></div>
          <div className="mk-tar__campo"><dt>Data de conclusão</dt><dd>{formatDateBR(currentTarefa.data_conclusao)}</dd></div>
          <div className="mk-tar__campo"><dt>Fazenda/Setor</dt><dd>{currentTarefa.setor_nome || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Área/Local</dt><dd>{currentTarefa.area_nome || currentTarefa.lote_nome || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Descrição</dt><dd>{currentTarefa.descricao || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Observações</dt><dd>{currentTarefa.observacoes || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Obs. conclusão</dt><dd>{currentTarefa.observacoes_conclusao || "-"}</dd></div>
          <div className="mk-tar__campo"><dt>Coordenadas</dt><dd>{currentTarefa.coordenadas ? `${currentTarefa.coordenadas.lat?.toFixed?.(6) || currentTarefa.coordenadas.lat}, ${currentTarefa.coordenadas.lng?.toFixed?.(6) || currentTarefa.coordenadas.lng}` : "-"}</dd></div>
        </dl>
      </section>

      <FotosTarefaGaleria tarefa={currentTarefa} />

      <section className="mk-ll__item">
        <header className="mk-ll__item-head"><div className="mk-ll__item-titulo">Últimos eventos</div></header>
        <div className="space-y-2 text-[11px]">
          {loadingHistorico ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 flex items-center gap-3">
              <div className="animate-spin w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full" />
              <span className="text-slate-500">Carregando histórico...</span>
            </div>
          ) : historico.length === 0 ?
          <div className="text-slate-500">Nenhum evento registrado.</div> :

          historico.slice(0, 3).map((item) =>
          <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{item.evento || "-"}</span>
                  <span className="text-slate-500">{formatDateBR(item.data_evento || item.created_date)}</span>
                </div>
                <div className="text-slate-700 break-words">{item.descricao || "-"}</div>
              </div>
          )
          }
        </div>
      </section>

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
        <HistoricoTarefaPanel tarefaId={currentTarefa.id} tarefaTitulo={currentTarefa.titulo} historico={historico} />
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
    </div>);

}

function CardInfo({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm"><div className="text-slate-500">{label}</div><div className="text-sm font-bold text-slate-900 break-words leading-tight">{value}</div></div>;
}
import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { History } from "lucide-react";
import { toast } from "sonner";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";
import HistoricoTarefaPanel from "./HistoricoTarefaPanel";
import TarefaResumoVisual from "./TarefaResumoVisual";

const PRIORIDADE_CORES = {
  Baixa: "bg-slate-100 text-slate-700",
  Média: "bg-blue-100 text-blue-700",
  Alta: "bg-amber-100 text-amber-700",
};

const STATUS_CORES = {
  Pendente: "bg-yellow-100 text-yellow-700",
  "Em Andamento": "bg-blue-100 text-blue-700",
  Concluída: "bg-emerald-100 text-emerald-700",
  Cancelada: "bg-slate-100 text-slate-500",
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

  const { data: historico = [] } = useQuery({
    queryKey: ["historico-tarefa-detalhe", currentTarefa.id],
    queryFn: async () => {
      const all = await base44.entities.HistoricoLancamentoTarefa.list("-created_date");
      return all
        .filter((item) => item.tarefa_id === currentTarefa.id)
        .sort((a, b) => new Date(b.data_evento || b.created_date || 0) - new Date(a.data_evento || a.created_date || 0));
    },
    initialData: [],
  });

  const { data: iconesPrioridade = [] } = useQuery({
    queryKey: ["icones-prioridade-detalhe-tarefa"],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((icone) => icone.ativo !== false && icone.tipo_entidade === "Prioridade Tarefa");
    },
    initialData: [],
  });

  const prioridade = normalizeTaskPriority(currentTarefa?.prioridade);
  const iconePrioridade = iconesPrioridade.find((icone) => normalizeTaskPriority(icone.categoria) === prioridade);
  const podeRegistrar = currentTarefa.status === "Em Andamento";
  const podeEntrarEmAndamento = !currentTarefa.data_inicio && currentTarefa.status === "Pendente";
  const podeConcluir = currentTarefa.status !== "Concluída" && currentTarefa.status !== "Cancelada";
  const podeCancelar = currentTarefa.status !== "Cancelada" && currentTarefa.status !== "Concluída";

  const registrarHistorico = async (registro, evento, descricao, dataEvento) => {
    await base44.entities.HistoricoLancamentoTarefa.create({
      empresa_id: registro.empresa_id,
      tarefa_id: registro.id,
      titulo_tarefa: registro.titulo,
      evento,
      data_evento: dataEvento,
      status: registro.status,
      responsavel: registro.responsavel,
      descricao,
    });
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const updated = await base44.entities.LancamentoTarefa.update(id, data);
      const mudouLocal = data.coordenadas?.lat !== currentTarefa?.coordenadas?.lat || data.coordenadas?.lng !== currentTarefa?.coordenadas?.lng;
      const mudouStatus = data.status && data.status !== currentTarefa?.status;
      const evento = mudouLocal
        ? "Mudança de Local"
        : updated.status === "Concluída" && mudouStatus
          ? "Conclusão"
          : updated.status === "Cancelada" && mudouStatus
            ? "Cancelamento"
            : mudouStatus
              ? "Mudança de Status"
              : "Edição";
      const descricao = mudouLocal
        ? "Local da tarefa alterado no mapa."
        : updated.status === "Concluída" && mudouStatus
          ? "Tarefa concluída pelo mapa."
          : updated.status === "Cancelada" && mudouStatus
            ? "Tarefa cancelada pelo mapa."
            : mudouStatus
              ? `Status alterado para ${updated.status}.`
              : "Tarefa editada.";
      await registrarHistorico(updated, evento, descricao, new Date().toISOString());
      return updated;
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
        await registrarHistorico(currentTarefa, "Registro", eventoDescricao || "Registro manual da tarefa.", dataEventoIso);
      } else {
        const novoStatus = eventoTipo;
        const payload = {
          status: novoStatus,
          data_inicio: novoStatus === "Em Andamento" ? dataEventoIso : currentTarefa.data_inicio,
          data_conclusao: novoStatus === "Concluída" ? dataEventoIso.split("T")[0] : currentTarefa.data_conclusao,
          observacoes_conclusao: eventoDescricao || currentTarefa.observacoes_conclusao || "",
        };
        registroAtualizado = await base44.entities.LancamentoTarefa.update(currentTarefa.id, payload);
        const evento = novoStatus === "Concluída" ? "Conclusão" : novoStatus === "Cancelada" ? "Cancelamento" : "Mudança de Status";
        await registrarHistorico(registroAtualizado, evento, eventoDescricao || `Status alterado para ${novoStatus}.`, dataEventoIso);
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
    },
  });

  return (
    <div className="space-y-1" translate="no">
      <div className="pb-2 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">
            Tarefa: {currentTarefa.titulo}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEdit(true)}>
          Editar
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEvento(true)}>
          Evento
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowHistorico(true)}>
          <History className="w-3.5 h-3.5" />
          Histórico
        </Button>
      </div>

      <CardSection title="Último evento da tarefa">
        <TarefaResumoVisual
          iconUrl={iconePrioridade?.sub_icone_url || iconePrioridade?.icone_url || null}
          prazo={currentTarefa.data_prevista}
          prioridade={prioridade}
          status={currentTarefa.status}
        />
      </CardSection>

      <CardSection title="Informações da Tarefa">
        <div className="space-y-1 text-[10px]">
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Solicitante:</span><span className="font-semibold text-slate-900">{currentTarefa.solicitante || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Responsável execução:</span><span className="font-semibold text-slate-900">{currentTarefa.responsavel || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Data do Pedido:</span><span className="font-semibold text-slate-900">{formatDateBR(currentTarefa.data_pedido)}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Prazo:</span><span className="font-semibold text-slate-900">{formatDateBR(currentTarefa.data_prevista)}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Fazenda/Setor:</span><span className="font-semibold text-slate-900">{currentTarefa.setor_nome || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Área/Local:</span><span className="font-semibold text-slate-900">{currentTarefa.area_nome || currentTarefa.lote_nome || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Descrição da Tarefa:</span><span className="font-semibold text-slate-900 break-words">{currentTarefa.descricao || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Responsável:</span><span className="font-semibold text-slate-900">{currentTarefa.responsavel_geral || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Prioridade:</span><span className="font-semibold text-slate-900">{prioridade}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Observações:</span><span className="font-semibold text-slate-900 break-words">{currentTarefa.observacoes || "-"}</span></div>
        </div>
      </CardSection>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar tarefa</DialogTitle></DialogHeader>
          <FormularioTarefaMapa
            key={`${currentTarefa.id}-${currentTarefa.coordenadas?.lat || 'sem-lat'}-${currentTarefa.coordenadas?.lng || 'sem-lng'}`}
            tarefa={currentTarefa}
            onSubmit={(data) => updateMutation.mutate({ id: data.id || currentTarefa.id, data: { ...data, prioridade: normalizeTaskPriority(data.prioridade), responsavel: data.responsavel || "", responsavel_geral: data.responsavel_geral || "", observacoes: data.observacoes || "" } })}
            onCancel={() => setShowEdit(false)}
            onRequestSelectLocation={onRequestSelectLocation}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="bg-background px-2 py-2 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto">
          <HistoricoTarefaPanel tarefaId={currentTarefa.id} tarefaTitulo={currentTarefa.titulo} historico={historico} />
        </DialogContent>
      </Dialog>

      <Dialog open={showEvento} onOpenChange={setShowEvento}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar evento da tarefa</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo de evento</Label>
              <Select value={eventoTipo} onValueChange={setEventoTipo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {podeRegistrar && <SelectItem value="Registro" className="text-xs">Registro</SelectItem>}
                  {podeEntrarEmAndamento && <SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem>}
                  {podeCancelar && <SelectItem value="Cancelada" className="text-xs">Cancelada</SelectItem>}
                  {podeConcluir && <SelectItem value="Concluída" className="text-xs">Concluída</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data do evento</Label>
              <input type="datetime-local" value={eventoData} onChange={(e) => setEventoData(e.target.value)} className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descrição</Label>
              <Textarea value={eventoDescricao} onChange={(e) => setEventoDescricao(e.target.value)} className="min-h-[120px] text-xs" placeholder="Ex: foi fazer o serviço e quebrou o trator" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEvento(false)}>Cancelar</Button>
              <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => eventoMutation.mutate()}>Salvar evento</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CardInfo({ label, value }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm"><div className="text-slate-500">{label}</div><div className="text-sm font-bold text-slate-900 break-words leading-tight">{value}</div></div>;
}

function CardSection({ title, children }) {
  return <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1"><div className="text-[11px] font-bold text-slate-900">{title}</div>{children}</div>;
}
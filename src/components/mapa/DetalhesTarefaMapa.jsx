import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardList, Pencil } from "lucide-react";
import { toast } from "sonner";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";

const PRIORIDADE_CORES = { Baixa: "bg-slate-100 text-slate-700", Média: "bg-blue-100 text-blue-700", Alta: "bg-amber-100 text-amber-700" };
const STATUS_CORES = { Pendente: "bg-yellow-100 text-yellow-700", "Em Andamento": "bg-blue-100 text-blue-700", Concluída: "bg-emerald-100 text-emerald-700", Cancelada: "bg-slate-100 text-slate-500" };

export default function DetalhesTarefaMapa({ tarefa, onClose, onSaved, onRequestSelectLocation }) {
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [showEvento, setShowEvento] = useState(false);
  const [eventoStatus, setEventoStatus] = useState(tarefa.status || "Pendente");
  const [eventoDescricao, setEventoDescricao] = useState("");

  const { data: iconesPrioridade = [] } = useQuery({
    queryKey: ["detalhe-icone-prioridade-tarefa"],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((icone) => icone.ativo !== false && icone.tipo_entidade === "Prioridade Tarefa");
    },
    initialData: [],
  });

  const { data: historico = [] } = useQuery({
    queryKey: ["historico-tarefa-detalhe", tarefa.id],
    queryFn: async () => {
      const all = await base44.entities.HistoricoTarefaMapa.list("-created_date");
      return all.filter((item) => item.tarefa_id === tarefa.id);
    },
    initialData: [],
  });

  const prioridade = normalizeTaskPriority(tarefa?.prioridade);
  const iconePrioridade = useMemo(() => {
    const normalize = (value) => (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    return iconesPrioridade.find((icone) => normalize(icone.categoria) === normalize(prioridade));
  }, [iconesPrioridade, prioridade]);

  const registrarHistorico = async (registro, evento, descricao) => {
    await base44.entities.HistoricoTarefaMapa.create({
      empresa_id: registro.empresa_id,
      tarefa_id: registro.id,
      titulo_tarefa: registro.titulo,
      evento,
      status: registro.status,
      responsavel: registro.responsavel,
      descricao,
    });
  };

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const updated = await base44.entities.TarefaMapa.update(id, data);
      const mudouLocal = data.coordenadas?.lat !== tarefa?.coordenadas?.lat || data.coordenadas?.lng !== tarefa?.coordenadas?.lng;
      await registrarHistorico(updated, mudouLocal ? "Mudança de Local" : "Edição", mudouLocal ? "Local da tarefa alterado no mapa." : "Tarefa editada.");
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", tarefa.id] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Tarefa atualizada.");
      setShowEdit(false);
      onSaved?.();
    },
  });

  const eventoMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        status: eventoStatus,
        data_inicio: eventoStatus === "Em Andamento" ? (tarefa.data_inicio || new Date().toISOString()) : tarefa.data_inicio,
        data_conclusao: eventoStatus === "Concluída" ? new Date().toISOString().split("T")[0] : null,
        observacoes_conclusao: eventoDescricao || tarefa.observacoes_conclusao || "",
      };
      const updated = await base44.entities.TarefaMapa.update(tarefa.id, payload);
      await registrarHistorico(updated, "Mudança de Status", eventoDescricao || `Status alterado para ${eventoStatus}.`);
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", tarefa.id] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Evento registrado.");
      setShowEvento(false);
      setEventoDescricao("");
      onSaved?.();
    },
  });

  return (
    <div className="space-y-1" translate="no">
      <div className="pb-2 border-b space-y-1">
        <div className="flex items-center gap-1 flex-wrap">
          <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">
            Tarefa: {tarefa.titulo}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEdit(true)}>
          <Pencil className="w-3.5 h-3.5" />
          Editar
        </Button>
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEvento(true)}>
          <ClipboardList className="w-3.5 h-3.5" />
          Evento
        </Button>
      </div>

      <CardSection title="Resumo da tarefa">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <CardInfo label="Grupo" value={tarefa.grupo_atividade_nome || "-"} />
          <CardInfo label="Tipo" value={tarefa.tipo_tarefa_nome || tarefa.tipo || "-"} />
          <CardInfo label="Status" value={<Badge className={`text-[10px] ${STATUS_CORES[tarefa.status] || STATUS_CORES.Pendente}`}>{tarefa.status}</Badge>} />
          <CardInfo label="Responsável" value={tarefa.responsavel || "-"} />
          <CardInfo label="Prazo" value={tarefa.data_prevista || "-"} />
          <CardInfo label="Prioridade" value={<div className="flex items-center gap-2">{iconePrioridade?.icone_url && <img src={iconePrioridade.icone_url} alt={prioridade} className="w-5 h-5 object-contain" />}<Badge className={`text-[10px] ${PRIORIDADE_CORES[prioridade] || PRIORIDADE_CORES.Baixa}`}>{prioridade}</Badge></div>} />
        </div>
        {tarefa.descricao && <div className="text-xs text-slate-700 whitespace-pre-wrap">{tarefa.descricao}</div>}
      </CardSection>

      <CardSection title="Localização">
        <div className="space-y-1 text-[10px]">
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Área:</span><span className="font-semibold text-slate-900">{tarefa.area_nome || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Lote:</span><span className="font-semibold text-slate-900">{tarefa.lote_nome || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Coordenadas:</span><span className="font-semibold text-slate-900">{tarefa.coordenadas?.lat ? `${tarefa.coordenadas.lat.toFixed(6)}, ${tarefa.coordenadas.lng.toFixed(6)}` : "-"}</span></div>
        </div>
      </CardSection>

      <CardSection title="Histórico da tarefa">
        {historico.length === 0 ? <div className="text-xs text-slate-500">Nenhum histórico registrado ainda.</div> : (
          <div className="space-y-1">{historico.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5"><div className="flex items-center justify-between gap-2 text-[10px]"><span className="font-semibold text-slate-900">{item.evento}</span><span className="text-slate-500">{item.created_date ? new Date(item.created_date).toLocaleString("pt-BR") : "-"}</span></div><div className="text-[10px] text-slate-600">{item.descricao || "-"}</div><div className="text-[10px] text-slate-500">Status: {item.status || "-"} • Responsável: {item.responsavel || "-"}</div></div>)}</div>
        )}
      </CardSection>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Editar tarefa</DialogTitle></DialogHeader>
          <FormularioTarefaMapa tarefa={tarefa} onSubmit={(data) => updateMutation.mutate({ id: tarefa.id, data: { ...data, prioridade: normalizeTaskPriority(data.prioridade) } })} onCancel={() => setShowEdit(false)} onRequestSelectLocation={onRequestSelectLocation} />
        </DialogContent>
      </Dialog>

      <Dialog open={showEvento} onOpenChange={setShowEvento}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar evento da tarefa</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Novo status</Label>
              <Select value={eventoStatus} onValueChange={setEventoStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem>
                  <SelectItem value="Cancelada" className="text-xs">Cancelada</SelectItem>
                  <SelectItem value="Concluída" className="text-xs">Concluída</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Observação do evento</Label>
              <Textarea value={eventoDescricao} onChange={(e) => setEventoDescricao(e.target.value)} className="min-h-[120px] text-xs" placeholder="Descreva o que aconteceu" />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEvento(false)}>Cancelar</Button>
              <Button type="button" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => eventoMutation.mutate()}>
                <ClipboardList className="w-3.5 h-3.5" />
                Salvar evento
              </Button>
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
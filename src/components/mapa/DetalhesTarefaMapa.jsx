import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar, CheckCircle, ClipboardList, Flag, MapPin, Pencil, User } from "lucide-react";
import { toast } from "sonner";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";

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

export default function DetalhesTarefaMapa({ tarefa, onClose, onSaved, onRequestSelectLocation }) {
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);

  const { data: iconesPrioridade = [] } = useQuery({
    queryKey: ["detalhe-icone-prioridade-tarefa"],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((icone) => icone.ativo !== false && icone.tipo_entidade === "Prioridade Tarefa");
    },
    initialData: [],
  });

  const prioridade = normalizeTaskPriority(tarefa?.prioridade);
  const iconePrioridade = useMemo(() => {
    const normalize = (value) => (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    return iconesPrioridade.find((icone) => normalize(icone.categoria) === normalize(prioridade));
  }, [iconesPrioridade, prioridade]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TarefaMapa.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      toast.success("Tarefa atualizada.");
      setShowEdit(false);
      onSaved?.();
    },
  });

  const concluirMutation = useMutation({
    mutationFn: () => base44.entities.TarefaMapa.update(tarefa.id, {
      status: "Concluída",
      data_conclusao: new Date().toISOString().split("T")[0],
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      toast.success("Tarefa concluída.");
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
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => concluirMutation.mutate()}
          disabled={tarefa.status === "Concluída"}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Concluir
        </Button>
      </div>

      <CardSection title="Resumo da tarefa">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <CardInfo label="Tipo" value={tarefa.tipo || "-"} />
          <CardInfo label="Status" value={<Badge className={`text-[10px] ${STATUS_CORES[tarefa.status] || STATUS_CORES.Pendente}`}>{tarefa.status}</Badge>} />
          <CardInfo
            label="Prioridade"
            value={
              <div className="flex items-center gap-2">
                {iconePrioridade?.icone_url && <img src={iconePrioridade.icone_url} alt={prioridade} className="w-5 h-5 object-contain" />}
                <Badge className={`text-[10px] ${PRIORIDADE_CORES[prioridade] || PRIORIDADE_CORES.Baixa}`}>{prioridade}</Badge>
              </div>
            }
          />
        </div>
        {tarefa.descricao && <div className="text-xs text-slate-700 whitespace-pre-wrap">{tarefa.descricao}</div>}
      </CardSection>

      <CardSection title="Localização e responsável">
        <div className="space-y-1 text-[10px]">
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Área:</span><span className="font-semibold text-slate-900">{tarefa.area_nome || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Lote:</span><span className="font-semibold text-slate-900">{tarefa.lote_nome || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Responsável:</span><span className="font-semibold text-slate-900">{tarefa.responsavel || "-"}</span></div>
          <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Coordenadas:</span><span className="font-semibold text-slate-900">{tarefa.coordenadas?.lat ? `${tarefa.coordenadas.lat.toFixed(6)}, ${tarefa.coordenadas.lng.toFixed(6)}` : "-"}</span></div>
        </div>
      </CardSection>

      <CardSection title="Histórico">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <CardInfo label="Criada em" value={tarefa.created_date ? new Date(tarefa.created_date).toLocaleString("pt-BR") : "-"} />
          <CardInfo label="Última atualização" value={tarefa.updated_date ? new Date(tarefa.updated_date).toLocaleString("pt-BR") : "-"} />
          <CardInfo label="Data prevista" value={tarefa.data_prevista ? new Date(tarefa.data_prevista).toLocaleDateString("pt-BR") : "-"} />
          <CardInfo label="Data de conclusão" value={tarefa.data_conclusao ? new Date(tarefa.data_conclusao).toLocaleDateString("pt-BR") : "-"} />
        </div>
      </CardSection>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar tarefa</DialogTitle>
          </DialogHeader>
          <FormularioTarefaMapa
            tarefa={tarefa}
            onSubmit={(data) => updateMutation.mutate({ id: tarefa.id, data: { ...data, prioridade: normalizeTaskPriority(data.prioridade) } })}
            onCancel={() => setShowEdit(false)}
            onRequestSelectLocation={onRequestSelectLocation}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CardInfo({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      <div className="text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-900 break-words leading-tight">{value}</div>
    </div>
  );
}

function CardSection({ title, children }) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
      <div className="text-[11px] font-bold text-slate-900">{title}</div>
      {children}
    </div>
  );
}
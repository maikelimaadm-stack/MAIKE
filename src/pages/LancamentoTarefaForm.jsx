import React from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import FormularioTarefaMapa from "@/components/mapa/FormularioTarefaMapa";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function LancamentoTarefaForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");
  const isEdit = Boolean(id);
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: tarefa = null, isLoading } = useQuery({
    queryKey: ["lancamento-tarefa-form", id],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list("-updated_date");
      return all.find((item) => item.id === id) || null;
    },
    enabled: !!id,
    initialData: null,
  });

  const registrarHistorico = async (registro, evento, descricao) => {
    await base44.entities.HistoricoLancamentoTarefa.create({
      empresa_id: registro.empresa_id || empresaSelecionadaId,
      tarefa_id: registro.id,
      titulo_tarefa: registro.titulo,
      evento,
      data_evento: new Date().toISOString(),
      status: registro.status,
      responsavel: registro.responsavel,
      descricao,
    });
  };

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const created = await base44.entities.LancamentoTarefa.create({ ...payload, empresa_id: empresaSelecionadaId });
      await registrarHistorico(created, "Criação", "Tarefa criada pela gestão de tarefas.");
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", id] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Tarefa salva.");
      navigate(createPageUrl("LancamentosTarefas"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload) => {
      const updated = await base44.entities.LancamentoTarefa.update(id, payload);
      const mudouLocal = payload.coordenadas?.lat !== tarefa?.coordenadas?.lat || payload.coordenadas?.lng !== tarefa?.coordenadas?.lng;
      const mudouStatus = payload.status && payload.status !== tarefa?.status;
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
        ? "Local da tarefa alterado pela gestão de tarefas."
        : updated.status === "Concluída" && mudouStatus
          ? "Tarefa concluída pela gestão de tarefas."
          : updated.status === "Cancelada" && mudouStatus
            ? "Tarefa cancelada pela gestão de tarefas."
            : mudouStatus
              ? `Status alterado para ${updated.status}.`
              : "Tarefa atualizada pela gestão de tarefas.";
      await registrarHistorico(updated, evento, descricao);
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", id] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Tarefa atualizada.");
      navigate(createPageUrl("LancamentosTarefas"));
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="text-lg font-bold text-slate-900">{isEdit ? "Editar tarefa" : "Lançar tarefa"}</h1>
        <p className="text-xs text-slate-600">Gestão unificada com o mapa</p>
      </div>
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="text-xs text-slate-500">Carregando...</div>
          ) : (
            <FormularioTarefaMapa
              tarefa={tarefa}
              onSubmit={(data) => {
                if (isEdit) updateMutation.mutate(data); else createMutation.mutate(data);
              }}
              onCancel={() => navigate(createPageUrl("LancamentosTarefas"))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
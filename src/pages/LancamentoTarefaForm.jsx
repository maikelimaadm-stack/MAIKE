import React from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    onSuccess: (created) => {
      queryClient.setQueryData(["gestao-tarefas-unificada", empresaSelecionadaId], (old = []) => [created, ...(old || [])]);
      queryClient.setQueryData(["mapa-tarefas", empresaSelecionadaId], (old = []) => [created, ...(old || [])]);
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", id] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Tarefa salva.");
      navigate(createPageUrl("LancamentosTarefas"));
    }
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
    onSuccess: (updated) => {
      queryClient.setQueryData(["gestao-tarefas-unificada", empresaSelecionadaId], (old = []) => (old || []).map(t => t.id === updated.id ? updated : t));
      queryClient.setQueryData(["mapa-tarefas", empresaSelecionadaId], (old = []) => (old || []).map(t => t.id === updated.id ? updated : t));
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      queryClient.invalidateQueries({ queryKey: ["historico-tarefa-detalhe", id] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Tarefa atualizada.");
      navigate(createPageUrl("LancamentosTarefas"));
    }
  });

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div>
        <h1 className="text-lg font-bold text-slate-900">{isEdit ? "Editar tarefa" : "Lançar tarefa"}</h1>
        <p className="text-xs text-slate-600">Gestão unificada com o mapa</p>
      </div>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-emerald-50 border-b border-emerald-200 py-2 px-3">
          <CardTitle className="text-sm font-bold text-emerald-900">{isEdit ? "Editar Lançamento de Tarefa" : "Lançar Tarefa"}</CardTitle>
        </CardHeader>
        <CardContent className="p-2 max-h-[calc(100vh-200px)] overflow-y-auto overflow-x-hidden">
          {isLoading ? (
            <div className="text-xs text-slate-500">Carregando...</div>
          ) : (
            <FormularioTarefaMapa
              tarefa={tarefa}
              onSubmit={(data) => {
                const payload = {
                  ...data,
                  prioridade: data.prioridade,
                  solicitante: data.solicitante || "",
                  responsavel: data.responsavel || "",
                  responsavel_geral: data.solicitante || "",
                  observacoes: data.observacoes || "",
                };
                if (isEdit) updateMutation.mutate(payload); else createMutation.mutate(payload);
              }}
              onCancel={() => navigate(createPageUrl("LancamentosTarefas"))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
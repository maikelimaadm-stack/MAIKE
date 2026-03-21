import React from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import FormularioTipoTarefa from "@/components/tipos-tarefa/FormularioTipoTarefa";

export default function TipoTarefaForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");
  const isEdit = Boolean(id);

  const { data: grupos = [] } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => base44.entities.GrupoAtividade.list(),
    initialData: [],
  });

  const { data: tipo = null, isLoading } = useQuery({
    queryKey: ["tipo-tarefa-form", id],
    queryFn: async () => {
      const all = await base44.entities.TipoTarefa.list("-updated_date");
      return all.find((item) => item.id === id) || null;
    },
    enabled: !!id,
    initialData: null,
  });

  const createMutation = useMutation({
    mutationFn: (payload) => base44.entities.TipoTarefa.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      toast.success("Tipo cadastrado!");
      navigate(createPageUrl("TiposTarefa"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload) => {
      const updated = await base44.entities.TipoTarefa.update(id, payload);
      await base44.functions.invoke("syncEntityReferences", {
        event: { type: "update", entity_name: "TipoTarefa" },
        data: updated,
        old_data: tipo,
      });
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      toast.success("Tipo atualizado!");
      navigate(createPageUrl("TiposTarefa"));
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-1">
      {isLoading ? (
        <div className="text-xs text-slate-500">Carregando...</div>
      ) : (
        <FormularioTipoTarefa
          initialData={tipo}
          grupos={grupos}
          isEditing={isEdit}
          onSubmit={(data) => {
            if (isEdit) updateMutation.mutate(data); else createMutation.mutate(data);
          }}
          onCancel={() => navigate(createPageUrl("TiposTarefa"))}
        />
      )}
    </div>
  );
}
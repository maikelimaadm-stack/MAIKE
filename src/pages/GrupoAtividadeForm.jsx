import React from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import FormularioGrupoAtividade from "@/components/grupos-atividades/FormularioGrupoAtividade";

export default function GrupoAtividadeForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");
  const isEdit = Boolean(id);

  const { data: grupo = null, isLoading } = useQuery({
    queryKey: ["grupo-atividade-form", id],
    queryFn: async () => {
      const all = await base44.entities.GrupoAtividade.list("-updated_date");
      return all.find((item) => item.id === id) || null;
    },
    enabled: !!id,
    initialData: null,
  });

  const createMutation = useMutation({
    mutationFn: (payload) => base44.entities.GrupoAtividade.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      toast.success("Grupo cadastrado!");
      navigate(createPageUrl("GruposAtividades"));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload) => {
      const updated = await base44.entities.GrupoAtividade.update(id, payload);
      await base44.functions.invoke("syncEntityReferences", {
        event: { type: "update", entity_name: "GrupoAtividade" },
        data: updated,
        old_data: grupo,
      });
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      toast.success("Grupo atualizado!");
      navigate(createPageUrl("GruposAtividades"));
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-1">
      {isLoading ? (
        <div className="text-xs text-slate-500">Carregando...</div>
      ) : (
        <FormularioGrupoAtividade
          initialData={grupo}
          isEditing={isEdit}
          onSubmit={(data) => {
            if (isEdit) updateMutation.mutate(data); else createMutation.mutate(data);
          }}
          onCancel={() => navigate(createPageUrl("GruposAtividades"))}
        />
      )}
    </div>
  );
}
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { AnimatePresence } from "framer-motion";

import FormularioGrupoFinanceiro from "../components/financeiro/FormularioGrupoFinanceiro";
import TabelaGruposFinanceiros from "../components/financeiro/TabelaGruposFinanceiros";

export default function GruposFinanceiros() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();

  const { data: grupos = [], isLoading } = useQuery({
    queryKey: ["grupos_financeiros", empresaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list();
      return all.filter(g => g && g.empresa_id === empresaId);
    },
    enabled: !!empresaId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.GrupoFinanceiro.create({ ...data, empresa_id: empresaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos_financeiros"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Grupo criado com sucesso!");
    },
    onError: (err) => toast.error("Erro ao criar: " + (err.message || "Erro desconhecido")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GrupoFinanceiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos_financeiros"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Grupo atualizado!");
    },
    onError: (err) => toast.error("Erro ao atualizar: " + (err.message || "Erro desconhecido")),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => {
      const hasChildren = grupos.some(g => g.grupo_pai_id === id);
      if (hasChildren) throw new Error("Este grupo possui subgrupos vinculados. Exclua-os primeiro.");
      return base44.entities.GrupoFinanceiro.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos_financeiros"] });
      toast.success("Grupo excluído!");
    },
    onError: (err) => toast.error(err.message || "Erro ao excluir"),
  });

  const handleSubmit = (data) => {
    if (editingItem?.id) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingItem(null);
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioGrupoFinanceiro
            key="form"
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            initialData={editingItem}
            gruposExistentes={grupos}
          />
        ) : (
          <div key="list">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
              <div>
                <h1 className="font-bold text-slate-800">Grupos de Receitas e Despesas</h1>
                <p className="text-xs text-slate-600">Classificação gerencial para agrupamento e relatórios</p>
              </div>
              <Button
                onClick={() => { setEditingItem(null); setShowForm(true); }}
                size="sm"
                className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 shadow h-7 hover:bg-emerald-600"
              >
                <Plus className="w-3.5 h-3.5" /> Novo Grupo
              </Button>
            </div>

            <TabelaGruposFinanceiros
              grupos={grupos}
              onEdit={handleEdit}
              onDelete={(id) => deleteMutation.mutate(id)}
              isLoading={isLoading}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
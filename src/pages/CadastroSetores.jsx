import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import TabelaSetores from "@/components/setores/TabelaSetores";
import FormularioSetor from "@/components/setores/FormularioSetor";
import { ensureDeleteAllowed } from "@/lib/entityDeleteGuards";
import { AnimatePresence } from "framer-motion";

const getInitialFormData = () => ({
  nome: "",
  sigla: "",
  tipo: "Próprio",
  responsavel: "",
  telefone: "",
  endereco: "",
  cidade: "",
  estado: "",
  area_total: "",
  capacidade_animais: "",
  observacoes: "",
  ativo: true
});

export default function CadastroSetores() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [editando, setEditando] = useState(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deletarId, setDeletarId] = useState(null);

  const { data: setores = [], isLoading, refetch } = useQuery({
    queryKey: ["setores", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all.filter((s) => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const allSetores = await base44.entities.Setor.list();
      const maxNum = allSetores.reduce((max, s) => Math.max(max, parseInt(s.numero_setor) || 0), 0);

      return base44.entities.Setor.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_setor: String(maxNum + 1),
        nome: data.nome?.toUpperCase(),
        sigla: data.sigla?.toUpperCase() || null,
        responsavel: data.responsavel?.toUpperCase() || null,
        endereco: data.endereco?.toUpperCase() || null,
        cidade: data.cidade?.toUpperCase() || null,
        observacoes: data.observacoes?.toUpperCase() || null,
        area_total: data.area_total ? parseFloat(data.area_total) : null,
        capacidade_animais: data.capacidade_animais ? parseInt(data.capacidade_animais) : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores", empresaSelecionadaId] });
      toast.success("Setor cadastrado com sucesso!");
      setShowForm(false);
      setEditando(null);
    },
    onError: () => toast.error("Erro ao cadastrar setor")
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.Setor.update(id, {
        ...data,
        nome: data.nome?.toUpperCase(),
        sigla: data.sigla?.toUpperCase() || null,
        responsavel: data.responsavel?.toUpperCase() || null,
        endereco: data.endereco?.toUpperCase() || null,
        cidade: data.cidade?.toUpperCase() || null,
        observacoes: data.observacoes?.toUpperCase() || null,
        area_total: data.area_total ? parseFloat(data.area_total) : null,
        capacidade_animais: data.capacidade_animais ? parseInt(data.capacidade_animais) : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores", empresaSelecionadaId] });
      toast.success("Setor atualizado!");
      setShowForm(false);
      setEditando(null);
    },
    onError: () => toast.error("Erro ao atualizar setor")
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await ensureDeleteAllowed(base44, "Setor", id);
      return base44.entities.Setor.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores", empresaSelecionadaId] });
      toast.success("Setor excluído!");
      setShowDelete(false);
      setDeletarId(null);
    },
    onError: (error) => {
      if (String(error?.message || "").toLowerCase().includes("não é possível excluir")) return;
      toast.error(error?.message || "Erro ao excluir setor");
    }
  });

  const handleEdit = (setor) => {
    setEditando({
      ...getInitialFormData(),
      ...setor,
      area_total: setor.area_total || "",
      capacidade_animais: setor.capacidade_animais || ""
    });
    setShowForm(true);
  };

  const handleSubmit = (data) => {
    if (editando) {
      updateMutation.mutate({ id: editando.id, data, oldData: editando });
      return;
    }
    createMutation.mutate(data);
  };

  return (
    <div className="p-4 md:p-6 space-y-1">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Cadastro de Setores / Fazendas</h1>
          <p className="text-xs text-slate-600">Cadastro e gestão dos setores e fazendas</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!showForm &&
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="h-8 w-8">
              <Settings className="w-4 h-4" />
            </Button>
          }
          

          
          {!showForm &&
          <Button onClick={() => {setEditando(null);setShowForm(true);}} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              Novo Setor
            </Button>
          }
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showForm ?
        <FormularioSetor
          initialData={editando || getInitialFormData()}
          isEditing={!!editando}
          onSubmit={handleSubmit}
          onCancel={() => {setShowForm(false);setEditando(null);}} /> :


        <TabelaSetores
          setores={setores}
          isLoading={isLoading}
          onEdit={handleEdit}
          onDelete={(id) => {setDeletarId(id);setShowDelete(true);}}
          showConfigColunas={showConfigColunas}
          setShowConfigColunas={setShowConfigColunas} />

        }
      </AnimatePresence>

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Confirmar exclusão"
        description="Se este setor possuir registros lançados, a exclusão será bloqueada automaticamente."
        onConfirm={() => deleteMutation.mutate(deletarId)}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive" />
      
    </div>);

}
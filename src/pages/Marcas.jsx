import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import FormularioMarca from "@/components/marcas/FormularioMarca";
import TabelaMarcas from "@/components/marcas/TabelaMarcas";

const getNextSystemNumber = async () => {
  try {
    const all = await base44.entities.Marca.list();
    const numeros = all.map(m => parseInt(m.numero_marca) || 0).filter(n => n > 0 && n < 1000000000);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch { return 1; }
};

export default function Marcas() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const queryClient = useQueryClient();
  const empresaId = localStorage.getItem('empresa_selecionada_id');

  const { data: marcas = [], isLoading } = useQuery({
    queryKey: ['marcas', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Marca.list('-created_date');
      return all.filter(m => m.empresa_id === empresaId);
    },
    enabled: !!empresaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const existente = marcas.find(m => m.nome?.toUpperCase().trim() === data.nome?.toUpperCase().trim());
      if (existente) throw new Error('Já existe marca com este nome!');
      const numero = await getNextSystemNumber();
      return base44.entities.Marca.create({ ...data, empresa_id: empresaId, numero_marca: String(numero) });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['marcas'] }); setShowForm(false); setEditingItem(null); toast.success("Marca criada!"); },
    onError: (err) => toast.error(err.message || "Erro"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Marca.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['marcas'] }); setShowForm(false); setEditingItem(null); toast.success("Marca atualizada!"); },
    onError: (err) => toast.error(err.message || "Erro"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids) => { for (const id of ids) await base44.entities.Marca.delete(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['marcas'] }); toast.success("Marca(s) excluída(s)!"); },
    onError: (err) => toast.error(err.message || "Erro ao excluir"),
  });

  const handleSubmit = (data) => {
    if (editingItem?.id) updateMutation.mutate({ id: editingItem.id, data });
    else createMutation.mutate(data);
  };

  const handleEdit = (item) => { setEditingItem(item); setShowForm(true); };
  const handleRequestDelete = (id) => { const ids = Array.isArray(id) ? id : [id]; setDeleteState({ open: true, ids }); };
  const handleConfirmDelete = () => { deleteMutation.mutate(deleteState.ids); setDeleteState({ open: false, ids: [] }); };

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
          <div><h1 className="font-bold text-slate-800">Marcas</h1></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7"><Settings className="w-4 h-4" /></Button>
            <Button onClick={() => { setShowForm(true); setEditingItem(null); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Adicionar</Button>
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioMarca key="form" initialData={editingItem} onSubmit={handleSubmit} onCancel={() => { setShowForm(false); setEditingItem(null); }} />
        ) : (
          <TabelaMarcas key="table" marcas={marcas} onEdit={handleEdit} onDelete={handleRequestDelete} isLoading={isLoading} showConfigColunas={showConfigColunas} setShowConfigColunas={setShowConfigColunas} />
        )}
      </AnimatePresence>
      <ConfirmDialog open={deleteState.open} onOpenChange={(open) => setDeleteState(prev => ({ ...prev, open }))} title="Confirmar exclusão" description={deleteState.ids.length > 1 ? `Deseja excluir ${deleteState.ids.length} marcas?` : "Deseja excluir esta marca?"} confirmText="Excluir" cancelText="Cancelar" variant="destructive" onConfirm={handleConfirmDelete} />
    </div>
  );
}
import React, { useState } from "react";
import {
  listarTodasCategorias,
  criarCategoria,
  atualizarCategoria,
  excluirCategorias,
} from "@/services/categoriaProdutoService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";

import FormularioCategoriaProduto from "../components/categorias-produto/FormularioCategoriaProduto";
import TabelaCategoriasProduto from "../components/categorias-produto/TabelaCategoriasProduto";

export default function Categorias() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const queryClient = useQueryClient();

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias_produto"],
    queryFn: () => listarTodasCategorias(),
  });

  const createMutation = useMutation({
    mutationFn: (data) => criarCategoria(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["categorias_produto"] }); setShowForm(false); setEditingItem(null); toast.success("Categoria criada!"); },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível concluir a operação.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => atualizarCategoria(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["categorias_produto"] }); setShowForm(false); setEditingItem(null); toast.success("Categoria atualizada!"); },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível concluir a operação.")),
  });

  const deleteMutation = useMutation({
    // O service valida todos os ids antes de excluir qualquer um: checar item a
    // item deixaria metade do lote excluído quando o sexto tivesse filhos.
    mutationFn: (/** @type {string[]} */ ids) => excluirCategorias(ids),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["categorias_produto"] }); toast.success("Categoria(s) excluída(s)!"); },
    onError: (err) => toast.error(getApiErrorMessage(err, "Erro ao excluir")),
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
          <div><h1 className="font-bold text-slate-800">Categorias de Produtos</h1></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7"><Settings className="w-4 h-4" /></Button>
            <Button onClick={() => { setShowForm(true); setEditingItem(null); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Adicionar</Button>
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioCategoriaProduto key="form" initialData={editingItem} onSubmit={handleSubmit} onCancel={() => { setShowForm(false); setEditingItem(null); }} categoriasExistentes={categorias} />
        ) : (
          <TabelaCategoriasProduto key="table" categorias={categorias} onEdit={handleEdit} onDelete={handleRequestDelete} showConfigColunas={showConfigColunas} setShowConfigColunas={setShowConfigColunas} />
        )}
      </AnimatePresence>
      <ConfirmDialog open={deleteState.open} onOpenChange={(open) => setDeleteState(prev => ({ ...prev, open }))} title="Confirmar exclusão" description={deleteState.ids.length > 1 ? `Deseja excluir ${deleteState.ids.length} categorias selecionadas?` : "Deseja excluir esta categoria?"} confirmText="Excluir" cancelText="Cancelar" variant="destructive" onConfirm={handleConfirmDelete} />
    </div>
  );
}
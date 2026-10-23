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
import { Plus, Settings } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias_produto"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Categoria criada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível concluir a operação.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => atualizarCategoria(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias_produto"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Categoria atualizada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível concluir a operação.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (/** @type {string[]} */ ids) => excluirCategorias(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias_produto"] });
      toast.success("Categoria(s) excluída(s)!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Erro ao excluir")),
  });

  const closeForm = () => {
    setShowForm(false);
    setEditingItem(null);
  };

  const handleSubmit = (data) => {
    if (editingItem?.id) updateMutation.mutate({ id: editingItem.id, data });
    else createMutation.mutate(data);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleRequestDelete = (id) => {
    const ids = Array.isArray(id) ? id : [id];
    setDeleteState({ open: true, ids });
  };

  const handleConfirmDelete = () => {
    deleteMutation.mutate(deleteState.ids);
    setDeleteState({ open: false, ids: [] });
  };

  const detailTitle = editingItem?.id ? "Editar categoria" : "Nova categoria";

  const listToolbar = (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setShowConfigColunas(true)}
        className="h-8 w-8"
        aria-label="Configurar colunas"
      >
        <Settings className="h-4 w-4" />
      </Button>
      <Button
        onClick={() => {
          setShowForm(true);
          setEditingItem(null);
        }}
        size="sm"
        className="h-8 gap-1 bg-emerald-600 text-white hover:bg-emerald-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar
      </Button>
    </>
  );

  return (
    <>
      <CadastroWorkspace
        mode={showForm ? "detail" : "list"}
        title={showForm ? detailTitle : "Categorias de produtos"}
        subtitle={
          showForm
            ? "Hierarquia e descrição; salve para voltar à lista."
            : "Cadastro global de categorias usadas em produtos."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={showForm ? null : listToolbar}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <FormularioCategoriaProduto
              key="form"
              variant="embedded"
              initialData={editingItem}
              onSubmit={handleSubmit}
              onCancel={closeForm}
              categoriasExistentes={categorias}
            />
          ) : (
            <TabelaCategoriasProduto
              key="table"
              categorias={categorias}
              onEdit={handleEdit}
              onDelete={handleRequestDelete}
              showConfigColunas={showConfigColunas}
              setShowConfigColunas={setShowConfigColunas}
            />
          )}
        </AnimatePresence>
      </CadastroWorkspace>

      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Confirmar exclusão"
        description={
          deleteState.ids.length > 1
            ? `Deseja excluir ${deleteState.ids.length} categorias selecionadas?`
            : "Deseja excluir esta categoria?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

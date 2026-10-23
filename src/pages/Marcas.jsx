import React, { useState } from "react";
import { listarMarcasDaEmpresa, criarMarca, atualizarMarca, excluirMarcas } from "@/services/marcaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Plus, Settings } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import FormularioMarca from "@/components/marcas/FormularioMarca";
import TabelaMarcas from "@/components/marcas/TabelaMarcas";

export default function Marcas() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const queryClient = useQueryClient();
  const empresaId = localStorage.getItem("empresa_selecionada_id");

  const { data: marcas = [], isLoading } = useQuery({
    queryKey: ["marcas", empresaId],
    queryFn: () => listarMarcasDaEmpresa(empresaId),
    enabled: !!empresaId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => criarMarca({ dados: data, empresaId, marcasDaEmpresa: marcas }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Marca criada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar a marca.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => atualizarMarca(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      setShowForm(false);
      setEditingItem(null);
      toast.success("Marca atualizada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar a marca.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => excluirMarcas(ids),
    onSuccess: ({ excluidas, falhas }) => {
      queryClient.invalidateQueries({ queryKey: ["marcas"] });
      if (excluidas.length) {
        toast.success(
          excluidas.length === 1 ? "Marca excluída!" : `${excluidas.length} marcas excluídas!`,
        );
      }
      if (falhas.length) {
        toast.error(
          falhas.length === 1 ? "1 marca não pôde ser excluída." : `${falhas.length} marcas não puderam ser excluídas.`,
        );
      }
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível excluir.")),
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

  const detailTitle = editingItem?.id ? "Editar marca" : "Nova marca";

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
        title={showForm ? detailTitle : "Marcas"}
        subtitle={
          showForm
            ? "Preencha os dados e salve para voltar à lista."
            : "Marcas de produto vinculadas à empresa selecionada."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={showForm ? null : listToolbar}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <FormularioMarca
              key="form"
              variant="embedded"
              initialData={editingItem}
              onSubmit={handleSubmit}
              onCancel={closeForm}
            />
          ) : (
            <TabelaMarcas
              key="table"
              marcas={marcas}
              onEdit={handleEdit}
              onDelete={handleRequestDelete}
              isLoading={isLoading}
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
            ? `Deseja excluir ${deleteState.ids.length} marcas?`
            : "Deseja excluir esta marca?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

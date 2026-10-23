import React, { useState } from "react";
import {
  listarSetoresDaEmpresa,
  criarSetor,
  atualizarSetor,
  excluirSetor,
} from "@/services/setorService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import TabelaSetores from "@/components/setores/TabelaSetores";
import FormularioSetor from "@/components/setores/FormularioSetor";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
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

  const { data: setores = [], isLoading } = useQuery({
    queryKey: ["setores", empresaSelecionadaId],
    queryFn: async () => {
      return listarSetoresDaEmpresa(empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const createMutation = useMutation({
    mutationFn: (data) => criarSetor(data, { empresaId: empresaSelecionadaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores", empresaSelecionadaId] });
      toast.success("Setor cadastrado com sucesso!");
      setShowForm(false);
      setEditando(null);
    },
    onError: () => toast.error("Erro ao cadastrar setor")
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarSetor(id, data, { registroAnterior: oldData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setores", empresaSelecionadaId] });
      toast.success("Setor atualizado!");
      setShowForm(false);
      setEditando(null);
    },
    onError: () => toast.error("Erro ao atualizar setor")
  });

  const deleteMutation = useMutation({
    /** @param {string} id */
    mutationFn: (id) => excluirSetor(id),
    onError: (error) => {
      setShowDelete(false);
      setDeletarId(null);
      toast.error(getApiErrorMessage(error, "Erro ao excluir setor"));
    }
  });

  const closeForm = () => {
    setShowForm(false);
    setEditando(null);
  };

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

  const detailTitle = editando?.id ? "Editar setor / fazenda" : "Novo setor / fazenda";

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
          setEditando(null);
          setShowForm(true);
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
        title={showForm ? detailTitle : "Setores / fazendas"}
        subtitle={
          showForm
            ? "Preencha os dados e salve para voltar à lista."
            : "Setores vinculados à empresa selecionada."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={showForm ? null : listToolbar}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <FormularioSetor
              key="form"
              variant="embedded"
              initialData={editando || getInitialFormData()}
              isEditing={!!editando}
              onSubmit={handleSubmit}
              onCancel={closeForm}
            />
          ) : (
            <TabelaSetores
              key="table"
              setores={setores}
              isLoading={isLoading}
              onEdit={handleEdit}
              onDelete={(id) => {
                setDeletarId(id);
                setShowDelete(true);
              }}
              showConfigColunas={showConfigColunas}
              setShowConfigColunas={setShowConfigColunas}
            />
          )}
        </AnimatePresence>
      </CadastroWorkspace>

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Exclusão indisponível"
        description="A exclusão de setores está indisponível enquanto o cadastro é migrado para o sistema próprio. As áreas, tarefas e movimentações que apontam para o setor ainda vivem na plataforma antiga, e apagá-lo agora deixaria esses vínculos apontando para o vazio."
        onConfirm={() => deleteMutation.mutate(deletarId)}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </>
  );
}

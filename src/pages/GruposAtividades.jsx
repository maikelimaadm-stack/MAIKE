import React, { useState } from "react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import FormularioGrupoAtividade from "@/components/grupos-atividades/FormularioGrupoAtividade";
import TabelaGruposAtividades from "@/components/grupos-atividades/TabelaGruposAtividades";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { listarGrupos, criarGrupo, atualizarGrupo, excluirGrupos } from "@/services/tarefaCadastroService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";

export default function GruposAtividades() {
  const [showForm, setShowForm] = useState(false);
  const [editingGrupo, setEditingGrupo] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const queryClient = useQueryClient();

  const { data: grupos = [] } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => listarGrupos(),
    initialData: [],
  });

  const createGrupoMutation = useMutation({
    mutationFn: (data) => criarGrupo(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      setShowForm(false);
      setEditingGrupo(null);
      toast.success("Grupo cadastrado!");
    },
  });

  const updateGrupoMutation = useMutation({
    mutationFn: ({ id, data, oldData }) => atualizarGrupo({ id, dados: data, oldData }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
      setShowForm(false);
      setEditingGrupo(null);
      toast.success("Grupo atualizado!");
    },
  });

  const handleSubmit = (data) => {
    if (editingGrupo) {
      updateGrupoMutation.mutate({ id: editingGrupo.id, data, oldData: editingGrupo });
    } else {
      createGrupoMutation.mutate(data);
    }
  };

  const handleEdit = (grupo) => {
    setEditingGrupo(grupo);
    setShowForm(true);
  };

  const handleRequestDelete = (ids) => {
    setDeleteState({ open: true, ids: Array.isArray(ids) ? ids : [ids] });
  };

  /**
   * O service devolve resultado parcial explícito. O laço anterior engolia toda
   * falha num `catch {}` vazio: excluir cinco e ver "1 grupo excluído!" não
   * dizia se os outros quatro foram bloqueados ou se a rede caiu.
   */
  const handleConfirmDelete = async () => {
    const ids = deleteState.ids;
    setDeleteState({ open: false, ids: [] });

    try {
      const { excluidos, bloqueados } = await excluirGrupos(ids, { grupos });

      if (excluidos.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
        toast.success(excluidos.length === 1 ? "Grupo excluído!" : `${excluidos.length} grupos excluídos!`);
      }
      if (bloqueados.length > 0) {
        toast.error(
          bloqueados.length === 1
            ? "1 grupo não pôde ser excluído: existem registros vinculados."
            : `${bloqueados.length} grupos não puderam ser excluídos: existem registros vinculados.`
        );
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Não foi possível excluir."));
    }
  };

  const handleExport = () => {
    const csv = [
      ["Nome", "Ativo", "Descrição", "Observações", "Criado em", "Atualizado em"].join(";"),
      ...grupos.map((g) => [
        g.nome_grupo || "",
        g.ativo ? "SIM" : "NÃO",
        g.descricao || "",
        g.observacoes || "",
        g.created_date || "",
        g.updated_date || "",
      ].join(";")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `grupos_atividades_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast.success("Exportado!");
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="font-bold text-slate-800">Cadastro de Grupos de Atividades</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7">
            <Settings className="w-4 h-4" />
          </Button>
          <Button onClick={handleExport} variant="outline" size="sm" className="h-7 text-xs">
            Exportar
          </Button>
          <Button onClick={() => { setShowForm(true); setEditingGrupo(null); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">
            Adicionar
          </Button>
        </div>
      </div>}

      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioGrupoAtividade
            key="form"
            initialData={editingGrupo}
            isEditing={!!editingGrupo}
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingGrupo(null); }}
          />
        ) : (
          <TabelaGruposAtividades
            key="table"
            grupos={grupos}
            onEdit={handleEdit}
            onDelete={handleRequestDelete}
            showConfigColunas={showConfigColunas}
            setShowConfigColunas={setShowConfigColunas}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Confirmar exclusão"
        description={deleteState.ids.length > 1 ? `Deseja realmente excluir ${deleteState.ids.length} grupos selecionados?` : "Deseja realmente excluir este grupo?"}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
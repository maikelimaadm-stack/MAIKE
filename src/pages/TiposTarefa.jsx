import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import TabelaTiposTarefa from "@/components/tipos-tarefa/TabelaTiposTarefa";
import FormularioTipoTarefa from "@/components/tipos-tarefa/FormularioTipoTarefa";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { ensureDeleteAllowed } from "@/lib/entityDeleteGuards";

export default function TiposTarefa() {
  const [showForm, setShowForm] = useState(false);
  const [editingTipo, setEditingTipo] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const queryClient = useQueryClient();

  const { data: grupos = [] } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: () => base44.entities.GrupoAtividade.list(),
    initialData: [],
  });

  const { data: tipos = [] } = useQuery({
    queryKey: ["tipos-tarefa"],
    queryFn: () => base44.entities.TipoTarefa.list("-updated_date"),
    initialData: [],
  });

  const createTipoMutation = useMutation({
    mutationFn: (data) => base44.entities.TipoTarefa.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      setShowForm(false);
      setEditingTipo(null);
      toast.success("Tipo cadastrado!");
    },
  });

  const updateTipoMutation = useMutation({
    mutationFn: async ({ id, data, oldData }) => {
      const updated = await base44.entities.TipoTarefa.update(id, data);
      await base44.functions.invoke("syncEntityReferences", {
        event: { type: "update", entity_name: "TipoTarefa" },
        data: updated,
        old_data: oldData,
      });
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      setShowForm(false);
      setEditingTipo(null);
      toast.success("Tipo atualizado!");
    },
  });

  const deleteTipoMutation = useMutation({
    mutationFn: (id) => base44.entities.TipoTarefa.delete(id),
  });

  const handleSubmit = (data) => {
    if (editingTipo) updateTipoMutation.mutate({ id: editingTipo.id, data, oldData: editingTipo });
    else createTipoMutation.mutate(data);
  };

  const handleEdit = (tipo) => {
    setEditingTipo(tipo);
    setShowForm(true);
  };

  const handleConfirmDelete = async () => {
    const ids = deleteState.ids;
    setDeleteState({ open: false, ids: [] });
    let deletedCount = 0;
    for (const id of ids) {
      try {
        await ensureDeleteAllowed(base44, "TipoTarefa", id);
        await deleteTipoMutation.mutateAsync(id);
        deletedCount += 1;
      } catch { /* falha ignorada intencionalmente: operação best-effort */ }
    }
    if (deletedCount > 0) {
      queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] });
      toast.success(deletedCount === 1 ? "Tipo excluído!" : `${deletedCount} tipos excluídos!`);
    }
  };

  const handleExport = () => {
    const csv = [
      ["Tipo", "Grupo", "Ativo", "Descrição", "Criado em", "Atualizado em"].join(";"),
      ...tipos.map((t) => [
        t.nome_tipo || "",
        t.grupo_atividade_nome || grupos.find((g) => g.id === t.grupo_atividade_id)?.nome_grupo || "",
        t.ativo ? "SIM" : "NÃO",
        t.descricao || "",
        t.created_date || "",
        t.updated_date || "",
      ].join(";")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `tipos_tarefa_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast.success("Exportado!");
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="font-bold text-slate-800">Cadastro de Tipos de Tarefa</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7"><Settings className="w-4 h-4" /></Button>
          <Button onClick={handleExport} variant="outline" size="sm" className="h-7 text-xs">Exportar</Button>
          <Button onClick={() => { setShowForm(true); setEditingTipo(null); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Adicionar</Button>
        </div>
      </div>}

      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioTipoTarefa
            key="form"
            initialData={editingTipo}
            grupos={grupos}
            isEditing={!!editingTipo}
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingTipo(null); }}
          />
        ) : (
          <TabelaTiposTarefa
            key="table"
            tipos={tipos}
            grupos={grupos}
            onEdit={handleEdit}
            onDelete={(ids) => setDeleteState({ open: true, ids: Array.isArray(ids) ? ids : [ids] })}
            showConfigColunas={showConfigColunas}
            setShowConfigColunas={setShowConfigColunas}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Confirmar exclusão"
        description={deleteState.ids.length > 1 ? `Deseja realmente excluir ${deleteState.ids.length} tipos selecionados?` : "Deseja realmente excluir este tipo de tarefa?"}
        onConfirm={handleConfirmDelete}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </div>
  );
}
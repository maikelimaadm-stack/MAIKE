import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { normalizeTaskPriority } from "@/components/mapa/FormularioTarefaMapa";
import TabelaLancamentosTarefas from "@/components/tarefas/TabelaLancamentosTarefas";
import { Settings2 } from "lucide-react";

export default function LancamentosTarefas() {
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [deleteIds, setDeleteIds] = useState([]);
  const [showConfigColunas, setShowConfigColunas] = useState(false);

  const { data: tarefas = [] } = useQuery({
    queryKey: ["gestao-tarefas-unificada", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list("-updated_date");
      return all.filter((item) => item.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    initialData: []
  });

  const { data: iconesPrioridade = [] } = useQuery({
    queryKey: ["icones-prioridade-gestao-tarefas"],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((icone) => icone.ativo !== false && icone.tipo_entidade === "Prioridade Tarefa");
    },
    initialData: []
  });

  const grupos = useMemo(() => [...new Set(tarefas.map((item) => item.grupo_atividade_nome).filter(Boolean))].sort(), [tarefas]);

  const getIconePrioridade = (prioridade) => {
    const normalize = (value) => (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const prioridadeNormalizada = normalize(normalizeTaskPriority(prioridade));
    return iconesPrioridade.find((icone) => normalize(icone.categoria) === prioridadeNormalizada);
  };

  const deleteMutation = useMutation({
    mutationFn: async (ids) => {
      for (const id of ids) await base44.entities.LancamentoTarefa.delete(id);
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["gestao-tarefas-unificada"] });
      queryClient.invalidateQueries({ queryKey: ["mapa-tarefas"] });
      queryClient.invalidateQueries({ queryKey: ["tarefas-mapa"] });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success(ids.length === 1 ? "Tarefa excluída!" : `${ids.length} tarefas excluídas!`);
      setDeleteIds([]);
    }
  });

  const handleExport = () => {
    const csv = [
    ["Título", "Status", "Prioridade", "Grupo", "Tipo", "Área", "Responsável", "Prazo"].join(";"),
    ...tarefas.map((t) => [
    t.titulo || "",
    t.status || "",
    normalizeTaskPriority(t.prioridade) || "",
    t.grupo_atividade_nome || "",
    t.tipo_tarefa_nome || t.tipo || "",
    t.area_nome || "",
    t.responsavel || "",
    t.data_prevista || ""].
    join(";"))].
    join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `gestao_tarefas_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    toast.success("Exportado!");
  };

  return (
    <div className="flex flex-col p-1 md:p-1 gap-1 h-[calc(100dvh-80px)] md:h-[calc(100dvh-50px)] overflow-hidden">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Gestão de Tarefas</h1>
          
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setShowConfigColunas(true)}>
            <Settings2 className="w-3.5 h-3.5" />
          </Button>
          <Link to={createPageUrl("LancamentoTarefaForm")}>
            <Button size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">
              Adicionar
            </Button>
          </Link>
        </div>
      </div>

      <TabelaLancamentosTarefas
        tarefas={tarefas}
        onDelete={(ids) => setDeleteIds(Array.isArray(ids) ? ids : [ids])}
        normalizeTaskPriority={normalizeTaskPriority}
        showConfigColunas={showConfigColunas}
        setShowConfigColunas={setShowConfigColunas} />
      

      <ConfirmDialog
        open={deleteIds.length > 0}
        onOpenChange={(open) => !open && setDeleteIds([])}
        title="Confirmar exclusão"
        description={deleteIds.length > 1 ? `Deseja realmente excluir ${deleteIds.length} tarefas selecionadas?` : "Deseja realmente excluir esta tarefa?"}
        onConfirm={() => deleteMutation.mutate(deleteIds)}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive" />
      
    </div>);

}
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Progress } from "@/components/ui/progress";
import FormularioLancamentoAbastecimento from "@/components/maquinas/FormularioLancamentoAbastecimento";
import TabelaLancamentosAbastecimento from "@/components/maquinas/TabelaLancamentosAbastecimento";

export default function LancamentosAbastecimento() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [selecionados, setSelecionados] = useState([]);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState(null);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  const { data: abastecimentos = [] } = useQuery({
    queryKey: ["abastecimentos", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AbastecimentoMaquina.list();
      return all.filter((item) => item.empresa_id === empresaSelecionadaId).sort((a, b) => new Date(b.data_abastecimento) - new Date(a.data_abastecimento));
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: async (item) => {
      const movimentacoes = await base44.entities.MovimentacaoEstoque.filter({ referencia: item.id });
      for (const mov of movimentacoes) {
        for (const lote of mov.lotes_consumidos || []) {
          const loteAtual = await base44.entities.EstoqueLoteNota.get(lote.lote_id);
          await base44.entities.EstoqueLoteNota.update(lote.lote_id, {
            quantidade_disponivel: (loteAtual.quantidade_disponivel || 0) + (lote.quantidade_consumida || 0),
            status: "Disponivel",
          });
        }
        await base44.entities.MovimentacaoEstoque.delete(mov.id);
      }
      if (item.maquina_id && item.medicao != null) {
        const historico = abastecimentos.filter((a) => a.maquina_id === item.maquina_id && a.id !== item.id && a.medicao != null).sort((a, b) => new Date(b.data_abastecimento) - new Date(a.data_abastecimento));
        const medicaoAnterior = historico[0]?.medicao;
        if (medicaoAnterior != null) {
          await base44.entities.Maquina.update(item.maquina_id, { medicao_atual: medicaoAnterior });
        }
      }
      await base44.entities.AbastecimentoMaquina.delete(item.id);
    },
    onSuccess: () => {
      toast.success("Abastecimento excluído e estoque revertido");
      queryClient.invalidateQueries({ queryKey: ["abastecimentos"] });
      queryClient.invalidateQueries({ queryKey: ["maquinas-abastecimento"] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="font-bold text-slate-800">Lançamento de Abastecimento</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7">
            <Settings className="w-4 h-4" />
          </Button>
          <Button onClick={() => { setEditingItem(null); setShowForm(true); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring shadow h-7 hover:bg-emerald-600">
            Adicionar
          </Button>
        </div>
      </div>}

      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioLancamentoAbastecimento
            abastecimento={editingItem}
            onSave={() => {
              setShowForm(false);
              setEditingItem(null);
              queryClient.invalidateQueries({ queryKey: ["abastecimentos"] });
              queryClient.invalidateQueries({ queryKey: ["maquinas-abastecimento"] });
            }}
            onCancel={() => { setShowForm(false); setEditingItem(null); }}
          />
        ) : (
          <motion.div key="table" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-1">
            {isDeletingBulk && (
              <Card className="rounded-xl border bg-card text-card-foreground shadow">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-700"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Excluindo abastecimentos selecionados...</div>
                  <Progress value={deleteProgress.total ? deleteProgress.current / deleteProgress.total * 100 : 0} />
                </CardContent>
              </Card>
            )}
            <TabelaLancamentosAbastecimento
              abastecimentos={abastecimentos}
              selecionados={selecionados}
              onSelecionadosChange={setSelecionados}
              onEdit={(item) => { setEditingItem(item); setShowForm(true); }}
              onDelete={(item) => setDeleteConfirmItem(item)}
              showConfigColunas={showConfigColunas}
              setShowConfigColunas={setShowConfigColunas}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog open={!!deleteConfirmItem} onOpenChange={() => setDeleteConfirmItem(null)} title="Confirmar exclusão" description="Ao excluir, o estoque será revertido e a medição do ativo será ajustada para o valor anterior disponível." onConfirm={() => { deleteMutation.mutate(deleteConfirmItem); setDeleteConfirmItem(null); }} confirmText="Excluir" cancelText="Cancelar" variant="destructive" />
    </div>
  );
}
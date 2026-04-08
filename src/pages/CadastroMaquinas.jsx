import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Progress } from "@/components/ui/progress";
import FormularioMaquina from "@/components/maquinas/FormularioMaquina";
import FichaMaquina from "@/components/maquinas/FichaMaquina";
import TabelaMaquinas from "@/components/maquinas/TabelaMaquinas";

export default function CadastroMaquinas() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showFicha, setShowFicha] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [editingMaquina, setEditingMaquina] = useState(null);
  const [selectedMaquina, setSelectedMaquina] = useState(null);
  const [selecionados, setSelecionados] = useState([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  const { data: maquinas = [], isLoading } = useQuery({
    queryKey: ["maquinas", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter((m) => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Maquina.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maquinas"] });
      toast.success("Máquina excluída");
    },
  });


  const executeBulkDelete = async () => {
    setBulkDeleteConfirm(false);
    setIsDeletingBulk(true);
    setDeleteProgress({ current: 0, total: selecionados.length });
    let deleted = 0;
    for (const id of selecionados) {
      try {
        await deleteMutation.mutateAsync(id);
        deleted++;
        setDeleteProgress({ current: deleted, total: selecionados.length });
      } catch {
        // noop
      }
    }
    setTimeout(() => {
      setIsDeletingBulk(false);
      setSelecionados([]);
    }, 500);
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="font-bold text-slate-800">Cadastro de Máquinas</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!showForm &&
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7">
              <Settings className="w-4 h-4" />
            </Button>
          }

          {!showForm &&
          <Button onClick={() => { setEditingMaquina(null); setShowForm(true); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">
              Adicionar
            </Button>
          }
        </div>
      </div>}

      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioMaquina
            maquina={editingMaquina}
            onSave={() => {
              setShowForm(false);
              setEditingMaquina(null);
              queryClient.invalidateQueries({ queryKey: ["maquinas"] });
            }}
            onCancel={() => { setShowForm(false); setEditingMaquina(null); }}
          />
        ) : (
          <motion.div key="table" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-1">
            {isDeletingBulk && (
              <Card className="rounded-xl border bg-card text-card-foreground shadow">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-700"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Excluindo máquinas selecionadas...</div>
                  <Progress value={deleteProgress.total ? deleteProgress.current / deleteProgress.total * 100 : 0} />
                </CardContent>
              </Card>
            )}

            <TabelaMaquinas
              maquinas={maquinas}
              selecionados={selecionados}
              onSelecionadosChange={setSelecionados}
              onView={(maquina) => { setSelectedMaquina(maquina); setShowFicha(true); }}
              onEdit={(maquina) => { setEditingMaquina(maquina); setShowForm(true); }}
              onDelete={(maquina) => setDeleteConfirmId(maquina.id)}
              showConfigColunas={showConfigColunas}
              setShowConfigColunas={setShowConfigColunas}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)} title="Confirmar exclusão" description="Tem certeza que deseja excluir esta máquina? Esta ação não pode ser desfeita." onConfirm={() => { deleteMutation.mutate(deleteConfirmId); setDeleteConfirmId(null); }} confirmText="Excluir" cancelText="Cancelar" variant="destructive" />
      <ConfirmDialog open={bulkDeleteConfirm} onOpenChange={() => setBulkDeleteConfirm(false)} title="Confirmar exclusão" description={`Tem certeza que deseja excluir ${selecionados.length} máquina(s)? Esta ação não pode ser desfeita.`} onConfirm={executeBulkDelete} confirmText="Excluir" cancelText="Cancelar" variant="destructive" />

      <Dialog open={showFicha} onOpenChange={setShowFicha}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Ficha da Máquina</DialogTitle></DialogHeader>
          {selectedMaquina && <FichaMaquina maquina={selectedMaquina} onClose={() => setShowFicha(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
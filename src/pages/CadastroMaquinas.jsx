import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Settings2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Progress } from "@/components/ui/progress";
import FormularioMaquina from "@/components/maquinas/FormularioMaquina";
import FichaMaquina from "@/components/maquinas/FichaMaquina";
import TabelaMaquinas from "@/components/maquinas/TabelaMaquinas";

const TIPOS = ["Trator", "Colheitadeira", "Plantadeira", "Pulverizador", "Caminhão", "Pickup", "Motocicleta", "Implemento", "Outro"];

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
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroStatus, setFiltroStatus] = useState("todos");

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

  const maquinasFiltradas = useMemo(() => {
    return maquinas.filter((m) => {
      const matchBusca = !busca || [m.nome, m.codigo, m.placa, m.marca, m.modelo].some((value) => String(value || "").toLowerCase().includes(busca.toLowerCase()));
      const matchTipo = filtroTipo === "todos" || m.tipo === filtroTipo;
      const matchStatus = filtroStatus === "todos" || m.status === filtroStatus;
      return matchBusca && matchTipo && matchStatus;
    });
  }, [maquinas, busca, filtroTipo, filtroStatus]);

  const totalAtivas = useMemo(() => maquinas.filter((m) => m.status === "Ativo").length, [maquinas]);
  const totalManutencao = useMemo(() => maquinas.filter((m) => m.status === "Em Manutenção").length, [maquinas]);
  const totalTratores = useMemo(() => maquinas.filter((m) => m.tipo === "Trator").length, [maquinas]);

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
    <div className="p-4 md:p-6 space-y-1">
      {!showForm && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Máquinas e Veículos</h1>
            <p className="text-xs text-slate-600">Gestão de cadastro de máquinas, veículos e implementos</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowConfigColunas(true)}>
              <Settings2 className="w-3.5 h-3.5 mr-1" /> Configurar Colunas
            </Button>
            <Button onClick={() => { setEditingMaquina(null); setShowForm(true); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-3.5 h-3.5 mr-1" /> Nova Máquina
            </Button>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {showForm ? (
          <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <Card className="shadow-sm border-slate-300">
              <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
                <CardTitle className="text-sm font-semibold text-slate-900">{editingMaquina ? "Editar Máquina" : "Nova Máquina"}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <FormularioMaquina
                  maquina={editingMaquina}
                  onSave={() => {
                    setShowForm(false);
                    setEditingMaquina(null);
                    queryClient.invalidateQueries({ queryKey: ["maquinas"] });
                  }}
                  onCancel={() => { setShowForm(false); setEditingMaquina(null); }}
                />
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <motion.div key="table" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-1">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
              <Card className="rounded-xl border bg-card text-card-foreground shadow"><CardContent className="p-3 text-center"><div className="text-lg font-bold text-slate-700">{maquinas.length}</div><div className="text-xs text-slate-600">Total</div></CardContent></Card>
              <Card className="rounded-xl border bg-card text-card-foreground shadow"><CardContent className="p-3 text-center"><div className="text-lg font-bold text-slate-700">{totalAtivas}</div><div className="text-xs text-slate-600">Ativas</div></CardContent></Card>
              <Card className="rounded-xl border bg-card text-card-foreground shadow"><CardContent className="p-3 text-center"><div className="text-lg font-bold text-slate-700">{totalManutencao}</div><div className="text-xs text-slate-600">Em Manutenção</div></CardContent></Card>
              <Card className="rounded-xl border bg-card text-card-foreground shadow"><CardContent className="p-3 text-center"><div className="text-lg font-bold text-slate-700">{totalTratores}</div><div className="text-xs text-slate-600">Tratores</div></CardContent></Card>
            </div>

            <Card className="rounded-xl border bg-card text-card-foreground shadow">
              <CardContent className="p-3">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-1">
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-xs uppercase">Buscar</Label>
                    <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="BUSCAR MÁQUINAS..." className="h-7 text-xs uppercase" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Tipo</Label>
                    <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                      <SelectTrigger className="h-7 text-xs uppercase"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos" className="text-xs uppercase">Todos</SelectItem>
                        {TIPOS.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs uppercase">{tipo}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Status</Label>
                    <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                      <SelectTrigger className="h-7 text-xs uppercase"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos" className="text-xs uppercase">Todos</SelectItem>
                        <SelectItem value="Ativo" className="text-xs uppercase">Ativo</SelectItem>
                        <SelectItem value="Em Manutenção" className="text-xs uppercase">Em Manutenção</SelectItem>
                        <SelectItem value="Inativo" className="text-xs uppercase">Inativo</SelectItem>
                        <SelectItem value="Vendido" className="text-xs uppercase">Vendido</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2 flex items-end justify-end gap-2 flex-wrap">
                    {selecionados.length > 0 && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setBulkDeleteConfirm(true)}>
                        Excluir Selecionados ({selecionados.length})
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setBusca(""); setFiltroTipo("todos"); setFiltroStatus("todos"); }}>
                      <X className="w-3.5 h-3.5 mr-1" /> Limpar Filtros
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {isDeletingBulk && (
              <Card className="rounded-xl border bg-card text-card-foreground shadow">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-700"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Excluindo máquinas selecionadas...</div>
                  <Progress value={deleteProgress.total ? deleteProgress.current / deleteProgress.total * 100 : 0} />
                </CardContent>
              </Card>
            )}

            <TabelaMaquinas
              maquinas={maquinasFiltradas}
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
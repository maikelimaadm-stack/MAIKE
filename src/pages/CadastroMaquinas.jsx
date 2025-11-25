import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit2, Trash2, Truck, Fuel, Wrench, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import FormularioMaquina from "../components/maquinas/FormularioMaquina";
import FichaMaquina from "../components/maquinas/FichaMaquina";

const TIPOS = ["Trator", "Colheitadeira", "Plantadeira", "Pulverizador", "Caminhão", "Pickup", "Motocicleta", "Implemento", "Outro"];

export default function CadastroMaquinas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [showFicha, setShowFicha] = useState(false);
  const [editingMaquina, setEditingMaquina] = useState(null);
  const [selectedMaquina, setSelectedMaquina] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const queryClient = useQueryClient();

  const { data: maquinas = [], isLoading } = useQuery({
    queryKey: ['maquinas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Maquina.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      toast.success('Máquina excluída');
    },
  });

  const maquinasFiltradas = maquinas.filter(m => {
    if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false;
    if (filtroStatus !== 'todos' && m.status !== filtroStatus) return false;
    if (busca && !m.nome?.toLowerCase().includes(busca.toLowerCase()) && 
        !m.codigo?.toLowerCase().includes(busca.toLowerCase()) &&
        !m.placa?.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  const statusColors = {
    'Ativo': 'bg-emerald-100 text-emerald-800',
    'Em Manutenção': 'bg-amber-100 text-amber-800',
    'Inativo': 'bg-slate-100 text-slate-800',
    'Vendido': 'bg-red-100 text-red-800',
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Máquinas e Veículos</h1>
          <p className="text-xs text-slate-600">{maquinas.length} máquinas cadastradas</p>
        </div>
        <Button onClick={() => { setEditingMaquina(null); setShowForm(true); }} className="gap-2">
          <Plus className="w-4 h-4" />
          Nova Máquina
        </Button>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar por nome, código ou placa..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-10 h-9"
              />
            </div>
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="w-full md:w-40 h-9">
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os tipos</SelectItem>
                {TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-full md:w-40 h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="Ativo">Ativo</SelectItem>
                <SelectItem value="Em Manutenção">Em Manutenção</SelectItem>
                <SelectItem value="Inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {maquinasFiltradas.map(maquina => (
          <Card key={maquina.id} className="shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center">
                    {maquina.foto_url ? (
                      <img src={maquina.foto_url} alt={maquina.nome} className="w-full h-full object-cover rounded-lg" />
                    ) : (
                      <Truck className="w-6 h-6 text-slate-400" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm">{maquina.nome}</h3>
                    <p className="text-xs text-slate-500">{maquina.codigo || maquina.placa || '-'}</p>
                  </div>
                </div>
                <Badge className={statusColors[maquina.status] || 'bg-slate-100'}>
                  {maquina.status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div>
                  <span className="text-slate-500">Tipo:</span>
                  <span className="ml-1 font-medium">{maquina.tipo}</span>
                </div>
                <div>
                  <span className="text-slate-500">Marca:</span>
                  <span className="ml-1 font-medium">{maquina.marca || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Horímetro:</span>
                  <span className="ml-1 font-medium">{maquina.horimetro_atual ? `${maquina.horimetro_atual}h` : '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Km:</span>
                  <span className="ml-1 font-medium">{maquina.hodometro_atual ? `${maquina.hodometro_atual} km` : '-'}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => { setSelectedMaquina(maquina); setShowFicha(true); }}
                >
                  <Eye className="w-3 h-3 mr-1" />
                  Ver
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => { setEditingMaquina(maquina); setShowForm(true); }}
                >
                  <Edit2 className="w-3 h-3" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 text-red-600 hover:bg-red-50"
                  onClick={() => {
                    if (confirm('Excluir esta máquina?')) {
                      deleteMutation.mutate(maquina.id);
                    }
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {maquinasFiltradas.length === 0 && !isLoading && (
        <div className="text-center py-12 text-slate-500">
          <Truck className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Nenhuma máquina encontrada</p>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingMaquina ? 'Editar Máquina' : 'Nova Máquina'}</DialogTitle>
          </DialogHeader>
          <FormularioMaquina
            maquina={editingMaquina}
            onSave={() => {
              setShowForm(false);
              queryClient.invalidateQueries({ queryKey: ['maquinas'] });
            }}
            onCancel={() => setShowForm(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showFicha} onOpenChange={setShowFicha}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ficha da Máquina</DialogTitle>
          </DialogHeader>
          {selectedMaquina && (
            <FichaMaquina maquina={selectedMaquina} onClose={() => setShowFicha(false)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit2, Trash2, MapPin, Leaf, Calendar, TrendingUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import FormularioControleArea from "../components/areas/FormularioControleArea";

const STATUS_AREA = ["Pousio", "Preparação", "Plantada", "Em Desenvolvimento", "Colheita", "Colhida"];

export default function ControleAreas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editingControle, setEditingControle] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const queryClient = useQueryClient();

  const { data: controles = [], isLoading } = useQuery({
    queryKey: ['controle-areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ControleArea.list('-created_date');
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ControleArea.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['controle-areas'] });
      toast.success('Registro excluído');
    },
  });

  const controlesFiltrados = controles.filter(c => {
    if (filtroStatus !== 'todos' && c.status !== filtroStatus) return false;
    if (busca && !c.area_nome?.toLowerCase().includes(busca.toLowerCase()) &&
        !c.cultura?.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  const statusColors = {
    'Pousio': 'bg-slate-100 text-slate-700',
    'Preparação': 'bg-slate-100 text-slate-700',
    'Plantada': 'bg-slate-100 text-slate-700',
    'Em Desenvolvimento': 'bg-slate-100 text-slate-700',
    'Colheita': 'bg-slate-100 text-slate-700',
    'Colhida': 'bg-slate-100 text-slate-700',
  };

  // Resumo
  const totalAreaPlantada = controles.filter(c => ['Plantada', 'Em Desenvolvimento', 'Colheita'].includes(c.status))
    .reduce((sum, c) => sum + (c.area_plantada_ha || 0), 0);
  const producaoEstimada = controles.reduce((sum, c) => sum + (c.producao_estimada_kg || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Controle de Áreas</h1>
          <p className="text-xs text-slate-600">Gestão de culturas e produtividade</p>
        </div>
        <Button onClick={() => { setEditingControle(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
          <Plus className="w-3 h-3" />
          Novo Registro
        </Button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-slate-700">{totalAreaPlantada.toFixed(1)} ha</div>
            <div className="text-xs text-slate-600">Área Plantada</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-slate-700">{(producaoEstimada / 1000).toFixed(1)} t</div>
            <div className="text-xs text-slate-600">Produção Estimada</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-slate-700">{controles.filter(c => c.status === 'Colheita').length}</div>
            <div className="text-xs text-slate-600">Em Colheita</div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-slate-700">{controles.length}</div>
            <div className="text-xs text-slate-600">Total Registros</div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar por área ou cultura..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-10 h-9"
              />
            </div>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-full md:w-48 h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {STATUS_AREA.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {controlesFiltrados.map(ctrl => (
          <Card key={ctrl.id} className="shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                    <Leaf className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 text-sm">{ctrl.area_nome}</h3>
                    <p className="text-xs text-slate-500">{ctrl.cultura || 'Sem cultura'}</p>
                  </div>
                </div>
                <Badge className={statusColors[ctrl.status]}>{ctrl.status}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div>
                  <span className="text-slate-500">Área:</span>
                  <span className="ml-1 font-medium">{ctrl.area_plantada_ha || 0} ha</span>
                </div>
                <div>
                  <span className="text-slate-500">Variedade:</span>
                  <span className="ml-1 font-medium">{ctrl.variedade || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Plantio:</span>
                  <span className="ml-1 font-medium">
                    {ctrl.data_plantio ? format(new Date(ctrl.data_plantio), 'dd/MM/yy') : '-'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Prod. Est:</span>
                  <span className="ml-1 font-medium">
                    {ctrl.producao_estimada_kg ? `${(ctrl.producao_estimada_kg/1000).toFixed(1)}t` : '-'}
                  </span>
                </div>
              </div>

              {ctrl.produtividade_sc_ha && (
                <div className="flex items-center gap-1 text-xs text-slate-700 bg-slate-50 border border-slate-200 px-2 py-1 rounded mb-3">
                  <TrendingUp className="w-3 h-3" />
                  {ctrl.produtividade_sc_ha} sc/ha
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  onClick={() => { setEditingControle(ctrl); setShowForm(true); }}
                >
                  <Edit2 className="w-3 h-3 mr-1" />
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 text-red-600 hover:bg-red-50"
                  onClick={() => {
                    if (confirm('Excluir este registro?')) {
                      deleteMutation.mutate(ctrl.id);
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

      {controlesFiltrados.length === 0 && !isLoading && (
        <div className="text-center py-12 text-slate-500">
          <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Nenhum registro encontrado</p>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingControle ? 'Editar Registro' : 'Novo Registro'}</DialogTitle>
          </DialogHeader>
          <FormularioControleArea
            controle={editingControle}
            onSave={() => {
              setShowForm(false);
              queryClient.invalidateQueries({ queryKey: ['controle-areas'] });
            }}
            onCancel={() => setShowForm(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
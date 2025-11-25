import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit2, Trash2, Tractor, Calendar, MapPin } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import FormularioOperacao from "../components/operacoes/FormularioOperacao";

const TIPOS_OPERACAO = ["Gradagem", "Aração", "Plantio", "Pulverização", "Adubação", "Colheita", "Roçagem", "Calagem", "Dessecação", "Subsolagem", "Outro"];

export default function OperacoesAgricolas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editingOperacao, setEditingOperacao] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const queryClient = useQueryClient();

  const { data: operacoes = [], isLoading } = useQuery({
    queryKey: ['operacoes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.OperacaoAgricola.list('-data_inicio');
      return all.filter(o => o.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.OperacaoAgricola.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operacoes'] });
      toast.success('Operação excluída');
    },
  });

  const operacoesFiltradas = operacoes.filter(o => {
    if (filtroTipo !== 'todos' && o.tipo_operacao !== filtroTipo) return false;
    if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false;
    if (busca && !o.area_nome?.toLowerCase().includes(busca.toLowerCase()) &&
        !o.maquina_nome?.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  const statusColors = {
    'Planejada': 'bg-blue-100 text-blue-800',
    'Em Andamento': 'bg-amber-100 text-amber-800',
    'Concluída': 'bg-emerald-100 text-emerald-800',
    'Cancelada': 'bg-red-100 text-red-800',
  };

  // Resumo
  const totalHectares = operacoes.filter(o => o.status === 'Concluída').reduce((sum, o) => sum + (o.hectares_trabalhados || 0), 0);
  const totalHoras = operacoes.filter(o => o.status === 'Concluída').reduce((sum, o) => sum + (o.horas_trabalhadas || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Operações Agrícolas</h1>
          <p className="text-xs text-slate-600">{operacoes.length} operações registradas</p>
        </div>
        <Button onClick={() => { setEditingOperacao(null); setShowForm(true); }} className="gap-2">
          <Plus className="w-4 h-4" />
          Nova Operação
        </Button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-emerald-700">{totalHectares.toFixed(1)} ha</div>
            <div className="text-xs text-emerald-600">Total Trabalhado</div>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-blue-700">{totalHoras.toFixed(1)}h</div>
            <div className="text-xs text-blue-600">Horas Trabalhadas</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-amber-700">{operacoes.filter(o => o.status === 'Em Andamento').length}</div>
            <div className="text-xs text-amber-600">Em Andamento</div>
          </CardContent>
        </Card>
        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="p-3 text-center">
            <div className="text-lg font-bold text-purple-700">{operacoes.filter(o => o.status === 'Concluída').length}</div>
            <div className="text-xs text-purple-600">Concluídas</div>
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
                placeholder="Buscar por área ou máquina..."
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
                {TIPOS_OPERACAO.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-full md:w-40 h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="Planejada">Planejada</SelectItem>
                <SelectItem value="Em Andamento">Em Andamento</SelectItem>
                <SelectItem value="Concluída">Concluída</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      <div className="space-y-3">
        {operacoesFiltradas.map(op => (
          <Card key={op.id} className="shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                    <Tractor className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-900 text-sm">{op.tipo_operacao}</h3>
                      <Badge className={statusColors[op.status]}>{op.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {op.area_nome || '-'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Tractor className="w-3 h-3" />
                        {op.maquina_nome || '-'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {op.data_inicio ? format(new Date(op.data_inicio), 'dd/MM/yyyy') : '-'}
                      </span>
                    </div>
                    <div className="flex gap-4 mt-2 text-xs">
                      {op.hectares_trabalhados && (
                        <span><strong>{op.hectares_trabalhados}</strong> ha</span>
                      )}
                      {op.horas_trabalhadas && (
                        <span><strong>{op.horas_trabalhadas}</strong> horas</span>
                      )}
                      {op.combustivel_consumido && (
                        <span><strong>{op.combustivel_consumido}</strong> L</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => { setEditingOperacao(op); setShowForm(true); }}
                  >
                    <Edit2 className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 text-red-600 hover:bg-red-50"
                    onClick={() => {
                      if (confirm('Excluir esta operação?')) {
                        deleteMutation.mutate(op.id);
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {operacoesFiltradas.length === 0 && !isLoading && (
        <div className="text-center py-12 text-slate-500">
          <Tractor className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>Nenhuma operação encontrada</p>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingOperacao ? 'Editar Operação' : 'Nova Operação'}</DialogTitle>
          </DialogHeader>
          <FormularioOperacao
            operacao={editingOperacao}
            onSave={() => {
              setShowForm(false);
              queryClient.invalidateQueries({ queryKey: ['operacoes'] });
            }}
            onCancel={() => setShowForm(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
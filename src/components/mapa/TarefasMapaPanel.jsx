import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, CheckCircle, Clock, MapPin, Calendar, Trash2, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";

const PRIORIDADE_CORES = {
  'Baixa': 'bg-slate-100 text-slate-700',
  'Média': 'bg-blue-100 text-blue-700',
  'Alta': 'bg-amber-100 text-amber-700'
};

const STATUS_CORES = {
  'Pendente': 'bg-yellow-100 text-yellow-700',
  'Em Andamento': 'bg-blue-100 text-blue-700',
  'Concluída': 'bg-emerald-100 text-emerald-700',
  'Cancelada': 'bg-slate-100 text-slate-500'
};

export default function TarefasMapaPanel({ areaId, areaNome, loteId, loteNome, pontoSuplId, onClose, initialCoordinates, openCreateOnMount = false, initialDraft = null, onRequestSelectLocation }) {
  const [showForm, setShowForm] = useState(false);
  const [editingTarefa, setEditingTarefa] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('ativas');
  
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ['tarefas-mapa', empresaSelecionadaId, areaId, loteId, pontoSuplId],
    queryFn: async () => {
      const all = await base44.entities.TarefaMapa.list('-created_date');
      let filtered = all.filter(t => t.empresa_id === empresaSelecionadaId);
      
      if (areaId) filtered = filtered.filter(t => t.area_id === areaId);
      if (loteId) filtered = filtered.filter(t => t.lote_id === loteId);
      if (pontoSuplId) filtered = filtered.filter(t => t.ponto_suplementacao_id === pontoSuplId);
      
      return filtered;
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesPrioridade = [] } = useQuery({
    queryKey: ['icones-prioridade-tarefa-mapa'],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((icone) => icone.ativo !== false && icone.tipo_entidade === 'Prioridade Tarefa');
    },
    initialData: [],
  });

  const normalizarPrioridade = (valor) =>
    (valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

  const getIconePrioridade = (prioridade) =>
    iconesPrioridade.find((icone) => normalizarPrioridade(icone.categoria) === normalizarPrioridade(normalizeTaskPriority(prioridade)));

  useEffect(() => {
    if (openCreateOnMount) {
      setEditingTarefa(null);
      setShowForm(true);
    }
  }, [openCreateOnMount, initialCoordinates]);

  const tarefasFiltradas = tarefas.filter(t => {
    if (filtroStatus === 'ativas') return t.status === 'Pendente' || t.status === 'Em Andamento';
    if (filtroStatus === 'concluidas') return t.status === 'Concluída';
    return true;
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TarefaMapa.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success('Tarefa criada!');
      setShowForm(false);
      setEditingTarefa(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TarefaMapa.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success('Tarefa atualizada!');
      setShowForm(false);
      setEditingTarefa(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TarefaMapa.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success('Tarefa excluída!');
    }
  });

  const handleConcluir = (tarefa) => {
    updateMutation.mutate({
      id: tarefa.id,
      data: { status: 'Concluída', data_conclusao: new Date().toISOString().split('T')[0] }
    });
  };

  const pendentes = tarefas.filter(t => t.status === 'Pendente').length;
  const emAndamento = tarefas.filter(t => t.status === 'Em Andamento').length;
  const altas = tarefas.filter(t => normalizeTaskPriority(t.prioridade) === 'Alta' && t.status !== 'Concluída').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">Tarefas</h3>
          {(areaNome || loteNome) && (
            <p className="text-xs text-slate-500">{areaNome || loteNome}</p>
          )}
        </div>
        <Button size="sm" onClick={() => { setEditingTarefa(null); setShowForm(true); }} className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
          <Plus className="w-3 h-3" /> Nova Tarefa
        </Button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-yellow-50 rounded p-2 text-center">
          <div className="text-lg font-bold text-yellow-700">{pendentes}</div>
          <div className="text-[10px] text-yellow-600">Pendentes</div>
        </div>
        <div className="bg-blue-50 rounded p-2 text-center">
          <div className="text-lg font-bold text-blue-700">{emAndamento}</div>
          <div className="text-[10px] text-blue-600">Em Andamento</div>
        </div>
        <div className="bg-red-50 rounded p-2 text-center">
          <div className="text-lg font-bold text-red-700">{altas}</div>
          <div className="text-[10px] text-red-600">Alta prioridade</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        <Button 
          variant={filtroStatus === 'ativas' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setFiltroStatus('ativas')}
          className="h-7 text-xs"
        >
          Ativas
        </Button>
        <Button 
          variant={filtroStatus === 'concluidas' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setFiltroStatus('concluidas')}
          className="h-7 text-xs"
        >
          Concluídas
        </Button>
        <Button 
          variant={filtroStatus === 'todas' ? 'default' : 'outline'} 
          size="sm" 
          onClick={() => setFiltroStatus('todas')}
          className="h-7 text-xs"
        >
          Todas
        </Button>
      </div>

      {/* Lista de Tarefas */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="text-center py-4 text-xs text-slate-500">Carregando...</div>
        ) : tarefasFiltradas.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhuma tarefa encontrada</p>
          </div>
        ) : (
          tarefasFiltradas.map(tarefa => (
            <Card key={tarefa.id} className="shadow-sm">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-slate-900 truncate">{tarefa.titulo}</span>
                      <div className="flex items-center gap-1">
                        {getIconePrioridade(tarefa.prioridade)?.icone_url && (
                          <img
                            src={getIconePrioridade(tarefa.prioridade).icone_url}
                            alt={normalizeTaskPriority(tarefa.prioridade)}
                            className="w-4 h-4 object-contain"
                          />
                        )}
                        <Badge className={`${PRIORIDADE_CORES[normalizeTaskPriority(tarefa.prioridade)]} text-[10px]`}>
                          {normalizeTaskPriority(tarefa.prioridade)}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                      <Badge variant="outline" className="text-[10px]">{tarefa.tipo}</Badge>
                      <Badge className={`${STATUS_CORES[tarefa.status]} text-[10px]`}>{tarefa.status}</Badge>
                      {tarefa.data_prevista && (
                        <span className="flex items-center gap-0.5">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(tarefa.data_prevista), 'dd/MM')}
                        </span>
                      )}
                      {tarefa.area_nome && (
                        <span className="flex items-center gap-0.5">
                          <MapPin className="w-3 h-3" />
                          {tarefa.area_nome}
                        </span>
                      )}
                    </div>
                    {tarefa.descricao && (
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2">{tarefa.descricao}</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {tarefa.status !== 'Concluída' && (
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => handleConcluir(tarefa)}
                        className="h-7 w-7 text-emerald-600 hover:bg-emerald-50"
                        title="Concluir"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => { setEditingTarefa(tarefa); setShowForm(true); }}
                      className="h-7 w-7 text-blue-600 hover:bg-blue-50"
                      title="Editar"
                    >
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => {
                        if (confirm('Excluir esta tarefa?')) {
                          deleteMutation.mutate(tarefa.id);
                        }
                      }}
                      className="h-7 w-7 text-red-600 hover:bg-red-50"
                      title="Excluir"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Dialog de Formulário */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{editingTarefa ? 'Editar Tarefa' : 'Nova Tarefa'}</DialogTitle>
          </DialogHeader>
          <FormularioTarefaMapa
            tarefa={editingTarefa}
            areaId={areaId}
            areaNome={areaNome}
            loteId={loteId}
            loteNome={loteNome}
            pontoSuplId={pontoSuplId}
            initialCoordinates={initialCoordinates}
            initialDraft={initialDraft}
            onRequestSelectLocation={onRequestSelectLocation}
            onSubmit={(data) => {
              const payload = {
                ...data,
                prioridade: normalizeTaskPriority(data.prioridade),
                area_id: data.area_id || areaId,
                area_nome: data.area_nome || areaNome,
                lote_id: data.lote_id || loteId,
                lote_nome: data.lote_nome || loteNome,
                ponto_suplementacao_id: data.ponto_suplementacao_id || pontoSuplId,
                coordenadas: data.coordenadas,
              };
              if (editingTarefa) {
                updateMutation.mutate({ id: editingTarefa.id, data: payload });
              } else {
                createMutation.mutate({
                  ...payload,
                  empresa_id: empresaSelecionadaId,
                });
              }
            }}
            onCancel={() => { setShowForm(false); setEditingTarefa(null); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
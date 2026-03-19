import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, CheckCircle, Clock, AlertTriangle, MapPin, Calendar, Trash2, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const PRIORIDADE_CORES = {
  'Baixa': 'bg-slate-100 text-slate-700',
  'Normal': 'bg-blue-100 text-blue-700',
  'Alta': 'bg-amber-100 text-amber-700',
  'Urgente': 'bg-red-100 text-red-700'
};

const STATUS_CORES = {
  'Pendente': 'bg-yellow-100 text-yellow-700',
  'Em Andamento': 'bg-blue-100 text-blue-700',
  'Concluída': 'bg-emerald-100 text-emerald-700',
  'Cancelada': 'bg-slate-100 text-slate-500'
};

export default function TarefasMapaPanel({ areaId, areaNome, loteId, loteNome, pontoSuplId, onClose }) {
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
    iconesPrioridade.find((icone) => normalizarPrioridade(icone.categoria) === normalizarPrioridade(prioridade));

  const tarefasFiltradas = tarefas.filter(t => {
    if (filtroStatus === 'ativas') return t.status === 'Pendente' || t.status === 'Em Andamento';
    if (filtroStatus === 'concluidas') return t.status === 'Concluída';
    return true;
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TarefaMapa.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      toast.success('Tarefa criada!');
      setShowForm(false);
      setEditingTarefa(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TarefaMapa.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      toast.success('Tarefa atualizada!');
      setShowForm(false);
      setEditingTarefa(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TarefaMapa.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
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
  const urgentes = tarefas.filter(t => t.prioridade === 'Urgente' && t.status !== 'Concluída').length;

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
          <div className="text-lg font-bold text-red-700">{urgentes}</div>
          <div className="text-[10px] text-red-600">Urgentes</div>
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
                            alt={tarefa.prioridade}
                            className="w-4 h-4 object-contain"
                          />
                        )}
                        <Badge className={`${PRIORIDADE_CORES[tarefa.prioridade]} text-[10px]`}>
                          {tarefa.prioridade}
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
          <FormularioTarefa
            tarefa={editingTarefa}
            areaId={areaId}
            areaNome={areaNome}
            loteId={loteId}
            loteNome={loteNome}
            pontoSuplId={pontoSuplId}
            onSubmit={(data) => {
              if (editingTarefa) {
                updateMutation.mutate({ id: editingTarefa.id, data });
              } else {
                createMutation.mutate({
                  ...data,
                  empresa_id: empresaSelecionadaId,
                  area_id: data.area_id || areaId,
                  area_nome: data.area_nome || areaNome,
                  lote_id: data.lote_id || loteId,
                  lote_nome: data.lote_nome || loteNome,
                  ponto_suplementacao_id: pontoSuplId,
                  coordenadas: data.coordenadas
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

function FormularioTarefa({ tarefa, areaId, areaNome, loteId, loteNome, pontoSuplId, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  
  const { data: areas = [] } = useQuery({
    queryKey: ['areas-tarefas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId && !areaId,
  });

  // Buscar área para calcular coordenadas iniciais se areaId foi passado
  const { data: areaInicial } = useQuery({
    queryKey: ['area-inicial', areaId],
    queryFn: async () => {
      if (!areaId) return null;
      const all = await base44.entities.AreaPastagem.list();
      return all.find(a => a.id === areaId);
    },
    enabled: !!areaId && !tarefa?.coordenadas,
  });

  // Calcular coordenadas iniciais baseado na área
  const calcularCoordenadasArea = (area) => {
    if (!area?.coordenadas?.coords || area.coordenadas.coords.length === 0) return null;
    const lats = area.coordenadas.coords.map(c => c[0] || c.lat);
    const lngs = area.coordenadas.coords.map(c => c[1] || c.lng);
    return {
      lat: lats.reduce((a, b) => a + b, 0) / lats.length,
      lng: lngs.reduce((a, b) => a + b, 0) / lngs.length
    };
  };

  const coordenadasIniciais = tarefa?.coordenadas || (areaInicial ? calcularCoordenadasArea(areaInicial) : null);

  const [formData, setFormData] = useState({
    titulo: tarefa?.titulo || '',
    descricao: tarefa?.descricao || '',
    tipo: tarefa?.tipo || 'Manejo',
    prioridade: tarefa?.prioridade || 'Normal',
    status: tarefa?.status || 'Pendente',
    data_prevista: tarefa?.data_prevista || '',
    responsavel: tarefa?.responsavel || '',
    area_id: tarefa?.area_id || areaId || '',
    area_nome: tarefa?.area_nome || areaNome || '',
    coordenadas: coordenadasIniciais
  });

  // Atualizar coordenadas quando areaInicial carregar
  React.useEffect(() => {
    if (areaInicial && !formData.coordenadas) {
      const coords = calcularCoordenadasArea(areaInicial);
      if (coords) {
        setFormData(prev => ({ ...prev, coordenadas: coords }));
      }
    }
  }, [areaInicial]);

  const handleAreaChange = (selectedAreaId) => {
    const area = areas.find(a => a.id === selectedAreaId);
    if (area) {
      // Calcular centro da área para as coordenadas da tarefa
      let coords = null;
      if (area.coordenadas?.coords && area.coordenadas.coords.length > 0) {
        const lats = area.coordenadas.coords.map(c => c[0] || c.lat);
        const lngs = area.coordenadas.coords.map(c => c[1] || c.lng);
        coords = {
          lat: lats.reduce((a, b) => a + b, 0) / lats.length,
          lng: lngs.reduce((a, b) => a + b, 0) / lngs.length
        };
      }
      setFormData({ 
        ...formData, 
        area_id: selectedAreaId, 
        area_nome: area.nome,
        coordenadas: coords
      });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.titulo.trim()) {
      toast.error('Informe o título da tarefa');
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Título *</Label>
        <Input
          value={formData.titulo}
          onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
          placeholder="Ex: Verificar cerca do pasto 12"
          className="h-9 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo</Label>
          <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Manejo" className="text-xs">Manejo</SelectItem>
              <SelectItem value="Suplementação" className="text-xs">Suplementação</SelectItem>
              <SelectItem value="Manutenção" className="text-xs">Manutenção</SelectItem>
              <SelectItem value="Verificação" className="text-xs">Verificação</SelectItem>
              <SelectItem value="Sanitário" className="text-xs">Sanitário</SelectItem>
              <SelectItem value="Outro" className="text-xs">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Prioridade</Label>
          <Select value={formData.prioridade} onValueChange={(v) => setFormData({ ...formData, prioridade: v })}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Baixa" className="text-xs">Baixa</SelectItem>
              <SelectItem value="Normal" className="text-xs">Normal</SelectItem>
              <SelectItem value="Alta" className="text-xs">Alta</SelectItem>
              <SelectItem value="Urgente" className="text-xs">Urgente</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Data Prevista</Label>
          <Input
            type="date"
            value={formData.data_prevista}
            onChange={(e) => setFormData({ ...formData, data_prevista: e.target.value })}
            className="h-9 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Pendente" className="text-xs">Pendente</SelectItem>
              <SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem>
              <SelectItem value="Concluída" className="text-xs">Concluída</SelectItem>
              <SelectItem value="Cancelada" className="text-xs">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Responsável</Label>
        <Input
          value={formData.responsavel}
          onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })}
          placeholder="Nome do responsável"
          className="h-9 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Descrição</Label>
        <Textarea
          value={formData.descricao}
          onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
          placeholder="Detalhes da tarefa..."
          className="h-20 text-sm"
        />
      </div>

      {!areaId && !loteId && (
            <div className="space-y-1.5">
              <Label className="text-xs">Vincular à Área</Label>
              <Select value={formData.area_id} onValueChange={handleAreaChange}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione uma área..." />
                </SelectTrigger>
                <SelectContent>
                  {areas.map(area => (
                    <SelectItem key={area.id} value={area.id} className="text-xs">
                      {area.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(areaNome || loteNome || formData.area_nome) && (
            <div className="bg-slate-50 rounded p-2 text-xs text-slate-600">
              <span className="font-medium">Vinculado a:</span> {areaNome || loteNome || formData.area_nome}
            </div>
          )}

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
        {tarefa ? 'Salvar' : 'Criar Tarefa'}
        </Button>
      </div>
    </form>
  );
}
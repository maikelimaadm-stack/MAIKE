import React, { useEffect, useRef, useState } from "react";
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
import TarefaDetalhesDialog from "@/components/tarefas/TarefaDetalhesDialog";

const PRIORIDADE_CORES = {
  'Baixa': 'bg-blue-100 text-blue-700',
  'Média': 'bg-orange-100 text-orange-700',
  'Alta': 'bg-red-100 text-red-700',
  'Concluida': 'bg-slate-100 text-slate-500'
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
  const [detalheTarefa, setDetalheTarefa] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('ativas');
  
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const lastTapRef = useRef({ id: null, time: 0 });

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ['tarefas-mapa', empresaSelecionadaId, areaId, loteId, pontoSuplId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list('-created_date');
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

  const abrirDetalhe = (tarefa) => setDetalheTarefa(tarefa);

  const handleCardTouch = (tarefa, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === tarefa.id && now - lastTapRef.current.time < 300) {
      event.preventDefault();
      abrirDetalhe(tarefa);
    }
    lastTapRef.current = { id: tarefa.id, time: now };
  };

  useEffect(() => {
    if (openCreateOnMount) {
      setEditingTarefa(initialDraft?.id ? initialDraft : null);
      setShowForm(true);
    }
  }, [openCreateOnMount, initialCoordinates, initialDraft]);

  const tarefasFiltradas = tarefas.filter(t => {
    if (filtroStatus === 'ativas') return t.status === 'Pendente' || t.status === 'Em Andamento';
    if (filtroStatus === 'concluidas') return t.status === 'Concluída';
    return true;
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const created = await base44.entities.LancamentoTarefa.create(data);
      await base44.entities.HistoricoLancamentoTarefa.create({
        empresa_id: created.empresa_id,
        tarefa_id: created.id,
        titulo_tarefa: created.titulo,
        evento: 'Criação',
        data_evento: new Date().toISOString(),
        status: created.status,
        responsavel: created.responsavel,
        descricao: 'Tarefa criada pelo mapa.',
      });
      return created;
    },
    onSuccess: (created) => {
      queryClient.setQueryData(['tarefas-mapa', empresaSelecionadaId, areaId, loteId, pontoSuplId], (old = []) => [created, ...(old || [])]);
      queryClient.setQueryData(['gestao-tarefas-unificada', empresaSelecionadaId], (old = []) => [created, ...(old || [])]);
      queryClient.setQueryData(['mapa-tarefas', empresaSelecionadaId], (old = []) => [created, ...(old || [])]);
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success('Tarefa criada!');
      setShowForm(false);
      setEditingTarefa(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, previous }) => {
      const updated = await base44.entities.LancamentoTarefa.update(id, data);
      const mudouLocal = data.coordenadas?.lat !== previous?.coordenadas?.lat || data.coordenadas?.lng !== previous?.coordenadas?.lng;
      const mudouStatus = data.status && data.status !== previous?.status;
      const evento = mudouLocal
        ? 'Mudança de Local'
        : updated.status === 'Concluída' && mudouStatus
          ? 'Conclusão'
          : updated.status === 'Cancelada' && mudouStatus
            ? 'Cancelamento'
            : mudouStatus
              ? 'Mudança de Status'
              : 'Edição';
      const descricao = mudouLocal
        ? 'Local da tarefa alterado pelo mapa.'
        : updated.status === 'Concluída' && mudouStatus
          ? 'Tarefa concluída pelo mapa.'
          : updated.status === 'Cancelada' && mudouStatus
            ? 'Tarefa cancelada pelo mapa.'
            : mudouStatus
              ? `Status alterado para ${updated.status}.`
              : 'Tarefa atualizada pelo mapa.';

      await base44.entities.HistoricoLancamentoTarefa.create({
        empresa_id: updated.empresa_id,
        tarefa_id: updated.id,
        titulo_tarefa: updated.titulo,
        evento,
        data_evento: new Date().toISOString(),
        status: updated.status,
        responsavel: updated.responsavel,
        descricao,
      });
      return updated;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['tarefas-mapa', empresaSelecionadaId, areaId, loteId, pontoSuplId], (old = []) => (old || []).map(t => t.id === updated.id ? updated : t));
      queryClient.setQueryData(['gestao-tarefas-unificada', empresaSelecionadaId], (old = []) => (old || []).map(t => t.id === updated.id ? updated : t));
      queryClient.setQueryData(['mapa-tarefas', empresaSelecionadaId], (old = []) => (old || []).map(t => t.id === updated.id ? updated : t));
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success('Tarefa atualizada!');
      setShowForm(false);
      setEditingTarefa(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.LancamentoTarefa.delete(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData(['tarefas-mapa', empresaSelecionadaId, areaId, loteId, pontoSuplId], (old = []) => (old || []).filter(t => t.id !== id));
      queryClient.setQueryData(['gestao-tarefas-unificada', empresaSelecionadaId], (old = []) => (old || []).filter(t => t.id !== id));
      queryClient.setQueryData(['mapa-tarefas', empresaSelecionadaId], (old = []) => (old || []).filter(t => t.id !== id));
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success('Tarefa excluída!');
    }
  });

  const handleConcluir = (tarefa) => {
    updateMutation.mutate({
      id: tarefa.id,
      previous: tarefa,
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
        <Button size="sm" onClick={() => { setEditingTarefa(null); setShowForm(true); }} className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Plus className="w-3.5 h-3.5" /> Nova Tarefa
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
          tarefasFiltradas.map(tarefa => {
            const prioridade = normalizeTaskPriority(tarefa.prioridade);
            const prioridadeClassName = tarefa.status === 'Concluída' ? PRIORIDADE_CORES.Concluida : PRIORIDADE_CORES[prioridade] || PRIORIDADE_CORES.Baixa;

            return (
            <Card key={tarefa.id} className="shadow-sm cursor-pointer" onDoubleClick={() => abrirDetalhe(tarefa)} onTouchEnd={(event) => handleCardTouch(tarefa, event)}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-sm text-slate-900 break-words">{tarefa.titulo}</span>
                      <div className="flex items-center gap-1 flex-wrap">
                        {getIconePrioridade(tarefa.prioridade)?.icone_url && (
                          <img
                            src={getIconePrioridade(tarefa.prioridade).icone_url}
                            alt={prioridade}
                            className="w-4 h-4 object-contain"
                          />
                        )}
                        <Badge className={`${prioridadeClassName} text-[10px]`}>
                          {prioridade}
                        </Badge>
                        <Badge className={`${STATUS_CORES[tarefa.status]} text-[10px]`}>{tarefa.status}</Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                      <Badge variant="outline" className="text-[10px]">{tarefa.grupo_atividade_nome || '-'}</Badge>
                      <Badge variant="outline" className="text-[10px]">{tarefa.tipo_tarefa_nome || tarefa.tipo || '-'}</Badge>
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
                      <p className="text-xs text-slate-600 break-words">{tarefa.descricao}</p>
                    )}
                    <div className="space-y-0.5 text-[10px] text-slate-500">
                      <div><span className="font-medium">Solicitante:</span> {tarefa.solicitante || '-'}</div>
                      <div><span className="font-medium">Responsável:</span> {tarefa.responsavel || '-'}</div>
                      <div><span className="font-medium">Observações:</span> {tarefa.observacoes || '-'}</div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1" onClick={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>
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
          )})
        )}
      </div>

      <TarefaDetalhesDialog
        open={!!detalheTarefa}
        onOpenChange={(open) => !open && setDetalheTarefa(null)}
        tarefa={detalheTarefa}
        onSaved={(updated) => setDetalheTarefa(updated)}
      />

      {/* Dialog de Formulário */}
      <Dialog open={showForm} onOpenChange={(open) => {
        setShowForm(open);
        if (!open) setEditingTarefa(null);
      }}>
        <DialogContent className="w-[95vw] max-w-[95vw] md:max-w-4xl max-h-[95vh] overflow-y-auto p-0">
          <DialogHeader className="px-4 pt-4 pb-3 border-b bg-white sticky top-0 z-10">
            <DialogTitle className="text-sm font-bold text-slate-900">{editingTarefa ? 'EDITAR TAREFA DO MAPA' : 'NOVA TAREFA DO MAPA'}</DialogTitle>
            <p className="text-xs text-slate-600">Preencha as informações da atividade, defina o responsável e marque o ponto no mapa se necessário.</p>
          </DialogHeader>
          <FormularioTarefaMapa
            key={`${editingTarefa?.id || 'nova'}-${initialDraft?.id || 'sem-rascunho'}-${initialCoordinates?.lat || 'sem-lat'}-${initialCoordinates?.lng || 'sem-lng'}`}
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
              if (editingTarefa || data.id) {
                updateMutation.mutate({ id: editingTarefa?.id || data.id, data: payload, previous: editingTarefa || data });
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
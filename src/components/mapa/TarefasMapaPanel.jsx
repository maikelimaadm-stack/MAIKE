import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock } from "lucide-react";
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
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 p-3 border-b">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-slate-900">TAREFAS</h3>
            {(areaNome || loteNome) && <p className="text-xs text-slate-500 uppercase">{areaNome || loteNome}</p>}
          </div>
          <Button size="sm" onClick={() => { setEditingTarefa(null); setShowForm(true); }} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
            Nova Tarefa
          </Button>
        </div>

        <div className="p-3 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border bg-slate-50 p-2 text-center">
              <div className="text-base font-bold text-slate-900">{pendentes}</div>
              <div className="text-[10px] text-slate-600 uppercase">Pendentes</div>
            </div>
            <div className="rounded-lg border bg-slate-50 p-2 text-center">
              <div className="text-base font-bold text-slate-900">{emAndamento}</div>
              <div className="text-[10px] text-slate-600 uppercase">Em andamento</div>
            </div>
            <div className="rounded-lg border bg-slate-50 p-2 text-center">
              <div className="text-base font-bold text-slate-900">{altas}</div>
              <div className="text-[10px] text-slate-600 uppercase">Alta prioridade</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
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

          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-auto max-h-[420px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white border-b hover:bg-white">
                    <TableHead className="text-xs py-2 px-3 font-bold border-b">TAREFA</TableHead>
                    <TableHead className="text-xs py-2 px-3 font-bold border-b">GRUPO</TableHead>
                    <TableHead className="text-xs py-2 px-3 font-bold border-b">TIPO</TableHead>
                    <TableHead className="text-xs py-2 px-3 font-bold border-b">STATUS</TableHead>
                    <TableHead className="text-xs py-2 px-3 font-bold border-b">PRIORIDADE</TableHead>
                    <TableHead className="text-xs py-2 px-3 font-bold border-b">RESPONSÁVEL</TableHead>
                    <TableHead className="text-xs py-2 px-3 font-bold border-b">PRAZO</TableHead>
                    <TableHead className="text-xs py-2 px-3 font-bold border-b text-right">AÇÕES</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-4 text-xs text-slate-500 border-b">Carregando...</TableCell>
                    </TableRow>
                  ) : tarefasFiltradas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-xs text-slate-400 border-b">
                        <div className="flex flex-col items-center gap-2">
                          <Clock className="w-8 h-8 opacity-50" />
                          <span>Nenhuma tarefa encontrada</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    tarefasFiltradas.map((tarefa) => {
                      const prioridade = normalizeTaskPriority(tarefa.prioridade);
                      const prioridadeClassName = tarefa.status === 'Concluída' ? PRIORIDADE_CORES.Concluida : PRIORIDADE_CORES[prioridade] || PRIORIDADE_CORES.Baixa;

                      return (
                        <TableRow key={tarefa.id} className="hover:bg-gray-50 cursor-pointer" onDoubleClick={() => abrirDetalhe(tarefa)} onTouchEnd={(event) => handleCardTouch(tarefa, event)}>
                          <TableCell className="text-xs py-2 px-3 border-b align-top min-w-[240px]">
                            <div className="space-y-1">
                              <div className="font-medium text-slate-900 uppercase break-words">{tarefa.titulo || '-'}</div>
                              {tarefa.descricao && <div className="text-slate-500 break-words line-clamp-2 uppercase">{tarefa.descricao}</div>}
                              {(tarefa.area_nome || tarefa.setor_nome) && (
                                <div className="text-slate-500 uppercase">{tarefa.setor_nome || '-'} {tarefa.area_nome ? `• ${tarefa.area_nome}` : ''}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs py-2 px-3 border-b uppercase align-top">{tarefa.grupo_atividade_nome || '-'}</TableCell>
                          <TableCell className="text-xs py-2 px-3 border-b uppercase align-top">{tarefa.tipo_tarefa_nome || tarefa.tipo || '-'}</TableCell>
                          <TableCell className="text-xs py-2 px-3 border-b align-top">
                            <Badge className={`${STATUS_CORES[tarefa.status]} text-[10px] uppercase`}>{tarefa.status || '-'}</Badge>
                          </TableCell>
                          <TableCell className="text-xs py-2 px-3 border-b align-top">
                            <Badge className={`${prioridadeClassName} text-[10px] uppercase`}>{prioridade}</Badge>
                          </TableCell>
                          <TableCell className="text-xs py-2 px-3 border-b uppercase align-top">{tarefa.responsavel || '-'}</TableCell>
                          <TableCell className="text-xs py-2 px-3 border-b align-top">{tarefa.data_prevista ? format(new Date(tarefa.data_prevista), 'dd/MM/yyyy') : '-'}</TableCell>
                          <TableCell className="text-xs py-2 px-3 border-b align-top">
                            <div className="flex flex-wrap justify-end gap-1" onClick={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>
                              {tarefa.status !== 'Concluída' && (
                                <Button variant="outline" size="sm" onClick={() => handleConcluir(tarefa)} className="h-7 text-xs">Concluir</Button>
                              )}
                              <Button variant="outline" size="sm" onClick={() => { setEditingTarefa(tarefa); setShowForm(true); }} className="h-7 text-xs">Editar</Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (confirm('Excluir esta tarefa?')) {
                                    deleteMutation.mutate(tarefa.id);
                                  }
                                }}
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                              >
                                Excluir
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
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
        <DialogContent className="w-[95vw] max-w-[95vw] md:max-w-2xl max-h-[95vh] overflow-y-auto p-0">
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
import React, { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Clock, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";
import TarefaDetalhesDialog from "@/components/tarefas/TarefaDetalhesDialog";

const PRIORIDADE_CORES = {
  'Baixa': 'bg-blue-300 text-black hover:bg-blue-300',
  'Média': 'bg-yellow-300 text-black hover:bg-yellow-300',
  'Alta': 'bg-red-400 text-black hover:bg-red-400',
  'Concluida': 'bg-slate-300 text-black hover:bg-slate-300'
};

const STATUS_CORES = {
  'Pendente': 'bg-yellow-300 text-black hover:bg-yellow-300',
  'Em Andamento': 'bg-blue-300 text-black hover:bg-blue-300',
  'Concluída': 'bg-emerald-300 text-black hover:bg-emerald-300',
  'Cancelada': 'bg-slate-300 text-black hover:bg-slate-300'
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

          <div className="overflow-hidden">
            <div className="overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-white border-b hover:bg-white">
                    <TableHead className="h-7 p-0 bg-white text-muted-foreground font-medium text-center w-10 min-w-[25px] max-w-[25px] align-middle px-0"></TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">TAREFA</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">DESCRIÇÃO</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">PRIORIDADE</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">STATUS</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">GRUPO</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">TIPO DE TAREFA</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">FAZENDA</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">ÁREA</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">RESPONSÁVEL</TableHead>
                    <TableHead className="h-7 text-gray-900 px-1 text-xs font-medium text-center border border-gray-300">PRAZO</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-4 text-xs text-slate-500 border-b">Carregando...</TableCell>
                    </TableRow>
                  ) : tarefasFiltradas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
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
                        <TableRow key={tarefa.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100" onDoubleClick={() => abrirDetalhe(tarefa)} onTouchEnd={(event) => handleCardTouch(tarefa, event)}>
                          <TableCell className="p-0 bg-white text-muted-foreground font-medium text-center w-10 min-w-[25px] max-w-[25px] align-middle px-0" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                {tarefa.status !== 'Concluída' && (
                                  <DropdownMenuItem onClick={() => handleConcluir(tarefa)} className="text-xs">Concluir</DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => { setEditingTarefa(tarefa); setShowForm(true); }} className="text-xs">Editar</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => { if (confirm('Excluir esta tarefa?')) deleteMutation.mutate(tarefa.id); }} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">{tarefa.titulo || '-'}</TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">{tarefa.descricao || '-'}</TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">
                            <Badge className={`${prioridadeClassName} text-[10px]`}>{prioridade || '-'}</Badge>
                          </TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">
                            <Badge className={`${STATUS_CORES[tarefa.status] || STATUS_CORES.Pendente} text-[10px]`}>{tarefa.status || '-'}</Badge>
                          </TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">{tarefa.grupo_atividade_nome || '-'}</TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">{tarefa.tipo_tarefa_nome || tarefa.tipo || '-'}</TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">{tarefa.setor_nome || '-'}</TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">{tarefa.area_nome || '-'}</TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">{tarefa.responsavel || '-'}</TableCell>
                          <TableCell className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300">{tarefa.data_prevista ? format(new Date(tarefa.data_prevista), 'dd/MM/yyyy') : '-'}</TableCell>
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
        <DialogContent className="p-3 bg-background px-2 py-2 overflow-x-hidden sm:w-full sm:p-1 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-2 border shadow-lg duration-200 sm:rounded-lg max-w-[95vw] md:max-w-[75vw] xl:max-w-[65vw] max-h-[95vh] overflow-y-auto">
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
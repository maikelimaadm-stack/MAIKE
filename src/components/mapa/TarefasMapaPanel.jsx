import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Settings, WifiOff } from "lucide-react";
import { toast } from "sonner";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";
import TabelaLancamentosTarefas from "@/components/tarefas/TabelaLancamentosTarefas";
import { saveTarefaOffline, saveTarefaImageOffline } from "@/components/offline/IndexedDBManager";

export default function TarefasMapaPanel({ areaId, areaNome, loteId, loteNome, pontoSuplId, onClose, initialCoordinates, openCreateOnMount = false, initialDraft = null, onRequestSelectLocation }) {
  const [showForm, setShowForm] = useState(false);
  const [editingTarefa, setEditingTarefa] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: tarefas = [], isLoading: loadingTarefas } = useQuery({
    queryKey: ['tarefas-mapa', empresaSelecionadaId, areaId, loteId, pontoSuplId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoTarefa.list('-updated_date');
      let filtered = all.filter((t) => t.empresa_id === empresaSelecionadaId);
      if (areaId) filtered = filtered.filter((t) => t.area_id === areaId);
      if (loteId) filtered = filtered.filter((t) => t.lote_id === loteId);
      if (pontoSuplId) filtered = filtered.filter((t) => t.ponto_suplementacao_id === pontoSuplId);
      return filtered;
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
    staleTime: 60 * 1000,
  });

  const { data: iconesPrioridade = [] } = useQuery({
    queryKey: ['icones-prioridade-tarefa-mapa'],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((icone) => icone.ativo !== false && icone.tipo_entidade === 'Prioridade Tarefa');
    },
    initialData: [],
    staleTime: 10 * 60 * 1000
  });

  useEffect(() => {
    if (openCreateOnMount) {
      setEditingTarefa(initialDraft?.id ? initialDraft : null);
      setShowForm(true);
    }
  }, [openCreateOnMount, initialCoordinates, initialDraft]);

  const grupos = useMemo(() => [...new Set(tarefas.map((item) => item.grupo_atividade_nome).filter(Boolean))].sort(), [tarefas]);

  const getIconePrioridade = (prioridade) => {
    const normalize = (value) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const prioridadeNormalizada = normalize(normalizeTaskPriority(prioridade));
    return iconesPrioridade.find((icone) => normalize(icone.categoria) === prioridadeNormalizada);
  };

  // Salva tarefa offline no IndexedDB com imagens (Blobs)
  const salvarTarefaOffline = async (action, data, pendingImageFiles = []) => {
    const offlineKey = await saveTarefaOffline(action, data);
    for (const file of pendingImageFiles) {
      await saveTarefaImageOffline(offlineKey, file);
    }
    toast.success('💾 Tarefa salva offline — sincronizará ao conectar', { duration: 4000 });
    setShowForm(false);
    setEditingTarefa(null);
  };

  const uploadImages = async (pendingImageFiles = []) => {
    const uploadedUrls = [];
    for (const file of pendingImageFiles) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      uploadedUrls.push(file_url);
    }
    return uploadedUrls;
  };

  const createMutation = useMutation({
    mutationFn: async ({ data, pendingImageFiles = [] }) => {
      const uploadedUrls = await uploadImages(pendingImageFiles);
      const payload = uploadedUrls.length > 0 ? { ...data, fotos: [...(data.fotos || []), ...uploadedUrls] } : data;
      const created = await base44.entities.LancamentoTarefa.create(payload);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success('Tarefa criada!');
      setShowForm(false);
      setEditingTarefa(null);
    },
    onError: (err) => {
      toast.error(`Erro ao salvar tarefa: ${err?.message || 'Tente novamente'}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, previous, pendingImageFiles = [] }) => {
      const uploadedUrls = await uploadImages(pendingImageFiles);
      const payload = uploadedUrls.length > 0 ? { ...data, fotos: [...(data.fotos || []), ...uploadedUrls] } : data;
      const updated = await base44.entities.LancamentoTarefa.update(id, payload);
      const mudouLocal = data.coordenadas?.lat !== previous?.coordenadas?.lat || data.coordenadas?.lng !== previous?.coordenadas?.lng;
      const mudouStatus = data.status && data.status !== previous?.status;
      const evento = mudouLocal ? 'Mudança de Local' : updated.status === 'Concluída' && mudouStatus ? 'Conclusão' : updated.status === 'Cancelada' && mudouStatus ? 'Cancelamento' : mudouStatus ? 'Mudança de Status' : 'Edição';
      const descricao = mudouLocal ? 'Local da tarefa alterado pelo mapa.' : updated.status === 'Concluída' && mudouStatus ? 'Tarefa concluída pelo mapa.' : updated.status === 'Cancelada' && mudouStatus ? 'Tarefa cancelada pelo mapa.' : mudouStatus ? `Status alterado para ${updated.status}.` : 'Tarefa atualizada pelo mapa.';
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success('Tarefa atualizada!');
      setShowForm(false);
      setEditingTarefa(null);
    },
    onError: (err) => {
      toast.error(`Erro ao atualizar tarefa: ${err?.message || 'Tente novamente'}`);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids) => {
      const lista = Array.isArray(ids) ? ids : [ids];
      for (const id of lista) await base44.entities.LancamentoTarefa.delete(id);
      return lista;
    },
    onSuccess: (ids) => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success(ids.length === 1 ? 'Tarefa excluída!' : `${ids.length} tarefas excluídas!`);
    }
  });

  const panelTitulo = pontoSuplId ? 'Gestão de Tarefas' : loteId ? 'Gestão de Tarefas' : areaId ? 'Gestão de Tarefas' : 'Gestão de Tarefas';
  const panelSubtitulo = areaNome || loteNome || '';

  return (
    <div className="space-y-1 w-full min-w-0 overflow-x-auto">
      {loadingTarefas ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          <span className="text-xs font-medium text-slate-700">Carregando tarefas...</span>
        </div>
      ) : (
      <TabelaLancamentosTarefas
        tarefas={tarefas}
        grupos={grupos}
        onDelete={(ids) => deleteMutation.mutate(ids)}
        onEdit={(tarefa) => {
          setEditingTarefa(tarefa);
          setShowForm(true);
        }}
        getIconePrioridade={getIconePrioridade}
        normalizeTaskPriority={normalizeTaskPriority}
        showConfigColunas={showConfigColunas}
        setShowConfigColunas={setShowConfigColunas}
        showHeaderActions={true}
        onAdd={() => { setEditingTarefa(null); setShowForm(true); }}
        headerTitle={panelTitulo}
        headerDescription={panelSubtitulo}
      />
      )}

      <Dialog open={showForm} onOpenChange={(open) => {
        setShowForm(open);
        if (!open) setEditingTarefa(null);
      }}>
        <DialogContent className="p-3 bg-background px-2 py-2 sm:w-full sm:p-1 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-2 border shadow-lg duration-200 sm:rounded-lg max-w-[98vw] md:max-w-[92vw] xl:max-w-[88vw] h-[95vh] overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b bg-white sticky top-0 z-10">
            <DialogTitle className="text-sm font-bold text-slate-900">{editingTarefa ? 'EDITAR TAREFA DO MAPA' : 'NOVA TAREFA DO MAPA'}</DialogTitle>
            <p className="text-xs text-slate-600">Mesmo padrão da tela de lançamentos, aberto em formato de painel grande pelo mapa.</p>
          </DialogHeader>
          <div className="overflow-auto min-h-0 max-h-[calc(95vh-90px)] pr-1">
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
            externalSubmitting={createMutation.isPending || updateMutation.isPending}
            onSubmit={(data, pendingImageFiles = []) => {
              // Evitar dupla submissão se mutation já está em andamento
              if (createMutation.isPending || updateMutation.isPending) return;

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
              if (!navigator.onLine) {
                const action = (editingTarefa || data.id) ? 'update' : 'create';
                const offlinePayload = action === 'create' ? { ...payload, empresa_id: empresaSelecionadaId } : payload;
                salvarTarefaOffline(action, offlinePayload, pendingImageFiles);
              } else if (editingTarefa || data.id) {
                updateMutation.mutate({ id: editingTarefa?.id || data.id, data: payload, previous: editingTarefa || data, pendingImageFiles });
              } else {
                createMutation.mutate({ data: { ...payload, empresa_id: empresaSelecionadaId }, pendingImageFiles });
              }
            }}
            onCancel={() => { setShowForm(false); setEditingTarefa(null); }}
          />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
import React, { useEffect, useState } from "react";
import { listarTarefasDaEmpresa, listarIconesPorTipo, criarTarefa, atualizarTarefa, excluirTarefa, enviarAnexo } from "@/services/tarefasMapaService";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { toast } from "sonner";
import { API_ERROR_CODES, getApiErrorMessage, hasApiErrorCode } from "@/apis/_core/ApiError";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";
import TarefasCardsMapa from "@/components/tarefas/TarefasCardsMapa";
import { saveTarefaOffline, saveTarefaImageOffline } from "@/components/offline/IndexedDBManager";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

export default function TarefasMapaPanel({ areaId, areaNome, loteId, loteNome, pontoSuplId, onClose, initialCoordinates, openCreateOnMount = false, initialDraft = null, onRequestSelectLocation }) {
  const [showForm, setShowForm] = useState(false);
  const [editingTarefa, setEditingTarefa] = useState(null);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = useEmpresaSelecionadaId();

  const { data: tarefas = [], isLoading: loadingTarefas } = useQuery({
    queryKey: ['tarefas-mapa', empresaSelecionadaId, areaId, loteId, pontoSuplId],
    queryFn: async () => {
      let filtered = await listarTarefasDaEmpresa(empresaSelecionadaId, { order: '-updated_date' });
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
      return listarIconesPorTipo('Prioridade Tarefa');
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
      const { file_url } = await enviarAnexo({ file });
      uploadedUrls.push(file_url);
    }
    return uploadedUrls;
  };

  const createMutation = useMutation({
    mutationFn: async ({ data, pendingImageFiles = [] }) => {
      const uploadedUrls = await uploadImages(pendingImageFiles);
      const payload = uploadedUrls.length > 0 ? { ...data, fotos: [...(data.fotos || []), ...uploadedUrls] } : data;
      return criarTarefa({
        ...payload,
        historico_evento: 'Criação',
        historico_descricao: 'Tarefa criada pelo mapa.',
        historico_data_evento: new Date().toISOString(),
      });
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
      if (hasApiErrorCode(err, API_ERROR_CODES.MAPA_PARTIAL_OPERATION)) {
        queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
        queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
        queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
        window.dispatchEvent(new CustomEvent('atualizar-mapa'));
        toast.warning(getApiErrorMessage(err));
        setShowForm(false);
        setEditingTarefa(null);
        return;
      }
      toast.error(`Erro ao salvar tarefa: ${getApiErrorMessage(err, 'Tente novamente')}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, previous, pendingImageFiles = [] }) => {
      const uploadedUrls = await uploadImages(pendingImageFiles);
      const payload = uploadedUrls.length > 0 ? { ...data, fotos: [...(data.fotos || []), ...uploadedUrls] } : data;
      const mudouLocal = data.coordenadas?.lat !== previous?.coordenadas?.lat || data.coordenadas?.lng !== previous?.coordenadas?.lng;
      const mudouStatus = data.status && data.status !== previous?.status;
      const evento = mudouLocal ? 'Mudança de Local' : payload.status === 'Concluída' && mudouStatus ? 'Conclusão' : payload.status === 'Cancelada' && mudouStatus ? 'Cancelamento' : mudouStatus ? 'Mudança de Status' : 'Edição';
      const descricao = mudouLocal ? 'Local da tarefa alterado pelo mapa.' : payload.status === 'Concluída' && mudouStatus ? 'Tarefa concluída pelo mapa.' : payload.status === 'Cancelada' && mudouStatus ? 'Tarefa cancelada pelo mapa.' : mudouStatus ? `Status alterado para ${payload.status}.` : 'Tarefa atualizada pelo mapa.';
      return atualizarTarefa(id, {
        ...payload,
        historico_evento: evento,
        historico_descricao: descricao,
        historico_data_evento: new Date().toISOString(),
      });
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
      for (const id of lista) await excluirTarefa(id);
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

  const panelSubtitulo = areaNome || loteNome || '';

  return (
    <div className="space-y-1 w-full min-w-0 overflow-x-auto">
      {loadingTarefas ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          <span className="text-xs font-medium text-slate-700">Carregando tarefas...</span>
        </div>
      ) : (
      // D-PROD-133: tarefas em cards, no padrão dos cadastros (sem a tabela antiga).
      <TarefasCardsMapa
        tarefas={tarefas}
        onDelete={(ids) => deleteMutation.mutate(/** @type {any} */ (ids))}
        onEdit={(tarefa) => {
          setEditingTarefa(tarefa);
          setShowForm(true);
        }}
        normalizeTaskPriority={normalizeTaskPriority}
        onAdd={() => { setEditingTarefa(null); setShowForm(true); }}
      />
      )}

      <LancLoteDialogo
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) setEditingTarefa(null);
        }}
        titulo={editingTarefa ? 'Editar tarefa' : 'Nova tarefa'}
        lotes={panelSubtitulo ? [{ nome: panelSubtitulo }] : []}
        largo
      >
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
      </LancLoteDialogo>
    </div>
  );
}
import React, { useEffect, useState } from "react";
import { listarTarefasDaEmpresa, criarTarefa, atualizarTarefa, enviarAnexo } from "@/services/tarefasMapaService";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LancLoteDialogo } from "@/components/lotes/LancamentoLoteUi";
import { toast } from "sonner";
import { API_ERROR_CODES, getApiErrorMessage, hasApiErrorCode } from "@/apis/_core/ApiError";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";
import ResumoTarefasMapa from "@/components/tarefas/ResumoTarefasMapa";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

/**
 * D-PROD-321 — Tarefas, parte 2: o painel mostra o resumo em cartões (`ResumoTarefasMapa`, estilo dos detalhes do
 * lote) no lugar da grade de cadastro; tocar numa tarefa abre os detalhes (`onAbrirTarefa`); "Nova tarefa" usa
 * `onNovaTarefa` (o mapa descobre onde a pessoa está) ou, sem ele, abre o formulário com o local do painel.
 */
export default function TarefasMapaPanel({ areaId, areaNome, loteId, loteNome, pontoSuplId, onClose, initialCoordinates, openCreateOnMount = false, initialDraft = null, onRequestSelectLocation, onAbrirTarefa = null, onNovaTarefa = null, hoje = undefined }) {
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
    // Sem initialData: com ele o React Query trata a lista vazia como dado novo
    // e não busca ao montar (staleTime), então a Gestão de Tarefas abria vazia
    // na primeira vez (D-PROD-218). O padrão `= []` cobre o carregamento.
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    if (openCreateOnMount) {
      setEditingTarefa(initialDraft?.id ? initialDraft : null);
      setShowForm(true);
    }
  }, [openCreateOnMount, initialCoordinates, initialDraft]);

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
    onSuccess: (criada) => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      // D-PROD-319: sem internet a tarefa entra na fila de envio (com o id do aparelho) e sobe sozinha.
      toast.success(criada?._isOffline ? 'Tarefa salva no aparelho — vai ao servidor quando a internet voltar.' : 'Tarefa criada!');
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
    onSuccess: (atualizada) => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success(atualizada?._isOffline ? 'Alteração salva no aparelho — vai ao servidor quando a internet voltar.' : 'Tarefa atualizada!');
      setShowForm(false);
      setEditingTarefa(null);
    },
    onError: (err) => {
      toast.error(`Erro ao atualizar tarefa: ${err?.message || 'Tente novamente'}`);
    }
  });

  const panelSubtitulo = areaNome || loteNome || '';

  const abrirNova = () => {
    if (typeof onNovaTarefa === "function") {
      onNovaTarefa();
      return;
    }
    setEditingTarefa(null);
    setShowForm(true);
  };

  return (
    <>
      {loadingTarefas ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          <span className="text-xs font-medium text-slate-700">Carregando tarefas...</span>
        </div>
      ) : (
        <ResumoTarefasMapa
          tarefas={tarefas}
          titulo="Tarefas"
          sub={panelSubtitulo}
          hoje={hoje}
          prioridadeDe={normalizeTaskPriority}
          onAbrir={(tarefa) => {
            if (typeof onAbrirTarefa === "function") onAbrirTarefa(tarefa);
            else {
              setEditingTarefa(tarefa);
              setShowForm(true);
            }
          }}
          onNova={abrirNova}
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
              // D-PROD-319: sem internet, a tarefa vai para a fila de envio como os outros registros (o
              // armazenamento antigo não era mais enviado). As fotos precisam de internet para subir.
              if (!navigator.onLine && pendingImageFiles.length > 0) {
                toast.error('Sem internet as fotos não sobem. Remova as fotos novas e salve a tarefa; anexe as fotos quando a internet voltar.');
                return;
              }
              if (editingTarefa || data.id) {
                updateMutation.mutate({ id: editingTarefa?.id || data.id, data: payload, previous: editingTarefa || data, pendingImageFiles });
              } else {
                createMutation.mutate({ data: { ...payload, empresa_id: empresaSelecionadaId }, pendingImageFiles });
              }
            }}
            onCancel={() => { setShowForm(false); setEditingTarefa(null); }}
          />
      </LancLoteDialogo>
    </>
  );
}
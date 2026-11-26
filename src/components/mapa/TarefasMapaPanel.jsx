import React, { useEffect, useState } from "react";
import { listarTarefasDaEmpresa, criarTarefa, atualizarTarefa } from "@/services/tarefasMapaService";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { API_ERROR_CODES, getApiErrorMessage, hasApiErrorCode } from "@/apis/_core/ApiError";
import FormularioTarefaMapa, { normalizeTaskPriority } from "./FormularioTarefaMapa";
import ResumoTarefasMapa from "@/components/tarefas/ResumoTarefasMapa";
import { guardarFotosDaTarefa, enviarOuSepararFotos } from "@/services/fotosDeTarefaAguardandoService";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";

/**
 * @typedef {{ tarefa: any | null, voltarParaLista: boolean }} FormularioDaTarefa
 * `tarefa` nula = tarefa nova; `voltarParaLista` = ao sair, volta para a lista (senão fecha a janela: `onClose`).
 */

/**
 * D-PROD-321 — Tarefas, parte 2: o painel mostra o resumo em cartões (`ResumoTarefasMapa`, estilo dos detalhes do
 * lote) no lugar da grade de cadastro; tocar numa tarefa abre os detalhes (`onAbrirTarefa`); "Nova tarefa" usa
 * `onNovaTarefa` (o mapa descobre onde a pessoa está) ou, sem ele, abre o formulário com o local do painel.
 *
 * D-PROD-325: uma janela só. O formulário (nova ou editar) aparece NO LUGAR da lista, dentro da mesma janela do
 * mapa — sem uma segunda janela por cima e a lista aparecendo atrás. Quem tem a janela guarda o formulário aberto
 * (`formulario` + `onFormularioChange`): o cabeçalho troca para ✕ · ✓ no mesmo instante, e o painel pode ser
 * remontado sem perder a tela. Sem `formulario` (uso solto), o painel guarda sozinho (`openCreateOnMount`).
 *
 * @param {{
 *   areaId?: string, areaNome?: string, loteId?: string, loteNome?: string, pontoSuplId?: string,
 *   onClose?: () => void, initialCoordinates?: any, openCreateOnMount?: boolean, initialDraft?: any,
 *   onRequestSelectLocation?: (draft: any) => void, onAbrirTarefa?: ((t: any) => void) | null,
 *   onNovaTarefa?: (() => void) | null, hoje?: string,
 *   formulario?: FormularioDaTarefa | null, onFormularioChange?: (f: FormularioDaTarefa | null) => void,
 *   anim?: "empurrar" | "voltar" | null,
 * }} props
 */
export default function TarefasMapaPanel({ areaId, areaNome, loteId, loteNome, pontoSuplId, onClose, initialCoordinates, openCreateOnMount = false, initialDraft = null, onRequestSelectLocation, onAbrirTarefa = null, onNovaTarefa = null, hoje = undefined, formulario = undefined, onFormularioChange = undefined, anim = null }) {
  const controlado = formulario !== undefined;
  const [interno, setInterno] = useState(/** @returns {FormularioDaTarefa | null} */ () => (openCreateOnMount ? { tarefa: initialDraft?.id ? initialDraft : null, voltarParaLista: false } : null));
  useEffect(() => {
    if (!controlado && openCreateOnMount) setInterno({ tarefa: initialDraft?.id ? initialDraft : null, voltarParaLista: false });
  }, [controlado, openCreateOnMount, initialCoordinates, initialDraft]);
  const form = controlado ? formulario : interno;
  const showForm = Boolean(form);
  const editingTarefa = form?.tarefa || null;
  /** @param {FormularioDaTarefa | null} f */
  const mudarFormulario = (f) => {
    if (controlado) onFormularioChange?.(f);
    else setInterno(f);
  };

  /** Sai do formulário: de volta à lista, ou fecha tudo se ele abriu direto pelo mapa. */
  const fecharFormulario = () => {
    if (form?.voltarParaLista) {
      mudarFormulario(null);
      return;
    }
    // A janela some com o formulário ainda nela (sem mostrar a lista no caminho).
    if (!controlado) setInterno(null);
    onClose?.();
  };

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

  // D-PROD-324 / D-PROD-330: sem internet — ou com o sinal fraco, quando o envio da foto falha por falta de rede —
  // as fotos ficam guardadas no aparelho e sobem sozinhas depois (`fotosDeTarefaAguardandoService`); a tarefa salva
  // do mesmo jeito (vai pela fila quando não há resposta).
  const createMutation = useMutation({
    mutationFn: async ({ data, pendingImageFiles = [] }) => {
      const { urls: uploadedUrls, paraGuardar } = await enviarOuSepararFotos(pendingImageFiles);
      const payload = uploadedUrls.length > 0 ? { ...data, fotos: [...(data.fotos || []), ...uploadedUrls] } : data;
      const criada = await criarTarefa({
        ...payload,
        historico_evento: 'Criação',
        historico_descricao: 'Tarefa criada pelo mapa.',
        historico_data_evento: new Date().toISOString(),
      });
      const fotosGuardadas = paraGuardar.length ? await guardarFotosDaTarefa(criada.id, paraGuardar) : 0;
      return { ...criada, _fotosGuardadas: fotosGuardadas };
    },
    onSuccess: (criada) => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      // D-PROD-319: sem internet a tarefa entra na fila de envio (com o id do aparelho) e sobe sozinha.
      toast.success(
        criada?._isOffline
          ? `Tarefa salva no aparelho${criada?._fotosGuardadas ? ' com as fotos' : ''} — vai ao servidor quando a internet voltar.`
          : criada?._fotosGuardadas
            ? 'Tarefa criada! As fotos ficaram no celular e sobem quando a internet firmar.'
            : 'Tarefa criada!'
      );
      fecharFormulario();
    },
    onError: (err) => {
      if (hasApiErrorCode(err, API_ERROR_CODES.MAPA_PARTIAL_OPERATION)) {
        queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
        queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
        queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
        window.dispatchEvent(new CustomEvent('atualizar-mapa'));
        toast.warning(getApiErrorMessage(err));
        fecharFormulario();
        return;
      }
      toast.error(`Erro ao salvar tarefa: ${getApiErrorMessage(err, 'Tente novamente')}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, previous, pendingImageFiles = [] }) => {
      const { urls: uploadedUrls, paraGuardar } = await enviarOuSepararFotos(pendingImageFiles);
      const payload = uploadedUrls.length > 0 ? { ...data, fotos: [...(data.fotos || []), ...uploadedUrls] } : data;
      const mudouLocal = data.coordenadas?.lat !== previous?.coordenadas?.lat || data.coordenadas?.lng !== previous?.coordenadas?.lng;
      const mudouStatus = data.status && data.status !== previous?.status;
      const evento = mudouLocal ? 'Mudança de Local' : payload.status === 'Concluída' && mudouStatus ? 'Conclusão' : payload.status === 'Cancelada' && mudouStatus ? 'Cancelamento' : mudouStatus ? 'Mudança de Status' : 'Edição';
      const descricao = mudouLocal ? 'Local da tarefa alterado pelo mapa.' : payload.status === 'Concluída' && mudouStatus ? 'Tarefa concluída pelo mapa.' : payload.status === 'Cancelada' && mudouStatus ? 'Tarefa cancelada pelo mapa.' : mudouStatus ? `Status alterado para ${payload.status}.` : 'Tarefa atualizada pelo mapa.';
      const atualizada = await atualizarTarefa(
        id,
        {
          ...payload,
          historico_evento: evento,
          historico_descricao: descricao,
          historico_data_evento: new Date().toISOString(),
        },
        // D-PROD-335: a foto que subiu sozinha enquanto o formulário estava aberto não é apagada.
        { fotosDaTela: previous?.fotos }
      );
      const fotosGuardadas = paraGuardar.length ? await guardarFotosDaTarefa(id, paraGuardar) : 0;
      return { ...atualizada, _fotosGuardadas: fotosGuardadas };
    },
    onSuccess: (atualizada) => {
      queryClient.invalidateQueries({ queryKey: ['tarefas-mapa'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-tarefas'] });
      queryClient.invalidateQueries({ queryKey: ['gestao-tarefas-unificada'] });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success(
        atualizada?._isOffline
          ? `Alteração salva no aparelho${atualizada?._fotosGuardadas ? ' com as fotos' : ''} — vai ao servidor quando a internet voltar.`
          : atualizada?._fotosGuardadas
            ? 'Tarefa atualizada! As fotos ficaram no celular e sobem quando a internet firmar.'
            : 'Tarefa atualizada!'
      );
      fecharFormulario();
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
    mudarFormulario({ tarefa: null, voltarParaLista: true });
  };

  if (showForm) {
    return (
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
          // D-PROD-324: sem internet, a tarefa vai pela fila e as fotos novas ficam guardadas (sobem depois).
          if (editingTarefa || data.id) {
            updateMutation.mutate({ id: editingTarefa?.id || data.id, data: payload, previous: editingTarefa || data, pendingImageFiles });
          } else {
            createMutation.mutate({ data: { ...payload, empresa_id: empresaSelecionadaId }, pendingImageFiles });
          }
        }}
        onCancel={fecharFormulario}
      />
    );
  }

  if (loadingTarefas) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
        <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
        <span className="text-xs font-medium text-slate-700">Carregando tarefas...</span>
      </div>
    );
  }

  return (
    <ResumoTarefasMapa
      tarefas={tarefas}
      titulo="Tarefas"
      sub={panelSubtitulo}
      hoje={hoje}
      anim={anim}
      prioridadeDe={normalizeTaskPriority}
      onAbrir={(tarefa) => {
        if (typeof onAbrirTarefa === "function") onAbrirTarefa(tarefa);
        else mudarFormulario({ tarefa, voltarParaLista: true });
      }}
      onNova={abrirNova}
    />
  );
}

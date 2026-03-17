import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import MovimentacaoEditDialog from "./MovimentacaoEditDialog";
import {
  normalizeText,
  getLinkedMovementIds,
  getJuncaoLotesSnapshot,
  getPesoAnteriorFromObs,
  getCategoriaAnteriorFromObs,
  getSexoAnteriorFromObs,
} from "../utils/pecuariaUtils";
import { reconcileMovementEdit } from "./movimentacaoReconciliation";

const CORES_TIPO = {
  "Transferência de Área": "bg-slate-100 text-slate-800 border-slate-300",
  "Morte": "bg-slate-100 text-slate-800 border-slate-300",
  "Nascimento": "bg-slate-100 text-slate-800 border-slate-300",
  "Abate": "bg-slate-100 text-slate-800 border-slate-300",
  "Mudança de Categoria": "bg-slate-100 text-slate-800 border-slate-300",
  "Pesagem": "bg-slate-100 text-slate-800 border-slate-300",
  "Renomear Lote": "bg-slate-100 text-slate-800 border-slate-300",
  "Junção de Lotes": "bg-slate-100 text-slate-800 border-slate-300",
  "Nutrição": "bg-slate-100 text-slate-800 border-slate-300",
  "Medicamento": "bg-slate-100 text-slate-800 border-slate-300",
  "Sanidade": "bg-slate-100 text-slate-800 border-slate-300",
  "Vacinação": "bg-slate-100 text-slate-800 border-slate-300",
  "Vermifugação": "bg-slate-100 text-slate-800 border-slate-300",
  "Tratamento": "bg-slate-100 text-slate-800 border-slate-300",
  "Inseminação": "bg-slate-100 text-slate-800 border-slate-300",
  "Exame": "bg-slate-100 text-slate-800 border-slate-300",
};

const TIPOS_EDITAVEIS = new Set([
  "Transferência de Área",
  "Morte",
  "Nascimento",
  "Abate",
  "Mudança de Categoria",
  "Pesagem",
]);

const getTime = (value) => new Date(value).getTime() || 0;
const normalize = (value) => normalizeText(value);
const parseCategoriaNovaFromObs = (observacoes) => {
  const match = String(observacoes || '').match(/De\s+.+?\s+para\s+(.+?)\.\s*Sexo:/i);
  return match ? match[1].trim() : null;
};
const parseCategoriaTransferenciaFromObs = (observacoes) => {
  const match = String(observacoes || '').match(/Movimentação parcial\s*-\s*\d+\s*cabeças\s+de\s+(.+)$/i);
  return match ? match[1].trim() : null;
};
const formatDateOnly = (value) => {
  const raw = String(value || '');
  if (!raw) return '-';
  const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return new Date(value).toLocaleDateString('pt-BR');
  return `${day}/${month}/${year}`;
};

export default function HistoricoMovimentacoes({ lotes = [], lotesIds = [], areaId }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [editMovOriginal, setEditMovOriginal] = React.useState(null);
  const [editMovForm, setEditMovForm] = React.useState(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState(null);
  const [hiddenMovementIds, setHiddenMovementIds] = React.useState([]);
  const loteIds = React.useMemo(() => lotes.map((item) => item?.id).filter(Boolean), [lotes]);
  const loteNomes = React.useMemo(() => {
    const nomesDosLotes = lotes.map((item) => item?.nome).filter(Boolean);
    return nomesDosLotes.length > 0 ? nomesDosLotes : lotesIds.filter(Boolean);
  }, [lotes, lotesIds]);

  const updateMutation = useMutation({
    mutationFn: ({ movement, data }) => reconcileMovementEdit({
      empresaSelecionadaId,
      originalMovement: movement,
      nextData: data,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] }),
        queryClient.invalidateQueries({ queryKey: ['lotes'] }),
        queryClient.invalidateQueries({ queryKey: ['todas-movimentacoes-global'] }),
        queryClient.invalidateQueries({ queryKey: ['todos-lotes-global'] }),
        queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] }),
      ]);
      try { window.dispatchEvent(new CustomEvent('atualizar-mapa')); } catch {}
      toast.success('Lançamento atualizado e saldo reconciliado');
    }
  });

  const { data: historico = [], isLoading } = useQuery({
    queryKey: ['historico-movimentacoes', loteIds, loteNomes, areaId],
    queryFn: async () => {
      const [movimentacoesRaw, suplementacoesRaw, medicamentosRaw, sanidadesRaw, manejosTecnicosRaw] = await Promise.all([
        base44.entities.MovimentacaoMapa.list('-data_movimentacao'),
        base44.entities.SuplementacaoLote.list('-data_lancamento'),
        base44.entities.AplicacaoMedicamento.list('-data_aplicacao'),
        base44.entities.EventoSanitario.list('-data_evento'),
        base44.entities.ManejoTecnicoRebanho.list('-data_evento')
      ]);

      const matchLote = (nome, id) => {
        // Se temos IDs de lote, PRIORIZAR match por ID para evitar mistura entre lotes de mesmo nome
        if (loteIds.length > 0) {
          // Se a movimentação tem lote_id, comparar direto com os IDs dos lotes selecionados
          if (id) return loteIds.includes(id);
          // Se a movimentação NÃO tem lote_id (legado), usar fallback por nome
          return loteNomes.some((item) => normalize(item) === normalize(nome));
        }
        // Se não temos IDs (chamado apenas com nomes), usar match por nome
        return loteNomes.some((item) => normalize(item) === normalize(nome));
      };
      const matchAreaMov = (mov) => !areaId || mov.area_origem_id === areaId || mov.area_destino_id === areaId;
      const matchLoteFlex = (nome, id) => {
        const byId = !!id && loteIds.includes(id);
        const byNome = loteNomes.some((item) => normalize(item) === normalize(nome));
        return byId || byNome;
      };

      const transferenciasParaAreaAtual = movimentacoesRaw
        .filter((mov) => mov.empresa_id === empresaSelecionadaId)
        .filter((mov) => mov.tipo === 'Transferência de Área')
        .filter((mov) => mov.area_destino_id === areaId)
        .filter((mov) => matchLote(mov.lote, mov.lote_id));

      const inicioNovoHistorico = transferenciasParaAreaAtual.length > 0
        ? Math.max(...transferenciasParaAreaAtual.map((mov) => getTime(mov.created_date || mov.data_movimentacao)))
        : null;

      const dentroDoHistoricoAtual = (createdAt, dataEvento) => {
        const referencia = createdAt || dataEvento;
        return !inicioNovoHistorico || getTime(referencia) >= inicioNovoHistorico;
      };

      const movimentacoes = movimentacoesRaw
        .filter((mov) => mov.empresa_id === empresaSelecionadaId)
        .filter((mov) => {
          // Transferências devem aparecer na área de ORIGEM (para exclusão) e na de destino (para consulta)
          // Na área de origem, o lote pode não estar mais lá, então precisamos match especial
          if (mov.tipo === 'Transferência de Área' && areaId) {
            const isOrigem = mov.area_origem_id === areaId;
            const isDestino = mov.area_destino_id === areaId;
            if (isOrigem || isDestino) {
              // Verificar se o nome/id do lote bate com os lotes que estamos visualizando
              const nomeMatch = loteNomes.some((item) => normalize(item) === normalize(mov.lote));
              const idMatch = loteIds.length > 0 && !!mov.lote_id && loteIds.includes(mov.lote_id);
              if (nomeMatch || idMatch) return true;
            }
          }
          if (loteIds.length > 0 || loteNomes.length > 0) {
            return matchLote(mov.lote, mov.lote_id) && dentroDoHistoricoAtual(mov.created_date, mov.data_movimentacao);
          }
          return matchAreaMov(mov) && dentroDoHistoricoAtual(mov.created_date, mov.data_movimentacao);
        })
        .map((mov) => ({
          uniqueId: `mov-${mov.id}`,
          source: 'movimentacao',
          sourceLabel: 'Movimentação',
          id: mov.id,
          lote: mov.lote,
          lote_key: mov.lote_id || normalize(mov.lote),
          data_evento: mov.data_movimentacao,
          created_at: mov.created_date || mov.data_movimentacao,
          tipo: mov.tipo,
          tipo_exibicao: mov.motivo || mov.tipo,
          quantidade: mov.quantidade_animais,
          peso_medio: mov.peso_medio,
          observacoes: mov.observacoes,
          area_origem_nome: mov.area_origem_nome,
          area_destino_nome: mov.area_destino_nome,
          area_destino_id: mov.area_destino_id,
          linked_movement_ids: getLinkedMovementIds(mov.observacoes),
          canEdit: TIPOS_EDITAVEIS.has(mov.tipo) && !mov.motivo && !(mov.tipo === 'Pesagem' && getLinkedMovementIds(mov.observacoes).length > 0),
          canDelete: (
            // Transferência só pode ser excluída pela área de origem
            (mov.tipo === 'Transferência de Área' && !mov.motivo && (!areaId || mov.area_origem_id === areaId)) ||
            // Outros tipos editáveis (exceto transferência, que já é tratada acima)
            (mov.tipo !== 'Transferência de Área' && TIPOS_EDITAVEIS.has(mov.tipo) && !mov.motivo && !(mov.tipo === 'Pesagem' && getLinkedMovementIds(mov.observacoes).length > 0)) ||
            // Junção de lotes pode ser desfeita
            mov.motivo === 'Junção de Lotes' ||
            // Renomear lote pode ser desfeito
            mov.motivo === 'Renomear Lote'
          ),
          // Flag para indicar que tem pesagens filhas (usada no hasLaterRelatedRecord)
          hasPesagensFilhas: mov.tipo === 'Transferência de Área',
          raw: mov,
        }));

      const suplementacoes = suplementacoesRaw
        .filter((item) => item.empresa_id === empresaSelecionadaId)
        .filter((item) => matchLoteFlex(item.lote_nome, item.lote_id))
        .map((item) => ({
          uniqueId: `supl-${item.id}`,
          source: 'suplementacao',
          sourceLabel: 'Nutrição',
          lote: item.lote_nome,
          lote_key: item.lote_id || normalize(item.lote_nome),
          data_evento: item.data_lancamento,
          created_at: item.created_date || item.data_lancamento,
          tipo: 'Nutrição',
          tipo_exibicao: 'Nutrição',
          quantidade: item.cabecas_na_area,
          observacoes: `${item.produto || 'Produto'} • Consumo período: ${(item.consumo_total_lote_periodo_kg || 0).toFixed(1)} kg • ${(item.consumo_por_cabeca_dia_kg || 0).toFixed(3)} kg/cab/dia${item.dias_periodo ? ` • ${item.dias_periodo} dia(s)` : ' • Em aberto'}`,
          canEdit: false,
          canDelete: false,
        }));

      const medicamentos = medicamentosRaw
        .filter((item) => item.empresa_id === empresaSelecionadaId)
        .filter((item) => matchLoteFlex(item.lote_nome, item.lote_id))
        .filter((item) => dentroDoHistoricoAtual(item.created_date, item.data_aplicacao))
        .map((item) => ({
          uniqueId: `med-${item.id}`,
          source: 'medicamento',
          sourceLabel: 'Medicamento',
          lote: item.lote_nome,
          lote_key: item.lote_id || normalize(item.lote_nome),
          data_evento: item.data_aplicacao,
          created_at: item.created_date || item.data_aplicacao,
          tipo: 'Medicamento',
          tipo_exibicao: 'Medicamento',
          quantidade: item.quantidade_animais,
          observacoes: `${item.produto_nome || 'Medicamento'} • ${item.quantidade_aplicada || 0} ${item.unidade_medida || ''} por animal • Custo total R$ ${(item.custo_total || 0).toFixed(2)}`,
          canEdit: false,
          canDelete: false,
        }));

      const sanidades = sanidadesRaw
        .filter((item) => item.empresa_id === empresaSelecionadaId)
        .filter((item) => matchLote(item.lote))
        .filter((item) => dentroDoHistoricoAtual(item.created_date, item.data_evento))
        .map((item) => ({
          uniqueId: `san-${item.id}`,
          source: 'sanidade',
          sourceLabel: 'Sanidade',
          lote: item.lote,
          lote_key: normalize(item.lote),
          data_evento: item.data_evento,
          created_at: item.created_date || item.data_evento,
          tipo: 'Sanidade',
          tipo_exibicao: item.tipo_evento || 'Sanidade',
          observacoes: `${item.produto_usado || 'Sem produto'}${item.dosagem ? ` • ${item.dosagem}` : ''}${item.observacoes ? ` • ${item.observacoes}` : ''}`,
          canEdit: false,
          canDelete: false,
        }));

      const manejosTecnicos = manejosTecnicosRaw
        .filter((item) => item.empresa_id === empresaSelecionadaId)
        .filter((item) => matchLoteFlex(item.nome_lote, item.lote_id))
        .filter((item) => dentroDoHistoricoAtual(item.created_date, item.data_evento))
        .map((item) => ({
          uniqueId: `mt-${item.id}`,
          source: 'manejo_tecnico',
          sourceLabel: 'Manejo Técnico',
          lote: item.nome_lote,
          lote_key: item.lote_id || normalize(item.nome_lote),
          data_evento: item.data_evento,
          created_at: item.created_date || item.data_evento,
          tipo: item.tipo_evento,
          tipo_exibicao: item.subtipo_manejo || item.tipo_evento,
          quantidade: item.quantidade_animais,
          observacoes: item.observacoes,
          canEdit: false,
          canDelete: false,
        }));

      return [...movimentacoes, ...suplementacoes, ...medicamentos, ...sanidades, ...manejosTecnicos]
        .sort((a, b) => {
          const createdDiff = getTime(b.created_at) - getTime(a.created_at);
          if (createdDiff !== 0) return createdDiff;
          return getTime(b.data_evento) - getTime(a.data_evento);
        });
    },
    enabled: !!empresaSelecionadaId && (loteIds.length > 0 || loteNomes.length > 0 || !!areaId),
  });

  // Buscar TODAS as movimentações do sistema para verificar registros posteriores de lotes derivados
  const { data: todasMovimentacoesGlobal = [] } = useQuery({
    queryKey: ['todas-movimentacoes-global', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoMapa.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Buscar todos os lotes para resolver IDs derivados (parciais, renomeados)
  const { data: todosLotesGlobal = [] } = useQuery({
    queryKey: ['todos-lotes-global', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const hasLaterRelatedRecord = React.useCallback((entry) => {
    const loteAtual = entry?.lote_key || normalize(entry?.lote);
    const loteNomeNorm = normalize(entry?.lote);
    const dataAtual = getTime(entry?.data_evento);
    const createdAtual = getTime(entry?.created_at);
    const isTransferencia = entry?.tipo === 'Transferência de Área';

    if (isTransferencia) {
      const loteIdOriginal = entry?.raw?.lote_id;
      const areaDestinoId = entry?.raw?.area_destino_id;
      const areaOrigemId = entry?.raw?.area_origem_id;

      // 1) Verificar se houve evento posterior NA ÁREA DESTINO desta transferência específica
      // Coletar IDs de lotes com mesmo nome QUE ESTÃO NA ÁREA DESTINO desta transferência
      const idsLotesDestinoEstaTransf = new Set(
        todosLotesGlobal
          .filter(l => normalize(l.nome) === loteNomeNorm && l.area_atual_id === areaDestinoId)
          .map(l => l.id)
      );
      if (loteIdOriginal) idsLotesDestinoEstaTransf.add(loteIdOriginal);

      const hasEventoNoDestino = todasMovimentacoesGlobal.some((mov) => {
        if (mov.id === entry.id) return false;
        
        // Pesagens vinculadas à ESTA transferência são excluídas junto, não bloqueiam
        const linkedIds = getLinkedMovementIds(mov.observacoes);
        if (mov.tipo === 'Pesagem' && linkedIds.includes(entry.id)) return false;
        
        // Só considerar movimentações que ocorreram NA ÁREA DESTINO desta transferência
        const movNaAreaDestino = mov.area_origem_id === areaDestinoId || mov.area_destino_id === areaDestinoId;
        if (!movNaAreaDestino) return false;

        // Match por nome OU por lote_id de lotes na área destino
        const mesmoNome = normalize(mov.lote) === loteNomeNorm;
        const loteIdRelacionado = !!mov.lote_id && idsLotesDestinoEstaTransf.has(mov.lote_id);
        
        if (!mesmoNome && !loteIdRelacionado) return false;
        
        const dataItem = getTime(mov.data_movimentacao);
        const createdItem = getTime(mov.created_date || mov.data_movimentacao);
        return dataItem > dataAtual || (dataItem === dataAtual && createdItem > createdAtual);
      });
      if (hasEventoNoDestino) return true;

      // 2) Verificar se houve evento posterior NA ÁREA ORIGEM (lote que ficou com o saldo)
      // Isso bloqueia se o lote remanescente na origem teve pesagem, morte, etc.
      const idsLotesOrigemEstaTransf = new Set(
        todosLotesGlobal
          .filter(l => normalize(l.nome) === loteNomeNorm && l.area_atual_id === areaOrigemId)
          .map(l => l.id)
      );

      const hasEventoNaOrigem = todasMovimentacoesGlobal.some((mov) => {
        if (mov.id === entry.id) return false;
        // Não considerar outras transferências saindo da origem — essas são independentes
        if (mov.tipo === 'Transferência de Área') return false;
        
        const linkedIds = getLinkedMovementIds(mov.observacoes);
        if (mov.tipo === 'Pesagem' && linkedIds.includes(entry.id)) return false;
        
        // Só eventos que ocorreram na área de origem
        const movNaAreaOrigem = mov.area_origem_id === areaOrigemId || mov.area_destino_id === areaOrigemId;
        if (!movNaAreaOrigem) return false;

        const mesmoNome = normalize(mov.lote) === loteNomeNorm;
        const loteIdRelacionado = !!mov.lote_id && idsLotesOrigemEstaTransf.has(mov.lote_id);
        
        if (!mesmoNome && !loteIdRelacionado) return false;
        
        const dataItem = getTime(mov.data_movimentacao);
        const createdItem = getTime(mov.created_date || mov.data_movimentacao);
        return dataItem > dataAtual || (dataItem === dataAtual && createdItem > createdAtual);
      });
      if (hasEventoNaOrigem) return true;

      const hasRegistroPosteriorNoHistorico = historico.some((item) => {
        if (item.uniqueId === entry.uniqueId) return false;
        const sameLote = (item.lote_key || normalize(item.lote)) === loteAtual || normalize(item.lote) === loteNomeNorm;
        if (!sameLote) return false;

        const dataItem = getTime(item.data_evento);
        const createdItem = getTime(item.created_at);
        return dataItem > dataAtual || createdItem > createdAtual;
      });
      if (hasRegistroPosteriorNoHistorico) return true;

      return false;
    }

    // Verificação padrão para outros tipos (não-transferência): histórico local
    return historico.some((item) => {
      if (item.uniqueId === entry.uniqueId) return false;

      const sameLote = (item.lote_key || normalize(item.lote)) === loteAtual || normalize(item.lote) === loteNomeNorm;
      const childLinked = (item.linked_movement_ids || []).includes(entry.id);
      if (!sameLote && !childLinked) return false;

      const dataItem = getTime(item.data_evento);
      const createdItem = getTime(item.created_at);
      return childLinked || dataItem > dataAtual || createdItem > createdAtual;
    });
  }, [historico, todasMovimentacoesGlobal, todosLotesGlobal]);

  const getDeleteBlockReason = React.useCallback((entry) => {
    if (!entry?.canDelete) {
      if (entry?.tipo === 'Pesagem' && (entry?.linked_movement_ids || []).length > 0) {
        return 'Esta pesagem está vinculada à transferência. Para excluí-la, exclua a transferência correspondente (a pesagem será removida automaticamente).';
      }
      return 'Este registro só pode ser consultado no histórico.';
    }
    if (hasLaterRelatedRecord(entry)) {
      return 'Existem registros posteriores para este lote (pesagem, mudança de categoria, morte, etc). Exclua sempre os lançamentos mais recentes primeiro.';
    }
    return '';
  }, [hasLaterRelatedRecord]);

  const historicoVisivel = React.useMemo(
    () => historico.filter((item) => !(item.source === 'movimentacao' && hiddenMovementIds.includes(item.id))),
    [historico, hiddenMovementIds]
  );

  const openEditDialog = (movement) => {
    setEditMovOriginal(movement);
    setEditMovForm({
      data_movimentacao: String(movement.data_movimentacao || '').split('T')[0] || '',
      quantidade_animais: movement.quantidade_animais ?? 0,
      peso_medio: movement.peso_medio ?? '',
      observacoes: movement.observacoes || '',
    });
    setShowEdit(true);
  };

  const closeEditDialog = () => {
    if (updateMutation.isPending) return;
    setShowEdit(false);
    setEditMovOriginal(null);
    setEditMovForm(null);
  };

  const handleEditFieldChange = (field, value) => {
    setEditMovForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = async () => {
    if (!editMovOriginal || !editMovForm) return;
    await updateMutation.mutateAsync({
      movement: editMovOriginal,
      data: editMovForm,
    });
    closeEditDialog();
  };

  const handleDelete = async (entry) => {
    if (deletingId) return;

    setDeletingId(entry.id);

    const motivoBloqueio = getDeleteBlockReason(entry);
    if (motivoBloqueio) {
      setDeletingId(null);
      alert(motivoBloqueio);
      return;
    }

    const mov = entry.raw;
    if (!confirm('Excluir este lançamento? O lote será revertido automaticamente.')) {
      setDeletingId(null);
      return;
    }

    setHiddenMovementIds((prev) => (prev.includes(entry.id) ? prev : [...prev, entry.id]));

    try {
      const movsAll = await base44.entities.MovimentacaoMapa.list('-data_movimentacao');
      const movimentoAtual = movsAll.find((item) => item.id === mov.id);

      if (!movimentoAtual) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] }),
          queryClient.invalidateQueries({ queryKey: ['todas-movimentacoes-global'] }),
          queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] }),
        ]);
        toast.success('Lançamento já estava excluído');
        return;
      }

      const qtd = movimentoAtual.quantidade_animais || 0;

      if (mov.motivo !== 'Renomear Lote' && mov.motivo !== 'Junção de Lotes' && hasLaterRelatedRecord(entry)) {
        throw new Error('Existe lançamento mais recente para este lote. Exclua sempre o registro atual primeiro.');
      }

      const lotesAll = await base44.entities.Lote.list();
      const lotesEmpresa = lotesAll.filter(l => l.empresa_id === empresaSelecionadaId);

      const findLoteById = (id) => id ? lotesEmpresa.find(l => l.id === id) : null;
      const findLoteByNome = (nome, apenasAtivo = true) => lotesEmpresa.find(l =>
        normalize(l.nome) === normalize(nome) && (!apenasAtivo || l.status === 'Ativo')
      ) || null;
      const findLoteByNomeArea = (nome, areaId, apenasAtivo = false) => lotesEmpresa.find(l =>
        normalize(l.nome) === normalize(nome) && l.area_atual_id === areaId && (!apenasAtivo || l.status === 'Ativo')
      ) || null;
      const findLoteByNomeAreaCategoria = (nome, areaId, categoria, excludeId = null) => lotesEmpresa.find(l =>
        l.id !== excludeId &&
        normalize(l.nome) === normalize(nome) &&
        l.area_atual_id === areaId &&
        normalize(l.categoria) === normalize(categoria)
      ) || null;

      const resolverLote = () => findLoteById(mov.lote_id) || findLoteByNome(mov.lote);

      // Declarar categoriaMovimento no escopo externo para uso na reversão de transferência
      let categoriaMovimento = null;
      if (mov.tipo === 'Transferência de Área') {
        categoriaMovimento = mov.categoria_animal || parseCategoriaTransferenciaFromObs(mov.observacoes) || findLoteById(mov.lote_id)?.categoria || null;
        const pesagensFilhas = movsAll.filter(item =>
          item.empresa_id === empresaSelecionadaId &&
          item.tipo === 'Pesagem' &&
          getLinkedMovementIds(item.observacoes).includes(mov.id)
        );

        for (const pesagemFilha of pesagensFilhas) {
          if (pesagemFilha.lote_id) {
            const lotePesagem = findLoteById(pesagemFilha.lote_id);
            const pesoAnterior = getPesoAnteriorFromObs(pesagemFilha.observacoes);
            if (lotePesagem && pesoAnterior !== null) {
              await base44.entities.Lote.update(lotePesagem.id, { peso_medio_kg: pesoAnterior });
            }
          }
          await base44.entities.MovimentacaoMapa.delete(pesagemFilha.id);
        }
      }

      if (mov.motivo === 'Junção de Lotes') {
        const snapshotLotes = getJuncaoLotesSnapshot(mov.observacoes);
        if (!snapshotLotes || snapshotLotes.length === 0) {
          throw new Error('Não foi possível desfazer a junção: dados originais não encontrados.');
        }
        for (const lo of snapshotLotes) {
          await base44.entities.Lote.update(lo.id, {
            nome: lo.nome, quantidade_cabecas: lo.quantidade_cabecas, peso_medio_kg: lo.peso_medio_kg,
            status: lo.status, categoria: lo.categoria,
            categoria_manejo_id: lo.categoria_manejo_id || null, categoria_manejo_nome: lo.categoria_manejo_nome || null,
            area_atual_id: lo.area_atual_id, area_atual_nome: lo.area_atual_nome
          });
        }
      }

      if (mov.motivo === 'Renomear Lote') {
        const obsText = mov.observacoes || '';
        const m = obsText.match(/Renomear Lote: "(.+?)" →/);
        if (m && m[1] && mov.lote_id) {
          await base44.entities.Lote.update(mov.lote_id, { nome: m[1] });
        }
      }

      if (mov.tipo === 'Morte' || mov.tipo === 'Abate') {
        const loteRecord = resolverLote();
        if (loteRecord) {
          await base44.entities.Lote.update(loteRecord.id, {
            quantidade_cabecas: (loteRecord.quantidade_cabecas || 0) + qtd, status: 'Ativo'
          });
        }
      }

      if (mov.tipo === 'Nascimento') {
        const loteRecord = resolverLote();
        if (loteRecord) {
          const novaQtd = Math.max(0, (loteRecord.quantidade_cabecas || 0) - qtd);
          await base44.entities.Lote.update(loteRecord.id, {
            quantidade_cabecas: novaQtd, status: novaQtd > 0 ? loteRecord.status : 'Inativo'
          });
        }
      }

      if (mov.tipo === 'Pesagem') {
        const loteRecord = resolverLote();
        if (loteRecord) {
          const pesoAnterior = getPesoAnteriorFromObs(mov.observacoes);
          if (pesoAnterior !== null) {
            await base44.entities.Lote.update(loteRecord.id, { peso_medio_kg: pesoAnterior });
          }
        }
      }

      if (mov.tipo === 'Mudança de Categoria') {
        const categoriaAnterior = getCategoriaAnteriorFromObs(mov.observacoes);
        const categoriaNova = parseCategoriaNovaFromObs(mov.observacoes);
        const lotePrincipal = resolverLote();
        const qtdMovimento = mov.quantidade_animais || 0;

        if (categoriaAnterior && categoriaNova && lotePrincipal) {
          const loteCategoriaAnterior = findLoteByNomeAreaCategoria(mov.lote, mov.area_origem_id, categoriaAnterior) || lotePrincipal;
          const loteCategoriaNova = findLoteByNomeAreaCategoria(
            mov.lote,
            mov.area_origem_id,
            categoriaNova,
            loteCategoriaAnterior?.id
          );

          if (loteCategoriaNova && loteCategoriaNova.id !== loteCategoriaAnterior?.id) {
            await base44.entities.Lote.update(loteCategoriaAnterior.id, {
              quantidade_cabecas: (loteCategoriaAnterior.quantidade_cabecas || 0) + qtdMovimento,
              status: 'Ativo'
            });

            const novaQtdCategoriaNova = Math.max(0, (loteCategoriaNova.quantidade_cabecas || 0) - qtdMovimento);
            await base44.entities.Lote.update(loteCategoriaNova.id, {
              quantidade_cabecas: novaQtdCategoriaNova,
              status: novaQtdCategoriaNova > 0 ? 'Ativo' : 'Inativo'
            });
          } else {
            const sexoAnterior = getSexoAnteriorFromObs(mov.observacoes);
            const updateData = { categoria: categoriaAnterior };
            if (sexoAnterior) updateData.sexo = sexoAnterior;
            await base44.entities.Lote.update(lotePrincipal.id, updateData);
          }
        }
      }

      if (mov.tipo === 'Transferência de Área') {
        const origemFinal = categoriaMovimento
          ? (findLoteByNomeAreaCategoria(mov.lote, mov.area_origem_id, categoriaMovimento) || findLoteByNomeArea(mov.lote, mov.area_origem_id, true) || findLoteByNomeArea(mov.lote, mov.area_origem_id, false))
          : (findLoteByNomeArea(mov.lote, mov.area_origem_id, true) || findLoteByNomeArea(mov.lote, mov.area_origem_id, false));
        const destinoFinal = categoriaMovimento
          ? (findLoteByNomeAreaCategoria(mov.lote, mov.area_destino_id, categoriaMovimento) || findLoteByNomeArea(mov.lote, mov.area_destino_id, true) || findLoteByNomeArea(mov.lote, mov.area_destino_id, false))
          : (findLoteByNomeArea(mov.lote, mov.area_destino_id, true) || findLoteByNomeArea(mov.lote, mov.area_destino_id, false));
        const lotePorId = findLoteById(mov.lote_id);

        if (origemFinal && destinoFinal && origemFinal.id !== destinoFinal.id) {
          await base44.entities.Lote.update(origemFinal.id, {
            quantidade_cabecas: (origemFinal.quantidade_cabecas || 0) + qtd, status: 'Ativo'
          });
          const novaQtdDestino = (destinoFinal.quantidade_cabecas || 0) - qtd;
          await base44.entities.Lote.update(destinoFinal.id, {
            quantidade_cabecas: Math.max(0, novaQtdDestino),
            status: novaQtdDestino > 0 ? 'Ativo' : 'Inativo'
          });
        } else if (destinoFinal && (!origemFinal || destinoFinal.id === lotePorId?.id)) {
          if ((destinoFinal.quantidade_cabecas || 0) > qtd) {
            await base44.entities.Lote.create({
              empresa_id: destinoFinal.empresa_id, nome: destinoFinal.nome,
              quantidade_cabecas: qtd, categoria: destinoFinal.categoria,
              sexo: destinoFinal.sexo, peso_medio_kg: destinoFinal.peso_medio_kg,
              idade_media_meses: destinoFinal.idade_media_meses,
              area_atual_id: mov.area_origem_id, area_atual_nome: mov.area_origem_nome || '',
              raca_predominante: destinoFinal.raca_predominante,
              sistema_produtivo: destinoFinal.sistema_produtivo,
              categoria_manejo_id: destinoFinal.categoria_manejo_id,
              categoria_manejo_nome: destinoFinal.categoria_manejo_nome,
              data_entrada: mov.data_movimentacao, motivo_entrada: 'Outros',
              motivo_outros: 'Reversão de movimentação', origem: 'REVERSÃO MOVIMENTAÇÃO', status: 'Ativo'
            });
            await base44.entities.Lote.update(destinoFinal.id, {
              quantidade_cabecas: (destinoFinal.quantidade_cabecas || 0) - qtd
            });
          } else {
            await base44.entities.Lote.update(destinoFinal.id, {
              area_atual_id: mov.area_origem_id, area_atual_nome: mov.area_origem_nome || '', status: 'Ativo'
            });
          }
        } else if (lotePorId) {
          await base44.entities.Lote.update(lotePorId.id, {
            area_atual_id: mov.area_origem_id, area_atual_nome: mov.area_origem_nome || '', status: 'Ativo'
          });
        }
      }

      await base44.entities.MovimentacaoMapa.delete(mov.id);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lotes'] }),
        queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] }),
        queryClient.invalidateQueries({ queryKey: ['todas-movimentacoes-global'] }),
        queryClient.invalidateQueries({ queryKey: ['todos-lotes-global'] }),
        queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] }),
      ]);
      try { window.dispatchEvent(new CustomEvent('atualizar-mapa')); } catch {}
      toast.success('Lançamento excluído e saldo revertido');
    } catch (error) {
      console.error('Erro ao excluir lançamento:', error);
      if (error?.status === 404) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] }),
          queryClient.invalidateQueries({ queryKey: ['todas-movimentacoes-global'] }),
          queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] }),
        ]);
        toast.success('Lançamento já estava excluído');
      } else {
        setHiddenMovementIds((prev) => prev.filter((id) => id !== entry.id));
        toast.error(error.message || 'Não foi possível excluir o lançamento');
      }
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="text-center text-sm text-slate-500">Carregando histórico...</div>
        </CardContent>
      </Card>
    );
  }

  if (historicoVisivel.length === 0) {
    return (
      <Card>
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Histórico do Lote</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="text-center py-8 text-slate-500 text-sm">Nenhum lançamento encontrado</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="bg-slate-50 border-b py-3">
          <CardTitle className="text-sm font-semibold">Histórico do Lote ({historicoVisivel.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          <div className="max-h-[500px] overflow-y-auto space-y-2">
            {historicoVisivel.map((item) => {
              const motivoBloqueio = item.source === 'movimentacao' ? getDeleteBlockReason(item) : '';
              const isBloqueado = !!motivoBloqueio;
              const tipoExibicao = item.tipo_exibicao || item.tipo;

              return (
                <div key={item.uniqueId} className="border border-slate-200 rounded-lg p-2.5 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={`text-[10px] font-semibold border ${CORES_TIPO[tipoExibicao] || 'bg-slate-100 text-slate-800 border-slate-300'}`}>
                          {tipoExibicao}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-semibold">
                          {item.sourceLabel}
                        </Badge>
                        <span className="text-[10px] text-slate-500">
                          {formatDateOnly(item.data_evento)}
                        </span>
                      </div>

                      <div className="text-xs font-semibold text-slate-900">{item.lote || 'Sem lote'}</div>

                      <div className="space-y-0.5 text-[10px] text-slate-600">
                        {!!item.quantidade && <div><strong>Quantidade:</strong> {item.quantidade} cab</div>}
                        <div><strong>Data:</strong> {formatDateOnly(item.data_evento)}</div>
                        {item.tipo === 'Transferência de Área' && (
                          <div><strong>Trajeto:</strong> {item.area_origem_nome || '-'} → {item.area_destino_nome || '-'}</div>
                        )}
                        {!!item.peso_medio && <div><strong>Peso médio:</strong> {item.peso_medio} kg</div>}
                        <div><strong>Origem:</strong> {item.sourceLabel}</div>
                        {!!item.observacoes && <div className="break-words"><strong>Detalhes:</strong> {item.observacoes}</div>}
                        {item.source === 'suplementacao' && (
                          <div className="text-amber-600 font-medium"><strong>⚠ Regra:</strong> exclusão apenas pelo histórico do cocho.</div>
                        )}
                        {item.tipo === 'Transferência de Área' && areaId && item.raw?.area_origem_id !== areaId && (
                          <div className="text-amber-600 font-medium"><strong>⚠ Regra:</strong> exclusão apenas pela área de origem.</div>
                        )}
                        {isBloqueado && item.canDelete && (
                          <div className="text-amber-600 font-medium"><strong>⚠ Bloqueio:</strong> {motivoBloqueio}</div>
                        )}
                      </div>
                    </div>

                    {item.source === 'movimentacao' && (
                      <div className="flex gap-1 shrink-0">
                        {item.canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            disabled={isBloqueado || updateMutation.isPending}
                            onClick={() => openEditDialog(item.raw)}
                          >
                            Editar
                          </Button>
                        )}
                        {item.canDelete && (
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-8 text-xs"
                            disabled={!!deletingId || hiddenMovementIds.includes(item.id) || isBloqueado}
                            onClick={() => handleDelete(item)}
                          >
                            {deletingId === item.id ? 'Excluindo...' : 'Excluir'}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <MovimentacaoEditDialog
        open={showEdit}
        movement={editMovOriginal}
        formData={editMovForm}
        isSaving={updateMutation.isPending}
        onClose={closeEditDialog}
        onChange={handleEditFieldChange}
        onSave={handleSaveEdit}
      />
    </>
  );
}
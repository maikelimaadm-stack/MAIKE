import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  normalizeText,
  getLinkedMovementIds,
  getJuncaoLotesSnapshot,
  getPesoAnteriorFromObs,
  getCategoriaAnteriorFromObs,
  getSexoAnteriorFromObs,
} from "../utils/pecuariaUtils";

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

export default function HistoricoMovimentacoes({ lotes = [], lotesIds = [], areaId }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  const [editMov, setEditMov] = React.useState(null);
  const [showEdit, setShowEdit] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState(null);
  const loteIds = React.useMemo(() => lotes.map((item) => item?.id).filter(Boolean), [lotes]);
  const loteNomes = React.useMemo(() => {
    const nomesDosLotes = lotes.map((item) => item?.nome).filter(Boolean);
    return nomesDosLotes.length > 0 ? nomesDosLotes : lotesIds.filter(Boolean);
  }, [lotes, lotesIds]);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.MovimentacaoMapa.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] })
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

      const transferenciasParaAreaAtual = movimentacoesRaw
        .filter((mov) => mov.empresa_id === empresaSelecionadaId)
        .filter((mov) => mov.tipo === 'Transferência de Área')
        .filter((mov) => mov.area_destino_id === areaId)
        .filter((mov) => matchLote(mov.lote, mov.lote_id));

      const inicioNovoHistorico = transferenciasParaAreaAtual.length > 0
        ? Math.max(...transferenciasParaAreaAtual.map((mov) => getTime(mov.data_movimentacao)))
        : null;

      const dentroDoHistoricoAtual = (dataEvento) => !inicioNovoHistorico || getTime(dataEvento) >= inicioNovoHistorico;

      const movimentacoes = movimentacoesRaw
        .filter((mov) => mov.empresa_id === empresaSelecionadaId)
        .filter((mov) => {
          if (loteIds.length > 0 || loteNomes.length > 0) {
            return matchLote(mov.lote, mov.lote_id) && dentroDoHistoricoAtual(mov.data_movimentacao);
          }
          return matchAreaMov(mov) && dentroDoHistoricoAtual(mov.data_movimentacao);
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
            // Transferência pode ser excluída (exclui pesagens vinculadas junto)
            (mov.tipo === 'Transferência de Área' && !mov.motivo) ||
            // Outros tipos editáveis podem ser excluídos se não forem pesagem vinculada
            (TIPOS_EDITAVEIS.has(mov.tipo) && !mov.motivo && !(mov.tipo === 'Pesagem' && getLinkedMovementIds(mov.observacoes).length > 0)) ||
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
        .filter((item) => matchLote(item.lote_nome, item.lote_id))
        .filter((item) => dentroDoHistoricoAtual(item.data_lancamento))
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
        .filter((item) => matchLote(item.lote_nome, item.lote_id))
        .filter((item) => dentroDoHistoricoAtual(item.data_aplicacao))
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
        .filter((item) => dentroDoHistoricoAtual(item.data_evento))
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
        .filter((item) => matchLote(item.nome_lote, item.lote_id))
        .filter((item) => dentroDoHistoricoAtual(item.data_evento))
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
          const dataDiff = getTime(b.data_evento) - getTime(a.data_evento);
          if (dataDiff !== 0) return dataDiff;
          return getTime(b.created_at) - getTime(a.created_at);
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

    // Para transferências, verificar TODAS as movimentações globais (não apenas as do histórico filtrado)
    // porque lotes derivados (parciais) no destino podem ter IDs diferentes
    if (isTransferencia) {
      const loteIdOriginal = entry?.raw?.lote_id;
      const hasLaterGlobal = todasMovimentacoesGlobal.some((mov) => {
        if (mov.id === entry.id) return false;
        
        // Pesagens vinculadas à transferência são excluídas junto, não bloqueiam
        const linkedIds = getLinkedMovementIds(mov.observacoes);
        if (mov.tipo === 'Pesagem' && linkedIds.includes(entry.id)) return false;
        
        // Match por nome OU por lote_id do lote original
        const mesmoNome = normalize(mov.lote) === loteNomeNorm;
        const mesmoIdOriginal = !!mov.lote_id && !!loteIdOriginal && mov.lote_id === loteIdOriginal;
        
        if (!mesmoNome && !mesmoIdOriginal) return false;
        
        const dataItem = getTime(mov.data_movimentacao);
        const createdItem = getTime(mov.created_date || mov.data_movimentacao);
        return dataItem > dataAtual || (dataItem === dataAtual && createdItem > createdAtual);
      });
      if (hasLaterGlobal) return true;
    }

    // Verificação padrão no histórico local
    return historico.some((item) => {
      if (item.uniqueId === entry.uniqueId) return false;

      // Pesagens vinculadas à transferência pai são excluídas junto
      if (isTransferencia && item.source === 'movimentacao') {
        const linkedIds = (item.linked_movement_ids || []);
        if (item.tipo === 'Pesagem' && linkedIds.includes(entry.id)) {
          return false;
        }
      }

      const sameLote = (item.lote_key || normalize(item.lote)) === loteAtual;
      const childLinked = (item.linked_movement_ids || []).includes(entry.id);
      if (!sameLote && !childLinked) return false;

      const dataItem = getTime(item.data_evento);
      const createdItem = getTime(item.created_at);
      return childLinked || dataItem > dataAtual || (dataItem === dataAtual && createdItem > createdAtual);
    });
  }, [historico, todasMovimentacoesGlobal]);

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

  const handleDelete = async (entry) => {
    const motivoBloqueio = getDeleteBlockReason(entry);
    if (motivoBloqueio) {
      alert(motivoBloqueio);
      return;
    }

    const mov = entry.raw;
    if (!confirm('Excluir este lançamento? O lote será revertido automaticamente.')) return;

    setDeletingId(entry.id);

    try {
      const lotesAll = await base44.entities.Lote.list();
      const lotesEmpresa = lotesAll.filter((l) => l.empresa_id === empresaSelecionadaId);
      const qtd = mov.quantidade_animais || 0;
      const lotePorId = mov.lote_id ? lotesEmpresa.find((l) => l.id === mov.lote_id) : null;
      const loteOrigem = lotesEmpresa.find((l) => normalize(l.nome) === normalize(mov.lote) && l.area_atual_id === mov.area_origem_id && l.status === 'Ativo');
      const loteDestino = lotesEmpresa.find((l) => normalize(l.nome) === normalize(mov.lote) && l.area_atual_id === mov.area_destino_id && l.status === 'Ativo');
      const loteMesmoNome = lotesEmpresa.find((l) => normalize(l.nome) === normalize(mov.lote) && l.status === 'Ativo');
      const loteRecord = lotePorId || loteMesmoNome;

      if (mov.motivo !== 'Renomear Lote' && mov.motivo !== 'Junção de Lotes' && hasLaterRelatedRecord(entry)) {
        throw new Error('Existe lançamento mais recente para este lote. Exclua sempre o registro atual primeiro.');
      }

      if (mov.tipo === 'Transferência de Área') {
        const todasMovimentacoes = await base44.entities.MovimentacaoMapa.list('-data_movimentacao');
        const pesagensFilhas = todasMovimentacoes.filter((item) =>
          item.empresa_id === empresaSelecionadaId &&
          item.tipo === 'Pesagem' &&
          getLinkedMovementIds(item.observacoes).includes(mov.id)
        );

        for (const pesagemFilha of pesagensFilhas) {
          if (pesagemFilha.lote_id) {
            const lotePesagem = lotesEmpresa.find((l) => l.id === pesagemFilha.lote_id);
            const pesoAnterior = getPesoAnteriorFromObs(pesagemFilha.observacoes);
            if (lotePesagem && pesoAnterior !== null) {
              await base44.entities.Lote.update(lotePesagem.id, {
                peso_medio_kg: pesoAnterior
              });
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

        for (const loteOriginal of snapshotLotes) {
          await base44.entities.Lote.update(loteOriginal.id, {
            nome: loteOriginal.nome,
            quantidade_cabecas: loteOriginal.quantidade_cabecas,
            peso_medio_kg: loteOriginal.peso_medio_kg,
            status: loteOriginal.status,
            categoria: loteOriginal.categoria,
            categoria_manejo_id: loteOriginal.categoria_manejo_id || null,
            categoria_manejo_nome: loteOriginal.categoria_manejo_nome || null,
            area_atual_id: loteOriginal.area_atual_id,
            area_atual_nome: loteOriginal.area_atual_nome
          });
        }
      }

      // Reverter renomear lote: extrair nome anterior da observação
      if (mov.motivo === 'Renomear Lote') {
        const obsText = mov.observacoes || '';
        const matchRenomear = obsText.match(/Renomear Lote: "(.+?)" →/);
        if (matchRenomear && matchRenomear[1] && mov.lote_id) {
          await base44.entities.Lote.update(mov.lote_id, { nome: matchRenomear[1] });
        }
      }

      if (mov.tipo === 'Morte' || mov.tipo === 'Abate') {
        if (loteRecord) {
          await base44.entities.Lote.update(loteRecord.id, {
            quantidade_cabecas: (loteRecord.quantidade_cabecas || 0) + qtd
          });
        }
      }

      if (mov.tipo === 'Nascimento') {
        if (loteRecord) {
          const novaQtd = Math.max(0, (loteRecord.quantidade_cabecas || 0) - qtd);
          await base44.entities.Lote.update(loteRecord.id, {
            quantidade_cabecas: novaQtd,
            status: novaQtd > 0 ? loteRecord.status : 'Inativo'
          });
        }
      }

      if (mov.tipo === 'Pesagem') {
        if (loteRecord) {
          const pesoAnterior = getPesoAnteriorFromObs(mov.observacoes);
          if (pesoAnterior !== null) {
            await base44.entities.Lote.update(loteRecord.id, {
              peso_medio_kg: pesoAnterior
            });
          }
        }
      }

      if (mov.tipo === 'Mudança de Categoria') {
        if (loteRecord) {
          const categoriaAnterior = getCategoriaAnteriorFromObs(mov.observacoes);
          const sexoAnterior = getSexoAnteriorFromObs(mov.observacoes);
          if (categoriaAnterior) {
            const updateData = { categoria: categoriaAnterior };
            if (sexoAnterior) {
              updateData.sexo = sexoAnterior;
            }
            await base44.entities.Lote.update(loteRecord.id, updateData);
          }
        }
      }

      if (mov.tipo === 'Transferência de Área') {
        // Buscar lotes incluindo inativos para cobrir movimentação parcial que inativou lote na origem
        const loteOrigemInclInativo = lotesEmpresa.find((l) => normalize(l.nome) === normalize(mov.lote) && l.area_atual_id === mov.area_origem_id);
        const loteDestinoInclInativo = lotesEmpresa.find((l) => normalize(l.nome) === normalize(mov.lote) && l.area_atual_id === mov.area_destino_id);
        // Preferir o lote ativo, mas aceitar inativo se não houver ativo
        const origemFinal = loteOrigem || loteOrigemInclInativo;
        const destinoFinal = loteDestino || loteDestinoInclInativo;

        if (origemFinal && destinoFinal && origemFinal.id !== destinoFinal.id) {
          // Caso 1: lotes distintos na origem e destino (movimentação parcial ou com unir)
          // Devolver cabeças ao lote de origem e reativar se necessário
          await base44.entities.Lote.update(origemFinal.id, {
            quantidade_cabecas: (origemFinal.quantidade_cabecas || 0) + qtd,
            status: 'Ativo'
          });

          const novaQtdDestino = (destinoFinal.quantidade_cabecas || 0) - qtd;
          await base44.entities.Lote.update(destinoFinal.id, {
            quantidade_cabecas: Math.max(0, novaQtdDestino),
            status: novaQtdDestino > 0 ? 'Ativo' : 'Inativo'
          });
        } else if (destinoFinal && (!origemFinal || destinoFinal.id === lotePorId?.id)) {
          // Caso 2: mesmo lote movido inteiro (não existe lote separado na origem)
          if ((destinoFinal.quantidade_cabecas || 0) > qtd) {
            // Movimentação parcial sem lote separado na origem: criar novo lote na origem
            await base44.entities.Lote.create({
              empresa_id: destinoFinal.empresa_id,
              nome: destinoFinal.nome,
              quantidade_cabecas: qtd,
              categoria: destinoFinal.categoria,
              sexo: destinoFinal.sexo,
              peso_medio_kg: destinoFinal.peso_medio_kg,
              idade_media_meses: destinoFinal.idade_media_meses,
              area_atual_id: mov.area_origem_id,
              area_atual_nome: mov.area_origem_nome || '',
              raca_predominante: destinoFinal.raca_predominante,
              sistema_produtivo: destinoFinal.sistema_produtivo,
              categoria_manejo_id: destinoFinal.categoria_manejo_id,
              categoria_manejo_nome: destinoFinal.categoria_manejo_nome,
              data_entrada: mov.data_movimentacao,
              motivo_entrada: 'Outros',
              motivo_outros: 'Reversão de movimentação',
              origem: 'REVERSÃO MOVIMENTAÇÃO',
              status: 'Ativo'
            });
            await base44.entities.Lote.update(destinoFinal.id, {
              quantidade_cabecas: (destinoFinal.quantidade_cabecas || 0) - qtd
            });
          } else {
            // Lote inteiro movido: simplesmente mover de volta para a origem
            await base44.entities.Lote.update(destinoFinal.id, {
              area_atual_id: mov.area_origem_id,
              area_atual_nome: mov.area_origem_nome || '',
              status: 'Ativo'
            });
          }
        } else if (loteRecord) {
          // Fallback: mover o lote de volta pelo ID
          await base44.entities.Lote.update(loteRecord.id, {
            area_atual_id: mov.area_origem_id,
            area_atual_nome: mov.area_origem_nome || '',
            status: 'Ativo'
          });
        }
      }

      await base44.entities.MovimentacaoMapa.delete(mov.id);
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
      queryClient.invalidateQueries({ queryKey: ['todas-movimentacoes-global'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] });
      try { window.dispatchEvent(new CustomEvent('atualizar-mapa')); } catch {}
      toast.success('Lançamento excluído do histórico e do MovimentacaoMapa');
    } catch (error) {
      console.error('Erro ao excluir lançamento:', error);
      toast.error(error.message || 'Não foi possível excluir o lançamento');
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

  if (historico.length === 0) {
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
          <CardTitle className="text-sm font-semibold">Histórico do Lote ({historico.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          <div className="max-h-[500px] overflow-y-auto space-y-2">
            {historico.map((item) => {
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
                          {new Date(item.data_evento).toLocaleDateString('pt-BR')}
                        </span>
                      </div>

                      <div className="text-xs font-semibold text-slate-900">{item.lote || 'Sem lote'}</div>

                      <div className="space-y-0.5 text-[10px] text-slate-600">
                        {!!item.quantidade && <div><strong>Quantidade:</strong> {item.quantidade} cab</div>}
                        <div><strong>Data:</strong> {new Date(item.data_evento).toLocaleDateString('pt-BR')}</div>
                        {item.tipo === 'Transferência de Área' && (
                          <div><strong>Trajeto:</strong> {item.area_origem_nome || '-'} → {item.area_destino_nome || '-'}</div>
                        )}
                        {!!item.peso_medio && <div><strong>Peso médio:</strong> {item.peso_medio} kg</div>}
                        <div><strong>Origem:</strong> {item.sourceLabel}</div>
                        {!!item.observacoes && <div className="break-words"><strong>Detalhes:</strong> {item.observacoes}</div>}
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
                            disabled={isBloqueado}
                            onClick={() => { setEditMov(item.raw); setShowEdit(true); }}
                          >
                            Editar
                          </Button>
                        )}
                        {item.canDelete && (
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-8 text-xs"
                            disabled={!!deletingId || isBloqueado}
                            onClick={() => handleDelete(item)}
                          >
                            Excluir
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

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Editar Lançamento</DialogTitle>
          </DialogHeader>
          {editMov && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-600">Quantidade</label>
                <Input
                  type="number"
                  className="h-8 text-xs"
                  value={editMov.quantidade_animais || 0}
                  onChange={(e) => setEditMov({ ...editMov, quantidade_animais: parseInt(e.target.value || '0', 10) })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-600">Observações</label>
                <Textarea
                  rows={3}
                  className="text-xs"
                  value={editMov.observacoes || ''}
                  onChange={(e) => setEditMov({ ...editMov, observacoes: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowEdit(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={async () => {
                    await updateMutation.mutateAsync({
                      id: editMov.id,
                      data: {
                        quantidade_animais: editMov.quantidade_animais,
                        observacoes: editMov.observacoes,
                      }
                    });
                    setShowEdit(false);
                  }}
                >
                  Salvar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
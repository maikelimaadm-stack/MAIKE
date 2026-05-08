import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMapaCachedData, refreshMapaCacheEntry } from "@/components/offline/mapaOfflineCache";
import { toNoonUtcISOString } from "../utils/pecuariaUtils";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle } from
"@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import FormularioMovimentacaoLote from "../lotes/FormularioMovimentacaoLote";
import FormularioMorte from "../lotes/FormularioMorte";
import FormularioNascimento from "../lotes/FormularioNascimento";
import FormularioAbate from "../lotes/FormularioAbate";
import FormularioMudancaCategoria from "../lotes/FormularioMudancaCategoria";
import FormularioPesagem from "../lotes/FormularioPesagem";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import HistoricoSuplementacaoLote from "../suplementacao/HistoricoSuplementacaoLote";
import RenomearLoteForm from "../lotes/RenomearLoteForm";
import ResumoSuplementacao from "../suplementacao/ResumoSuplementacao";
import InformacoesArea from "./InformacoesArea";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle } from "lucide-react";
import { validarOrdemTemporalLote, validarOrdemTemporalLotes } from "../lotes/manejoValidations.jsx";

export default function DetalhesLote({ lotes, onClose, permissions = {} }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showMovimentacao, setShowMovimentacao] = useState(false);
  const [showMorte, setShowMorte] = useState(false);
  const [showNascimento, setShowNascimento] = useState(false);
  const [showAbate, setShowAbate] = useState(false);
  const [showMudancaCategoria, setShowMudancaCategoria] = useState(false);
  const [showPesagem, setShowPesagem] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [showHistoricoSupl, setShowHistoricoSupl] = useState(false);
  const [showRenomear, setShowRenomear] = useState(false);
  const [novoNomeLote, setNovoNomeLote] = useState('');
  const [loteParaRenomear, setLoteParaRenomear] = useState(null);
  const [showConfirmPesagem, setShowConfirmPesagem] = useState(false);
  const [lotesAtualizados, setLotesAtualizados] = useState(null);
  const [movimentacaoPendente, setMovimentacaoPendente] = useState(null);
  const [registrarPesagemAposMovimentacao, setRegistrarPesagemAposMovimentacao] = useState(false);
  const [movimentacoesCriadasIds, setMovimentacoesCriadasIds] = useState([]);
  const [progresso, setProgresso] = useState({ show: false, atual: 0, total: 0, mensagem: '' });
  const [showJuntarLotes, setShowJuntarLotes] = useState(false);
  const [lotePrincipalJuncao, setLotePrincipalJuncao] = useState(null);
  const [categoriaSelecionadaJuncao, setCategoriaSelecionadaJuncao] = useState(null);
  const [dataJuncao, setDataJuncao] = useState(() => new Date().toISOString().split('T')[0]);
  const [areaDestinoPreSelecionada, setAreaDestinoPreSelecionada] = useState(null);
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ['detalhes-lote-user'], queryFn: () => base44.auth.me(), staleTime: 10 * 60 * 1000 });

  // Listener para abrir movimentação via drag-and-drop
  React.useEffect(() => {
    const handleOpenMovimentacao = (e) => {
      setAreaDestinoPreSelecionada(e?.detail?.areaDestinoId || null);
      setShowMovimentacao(true);
    };

    window.addEventListener('open-movimentacao', handleOpenMovimentacao);
    return () => {
      window.removeEventListener('open-movimentacao', handleOpenMovimentacao);
    };
  }, []);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones-global'],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((i) => i.ativo !== false);
    },
    staleTime: 10 * 60 * 1000
  });

  // Agrupar lotes por categoria
  const lotesPorCategoria = lotes.reduce((acc, lote) => {
    const cat = lote.categoria?.toUpperCase() || 'SEM CATEGORIA';
    if (!acc[cat]) {
      acc[cat] = [];
    }
    acc[cat].push(lote);
    return acc;
  }, {});

  const categorias = Object.keys(lotesPorCategoria).sort();

  // Calcular total de cabeças
  const totalCabecas = lotes.reduce((sum, lote) => sum + (lote.quantidade_cabecas || 0), 0);

  // Título com nomes dos lotes
  const tituloLotes = lotes.map((l) => l.nome).join(' - ');

  const { data: areas = [], isLoading: loadingAreas } = useQuery({
    queryKey: ['mapa-areas', empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('areas', empresaSelecionadaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('areas', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(['mapa-areas', empresaSelecionadaId], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('areas', empresaSelecionadaId);
      }
      return cached || [];
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 5 * 60 * 1000
  });

  const areaAtual = areas.find((a) => a.id === lotes[0]?.area_atual_id) || { nome: lotes[0]?.area_atual_nome || 'Desconhecida' };

  const atualizarLoteDestinoLocal = (lista, loteAtualizado) => {
    if (!loteAtualizado?.id) return;
    const index = lista.findIndex((item) => item.id === loteAtualizado.id);
    if (index >= 0) {
      lista[index] = loteAtualizado;
      return;
    }
    lista.push(loteAtualizado);
  };

  // Buscar todos os lotes ativos na mesma área (para métricas da área)
  const { data: todosLotesNaArea = [], isLoading: loadingLotesArea } = useQuery({
    queryKey: ['mapa-lotes', empresaSelecionadaId],
    queryFn: async () => {
      const cached = await getMapaCachedData('lotes', empresaSelecionadaId);
      if (navigator.onLine) {
        if (cached?.length) {
          refreshMapaCacheEntry('lotes', empresaSelecionadaId).then(fresh => {
            if (fresh?.length) queryClient.setQueryData(['mapa-lotes', empresaSelecionadaId], fresh);
          });
          return cached;
        }
        return await refreshMapaCacheEntry('lotes', empresaSelecionadaId);
      }
      return cached || [];
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 60 * 1000,
    select: (data) => data.filter(l => l.area_atual_id === lotes[0]?.area_atual_id)
  });

  // Aguarda a leitura do cache local (IndexedDB) que é super rápida, para não exibir os dados zerados
  const loadingInicial = (loadingAreas && areas.length === 0) || (loadingLotesArea && todosLotesNaArea.length === 0);

  const movimentacaoMutation = useMutation({
    mutationFn: async (formData) => {
      console.log('🔄 INICIANDO MOVIMENTAÇÃO');
      const areaSaida = areas.find((a) => a.id === formData.area_saida_id);
      const areaEntrada = areas.find((a) => a.id === formData.area_entrada_id);
      const movimentacoesCriadas = [];
      const todosLotesSistema = await base44.entities.Lote.filter({ empresa_id: empresaSelecionadaId });
      const lotesDestinoAtivos = todosLotesSistema.filter((l) =>
      l.area_atual_id === formData.area_entrada_id &&
      l.status === 'Ativo'
      );
      const lotesOrigemLocais = lotes.map((lote) => ({ ...lote }));
      const atualizarLoteOrigemLocal = (loteId, changes) => {
        const index = lotesOrigemLocais.findIndex((item) => item.id === loteId);
        if (index >= 0) {
          lotesOrigemLocais[index] = { ...lotesOrigemLocais[index], ...changes };
        }
      };
      const encontrarLoteDestinoCompativel = (loteOrigem, categoriaMovimento) => {
        return lotesDestinoAtivos.find((l) =>
        l.area_atual_id === formData.area_entrada_id &&
        (l.nome || '').toUpperCase() === (loteOrigem.nome || '').toUpperCase() &&
        (l.categoria || '').toUpperCase() === categoriaMovimento &&
        l.status === 'Ativo'
        );
      };

      // Movimentação - os eventos já foram fechados no FormularioMovimentacaoLote
      if (formData.mover_todos === 'sim') {
        await validarOrdemTemporalLotes({
          empresaId: empresaSelecionadaId,
          lotes,
          dataReferencia: formData.data_movimentacao
        });

        for (const lote of lotes) {
          const categoriaMovimento = (lote.categoria || '').toUpperCase();
          const loteExistente = encontrarLoteDestinoCompativel(lote, categoriaMovimento);
          const identificadorPayload = {
            identificador_nome: lote.identificador_nome || null,
            identificador_sigla: lote.identificador_sigla || null,
            identificador_cor: lote.identificador_cor || null,
          };

          if (loteExistente) {
            const loteDestinoAtualizado = await base44.entities.Lote.update(loteExistente.id, {
              quantidade_cabecas: (loteExistente.quantidade_cabecas || 0) + (lote.quantidade_cabecas || 0),
              ...identificadorPayload
            });
            atualizarLoteDestinoLocal(lotesDestinoAtivos, loteDestinoAtualizado);
            await base44.entities.Lote.update(lote.id, { status: 'Inativo', quantidade_cabecas: 0 });
          } else {
            await base44.entities.Lote.update(lote.id, {
              area_atual_id: formData.area_entrada_id,
              area_atual_nome: areaEntrada?.nome || ''
            });
          }

          const movimentacaoCriada = await base44.entities.MovimentacaoMapa.create({
            empresa_id: empresaSelecionadaId,
            data_movimentacao: toNoonUtcISOString(formData.data_movimentacao),
            tipo: 'Transferência de Área',
            lote: lote.nome,
            lote_id: lote.id,
            categoria_animal: lote.categoria,
            quantidade_animais: lote.quantidade_cabecas,
            area_origem_id: formData.area_saida_id,
            area_origem_nome: areaSaida?.nome || '',
            area_destino_id: formData.area_entrada_id,
            area_destino_nome: areaEntrada?.nome || '',
            usuario_responsavel: user?.email || null,
            observacoes: `Movimentação completa do lote - ${lote.quantidade_cabecas} cabeças`
          });
          movimentacoesCriadas.push(movimentacaoCriada);
        }
      } else {
        for (const mov of formData.movimentacoes) {
          if (mov.quantidade <= 0) continue;

          const lotesCategoria = lotesOrigemLocais.filter((l) => l.categoria?.toUpperCase() === mov.categoria && (l.quantidade_cabecas || 0) > 0 && l.status === 'Ativo');
          let quantidadeRestante = Number(mov.quantidade || 0);

          for (const lote of lotesCategoria) {
            if (quantidadeRestante <= 0) break;

            await validarOrdemTemporalLote({
              empresaId: empresaSelecionadaId,
              loteId: lote.id,
              dataReferencia: formData.data_movimentacao
            });

            const quantidadeMover = Math.min(quantidadeRestante, lote.quantidade_cabecas || 0);
            if (quantidadeMover <= 0) continue;
            // Unificação automática: buscar lote com mesmo nome+categoria no destino
            const loteExistente = encontrarLoteDestinoCompativel(lote, mov.categoria);
            const identificadorPayload = {
              identificador_nome: lote.identificador_nome || null,
              identificador_sigla: lote.identificador_sigla || null,
              identificador_cor: lote.identificador_cor || null,
            };

            if (quantidadeMover === (lote.quantidade_cabecas || 0)) {
              if (loteExistente) {
                // Unificar automaticamente com lote existente de mesmo nome+categoria
                const loteDestinoAtualizado = await base44.entities.Lote.update(loteExistente.id, {
                  quantidade_cabecas: (loteExistente.quantidade_cabecas || 0) + quantidadeMover,
                  ...identificadorPayload
                });
                atualizarLoteDestinoLocal(lotesDestinoAtivos, loteDestinoAtualizado);
                await base44.entities.Lote.update(lote.id, { status: 'Inativo', quantidade_cabecas: 0 });
                atualizarLoteOrigemLocal(lote.id, { status: 'Inativo', quantidade_cabecas: 0 });
              } else {
                await base44.entities.Lote.update(lote.id, {
                  area_atual_id: formData.area_entrada_id,
                  area_atual_nome: areaEntrada?.nome || ''
                });
                atualizarLoteOrigemLocal(lote.id, {
                  area_atual_id: formData.area_entrada_id,
                  area_atual_nome: areaEntrada?.nome || ''
                });
              }
            } else {
              if (loteExistente) {
                const loteDestinoAtualizado = await base44.entities.Lote.update(loteExistente.id, {
                  quantidade_cabecas: (loteExistente.quantidade_cabecas || 0) + quantidadeMover,
                  ...identificadorPayload
                });
                atualizarLoteDestinoLocal(lotesDestinoAtivos, loteDestinoAtualizado);
              } else {
                const novoLote = await base44.entities.Lote.create({
                  empresa_id: empresaSelecionadaId,
                  nome: lote.nome,
                  quantidade_cabecas: quantidadeMover,
                  quantidade_entrada: quantidadeMover,
                  categoria: lote.categoria,
                  categoria_entrada: lote.categoria_entrada || lote.categoria,
                  sexo: lote.sexo,
                  peso_medio_kg: lote.peso_medio_kg,
                  peso_entrada_kg: lote.peso_entrada_kg || lote.peso_medio_kg,
                  idade_media_meses: lote.idade_media_meses,
                  area_atual_id: formData.area_entrada_id,
                  area_atual_nome: areaEntrada?.nome || '',
                  area_entrada_id: formData.area_entrada_id,
                  area_entrada_nome: areaEntrada?.nome || '',
                  raca_predominante: lote.raca_predominante,
                  sistema_produtivo: lote.sistema_produtivo,
                  categoria_manejo_id: lote.categoria_manejo_id,
                  categoria_manejo_nome: lote.categoria_manejo_nome,
                  categoria_manejo_entrada_id: lote.categoria_manejo_entrada_id || lote.categoria_manejo_id,
                  categoria_manejo_entrada_nome: lote.categoria_manejo_entrada_nome || lote.categoria_manejo_nome,
                  identificador_nome: lote.identificador_nome || null,
                  identificador_sigla: lote.identificador_sigla || null,
                  identificador_cor: lote.identificador_cor || null,
                  data_entrada: formData.data_movimentacao,
                  motivo_entrada: 'Outros',
                  motivo_outros: 'Movimentação parcial',
                  origem: 'MOVIMENTAÇÃO',
                  status: 'Ativo'
                });
                lotesDestinoAtivos.push(novoLote);
              }

              const saldoRemanescente = Math.max(0, (lote.quantidade_cabecas || 0) - quantidadeMover);
              const novoStatusOrigem = saldoRemanescente > 0 ? lote.status : 'Inativo';
              await base44.entities.Lote.update(lote.id, {
                quantidade_cabecas: saldoRemanescente,
                status: novoStatusOrigem
              });
              atualizarLoteOrigemLocal(lote.id, {
                quantidade_cabecas: saldoRemanescente,
                status: novoStatusOrigem
              });
            }

            const movimentacaoCriada = await base44.entities.MovimentacaoMapa.create({
              empresa_id: empresaSelecionadaId,
              data_movimentacao: toNoonUtcISOString(formData.data_movimentacao),
              tipo: 'Transferência de Área',
              lote: lote.nome,
              lote_id: lote.id,
              categoria_animal: lote.categoria,
              quantidade_animais: quantidadeMover,
              area_origem_id: formData.area_saida_id,
              area_origem_nome: areaSaida?.nome || '',
              area_destino_id: formData.area_entrada_id,
              area_destino_nome: areaEntrada?.nome || '',
              usuario_responsavel: user?.email || null,
              observacoes: `Movimentação parcial - ${quantidadeMover} cabeças de ${mov.categoria}`
            });
            movimentacoesCriadas.push(movimentacaoCriada);

            quantidadeRestante -= quantidadeMover;
          }

          if (quantidadeRestante > 0) {
            throw new Error(`Não foi possível mover toda a quantidade solicitada da categoria ${mov.categoria}.`);
          }
        }
      }

      if (Array.isArray(formData.sobras_destino_aproveitar) && formData.sobras_destino_aproveitar.length > 0) {
        const totalMovimentado = formData.mover_todos === 'sim'
          ? lotes.reduce((sum, lote) => sum + Number(lote.quantidade_cabecas || 0), 0)
          : (formData.movimentacoes || []).reduce((sum, mov) => sum + Number(mov.quantidade || 0), 0);

        const lotesAtualizadosDestino = await base44.entities.Lote.filter({ empresa_id: empresaSelecionadaId });
        const produtosEmpresa = await base44.entities.Produto.filter({ empresa_id: empresaSelecionadaId });
        const lotesParaHistoricoSuplementacao = lotesAtualizadosDestino.filter((lote) =>
          lote.area_atual_id === formData.area_entrada_id &&
          lote.status === 'Ativo' &&
          Number(lote.quantidade_cabecas || 0) > 0
        );
        const totalCabecasHistorico = lotesParaHistoricoSuplementacao.reduce((sum, lote) => sum + Number(lote.quantidade_cabecas || 0), 0);
        const pesoMedioHistorico = totalCabecasHistorico > 0
          ? lotesParaHistoricoSuplementacao.reduce((sum, lote) => sum + Number(lote.peso_medio_kg || 0) * Number(lote.quantidade_cabecas || 0), 0) / totalCabecasHistorico
          : 0;

        for (const sobra of formData.sobras_destino_aproveitar) {
          const produtoSobra = produtosEmpresa.find((produto) => produto.id === sobra.produto_id || produto.nome_produto === sobra.produto) || null;
          const percentualPV = Number(produtoSobra?.percentual_consumo_pv || 0);
          const consumoEsperadoGrupo = percentualPV > 0 && pesoMedioHistorico > 0
            ? (pesoMedioHistorico * (percentualPV / 100)) * totalCabecasHistorico
            : null;
          const novoEventoSuplementacao = await base44.entities.SuplementacaoEvento.create({
            empresa_id: empresaSelecionadaId,
            ponto_suplementacao_id: sobra.ponto_id,
            ponto_nome: sobra.ponto_nome,
            area_id: formData.area_entrada_id,
            area_nome: areaEntrada?.nome || '',
            area_ids: [formData.area_entrada_id],
            area_nomes: [areaEntrada?.nome || ''].filter(Boolean),
            data_lancamento: formData.data_movimentacao,
            produto: sobra.produto,
            produto_id: sobra.produto_id || null,
            tipo_consumo: sobra.tipo_consumo || null,
            quantidade_total_kg: 0,
            sobra_kg: Number(sobra.sobra_kg || 0),
            dias_periodo: null,
            consumo_diario_grupo_kg: null,
            total_cabecas_afetadas: totalCabecasHistorico || totalMovimentado,
            peso_medio_lotes_kg: pesoMedioHistorico || null,
            consumo_esperado_pv_kg: consumoEsperadoGrupo,
            percentual_consumo_pv_usado: percentualPV > 0 ? percentualPV : null,
            observacoes: `Novo lançamento de consumo aberto automaticamente após movimentação, aproveitando sobra anterior de ${Number(sobra.sobra_kg || 0).toFixed(2)} kg.`,
          });

          if (lotesParaHistoricoSuplementacao.length > 0) {
            await base44.entities.SuplementacaoLote.bulkCreate(lotesParaHistoricoSuplementacao.map((lote) => ({
              empresa_id: empresaSelecionadaId,
              suplementacao_evento_id: novoEventoSuplementacao.id,
              lote_id: lote.id,
              lote_nome: lote.nome,
              categoria: lote.categoria,
              fator_consumo: 1,
              peso_medio_lote_kg: Number(lote.peso_medio_kg || 0) || null,
              consumo_esperado_pv_lote_kg: percentualPV > 0 && Number(lote.peso_medio_kg || 0) > 0
                ? Number(lote.peso_medio_kg || 0) * (percentualPV / 100) * Number(lote.quantidade_cabecas || 0)
                : null,
              data_lancamento: formData.data_movimentacao,
              produto: sobra.produto,
              cabecas_na_area: Number(lote.quantidade_cabecas || 0),
              peso_consumo_lote: Number(lote.quantidade_cabecas || 0),
              percentual_consumo_lote: totalMovimentado > 0 ? Number(lote.quantidade_cabecas || 0) / totalMovimentado : 0,
              dias_periodo: null,
              consumo_unitario_dia: null,
              consumo_por_cabeca_dia_kg: null,
              consumo_total_lote_periodo_kg: null,
            })));
          }
        }
      }

      return movimentacoesCriadas;

    },
    onSuccess: async (movimentacoesCriadas, variables) => {
      toast.success('Gado movido com sucesso!');
      setAreaDestinoPreSelecionada(null);
      setShowMovimentacao(false);
      window.dispatchEvent(new CustomEvent('atualizar-mapa', { detail: { cacheKeys: ['lotes', 'movimentacoes'] } }));
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] });
      queryClient.invalidateQueries({ queryKey: ['mapa-cache', 'lotes'] });

      setMovimentacaoPendente(null);
      setMovimentacoesCriadasIds((movimentacoesCriadas || []).map((item) => item.id).filter(Boolean));

      if (registrarPesagemAposMovimentacao) {
        const lotesNovos = await base44.entities.Lote.filter({ empresa_id: empresaSelecionadaId });
        const categoriasMovidas = variables.mover_todos === 'sim' ?
        [...new Set(lotes.map((l) => (l.categoria || '').toUpperCase()))] :
        [...new Set((variables.movimentacoes || []).filter((m) => Number(m.quantidade) > 0).map((m) => (m.categoria || '').toUpperCase()))];
        const nomesOrigem = new Set(lotes.map((l) => l.nome));
        const lotesDestino = lotesNovos.filter((l) =>
        l.area_atual_id === variables.area_entrada_id &&
        l.status === 'Ativo' && (
        nomesOrigem.has(l.nome) || categoriasMovidas.includes((l.categoria || '').toUpperCase()))
        );
        setLotesAtualizados(lotesDestino.length > 0 ? lotesDestino : lotes);
        setShowPesagem(true);
        return;
      }

      setLotesAtualizados(null);
      setMovimentacoesCriadasIds([]);
      onClose();
    },
    onError: (error) => {
      console.error('❌ Erro:', error);
      setMovimentacaoPendente(null);
      setMovimentacoesCriadasIds([]);
      toast.error('❌ Erro ao mover gado');
    }
  });

  const handleMovimentacao = async (formData) => {
    setMovimentacaoPendente(formData);
    setShowConfirmPesagem(true);
  };

  const handleMorte = async (formData) => {
    const lotesCategoria = lotes.filter((l) => l.categoria === formData.categoria);
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaMorte = areas.find((a) => a.id === areaAtualId);
    let quantidadeRestante = Number(formData.quantidade || 0);

    for (const lote of lotesCategoria) {
      await validarOrdemTemporalLote({
        empresaId: empresaSelecionadaId,
        loteId: lote.id,
        dataReferencia: formData.data_ocorrencia
      });

      const qtdRemover = Math.min(quantidadeRestante, lote.quantidade_cabecas || 0);
      if (qtdRemover <= 0) continue;

      await base44.entities.MovimentacaoMapa.create({
        empresa_id: empresaSelecionadaId,
        data_movimentacao: toNoonUtcISOString(formData.data_ocorrencia),
        tipo: 'Morte',
        lote: lote.nome,
        lote_id: lote.id,
        quantidade_animais: qtdRemover,
        area_origem_id: areaAtualId,
        area_origem_nome: areaMorte?.nome || '',
        observacoes: `Categoria: ${formData.categoria}. Sexo: ${lote.sexo}. Causa: ${formData.causa_morte}. ${formData.observacoes}`
      });

      const novaQtd = Math.max(0, (lote.quantidade_cabecas || 0) - qtdRemover);
      await base44.entities.Lote.update(lote.id, {
        quantidade_cabecas: novaQtd,
        status: novaQtd > 0 ? lote.status : 'Inativo'
      });

      quantidadeRestante -= qtdRemover;
      if (quantidadeRestante <= 0) break;
    }

    toast.success('Morte registrada');
    setShowMorte(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handleNascimento = async (formData) => {
    // Determinar categoria baseada no sexo
    const categoriaFilhote = formData.sexo === "Macho" ?
    "Bezerro 0 a 12 meses" :
    "Bezerra 0 a 12 meses";

    // Buscar lote da categoria correta na mesma área
    const areaAtualId = lotes[0]?.area_atual_id;
    const todosLotes = await base44.entities.Lote.list();
    let loteFilhote = todosLotes.find((l) =>
    l.empresa_id === empresaSelecionadaId &&
    l.categoria === categoriaFilhote &&
    l.area_atual_id === areaAtualId &&
    l.status === 'Ativo'
    );

    if (loteFilhote) {
      // Adicionar ao lote existente
      await base44.entities.Lote.update(loteFilhote.id, {
        quantidade_cabecas: loteFilhote.quantidade_cabecas + formData.quantidade,
        peso_medio_kg: formData.peso_medio ? parseFloat(formData.peso_medio) : loteFilhote.peso_medio_kg
      });
    } else {
      // Criar novo lote
      const areaAtual = areas.find((a) => a.id === areaAtualId);
      loteFilhote = await base44.entities.Lote.create({
        empresa_id: empresaSelecionadaId,
        nome: `${categoriaFilhote.split(' ')[0].toUpperCase()} - ${areaAtual?.nome || 'AREA'}`,
        quantidade_cabecas: formData.quantidade,
        quantidade_entrada: formData.quantidade,
        categoria: categoriaFilhote,
        categoria_entrada: categoriaFilhote,
        sexo: formData.sexo,
        peso_medio_kg: formData.peso_medio ? parseFloat(formData.peso_medio) : null,
        peso_entrada_kg: formData.peso_medio ? parseFloat(formData.peso_medio) : null,
        idade_media_meses: 0,
        area_atual_id: areaAtualId,
        area_atual_nome: areaAtual?.nome || '',
        data_entrada: formData.data_nascimento,
        motivo_entrada: 'Outros',
        motivo_outros: 'Nascimento',
        origem: 'Nascimento',
        status: 'Ativo',
        sistema_produtivo: lotes[0]?.sistema_produtivo
      });
    }

    const areaNascimento = areas.find((a) => a.id === areaAtualId);

    // Registrar movimentação
    await base44.entities.MovimentacaoMapa.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: toNoonUtcISOString(formData.data_nascimento),
      tipo: 'Nascimento',
      lote: loteFilhote.nome,
      lote_id: loteFilhote.id,
      quantidade_animais: formData.quantidade,
      peso_medio: parseFloat(formData.peso_medio) || null,
      area_destino_id: areaAtualId,
      area_destino_nome: areaNascimento?.nome || '',
      observacoes: `Categoria mãe: ${formData.categoria_mae}. Sexo: ${formData.sexo}. Categoria filhote: ${categoriaFilhote}. ${formData.observacoes}`
    });

    toast.success('Nascimento registrado');
    setShowNascimento(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handleAbate = async (formData) => {
    const lotesCategoria = lotes.filter((l) => l.categoria === formData.categoria);
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaAbate = areas.find((a) => a.id === areaAtualId);
    let quantidadeRestante = Number(formData.quantidade || 0);

    for (const lote of lotesCategoria) {
      await validarOrdemTemporalLote({
        empresaId: empresaSelecionadaId,
        loteId: lote.id,
        dataReferencia: formData.data_abate
      });

      const qtdRemover = Math.min(quantidadeRestante, lote.quantidade_cabecas || 0);
      if (qtdRemover <= 0) continue;

      await base44.entities.MovimentacaoMapa.create({
        empresa_id: empresaSelecionadaId,
        data_movimentacao: toNoonUtcISOString(formData.data_abate),
        tipo: 'Abate',
        lote: lote.nome,
        lote_id: lote.id,
        quantidade_animais: qtdRemover,
        area_origem_id: areaAtualId,
        area_origem_nome: areaAbate?.nome || '',
        observacoes: `Categoria: ${formData.categoria}. Sexo: ${lote.sexo}. Peso vivo: ${formData.peso_vivo_total}kg. Peso carcaça: ${formData.peso_carcaca_total}kg. Destino: ${formData.destino}. ${formData.observacoes}`
      });

      const novaQtd = Math.max(0, (lote.quantidade_cabecas || 0) - qtdRemover);
      await base44.entities.Lote.update(lote.id, {
        quantidade_cabecas: novaQtd,
        status: novaQtd > 0 ? lote.status : 'Inativo'
      });

      quantidadeRestante -= qtdRemover;
      if (quantidadeRestante <= 0) break;
    }

    toast.success('Abate registrado');
    setShowAbate(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handleMudancaCategoria = async (formData) => {
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaMudanca = areas.find((a) => a.id === areaAtualId);

    for (const mudanca of formData.mudancas) {
      const lotesCategoria = lotes.filter((l) => l.categoria === mudanca.categoria_atual);
      let quantidadeRestante = mudanca.quantidade;

      for (const lote of lotesCategoria) {
        if (quantidadeRestante <= 0) break;

        await validarOrdemTemporalLote({
          empresaId: empresaSelecionadaId,
          loteId: lote.id,
          dataReferencia: formData.data_mudanca
        });

        const qtdMudar = Math.min(quantidadeRestante, lote.quantidade_cabecas);
        const sexoNovo = mudanca.sexo_novo || lote.sexo;
        const catManejoIdNovo = mudanca.categoria_manejo_id_novo || lote.categoria_manejo_id;
        const catManejoNomeNovo = mudanca.categoria_manejo_nome_novo || lote.categoria_manejo_nome;
        let loteDestinoId = lote.id;
        let modoMudanca = 'total';

        if (qtdMudar === lote.quantidade_cabecas) {
          await base44.entities.Lote.update(lote.id, {
            categoria: mudanca.categoria_nova,
            sexo: sexoNovo,
            categoria_manejo_id: catManejoIdNovo,
            categoria_manejo_nome: catManejoNomeNovo
          });
        } else {
          modoMudanca = 'parcial';
          const loteNovoCategoria = await base44.entities.Lote.create({
            empresa_id: empresaSelecionadaId,
            nome: lote.nome,
            identificador_nome: lote.identificador_nome,
            identificador_sigla: lote.identificador_sigla,
            identificador_cor: lote.identificador_cor,
            quantidade_cabecas: qtdMudar,
            quantidade_entrada: qtdMudar,
            categoria: mudanca.categoria_nova,
            categoria_entrada: lote.categoria_entrada || mudanca.categoria_nova,
            sexo: sexoNovo,
            categoria_manejo_id: catManejoIdNovo,
            categoria_manejo_nome: catManejoNomeNovo,
            categoria_manejo_entrada_id: lote.categoria_manejo_entrada_id || catManejoIdNovo,
            categoria_manejo_entrada_nome: lote.categoria_manejo_entrada_nome || catManejoNomeNovo,
            peso_medio_kg: lote.peso_medio_kg,
            peso_entrada_kg: lote.peso_entrada_kg || lote.peso_medio_kg,
            idade_media_meses: lote.idade_media_meses,
            area_atual_id: areaAtualId,
            area_atual_nome: areaMudanca?.nome || '',
            raca_predominante: lote.raca_predominante,
            sistema_produtivo: lote.sistema_produtivo,
            data_entrada: formData.data_mudanca,
            motivo_entrada: 'Outros',
            motivo_outros: 'Mudança de Categoria',
            origem: 'Mudança de Categoria',
            status: 'Ativo'
          });
          loteDestinoId = loteNovoCategoria.id;

          await base44.entities.Lote.update(lote.id, {
            quantidade_cabecas: lote.quantidade_cabecas - qtdMudar
          });
        }

        const snapshotMudanca = {
          modo: modoMudanca,
          origem_lote_id: lote.id,
          destino_lote_id: loteDestinoId,
          categoria_anterior: mudanca.categoria_atual,
          categoria_nova: mudanca.categoria_nova
        };

        await base44.entities.MovimentacaoMapa.create({
          empresa_id: empresaSelecionadaId,
          data_movimentacao: toNoonUtcISOString(formData.data_mudanca),
          tipo: 'Mudança de Categoria',
          lote: lote.nome,
          lote_id: lote.id,
          quantidade_animais: qtdMudar,
          area_origem_id: areaAtualId,
          area_origem_nome: areaMudanca?.nome || '',
          observacoes: `[MUDANCA_CATEGORIA]${JSON.stringify(snapshotMudanca)}\nDe ${mudanca.categoria_atual} para ${mudanca.categoria_nova}. Sexo: ${lote.sexo}. ${formData.observacoes}`
        });

        quantidadeRestante -= qtdMudar;
      }
    }

    toast.success('Categorias atualizadas');
    setShowMudancaCategoria(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handlePesagem = async (formData) => {
    const lotesParaPesar = lotesAtualizados || lotes;
    const areaAtualId = lotesParaPesar[0]?.area_atual_id;
    const areaPesagem = areas.find((a) => a.id === areaAtualId);

    // Se há pesos individuais por lote, usar esses; senão usar por categoria
    const pesosIndividuais = formData.pesos_por_lote || {};

    for (const categoria of formData.categorias_selecionadas) {
      const lotesCategoria = lotesParaPesar.filter((l) => l.categoria === categoria);
      const pesoPadrao = parseFloat(formData.pesos_por_categoria[categoria]);

      for (const lote of lotesCategoria) {
        await validarOrdemTemporalLote({
          empresaId: empresaSelecionadaId,
          loteId: lote.id,
          dataReferencia: formData.data_pesagem
        });

        // Verificar se tem peso individual para este lote específico
        const pesoNovo = pesosIndividuais[lote.id] ? parseFloat(pesosIndividuais[lote.id]) : pesoPadrao;
        if (!pesoNovo || pesoNovo <= 0) continue;

        const pesoAnterior = lote.peso_medio_kg || 0;
        const ganho = pesoNovo - pesoAnterior;

        await base44.entities.MovimentacaoMapa.create({
          empresa_id: empresaSelecionadaId,
          data_movimentacao: toNoonUtcISOString(formData.data_pesagem),
          tipo: 'Pesagem',
          lote: lote.nome,
          lote_id: lote.id,
          quantidade_animais: lote.quantidade_cabecas,
          peso_medio: pesoNovo,
          area_origem_id: areaAtualId,
          area_origem_nome: areaPesagem?.nome || '',
          observacoes: `Categoria: ${categoria}. Sexo: ${lote.sexo}. Peso anterior: ${pesoAnterior}kg. Ganho: ${ganho.toFixed(1)}kg. ${formData.observacoes}`
        });

        await base44.entities.Lote.update(lote.id, {
          peso_medio_kg: pesoNovo
        });
      }
    }

    toast.success('Pesagens registradas');
    setShowPesagem(false);
    setMovimentacoesCriadasIds([]);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  if (loadingInicial) {
    return (
      <div className="space-y-2" translate="no">
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full" />
          <span className="text-xs font-medium text-slate-700">Carregando detalhes do lote...</span>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-2" translate="no">
      <InformacoesArea area={areaAtual} lotesNaArea={todosLotesNaArea} tituloLotes={tituloLotes} />

      <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-1">
        {categorias.map((categoria) => {
            const lotesCategoria = lotesPorCategoria[categoria];
            const configIcone = iconesConfig.find((ic) =>
            ic.tipo_entidade === 'Lote' &&
            ic.categoria?.toUpperCase() === categoria?.toUpperCase()
            );
            const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

            return lotesCategoria.map((lote) => {
              const cab = lote.quantidade_cabecas || 0;
              const peso = lote.peso_medio_kg || 0;
              const hoje = new Date();hoje.setHours(0, 0, 0, 0);
              const entrada = lote.data_entrada ? new Date(lote.data_entrada) : null;
              let diasPastejo = 0;
              if (entrada) {entrada.setHours(0, 0, 0, 0);diasPastejo = Math.max(0, Math.floor((hoje - entrada) / 86400000));}

              return (
                <div key={lote.id} className="bg-slate-50 text-[11px] px-1 py-1 rounded-lg border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="bg-yellow-400 text-slate-950 px-2.5 py-0.5 text-xs font-semibold rounded-md inline-flex items-center border border-yellow-300">
                    Lote: {lote.nome}
                  </Badge>
                  {iconeUrl &&
                    <img src={iconeUrl} alt={categoria} className="w-10 h-10 object-contain flex-shrink-0" />
                    }
                </div>
                {(lote.alertas || []).length > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 space-y-1">
                    <div className="flex items-center gap-1 text-[10px] font-bold text-red-700 uppercase">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Alertas do lote
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(lote.alertas || []).map((alerta, index) => (
                        <Badge key={`${lote.id}_alerta_${index}`} variant="outline" className="border-red-300 bg-white text-red-700 text-[10px]">
                          {alerta.titulo || alerta.tipo}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-[10px]">
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Identificador</div>
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      {lote.identificador_cor && <span className="inline-block w-3 h-3 rounded-full border border-slate-300" style={{ backgroundColor: lote.identificador_cor }} />}
                      <span>{(lote.identificador_nome || '-').toUpperCase()}</span>
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Sigla</div>
                    <div className="font-semibold text-slate-900">{(lote.identificador_sigla || '-').toUpperCase()}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Qtd. Cabeças</div>
                    <div className="font-semibold text-slate-900">{cab.toLocaleString('pt-BR')}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Peso Médio</div>
                    <div className="font-semibold text-slate-900">{peso > 0 ? `${peso.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg` : '-'}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Dias de pastejo</div>
                    <div className="font-semibold text-slate-900">{diasPastejo.toLocaleString('pt-BR')} dia(s)</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Sist. Rep.</div>
                    <div className="font-semibold text-slate-900">{(lote.sistema_produtivo || '-').toUpperCase()}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Raça Predominante</div>
                    <div className="font-semibold text-slate-900">{(lote.raca_predominante || '-').toUpperCase()}</div>
                  </div>
                  <div className="rounded border border-slate-200 bg-white px-1.5 py-1">
                    <div className="text-slate-500">Sexo</div>
                    <div className="font-semibold text-slate-900">{(lote.sexo || '-').toUpperCase()}</div>
                  </div>
                </div>
                <div className="space-y-0.5 text-[10px]">
                  <div className="text-slate-500">Categoria de Manejo: <span className="font-semibold text-slate-700">{(lote.categoria_manejo_nome || '-').toUpperCase()}</span></div>
                  <div className="text-slate-500">Categoria Oficial: <span className="font-semibold text-slate-700">{(lote.categoria || '-').toUpperCase()}</span></div>
                </div>
              </div>);

            });
          })}
      </div>

      <ResumoSuplementacao lotesIds={lotes.map((l) => l.id)} modo="completo" areaId={lotes[0]?.area_atual_id || ""} />

      <div className="my-1 grid grid-cols-2 md:grid-cols-2 gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Eventos
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {permissions.registrar_abate !== false && <DropdownMenuItem onClick={() => setShowAbate(true)} className="text-xs">Abate</DropdownMenuItem>}
            {permissions.juntar_lotes !== false && lotes.length > 1 && (() => {
              const porCategoria = {};
              lotes.forEach((l) => {
                const cat = (l.categoria || '').toUpperCase();
                if (!porCategoria[cat]) porCategoria[cat] = [];
                porCategoria[cat].push(l);
              });
              const categoriasJuntaveis = Object.entries(porCategoria).filter(([, ls]) => ls.length > 1);
              const temJuntavel = categoriasJuntaveis.length > 0;
              if (!temJuntavel) return null;
              return (
                <DropdownMenuItem
                  onClick={() => {
                    if (categoriasJuntaveis.length === 1) {
                      setCategoriaSelecionadaJuncao(categoriasJuntaveis[0][0]);
                      setLotePrincipalJuncao(null);
                    } else {
                      setCategoriaSelecionadaJuncao(null);
                      setLotePrincipalJuncao(null);
                    }
                    setShowJuntarLotes(true);
                  }}
                  className="text-xs"
                >
                  Juntar Lotes
                </DropdownMenuItem>
              );
            })()}
            {permissions.mover_lotes !== false && <DropdownMenuItem onClick={() => setShowMovimentacao(true)} className="text-xs">Mover</DropdownMenuItem>}
            {permissions.mudar_categoria_lotes !== false && <DropdownMenuItem onClick={() => setShowMudancaCategoria(true)} className="text-xs">Mudar Categoria</DropdownMenuItem>}
            {permissions.registrar_nascimento !== false && <DropdownMenuItem onClick={() => setShowNascimento(true)} className="text-xs">Nascimento</DropdownMenuItem>}
            {permissions.registrar_morte !== false && <DropdownMenuItem onClick={() => setShowMorte(true)} className="text-xs">Morte</DropdownMenuItem>}
            {permissions.pesar_lotes !== false && <DropdownMenuItem onClick={() => setShowPesagem(true)} className="text-xs">Pesar</DropdownMenuItem>}
            {permissions.renomear_lotes !== false && <DropdownMenuItem onClick={() => {
              if (lotes.length === 1) {
                setLoteParaRenomear(lotes[0]);
                setNovoNomeLote(lotes[0].nome);
                setShowRenomear(true);
              } else {
                setLoteParaRenomear(null);
                setShowRenomear(true);
              }
            }} className="text-xs">Renomear Lote</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Históricos
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {permissions.visualizar_historico_movimentacoes_lote !== false && <DropdownMenuItem onClick={() => setShowHistorico(true)} className="text-xs">Histórico de Movimentação</DropdownMenuItem>}
            {permissions.visualizar_historico_suplementacao_lote !== false && <DropdownMenuItem onClick={() => setShowHistoricoSupl(true)} className="text-xs">Histórico de Suplementação</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Dialog Juntar Lotes */}
      <Dialog open={showJuntarLotes} onOpenChange={(open) => {setShowJuntarLotes(open);if (!open) {setCategoriaSelecionadaJuncao(null);setLotePrincipalJuncao(null);}}}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Juntar Lotes</DialogTitle></DialogHeader>
          {(() => {
              const porCategoria = {};
              lotes.forEach((l) => {
                const cat = (l.categoria || '').toUpperCase();
                if (!porCategoria[cat]) porCategoria[cat] = [];
                porCategoria[cat].push(l);
              });
              const categoriasJuntaveis = Object.entries(porCategoria).filter(([, ls]) => ls.length > 1);

              if (!categoriaSelecionadaJuncao && categoriasJuntaveis.length > 1) {
                return (
                  <div className="space-y-2">
                  <p className="text-xs text-slate-600">Selecione a categoria para juntar:</p>
                  {categoriasJuntaveis.map(([cat, ls]) =>
                    <Button key={cat} variant="outline" className="w-full h-9 text-xs justify-start" onClick={() => {setCategoriaSelecionadaJuncao(cat);setLotePrincipalJuncao(null);}}>
                      {cat} ({ls.length} lotes, {ls.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0)} cab)
                    </Button>
                    )}
                </div>);

              }

              const catSel = categoriaSelecionadaJuncao || categoriasJuntaveis[0] && categoriasJuntaveis[0][0];
              const lotesParaJuntar = porCategoria[catSel] || [];

              if (!lotePrincipalJuncao && lotesParaJuntar.length > 0) {
                return (
                  <div className="space-y-2">
                  <p className="text-xs text-slate-600">Selecione o lote que receberá os animais (lote principal):</p>
                  <p className="text-[10px] text-slate-500">Categoria: <strong>{catSel}</strong></p>
                  {lotesParaJuntar.map((l) =>
                    <Button key={l.id} variant="outline" className="w-full h-9 text-xs justify-between" onClick={() => setLotePrincipalJuncao(l)}>
                      <span>{l.nome}</span>
                      <span className="text-slate-500">{l.quantidade_cabecas} cab</span>
                    </Button>
                    )}
                </div>);

              }

              if (lotePrincipalJuncao && lotesParaJuntar.length > 0) {
                const outrosLotes = lotesParaJuntar.filter((l) => l.id !== lotePrincipalJuncao.id);
                const totalCab = lotesParaJuntar.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
                return (
                  <div className="space-y-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-emerald-800">Lote principal: {lotePrincipalJuncao.nome}</p>
                    <p className="text-[10px] text-emerald-700">{lotePrincipalJuncao.quantidade_cabecas} cab → {totalCab} cab após junção</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-600">Lotes que serão absorvidos:</p>
                    {outrosLotes.map((l) =>
                      <div key={l.id} className="flex justify-between text-xs p-2 bg-slate-50 rounded border">
                        <span>{l.nome}</span>
                        <span className="text-slate-500">{l.quantidade_cabecas} cab</span>
                      </div>
                      )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs uppercase">Data</Label>
                    <Input type="date" value={dataJuncao} onChange={(e) => setDataJuncao(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setLotePrincipalJuncao(null)}>Voltar</Button>
                    <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                        await validarOrdemTemporalLotes({
                          empresaId: empresaSelecionadaId,
                          lotes: lotesParaJuntar,
                          dataReferencia: dataJuncao
                        });

                        const principal = lotePrincipalJuncao;
                        const pesoTotal = lotesParaJuntar.reduce((s, l) => s + (l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0), 0);
                        const pesoMedio = totalCab > 0 ? pesoTotal / totalCab : 0;
                        const snapshotLotes = lotesParaJuntar.map((l) => ({
                          id: l.id, nome: l.nome, quantidade_cabecas: l.quantidade_cabecas || 0,
                          peso_medio_kg: l.peso_medio_kg || 0, status: l.status || 'Ativo',
                          categoria: l.categoria || '', categoria_manejo_id: l.categoria_manejo_id || '',
                          categoria_manejo_nome: l.categoria_manejo_nome || '',
                          area_atual_id: l.area_atual_id || '', area_atual_nome: l.area_atual_nome || ''
                        }));
                        const nomesLotes = lotesParaJuntar.map((l) => l.nome).join(', ');
                        for (const l of outrosLotes) {
                          await base44.entities.Lote.update(l.id, { status: 'Inativo', quantidade_cabecas: 0 });
                        }
                        await base44.entities.Lote.update(principal.id, {
                          quantidade_cabecas: totalCab,
                          peso_medio_kg: pesoMedio > 0 ? Math.round(pesoMedio * 10) / 10 : principal.peso_medio_kg
                        });
                        const areaAtualId = principal.area_atual_id;
                        const areaJuncao = areas.find((a) => a.id === areaAtualId);
                        await base44.entities.MovimentacaoMapa.create({
                          empresa_id: empresaSelecionadaId,
                          data_movimentacao: toNoonUtcISOString(dataJuncao),
                          tipo: 'Entrada', motivo: 'Junção de Lotes',
                          lote: principal.nome, lote_id: principal.id,
                          quantidade_animais: totalCab,
                          area_origem_id: areaAtualId, area_origem_nome: areaJuncao?.nome || '',
                          observacoes: `[JUNCAO_LOTES]${JSON.stringify(snapshotLotes)}\nJunção de Lotes: ${nomesLotes} → ${principal.nome}. Total: ${totalCab} cabeças.`
                        });
                        toast.success(`Lotes unificados! ${totalCab} cabeças no lote "${principal.nome}"`);
                        setShowJuntarLotes(false);
                        onClose();
                        window.dispatchEvent(new CustomEvent('atualizar-mapa'));
                      }}>
                      Confirmar Junção
                    </Button>
                  </div>
                </div>);

              }
              return null;
            })()}
        </DialogContent>
      </Dialog>

      <Dialog open={showMovimentacao} onOpenChange={(open) => {
          setShowMovimentacao(open);
          if (!open) setAreaDestinoPreSelecionada(null);
        }}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Movimentação de Lotes</DialogTitle>
          </DialogHeader>
          <FormularioMovimentacaoLote
              lotesOriginais={lotes}
              areaOrigem={areaAtual}
              areaDestinoPreSelecionada={areaDestinoPreSelecionada}
              onSubmit={handleMovimentacao}
              onCancel={() => {
                setAreaDestinoPreSelecionada(null);
                setShowMovimentacao(false);
              }} />
            
        </DialogContent>
      </Dialog>

      <Dialog open={showMorte} onOpenChange={setShowMorte}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Morte</DialogTitle></DialogHeader>
          {showMorte &&
            <FormularioMorte
              lote={lotes}
              onSubmit={handleMorte}
              onCancel={() => setShowMorte(false)} />

            }
        </DialogContent>
      </Dialog>

      <Dialog open={showNascimento} onOpenChange={setShowNascimento}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Nascimento</DialogTitle></DialogHeader>
          {showNascimento &&
            <FormularioNascimento
              lote={lotes}
              onSubmit={handleNascimento}
              onCancel={() => setShowNascimento(false)} />

            }
        </DialogContent>
      </Dialog>

      <Dialog open={showAbate} onOpenChange={setShowAbate}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Abate</DialogTitle></DialogHeader>
          {showAbate &&
            <FormularioAbate
              lote={lotes}
              onSubmit={handleAbate}
              onCancel={() => setShowAbate(false)} />

            }
        </DialogContent>
      </Dialog>

      <Dialog open={showMudancaCategoria} onOpenChange={setShowMudancaCategoria}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Mudança de Categoria</DialogTitle></DialogHeader>
          <FormularioMudancaCategoria
              lote={lotes}
              onSubmit={handleMudancaCategoria}
              onCancel={() => setShowMudancaCategoria(false)} />
            
        </DialogContent>
      </Dialog>

      <Dialog open={showPesagem} onOpenChange={(open) => {setShowPesagem(open);if (!open) {setLotesAtualizados(null);setMovimentacoesCriadasIds([]);}}}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Pesagem</DialogTitle></DialogHeader>
          {showPesagem &&
            <FormularioPesagem
              lote={lotesAtualizados || lotes}
              onSubmit={handlePesagem}
              onCancel={() => {setShowPesagem(false);setLotesAtualizados(null);setMovimentacoesCriadasIds([]);}} />

            }
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="bg-background px-2 py-2 fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-4 border shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg max-w-4xl max-h-[90vh] overflow-y-auto">
          <HistoricoMovimentacoes lotes={lotes} areaId={areaAtual?.id} />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistoricoSupl} onOpenChange={setShowHistoricoSupl}>
        <DialogContent className="max-w-[880px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Histórico de Suplementação</DialogTitle></DialogHeader>
          {lotes.length === 1 ?
            <HistoricoSuplementacaoLote
              loteId={lotes[0].id}
              loteNome={lotes[0].nome} /> :


            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">Histórico de Suplementação</h3>
              {lotes.map((lote) =>
              <div key={lote.id} className="border-t pt-4">
                  <HistoricoSuplementacaoLote
                  loteId={lote.id}
                  loteNome={lote.nome} />
                
                </div>
              )}
            </div>
            }
        </DialogContent>
      </Dialog>

      {/* Dialog Renomear Lote */}
      <Dialog open={showRenomear} onOpenChange={setShowRenomear}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Renomear Lote</DialogTitle></DialogHeader>
          {!loteParaRenomear && lotes.length > 1 ?
            <div className="space-y-2">
              <p className="text-xs text-slate-600">Selecione o lote para renomear:</p>
              {lotes.map((l) =>
              <Button key={l.id} variant="outline" className="w-full h-9 text-xs justify-start" onClick={() => {
                setLoteParaRenomear(l);
                setNovoNomeLote(l.nome);
              }}>
                  {l.nome} ({l.quantidade_cabecas} cab - {l.categoria})
                </Button>
              )}
            </div> :
            loteParaRenomear ?
            <RenomearLoteForm
              lote={loteParaRenomear}
              novoNome={novoNomeLote}
              onNovoNomeChange={setNovoNomeLote}
              empresaSelecionadaId={empresaSelecionadaId}
              areas={areas}
              onClose={() => {
                setShowRenomear(false);
                onClose();
                window.dispatchEvent(new CustomEvent('atualizar-mapa'));
              }}
              onCancel={() => setShowRenomear(false)} /> :

            null}
        </DialogContent>
      </Dialog>

      {/* Dialog confirmar pesagem antes da movimentação */}
      <Dialog open={showConfirmPesagem} onOpenChange={setShowConfirmPesagem}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Abrir pesagem depois da movimentação?</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-600">Depois de confirmar a movimentação, deseja abrir a pesagem dos lotes movimentados?</p>
          <div className="flex justify-end gap-2 mt-2">
            <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={!movimentacaoPendente || movimentacaoMutation.isPending}
                onClick={() => {
                  setRegistrarPesagemAposMovimentacao(false);
                  setShowConfirmPesagem(false);
                  movimentacaoMutation.mutate(movimentacaoPendente);
                }}>
                
              Não
            </Button>
            <Button
                size="sm"
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                disabled={!movimentacaoPendente || movimentacaoMutation.isPending}
                onClick={() => {
                  setRegistrarPesagemAposMovimentacao(true);
                  setShowConfirmPesagem(false);
                  movimentacaoMutation.mutate(movimentacaoPendente);
                }}>
                
              Sim, Pesar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>

    <Dialog open={progresso.show} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Processando...</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-xs text-slate-600">{progresso.mensagem}</p>
          <Progress value={progresso.atual / progresso.total * 100} className="w-full h-1.5" />
        </div>
      </DialogContent>
    </Dialog>
    </>);

}
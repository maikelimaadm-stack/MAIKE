import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, ArrowRightLeft, Scale, RefreshCw, Star, XCircle, Package, Pencil, Merge } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import ResumoSuplementacao from "../suplementacao/ResumoSuplementacao";
import { Progress } from "@/components/ui/progress";

export default function DetalhesLote({ lotes, onClose }) {
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
  const queryClient = useQueryClient();

  // Listener para abrir movimentação via drag-and-drop
  React.useEffect(() => {
    const handleOpenMovimentacao = (e) => {
      setShowMovimentacao(true);
    };

    window.addEventListener('open-movimentacao', handleOpenMovimentacao);
    return () => {
      window.removeEventListener('open-movimentacao', handleOpenMovimentacao);
      delete window.areaDestinoArrastada;
    };
  }, []);

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones-global'],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.ativo !== false);
    },
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
  const tituloLotes = lotes.map(l => l.nome).join(' - ');

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const areaAtual = areas.find(a => a.id === lotes[0]?.area_atual_id);

  const movimentacaoMutation = useMutation({
    mutationFn: async (formData) => {
      console.log('🔄 INICIANDO MOVIMENTAÇÃO');
      const areaSaida = areas.find(a => a.id === formData.area_saida_id);
      const areaEntrada = areas.find(a => a.id === formData.area_entrada_id);
      const movimentacoesCriadas = [];
      
      // Movimentação - os eventos já foram fechados no FormularioMovimentacaoLote
      if (formData.mover_todos === 'sim') {
        for (const lote of lotes) {
          await base44.entities.Lote.update(lote.id, {
            area_atual_id: formData.area_entrada_id,
            area_atual_nome: areaEntrada?.nome || ''
          });

          const movimentacaoCriada = await base44.entities.MovimentacaoMapa.create({
            empresa_id: empresaSelecionadaId,
            data_movimentacao: new Date(formData.data_movimentacao).toISOString(),
            tipo: 'Transferência de Área',
            lote: lote.nome,
            lote_id: lote.id,
            quantidade_animais: lote.quantidade_cabecas,
            area_origem_id: formData.area_saida_id,
            area_origem_nome: areaSaida?.nome || '',
            area_destino_id: formData.area_entrada_id,
            area_destino_nome: areaEntrada?.nome || '',
            observacoes: `Movimentação completa do lote - ${lote.quantidade_cabecas} cabeças`
          });
          movimentacoesCriadas.push(movimentacaoCriada);
        }
      } else {
        for (const mov of formData.movimentacoes) {
          if (mov.quantidade <= 0) continue;

          const lotesCategoria = lotes.filter(l => l.categoria?.toUpperCase() === mov.categoria);
          let quantidadeRestante = mov.quantidade;
          
          // Verificar se deve unir ao lote existente na área destino
          const deveUnir = formData.unir_lotes[mov.categoria] === 'sim';
          
          for (const lote of lotesCategoria) {
            if (quantidadeRestante <= 0) break;
            
            const quantidadeMover = Math.min(quantidadeRestante, lote.quantidade_cabecas);
            
            if (quantidadeMover === lote.quantidade_cabecas) {
              if (deveUnir) {
                // Unir ao lote existente na área destino
                const lotesDestino = await base44.entities.Lote.list();
                const loteExistente = lotesDestino.find(l => 
                  l.empresa_id === empresaSelecionadaId && 
                  l.area_atual_id === formData.area_entrada_id && 
                  l.categoria?.toUpperCase() === mov.categoria &&
                  l.status === 'Ativo'
                );
                if (loteExistente) {
                  await base44.entities.Lote.update(loteExistente.id, {
                    quantidade_cabecas: (loteExistente.quantidade_cabecas || 0) + quantidadeMover
                  });
                  // Inativar lote original
                  await base44.entities.Lote.update(lote.id, { status: 'Inativo', quantidade_cabecas: 0 });
                } else {
                  // Fallback: mover o lote inteiro
                  await base44.entities.Lote.update(lote.id, {
                    area_atual_id: formData.area_entrada_id,
                    area_atual_nome: areaEntrada?.nome || ''
                  });
                }
              } else {
                await base44.entities.Lote.update(lote.id, {
                  area_atual_id: formData.area_entrada_id,
                  area_atual_nome: areaEntrada?.nome || ''
                });
              }
            } else {
              // Movimentação parcial
              if (deveUnir) {
                const lotesDestino = await base44.entities.Lote.list();
                const loteExistente = lotesDestino.find(l => 
                  l.empresa_id === empresaSelecionadaId && 
                  l.area_atual_id === formData.area_entrada_id && 
                  l.categoria?.toUpperCase() === mov.categoria &&
                  l.status === 'Ativo'
                );
                if (loteExistente) {
                  await base44.entities.Lote.update(loteExistente.id, {
                    quantidade_cabecas: (loteExistente.quantidade_cabecas || 0) + quantidadeMover
                  });
                } else {
                  await base44.entities.Lote.create({
                    empresa_id: empresaSelecionadaId,
                    nome: lote.nome,
                    quantidade_cabecas: quantidadeMover,
                    categoria: lote.categoria,
                    sexo: lote.sexo,
                    peso_medio_kg: lote.peso_medio_kg,
                    idade_media_meses: lote.idade_media_meses,
                    area_atual_id: formData.area_entrada_id,
                    area_atual_nome: areaEntrada?.nome || '',
                    raca_predominante: lote.raca_predominante,
                    sistema_produtivo: lote.sistema_produtivo,
                    data_entrada: formData.data_movimentacao,
                    origem: 'MOVIMENTAÇÃO',
                    status: 'Ativo'
                  });
                }
              } else {
                await base44.entities.Lote.create({
                  empresa_id: empresaSelecionadaId,
                  nome: lote.nome,
                  quantidade_cabecas: quantidadeMover,
                  categoria: lote.categoria,
                  sexo: lote.sexo,
                  peso_medio_kg: lote.peso_medio_kg,
                  idade_media_meses: lote.idade_media_meses,
                  area_atual_id: formData.area_entrada_id,
                  area_atual_nome: areaEntrada?.nome || '',
                  raca_predominante: lote.raca_predominante,
                  sistema_produtivo: lote.sistema_produtivo,
                  data_entrada: formData.data_movimentacao,
                  origem: 'MOVIMENTAÇÃO',
                  status: 'Ativo'
                });
              }

              await base44.entities.Lote.update(lote.id, {
                quantidade_cabecas: lote.quantidade_cabecas - quantidadeMover
              });
            }

            const movimentacaoCriada = await base44.entities.MovimentacaoMapa.create({
              empresa_id: empresaSelecionadaId,
              data_movimentacao: new Date(formData.data_movimentacao).toISOString(),
              tipo: 'Transferência de Área',
              lote: lote.nome,
              lote_id: lote.id,
              quantidade_animais: quantidadeMover,
              area_origem_id: formData.area_saida_id,
              area_origem_nome: areaSaida?.nome || '',
              area_destino_id: formData.area_entrada_id,
              area_destino_nome: areaEntrada?.nome || '',
              observacoes: `Movimentação parcial - ${quantidadeMover} cabeças de ${mov.categoria}`
            });
            movimentacoesCriadas.push(movimentacaoCriada);

            quantidadeRestante -= quantidadeMover;
          }
        }
      }

      return movimentacoesCriadas;
      
      },
      onSuccess: async (movimentacoesCriadas, variables) => {
        toast.success('Gado movido com sucesso!');
        setShowMovimentacao(false);
        window.dispatchEvent(new CustomEvent('atualizar-mapa'));
        queryClient.invalidateQueries({ queryKey: ['lotes'] });
        queryClient.invalidateQueries({ queryKey: ['mapa-lotes'] });

        const lotesNovos = await base44.entities.Lote.list();
        const categoriasMovidas = variables.mover_todos === 'sim'
          ? [...new Set(lotes.map(l => (l.categoria || '').toUpperCase()))]
          : [...new Set((variables.movimentacoes || []).filter(m => Number(m.quantidade) > 0).map(m => (m.categoria || '').toUpperCase()))];
        const nomesOrigem = new Set(lotes.map(l => l.nome));
        const lotesDestino = lotesNovos.filter(l =>
          l.empresa_id === empresaSelecionadaId &&
          l.area_atual_id === variables.area_entrada_id &&
          l.status === 'Ativo' &&
          (nomesOrigem.has(l.nome) || categoriasMovidas.includes((l.categoria || '').toUpperCase()))
        );

        setMovimentacaoPendente(null);
        setMovimentacoesCriadasIds((movimentacoesCriadas || []).map(item => item.id).filter(Boolean));

        if (registrarPesagemAposMovimentacao) {
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
    console.log('🔍 DETALHES - Lotes passados para formulário:', lotes);
    console.log('🔍 DETALHES - Categorias nos lotes:', lotes.map(l => l.categoria));

    const lotesCategoria = lotes.filter(l => l.categoria === formData.categoria);
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaMorte = areas.find(a => a.id === areaAtualId);

    for (const lote of lotesCategoria) {
      const qtdRemover = Math.min(formData.quantidade, lote.quantidade_cabecas);

      await base44.entities.MovimentacaoMapa.create({
        empresa_id: empresaSelecionadaId,
        data_movimentacao: new Date(formData.data_ocorrencia).toISOString(),
        tipo: 'Morte',
        lote: lote.nome,
          lote_id: lote.id,
        quantidade_animais: qtdRemover,
        area_origem_id: areaAtualId,
        area_origem_nome: areaMorte?.nome || '',
        observacoes: `Categoria: ${formData.categoria}. Sexo: ${lote.sexo}. Causa: ${formData.causa_morte}. ${formData.observacoes}`
      });

      await base44.entities.Lote.update(lote.id, {
        quantidade_cabecas: lote.quantidade_cabecas - qtdRemover
      });

      formData.quantidade -= qtdRemover;
      if (formData.quantidade <= 0) break;
    }

    toast.success('Morte registrada');
    setShowMorte(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handleNascimento = async (formData) => {
    // Determinar categoria baseada no sexo
    const categoriaFilhote = formData.sexo === "Macho" 
      ? "Bezerro 0 a 12 meses" 
      : "Bezerra 0 a 12 meses";

    // Buscar lote da categoria correta na mesma área
    const areaAtualId = lotes[0]?.area_atual_id;
    const todosLotes = await base44.entities.Lote.list();
    let loteFilhote = todosLotes.find(l => 
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
      const areaAtual = areas.find(a => a.id === areaAtualId);
      loteFilhote = await base44.entities.Lote.create({
        empresa_id: empresaSelecionadaId,
        nome: `${categoriaFilhote.split(' ')[0].toUpperCase()} - ${areaAtual?.nome || 'AREA'}`,
        quantidade_cabecas: formData.quantidade,
        categoria: categoriaFilhote,
        sexo: formData.sexo,
        peso_medio_kg: formData.peso_medio ? parseFloat(formData.peso_medio) : null,
        idade_media_meses: 0,
        area_atual_id: areaAtualId,
        area_atual_nome: areaAtual?.nome || '',
        data_entrada: formData.data_nascimento,
        origem: 'Nascimento',
        status: 'Ativo',
        sistema_produtivo: lotes[0]?.sistema_produtivo
      });
    }

    const areaNascimento = areas.find(a => a.id === areaAtualId);

    // Registrar movimentação
    await base44.entities.MovimentacaoMapa.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date(formData.data_nascimento).toISOString(),
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
    const lotesCategoria = lotes.filter(l => l.categoria === formData.categoria);
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaAbate = areas.find(a => a.id === areaAtualId);

    for (const lote of lotesCategoria) {
      const qtdRemover = Math.min(formData.quantidade, lote.quantidade_cabecas);

      await base44.entities.MovimentacaoMapa.create({
        empresa_id: empresaSelecionadaId,
        data_movimentacao: new Date(formData.data_abate).toISOString(),
        tipo: 'Abate',
        lote: lote.nome,
          lote_id: lote.id,
        quantidade_animais: qtdRemover,
        area_origem_id: areaAtualId,
        area_origem_nome: areaAbate?.nome || '',
        observacoes: `Categoria: ${formData.categoria}. Sexo: ${lote.sexo}. Peso vivo: ${formData.peso_vivo_total}kg. Peso carcaça: ${formData.peso_carcaca_total}kg. Destino: ${formData.destino}. ${formData.observacoes}`
      });

      await base44.entities.Lote.update(lote.id, {
        quantidade_cabecas: lote.quantidade_cabecas - qtdRemover
      });

      formData.quantidade -= qtdRemover;
      if (formData.quantidade <= 0) break;
    }

    toast.success('Abate registrado');
    setShowAbate(false);
    onClose();
    window.dispatchEvent(new CustomEvent('atualizar-mapa'));
  };

  const handleMudancaCategoria = async (formData) => {
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaMudanca = areas.find(a => a.id === areaAtualId);

    for (const mudanca of formData.mudancas) {
      const lotesCategoria = lotes.filter(l => l.categoria === mudanca.categoria_atual);
      let quantidadeRestante = mudanca.quantidade;

      for (const lote of lotesCategoria) {
        if (quantidadeRestante <= 0) break;

        const qtdMudar = Math.min(quantidadeRestante, lote.quantidade_cabecas);

        await base44.entities.MovimentacaoMapa.create({
          empresa_id: empresaSelecionadaId,
          data_movimentacao: new Date(formData.data_mudanca).toISOString(),
          tipo: 'Mudança de Categoria',
          lote: lote.nome,
          lote_id: lote.id,
          quantidade_animais: qtdMudar,
          area_origem_id: areaAtualId,
          area_origem_nome: areaMudanca?.nome || '',
          observacoes: `De ${mudanca.categoria_atual} para ${mudanca.categoria_nova}. Sexo: ${lote.sexo}. ${formData.observacoes}`
        });

        if (qtdMudar === lote.quantidade_cabecas) {
          // Mudar categoria do lote todo
          await base44.entities.Lote.update(lote.id, {
            categoria: mudanca.categoria_nova
          });
        } else {
          // Mudança parcial - criar novo lote com nova categoria
          await base44.entities.Lote.create({
            empresa_id: empresaSelecionadaId,
            nome: lote.nome,
            quantidade_cabecas: qtdMudar,
            categoria: mudanca.categoria_nova,
            sexo: lote.sexo,
            peso_medio_kg: lote.peso_medio_kg,
            idade_media_meses: lote.idade_media_meses,
            area_atual_id: areaAtualId,
            area_atual_nome: areaMudanca?.nome || '',
            raca_predominante: lote.raca_predominante,
            sistema_produtivo: lote.sistema_produtivo,
            data_entrada: formData.data_mudanca,
            origem: 'Mudança de Categoria',
            status: 'Ativo'
          });

          // Diminuir quantidade do lote original
          await base44.entities.Lote.update(lote.id, {
            quantidade_cabecas: lote.quantidade_cabecas - qtdMudar
          });
        }

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
    const areaPesagem = areas.find(a => a.id === areaAtualId);
    const vinculoPesagem = movimentacoesCriadasIds.length > 0 ? `[PESAGEM_VINCULADA:${movimentacoesCriadasIds.join(',')}] ` : '';

    // Se há pesos individuais por lote, usar esses; senão usar por categoria
    const pesosIndividuais = formData.pesos_por_lote || {};

    for (const categoria of formData.categorias_selecionadas) {
      const lotesCategoria = lotesParaPesar.filter(l => l.categoria === categoria);
      const pesoPadrao = parseFloat(formData.pesos_por_categoria[categoria]);

      for (const lote of lotesCategoria) {
        // Verificar se tem peso individual para este lote específico
        const pesoNovo = pesosIndividuais[lote.id] ? parseFloat(pesosIndividuais[lote.id]) : pesoPadrao;
        if (!pesoNovo || pesoNovo <= 0) continue;

        const pesoAnterior = lote.peso_medio_kg || 0;
        const ganho = pesoNovo - pesoAnterior;

        await base44.entities.MovimentacaoMapa.create({
          empresa_id: empresaSelecionadaId,
          data_movimentacao: new Date(formData.data_pesagem).toISOString(),
          tipo: 'Pesagem',
          lote: lote.nome,
          lote_id: lote.id,
          quantidade_animais: lote.quantidade_cabecas,
          peso_medio: pesoNovo,
          area_origem_id: areaAtualId,
          area_origem_nome: areaPesagem?.nome || '',
          observacoes: `${vinculoPesagem}Categoria: ${categoria}. Sexo: ${lote.sexo}. Peso anterior: ${pesoAnterior}kg. Ganho: ${ganho.toFixed(1)}kg. ${formData.observacoes}`
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

  return (
    <>
    <div className="space-y-4" translate="no">
      <div className="text-sm font-bold text-slate-900 pb-2 border-b">
        {tituloLotes}
      </div>

      <div className="space-y-3 mb-4">
        {categorias.map(categoria => {
          const lotesCategoria = lotesPorCategoria[categoria];
          const totalCabecasCategoria = lotesCategoria.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);
          const pesoMedio = lotesCategoria[0]?.peso_medio_kg || 0;

          const configIcone = iconesConfig.find(ic => 
            ic.tipo_entidade === 'Lote' && 
            ic.categoria?.toUpperCase() === categoria?.toUpperCase()
          );
          const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

          return (
            <div key={categoria} className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-bold text-slate-900 mb-1.5">{categoria}</div>
                    <div className="text-xl font-bold text-slate-900 mb-2">{totalCabecasCategoria} cab</div>
                    <div className="space-y-1.5 text-[10px]">
                      <div className="flex gap-2">
                        <span className="font-medium text-slate-600 whitespace-nowrap">Lotes:</span>
                        <span className="font-semibold text-slate-900 break-words">{lotesCategoria.map(l => l.nome).join(', ')}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="font-medium text-slate-600">Peso:</span>
                        <span className="font-semibold text-slate-900">{pesoMedio ? pesoMedio.toFixed(0) + ' kg' : '-'}</span>
                      </div>
                    </div>
                  </div>
                  {iconeUrl && (
                    <img src={iconeUrl} alt={categoria} className="w-12 h-12 object-contain flex-shrink-0" />
                  )}
                </div>
                <ResumoSuplementacaoCategoria lotesIds={lotesCategoria.map(l => l.id)} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 mb-3">
        <div className="grid grid-cols-4 gap-3 text-[10px]">
          <div>
            <div className="text-slate-600 mb-0.5">Total de cabeças</div>
            <div className="text-sm font-bold text-slate-900">{totalCabecas}</div>
          </div>
          <div>
            <div className="text-slate-600 mb-0.5">Última mov.</div>
            <div className="text-[11px] font-semibold text-slate-900">
              {lotes[0]?.data_entrada ? new Date(lotes[0].data_entrada).toLocaleDateString() : '-'}
            </div>
          </div>
          <div>
            <div className="text-slate-600 mb-0.5">Área atual</div>
            <div className="text-[11px] font-semibold text-slate-900 truncate">{areaAtual?.nome || '-'}</div>
          </div>
          <div>
            <div className="text-slate-600 mb-0.5">Sistema</div>
            <div className="text-[11px] font-semibold text-slate-900">{lotes[0]?.sistema_produtivo || '-'}</div>
          </div>
        </div>
      </div>

      <ResumoSuplementacaoLote lotesIds={lotes.map(l => l.id)} />

      <div className="grid grid-cols-3 gap-2">
        <Button 
          onClick={() => setShowMovimentacao(true)}
          variant="outline"
          className="h-11 text-[10px] font-semibold border-slate-300 hover:bg-slate-50 gap-1 flex-col py-1.5"
          translate="no"
        >
          <ArrowRightLeft className="w-4 h-4 text-slate-600" />
          <span translate="no">Mover</span>
        </Button>

        <Button 
          onClick={() => setShowPesagem(true)}
          variant="outline"
          className="h-11 text-[10px] font-semibold border-slate-300 hover:bg-slate-50 gap-1 flex-col py-1.5"
          translate="no"
        >
          <Scale className="w-4 h-4 text-slate-600" />
          <span translate="no">Pesar</span>
        </Button>

        <Button 
          onClick={() => setShowMudancaCategoria(true)}
          variant="outline"
          className="h-11 text-[10px] font-semibold border-slate-300 hover:bg-slate-50 gap-1 flex-col py-1.5"
          translate="no"
        >
          <RefreshCw className="w-4 h-4 text-slate-600" />
          <span translate="no">Mudar Cat.</span>
        </Button>

        <Button 
          onClick={() => setShowNascimento(true)}
          variant="outline"
          className="h-11 text-[10px] font-semibold border-slate-300 hover:bg-slate-50 gap-1 flex-col py-1.5"
          translate="no"
        >
          <Star className="w-4 h-4 text-slate-600" />
          <span translate="no">Nascer</span>
        </Button>

        <Button 
          onClick={() => setShowMorte(true)}
          variant="outline"
          className="h-11 text-[10px] font-semibold border-slate-300 hover:bg-slate-50 gap-1 flex-col py-1.5"
          translate="no"
        >
          <XCircle className="w-4 h-4 text-slate-600" />
          <span translate="no">Morte</span>
        </Button>

        <Button 
          onClick={() => setShowAbate(true)}
          variant="outline"
          className="h-11 text-[10px] font-semibold border-slate-300 hover:bg-slate-50 gap-1 flex-col py-1.5"
          translate="no"
        >
          <Package className="w-4 h-4 text-slate-600" />
          <span translate="no">Abate</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Button 
          onClick={() => setShowHistorico(true)}
          variant="outline"
          className="h-9 text-[11px] font-semibold border-slate-300"
          translate="no"
        >
          Histórico Movimentações
        </Button>
        <Button 
          onClick={() => setShowHistoricoSupl(true)}
          variant="outline"
          className="h-9 text-[11px] font-semibold border-slate-300"
          translate="no"
        >
          Histórico Suplementação
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <Button 
          onClick={() => {
            if (lotes.length === 1) {
              setLoteParaRenomear(lotes[0]);
              setNovoNomeLote(lotes[0].nome);
              setShowRenomear(true);
            } else {
              // Mostrar lista para escolher qual renomear
              setLoteParaRenomear(null);
              setShowRenomear(true);
            }
          }}
          variant="outline"
          className="h-9 text-[11px] font-semibold border-slate-300 gap-1"
        >
          <Pencil className="w-3.5 h-3.5" />
          Renomear Lote
        </Button>
        {lotes.length > 1 && (() => {
          const categoriasUnicas = [...new Set(lotes.map(l => (l.categoria || '').toUpperCase()))];
          const categoriasManejoUnicas = [...new Set(lotes.map(l => l.categoria_manejo_id || l.categoria_manejo_nome || 'SEM_CATEGORIA_MANEJO'))];
          const mesmaCat = categoriasUnicas.length === 1;
          const mesmaCategoriaManejo = categoriasManejoUnicas.length === 1;
          const podeJuntar = mesmaCat && mesmaCategoriaManejo;
          return (
            <Button 
              onClick={async () => {
                if (!mesmaCat) {
                  alert('Não é possível juntar lotes de categorias diferentes. Selecione apenas lotes da mesma categoria.');
                  return;
                }
                if (!mesmaCategoriaManejo) {
                  alert('Não é possível juntar lotes com categoria de manejo diferente.');
                  return;
                }
                if (!confirm(`Deseja juntar todos os ${lotes.length} lotes desta área em um único lote?`)) return;
                const principal = lotes[0];
                const totalCab = lotes.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
                const pesoTotal = lotes.reduce((s, l) => s + ((l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0)), 0);
                const pesoMedio = totalCab > 0 ? pesoTotal / totalCab : 0;
                const snapshotLotes = lotes.map(l => ({
                  id: l.id,
                  nome: l.nome,
                  quantidade_cabecas: l.quantidade_cabecas || 0,
                  peso_medio_kg: l.peso_medio_kg || 0,
                  status: l.status || 'Ativo',
                  categoria: l.categoria || '',
                  categoria_manejo_id: l.categoria_manejo_id || '',
                  categoria_manejo_nome: l.categoria_manejo_nome || '',
                  area_atual_id: l.area_atual_id || '',
                  area_atual_nome: l.area_atual_nome || ''
                }));
                
                const nomesLotes = lotes.map(l => l.nome).join(', ');
                for (let i = 1; i < lotes.length; i++) {
                  await base44.entities.Lote.update(lotes[i].id, { status: 'Inativo', quantidade_cabecas: 0 });
                }
                await base44.entities.Lote.update(principal.id, { 
                  quantidade_cabecas: totalCab,
                  peso_medio_kg: pesoMedio > 0 ? Math.round(pesoMedio * 10) / 10 : principal.peso_medio_kg
                });

                const areaAtualId = principal.area_atual_id;
                const areaJuncao = areas.find(a => a.id === areaAtualId);
                await base44.entities.MovimentacaoMapa.create({
                  empresa_id: empresaSelecionadaId,
                  data_movimentacao: new Date().toISOString(),
                  tipo: 'Entrada',
                  motivo: 'Junção de Lotes',
                  lote: principal.nome,
                  lote_id: principal.id,
                  quantidade_animais: totalCab,
                  area_origem_id: areaAtualId,
                  area_origem_nome: areaJuncao?.nome || '',
                  observacoes: `[JUNCAO_LOTES]${JSON.stringify(snapshotLotes)}\nJunção de Lotes: ${nomesLotes} → ${principal.nome}. Total: ${totalCab} cabeças.`
                });

                toast.success(`Lotes unificados! ${totalCab} cabeças no lote "${principal.nome}"`);
                onClose();
                window.dispatchEvent(new CustomEvent('atualizar-mapa'));
              }}
              variant="outline"
              className={`h-9 text-[11px] font-semibold border-slate-300 gap-1 ${!podeJuntar ? 'opacity-50' : ''}`}
              disabled={!podeJuntar}
              title={!mesmaCat ? 'Só é possível juntar lotes da mesma categoria' : !mesmaCategoriaManejo ? 'Não é possível juntar lotes com categoria de manejo diferente' : ''}
            >
              <Merge className="w-3.5 h-3.5" />
              Juntar Lotes
            </Button>
          );
        })()}
      </div>

      <Dialog open={showMovimentacao} onOpenChange={setShowMovimentacao}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Movimentação de Lotes</DialogTitle>
          </DialogHeader>
          <FormularioMovimentacaoLote
            lotesOriginais={lotes}
            areaOrigem={areaAtual}
            onSubmit={handleMovimentacao}
            onCancel={() => setShowMovimentacao(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showMorte} onOpenChange={setShowMorte}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Morte</DialogTitle></DialogHeader>
          {showMorte && (
            <FormularioMorte
              lote={lotes}
              onSubmit={handleMorte}
              onCancel={() => setShowMorte(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showNascimento} onOpenChange={setShowNascimento}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Nascimento</DialogTitle></DialogHeader>
          {showNascimento && (
            <FormularioNascimento
              lote={lotes}
              onSubmit={handleNascimento}
              onCancel={() => setShowNascimento(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAbate} onOpenChange={setShowAbate}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Registrar Abate</DialogTitle></DialogHeader>
          {showAbate && (
            <FormularioAbate
              lote={lotes}
              onSubmit={handleAbate}
              onCancel={() => setShowAbate(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showMudancaCategoria} onOpenChange={setShowMudancaCategoria}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Mudança de Categoria</DialogTitle></DialogHeader>
          <FormularioMudancaCategoria
            lote={lotes}
            onSubmit={handleMudancaCategoria}
            onCancel={() => setShowMudancaCategoria(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showPesagem} onOpenChange={(open) => { setShowPesagem(open); if (!open) { setLotesAtualizados(null); setMovimentacoesCriadasIds([]); } }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle>Pesagem</DialogTitle></DialogHeader>
          {showPesagem && (
            <FormularioPesagem
              lote={lotesAtualizados || lotes}
              onSubmit={handlePesagem}
              onCancel={() => { setShowPesagem(false); setLotesAtualizados(null); setMovimentacoesCriadasIds([]); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Histórico de Movimentações</DialogTitle></DialogHeader>
          <HistoricoMovimentacoes lotes={lotes} areaId={areaAtual?.id} />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistoricoSupl} onOpenChange={setShowHistoricoSupl}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Histórico de Suplementação</DialogTitle></DialogHeader>
          {lotes.length === 1 ? (
            <HistoricoSuplementacaoLote
              loteId={lotes[0].id}
              loteNome={lotes[0].nome}
            />
          ) : (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-900">Histórico de Suplementação</h3>
              {lotes.map(lote => (
                <div key={lote.id} className="border-t pt-4">
                  <HistoricoSuplementacaoLote
                    loteId={lote.id}
                    loteNome={lote.nome}
                  />
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog Renomear Lote */}
      <Dialog open={showRenomear} onOpenChange={setShowRenomear}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Renomear Lote</DialogTitle></DialogHeader>
          {!loteParaRenomear && lotes.length > 1 ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-600">Selecione o lote para renomear:</p>
              {lotes.map(l => (
                <Button key={l.id} variant="outline" className="w-full h-9 text-xs justify-start" onClick={() => {
                  setLoteParaRenomear(l);
                  setNovoNomeLote(l.nome);
                }}>
                  {l.nome} ({l.quantidade_cabecas} cab - {l.categoria})
                </Button>
              ))}
            </div>
          ) : loteParaRenomear ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">Lote atual: <strong>{loteParaRenomear.nome}</strong></p>
              <div>
                <Label className="text-xs">Novo nome</Label>
                <Input value={novoNomeLote} onChange={e => setNovoNomeLote(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowRenomear(false)}>Cancelar</Button>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={async () => {
                  if (!novoNomeLote.trim()) return;
                  const nomeAnterior = loteParaRenomear.nome;
                  await base44.entities.Lote.update(loteParaRenomear.id, { nome: novoNomeLote.trim() });
                  
                  // Registrar no histórico
                  const areaAtualId = loteParaRenomear.area_atual_id;
                  const areaRen = areas.find(a => a.id === areaAtualId);
                  await base44.entities.MovimentacaoMapa.create({
                    empresa_id: empresaSelecionadaId,
                    data_movimentacao: new Date().toISOString(),
                    tipo: 'Entrada',
                    motivo: 'Renomear Lote',
                    lote: novoNomeLote.trim(),
                    lote_id: loteParaRenomear.id,
                    quantidade_animais: loteParaRenomear.quantidade_cabecas || 0,
                    area_origem_id: areaAtualId,
                    area_origem_nome: areaRen?.nome || '',
                    observacoes: `Renomear Lote: "${nomeAnterior}" → "${novoNomeLote.trim()}"`
                  });
                  
                  toast.success('Lote renomeado!');
                  setShowRenomear(false);
                  onClose();
                  window.dispatchEvent(new CustomEvent('atualizar-mapa'));
                }}>Salvar</Button>
              </div>
            </div>
          ) : null}
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
              }}
            >
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
              }}
            >
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
          <Progress value={(progresso.atual / progresso.total) * 100} className="w-full h-1.5" />
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
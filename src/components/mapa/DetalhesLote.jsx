import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, ArrowRightLeft, Scale, RefreshCw, Star, XCircle, Package } from "lucide-react";
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

export default function DetalhesLote({ lotes, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showMovimentacao, setShowMovimentacao] = useState(false);
  const [showMorte, setShowMorte] = useState(false);
  const [showNascimento, setShowNascimento] = useState(false);
  const [showAbate, setShowAbate] = useState(false);
  const [showMudancaCategoria, setShowMudancaCategoria] = useState(false);
  const [showPesagem, setShowPesagem] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
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
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
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
      console.log('Iniciando movimentação...', formData);
      const areaSaida = areas.find(a => a.id === formData.area_saida_id);
      
      if (formData.mover_todos === 'sim') {
        // Mover todos os lotes para as áreas de entrada
        for (const areaEntradaId of formData.areas_entrada) {
          const areaEntrada = areas.find(a => a.id === areaEntradaId);
          
          for (const lote of lotes) {
            // Atualizar lote com nova área
            await base44.entities.Lote.update(lote.id, {
              area_atual_id: areaEntradaId,
              area_atual_nome: areaEntrada?.nome || ''
            });

            // Registrar movimentação
            await base44.entities.MovimentacaoPecuaria.create({
              empresa_id: empresaSelecionadaId,
              data_movimentacao: new Date(formData.data_movimentacao).toISOString(),
              tipo: 'Transferência de Área',
              lote: lote.nome,
              quantidade_animais: lote.quantidade_cabecas,
              area_origem_id: formData.area_saida_id,
              area_origem_nome: areaSaida?.nome || '',
              area_destino_id: areaEntradaId,
              area_destino_nome: areaEntrada?.nome || '',
              observacoes: `Movimentação completa do lote - ${lote.quantidade_cabecas} cabeças`
            });
          }
        }
      } else {
        // Movimentação parcial por categoria
        for (const mov of formData.movimentacoes) {
          if (mov.quantidade <= 0) continue;

          const lotesCategoria = lotes.filter(l => l.categoria?.toUpperCase() === mov.categoria);
          
          for (const areaEntradaId of formData.areas_entrada) {
            const areaEntrada = areas.find(a => a.id === areaEntradaId);
            
            // Calcular quantidade proporcional para cada lote
            let quantidadeRestante = mov.quantidade;
            
            for (const lote of lotesCategoria) {
              if (quantidadeRestante <= 0) break;
              
              const quantidadeMover = Math.min(quantidadeRestante, lote.quantidade_cabecas);
              
              if (quantidadeMover === lote.quantidade_cabecas) {
                // Mover lote completo
                await base44.entities.Lote.update(lote.id, {
                  area_atual_id: areaEntradaId,
                  area_atual_nome: areaEntrada?.nome || '',
                  peso_medio_kg: mov.peso_medio
                });
              } else {
                // Dividir lote - criar novo lote na área de destino
                await base44.entities.Lote.create({
                  empresa_id: empresaSelecionadaId,
                  nome: `${lote.nome} (MOVIDO)`,
                  quantidade_cabecas: quantidadeMover,
                  categoria: lote.categoria,
                  sexo: lote.sexo,
                  peso_medio_kg: mov.peso_medio,
                  idade_media_meses: lote.idade_media_meses,
                  area_atual_id: areaEntradaId,
                  area_atual_nome: areaEntrada?.nome || '',
                  raca_predominante: lote.raca_predominante,
                  sistema_produtivo: lote.sistema_produtivo,
                  data_entrada: formData.data_movimentacao,
                  origem: 'MOVIMENTAÇÃO',
                  status: 'Ativo'
                });

                // Atualizar lote original
                await base44.entities.Lote.update(lote.id, {
                  quantidade_cabecas: lote.quantidade_cabecas - quantidadeMover
                });
              }

              // Registrar movimentação
              await base44.entities.MovimentacaoPecuaria.create({
                empresa_id: empresaSelecionadaId,
                data_movimentacao: new Date(formData.data_movimentacao).toISOString(),
                tipo: 'Transferência de Área',
                lote: lote.nome,
                quantidade_animais: quantidadeMover,
                area_origem_id: formData.area_saida_id,
                area_origem_nome: areaSaida?.nome || '',
                area_destino_id: areaEntradaId,
                area_destino_nome: areaEntrada?.nome || '',
                observacoes: `Movimentação parcial - ${quantidadeMover} cabeças de ${mov.categoria} - Peso médio: ${mov.peso_medio}kg`
              });

              quantidadeRestante -= quantidadeMover;
            }
          }
        }
      }
    },
    onSuccess: () => {
      console.log('Movimentação finalizada com sucesso!');
      toast.success('✅ Movimentação realizada com sucesso!');
      
      // Invalidar queries
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      
      // Fechar modais
      setShowMovimentacao(false);
      onClose();
    },
    onError: (error) => {
      console.error('Erro na movimentação:', error);
      toast.error('❌ Erro ao realizar movimentação');
    }
  });

  const handleMovimentacao = async (formData) => {
    return movimentacaoMutation.mutateAsync(formData);
  };

  const handleMorte = async (formData) => {
    console.log('🔍 DETALHES - Lotes passados para formulário:', lotes);
    console.log('🔍 DETALHES - Categorias nos lotes:', lotes.map(l => l.categoria));

    const lotesCategoria = lotes.filter(l => l.categoria === formData.categoria);
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaMorte = areas.find(a => a.id === areaAtualId);

    for (const lote of lotesCategoria) {
      const qtdRemover = Math.min(formData.quantidade, lote.quantidade_cabecas);

      await base44.entities.MovimentacaoPecuaria.create({
        empresa_id: empresaSelecionadaId,
        data_movimentacao: new Date(formData.data_ocorrencia).toISOString(),
        tipo: 'Morte',
        lote: lote.nome,
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

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Morte registrada');
    setShowMorte(false);
    onClose();
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
    await base44.entities.MovimentacaoPecuaria.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date(formData.data_nascimento).toISOString(),
      tipo: 'Nascimento',
      lote: loteFilhote.nome,
      quantidade_animais: formData.quantidade,
      peso_medio: parseFloat(formData.peso_medio) || null,
      area_destino_id: areaAtualId,
      area_destino_nome: areaNascimento?.nome || '',
      observacoes: `Categoria mãe: ${formData.categoria_mae}. Sexo: ${formData.sexo}. Categoria filhote: ${categoriaFilhote}. ${formData.observacoes}`
    });

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Nascimento registrado');
    setShowNascimento(false);
    onClose();
  };

  const handleAbate = async (formData) => {
    const lotesCategoria = lotes.filter(l => l.categoria === formData.categoria);
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaAbate = areas.find(a => a.id === areaAtualId);

    for (const lote of lotesCategoria) {
      const qtdRemover = Math.min(formData.quantidade, lote.quantidade_cabecas);

      await base44.entities.MovimentacaoPecuaria.create({
        empresa_id: empresaSelecionadaId,
        data_movimentacao: new Date(formData.data_abate).toISOString(),
        tipo: 'Abate',
        lote: lote.nome,
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

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Abate registrado');
    setShowAbate(false);
    onClose();
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

        await base44.entities.MovimentacaoPecuaria.create({
          empresa_id: empresaSelecionadaId,
          data_movimentacao: new Date(formData.data_mudanca).toISOString(),
          tipo: 'Mudança de Categoria',
          lote: lote.nome,
          quantidade_animais: qtdMudar,
          area_origem_id: areaAtualId,
          area_origem_nome: areaMudanca?.nome || '',
          observacoes: `De ${mudanca.categoria_atual} para ${mudanca.categoria_nova}. Sexo: ${lote.sexo}. ${formData.observacoes}`
        });

        await base44.entities.Lote.update(lote.id, {
          categoria: mudanca.categoria_nova
        });

        quantidadeRestante -= qtdMudar;
      }
    }

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Categorias atualizadas');
    setShowMudancaCategoria(false);
    onClose();
  };

  const handlePesagem = async (formData) => {
    const areaAtualId = lotes[0]?.area_atual_id;
    const areaPesagem = areas.find(a => a.id === areaAtualId);

    for (const categoria of formData.categorias_selecionadas) {
      const lotesCategoria = lotes.filter(l => l.categoria === categoria);
      const pesoNovo = parseFloat(formData.pesos_por_categoria[categoria]);

      for (const lote of lotesCategoria) {
        const pesoAnterior = lote.peso_medio_kg || 0;
        const ganho = pesoNovo - pesoAnterior;

        await base44.entities.MovimentacaoPecuaria.create({
          empresa_id: empresaSelecionadaId,
          data_movimentacao: new Date(formData.data_pesagem).toISOString(),
          tipo: 'Pesagem',
          lote: lote.nome,
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

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Pesagens registradas');
    setShowPesagem(false);
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-bold text-slate-900 pb-2 border-b">
        {tituloLotes}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
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
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-bold text-slate-900 truncate flex-1">{categoria}</div>
                {iconeUrl && (
                  <img src={iconeUrl} alt={categoria} className="w-10 h-10 object-contain flex-shrink-0 ml-2" />
                )}
              </div>
              <div className="text-2xl font-bold text-emerald-600 mb-2">{totalCabecasCategoria} cab</div>
              <div className="space-y-1 text-[10px] text-slate-600">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">Lotes:</span>
                  <span className="font-semibold text-slate-900 truncate">{lotesCategoria.map(l => l.nome).join(', ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Peso:</span>
                  <span className="font-semibold text-slate-900">{pesoMedio ? pesoMedio.toFixed(0) + ' kg' : '-'}</span>
                </div>
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

      <div className="grid grid-cols-3 gap-2">
        <Button 
          onClick={() => setShowMovimentacao(true)}
          variant="outline"
          className="h-10 text-[11px] font-semibold border-slate-300 hover:bg-slate-50 gap-1.5"
        >
          <ArrowRightLeft className="w-3.5 h-3.5 text-slate-600" />
          Movimentação
        </Button>

        <Button 
          onClick={() => setShowPesagem(true)}
          variant="outline"
          className="h-10 text-[11px] font-semibold border-slate-300 hover:bg-slate-50 gap-1.5"
        >
          <Scale className="w-3.5 h-3.5 text-slate-600" />
          Pesagem
        </Button>

        <Button 
          onClick={() => setShowMudancaCategoria(true)}
          variant="outline"
          className="h-10 text-[11px] font-semibold border-slate-300 hover:bg-slate-50 gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
          Mudança Categ.
        </Button>

        <Button 
          onClick={() => setShowNascimento(true)}
          variant="outline"
          className="h-10 text-[11px] font-semibold border-slate-300 hover:bg-slate-50 gap-1.5"
        >
          <Star className="w-3.5 h-3.5 text-slate-600" />
          Nascimento
        </Button>

        <Button 
          onClick={() => setShowMorte(true)}
          variant="outline"
          className="h-10 text-[11px] font-semibold border-slate-300 hover:bg-slate-50 text-slate-700 gap-1.5"
        >
          <XCircle className="w-3.5 h-3.5 text-slate-600" />
          Morte
        </Button>

        <Button 
          onClick={() => setShowAbate(true)}
          variant="outline"
          className="h-10 text-[11px] font-semibold border-slate-300 hover:bg-slate-50 text-slate-700 gap-1.5"
        >
          <Package className="w-3.5 h-3.5 text-slate-600" />
          Abate
        </Button>
      </div>

      <Button 
        onClick={() => setShowHistorico(true)}
        variant="outline"
        className="w-full h-8 text-[11px] font-semibold mt-2 border-slate-300"
      >
        Ver Histórico Completo
      </Button>

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
          <FormularioMudancaCategoria
            lote={lotes}
            onSubmit={handleMudancaCategoria}
            onCancel={() => setShowMudancaCategoria(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showPesagem} onOpenChange={setShowPesagem}>
        <DialogContent className="max-w-4xl">
          {showPesagem && (
            <FormularioPesagem
              lote={lotes}
              onSubmit={handlePesagem}
              onCancel={() => setShowPesagem(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <HistoricoMovimentacoes lotesIds={lotes.map(l => l.nome)} areaId={areaAtual?.id} />
        </DialogContent>
      </Dialog>
      </div>
      );
      }
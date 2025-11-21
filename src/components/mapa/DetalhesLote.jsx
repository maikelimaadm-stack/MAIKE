import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tantml/react-query";
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
    const lote = lotes[0];
    
    await base44.entities.MovimentacaoPecuaria.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date(formData.data_ocorrencia).toISOString(),
      tipo: 'Morte',
      lote: lote.nome,
      quantidade_animais: formData.quantidade,
      observacoes: `Causa: ${formData.causa_morte}. ${formData.observacoes}`
    });

    await base44.entities.Lote.update(lote.id, {
      quantidade_cabecas: lote.quantidade_cabecas - formData.quantidade
    });

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Morte registrada');
    setShowMorte(false);
    onClose();
  };

  const handleNascimento = async (formData) => {
    const lote = lotes[0];
    
    await base44.entities.MovimentacaoPecuaria.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date(formData.data_nascimento).toISOString(),
      tipo: 'Nascimento',
      lote: lote.nome,
      quantidade_animais: formData.quantidade,
      peso_medio: parseFloat(formData.peso_medio) || null,
      observacoes: `Sexo: ${formData.sexo}. ${formData.observacoes}`
    });

    await base44.entities.Lote.update(lote.id, {
      quantidade_cabecas: lote.quantidade_cabecas + formData.quantidade
    });

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Nascimento registrado');
    setShowNascimento(false);
    onClose();
  };

  const handleAbate = async (formData) => {
    const lote = lotes[0];
    
    await base44.entities.MovimentacaoPecuaria.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date(formData.data_abate).toISOString(),
      tipo: 'Abate',
      lote: lote.nome,
      quantidade_animais: formData.quantidade,
      observacoes: `Peso vivo: ${formData.peso_vivo_total}kg. Peso carcaça: ${formData.peso_carcaca_total}kg. Destino: ${formData.destino}. ${formData.observacoes}`
    });

    await base44.entities.Lote.update(lote.id, {
      quantidade_cabecas: lote.quantidade_cabecas - formData.quantidade
    });

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Abate registrado');
    setShowAbate(false);
    onClose();
  };

  const handleMudancaCategoria = async (formData) => {
    const lote = lotes[0];
    
    await base44.entities.MovimentacaoPecuaria.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date(formData.data_mudanca).toISOString(),
      tipo: 'Mudança de Categoria',
      lote: lote.nome,
      quantidade_animais: lote.quantidade_cabecas,
      observacoes: `De ${lote.categoria} para ${formData.categoria_nova}. ${formData.observacoes}`
    });

    await base44.entities.Lote.update(lote.id, {
      categoria: formData.categoria_nova
    });

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Categoria atualizada');
    setShowMudancaCategoria(false);
    onClose();
  };

  const handlePesagem = async (formData) => {
    const lote = lotes[0];
    const pesoAnterior = lote.peso_medio_kg || 0;
    const ganho = parseFloat(formData.peso_medio) - pesoAnterior;
    
    await base44.entities.MovimentacaoPecuaria.create({
      empresa_id: empresaSelecionadaId,
      data_movimentacao: new Date(formData.data_pesagem).toISOString(),
      tipo: 'Pesagem',
      lote: lote.nome,
      quantidade_animais: lote.quantidade_cabecas,
      peso_medio: parseFloat(formData.peso_medio),
      observacoes: `Peso anterior: ${pesoAnterior}kg. Ganho: ${ganho.toFixed(1)}kg. ${formData.observacoes}`
    });

    await base44.entities.Lote.update(lote.id, {
      peso_medio_kg: parseFloat(formData.peso_medio)
    });

    queryClient.invalidateQueries({ queryKey: ['lotes'] });
    queryClient.invalidateQueries({ queryKey: ['historico-movimentacoes'] });
    toast.success('Pesagem registrada');
    setShowPesagem(false);
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="text-xl font-bold text-slate-900 pb-2 border-b">
        {tituloLotes}
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(lotes.length, 3)}, 1fr)` }}>
        {lotes.map((lote, index) => (
          <div key={lote.id} className="bg-slate-50 rounded-lg p-3 border border-slate-200">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="text-emerald-600 font-semibold text-sm mb-1">
                  {lote.quantidade_cabecas} cabeças - {lote.categoria?.toUpperCase() || 'SEM CATEGORIA'}
                </div>
                <div className="text-[10px] text-slate-600">{lote.nome}</div>
                <div className="w-6 h-6 bg-emerald-500 rounded flex items-center justify-center mt-2">
                  <Check className="w-4 h-4 text-white" />
                </div>
              </div>
              {(() => {
                const configIcone = iconesConfig.find(ic => 
                  ic.tipo_entidade === 'Lote' && 
                  ic.categoria?.toUpperCase() === lote.categoria?.toUpperCase()
                );

                const iconeUrl = configIcone?.sub_icone_url || configIcone?.icone_url;

                if (iconeUrl) {
                  return (
                    <img 
                      src={iconeUrl} 
                      alt={lote.categoria} 
                      className="w-16 h-16 object-contain" 
                    />
                  );
                }
                return null;
              })()}
            </div>

            <div className="space-y-2">
              <div className="bg-white p-2 rounded text-center border border-slate-200">
                <div className="text-[9px] text-emerald-700">Último peso informado</div>
                <div className="text-[8px] text-slate-500">(kg)</div>
                <div className="text-sm font-bold text-slate-900">{lote.peso_medio || '-'}</div>
              </div>

              <div className="bg-white p-2 rounded text-center border border-slate-200">
                <div className="text-[9px] text-emerald-700">Último GMD</div>
                <div className="text-[8px] text-slate-500">(kg/cab/dia)</div>
                <div className="text-sm font-bold text-slate-900">{lote.gmd || '-'}</div>
              </div>

              <div className="bg-white p-2 rounded text-center border border-slate-200">
                <div className="text-[9px] text-emerald-700">Taxa de ganho</div>
                <div className="text-[8px] text-slate-500">(%)</div>
                <div className="text-sm font-bold text-slate-900">{lote.taxa_ganho || '-'}</div>
              </div>

              <div className="bg-white p-2 rounded text-center border border-slate-200">
                <div className="text-[9px] text-emerald-700">Peso projetado</div>
                <div className="text-[8px] text-slate-500">(kg)</div>
                <div className="text-sm font-bold text-slate-900">{lote.peso_projetado || '-'}</div>
              </div>

              <div className="bg-white p-2 rounded text-center border border-slate-200">
                <div className="text-[9px] text-emerald-700">Último consumo</div>
                <div className="text-[8px] text-slate-500">(kg/cab/dia)</div>
                <div className="text-sm font-bold text-slate-900">{lote.ultimo_consumo || '-'}</div>
              </div>

              <div className="bg-white p-2 rounded text-center border border-slate-200">
                <div className="text-[9px] text-emerald-700">Indivíduos</div>
                <div className="text-sm font-bold text-slate-900">{lote.quantidade_cabecas || '-'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-3 pt-3 border-t">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Quantidade de cabeças</div>
            <div className="text-xl font-bold text-slate-900">{totalCabecas}</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Peso médio projetado</div>
            <div className="text-xs text-slate-500">(kg)</div>
            <div className="text-xl font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Taxa de lotação projetada</div>
            <div className="text-xs text-slate-500">(kg/ha)</div>
            <div className="text-xl font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Taxa de lotação (UA/ha)</div>
            <div className="text-xl font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Última movimentação</div>
            <div className="text-sm font-bold text-slate-900">
              {lotes[0]?.data_entrada ? new Date(lotes[0].data_entrada).toLocaleDateString() : '-'}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Última suplementação</div>
            <div className="text-sm font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Índice consumo anterior</div>
            <div className="text-xs text-slate-500">(kg/100 kg/dia)</div>
            <div className="text-sm font-bold text-slate-900">-</div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-emerald-600 mb-1">Oferta de forragem</div>
            <div className="text-xs text-slate-500">(%)</div>
            <div className="text-sm font-bold text-slate-900">-</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-6 gap-2 pt-3">
        <Button 
          onClick={() => setShowAbate(true)}
          className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <div className="text-4xl">🥩</div>
          <span className="text-xs font-semibold">Abate para consumo</span>
        </Button>

        <Button 
          onClick={() => setShowMorte(true)}
          className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <div className="text-4xl">✕</div>
          <span className="text-xs font-semibold">Morte</span>
        </Button>

        <Button 
          onClick={() => setShowMovimentacao(true)}
          className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <div className="text-4xl">⇄</div>
          <span className="text-xs font-semibold">Movimentação</span>
        </Button>

        <Button 
          onClick={() => setShowMudancaCategoria(true)}
          className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <div className="text-4xl">🔄</div>
          <span className="text-xs font-semibold">Mudança de categoria</span>
        </Button>

        <Button 
          onClick={() => setShowNascimento(true)}
          className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <div className="text-4xl">⭐</div>
          <span className="text-xs font-semibold">Nascimento</span>
        </Button>

        <Button 
          onClick={() => setShowPesagem(true)}
          className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <div className="text-4xl">⚖</div>
          <span className="text-xs font-semibold">Pesagem</span>
        </Button>
      </div>

      <div className="mt-4">
        <Button 
          onClick={() => setShowHistorico(true)}
          variant="outline"
          className="w-full h-10 text-xs font-semibold"
        >
          📋 Ver Histórico Completo
        </Button>
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
        <DialogContent className="max-w-md">
          <FormularioMorte
            lote={lotes[0]}
            onSubmit={handleMorte}
            onCancel={() => setShowMorte(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showNascimento} onOpenChange={setShowNascimento}>
        <DialogContent className="max-w-md">
          <FormularioNascimento
            lote={lotes[0]}
            onSubmit={handleNascimento}
            onCancel={() => setShowNascimento(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showAbate} onOpenChange={setShowAbate}>
        <DialogContent className="max-w-md">
          <FormularioAbate
            lote={lotes[0]}
            onSubmit={handleAbate}
            onCancel={() => setShowAbate(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showMudancaCategoria} onOpenChange={setShowMudancaCategoria}>
        <DialogContent className="max-w-md">
          <FormularioMudancaCategoria
            lote={lotes[0]}
            onSubmit={handleMudancaCategoria}
            onCancel={() => setShowMudancaCategoria(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showPesagem} onOpenChange={setShowPesagem}>
        <DialogContent className="max-w-md">
          <FormularioPesagem
            lote={lotes[0]}
            onSubmit={handlePesagem}
            onCancel={() => setShowPesagem(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <HistoricoMovimentacoes lotesIds={lotes.map(l => l.nome)} />
        </DialogContent>
      </Dialog>
      </div>
      );
      }
import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
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

export default function DetalhesLote({ lotes, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showMovimentacao, setShowMovimentacao] = useState(false);
  const queryClient = useQueryClient();

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
              data_movimentacao: formData.data_movimentacao,
              tipo_movimentacao: 'Transferência',
              lote_id: lote.id,
              lote_nome: lote.nome,
              categoria: lote.categoria,
              quantidade_cabecas: lote.quantidade_cabecas,
              area_origem_id: formData.area_saida_id,
              area_origem_nome: areaSaida?.nome || '',
              area_destino_id: areaEntradaId,
              area_destino_nome: areaEntrada?.nome || '',
              peso_medio: lote.peso_medio_kg || 0,
              observacoes: `Movimentação completa do lote`
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
                data_movimentacao: formData.data_movimentacao,
                tipo_movimentacao: 'Transferência',
                lote_id: lote.id,
                lote_nome: lote.nome,
                categoria: mov.categoria,
                quantidade_cabecas: quantidadeMover,
                area_origem_id: formData.area_saida_id,
                area_origem_nome: areaSaida?.nome || '',
                area_destino_id: areaEntradaId,
                area_destino_nome: areaEntrada?.nome || '',
                peso_medio: mov.peso_medio,
                observacoes: `Movimentação de ${quantidadeMover} cabeças`
              });

              quantidadeRestante -= quantidadeMover;
            }
          }
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      setShowMovimentacao(false);
      onClose();
      toast.success('✅ Movimentação realizada com sucesso!');
    },
    onError: (error) => {
      console.error('Erro na movimentação:', error);
      toast.error('❌ Erro ao realizar movimentação');
    }
  });

  const handleMovimentacao = (formData) => {
    movimentacaoMutation.mutate(formData);
  };

  return (
    <div className="space-y-4">
      <div className="text-xl font-bold text-slate-900 pb-2 border-b">
        {tituloLotes}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${lotes.length}, 1fr)` }}>
        {lotes.map((lote, index) => (
          <div key={lote.id} className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-emerald-600 font-semibold text-base mb-1">
                  {lote.quantidade_cabecas} cabeças - {lote.categoria?.toUpperCase() || 'SEM CATEGORIA'}
                </div>
                <div className="text-xs text-slate-600">LOTE {lote.numero_lote || lote.nome}</div>
                <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center mt-2">
                  <Check className="w-5 h-5 text-white" />
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
                      className="w-20 h-20 object-contain" 
                    />
                  );
                }
                return null;
              })()}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Último peso informado</div>
                <div className="text-xs text-slate-500">(kg)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.peso_medio || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Último GMD ocorrido</div>
                <div className="text-xs text-slate-500">(kg/cabeça/dia)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.gmd || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Taxa de ganho</div>
                <div className="text-xs text-slate-500">(%)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.taxa_ganho || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Peso projetado</div>
                <div className="text-xs text-slate-500">(kg)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.peso_projetado || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">Último consumo</div>
                <div className="text-xs text-slate-500">(kg/cabeça/dia)</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.ultimo_consumo || '-'}
                </div>
              </div>

              <div className="bg-emerald-50 p-2 rounded text-center">
                <div className="text-[10px] text-emerald-700 mb-1">{lote.categoria || 'Categoria'}</div>
                <div className="text-base font-bold text-slate-900 mt-1">
                  {lote.quantidade_cabecas || '-'} cabeças
                </div>
                <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mt-1">
                  <span className="text-white text-xs">✓</span>
                </div>
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
        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">🥩</div>
          <span className="text-xs font-semibold">Abate para consumo</span>
        </Button>

        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
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

        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">🔄</div>
          <span className="text-xs font-semibold">Mudança de categoria</span>
        </Button>

        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">⭐</div>
          <span className="text-xs font-semibold">Nascimento</span>
        </Button>

        <Button className="h-24 flex-col gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <div className="text-4xl">⚖</div>
          <span className="text-xs font-semibold">Pesagem</span>
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
      </div>
      );
      }
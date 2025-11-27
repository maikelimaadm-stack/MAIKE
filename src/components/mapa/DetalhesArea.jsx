import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Leaf, Tractor, Plus, MapPin, DollarSign,
  TrendingUp, Package, Calculator, ClipboardList
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { toast } from "sonner";
import FormularioOperacao from "../operacoes/FormularioOperacao";
import FormularioControleArea from "../areas/FormularioControleArea";

export default function DetalhesArea({ area, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showOperacao, setShowOperacao] = useState(false);
  const [showControle, setShowControle] = useState(false);
  const [editingControle, setEditingControle] = useState(null);
  const queryClient = useQueryClient();

  // Buscar operações da área
  const { data: operacoes = [] } = useQuery({
    queryKey: ['operacoes-area', area.id],
    queryFn: async () => {
      const all = await base44.entities.OperacaoAgricola.list('-data_inicio');
      return all.filter(o => o.area_id === area.id);
    },
  });

  // Buscar controle da área
  const { data: controles = [] } = useQuery({
    queryKey: ['controle-area', area.id],
    queryFn: async () => {
      const all = await base44.entities.ControleArea.list('-created_date');
      return all.filter(c => c.area_id === area.id);
    },
  });

  // Buscar lotes na área
  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-area', area.id],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.area_atual_id === area.id && l.status === 'Ativo');
    },
  });

  // Calcular custos
  const custos = useMemo(() => {
    const operacoesConc = operacoes.filter(o => o.status === 'Concluída');
    
    const custoOperacoes = operacoesConc.reduce((sum, o) => sum + (o.custo_total || 0), 0);
    const custoCombustivel = operacoesConc.reduce((sum, o) => sum + (o.valor_combustivel || 0), 0);
    const custoMaquinas = operacoesConc.reduce((sum, o) => sum + (o.custo_maquina_total || 0), 0);
    const custoInsumos = operacoesConc.reduce((sum, o) => sum + (o.custo_produto || 0), 0);
    const custoMaoObra = operacoesConc.reduce((sum, o) => sum + (o.custo_mao_obra || 0), 0);
    
    const hectares = area.tamanho_hectares || 1;
    const custoPorHa = custoOperacoes / hectares;
    
    // Agrupar por tipo de operação
    const custoPorTipo = {};
    operacoesConc.forEach(o => {
      if (!custoPorTipo[o.tipo_operacao]) {
        custoPorTipo[o.tipo_operacao] = 0;
      }
      custoPorTipo[o.tipo_operacao] += o.custo_total || 0;
    });

    return {
      total: custoOperacoes,
      combustivel: custoCombustivel,
      maquinas: custoMaquinas,
      insumos: custoInsumos,
      maoObra: custoMaoObra,
      porHectare: custoPorHa,
      porTipo: custoPorTipo
    };
  }, [operacoes, area]);

  const controleAtual = controles.length > 0 ? controles[0] : null;
  const totalCabecas = lotes.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);
  const totalOperacoes = operacoes.length;
  const totalHectaresTrabalhados = operacoes.filter(o => o.status === 'Concluída')
    .reduce((sum, o) => sum + (o.hectares_trabalhados || 0), 0);

  const statusColors = {
    'Pousio': 'bg-slate-100 text-slate-800',
    'Preparação': 'bg-amber-100 text-amber-800',
    'Plantada': 'bg-blue-100 text-blue-800',
    'Em Desenvolvimento': 'bg-emerald-100 text-emerald-800',
    'Colheita': 'bg-purple-100 text-purple-800',
    'Colhida': 'bg-green-100 text-green-800',
    'Planejada': 'bg-blue-100 text-blue-800',
    'Em Andamento': 'bg-amber-100 text-amber-800',
    'Concluída': 'bg-emerald-100 text-emerald-800',
  };

  return (
    <div className="space-y-4" translate="no">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between pb-2 border-b">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-bold text-slate-900">{area.nome}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>{area.tamanho_hectares || 0} ha</span>
            <span>•</span>
            <span>{area.tipo_pastagem || 'Sem tipo'}</span>
          </div>
        </div>
        {controleAtual && (
          <Badge className={statusColors[controleAtual.status]}>
            {controleAtual.status}
          </Badge>
        )}
      </div>

      {/* Resumo Geral */}
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center p-2 bg-emerald-50 rounded-lg">
          <div className="text-lg font-bold text-emerald-700">{area.tamanho_hectares || 0}</div>
          <div className="text-[10px] text-emerald-600">Hectares</div>
        </div>
        <div className="text-center p-2 bg-blue-50 rounded-lg">
          <div className="text-lg font-bold text-blue-700">{totalCabecas}</div>
          <div className="text-[10px] text-blue-600">Cabeças</div>
        </div>
        <div className="text-center p-2 bg-amber-50 rounded-lg">
          <div className="text-lg font-bold text-amber-700">{totalOperacoes}</div>
          <div className="text-[10px] text-amber-600">Operações</div>
        </div>
        <div className="text-center p-2 bg-purple-50 rounded-lg">
          <div className="text-lg font-bold text-purple-700">{totalHectaresTrabalhados.toFixed(0)}</div>
          <div className="text-[10px] text-purple-600">ha Trab.</div>
        </div>
      </div>

      {/* Resumo de Custos */}
      <Card className="border-red-200 bg-gradient-to-r from-red-50 to-orange-50">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4 text-red-600" />
            <span className="text-xs font-semibold text-red-900">Custos da Área</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center p-2 bg-white rounded-lg border">
              <div className="text-sm font-bold text-red-700">
                R$ {custos.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[9px] text-slate-600">CUSTO TOTAL</div>
            </div>
            <div className="text-center p-2 bg-white rounded-lg border">
              <div className="text-sm font-bold text-orange-700">
                R$ {custos.porHectare.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[9px] text-slate-600">CUSTO/HA</div>
            </div>
            <div className="text-center p-2 bg-white rounded-lg border">
              <div className="text-sm font-bold text-amber-700">
                {controleAtual?.producao_estimada_kg 
                  ? `R$ ${((custos.total / (controleAtual.producao_estimada_kg / 60)) || 0).toFixed(2)}`
                  : '-'}
              </div>
              <div className="text-[9px] text-slate-600">CUSTO/SC</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            <div className="bg-white p-1.5 rounded text-center">
              <div className="font-semibold text-slate-700">R$ {custos.combustivel.toFixed(0)}</div>
              <div className="text-slate-500">Combustível</div>
            </div>
            <div className="bg-white p-1.5 rounded text-center">
              <div className="font-semibold text-slate-700">R$ {custos.maquinas.toFixed(0)}</div>
              <div className="text-slate-500">Máquinas</div>
            </div>
            <div className="bg-white p-1.5 rounded text-center">
              <div className="font-semibold text-slate-700">R$ {custos.insumos.toFixed(0)}</div>
              <div className="text-slate-500">Insumos</div>
            </div>
            <div className="bg-white p-1.5 rounded text-center">
              <div className="font-semibold text-slate-700">R$ {custos.maoObra.toFixed(0)}</div>
              <div className="text-slate-500">Mão Obra</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controle Atual */}
      {controleAtual && (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Leaf className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-semibold text-emerald-900">Cultura Atual</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => { setEditingControle(controleAtual); setShowControle(true); }}
              >
                Editar
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-500">Cultura:</span>
                <span className="ml-1 font-medium">{controleAtual.cultura || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">Variedade:</span>
                <span className="ml-1 font-medium">{controleAtual.variedade || '-'}</span>
              </div>
              <div>
                <span className="text-slate-500">Plantio:</span>
                <span className="ml-1 font-medium">
                  {controleAtual.data_plantio ? format(new Date(controleAtual.data_plantio), 'dd/MM/yy') : '-'}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Prod. Est:</span>
                <span className="ml-1 font-medium">
                  {controleAtual.producao_estimada_kg ? `${(controleAtual.producao_estimada_kg/1000).toFixed(1)}t` : '-'}
                </span>
              </div>
            </div>
            {controleAtual.produtividade_sc_ha && (
              <div className="flex items-center gap-1 mt-2 text-xs text-emerald-700">
                <TrendingUp className="w-3 h-3" />
                {controleAtual.produtividade_sc_ha} sc/ha
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="operacoes" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="operacoes" className="text-xs">
            <Tractor className="w-3 h-3 mr-1" />
            Operações
          </TabsTrigger>
          <TabsTrigger value="custos" className="text-xs">
            <Calculator className="w-3 h-3 mr-1" />
            Custos
          </TabsTrigger>
          <TabsTrigger value="lotes" className="text-xs">
            <Package className="w-3 h-3 mr-1" />
            Lotes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="operacoes" className="mt-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-slate-700">Últimas Operações</span>
            <Button size="sm" onClick={() => setShowOperacao(true)} className="h-7 gap-1 text-xs">
              <Plus className="w-3 h-3" />
              Nova
            </Button>
          </div>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {operacoes.length === 0 ? (
              <p className="text-center text-slate-500 text-xs py-6">Nenhuma operação</p>
            ) : operacoes.slice(0, 5).map(op => (
              <div key={op.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                <div>
                  <div className="text-xs font-medium">{op.tipo_operacao}</div>
                  <div className="text-[10px] text-slate-500">
                    {op.data_inicio ? format(new Date(op.data_inicio), 'dd/MM/yy') : '-'}
                    {op.maquina_nome && ` • ${op.maquina_nome}`}
                  </div>
                </div>
                <div className="text-right">
                  {op.custo_total ? (
                    <div className="text-xs font-semibold text-red-600">R$ {op.custo_total.toFixed(2)}</div>
                  ) : (
                    <Badge className={`text-[10px] ${statusColors[op.status]}`}>{op.status}</Badge>
                  )}
                  {op.hectares_trabalhados && (
                    <div className="text-[10px] text-slate-600">{op.hectares_trabalhados} ha</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="custos" className="mt-3">
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-700">Custos por Tipo de Operação</h4>
            {Object.entries(custos.porTipo).length === 0 ? (
              <p className="text-center text-slate-500 text-xs py-6">Sem custos registrados</p>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(custos.porTipo)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tipo, valor]) => (
                  <div key={tipo} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                    <span className="text-xs font-medium text-slate-700">{tipo}</span>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-red-600">
                        R$ {valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        R$ {(valor / (area.tamanho_hectares || 1)).toFixed(2)}/ha
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="lotes" className="mt-3">
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {lotes.length === 0 ? (
              <p className="text-center text-slate-500 text-xs py-6">Nenhum lote nesta área</p>
            ) : lotes.map(lote => (
              <div key={lote.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                <div>
                  <div className="text-xs font-medium">{lote.nome}</div>
                  <div className="text-[10px] text-slate-500">{lote.categoria}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-slate-900">{lote.quantidade_cabecas} cab</div>
                  {lote.peso_medio_kg && (
                    <div className="text-[10px] text-slate-600">{lote.peso_medio_kg} kg</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Ações */}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <Button
          onClick={() => setShowOperacao(true)}
          variant="outline"
          className="h-10 text-xs font-semibold gap-1"
        >
          <Tractor className="w-4 h-4" />
          Nova Operação
        </Button>
        <Button
          onClick={() => { setEditingControle(null); setShowControle(true); }}
          variant="outline"
          className="h-10 text-xs font-semibold gap-1"
        >
          <Leaf className="w-4 h-4" />
          {controleAtual ? 'Atualizar Cultura' : 'Registrar Cultura'}
        </Button>
      </div>

      {/* Dialog Operação */}
      <Dialog open={showOperacao} onOpenChange={setShowOperacao}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Operação - {area.nome}</DialogTitle>
          </DialogHeader>
          <FormularioOperacao
            operacao={{ area_id: area.id, area_nome: area.nome }}
            onSave={() => {
              setShowOperacao(false);
              queryClient.invalidateQueries({ queryKey: ['operacoes-area'] });
              toast.success('Operação registrada!');
            }}
            onCancel={() => setShowOperacao(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog Controle */}
      <Dialog open={showControle} onOpenChange={setShowControle}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingControle ? 'Atualizar Cultura' : 'Registrar Cultura'} - {area.nome}</DialogTitle>
          </DialogHeader>
          <FormularioControleArea
            controle={editingControle || { area_id: area.id, area_nome: area.nome }}
            onSave={() => {
              setShowControle(false);
              queryClient.invalidateQueries({ queryKey: ['controle-area'] });
              toast.success('Cultura registrada!');
            }}
            onCancel={() => setShowControle(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
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
import TarefasMapaPanel from "./TarefasMapaPanel";
import HistoricoMovimentacoes from "../lotes/HistoricoMovimentacoes";

export default function DetalhesArea({ area, onClose }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showOperacao, setShowOperacao] = useState(false);
  const [showControle, setShowControle] = useState(false);
  const [editingControle, setEditingControle] = useState(null);
  const queryClient = useQueryClient();
  const isCurral = area?.tipo_cultura === 'Infraestrutura' && String(area?.tipo_infraestrutura || area?.tipo_pastagem || '').trim().toLowerCase() === 'curral';

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
    'Pousio': 'bg-slate-100 text-slate-700',
    'Preparação': 'bg-slate-100 text-slate-700',
    'Plantada': 'bg-slate-100 text-slate-700',
    'Em Desenvolvimento': 'bg-slate-100 text-slate-700',
    'Colheita': 'bg-slate-100 text-slate-700',
    'Colhida': 'bg-slate-100 text-slate-700',
    'Planejada': 'bg-slate-100 text-slate-700',
    'Em Andamento': 'bg-slate-100 text-slate-700',
    'Concluída': 'bg-slate-100 text-slate-700',
  };

  if (!isCurral) return null;

  return (
    <div className="space-y-4" translate="no">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between pb-2 border-b">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-emerald-600" />
            <span className="text-sm font-bold text-slate-900">{area.nome}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600 flex-wrap">
            {isCurral ? (
              <>
                <span>{area.tipo_infraestrutura || area.tipo_pastagem || 'Sem tipo'}</span>
                <span>•</span>
                <span>{area.tipo_cultura || 'Sem tipo'}</span>
              </>
            ) : (
              <>
                <span>HA {Number(area.tamanho_hectares || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                {area.area_pastejada > 0 && (
                  <>
                    <span>•</span>
                    <span className="font-medium text-emerald-700">{area.area_pastejada} ha efetivos</span>
                  </>
                )}
                <span>•</span>
                <span>{area.tipo_pastagem || 'Sem tipo'}</span>
              </>
            )}
          </div>
        </div>
        {controleAtual && (
          <Badge className={statusColors[controleAtual.status]}>
            {controleAtual.status}
          </Badge>
        )}
      </div>

      {/* Resumo Geral */}
      <div className="grid grid-cols-2 gap-2">
        <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
          <div className="text-sm font-bold text-slate-700">{area.tipo_infraestrutura || area.tipo_pastagem || '-'}</div>
          <div className="text-[10px] text-slate-600">Tipo de Infraestrutura</div>
        </div>
        <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
          <div className="text-sm font-bold text-slate-700">{area.tipo_cultura || '-'}</div>
          <div className="text-[10px] text-slate-600">Tipo de Área</div>
        </div>
      </div>

          <div className="grid grid-cols-4 gap-2">
            <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-lg font-bold text-slate-700">{area.area_pastejada > 0 ? area.area_pastejada : (area.tamanho_hectares || 0)}</div>
              <div className="text-[10px] text-slate-600">{area.area_pastejada > 0 ? 'ha Efetivos' : 'Hectares'}</div>
            </div>
            <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-lg font-bold text-slate-700">{totalCabecas}</div>
              <div className="text-[10px] text-slate-600">Cabeças</div>
            </div>
            <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-lg font-bold text-slate-700">
                {(() => {
                  let ua = 0;
                  lotes.forEach(l => { ua += ((l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0)) / 450; });
                  const ha = area.area_pastejada > 0 ? area.area_pastejada : (area.tamanho_hectares || 0);
                  return ha > 0 ? (ua / ha).toFixed(2) : '0';
                })()}
              </div>
              <div className="text-[10px] text-slate-600">UA/ha</div>
            </div>
            <div className="text-center p-2 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-lg font-bold text-slate-700">{totalOperacoes}</div>
              <div className="text-[10px] text-slate-600">Operações</div>
            </div>
          </div>

          {/* Resumo de Custos */}
          <Card className="border-slate-200 bg-slate-50">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4 text-slate-600" />
            <span className="text-xs font-semibold text-slate-900">Custos da Área</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="text-center p-2 bg-white rounded-lg border border-slate-200">
              <div className="text-sm font-bold text-slate-700">
                R$ {custos.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[9px] text-slate-600">CUSTO TOTAL</div>
            </div>
            <div className="text-center p-2 bg-white rounded-lg border border-slate-200">
              <div className="text-sm font-bold text-slate-700">
                R$ {custos.porHectare.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </div>
              <div className="text-[9px] text-slate-600">CUSTO/HA</div>
            </div>
            <div className="text-center p-2 bg-white rounded-lg border border-slate-200">
              <div className="text-sm font-bold text-slate-700">
                {controleAtual?.producao_estimada_kg 
                  ? `R$ ${((custos.total / (controleAtual.producao_estimada_kg / 60)) || 0).toFixed(2)}`
                  : '-'}
              </div>
              <div className="text-[9px] text-slate-600">CUSTO/SC</div>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            <div className="bg-white p-1.5 rounded border border-slate-200 text-center">
              <div className="font-semibold text-slate-700">R$ {custos.combustivel.toFixed(0)}</div>
              <div className="text-slate-500">Combustível</div>
            </div>
            <div className="bg-white p-1.5 rounded border border-slate-200 text-center">
              <div className="font-semibold text-slate-700">R$ {custos.maquinas.toFixed(0)}</div>
              <div className="text-slate-500">Máquinas</div>
            </div>
            <div className="bg-white p-1.5 rounded border border-slate-200 text-center">
              <div className="font-semibold text-slate-700">R$ {custos.insumos.toFixed(0)}</div>
              <div className="text-slate-500">Insumos</div>
            </div>
            <div className="bg-white p-1.5 rounded border border-slate-200 text-center">
              <div className="font-semibold text-slate-700">R$ {custos.maoObra.toFixed(0)}</div>
              <div className="text-slate-500">Mão Obra</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="historico" className="w-full">
        <TabsList className="grid w-full grid-cols-1">
          <TabsTrigger value="historico" className="text-xs">
            <ClipboardList className="w-3 h-3 mr-1" />
            Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="historico" className="mt-3">
          <HistoricoMovimentacoes areaId={area.id} />
        </TabsContent>

      </Tabs>

    </div>
  );
}
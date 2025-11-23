import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";

export default function FormularioLancamentoSuplementacao({ ponto, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  
  const [formData, setFormData] = useState({
    data_lancamento: new Date().toISOString().split('T')[0],
    produto: ponto?.produto_padrao || "",
    quantidade_total_kg: "",
    sobra_kg: "0",
    observacoes: ""
  });

  // Buscar lotes na área do ponto
  const { data: lotes = [], isLoading: loadingLotes } = useQuery({
    queryKey: ['lotes-area', ponto?.area_vinculada_id],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => 
        l.empresa_id === empresaSelecionadaId && 
        l.area_atual_id === ponto?.area_vinculada_id &&
        l.status === 'Ativo'
      );
    },
    enabled: !!empresaSelecionadaId && !!ponto?.area_vinculada_id,
  });

  // Buscar fatores de consumo
  const { data: fatores = [] } = useQuery({
    queryKey: ['fatores-consumo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FatorConsumoCategoria.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId && f.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Buscar último lançamento neste ponto para calcular período
  const { data: ultimoEvento } = useQuery({
    queryKey: ['ultimo-evento-ponto', ponto?.id],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      const eventosPonto = all
        .filter(e => e.ponto_suplementacao_id === ponto?.id)
        .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
      return eventosPonto[0] || null;
    },
    enabled: !!ponto?.id,
  });

  // Buscar produtos de suplementação
  const { data: produtosSuplementacao = [] } = useQuery({
    queryKey: ['produtos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => 
        p.empresa_id === empresaSelecionadaId && 
        p.categoria?.toUpperCase() === 'SUPLEMENTAÇÃO'
      );
    },
    enabled: !!empresaSelecionadaId,
  });

  const totalCabecas = lotes.reduce((sum, lote) => sum + (lote.quantidade_cabecas || 0), 0);

  // Calcular dias do período
  const diasPeriodo = ultimoEvento 
    ? Math.max(1, Math.ceil((new Date(formData.data_lancamento) - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24)))
    : null;

  // Calcular peso total de consumo (soma de cabeças x fator)
  const pesoTotalConsumo = lotes.reduce((sum, lote) => {
    const categoriaLote = lote.categoria?.toUpperCase().trim();
    const fator = fatores.find(f => f.categoria?.toUpperCase().trim() === categoriaLote)?.fator || 1.0;
    return sum + (lote.quantidade_cabecas * fator);
  }, 0);

  // Calcular consumo diário do grupo (se houver período)
  const quantidadeConsumida = parseFloat(formData.quantidade_total_kg || 0) - parseFloat(formData.sobra_kg || 0);
  const consumoDiarioGrupo = diasPeriodo && quantidadeConsumida > 0
    ? quantidadeConsumida / diasPeriodo
    : quantidadeConsumida;

  // Calcular consumo unitário por dia
  const consumoUnitarioDia = diasPeriodo && pesoTotalConsumo > 0
    ? quantidadeConsumida / (diasPeriodo * pesoTotalConsumo)
    : 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (totalCabecas === 0) {
      alert("Não há lotes ativos na área deste ponto de suplementação");
      return;
    }

    if (fatores.length === 0) {
      alert("Configure os fatores de consumo por categoria antes de lançar suplementação");
      return;
    }

    // Criar novo evento (ainda sem período definido - será fechado no próximo)
    const dadosEvento = {
      empresa_id: empresaSelecionadaId,
      ponto_suplementacao_id: ponto.id,
      ponto_nome: ponto.nome_ponto,
      area_id: ponto.area_vinculada_id,
      area_nome: ponto.area_vinculada_nome,
      data_lancamento: formData.data_lancamento,
      produto: formData.produto,
      quantidade_total_kg: parseFloat(formData.quantidade_total_kg),
      sobra_kg: parseFloat(formData.sobra_kg || 0),
      dias_periodo: null, // Será calculado no próximo lançamento
      consumo_diario_grupo_kg: null,
      total_cabecas_afetadas: totalCabecas,
      peso_total_consumo: pesoTotalConsumo,
      observacoes: formData.observacoes
    };

    // Se existe evento anterior, recalcular seu período AGORA
    let eventoAnteriorAtualizado = null;
    let lotesAnterioresAtualizados = [];

    if (ultimoEvento) {
      const quantidadeConsumidaAnterior = ultimoEvento.quantidade_total_kg - (ultimoEvento.sobra_kg || 0);
      const consumoDiarioGrupoAnterior = quantidadeConsumidaAnterior / diasPeriodo;
      const consumoUnitarioDiaAnterior = quantidadeConsumidaAnterior / (diasPeriodo * ultimoEvento.peso_total_consumo);

      eventoAnteriorAtualizado = {
        id: ultimoEvento.id,
        dias_periodo: diasPeriodo,
        consumo_diario_grupo_kg: consumoDiarioGrupoAnterior
      };

      // Recalcular lotes do evento anterior
      lotesAnterioresAtualizados = lotes.map(lote => {
        const categoriaLote = lote.categoria?.toUpperCase().trim();
        const fator = fatores.find(f => f.categoria?.toUpperCase().trim() === categoriaLote)?.fator || 1.0;
        const pesoConsumoLote = lote.quantidade_cabecas * fator;
        const consumoPorCabecaDia = consumoUnitarioDiaAnterior * fator;
        const consumoTotalLotePeriodo = consumoPorCabecaDia * lote.quantidade_cabecas * diasPeriodo;

        return {
          lote_id: lote.id,
          peso_consumo_lote: pesoConsumoLote,
          dias_periodo: diasPeriodo,
          consumo_unitario_dia: consumoUnitarioDiaAnterior,
          consumo_por_cabeca_dia_kg: consumoPorCabecaDia,
          consumo_total_lote_periodo_kg: consumoTotalLotePeriodo
        };
      });
    }

    const lotesAfetados = lotes.map(lote => {
      const categoriaLote = lote.categoria?.toUpperCase().trim();
      const fator = fatores.find(f => f.categoria?.toUpperCase().trim() === categoriaLote)?.fator || 1.0;
      const pesoConsumoLote = lote.quantidade_cabecas * fator;

      return {
        empresa_id: empresaSelecionadaId,
        lote_id: lote.id,
        lote_nome: lote.nome,
        categoria: lote.categoria,
        fator_consumo: fator,
        data_lancamento: formData.data_lancamento,
        produto: formData.produto,
        cabecas_na_area: lote.quantidade_cabecas,
        peso_consumo_lote: pesoConsumoLote,
        dias_periodo: null, // Será calculado no próximo lançamento
        consumo_unitario_dia: null,
        consumo_por_cabeca_dia_kg: null,
        consumo_total_lote_periodo_kg: null
      };
    });

    onSubmit({ 
      evento: dadosEvento, 
      lotes: lotesAfetados,
      eventoAnterior: eventoAnteriorAtualizado,
      lotesAnteriores: lotesAnterioresAtualizados
    });
  };

  return (
    <Card>
      <CardHeader className="bg-emerald-50 border-b py-3">
        <CardTitle className="text-sm font-semibold text-emerald-900">
          Lançar Suplementação - {ponto?.nome_ponto}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-600">Área:</span>
                <span className="font-semibold text-slate-900 ml-2">{ponto?.area_vinculada_nome}</span>
              </div>
              <div>
                <span className="text-slate-600">Tipo:</span>
                <span className="font-semibold text-slate-900 ml-2">{ponto?.tipo}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600">Lotes na área:</span>
              {loadingLotes ? (
                <Badge variant="outline" className="text-xs">Carregando...</Badge>
              ) : (
                <Badge className="bg-emerald-100 text-emerald-800 text-xs">
                  {lotes.length} lote(s) - {totalCabecas} cabeças
                </Badge>
              )}
            </div>
            {ultimoEvento && diasPeriodo && (
              <div className="pt-2 border-t border-slate-200">
                <div className="text-xs text-blue-700">
                  ⏱️ Último lançamento: {new Date(ultimoEvento.data_lancamento).toLocaleDateString()}
                  <span className="font-bold ml-2">→ Período: {diasPeriodo} dia(s)</span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data do Lançamento *</Label>
              <Input
                type="date"
                value={formData.data_lancamento}
                onChange={(e) => setFormData({ ...formData, data_lancamento: e.target.value })}
                className="h-9 text-xs"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Produto *</Label>
              <Select 
                value={formData.produto} 
                onValueChange={(v) => setFormData({ ...formData, produto: v })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  {produtosSuplementacao.map(produto => (
                    <SelectItem key={produto.id} value={produto.nome_produto} className="text-xs">
                      {produto.nome_produto}
                    </SelectItem>
                  ))}
                  {produtosSuplementacao.length === 0 && (
                    <SelectItem value="NENHUM" disabled className="text-xs italic">
                      Nenhum produto cadastrado
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Quantidade Total Fornecida (kg) *</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.quantidade_total_kg}
                onChange={(e) => setFormData({ ...formData, quantidade_total_kg: e.target.value })}
                className="h-9 text-xs"
                placeholder="0"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sobra no Cocho (kg)</Label>
              <Input
                type="number"
                step="0.1"
                value={formData.sobra_kg}
                onChange={(e) => setFormData({ ...formData, sobra_kg: e.target.value })}
                className="h-9 text-xs"
                placeholder="0"
              />
            </div>
          </div>

          {formData.quantidade_total_kg && totalCabecas > 0 && ultimoEvento && diasPeriodo && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
              <div className="text-xs font-semibold text-amber-900 mb-2">⚠️ Fechamento do Período Anterior:</div>
              <div className="text-xs text-amber-800 mb-2">
                O lançamento de <strong>{new Date(ultimoEvento.data_lancamento).toLocaleDateString()}</strong> será fechado com <strong>{diasPeriodo} dia(s)</strong> de duração.
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-amber-700">Quantidade anterior:</span>
                  <span className="font-bold text-amber-900 ml-2">{(ultimoEvento.quantidade_total_kg - (ultimoEvento.sobra_kg || 0)).toFixed(1)} kg</span>
                </div>
                <div>
                  <span className="text-amber-700">Consumo/dia calculado:</span>
                  <span className="font-bold text-amber-900 ml-2">{((ultimoEvento.quantidade_total_kg - (ultimoEvento.sobra_kg || 0)) / diasPeriodo).toFixed(2)} kg/dia</span>
                </div>
              </div>
            </div>
          )}

          {!ultimoEvento && formData.quantidade_total_kg && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-blue-900 mb-2">ℹ️ Primeiro Lançamento</div>
              <div className="text-xs text-blue-700">
                Este é o primeiro lançamento neste ponto. O consumo será calculado quando o próximo abastecimento for registrado.
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea
              value={formData.observacoes}
              onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
              className="text-xs"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
            <Button 
              type="submit" 
              size="sm" 
              className="h-8 text-xs bg-slate-800 hover:bg-slate-900"
              disabled={totalCabecas === 0}
            >
              Registrar Suplementação
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";

export default function FormularioLancamentoSuplementacao({ ponto, onSubmit, onCancel }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  
  const [formData, setFormData] = useState({
    data_lancamento: new Date().toISOString().split('T')[0],
    produto: ponto?.produto_padrao || "",
    quantidade_total_kg: "",
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

  const totalCabecas = lotes.reduce((sum, lote) => sum + (lote.quantidade_cabecas || 0), 0);
  const consumoPorCabeca = formData.quantidade_total_kg && totalCabecas > 0 
    ? (parseFloat(formData.quantidade_total_kg) / totalCabecas).toFixed(3)
    : 0;

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (totalCabecas === 0) {
      alert("Não há lotes ativos na área deste ponto de suplementação");
      return;
    }

    const dadosEvento = {
      empresa_id: empresaSelecionadaId,
      ponto_suplementacao_id: ponto.id,
      ponto_nome: ponto.nome_ponto,
      area_id: ponto.area_vinculada_id,
      area_nome: ponto.area_vinculada_nome,
      data_lancamento: formData.data_lancamento,
      produto: formData.produto,
      quantidade_total_kg: parseFloat(formData.quantidade_total_kg),
      total_cabecas_afetadas: totalCabecas,
      consumo_medio_por_cabeca_kg: parseFloat(consumoPorCabeca),
      observacoes: formData.observacoes
    };

    const lotesAfetados = lotes.map(lote => {
      const consumoLote = (parseFloat(consumoPorCabeca) * lote.quantidade_cabecas);
      return {
        empresa_id: empresaSelecionadaId,
        lote_id: lote.id,
        lote_nome: lote.nome,
        data_lancamento: formData.data_lancamento,
        produto: formData.produto,
        cabecas_na_area: lote.quantidade_cabecas,
        consumo_lote_kg: consumoLote,
        consumo_por_cabeca: parseFloat(consumoPorCabeca)
      };
    });

    onSubmit({ evento: dadosEvento, lotes: lotesAfetados });
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
              <Input
                value={formData.produto}
                onChange={(e) => setFormData({ ...formData, produto: e.target.value })}
                className="h-9 text-xs"
                placeholder="Ex: Sal Proteinado 18%"
                required
              />
            </div>
          </div>

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

          {formData.quantidade_total_kg && totalCabecas > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-xs font-semibold text-blue-900 mb-2">Cálculo Automático:</div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-blue-700">Consumo por cabeça:</span>
                  <span className="font-bold text-blue-900 ml-2">{consumoPorCabeca} kg</span>
                </div>
                <div>
                  <span className="text-blue-700">Total de cabeças:</span>
                  <span className="font-bold text-blue-900 ml-2">{totalCabecas}</span>
                </div>
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
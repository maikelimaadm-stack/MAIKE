import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";

export default function HistoricoSuplementacaoLote({ loteId, loteNome }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [periodoMeses, setPeriodoMeses] = useState("3");

  const { data: historico = [], isLoading } = useQuery({
    queryKey: ['suplementacao-lote', loteId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoLote.list();
      return all.filter(s => 
        s.empresa_id === empresaSelecionadaId && 
        s.lote_id === loteId
      ).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!loteId,
  });

  // Filtrar por período
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - parseInt(periodoMeses));
  
  const historicoFiltrado = historico.filter(h => 
    new Date(h.data_lancamento) >= dataLimite
  );

  // Dados para gráfico de consumo por cabeça ao longo do tempo
  const dadosGraficoConsumo = [...historicoFiltrado]
    .reverse()
    .map(h => ({
      data: new Date(h.data_lancamento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      consumo: parseFloat(h.consumo_por_cabeca_dia_kg || 0).toFixed(3),
      produto: h.produto
    }));

  // Dados para gráfico de consumo total por mês
  const consumoPorMes = historicoFiltrado.reduce((acc, h) => {
    const mes = new Date(h.data_lancamento).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    if (!acc[mes]) {
      acc[mes] = { mes, total: 0 };
    }
    acc[mes].total += (h.consumo_total_lote_periodo_kg || 0);
    return acc;
  }, {});

  const dadosGraficoMensal = Object.values(consumoPorMes).reverse();

  const consumoMedio = historicoFiltrado.length > 0
    ? (historicoFiltrado.reduce((sum, h) => sum + (h.consumo_por_cabeca_dia_kg || 0), 0) / historicoFiltrado.length).toFixed(3)
    : 0;

  const consumoTotal = historicoFiltrado.reduce((sum, h) => sum + (h.consumo_total_lote_periodo_kg || 0), 0).toFixed(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Histórico de Suplementação - {loteNome}</h3>
        <Select value={periodoMeses} onValueChange={setPeriodoMeses}>
          <SelectTrigger className="w-32 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1" className="text-xs">Último mês</SelectItem>
            <SelectItem value="3" className="text-xs">Últimos 3 meses</SelectItem>
            <SelectItem value="6" className="text-xs">Últimos 6 meses</SelectItem>
            <SelectItem value="12" className="text-xs">Último ano</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-slate-600">Lançamentos</div>
            <div className="text-2xl font-bold text-slate-900">{historicoFiltrado.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-slate-600">Consumo Médio</div>
            <div className="text-2xl font-bold text-slate-900">{consumoMedio} kg/cab</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-slate-600">Consumo Total</div>
            <div className="text-2xl font-bold text-slate-900">{consumoTotal} kg</div>
          </CardContent>
        </Card>
      </div>

      {historicoFiltrado.length > 0 && (
        <>
          <Card>
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-xs font-semibold">Consumo por Cabeça ao Longo do Tempo</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={dadosGraficoConsumo}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg/cab', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="consumo" stroke="#10b981" strokeWidth={2} name="Consumo (kg/cab)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-xs font-semibold">Consumo Total por Mês</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dadosGraficoMensal}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="total" fill="#10b981" name="Consumo Total (kg)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-xs font-semibold">Detalhamento dos Lançamentos</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-500">Carregando...</div>
          ) : historicoFiltrado.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">Nenhum lançamento encontrado</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {historicoFiltrado.map((item, index) => (
                <div key={index} className="border border-slate-200 rounded-lg p-3 bg-white hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{item.produto}</div>
                      <div className="text-xs text-slate-600">
                        {new Date(item.data_lancamento).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-800 text-xs">
                      {(item.consumo_por_cabeca_dia_kg || 0).toFixed(3)} kg/cab
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="text-slate-600">
                      Cabeças: <span className="font-semibold text-slate-900">{item.cabecas_na_area}</span>
                    </div>
                    <div className="text-slate-600">
                      Total lote: <span className="font-semibold text-slate-900">{(item.consumo_total_lote_periodo_kg || 0).toFixed(1)} kg</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
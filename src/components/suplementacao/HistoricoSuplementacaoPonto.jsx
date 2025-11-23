import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";

export default function HistoricoSuplementacaoPonto({ pontoId, pontoNome }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [periodoMeses, setPeriodoMeses] = useState("3");

  const { data: eventos = [], isLoading } = useQuery({
    queryKey: ['suplementacao-ponto', pontoId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter(e => 
        e.empresa_id === empresaSelecionadaId && 
        e.ponto_suplementacao_id === pontoId
      ).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!pontoId,
  });

  // Filtrar por período
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - parseInt(periodoMeses));
  
  const eventosFiltrados = eventos.filter(e => 
    new Date(e.data_lancamento) >= dataLimite
  );

  // Dados para gráficos
  const consumoPorMes = eventosFiltrados.reduce((acc, e) => {
    const mes = new Date(e.data_lancamento).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    if (!acc[mes]) {
      acc[mes] = { mes, total: 0, eventos: 0 };
    }
    acc[mes].total += e.quantidade_total_kg;
    acc[mes].eventos += 1;
    return acc;
  }, {});

  const dadosGraficoMensal = Object.values(consumoPorMes).reverse();

  const totalFornecido = eventosFiltrados.reduce((sum, e) => sum + e.quantidade_total_kg, 0).toFixed(1);
  const mediaPorEvento = eventosFiltrados.length > 0 
    ? (totalFornecido / eventosFiltrados.length).toFixed(1)
    : 0;
  
  const mediaPorCabeca = eventosFiltrados.length > 0
    ? (eventosFiltrados.reduce((sum, e) => sum + e.consumo_medio_por_cabeca_kg, 0) / eventosFiltrados.length).toFixed(3)
    : 0;

  const ultimaData = eventosFiltrados.length > 0 
    ? new Date(eventosFiltrados[0].data_lancamento).toLocaleDateString('pt-BR')
    : '-';

  // Calcular média diária
  const diasPeriodo = parseInt(periodoMeses) * 30;
  const mediaDiaria = (totalFornecido / diasPeriodo).toFixed(2);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Histórico de Fornecimento - {pontoNome}</h3>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-slate-600">Total Fornecido</div>
            <div className="text-xl font-bold text-slate-900">{totalFornecido} kg</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-slate-600">Média Diária</div>
            <div className="text-xl font-bold text-slate-900">{mediaDiaria} kg/dia</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-slate-600">Média por Cabeça</div>
            <div className="text-xl font-bold text-slate-900">{mediaPorCabeca} kg</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-slate-600">Última Data</div>
            <div className="text-xl font-bold text-slate-900">{ultimaData}</div>
          </CardContent>
        </Card>
      </div>

      {eventosFiltrados.length > 0 && (
        <Card>
          <CardHeader className="py-3 border-b">
            <CardTitle className="text-xs font-semibold">Consumo Acumulado Mensal</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={dadosGraficoMensal}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="total" fill="#10b981" name="Total Fornecido (kg)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3 border-b">
          <CardTitle className="text-xs font-semibold">Detalhamento dos Lançamentos</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-500">Carregando...</div>
          ) : eventosFiltrados.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">Nenhum lançamento encontrado</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {eventosFiltrados.map((evento, index) => (
                <div key={index} className="border border-slate-200 rounded-lg p-3 bg-white hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">{evento.produto}</div>
                      <div className="text-xs text-slate-600">
                        {new Date(evento.data_lancamento).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-800 text-xs">
                      {evento.quantidade_total_kg.toFixed(1)} kg
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="text-slate-600">
                      Cabeças: <span className="font-semibold text-slate-900">{evento.total_cabecas_afetadas}</span>
                    </div>
                    <div className="text-slate-600">
                      Por cabeça: <span className="font-semibold text-slate-900">{evento.consumo_medio_por_cabeca_kg.toFixed(3)} kg</span>
                    </div>
                  </div>
                  {evento.observacoes && (
                    <div className="mt-2 text-xs text-slate-600 italic">{evento.observacoes}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
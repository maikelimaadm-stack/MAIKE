import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { safeDivide } from "../utils/pecuariaUtils";

export default function AnaliseConsumo({ pontoId, pontoNome, ponto }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [periodoMeses, setPeriodoMeses] = useState("3");

  const { data: eventos = [] } = useQuery({
    queryKey: ['eventos-analise', pontoId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter(e => 
        e.empresa_id === empresaSelecionadaId && 
        e.ponto_suplementacao_id === pontoId
      ).sort((a, b) => new Date(a.data_lancamento) - new Date(b.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!pontoId,
  });

  // Filtrar por período
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - parseInt(periodoMeses));
  
  const eventosFiltrados = eventos.filter(e => 
    new Date(e.data_lancamento) >= dataLimite
  );

  // Análise de consumo
  const consumoIdeal = ponto?.consumo_ideal_por_cabeca_kg || 0;
  const limiteMin = ponto?.limite_minimo_consumo || 0;
  const limiteMax = ponto?.limite_maximo_consumo || 0;

  const analises = eventosFiltrados.map(e => {
    // Calcular consumo por cabeça/dia a partir dos dados do evento
    const consumoTotal = Math.max(0, (e.quantidade_total_kg || 0) - (e.sobra_kg || 0));
    const dias = Math.max(1, e.dias_periodo || 1);
    const cabecas = e.total_cabecas_afetadas || 1;
    const consumo = safeDivide(consumoTotal, dias * cabecas);

    let status = 'normal';
    let alerta = null;

    if (consumoIdeal > 0 && consumo > 0) {
      const variacao = ((consumo - consumoIdeal) / consumoIdeal) * 100;
      
      if (limiteMin > 0 && consumo < limiteMin) {
        status = 'baixo';
        alerta = `Consumo abaixo do limite mínimo (${limiteMin} kg/cab)`;
      } else if (limiteMax > 0 && consumo > limiteMax) {
        status = 'alto';
        alerta = `Consumo acima do limite máximo (${limiteMax} kg/cab)`;
      } else if (Math.abs(variacao) > 20) {
        status = variacao > 0 ? 'acima' : 'abaixo';
        alerta = `Variação de ${variacao.toFixed(0)}% em relação ao ideal`;
      }
    }

    return { ...e, consumo_calculado: consumo, status, alerta, variacao: consumo - consumoIdeal };
  });

  const consumosComProblema = analises.filter(a => a.status !== 'normal');
  const ultimosEventos = analises.slice(-10);

  // Dados para gráfico
  const dadosGrafico = ultimosEventos.map(e => ({
    data: new Date(e.data_lancamento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    consumo: parseFloat(e.consumo_calculado || 0).toFixed(3),
    ideal: consumoIdeal,
    minimo: limiteMin,
    maximo: limiteMax
  }));

  // Estatísticas
  const consumoMedio = analises.length > 0
    ? analises.reduce((sum, e) => sum + (e.consumo_calculado || 0), 0) / analises.length
    : 0;

  const desvio = consumoIdeal > 0 ? ((consumoMedio - consumoIdeal) / consumoIdeal) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Análise Inteligente de Consumo - {pontoNome}</h3>
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

      {consumoIdeal > 0 ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-slate-600">Consumo Ideal</div>
                <div className="text-xl font-bold text-emerald-600">{consumoIdeal.toFixed(3)} kg</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-slate-600">Consumo Médio</div>
                <div className="text-xl font-bold text-slate-900">{consumoMedio.toFixed(3)} kg</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-slate-600">Desvio do Ideal</div>
                <div className={`text-xl font-bold ${Math.abs(desvio) > 20 ? 'text-amber-600' : 'text-slate-900'}`}>
                  {desvio > 0 ? '+' : ''}{desvio.toFixed(0)}%
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3">
                <div className="text-xs text-slate-600">Alertas</div>
                <div className="text-xl font-bold text-red-600">{consumosComProblema.length}</div>
              </CardContent>
            </Card>
          </div>

          {consumosComProblema.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="py-3 border-b border-amber-200">
                <CardTitle className="text-xs font-semibold text-amber-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Consumos Irregulares Detectados ({consumosComProblema.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {consumosComProblema.slice(-5).reverse().map((evento, index) => (
                    <div key={index} className="bg-white border border-amber-200 rounded-lg p-2">
                      <div className="flex items-start justify-between mb-1">
                        <div className="text-xs font-semibold text-slate-900">
                          {new Date(evento.data_lancamento).toLocaleDateString('pt-BR')}
                        </div>
                        <Badge className={`text-xs ${
                          evento.status === 'baixo' ? 'bg-red-100 text-red-800' :
                          evento.status === 'alto' ? 'bg-orange-100 text-orange-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {(evento.consumo_calculado || 0).toFixed(3)} kg/cab
                        </Badge>
                      </div>
                      <div className="text-xs text-amber-700">
                        {evento.alerta}
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        Total: {evento.quantidade_total_kg.toFixed(1)} kg • {evento.total_cabecas_afetadas} cabeças
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-xs font-semibold">Evolução do Consumo vs. Ideal</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dadosGrafico}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg/cab', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="consumo" stroke="#10b981" strokeWidth={2} name="Consumo Real" />
                  <Line type="monotone" dataKey="ideal" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 5" name="Consumo Ideal" />
                  {limiteMin > 0 && (
                    <Line type="monotone" dataKey="minimo" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" name="Limite Mínimo" />
                  )}
                  {limiteMax > 0 && (
                    <Line type="monotone" dataKey="maximo" stroke="#f97316" strokeWidth={1} strokeDasharray="3 3" name="Limite Máximo" />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-xs font-semibold">Recomendações</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="space-y-2">
                {desvio > 20 && (
                  <div className="flex items-start gap-2 text-xs">
                    <TrendingUp className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-slate-900">Consumo acima do ideal</div>
                      <div className="text-slate-600">
                        Considere reduzir a quantidade fornecida ou aumentar a frequência de abastecimento para evitar desperdício.
                      </div>
                    </div>
                  </div>
                )}
                {desvio < -20 && (
                  <div className="flex items-start gap-2 text-xs">
                    <TrendingDown className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-slate-900">Consumo abaixo do ideal</div>
                      <div className="text-slate-600">
                        Verifique a palatabilidade do suplemento, condição dos cochos e disponibilidade de água. Pode indicar problemas sanitários.
                      </div>
                    </div>
                  </div>
                )}
                {Math.abs(desvio) <= 20 && (
                  <div className="flex items-start gap-2 text-xs">
                    <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-slate-900">Consumo dentro do esperado</div>
                      <div className="text-slate-600">
                        O consumo médio está próximo do ideal. Continue monitorando para manter a eficiência.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <div className="text-sm font-semibold text-slate-900 mb-1">
              Configure os parâmetros de consumo
            </div>
            <div className="text-xs text-slate-600">
              Para habilitar a análise inteligente, defina o consumo ideal e os limites mínimo/máximo nas configurações do ponto.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
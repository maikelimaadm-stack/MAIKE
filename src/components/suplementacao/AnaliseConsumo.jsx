import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { formatDecimal, safeDivide } from "../utils/pecuariaUtils";

export default function AnaliseConsumo({ pontoId, pontoNome, ponto }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [periodoMeses, setPeriodoMeses] = useState("3");

  const { data: eventos = [] } = useQuery({
    queryKey: ['eventos-analise', empresaSelecionadaId, pontoId],
    queryFn: async () => {
      const filtrados = await base44.entities.SuplementacaoEvento.filter({
        empresa_id: empresaSelecionadaId,
        ponto_suplementacao_id: pontoId,
      }, '-data_lancamento', 200);
      return [...filtrados].sort((a, b) => new Date(a.data_lancamento) - new Date(b.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!pontoId,
  });

  const dataLimite = useMemo(() => {
    const limite = new Date();
    limite.setMonth(limite.getMonth() - parseInt(periodoMeses, 10));
    return limite;
  }, [periodoMeses]);

  const eventosFiltrados = eventos.filter((evento) => new Date(evento.data_lancamento) >= dataLimite);
  const consumoIdeal = ponto?.consumo_ideal_por_cabeca_kg || 0;
  const limiteMin = ponto?.limite_minimo_consumo || 0;
  const limiteMax = ponto?.limite_maximo_consumo || 0;

  const analises = eventosFiltrados.map((evento) => {
    const dias = Math.max(1, evento.dias_periodo || 1);
    const cabecas = Number(evento.total_cabecas_afetadas || 0);
    const inconsistente = cabecas <= 0;
    const consumoCalculado = inconsistente
      ? 0
      : evento.consumo_diario_grupo_kg != null
        ? safeDivide(evento.consumo_diario_grupo_kg, cabecas)
        : safeDivide(Math.max(0, Number(evento.quantidade_total_kg || 0) - Number(evento.sobra_kg || 0)), dias * cabecas);

    const animalDias = inconsistente ? 0 : cabecas * dias;
    const consumoAcumulado = consumoCalculado * animalDias;

    let status = 'normal';
    let alerta = null;
    if (inconsistente) {
      status = 'inconsistente';
      alerta = 'Evento com cabeças zeradas ou inválidas.';
    } else if (limiteMin > 0 && consumoCalculado < limiteMin) {
      status = 'baixo';
      alerta = `Consumo abaixo do mínimo (${formatDecimal(limiteMin, 3)} kg/cab/dia).`;
    } else if (limiteMax > 0 && consumoCalculado > limiteMax) {
      status = 'alto';
      alerta = `Consumo acima do máximo (${formatDecimal(limiteMax, 3)} kg/cab/dia).`;
    } else if (consumoIdeal > 0) {
      const desvioPct = safeDivide(consumoCalculado - consumoIdeal, consumoIdeal) * 100;
      if (Math.abs(desvioPct) > 20) {
        status = desvioPct > 0 ? 'acima' : 'abaixo';
        alerta = `Desvio de ${formatDecimal(Math.abs(desvioPct), 0, true)}% em relação ao ideal.`;
      }
    }

    return {
      ...evento,
      dias,
      cabecas,
      animalDias,
      consumo_calculado: consumoCalculado,
      consumo_acumulado: consumoAcumulado,
      status,
      alerta,
      inconsistente,
    };
  });

  const eventosValidos = analises.filter((item) => !item.inconsistente && item.animalDias > 0);
  const consumosComProblema = analises.filter((item) => item.status !== 'normal');
  const totalAnimalDias = eventosValidos.reduce((sum, item) => sum + item.animalDias, 0);
  const totalConsumo = eventosValidos.reduce((sum, item) => sum + item.consumo_acumulado, 0);
  const consumoMedio = safeDivide(totalConsumo, totalAnimalDias);
  const desvio = consumoIdeal > 0 ? safeDivide(consumoMedio - consumoIdeal, consumoIdeal) * 100 : 0;

  const resumoPeriodo = (diasJanela) => {
    const limite = new Date();
    limite.setDate(limite.getDate() - diasJanela);
    const itens = eventosValidos.filter((item) => new Date(item.data_lancamento) >= limite);
    const animalDiasJanela = itens.reduce((sum, item) => sum + item.animalDias, 0);
    const consumoJanela = itens.reduce((sum, item) => sum + item.consumo_acumulado, 0);
    return {
      acumulado: consumoJanela,
      medio: safeDivide(consumoJanela, animalDiasJanela),
    };
  };

  const periodo7 = resumoPeriodo(7);
  const periodo15 = resumoPeriodo(15);
  const periodo30 = resumoPeriodo(30);

  const ultimosValidos = eventosValidos.slice(-6);
  const mediaAtual = ultimosValidos.slice(-3).reduce((sum, item) => sum + item.consumo_calculado, 0) / Math.max(1, ultimosValidos.slice(-3).length);
  const mediaAnterior = ultimosValidos.slice(0, -3).reduce((sum, item) => sum + item.consumo_calculado, 0) / Math.max(1, ultimosValidos.slice(0, -3).length);
  const deltaTendencia = mediaAtual - mediaAnterior;
  const tendencia = ultimosValidos.length < 4 || Math.abs(deltaTendencia) < 0.005 ? 'estavel' : deltaTendencia > 0 ? 'subindo' : 'caindo';

  const dadosGrafico = analises.slice(-10).map((item) => ({
    data: new Date(item.data_lancamento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    consumo: Number(item.consumo_calculado || 0),
    ideal: consumoIdeal,
    minimo: limiteMin,
    maximo: limiteMax,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Análise Inteligente de Consumo - {pontoNome}</h3>
        <Select value={periodoMeses} onValueChange={setPeriodoMeses}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Consumo Ideal</div><div className="text-xl font-bold text-emerald-600">{formatDecimal(consumoIdeal, 3)}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Médio Ponderado</div><div className="text-xl font-bold text-slate-900">{formatDecimal(consumoMedio, 3)}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Desvio</div><div className={`text-xl font-bold ${Math.abs(desvio) > 20 ? 'text-amber-600' : 'text-slate-900'}`}>{desvio > 0 ? '+' : ''}{formatDecimal(desvio, 0, true)}%</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Tendência</div><div className={`text-xl font-bold ${tendencia === 'subindo' ? 'text-orange-600' : tendencia === 'caindo' ? 'text-red-600' : 'text-emerald-600'}`}>{tendencia === 'subindo' ? 'Alta' : tendencia === 'caindo' ? 'Queda' : 'Estável'}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Alertas</div><div className="text-xl font-bold text-red-600">{consumosComProblema.length}</div></CardContent></Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Acumulado 7 dias</div><div className="text-lg font-bold text-slate-900">{formatDecimal(periodo7.acumulado)} kg</div><div className="text-[10px] text-slate-500">Média {formatDecimal(periodo7.medio, 3)} kg/cab/dia</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Acumulado 15 dias</div><div className="text-lg font-bold text-slate-900">{formatDecimal(periodo15.acumulado)} kg</div><div className="text-[10px] text-slate-500">Média {formatDecimal(periodo15.medio, 3)} kg/cab/dia</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Acumulado 30 dias</div><div className="text-lg font-bold text-slate-900">{formatDecimal(periodo30.acumulado)} kg</div><div className="text-[10px] text-slate-500">Média {formatDecimal(periodo30.medio, 3)} kg/cab/dia</div></CardContent></Card>
          </div>

          {consumosComProblema.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="py-3 border-b border-amber-200"><CardTitle className="text-xs font-semibold text-amber-900 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Eventos com alerta ({consumosComProblema.length})</CardTitle></CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {consumosComProblema.slice(-6).reverse().map((evento) => (
                    <div key={evento.id} className="bg-white border border-amber-200 rounded-lg p-2">
                      <div className="flex items-start justify-between mb-1">
                        <div className="text-xs font-semibold text-slate-900">{new Date(evento.data_lancamento).toLocaleDateString('pt-BR')}</div>
                        <Badge className={`text-xs ${evento.status === 'inconsistente' ? 'bg-red-100 text-red-800' : evento.status === 'alto' || evento.status === 'acima' ? 'bg-orange-100 text-orange-800' : 'bg-amber-100 text-amber-800'}`}>{formatDecimal(evento.consumo_calculado, 3)} kg/cab</Badge>
                      </div>
                      <div className="text-xs text-amber-700">{evento.alerta}</div>
                      <div className="text-xs text-slate-600 mt-1">Total: {formatDecimal(evento.quantidade_total_kg || 0)} kg • {formatDecimal(evento.total_cabecas_afetadas || 0, 0, true)} cabeças</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Evolução do Consumo vs. Ideal</CardTitle></CardHeader>
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
                  {limiteMin > 0 && <Line type="monotone" dataKey="minimo" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" name="Limite Mínimo" />}
                  {limiteMax > 0 && <Line type="monotone" dataKey="maximo" stroke="#f97316" strokeWidth={1} strokeDasharray="3 3" name="Limite Máximo" />}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Leitura técnica</CardTitle></CardHeader>
            <CardContent className="p-3 space-y-2 text-xs">
              {tendencia === 'subindo' && <div className="flex items-start gap-2"><TrendingUp className="w-4 h-4 text-orange-500 mt-0.5" /><div><div className="font-semibold text-slate-900">Tendência de alta</div><div className="text-slate-600">Verifique excesso de oferta, desperdício ou mudança no manejo do cocho.</div></div></div>}
              {tendencia === 'caindo' && <div className="flex items-start gap-2"><TrendingDown className="w-4 h-4 text-red-500 mt-0.5" /><div><div className="font-semibold text-slate-900">Tendência de queda</div><div className="text-slate-600">Verifique palatabilidade, falha de abastecimento, acesso ao cocho e disponibilidade de água.</div></div></div>}
              {tendencia === 'estavel' && <div className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 mt-0.5" /><div><div className="font-semibold text-slate-900">Tendência estável</div><div className="text-slate-600">O consumo está estável no período recente, mantendo melhor previsibilidade operacional.</div></div></div>}
              {analises.some((item) => item.inconsistente) && <div className="flex items-start gap-2"><AlertCircle className="w-4 h-4 text-red-500 mt-0.5" /><div><div className="font-semibold text-slate-900">Existem eventos inconsistentes</div><div className="text-slate-600">Há registros com cabeças zeradas ou inválidas que não devem ser usados como base gerencial.</div></div></div>}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <div className="text-sm font-semibold text-slate-900 mb-1">Configure os parâmetros de consumo</div>
            <div className="text-xs text-slate-600">Para habilitar a análise inteligente, defina o consumo ideal e os limites mínimo/máximo nas configurações do ponto.</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
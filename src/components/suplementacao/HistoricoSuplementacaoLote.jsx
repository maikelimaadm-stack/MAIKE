import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from "recharts";
import { formatDateBR } from "../utils/pecuariaUtils";
import { formatConsumoGramasCabDia, formatConsumoKgCabDia, formatQuantidadeTecnica } from "./formatters";
import { calcularResumoHistorico, filtrarHistoricoPorMeses, montarSerieConsumoDiario, montarSerieMensal } from "./suplementacaoResumoUtils";
function DesvioIndicador({ real, esperado }) {
  if (!esperado || esperado <= 0 || !real) return <span className="text-slate-400">-</span>;
  const desvio = ((real - esperado) / esperado) * 100;
  return (
    <div className="inline-flex items-center px-1.5 py-0.5 rounded border border-slate-300 bg-slate-100 text-[10px] font-semibold text-slate-700">
      {desvio > 0 ? "+" : ""}{desvio.toFixed(0)}%
    </div>
  );
}

export default function HistoricoSuplementacaoLote({ loteId, loteNome }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [periodoMeses, setPeriodoMeses] = useState("3");

  const { data: historico = [], isLoading } = useQuery({
    queryKey: ['suplementacao-lote', empresaSelecionadaId, loteId],
    queryFn: async () => {
      return await base44.entities.SuplementacaoLote.filter({
        empresa_id: empresaSelecionadaId,
        lote_id: loteId,
      }, '-data_lancamento', 300);
    },
    enabled: !!empresaSelecionadaId && !!loteId,
  });

  const historicoFiltrado = useMemo(() => filtrarHistoricoPorMeses(historico, periodoMeses), [historico, periodoMeses]);
  const resumo = useMemo(() => calcularResumoHistorico(historicoFiltrado), [historicoFiltrado]);
  const dadosGraficoConsumo = useMemo(() => montarSerieConsumoDiario(historicoFiltrado), [historicoFiltrado]);
  const dadosGraficoMensal = useMemo(() => montarSerieMensal(historicoFiltrado), [historicoFiltrado]);

  // Enriquecer dados do gráfico com consumo esperado (quando disponível)
  const dadosGraficoComEsperado = useMemo(() => {
    return dadosGraficoConsumo.map((item) => {
      const registro = historicoFiltrado.find(h => {
        const dt = new Date(h.data_lancamento).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
        return dt === item.data;
      });
      const esperado = registro?.consumo_esperado_pv_lote_kg && registro?.cabecas_na_area > 0
        ? registro.consumo_esperado_pv_lote_kg / registro.cabecas_na_area
        : 0;
      return { ...item, esperado: esperado > 0 ? esperado : undefined };
    });
  }, [dadosGraficoConsumo, historicoFiltrado]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Histórico de Suplementação - {loteNome}</h3>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Lançamentos</div><div className="text-2xl font-bold text-slate-900">{resumo.lancamentos}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Períodos fechados</div><div className="text-2xl font-bold text-slate-900">{resumo.periodosValidos}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Média kg/cab/dia</div><div className="text-xl font-bold text-slate-900">{formatConsumoKgCabDia(resumo.consumoMedioKgCabDia)}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Média g/cab/dia</div><div className="text-xl font-bold text-slate-900">{formatConsumoGramasCabDia(resumo.consumoMedioKgCabDia)} g</div></CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2"><CardContent className="p-3"><div className="text-xs text-slate-600">Consumo total do período</div><div className="text-2xl font-bold text-slate-900">{formatQuantidadeTecnica(resumo.consumoTotalKg, 1)} kg</div><div className="text-[10px] text-slate-500">Último lançamento: {resumo.ultimoLancamento ? formatDateBR(resumo.ultimoLancamento.data_lancamento) : '-'}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Último produto</div><div className="text-sm font-bold text-slate-900 break-words">{resumo.ultimoLancamento?.produto || '-'}</div></CardContent></Card>
      </div>

      {historicoFiltrado.length > 0 && (
        <>
          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Consumo Real vs. Esperado</CardTitle></CardHeader>
            <CardContent className="p-3">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={dadosGraficoComEsperado}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg/cab/dia', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(value, name) => [`${Number(value).toFixed(3)} kg/cab/dia`, name]} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="consumo" stroke="#10b981" strokeWidth={2} name="Consumo Real" />
                  <Line type="monotone" dataKey="esperado" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" name="Esperado (%PV)" connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Consumo total por mês</CardTitle></CardHeader>
              <CardContent className="p-3">
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={dadosGraficoMensal}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(value) => [`${formatQuantidadeTecnica(value, 1)} kg`, 'Total']} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="totalKg" fill="#10b981" name="Consumo Total (kg)" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Produtos mais usados</CardTitle></CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {resumo.consumoPorProduto.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500">Sem períodos fechados.</div>
                  ) : resumo.consumoPorProduto.map((item) => (
                    <div key={item.produto} className="border border-slate-200 rounded-lg p-2 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 break-words">{item.produto}</div>
                          <div className="text-[10px] text-slate-500">{item.lancamentos} lançamento(s)</div>
                        </div>
                        <Badge variant="outline" className="text-xs">{formatQuantidadeTecnica(item.totalKg, 1)} kg</Badge>
                      </div>
                      <div className="text-[10px] text-slate-600 mt-1">Média: {formatConsumoKgCabDia(item.mediaKgCabDia)} kg/cab/dia</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Detalhamento dos lançamentos</CardTitle></CardHeader>
        <CardContent className="p-3">
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-500">Carregando...</div>
          ) : historicoFiltrado.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">Nenhum lançamento encontrado</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {historicoFiltrado.map((item) => {
                const periodoFechado = (item.dias_periodo || 0) > 0;
                const consumoReal = item.consumo_por_cabeca_dia_kg || 0;
                const consumoEsperado = item.consumo_esperado_pv_lote_kg && item.cabecas_na_area > 0
                  ? item.consumo_esperado_pv_lote_kg / item.cabecas_na_area
                  : 0;
                const pesoMedio = item.peso_medio_lote_kg || 0;

                return (
                  <div key={item.id} className="border border-slate-200 rounded-lg p-3 bg-white hover:bg-slate-50 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-900">{item.produto}</div>
                        <div className="text-[10px] text-slate-500">{formatDateBR(item.data_lancamento)}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {periodoFechado && consumoEsperado > 0 && (
                          <DesvioIndicador real={consumoReal} esperado={consumoEsperado} />
                        )}
                        <Badge className={`text-[10px] ${periodoFechado ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                          {periodoFechado ? 'Fechado' : 'Em aberto'}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-[10px]">
                      <div className="rounded border border-slate-100 bg-slate-50 p-1.5">
                        <div className="text-slate-500">Cabeças</div>
                        <div className="font-bold text-slate-900">{formatQuantidadeTecnica(item.cabecas_na_area || 0, 0)}</div>
                      </div>
                      <div className="rounded border border-slate-100 bg-slate-50 p-1.5">
                        <div className="text-slate-500">Dias</div>
                        <div className="font-bold text-slate-900">{formatQuantidadeTecnica(item.dias_periodo || 0, 0)}</div>
                      </div>
                      <div className="rounded border border-slate-100 bg-slate-50 p-1.5">
                        <div className="text-slate-500">Peso médio</div>
                        <div className="font-bold text-slate-900">{pesoMedio > 0 ? `${formatQuantidadeTecnica(pesoMedio, 0)} kg` : '-'}</div>
                      </div>
                      <div className="rounded border border-emerald-100 bg-emerald-50 p-1.5">
                        <div className="text-emerald-700">Realizado</div>
                        <div className="font-bold text-emerald-900">{periodoFechado ? `${formatConsumoKgCabDia(consumoReal)} kg` : '-'}</div>
                      </div>
                      <div className="rounded border border-indigo-100 bg-indigo-50 p-1.5">
                        <div className="text-indigo-700">Esperado (%PV)</div>
                        <div className="font-bold text-indigo-900">{consumoEsperado > 0 ? `${consumoEsperado.toFixed(3)} kg` : '-'}</div>
                      </div>
                      <div className="rounded border border-slate-100 bg-slate-50 p-1.5">
                        <div className="text-slate-500">Total lote</div>
                        <div className="font-bold text-slate-900">{formatQuantidadeTecnica(item.consumo_total_lote_periodo_kg || 0, 1)} kg</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
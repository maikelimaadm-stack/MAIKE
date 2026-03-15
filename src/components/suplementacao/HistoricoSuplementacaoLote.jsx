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

export default function HistoricoSuplementacaoLote({ loteId, loteNome }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [periodoMeses, setPeriodoMeses] = useState("3");

  const { data: historico = [], isLoading } = useQuery({
    queryKey: ['suplementacao-lote', empresaSelecionadaId, loteId],
    queryFn: async () => {
      const registros = await base44.entities.SuplementacaoLote.filter({
        empresa_id: empresaSelecionadaId,
        lote_id: loteId,
      }, '-data_lancamento', 300);
      return registros;
    },
    enabled: !!empresaSelecionadaId && !!loteId,
  });

  const historicoFiltrado = useMemo(() => filtrarHistoricoPorMeses(historico, periodoMeses), [historico, periodoMeses]);
  const resumo = useMemo(() => calcularResumoHistorico(historicoFiltrado), [historicoFiltrado]);
  const dadosGraficoConsumo = useMemo(() => montarSerieConsumoDiario(historicoFiltrado), [historicoFiltrado]);
  const dadosGraficoMensal = useMemo(() => montarSerieMensal(historicoFiltrado), [historicoFiltrado]);

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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Lançamentos</div><div className="text-2xl font-bold text-slate-900">{resumo.lancamentos}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Períodos válidos</div><div className="text-2xl font-bold text-slate-900">{resumo.periodosValidos}</div></CardContent></Card>
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
            <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Consumo por cabeça ao longo do tempo</CardTitle></CardHeader>
            <CardContent className="p-3">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={dadosGraficoConsumo}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg/cab/dia', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(value) => [`${formatConsumoKgCabDia(value)} kg/cab/dia`, 'Consumo']} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="consumo" stroke="#10b981" strokeWidth={2} name="Consumo (kg/cab/dia)" />
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
              <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Produtos mais usados no período</CardTitle></CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {resumo.consumoPorProduto.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500">Sem períodos fechados para consolidar.</div>
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
                return (
                  <div key={item.id} className="border border-slate-200 rounded-lg p-3 bg-white hover:bg-slate-50 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-900">{item.produto}</div>
                        <div className="text-xs text-slate-600">{formatDateBR(item.data_lancamento)}</div>
                      </div>
                      <Badge className={`text-xs ${periodoFechado ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {periodoFechado ? `${formatConsumoKgCabDia(item.consumo_por_cabeca_dia_kg)} kg/cab/dia` : 'Período em aberto'}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                      <div className="text-slate-600">Cabeças: <span className="font-semibold text-slate-900">{formatQuantidadeTecnica(item.cabecas_na_area || 0, 0)}</span></div>
                      <div className="text-slate-600">Dias: <span className="font-semibold text-slate-900">{formatQuantidadeTecnica(item.dias_periodo || 0, 0)}</span></div>
                      <div className="text-slate-600">Total lote: <span className="font-semibold text-slate-900">{formatQuantidadeTecnica(item.consumo_total_lote_periodo_kg || 0, 1)} kg</span></div>
                      <div className="text-slate-600">Fator: <span className="font-semibold text-slate-900">{formatQuantidadeTecnica(item.fator_consumo || 0, 2)}</span></div>
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
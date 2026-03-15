import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle, TrendingUp, TrendingDown, AlertCircle, Target } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { safeDivide } from "../utils/pecuariaUtils";
import { formatDecimal } from "./formatters";
import { consumoEsperadoPorCabecaDia, pesoMedioPonderadoLotes } from "./consumoPVUtils";

export default function AnaliseConsumo({ pontoId, pontoNome, ponto }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [periodoMeses, setPeriodoMeses] = useState("3");

  const { data: eventos = [] } = useQuery({
    queryKey: ['eventos-analise', empresaSelecionadaId, pontoId, periodoMeses],
    queryFn: async () => {
      const filtrados = await base44.entities.SuplementacaoEvento.filter({
        empresa_id: empresaSelecionadaId,
        ponto_suplementacao_id: pontoId,
      }, '-data_lancamento', 200);
      return [...filtrados].sort((a, b) => new Date(a.data_lancamento) - new Date(b.data_lancamento));
    },
    enabled: !!empresaSelecionadaId && !!pontoId,
  });

  // Busca produto para obter %PV
  const { data: produtoRef = null } = useQuery({
    queryKey: ['produto-ponto-analise', empresaSelecionadaId, ponto?.produto_padrao],
    queryFn: async () => {
      if (!ponto?.produto_padrao) return null;
      const all = await base44.entities.Produto.list();
      const normalizeText = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
      return all.find(p => p.empresa_id === empresaSelecionadaId && normalizeText(p.nome_produto) === normalizeText(ponto.produto_padrao)) || null;
    },
    enabled: !!empresaSelecionadaId && !!ponto?.produto_padrao,
  });

  // Busca lotes atuais para peso médio
  const { data: lotesAtuais = [] } = useQuery({
    queryKey: ['lotes-analise', empresaSelecionadaId, ponto?.area_vinculada_ids?.join("|") || ponto?.area_vinculada_id],
    queryFn: async () => {
      const areaIds = Array.isArray(ponto?.area_vinculada_ids) ? ponto.area_vinculada_ids.filter(Boolean) : (ponto?.area_vinculada_id ? [ponto.area_vinculada_id] : []);
      if (!areaIds.length) return [];
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && areaIds.includes(l.area_atual_id) && l.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId && !!ponto,
  });

  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - parseInt(periodoMeses));
  const eventosFiltrados = eventos.filter((evento) => new Date(evento.data_lancamento) >= dataLimite);

  // Parâmetros de referência
  const consumoIdeal = ponto?.consumo_ideal_por_cabeca_kg || 0;
  const limiteMin = ponto?.limite_minimo_consumo || 0;
  const limiteMax = ponto?.limite_maximo_consumo || 0;
  const pctPV = Number(produtoRef?.percentual_consumo_pv || 0);
  const pesoMedio = pesoMedioPonderadoLotes(lotesAtuais);
  const consumoEsperadoPV = pctPV > 0 && pesoMedio > 0 ? consumoEsperadoPorCabecaDia(pesoMedio, pctPV) : 0;
  const referencia = consumoEsperadoPV > 0 ? consumoEsperadoPV : consumoIdeal;

  const analises = eventosFiltrados.map((evento) => {
    const dias = Math.max(1, evento.dias_periodo || 1);
    const cabecas = Number(evento.total_cabecas_afetadas || 0);
    const inconsistente = cabecas <= 0;
    const consumoCalculado = inconsistente
      ? 0
      : evento.consumo_diario_grupo_kg != null
        ? safeDivide(evento.consumo_diario_grupo_kg, cabecas)
        : safeDivide(Math.max(0, Number(evento.quantidade_total_kg || 0) - Number(evento.sobra_kg || 0)), dias * cabecas);

    const diferencaRef = referencia > 0 ? ((consumoCalculado - referencia) / referencia) * 100 : 0;

    let status = 'normal';
    let alerta = null;

    if (inconsistente) {
      status = 'inconsistente';
      alerta = 'Evento com cabeças zeradas ou inválidas.';
    } else if (limiteMin > 0 && consumoCalculado < limiteMin) {
      status = 'baixo';
      alerta = `Consumo abaixo do limite mínimo (${limiteMin.toFixed(3)} kg/cab/dia).`;
    } else if (limiteMax > 0 && consumoCalculado > limiteMax) {
      status = 'alto';
      alerta = `Consumo acima do limite máximo (${limiteMax.toFixed(3)} kg/cab/dia).`;
    } else if (referencia > 0) {
      if (Math.abs(diferencaRef) > 20) {
        status = diferencaRef > 0 ? 'acima' : 'abaixo';
        alerta = `Variação de ${diferencaRef.toFixed(0)}% em relação ao esperado (${referencia.toFixed(3)} kg/cab/dia).`;
      }
    }

    return {
      ...evento,
      dias,
      cabecas,
      inconsistente,
      consumo_calculado: consumoCalculado,
      consumo_esperado: referencia,
      diferenca_percentual: diferencaRef,
      consumo_total_periodo: consumoCalculado * cabecas * dias,
      status,
      alerta,
    };
  });

  const analisesValidas = analises.filter((item) => !item.inconsistente);
  const consumosComProblema = analises.filter((item) => item.status !== 'normal');
  const ultimosEventos = analises.slice(-10);
  const totalAnimalDias = analisesValidas.reduce((sum, item) => sum + (item.cabecas * item.dias), 0);
  const consumoMedio = totalAnimalDias > 0
    ? analisesValidas.reduce((sum, item) => sum + item.consumo_total_periodo, 0) / totalAnimalDias
    : 0;
  const desvio = referencia > 0 ? ((consumoMedio - referencia) / referencia) * 100 : 0;

  const consumoAcumulado = (diasJanela) => {
    const limite = new Date();
    limite.setDate(limite.getDate() - diasJanela);
    const janela = analisesValidas.filter((item) => new Date(item.data_lancamento) >= limite);
    return {
      total: janela.reduce((sum, item) => sum + item.consumo_total_periodo, 0),
      medio: (() => {
        const animalDias = janela.reduce((sum, item) => sum + (item.cabecas * item.dias), 0);
        return animalDias > 0 ? janela.reduce((sum, item) => sum + item.consumo_total_periodo, 0) / animalDias : 0;
      })(),
    };
  };

  const acumulado7 = consumoAcumulado(7);
  const acumulado15 = consumoAcumulado(15);
  const acumulado30 = consumoAcumulado(30);

  const tendencia = (() => {
    const base = analisesValidas.slice(-6);
    if (base.length < 4) return { label: 'Estável', color: 'text-slate-700', icon: CheckCircle };
    const metade = Math.floor(base.length / 2);
    const mediaAnterior = base.slice(0, metade).reduce((sum, item) => sum + item.consumo_calculado, 0) / metade;
    const mediaAtual = base.slice(metade).reduce((sum, item) => sum + item.consumo_calculado, 0) / (base.length - metade);
    const variacao = mediaAnterior > 0 ? ((mediaAtual - mediaAnterior) / mediaAnterior) * 100 : 0;
    if (variacao > 5) return { label: 'Aumentando', color: 'text-orange-600', icon: TrendingUp };
    if (variacao < -5) return { label: 'Diminuindo', color: 'text-red-600', icon: TrendingDown };
    return { label: 'Estável', color: 'text-emerald-600', icon: CheckCircle };
  })();

  const TendenciaIcon = tendencia.icon;
  const dadosGrafico = ultimosEventos.map((evento) => ({
    data: new Date(evento.data_lancamento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    consumo: Number(evento.consumo_calculado || 0),
    esperado: referencia,
    minimo: limiteMin,
    maximo: limiteMax,
  }));

  const temReferencia = referencia > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
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

      {/* Info de referência %PV */}
      {consumoEsperadoPV > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 flex items-center gap-3 text-xs">
          <Target className="w-4 h-4 text-indigo-600 flex-shrink-0" />
          <div className="text-indigo-800">
            <span className="font-semibold">Referência %PV:</span> {produtoRef?.nome_produto} • {formatDecimal(pctPV, 3)}% PV • Peso médio: {formatDecimal(pesoMedio, 1)} kg • Esperado: <span className="font-bold">{formatDecimal(consumoEsperadoPV, 3)} kg/cab/dia</span>
          </div>
        </div>
      )}

      {temReferencia ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">{consumoEsperadoPV > 0 ? "Esperado (%PV)" : "Consumo Ideal"}</div><div className="text-xl font-bold text-emerald-600">{referencia.toFixed(3)} kg</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Médio Ponderado</div><div className="text-xl font-bold text-slate-900">{consumoMedio.toFixed(3)} kg</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Desvio</div><div className={`text-xl font-bold ${Math.abs(desvio) > 20 ? 'text-amber-600' : 'text-slate-900'}`}>{desvio > 0 ? '+' : ''}{desvio.toFixed(0)}%</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Alertas</div><div className="text-xl font-bold text-red-600">{consumosComProblema.length}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Inconsistências</div><div className="text-xl font-bold text-red-700">{analises.filter((item) => item.inconsistente).length}</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Tendência</div><div className={`text-sm font-bold flex items-center gap-1 ${tendencia.color}`}><TendenciaIcon className="w-4 h-4" />{tendencia.label}</div></CardContent></Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Acumulado 7 dias</div><div className="text-lg font-bold text-slate-900">{acumulado7.total.toFixed(1)} kg</div><div className="text-[10px] text-slate-500">Médio: {acumulado7.medio.toFixed(3)} kg/cab/dia</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Acumulado 15 dias</div><div className="text-lg font-bold text-slate-900">{acumulado15.total.toFixed(1)} kg</div><div className="text-[10px] text-slate-500">Médio: {acumulado15.medio.toFixed(3)} kg/cab/dia</div></CardContent></Card>
            <Card><CardContent className="p-3"><div className="text-xs text-slate-600">Acumulado 30 dias</div><div className="text-lg font-bold text-slate-900">{acumulado30.total.toFixed(1)} kg</div><div className="text-[10px] text-slate-500">Médio: {acumulado30.medio.toFixed(3)} kg/cab/dia</div></CardContent></Card>
          </div>

          {consumosComProblema.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="py-3 border-b border-amber-200">
                <CardTitle className="text-xs font-semibold text-amber-900 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Alertas e inconsistências ({consumosComProblema.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {consumosComProblema.slice(-6).reverse().map((evento, index) => (
                    <div key={index} className="bg-white border border-amber-200 rounded-lg p-2">
                      <div className="flex items-start justify-between mb-1 gap-2">
                        <div className="text-xs font-semibold text-slate-900">{new Date(evento.data_lancamento).toLocaleDateString('pt-BR')}</div>
                        <div className="flex items-center gap-1">
                          <Badge className={`text-xs ${evento.status === 'inconsistente' ? 'bg-red-100 text-red-800' : evento.status === 'baixo' ? 'bg-amber-100 text-amber-800' : evento.status === 'alto' ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'}`}>
                            {evento.inconsistente ? 'Inconsistente' : `${(evento.consumo_calculado || 0).toFixed(3)} kg/cab`}
                          </Badge>
                          {!evento.inconsistente && evento.diferenca_percentual !== 0 && (
                            <Badge variant="outline" className={`text-[10px] ${Math.abs(evento.diferenca_percentual) > 30 ? 'border-red-300 text-red-700' : 'border-amber-300 text-amber-700'}`}>
                              {evento.diferenca_percentual > 0 ? '+' : ''}{evento.diferenca_percentual.toFixed(0)}%
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-amber-700">{evento.alerta}</div>
                      <div className="text-xs text-slate-600 mt-1">Total: {(evento.quantidade_total_kg || 0).toFixed(1)} kg • {evento.total_cabecas_afetadas || 0} cabeças • {evento.dias} dia(s)</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Evolução: Consumo Real vs. Esperado</CardTitle></CardHeader>
            <CardContent className="p-3">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dadosGrafico}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg/cab', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="consumo" stroke="#10b981" strokeWidth={2} name="Consumo Real" />
                  <Line type="monotone" dataKey="esperado" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" name={consumoEsperadoPV > 0 ? "Esperado (%PV)" : "Consumo Ideal"} />
                  {limiteMin > 0 && <Line type="monotone" dataKey="minimo" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" name="Limite Mínimo" />}
                  {limiteMax > 0 && <Line type="monotone" dataKey="maximo" stroke="#f97316" strokeWidth={1} strokeDasharray="3 3" name="Limite Máximo" />}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 border-b"><CardTitle className="text-xs font-semibold">Recomendações</CardTitle></CardHeader>
            <CardContent className="p-3">
              <div className="space-y-2">
                {desvio > 20 && <div className="flex items-start gap-2 text-xs"><TrendingUp className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" /><div><div className="font-semibold text-slate-900">Consumo acima do esperado</div><div className="text-slate-600">Reveja quantidade ofertada, frequência e perdas no cocho para evitar desperdício.</div></div></div>}
                {desvio < -20 && <div className="flex items-start gap-2 text-xs"><TrendingDown className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" /><div><div className="font-semibold text-slate-900">Consumo abaixo do esperado</div><div className="text-slate-600">Verifique cocho vazio, palatabilidade, acesso à água e possível problema sanitário.</div></div></div>}
                {Math.abs(desvio) <= 20 && <div className="flex items-start gap-2 text-xs"><CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" /><div><div className="font-semibold text-slate-900">Consumo dentro do esperado</div><div className="text-slate-600">O ponto está operando próximo do padrão técnico definido.</div></div></div>}
                {!consumoEsperadoPV && consumoIdeal > 0 && <div className="flex items-start gap-2 text-xs"><Target className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" /><div><div className="font-semibold text-slate-900">Configure o %PV no cadastro do produto</div><div className="text-slate-600">Cadastre o percentual de consumo sobre peso vivo para análises mais precisas baseadas em peso do animal.</div></div></div>}
                {analises.some((item) => item.inconsistente) && <div className="flex items-start gap-2 text-xs"><AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" /><div><div className="font-semibold text-slate-900">Existem eventos inconsistentes</div><div className="text-slate-600">Corrija eventos com cabeças zeradas para evitar leitura enganosa da análise.</div></div></div>}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <div className="text-sm font-semibold text-slate-900 mb-1">Configure os parâmetros de consumo</div>
            <div className="text-xs text-slate-600">Para habilitar a análise inteligente, configure o %PV no cadastro do produto ou defina o consumo ideal e os limites nas configurações do ponto.</div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
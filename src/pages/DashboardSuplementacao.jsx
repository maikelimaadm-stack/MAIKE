import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, TrendingUp, Package, MapPin, Calendar, Activity } from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import AnaliseConsumo from "../components/suplementacao/AnaliseConsumo";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function DashboardSuplementacao() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [periodoMeses, setPeriodoMeses] = useState("3");
  const [showAnalise, setShowAnalise] = useState(false);
  const [pontoSelecionado, setPontoSelecionado] = useState(null);

  const { data: pontos = [] } = useQuery({
    queryKey: ['pontos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: eventos = [] } = useQuery({
    queryKey: ['eventos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter(e => e.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: suplementacaoLotes = [] } = useQuery({
    queryKey: ['suplementacao-lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoLote.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  // Filtrar por período
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - parseInt(periodoMeses));
  
  const eventosFiltrados = eventos.filter(e => 
    new Date(e.data_lancamento) >= dataLimite
  );

  // Estatísticas gerais
  const pontosAtivos = pontos.filter(p => p.status === 'Ativo').length;
  const totalFornecido = eventosFiltrados.reduce((sum, e) => sum + e.quantidade_total_kg, 0);
  const mediaFornecimento = eventosFiltrados.length > 0 
    ? (totalFornecido / eventosFiltrados.length).toFixed(1)
    : 0;

  // Pontos com alerta
  const pontosComAlerta = pontos.filter(p => {
    if (p.status !== 'Ativo') return false;
    const eventosP = eventos.filter(e => e.ponto_suplementacao_id === p.id);
    if (eventosP.length === 0) return true;
    
    const ultimoEvento = eventosP.sort((a, b) => 
      new Date(b.data_lancamento) - new Date(a.data_lancamento)
    )[0];
    
    const diasSemLancamento = Math.floor(
      (new Date() - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24)
    );
    
    return diasSemLancamento > (p.alerta_sem_lancamento_dias || 10);
  });

  // Consumo por produto
  const consumoPorProduto = eventosFiltrados.reduce((acc, e) => {
    if (!acc[e.produto]) {
      acc[e.produto] = 0;
    }
    acc[e.produto] += e.quantidade_total_kg;
    return acc;
  }, {});

  const dadosProdutos = Object.entries(consumoPorProduto)
    .map(([produto, quantidade]) => ({ produto, quantidade: parseFloat(quantidade.toFixed(1)) }))
    .sort((a, b) => b.quantidade - a.quantidade)
    .slice(0, 5);

  // Consumo ao longo do tempo
  const consumoPorData = eventosFiltrados.reduce((acc, e) => {
    const data = new Date(e.data_lancamento).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    if (!acc[data]) {
      acc[data] = 0;
    }
    acc[data] += e.quantidade_total_kg;
    return acc;
  }, {});

  const dadosTemporais = Object.entries(consumoPorData)
    .map(([data, quantidade]) => ({ data, quantidade: parseFloat(quantidade.toFixed(1)) }))
    .slice(-30);

  // Consumo por ponto
  const consumoPorPonto = pontos.map(p => {
    const eventosP = eventosFiltrados.filter(e => e.ponto_suplementacao_id === p.id);
    const total = eventosP.reduce((sum, e) => sum + e.quantidade_total_kg, 0);
    return { nome: p.nome_ponto, total: parseFloat(total.toFixed(1)) };
  }).filter(p => p.total > 0).sort((a, b) => b.total - a.total);

  // Pontos com problemas de consumo
  const pontosComProblemas = pontos.filter(p => {
    if (!p.consumo_ideal_por_cabeca_kg || !p.limite_minimo_consumo || !p.limite_maximo_consumo) return false;
    const eventosP = eventosFiltrados.filter(e => e.ponto_suplementacao_id === p.id);
    return eventosP.some(e => 
      (e.consumo_medio_por_cabeca_kg || 0) < p.limite_minimo_consumo || 
      (e.consumo_medio_por_cabeca_kg || 0) > p.limite_maximo_consumo
    );
  });

  const handleShowAnalise = (ponto) => {
    setPontoSelecionado(ponto);
    setShowAnalise(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard de Suplementação</h1>
          <p className="text-sm text-slate-600 mt-1">Análise e monitoramento do fornecimento de suplementos</p>
        </div>
        <Select value={periodoMeses} onValueChange={setPeriodoMeses}>
          <SelectTrigger className="w-40 h-9 text-xs">
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

      {pontosComAlerta.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-amber-900">
                  {pontosComAlerta.length} ponto(s) necessitam atenção
                </div>
                <div className="text-xs text-amber-700 mt-1">
                  Pontos sem lançamento há mais tempo que o esperado
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-600 mb-1">Pontos Ativos</div>
                <div className="text-2xl font-bold text-slate-900">{pontosAtivos}</div>
              </div>
              <MapPin className="w-8 h-8 text-emerald-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-600 mb-1">Total Fornecido</div>
                <div className="text-2xl font-bold text-slate-900">{totalFornecido.toFixed(0)} kg</div>
              </div>
              <Package className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-600 mb-1">Lançamentos</div>
                <div className="text-2xl font-bold text-slate-900">{eventosFiltrados.length}</div>
              </div>
              <Calendar className="w-8 h-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-600 mb-1">Alertas</div>
                <div className="text-2xl font-bold text-red-600">{pontosComAlerta.length + pontosComProblemas.length}</div>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm font-semibold">Consumo ao Longo do Tempo</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dadosTemporais}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="data" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="quantidade" stroke="#10b981" strokeWidth={2} name="Quantidade Fornecida (kg)" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm font-semibold">Top 5 Produtos Mais Usados</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dadosProdutos} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="produto" type="category" tick={{ fontSize: 10 }} width={120} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="quantidade" fill="#10b981" name="Quantidade (kg)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-semibold">Consumo por Ponto de Suplementação</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {consumoPorPonto.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-500">
              Nenhum dado de consumo no período selecionado
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={consumoPorPonto}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="nome" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                <YAxis tick={{ fontSize: 10 }} label={{ value: 'kg', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="total" fill="#3b82f6" name="Total Fornecido (kg)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-semibold">Análise Detalhada por Ponto</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid gap-3">
            {pontos.filter(p => p.status === 'Ativo').map((ponto) => {
              const eventosP = eventosFiltrados.filter(e => e.ponto_suplementacao_id === ponto.id);
              const totalP = eventosP.reduce((sum, e) => sum + e.quantidade_total_kg, 0);
              const temConfiguracao = ponto.consumo_ideal_por_cabeca_kg > 0;
              const temAlerta = pontosComAlerta.some(p => p.id === ponto.id);
              const temProblema = pontosComProblemas.some(p => p.id === ponto.id);

              return (
                <div key={ponto.id} className="border border-slate-200 rounded-lg p-3 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-slate-900">{ponto.nome_ponto}</h4>
                        {temAlerta && (
                          <Badge className="bg-amber-100 text-amber-800 text-xs">
                            <AlertTriangle className="w-3 h-3 mr-1" />
                            Sem lançamento
                          </Badge>
                        )}
                        {temProblema && (
                          <Badge className="bg-red-100 text-red-800 text-xs">
                            <Activity className="w-3 h-3 mr-1" />
                            Consumo irregular
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 space-y-0.5">
                        <div>Área: {ponto.area_vinculada_nome}</div>
                        <div>Lançamentos: {eventosP.length} • Total: {totalP.toFixed(0)} kg</div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleShowAnalise(ponto)}
                      className="h-8 text-xs"
                      disabled={!temConfiguracao}
                    >
                      <TrendingUp className="w-3 h-3 mr-1" />
                      {temConfiguracao ? 'Ver Análise' : 'Sem config'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showAnalise} onOpenChange={setShowAnalise}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {pontoSelecionado && (
            <AnaliseConsumo
              pontoId={pontoSelecionado.id}
              pontoNome={pontoSelecionado.nome_ponto}
              ponto={pontoSelecionado}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
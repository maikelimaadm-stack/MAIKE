import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  TrendingUp, TrendingDown, Users, Package, Scale, DollarSign, 
  Calendar, RefreshCw, BarChart3, PieChart, Activity, Beef,
  ArrowUp, ArrowDown, Minus, Target, AlertTriangle
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, LineChart, Line, Legend, AreaChart, Area
} from "recharts";

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'];

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0";
  return numero.toLocaleString('pt-BR');
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function DashboardPublico() {
  const urlParams = new URLSearchParams(window.location.search);
  const empresaIdParam = urlParams.get('empresa');
  
  const [empresaSelecionada, setEmpresaSelecionada] = useState(empresaIdParam || localStorage.getItem('empresa_selecionada_id') || '');
  const [periodoFiltro, setPeriodoFiltro] = useState('mes_atual');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Buscar empresas
  const { data: empresas = [] } = useQuery({
    queryKey: ['empresas-dash-pub'],
    queryFn: () => base44.entities.Empresa.list(),
  });

  // Buscar movimentações
  const { data: movimentacoes = [], refetch: refetchMov, isLoading: loadingMov } = useQuery({
    queryKey: ['mov-dash-pub', empresaSelecionada],
    queryFn: async () => {
      if (!empresaSelecionada) return [];
      const all = await base44.entities.MovimentacaoPecuaria.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaSelecionada && !m.lote_id);
    },
    enabled: !!empresaSelecionada,
  });

  // Buscar pesagens individuais
  const { data: pesagensInd = [], refetch: refetchPes, isLoading: loadingPes } = useQuery({
    queryKey: ['pes-ind-dash-pub', empresaSelecionada],
    queryFn: async () => {
      if (!empresaSelecionada) return [];
      const all = await base44.entities.PesagemIndividual.list('-data_pesagem');
      return all.filter(p => p.empresa_id === empresaSelecionada);
    },
    enabled: !!empresaSelecionada,
  });

  // Buscar pesagens de balança
  const { data: pesagensBalanca = [], refetch: refetchBal, isLoading: loadingBal } = useQuery({
    queryKey: ['pes-bal-dash-pub', empresaSelecionada],
    queryFn: async () => {
      if (!empresaSelecionada) return [];
      const all = await base44.entities.Pesagem.list('-data_pesagem');
      return all.filter(p => p.empresa_id === empresaSelecionada);
    },
    enabled: !!empresaSelecionada,
  });

  // Buscar lançamentos financeiros
  const { data: lancamentos = [], refetch: refetchFin, isLoading: loadingFin } = useQuery({
    queryKey: ['fin-dash-pub', empresaSelecionada],
    queryFn: async () => {
      if (!empresaSelecionada) return [];
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l.empresa_id === empresaSelecionada);
    },
    enabled: !!empresaSelecionada,
  });

  // Buscar estoque
  const { data: produtos = [], refetch: refetchProd } = useQuery({
    queryKey: ['prod-dash-pub', empresaSelecionada],
    queryFn: async () => {
      if (!empresaSelecionada) return [];
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionada);
    },
    enabled: !!empresaSelecionada,
  });

  const empresaAtual = empresas.find(e => e.id === empresaSelecionada);

  // Calcular período
  const { dataInicioCalc, dataFimCalc } = useMemo(() => {
    const hoje = new Date();
    let inicio, fim;

    switch (periodoFiltro) {
      case 'hoje':
        inicio = fim = hoje;
        break;
      case 'ultimos_7':
        inicio = subDays(hoje, 7);
        fim = hoje;
        break;
      case 'ultimos_30':
        inicio = subDays(hoje, 30);
        fim = hoje;
        break;
      case 'mes_atual':
        inicio = startOfMonth(hoje);
        fim = endOfMonth(hoje);
        break;
      case 'ano_atual':
        inicio = startOfYear(hoje);
        fim = endOfYear(hoje);
        break;
      case 'personalizado':
        inicio = dataInicio ? new Date(dataInicio) : null;
        fim = dataFim ? new Date(dataFim) : null;
        break;
      default:
        inicio = startOfMonth(hoje);
        fim = endOfMonth(hoje);
    }

    return { 
      dataInicioCalc: inicio ? format(inicio, 'yyyy-MM-dd') : null, 
      dataFimCalc: fim ? format(fim, 'yyyy-MM-dd') : null 
    };
  }, [periodoFiltro, dataInicio, dataFim]);

  // Filtrar movimentações por período
  const movFiltradas = useMemo(() => {
    return movimentacoes.filter(m => {
      if (!m.data_movimentacao) return false;
      const dataM = m.data_movimentacao.split('T')[0];
      if (dataInicioCalc && dataM < dataInicioCalc) return false;
      if (dataFimCalc && dataM > dataFimCalc) return false;
      return true;
    });
  }, [movimentacoes, dataInicioCalc, dataFimCalc]);

  // Filtrar pesagens por período
  const pesFiltradas = useMemo(() => {
    return pesagensInd.filter(p => {
      if (!p.data_pesagem) return false;
      const dataP = p.data_pesagem.split('T')[0];
      if (dataInicioCalc && dataP < dataInicioCalc) return false;
      if (dataFimCalc && dataP > dataFimCalc) return false;
      return true;
    });
  }, [pesagensInd, dataInicioCalc, dataFimCalc]);

  // Filtrar lançamentos por período
  const lancFiltrados = useMemo(() => {
    return lancamentos.filter(l => {
      if (!l.data_emissao) return false;
      const dataL = l.data_emissao.split('T')[0];
      if (dataInicioCalc && dataL < dataInicioCalc) return false;
      if (dataFimCalc && dataL > dataFimCalc) return false;
      return true;
    });
  }, [lancamentos, dataInicioCalc, dataFimCalc]);

  // ========== INDICADORES PECUÁRIA ==========
  const indicadoresPecuaria = useMemo(() => {
    const entradas = movFiltradas.filter(m => m.tipo === 'Entrada');
    const saidas = movFiltradas.filter(m => m.tipo === 'Saída');
    
    const totalEntradas = entradas.reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const totalSaidas = saidas.reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const saldo = totalEntradas - totalSaidas;

    // Por motivo
    const compras = entradas.filter(m => m.motivo === 'Compra').reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const nascimentos = entradas.filter(m => m.motivo === 'Nascimento').reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const vendas = saidas.filter(m => m.motivo === 'Venda').reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const abates = saidas.filter(m => m.motivo === 'Abate').reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const mortes = saidas.filter(m => m.motivo === 'Morte').reduce((s, m) => s + (m.quantidade_animais || 0), 0);

    // Valor total vendas
    const valorVendas = saidas.filter(m => m.motivo === 'Venda' || m.motivo === 'Abate').reduce((s, m) => s + (m.valor_total || 0), 0);
    const valorCompras = entradas.filter(m => m.motivo === 'Compra').reduce((s, m) => s + (m.valor_total || 0), 0);

    // Por categoria
    const porCategoria = {};
    movFiltradas.forEach(m => {
      const cat = m.categoria_animal || 'Sem categoria';
      if (!porCategoria[cat]) porCategoria[cat] = { entradas: 0, saidas: 0, saldo: 0 };
      if (m.tipo === 'Entrada') {
        porCategoria[cat].entradas += m.quantidade_animais || 0;
      } else {
        porCategoria[cat].saidas += m.quantidade_animais || 0;
      }
      porCategoria[cat].saldo = porCategoria[cat].entradas - porCategoria[cat].saidas;
    });

    // Por setor
    const porSetor = {};
    movFiltradas.forEach(m => {
      const setor = m.setor_nome || 'Sem setor';
      if (!porSetor[setor]) porSetor[setor] = { entradas: 0, saidas: 0, saldo: 0 };
      if (m.tipo === 'Entrada') {
        porSetor[setor].entradas += m.quantidade_animais || 0;
      } else {
        porSetor[setor].saidas += m.quantidade_animais || 0;
      }
      porSetor[setor].saldo = porSetor[setor].entradas - porSetor[setor].saidas;
    });

    return {
      totalEntradas, totalSaidas, saldo,
      compras, nascimentos, vendas, abates, mortes,
      valorVendas, valorCompras,
      porCategoria, porSetor
    };
  }, [movFiltradas]);

  // ========== INDICADORES PESAGENS ==========
  const indicadoresPesagens = useMemo(() => {
    const totalAnimais = pesFiltradas.length;
    const pesoTotal = pesFiltradas.reduce((s, p) => s + (p.peso || 0), 0);
    const pesoMedio = totalAnimais > 0 ? pesoTotal / totalAnimais : 0;
    
    // GMD médio
    const comGmd = pesFiltradas.filter(p => p.gmd && p.gmd !== 0);
    const gmdMedio = comGmd.length > 0 ? comGmd.reduce((s, p) => s + (p.gmd || 0), 0) / comGmd.length : 0;

    // Por apartação
    const porApartacao = {};
    pesFiltradas.forEach(p => {
      const apt = p.nome_apartacao || 'Sem apartação';
      if (!porApartacao[apt]) porApartacao[apt] = { qtd: 0, peso: 0 };
      porApartacao[apt].qtd++;
      porApartacao[apt].peso += p.peso || 0;
    });

    return { totalAnimais, pesoTotal, pesoMedio, gmdMedio, porApartacao };
  }, [pesFiltradas]);

  // ========== INDICADORES FINANCEIROS ==========
  const indicadoresFinanceiros = useMemo(() => {
    const pagar = lancFiltrados.filter(l => l.tipo === 'Pagar');
    const receber = lancFiltrados.filter(l => l.tipo === 'Receber');

    const totalPagar = pagar.reduce((s, l) => s + (l.valor_total || 0), 0);
    const totalReceber = receber.reduce((s, l) => s + (l.valor_total || 0), 0);
    const saldo = totalReceber - totalPagar;

    const pagoPagar = pagar.filter(l => l.status === 'Pago').reduce((s, l) => s + (l.valor_pago || l.valor_total || 0), 0);
    const pagoReceber = receber.filter(l => l.status === 'Pago').reduce((s, l) => s + (l.valor_pago || l.valor_total || 0), 0);

    const vencidos = lancFiltrados.filter(l => l.status === 'Vencido').length;

    return { totalPagar, totalReceber, saldo, pagoPagar, pagoReceber, vencidos };
  }, [lancFiltrados]);

  // ========== GRÁFICOS ==========
  // Movimentações por mês
  const dadosMovMensal = useMemo(() => {
    const meses = {};
    movFiltradas.forEach(m => {
      if (!m.data_movimentacao) return;
      const mes = m.data_movimentacao.substring(0, 7); // YYYY-MM
      if (!meses[mes]) meses[mes] = { mes, entradas: 0, saidas: 0 };
      if (m.tipo === 'Entrada') {
        meses[mes].entradas += m.quantidade_animais || 0;
      } else {
        meses[mes].saidas += m.quantidade_animais || 0;
      }
    });
    return Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes)).map(d => ({
      ...d,
      mesLabel: format(new Date(d.mes + '-01'), 'MMM/yy', { locale: ptBR })
    }));
  }, [movFiltradas]);

  // Por categoria (Pizza)
  const dadosCategorias = useMemo(() => {
    return Object.entries(indicadoresPecuaria.porCategoria)
      .map(([nome, dados]) => ({ nome, valor: Math.abs(dados.saldo) }))
      .filter(d => d.valor > 0)
      .sort((a, b) => b.valor - a.valor);
  }, [indicadoresPecuaria.porCategoria]);

  // Por setor (Barras)
  const dadosSetores = useMemo(() => {
    return Object.entries(indicadoresPecuaria.porSetor)
      .map(([nome, dados]) => ({ nome, entradas: dados.entradas, saidas: dados.saidas, saldo: dados.saldo }))
      .sort((a, b) => b.saldo - a.saldo);
  }, [indicadoresPecuaria.porSetor]);

  // Refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchMov(), refetchPes(), refetchBal(), refetchFin(), refetchProd()]);
    setIsRefreshing(false);
  };

  const isLoading = loadingMov || loadingPes || loadingBal || loadingFin;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          {empresaAtual?.logotipo_url && (
            <img src={empresaAtual.logotipo_url} alt="Logo" className="h-12 w-12 object-contain rounded bg-white p-1" />
          )}
          <div>
            <h1 className="text-2xl font-bold">{empresaAtual?.apelido || empresaAtual?.nome || 'Dashboard Executivo'}</h1>
            <p className="text-slate-400 text-sm">Painel de Gestão em Tempo Real</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!empresaIdParam && empresas.length > 1 && (
            <Select value={empresaSelecionada} onValueChange={setEmpresaSelecionada}>
              <SelectTrigger className="h-9 w-48 bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="Selecione empresa" />
              </SelectTrigger>
              <SelectContent>
                {empresas.map(e => (
                  <SelectItem key={e.id} value={e.id}>{e.apelido || e.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={periodoFiltro} onValueChange={setPeriodoFiltro}>
            <SelectTrigger className="h-9 w-40 bg-slate-800 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="ultimos_7">Últimos 7 dias</SelectItem>
              <SelectItem value="ultimos_30">Últimos 30 dias</SelectItem>
              <SelectItem value="mes_atual">Mês Atual</SelectItem>
              <SelectItem value="ano_atual">Ano Atual</SelectItem>
              <SelectItem value="personalizado">Personalizado</SelectItem>
            </SelectContent>
          </Select>

          {periodoFiltro === 'personalizado' && (
            <>
              <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="h-9 w-36 bg-slate-800 border-slate-700 text-white" />
              <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="h-9 w-36 bg-slate-800 border-slate-700 text-white" />
            </>
          )}

          <Button onClick={handleRefresh} disabled={isRefreshing} size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700">
            <RefreshCw className={`w-4 h-4 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Período selecionado */}
      <div className="mb-4 text-center">
        <Badge variant="outline" className="text-slate-300 border-slate-600 text-sm px-4 py-1">
          <Calendar className="w-4 h-4 mr-2 inline" />
          {dataInicioCalc && dataFimCalc 
            ? `${format(new Date(dataInicioCalc), 'dd/MM/yyyy', { locale: ptBR })} até ${format(new Date(dataFimCalc), 'dd/MM/yyyy', { locale: ptBR })}`
            : 'Período não definido'}
        </Badge>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : (
        <Tabs defaultValue="pecuaria" className="space-y-4">
          <TabsList className="bg-slate-800 border border-slate-700">
            <TabsTrigger value="pecuaria" className="data-[state=active]:bg-emerald-600">
              <Beef className="w-4 h-4 mr-1" /> Pecuária
            </TabsTrigger>
            <TabsTrigger value="pesagens" className="data-[state=active]:bg-emerald-600">
              <Scale className="w-4 h-4 mr-1" /> Pesagens
            </TabsTrigger>
            <TabsTrigger value="financeiro" className="data-[state=active]:bg-emerald-600">
              <DollarSign className="w-4 h-4 mr-1" /> Financeiro
            </TabsTrigger>
            <TabsTrigger value="estoque" className="data-[state=active]:bg-emerald-600">
              <Package className="w-4 h-4 mr-1" /> Estoque
            </TabsTrigger>
          </TabsList>

          {/* TAB PECUÁRIA */}
          <TabsContent value="pecuaria" className="space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-400 text-xs">Entradas</p>
                      <p className="text-2xl font-bold text-green-400">{formatarNumero(indicadoresPecuaria.totalEntradas)}</p>
                    </div>
                    <ArrowUp className="w-8 h-8 text-green-400/30" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-400 text-xs">Saídas</p>
                      <p className="text-2xl font-bold text-red-400">{formatarNumero(indicadoresPecuaria.totalSaidas)}</p>
                    </div>
                    <ArrowDown className="w-8 h-8 text-red-400/30" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-400 text-xs">Saldo</p>
                      <p className={`text-2xl font-bold ${indicadoresPecuaria.saldo >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                        {formatarNumero(indicadoresPecuaria.saldo)}
                      </p>
                    </div>
                    <Activity className="w-8 h-8 text-blue-400/30" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-400 text-xs">Compras</p>
                      <p className="text-xl font-bold text-emerald-400">{formatarNumero(indicadoresPecuaria.compras)}</p>
                    </div>
                    <TrendingUp className="w-6 h-6 text-emerald-400/30" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-400 text-xs">Vendas/Abates</p>
                      <p className="text-xl font-bold text-amber-400">{formatarNumero(indicadoresPecuaria.vendas + indicadoresPecuaria.abates)}</p>
                    </div>
                    <TrendingDown className="w-6 h-6 text-amber-400/30" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-400 text-xs">Mortes</p>
                      <p className="text-xl font-bold text-red-500">{formatarNumero(indicadoresPecuaria.mortes)}</p>
                    </div>
                    <AlertTriangle className="w-6 h-6 text-red-500/30" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Movimentações por mês */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> Movimentações por Período
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={dadosMovMensal}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="mesLabel" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
                      <Legend />
                      <Bar dataKey="entradas" name="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="saidas" name="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Por categoria */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
                    <PieChart className="w-4 h-4" /> Distribuição por Categoria
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <RechartsPie>
                      <Pie
                        data={dadosCategorias}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="valor"
                        nameKey="nome"
                        label={({ nome, percent }) => `${nome}: ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {dadosCategorias.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151' }} />
                    </RechartsPie>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Tabela por setor */}
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300">Movimentações por Setor</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700">
                        <TableHead className="text-slate-400">Setor</TableHead>
                        <TableHead className="text-slate-400 text-right">Entradas</TableHead>
                        <TableHead className="text-slate-400 text-right">Saídas</TableHead>
                        <TableHead className="text-slate-400 text-right">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dadosSetores.map((setor, idx) => (
                        <TableRow key={idx} className="border-slate-700">
                          <TableCell className="font-medium">{setor.nome}</TableCell>
                          <TableCell className="text-right text-green-400">{formatarNumero(setor.entradas)}</TableCell>
                          <TableCell className="text-right text-red-400">{formatarNumero(setor.saidas)}</TableCell>
                          <TableCell className={`text-right font-bold ${setor.saldo >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>
                            {formatarNumero(setor.saldo)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB PESAGENS */}
          <TabsContent value="pesagens" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Animais Pesados</p>
                  <p className="text-2xl font-bold text-emerald-400">{formatarNumero(indicadoresPesagens.totalAnimais)}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Peso Total</p>
                  <p className="text-2xl font-bold text-blue-400">{formatarNumero(indicadoresPesagens.pesoTotal)} kg</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Peso Médio</p>
                  <p className="text-2xl font-bold text-amber-400">{indicadoresPesagens.pesoMedio.toFixed(2)} kg</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">GMD Médio</p>
                  <p className="text-2xl font-bold text-purple-400">{indicadoresPesagens.gmdMedio.toFixed(3)} kg/dia</p>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300">Pesagens por Apartação</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700">
                        <TableHead className="text-slate-400">Apartação</TableHead>
                        <TableHead className="text-slate-400 text-right">Quantidade</TableHead>
                        <TableHead className="text-slate-400 text-right">Peso Total</TableHead>
                        <TableHead className="text-slate-400 text-right">Peso Médio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(indicadoresPesagens.porApartacao).map(([apt, dados], idx) => (
                        <TableRow key={idx} className="border-slate-700">
                          <TableCell className="font-medium">{apt}</TableCell>
                          <TableCell className="text-right">{formatarNumero(dados.qtd)}</TableCell>
                          <TableCell className="text-right">{formatarNumero(dados.peso)} kg</TableCell>
                          <TableCell className="text-right">{(dados.peso / dados.qtd).toFixed(2)} kg</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB FINANCEIRO */}
          <TabsContent value="financeiro" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Total a Pagar</p>
                  <p className="text-xl font-bold text-red-400">{formatarMoeda(indicadoresFinanceiros.totalPagar)}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Total a Receber</p>
                  <p className="text-xl font-bold text-green-400">{formatarMoeda(indicadoresFinanceiros.totalReceber)}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Saldo Previsto</p>
                  <p className={`text-xl font-bold ${indicadoresFinanceiros.saldo >= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
                    {formatarMoeda(indicadoresFinanceiros.saldo)}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Já Pago</p>
                  <p className="text-xl font-bold text-blue-400">{formatarMoeda(indicadoresFinanceiros.pagoPagar)}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Vencidos</p>
                  <p className="text-xl font-bold text-red-500">{indicadoresFinanceiros.vencidos}</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB ESTOQUE */}
          <TabsContent value="estoque" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Total de Produtos</p>
                  <p className="text-2xl font-bold text-emerald-400">{produtos.length}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Em Estoque</p>
                  <p className="text-2xl font-bold text-blue-400">
                    {produtos.filter(p => (p.estoque_atual || 0) > 0).length}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <p className="text-slate-400 text-xs">Abaixo do Mínimo</p>
                  <p className="text-2xl font-bold text-red-400">
                    {produtos.filter(p => (p.estoque_atual || 0) < (p.estoque_minimo || 0)).length}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-slate-300">Produtos em Estoque</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-96">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700">
                        <TableHead className="text-slate-400">Produto</TableHead>
                        <TableHead className="text-slate-400">Categoria</TableHead>
                        <TableHead className="text-slate-400 text-right">Estoque</TableHead>
                        <TableHead className="text-slate-400 text-right">Mínimo</TableHead>
                        <TableHead className="text-slate-400">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {produtos.slice(0, 20).map((prod, idx) => {
                        const abaixo = (prod.estoque_atual || 0) < (prod.estoque_minimo || 0);
                        return (
                          <TableRow key={idx} className="border-slate-700">
                            <TableCell className="font-medium">{prod.nome_produto}</TableCell>
                            <TableCell>{prod.categoria || '-'}</TableCell>
                            <TableCell className="text-right">{formatarNumero(prod.estoque_atual || 0)} {prod.unidade_medida}</TableCell>
                            <TableCell className="text-right">{formatarNumero(prod.estoque_minimo || 0)}</TableCell>
                            <TableCell>
                              <Badge className={abaixo ? 'bg-red-600' : 'bg-emerald-600'}>
                                {abaixo ? 'Baixo' : 'OK'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Footer */}
      <div className="mt-8 text-center text-slate-500 text-xs">
        Última atualização: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
      </div>
    </div>
  );
}
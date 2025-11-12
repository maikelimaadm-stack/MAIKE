
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Package, TrendingUp, AlertTriangle, DollarSign, ShoppingCart, Users, Calendar, Settings, BarChart3, Eye, Table as TableIcon, List, TrendingDown } from "lucide-react";
import { BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, subMonths } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CartoesResumo from "../components/shared/CartoesResumo.jsx";

const CORES = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const TIPOS_CARTAO = [
  { id: 'produtos', label: 'Total de Produtos', icon: Package, cor: 'blue' },
  { id: 'estoque_valor', label: 'Valor em Estoque', icon: DollarSign, cor: 'emerald' },
  { id: 'estoque_baixo', label: 'Estoque Baixo', icon: AlertTriangle, cor: 'amber' },
  { id: 'contas_pagar', label: 'Contas a Pagar', icon: TrendingDown, cor: 'red' },
  { id: 'contas_receber', label: 'Contas a Receber', icon: TrendingUp, cor: 'emerald' },
  { id: 'fornecedores', label: 'Fornecedores', icon: Users, cor: 'violet' },
  { id: 'vencidos', label: 'Títulos Vencidos', icon: Calendar, cor: 'rose' },
  { id: 'movimentacoes_mes', label: 'Movimentações (Mês)', icon: ShoppingCart, cor: 'indigo' },
];

const formatarMoeda = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Home() {
  const [cartoesVisiveis, setCartoesVisiveis] = useState(() => {
    const saved = localStorage.getItem('cartoes_dashboard');
    return saved ? JSON.parse(saved) : ['produtos', 'estoque_valor', 'estoque_baixo', 'contas_pagar'];
  });
  
  const [showConfigCartoes, setShowConfigCartoes] = useState(false);
  const [showConfigGraficos, setShowConfigGraficos] = useState(false);
  const [showDetalhesCartao, setShowDetalhesCartao] = useState(null);
  const [tipoVisualizacao, setTipoVisualizacao] = useState('resumo');
  
  const [graficosVisiveis, setGraficosVisiveis] = useState(() => {
    const saved = localStorage.getItem('graficos_dashboard');
    return saved ? JSON.parse(saved) : ['movimentacoes_mes', 'estoque_categoria'];
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_dashboard', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes_dashboard', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status === 'Ativa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_dashboard', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lancamentosFinanceiros = [] } = useQuery({
    queryKey: ['financeiro_dashboard', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LancamentoFinanceiro.list('-data_emissao');
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const estatisticas = useMemo(() => {
    const totalProdutos = produtos.length;
    const valorEstoque = produtos.reduce((sum, p) => sum + ((p.preco_custo || 0) * (p.estoque_atual || 0)), 0);
    const estoqueBaixo = produtos.filter(p => (p.estoque_atual || 0) <= (p.estoque_minimo || 0));
    
    const contasPagar = lancamentosFinanceiros.filter(l => l && l.tipo === 'Pagar' && l.status !== 'Pago' && l.status !== 'Cancelado');
    const contasReceber = lancamentosFinanceiros.filter(l => l && l.tipo === 'Receber' && l.status !== 'Pago' && l.status !== 'Cancelado');
    const vencidos = lancamentosFinanceiros.filter(l => l && l.data_vencimento && new Date(l.data_vencimento) < new Date() && l.status === 'Pendente');
    
    const mesAtual = new Date();
    const inicioMes = new Date(mesAtual.getFullYear(), mesAtual.getMonth(), 1);
    const movimentacoesMes = movimentacoes.filter(m => new Date(m.data_movimentacao) >= inicioMes);
    
    return {
      produtos: { valor: totalProdutos, dados: produtos },
      estoque_valor: { valor: valorEstoque, dados: produtos },
      estoque_baixo: { valor: estoqueBaixo.length, dados: estoqueBaixo },
      contas_pagar: { valor: contasPagar.reduce((sum, c) => sum + ((c?.valor_saldo ?? c?.valor_total) || 0), 0), dados: contasPagar },
      contas_receber: { valor: contasReceber.reduce((sum, c) => sum + ((c?.valor_saldo ?? c?.valor_total) || 0), 0), dados: contasReceber },
      fornecedores: { valor: fornecedores.length, dados: fornecedores },
      vencidos: { valor: vencidos.length, dados: vencidos },
      movimentacoes_mes: { valor: movimentacoesMes.length, dados: movimentacoesMes },
    };
  }, [produtos, lancamentosFinanceiros, fornecedores, movimentacoes]);

  const dadosGraficos = useMemo(() => {
    const movimentacoesMes = [];
    for (let i = 5; i >= 0; i--) {
      const mes = subMonths(new Date(), i);
      const inicioMes = new Date(mes.getFullYear(), mes.getMonth(), 1);
      const fimMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
      
      const entradas = movimentacoes.filter(m => 
        m.tipo_movimentacao === 'Entrada' && 
        new Date(m.data_movimentacao) >= inicioMes && 
        new Date(m.data_movimentacao) <= fimMes
      ).length;
      
      const saidas = movimentacoes.filter(m => 
        m.tipo_movimentacao === 'Saída' && 
        new Date(m.data_movimentacao) >= inicioMes && 
        new Date(m.data_movimentacao) <= fimMes
      ).length;
      
      movimentacoesMes.push({ mes: format(mes, 'MMM/yy'), entradas, saidas });
    }

    const categorias = {};
    produtos.forEach(p => {
      const cat = p.categoria || 'Sem categoria';
      if (!categorias[cat]) categorias[cat] = 0;
      categorias[cat] += p.estoque_atual || 0;
    });
    const estoquePorCategoria = Object.entries(categorias).map(([name, value]) => ({ name, value }));

    const fluxoCaixaMes = [];
    for (let i = 5; i >= 0; i--) {
      const mes = subMonths(new Date(), i);
      const inicioMes = new Date(mes.getFullYear(), mes.getMonth(), 1);
      const fimMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
      
      const recebido = lancamentosFinanceiros.filter(l => 
        l.tipo === 'Receber' && l.status === 'Pago' &&
        new Date(l.data_vencimento) >= inicioMes && new Date(l.data_vencimento) <= fimMes
      ).reduce((s, l) => s + (l.valor_pago || l.valor_total || 0), 0);
      
      const pago = lancamentosFinanceiros.filter(l => 
        l.tipo === 'Pagar' && l.status === 'Pago' &&
        new Date(l.data_vencimento) >= inicioMes && new Date(l.data_vencimento) <= fimMes
      ).reduce((s, l) => s + (l.valor_pago || l.valor_total || 0), 0);
      
      fluxoCaixaMes.push({ mes: format(mes, 'MMM/yy'), receitas: recebido, despesas: pago, saldo: recebido - pago });
    }

    return { movimentacoesMes, estoquePorCategoria, fluxoCaixaMes };
  }, [movimentacoes, produtos, lancamentosFinanceiros]);

  const toggleCartao = (cartaoId) => {
    setCartoesVisiveis(prev => {
      const novos = prev.includes(cartaoId) ? prev.filter(id => id !== cartaoId) : [...prev, cartaoId];
      localStorage.setItem('cartoes_dashboard', JSON.stringify(novos));
      return novos;
    });
  };

  const toggleGrafico = (graficoId) => {
    setGraficosVisiveis(prev => {
      const novos = prev.includes(graficoId) ? prev.filter(id => id !== graficoId) : [...prev, graficoId];
      localStorage.setItem('graficos_dashboard', JSON.stringify(novos));
      return novos;
    });
  };

  const abrirDetalhes = (tipoCartao) => {
    setShowDetalhesCartao(tipoCartao);
    setTipoVisualizacao('resumo');
  };

  const cartoesFormatados = TIPOS_CARTAO.filter(tipo => cartoesVisiveis.includes(tipo.id)).map(tipo => {
    const stat = estatisticas[tipo.id];
    return {
      id: tipo.id,
      label: tipo.label,
      valor: stat.valor,
      sublabel: stat.dados?.length > 0 ? `${stat.dados.length} ${stat.dados.length === 1 ? 'item' : 'itens'}` : undefined,
      icon: tipo.icon,
      cor: tipo.cor,
      tipo: tipo.id.includes('valor') || tipo.id.includes('contas') ? 'moeda' : 'numero',
      onClick: stat.dados?.length > 0 ? () => abrirDetalhes(tipo.id) : undefined
    };
  });

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-xs text-slate-600">Visão geral do sistema</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowConfigCartoes(true)} className="h-8 gap-1 text-xs">
            <Settings className="w-3.5 h-3.5" />
            Cartões
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowConfigGraficos(true)} className="h-8 gap-1 text-xs">
            <BarChart3 className="w-3.5 h-3.5" />
            Gráficos
          </Button>
        </div>
      </div>

      <CartoesResumo cartoes={cartoesFormatados} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {graficosVisiveis.includes('movimentacoes_mes') && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Movimentações (6 Meses)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-2">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={dadosGraficos.movimentacoesMes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="entradas" fill="#10b981" name="Entradas" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="saidas" fill="#ef4444" name="Saídas" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {graficosVisiveis.includes('estoque_categoria') && (
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Estoque por Categoria</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-2">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={dadosGraficos.estoquePorCategoria}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={70}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {dadosGraficos.estoquePorCategoria.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CORES[index % CORES.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {graficosVisiveis.includes('fluxo_caixa') && (
          <Card className="shadow-sm lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-900">Fluxo de Caixa (6 Meses)</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 pb-2">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dadosGraficos.fluxoCaixaMes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mes" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(value) => formatarMoeda(value)} contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="receitas" stroke="#10b981" name="Receitas" strokeWidth={2} />
                  <Line type="monotone" dataKey="despesas" stroke="#ef4444" name="Despesas" strokeWidth={2} />
                  <Line type="monotone" dataKey="saldo" stroke="#3b82f6" name="Saldo" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={showConfigCartoes} onOpenChange={setShowConfigCartoes}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Cartões</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            {TIPOS_CARTAO.map((tipo) => {
              const Icon = tipo.icon;
              return (
                <div key={tipo.id} className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
                  <Checkbox checked={cartoesVisiveis.includes(tipo.id)} onCheckedChange={() => toggleCartao(tipo.id)} />
                  <Icon className="w-3.5 h-3.5 text-slate-600" />
                  <label className="cursor-pointer flex-1 text-xs" onClick={() => toggleCartao(tipo.id)}>
                    {tipo.label}
                  </label>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showConfigGraficos} onOpenChange={setShowConfigGraficos}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Gráficos</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <div className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
              <Checkbox checked={graficosVisiveis.includes('movimentacoes_mes')} onCheckedChange={() => toggleGrafico('movimentacoes_mes')} />
              <label className="cursor-pointer flex-1 text-xs" onClick={() => toggleGrafico('movimentacoes_mes')}>
                Movimentações de Estoque
              </label>
            </div>
            <div className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
              <Checkbox checked={graficosVisiveis.includes('estoque_categoria')} onCheckedChange={() => toggleGrafico('estoque_categoria')} />
              <label className="cursor-pointer flex-1 text-xs" onClick={() => toggleGrafico('estoque_categoria')}>
                Estoque por Categoria
              </label>
            </div>
            <div className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded">
              <Checkbox checked={graficosVisiveis.includes('fluxo_caixa')} onCheckedChange={() => toggleGrafico('fluxo_caixa')} />
              <label className="cursor-pointer flex-1 text-xs" onClick={() => toggleGrafico('fluxo_caixa')}>
                Fluxo de Caixa
              </label>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showDetalhesCartao} onOpenChange={(open) => !open && setShowDetalhesCartao(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center text-sm">
              <span>{TIPOS_CARTAO.find(t => t.id === showDetalhesCartao)?.label}</span>
              {estatisticas[showDetalhesCartao]?.dados?.length > 0 && (
                <Tabs value={tipoVisualizacao} onValueChange={setTipoVisualizacao} className="w-auto">
                  <TabsList className="h-7">
                    <TabsTrigger value="resumo" className="h-6 gap-1 text-xs px-2"><List className="w-3 h-3" />Resumo</TabsTrigger>
                    <TabsTrigger value="tabela" className="h-6 gap-1 text-xs px-2"><TableIcon className="w-3 h-3" />Tabela</TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            </DialogTitle>
          </DialogHeader>

          <Tabs value={tipoVisualizacao}>
            <TabsContent value="resumo" className="mt-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {showDetalhesCartao === 'produtos' && (
                  <>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Total</div><div className="text-lg font-bold">{produtos.length}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Valor Estoque</div><div className="text-lg font-bold">{formatarMoeda(produtos.reduce((s, p) => s + ((p.preco_custo || 0) * (p.estoque_atual || 0)), 0))}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Estoque Baixo</div><div className="text-lg font-bold text-amber-600">{produtos.filter(p => (p.estoque_atual || 0) <= (p.estoque_minimo || 0)).length}</div></CardContent></Card>
                  </>
                )}
                {showDetalhesCartao === 'estoque_baixo' && (
                  <>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Produtos Baixos</div><div className="text-lg font-bold text-amber-600">{estatisticas.estoque_baixo.dados.length}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">% do Total</div><div className="text-lg font-bold">{produtos.length > 0 ? ((estatisticas.estoque_baixo.dados.length / produtos.length) * 100).toFixed(0) : 0}%</div></CardContent></Card>
                  </>
                )}
                {['contas_pagar', 'contas_receber'].includes(showDetalhesCartao) && (
                  <>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Quantidade</div><div className="text-lg font-bold">{estatisticas[showDetalhesCartao].dados.length}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Valor Total</div><div className="text-lg font-bold">{formatarMoeda(estatisticas[showDetalhesCartao].valor)}</div></CardContent></Card>
                  </>
                )}
                {showDetalhesCartao === 'vencidos' && (
                  <>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Quantidade</div><div className="text-lg font-bold text-red-600">{estatisticas.vencidos.dados.length}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Valor Total</div><div className="text-lg font-bold text-red-600">{formatarMoeda(estatisticas.vencidos.dados.reduce((s, v) => s + ((v?.valor_saldo ?? v?.valor_total) || 0), 0))}</div></CardContent></Card>
                  </>
                )}
                {showDetalhesCartao === 'fornecedores' && (
                  <>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Total</div><div className="text-lg font-bold">{fornecedores.length}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Pessoa Física</div><div className="text-lg font-bold">{fornecedores.filter(f => f.tipo_pessoa === 'Física').length}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Pessoa Jurídica</div><div className="text-lg font-bold">{fornecedores.filter(f => f.tipo_pessoa === 'Jurídica').length}</div></CardContent></Card>
                  </>
                )}
                {showDetalhesCartao === 'movimentacoes_mes' && (
                  <>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Total Mês</div><div className="text-lg font-bold">{estatisticas.movimentacoes_mes.valor}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Entradas</div><div className="text-lg font-bold text-emerald-600">{estatisticas.movimentacoes_mes.dados.filter(m => m.tipo_movimentacao === 'Entrada').length}</div></CardContent></Card>
                    <Card className="shadow-sm"><CardContent className="p-2.5"><div className="text-xs text-slate-600">Saídas</div><div className="text-lg font-bold text-red-600">{estatisticas.movimentacoes_mes.dados.filter(m => m.tipo_movimentacao === 'Saída').length}</div></CardContent></Card>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="tabela" className="mt-2">
              <div className="max-h-80 overflow-auto border rounded">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-50">
                    <TableRow>
                      {showDetalhesCartao === 'produtos' && (
                        <>
                          <TableHead className="text-xs">Produto</TableHead>
                          <TableHead className="text-xs">Código</TableHead>
                          <TableHead className="text-right text-xs">Estoque</TableHead>
                          <TableHead className="text-right text-xs">Valor</TableHead>
                        </>
                      )}
                      {showDetalhesCartao === 'estoque_baixo' && (
                        <>
                          <TableHead className="text-xs">Produto</TableHead>
                          <TableHead className="text-xs">Código</TableHead>
                          <TableHead className="text-right text-xs">Atual</TableHead>
                          <TableHead className="text-right text-xs">Mínimo</TableHead>
                          <TableHead className="text-right text-xs">Diferença</TableHead>
                        </>
                      )}
                      {['contas_pagar', 'contas_receber', 'vencidos'].includes(showDetalhesCartao) && (
                        <>
                          <TableHead className="text-xs">Nº</TableHead>
                          <TableHead className="text-xs">Vencimento</TableHead>
                          <TableHead className="text-xs">{showDetalhesCartao === 'contas_pagar' || showDetalhesCartao === 'vencidos' ? 'Fornecedor' : 'Cliente'}</TableHead>
                          <TableHead className="text-right text-xs">Saldo</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                        </>
                      )}
                      {showDetalhesCartao === 'fornecedores' && (
                        <>
                          <TableHead className="text-xs">Nome</TableHead>
                          <TableHead className="text-xs">Tipo</TableHead>
                          <TableHead className="text-xs">Cidade</TableHead>
                          <TableHead className="text-xs">Telefone</TableHead>
                        </>
                      )}
                      {showDetalhesCartao === 'movimentacoes_mes' && (
                        <>
                          <TableHead className="text-xs">Data</TableHead>
                          <TableHead className="text-xs">Tipo</TableHead>
                          <TableHead className="text-xs">Produto</TableHead>
                          <TableHead className="text-right text-xs">Quantidade</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {estatisticas[showDetalhesCartao]?.dados.slice(0, 50).map((item, idx) => (
                      <TableRow key={idx} className="text-xs">
                        {showDetalhesCartao === 'produtos' && (
                          <>
                            <TableCell>{item.nome_produto}</TableCell>
                            <TableCell className="font-mono">{item.codigo_interno || '-'}</TableCell>
                            <TableCell className="text-right font-semibold">{item.estoque_atual || 0}</TableCell>
                            <TableCell className="text-right">{formatarMoeda((item.preco_custo || 0) * (item.estoque_atual || 0))}</TableCell>
                          </>
                        )}
                        {showDetalhesCartao === 'estoque_baixo' && (
                          <>
                            <TableCell>{item.nome_produto}</TableCell>
                            <TableCell className="font-mono">{item.codigo_interno || '-'}</TableCell>
                            <TableCell className="text-right text-amber-600 font-semibold">{item.estoque_atual || 0}</TableCell>
                            <TableCell className="text-right">{item.estoque_minimo || 0}</TableCell>
                            <TableCell className="text-right text-red-600 font-bold">{(item.estoque_minimo || 0) - (item.estoque_atual || 0)}</TableCell>
                          </>
                        )}
                        {['contas_pagar', 'contas_receber', 'vencidos'].includes(showDetalhesCartao) && item && (
                          <>
                            <TableCell className="font-bold">{item.numero_lancamento}</TableCell>
                            <TableCell>{item.data_vencimento ? new Date(item.data_vencimento).toLocaleDateString('pt-BR') : '-'}</TableCell>
                            <TableCell>{item.fornecedor_nome || item.cliente_nome || '-'}</TableCell>
                            <TableCell className="text-right font-semibold">{formatarMoeda((item?.valor_saldo ?? item?.valor_total) || 0)}</TableCell>
                            <TableCell><Badge className="text-xs py-0">{item.status}</Badge></TableCell>
                          </>
                        )}
                        {showDetalhesCartao === 'fornecedores' && (
                          <>
                            <TableCell>{item.nome}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs py-0">{item.tipo_pessoa}</Badge></TableCell>
                            <TableCell>{item.cidade || '-'}</TableCell>
                            <TableCell>{item.telefone || '-'}</TableCell>
                          </>
                        )}
                        {showDetalhesCartao === 'movimentacoes_mes' && (
                          <>
                            <TableCell>{new Date(item.data_movimentacao).toLocaleDateString('pt-BR')}</TableCell>
                            <TableCell><Badge className={`text-xs py-0 ${item.tipo_movimentacao === 'Entrada' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{item.tipo_movimentacao}</Badge></TableCell>
                            <TableCell>{item.produto_nome}</TableCell>
                            <TableCell className="text-right font-mono">{item.quantidade}</TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

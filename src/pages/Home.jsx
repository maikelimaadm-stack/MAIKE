import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, TrendingUp, AlertTriangle, DollarSign, ShoppingCart, Users, ArrowUpRight, ArrowDownRight, Calendar, Plus, Settings, BarChart3 } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const CORES = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const TIPOS_CARTAO = [
  { id: 'produtos', label: 'Total de Produtos', icon: Package, cor: 'green' },
  { id: 'estoque_valor', label: 'Valor em Estoque', icon: DollarSign, cor: 'blue' },
  { id: 'estoque_baixo', label: 'Estoque Baixo', icon: AlertTriangle, cor: 'orange' },
  { id: 'contas_pagar', label: 'Contas a Pagar', icon: ShoppingCart, cor: 'red' },
  { id: 'contas_receber', label: 'Contas a Receber', icon: TrendingUp, cor: 'green' },
  { id: 'fornecedores', label: 'Fornecedores', icon: Users, cor: 'purple' },
  { id: 'movimentacoes', label: 'Movimentações (Mês)', icon: ArrowUpRight, cor: 'blue' },
  { id: 'vencidos', label: 'Títulos Vencidos', icon: Calendar, cor: 'red' },
];

export default function Home() {
  const [cartoesVisiveis, setCartoesVisiveis] = useState(() => {
    const saved = localStorage.getItem('cartoes_dashboard');
    return saved ? JSON.parse(saved) : ['produtos', 'estoque_valor', 'estoque_baixo', 'contas_pagar'];
  });
  const [showConfigCartoes, setShowConfigCartoes] = useState(false);
  const [showConfigGraficos, setShowConfigGraficos] = useState(false);
  const [graficosVisiveis, setGraficosVisiveis] = useState(() => {
    const saved = localStorage.getItem('graficos_dashboard');
    return saved ? JSON.parse(saved) : ['movimentacoes_mes', 'estoque_categoria', 'financeiro_status'];
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
    const estoqueBaixo = produtos.filter(p => (p.estoque_atual || 0) <= (p.estoque_minimo || 0)).length;
    
    const contasPagar = lancamentosFinanceiros.filter(l => l.tipo === 'Pagar' && l.status !== 'Pago' && l.status !== 'Cancelado');
    const contasReceber = lancamentosFinanceiros.filter(l => l.tipo === 'Receber' && l.status !== 'Pago' && l.status !== 'Cancelado');
    const vencidos = lancamentosFinanceiros.filter(l => new Date(l.data_vencimento) < new Date() && l.status === 'Pendente');
    
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const movimentacoesMes = movimentacoes.filter(m => new Date(m.data_movimentacao) >= inicioMes).length;

    return {
      produtos: totalProdutos,
      estoque_valor: valorEstoque,
      estoque_baixo: estoqueBaixo,
      contas_pagar: contasPagar.reduce((sum, c) => sum + (c.valor_saldo || c.valor_total || 0), 0),
      contas_receber: contasReceber.reduce((sum, c) => sum + (c.valor_saldo || c.valor_total || 0), 0),
      fornecedores: fornecedores.length,
      movimentacoes: movimentacoesMes,
      vencidos: vencidos.length,
    };
  }, [produtos, movimentacoes, fornecedores, lancamentosFinanceiros]);

  const dadosGraficos = useMemo(() => {
    // Movimentações por mês (últimos 6 meses)
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
      
      movimentacoesMes.push({
        mes: format(mes, 'MMM/yy', { locale: ptBR }),
        entradas,
        saidas
      });
    }

    // Estoque por categoria
    const categorias = {};
    produtos.forEach(p => {
      const cat = p.categoria || 'Sem categoria';
      if (!categorias[cat]) categorias[cat] = 0;
      categorias[cat] += p.estoque_atual || 0;
    });
    const estoquePorCategoria = Object.entries(categorias).map(([name, value]) => ({ name, value }));

    // Status financeiro
    const statusFinanceiro = [
      { name: 'Pendente', value: lancamentosFinanceiros.filter(l => l.status === 'Pendente').length },
      { name: 'Pago Parcial', value: lancamentosFinanceiros.filter(l => l.status === 'Pago Parcial').length },
      { name: 'Pago', value: lancamentosFinanceiros.filter(l => l.status === 'Pago').length },
      { name: 'Vencido', value: lancamentosFinanceiros.filter(l => l.status === 'Vencido').length },
    ].filter(s => s.value > 0);

    return { movimentacoesMes, estoquePorCategoria, statusFinanceiro };
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

  const formatarMoeda = (valor) => {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Cabeçalho */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-green-900">Dashboard</h1>
          <p className="text-green-700">Visão geral do sistema</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setShowConfigCartoes(true)} className="gap-2">
            <Settings className="w-4 h-4" />
            Configurar Cartões
          </Button>
          <Button variant="outline" onClick={() => setShowConfigGraficos(true)} className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Configurar Gráficos
          </Button>
        </div>
      </div>

      {/* Cartões de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {TIPOS_CARTAO.filter(tipo => cartoesVisiveis.includes(tipo.id)).map((tipo) => {
          const Icon = tipo.icon;
          const valor = estatisticas[tipo.id];
          const valorFormatado = ['estoque_valor', 'contas_pagar', 'contas_receber'].includes(tipo.id) 
            ? formatarMoeda(valor)
            : valor.toLocaleString('pt-BR');

          return (
            <Card key={tipo.id} className={`shadow-lg border-${tipo.cor}-200 bg-gradient-to-br from-white to-${tipo.cor}-50`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-700">{tipo.label}</CardTitle>
                <Icon className={`h-5 w-5 text-${tipo.cor}-600`} />
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold text-${tipo.cor}-900`}>{valorFormatado}</div>
                {tipo.id === 'vencidos' && valor > 0 && (
                  <p className="text-xs text-red-600 mt-1">⚠️ Requer atenção</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {graficosVisiveis.includes('movimentacoes_mes') && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-slate-900">Movimentações de Estoque (Últimos 6 Meses)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dadosGraficos.movimentacoesMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="entradas" fill="#10b981" name="Entradas" />
                  <Bar dataKey="saidas" fill="#ef4444" name="Saídas" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {graficosVisiveis.includes('estoque_categoria') && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-slate-900">Estoque por Categoria</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={dadosGraficos.estoquePorCategoria}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {dadosGraficos.estoquePorCategoria.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CORES[index % CORES.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {graficosVisiveis.includes('financeiro_status') && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-slate-900">Status Financeiro</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={dadosGraficos.statusFinanceiro}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {dadosGraficos.statusFinanceiro.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CORES[index % CORES.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Diálogo de Configuração de Cartões */}
      <Dialog open={showConfigCartoes} onOpenChange={setShowConfigCartoes}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Cartões do Dashboard</DialogTitle>
            <DialogDescription>Selecione quais cartões deseja visualizar</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {TIPOS_CARTAO.map((tipo) => {
              const Icon = tipo.icon;
              return (
                <div key={tipo.id} className="flex items-center space-x-3">
                  <Checkbox
                    checked={cartoesVisiveis.includes(tipo.id)}
                    onCheckedChange={() => toggleCartao(tipo.id)}
                  />
                  <Icon className="w-5 h-5" />
                  <label className="cursor-pointer flex-1" onClick={() => toggleCartao(tipo.id)}>
                    {tipo.label}
                  </label>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo de Configuração de Gráficos */}
      <Dialog open={showConfigGraficos} onOpenChange={setShowConfigGraficos}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Gráficos do Dashboard</DialogTitle>
            <DialogDescription>Selecione quais gráficos deseja visualizar</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <Checkbox
                checked={graficosVisiveis.includes('movimentacoes_mes')}
                onCheckedChange={() => toggleGrafico('movimentacoes_mes')}
              />
              <label className="cursor-pointer flex-1" onClick={() => toggleGrafico('movimentacoes_mes')}>
                Movimentações de Estoque (Últimos 6 Meses)
              </label>
            </div>
            <div className="flex items-center space-x-3">
              <Checkbox
                checked={graficosVisiveis.includes('estoque_categoria')}
                onCheckedChange={() => toggleGrafico('estoque_categoria')}
              />
              <label className="cursor-pointer flex-1" onClick={() => toggleGrafico('estoque_categoria')}>
                Estoque por Categoria
              </label>
            </div>
            <div className="flex items-center space-x-3">
              <Checkbox
                checked={graficosVisiveis.includes('financeiro_status')}
                onCheckedChange={() => toggleGrafico('financeiro_status')}
              />
              <label className="cursor-pointer flex-1" onClick={() => toggleGrafico('financeiro_status')}>
                Status Financeiro
              </label>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
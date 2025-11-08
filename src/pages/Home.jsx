import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, TrendingUp, AlertTriangle, DollarSign, ShoppingCart, Users, Calendar, Settings, BarChart3, Eye, Table as TableIcon, List } from "lucide-react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format, subMonths } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const CORES = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const TIPOS_CARTAO = [
  { id: 'produtos', label: 'Total de Produtos', icon: Package, cor: 'green', entidade: 'Produto' },
  { id: 'estoque_valor', label: 'Valor em Estoque', icon: DollarSign, cor: 'blue', entidade: 'Produto' },
  { id: 'estoque_baixo', label: 'Estoque Baixo', icon: AlertTriangle, cor: 'orange', entidade: 'Produto' },
  { id: 'contas_pagar', label: 'Contas a Pagar', icon: ShoppingCart, cor: 'red', entidade: 'LancamentoFinanceiro' },
  { id: 'contas_receber', label: 'Contas a Receber', icon: TrendingUp, cor: 'green', entidade: 'LancamentoFinanceiro' },
  { id: 'fornecedores', label: 'Fornecedores', icon: Users, cor: 'purple', entidade: 'Fornecedor' },
  { id: 'vencidos', label: 'Títulos Vencidos', icon: Calendar, cor: 'red', entidade: 'LancamentoFinanceiro' },
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
    
    const contasPagar = lancamentosFinanceiros.filter(l => l.tipo === 'Pagar' && l.status !== 'Pago' && l.status !== 'Cancelado');
    const contasReceber = lancamentosFinanceiros.filter(l => l.tipo === 'Receber' && l.status !== 'Pago' && l.status !== 'Cancelado');
    const vencidos = lancamentosFinanceiros.filter(l => new Date(l.data_vencimento) < new Date() && l.status === 'Pendente');
    
    return {
      produtos: { valor: totalProdutos, dados: produtos },
      estoque_valor: { valor: valorEstoque, dados: produtos },
      estoque_baixo: { valor: estoqueBaixo.length, dados: estoqueBaixo },
      contas_pagar: { valor: contasPagar.reduce((sum, c) => sum + (c.valor_saldo || c.valor_total || 0), 0), dados: contasPagar },
      contas_receber: { valor: contasReceber.reduce((sum, c) => sum + (c.valor_saldo || c.valor_total || 0), 0), dados: contasReceber },
      fornecedores: { valor: fornecedores.length, dados: fornecedores },
      vencidos: { valor: vencidos.length, dados: vencidos },
    };
  }, [produtos, lancamentosFinanceiros, fornecedores]);

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
      
      movimentacoesMes.push({
        mes: format(mes, 'MMM/yy'),
        entradas,
        saidas
      });
    }

    const categorias = {};
    produtos.forEach(p => {
      const cat = p.categoria || 'Sem categoria';
      if (!categorias[cat]) categorias[cat] = 0;
      categorias[cat] += p.estoque_atual || 0;
    });
    const estoquePorCategoria = Object.entries(categorias).map(([name, value]) => ({ name, value }));

    return { movimentacoesMes, estoquePorCategoria };
  }, [movimentacoes, produtos]);

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

  return (
    <div className="p-6 space-y-6">
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {TIPOS_CARTAO.filter(tipo => cartoesVisiveis.includes(tipo.id)).map((tipo) => {
          const Icon = tipo.icon;
          const stat = estatisticas[tipo.id];
          const valorFormatado = ['estoque_valor', 'contas_pagar', 'contas_receber'].includes(tipo.id) 
            ? formatarMoeda(stat.valor)
            : stat.valor.toLocaleString('pt-BR');

          return (
            <Card 
              key={tipo.id} 
              className={`shadow-lg border-${tipo.cor}-200 bg-gradient-to-br from-white to-${tipo.cor}-50 cursor-pointer hover:shadow-xl transition-shadow`}
              onClick={() => abrirDetalhes(tipo.id)}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-slate-700">{tipo.label}</CardTitle>
                <Icon className={`h-5 w-5 text-${tipo.cor}-600`} />
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold text-${tipo.cor}-900`}>{valorFormatado}</div>
                <Button variant="ghost" size="sm" className="mt-2 w-full gap-2 hover:bg-white/50">
                  <Eye className="w-3 h-3" />
                  Ver Detalhes
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
      </div>

      <Dialog open={showConfigCartoes} onOpenChange={setShowConfigCartoes}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Cartões do Dashboard</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {TIPOS_CARTAO.map((tipo) => {
              const Icon = tipo.icon;
              return (
                <div key={tipo.id} className="flex items-center space-x-3">
                  <Checkbox checked={cartoesVisiveis.includes(tipo.id)} onCheckedChange={() => toggleCartao(tipo.id)} />
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

      <Dialog open={showConfigGraficos} onOpenChange={setShowConfigGraficos}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configurar Gráficos do Dashboard</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <Checkbox checked={graficosVisiveis.includes('movimentacoes_mes')} onCheckedChange={() => toggleGrafico('movimentacoes_mes')} />
              <label className="cursor-pointer flex-1" onClick={() => toggleGrafico('movimentacoes_mes')}>
                Movimentações de Estoque
              </label>
            </div>
            <div className="flex items-center space-x-3">
              <Checkbox checked={graficosVisiveis.includes('estoque_categoria')} onCheckedChange={() => toggleGrafico('estoque_categoria')} />
              <label className="cursor-pointer flex-1" onClick={() => toggleGrafico('estoque_categoria')}>
                Estoque por Categoria
              </label>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!showDetalhesCartao} onOpenChange={(open) => !open && setShowDetalhesCartao(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex justify-between items-center">
              <span>{TIPOS_CARTAO.find(t => t.id === showDetalhesCartao)?.label}</span>
              <Tabs value={tipoVisualizacao} onValueChange={setTipoVisualizacao} className="w-auto">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="resumo" className="gap-1"><List className="w-3 h-3" />Resumo</TabsTrigger>
                  <TabsTrigger value="tabela" className="gap-1"><TableIcon className="w-3 h-3" />Tabela</TabsTrigger>
                </TabsList>
              </Tabs>
            </DialogTitle>
          </DialogHeader>

          <Tabs value={tipoVisualizacao}>
            <TabsContent value="resumo">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {showDetalhesCartao === 'produtos' && (
                  <>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-600">Total</div><div className="text-2xl font-bold">{produtos.length}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-600">Valor Estoque</div><div className="text-2xl font-bold">{formatarMoeda(produtos.reduce((s, p) => s + ((p.preco_custo || 0) * (p.estoque_atual || 0)), 0))}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-600">Estoque Baixo</div><div className="text-2xl font-bold text-orange-600">{produtos.filter(p => (p.estoque_atual || 0) <= (p.estoque_minimo || 0)).length}</div></CardContent></Card>
                  </>
                )}
                {['contas_pagar', 'contas_receber', 'vencidos'].includes(showDetalhesCartao) && (
                  <>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-600">Quantidade</div><div className="text-2xl font-bold">{estatisticas[showDetalhesCartao].dados.length}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-600">Valor Total</div><div className="text-2xl font-bold">{formatarMoeda(estatisticas[showDetalhesCartao].valor)}</div></CardContent></Card>
                  </>
                )}
                {showDetalhesCartao === 'fornecedores' && (
                  <>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-600">Total</div><div className="text-2xl font-bold">{fornecedores.length}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-600">Pessoa Física</div><div className="text-2xl font-bold">{fornecedores.filter(f => f.tipo_pessoa === 'Física').length}</div></CardContent></Card>
                    <Card><CardContent className="p-4"><div className="text-xs text-slate-600">Pessoa Jurídica</div><div className="text-2xl font-bold">{fornecedores.filter(f => f.tipo_pessoa === 'Jurídica').length}</div></CardContent></Card>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="tabela">
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {showDetalhesCartao === 'produtos' && (
                        <>
                          <TableHead>Produto</TableHead>
                          <TableHead>Código</TableHead>
                          <TableHead className="text-right">Estoque</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </>
                      )}
                      {['contas_pagar', 'contas_receber', 'vencidos'].includes(showDetalhesCartao) && (
                        <>
                          <TableHead>Nº</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>{showDetalhesCartao === 'contas_pagar' ? 'Fornecedor' : 'Cliente'}</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                          <TableHead>Status</TableHead>
                        </>
                      )}
                      {showDetalhesCartao === 'fornecedores' && (
                        <>
                          <TableHead>Nome</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Cidade</TableHead>
                          <TableHead>Telefone</TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {estatisticas[showDetalhesCartao]?.dados.slice(0, 50).map((item, idx) => (
                      <TableRow key={idx}>
                        {showDetalhesCartao === 'produtos' && (
                          <>
                            <TableCell>{item.nome_produto}</TableCell>
                            <TableCell className="font-mono text-xs">{item.codigo_interno || '-'}</TableCell>
                            <TableCell className="text-right font-semibold">{item.estoque_atual || 0}</TableCell>
                            <TableCell className="text-right">{formatarMoeda((item.preco_custo || 0) * (item.estoque_atual || 0))}</TableCell>
                          </>
                        )}
                        {['contas_pagar', 'contas_receber', 'vencidos'].includes(showDetalhesCartao) && (
                          <>
                            <TableCell className="font-bold">{item.numero_lancamento}</TableCell>
                            <TableCell className="text-xs">{new Date(item.data_vencimento).toLocaleDateString('pt-BR')}</TableCell>
                            <TableCell>{item.fornecedor_nome || item.cliente_nome}</TableCell>
                            <TableCell className="text-right font-semibold">{formatarMoeda(item.valor_saldo || item.valor_total)}</TableCell>
                            <TableCell><Badge>{item.status}</Badge></TableCell>
                          </>
                        )}
                        {showDetalhesCartao === 'fornecedores' && (
                          <>
                            <TableCell>{item.nome}</TableCell>
                            <TableCell><Badge variant="outline">{item.tipo_pessoa}</Badge></TableCell>
                            <TableCell className="text-xs">{item.cidade || '-'}</TableCell>
                            <TableCell className="text-xs">{item.telefone || '-'}</TableCell>
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
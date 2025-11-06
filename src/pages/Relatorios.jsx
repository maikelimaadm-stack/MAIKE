import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { FileText, TrendingUp, Calendar } from "lucide-react";

export default function Relatorios() {
  const { data: pesagens, isLoading } = useQuery({
    queryKey: ['pesagens'],
    queryFn: () => base44.entities.Pesagem.list('-data_pesagem'),
    initialData: [],
  });

  // Dados por tipo de pesagem
  const dadosPorTipo = [
    { name: 'Entrada', value: pesagens.filter(p => p.tipo_pesagem === 'Entrada').length },
    { name: 'Saída', value: pesagens.filter(p => p.tipo_pesagem === 'Saída').length },
    { name: 'Ambos', value: pesagens.filter(p => p.tipo_pesagem === 'Ambos').length },
  ];

  // Dados por produto (top 5)
  const produtosCount = {};
  pesagens.forEach(p => {
    produtosCount[p.produto] = (produtosCount[p.produto] || 0) + 1;
  });
  const dadosPorProduto = Object.entries(produtosCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([produto, count]) => ({ produto, quantidade: count }));

  // Peso líquido por produto (top 5)
  const pesosPorProduto = {};
  pesagens.forEach(p => {
    pesosPorProduto[p.produto] = (pesosPorProduto[p.produto] || 0) + (p.peso_liquido || 0);
  });
  const dadosPesoProduto = Object.entries(pesosPorProduto)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([produto, peso]) => ({ produto, peso: peso.toFixed(2) }));

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  const totalPesoLiquido = pesagens.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);
  const mediaPesoLiquido = pesagens.length > 0 ? totalPesoLiquido / pesagens.length : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
          <FileText className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Relatórios e Análises</h1>
          <p className="text-slate-600">Visualize estatísticas e métricas das pesagens</p>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-slate-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Total de Pesagens</CardTitle>
            <FileText className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{pesagens.length}</div>
            <p className="text-xs text-slate-500 mt-1">Registros totais</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-slate-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Peso Total</CardTitle>
            <TrendingUp className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{totalPesoLiquido.toFixed(2)} kg</div>
            <p className="text-xs text-slate-500 mt-1">Peso líquido acumulado</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-slate-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Média de Peso</CardTitle>
            <Calendar className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-slate-900">{mediaPesoLiquido.toFixed(2)} kg</div>
            <p className="text-xs text-slate-500 mt-1">Por pesagem</p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-lg border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-900">Pesagens por Tipo</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={dadosPorTipo}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {dadosPorTipo.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-900">Top 5 Produtos (Quantidade)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dadosPorProduto}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="produto" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="quantidade" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-slate-200 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-slate-900">Top 5 Produtos (Peso Líquido em kg)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dadosPesoProduto}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="produto" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="peso" fill="#10b981" name="Peso Líquido (kg)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { FileText, TrendingUp, Calendar, Download, Filter, Printer } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export default function Relatorios() {
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const { data: pesagens, isLoading } = useQuery({
    queryKey: ['pesagens'],
    queryFn: () => base44.entities.Pesagem.list('-data_pesagem'),
    initialData: [],
  });

  // Filtrar por período
  const pesagensFiltradas = pesagens.filter(p => {
    if (!dataInicio && !dataFim) return true;
    const dataPesagem = new Date(p.data_pesagem);
    if (dataInicio && new Date(dataInicio) > dataPesagem) return false;
    if (dataFim && new Date(dataFim) < dataPesagem) return false;
    return true;
  });

  // Dados por tipo de pesagem
  const dadosPorTipo = [
    { name: 'Entrada', value: pesagensFiltradas.filter(p => p.tipo_pesagem === 'Entrada').length, color: '#10b981' },
    { name: 'Saída', value: pesagensFiltradas.filter(p => p.tipo_pesagem === 'Saída').length, color: '#ef4444' },
    { name: 'Ambos', value: pesagensFiltradas.filter(p => p.tipo_pesagem === 'Ambos').length, color: '#3b82f6' },
  ];

  // Dados por produto (top 5)
  const produtosCount = {};
  pesagensFiltradas.forEach(p => {
    produtosCount[p.produto] = (produtosCount[p.produto] || 0) + 1;
  });
  const dadosPorProduto = Object.entries(produtosCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([produto, count]) => ({ produto, quantidade: count }));

  // Peso líquido por produto (top 5)
  const pesosPorProduto = {};
  pesagensFiltradas.forEach(p => {
    pesosPorProduto[p.produto] = (pesosPorProduto[p.produto] || 0) + (p.peso_liquido || 0);
  });
  const dadosPesoProduto = Object.entries(pesosPorProduto)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([produto, peso]) => ({ produto, peso: parseFloat(peso.toFixed(2)) }));

  // Pesagens por dia (últimos 7 dias)
  const pesagensPorDia = {};
  pesagensFiltradas.forEach(p => {
    const data = format(new Date(p.data_pesagem), "dd/MM", { locale: ptBR });
    pesagensPorDia[data] = (pesagensPorDia[data] || 0) + 1;
  });
  const dadosPorDia = Object.entries(pesagensPorDia)
    .slice(-7)
    .map(([data, quantidade]) => ({ data, quantidade }));

  const COLORS = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6'];

  const totalPesoLiquido = pesagensFiltradas.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);
  const mediaPesoLiquido = pesagensFiltradas.length > 0 ? totalPesoLiquido / pesagensFiltradas.length : 0;

  // Exportar para Excel/CSV
  const exportarRelatorio = () => {
    const headers = ['Data', 'Tipo', 'Placa', 'Motorista', 'Produto', 'Fornecedor/Destino', 'Tara (kg)', 'Bruto (kg)', 'Líquido (kg)', 'Observações'];
    const rows = pesagensFiltradas.map(p => [
      format(new Date(p.data_pesagem), "dd/MM/yyyy", { locale: ptBR }),
      p.tipo_pesagem,
      p.placa_caminhao,
      p.nome_motorista,
      p.produto,
      p.fornecedor_destino || '',
      formatarNumero(p.peso_tara),
      formatarNumero(p.peso_bruto),
      formatarNumero(p.peso_liquido),
      p.observacoes || ''
    ]);

    const csvContent = [
      headers.join(';'),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(';'))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `relatorio_pesagens_${format(new Date(), 'ddMMyyyy_HHmmss')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Imprimir relatório
  const imprimirRelatorio = () => {
    window.print();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center shadow-lg">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-900">Relatórios e Análises</h1>
            <p className="text-green-700">Visualize estatísticas e métricas das pesagens</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={imprimirRelatorio} variant="outline" className="gap-2 border-green-600 text-green-700 hover:bg-green-50">
            <Printer className="w-4 h-4" />
            Imprimir
          </Button>
          <Button onClick={exportarRelatorio} className="bg-green-600 hover:bg-green-700 gap-2">
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="shadow-lg border-green-200 bg-white print:shadow-none">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200 print:bg-white">
          <CardTitle className="flex items-center gap-2 text-green-900">
            <Filter className="w-5 h-5" />
            Filtros de Período
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 print:hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="dataInicio" className="text-green-900">Data Início</Label>
              <Input
                id="dataInicio"
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="border-green-300 focus:border-green-500"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dataFim" className="text-green-900">Data Fim</Label>
              <Input
                id="dataFim"
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="border-green-300 focus:border-green-500"
              />
            </div>
            <Button 
              variant="outline" 
              onClick={() => { setDataInicio(""); setDataFim(""); }}
              className="border-green-300 text-green-700 hover:bg-green-50"
            >
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:mb-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50 print:shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total de Pesagens</CardTitle>
            <FileText className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{pesagensFiltradas.length}</div>
            <p className="text-xs text-green-600 mt-1">Registros no período</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-emerald-50 print:shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Peso Total Líquido</CardTitle>
            <TrendingUp className="h-5 w-5 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-900">{formatarNumero(totalPesoLiquido)} kg</div>
            <p className="text-xs text-emerald-600 mt-1">Peso acumulado</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-teal-50 print:shadow-none">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Média de Peso</CardTitle>
            <Calendar className="h-5 w-5 text-teal-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-teal-900">{formatarNumero(mediaPesoLiquido)} kg</div>
            <p className="text-xs text-teal-600 mt-1">Por pesagem</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Dados Impressos */}
      <Card className="shadow-lg border-green-200 print:shadow-none print:break-before-page">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200 print:bg-white">
          <CardTitle className="text-green-900">Dados das Pesagens</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 print:bg-white">
                  <TableHead className="font-semibold text-slate-700 print:text-xs">Data</TableHead>
                  <TableHead className="font-semibold text-slate-700 print:text-xs">Tipo</TableHead>
                  <TableHead className="font-semibold text-slate-700 print:text-xs">Placa</TableHead>
                  <TableHead className="font-semibold text-slate-700 print:text-xs">Motorista</TableHead>
                  <TableHead className="font-semibold text-slate-700 print:text-xs">Produto</TableHead>
                  <TableHead className="font-semibold text-slate-700 print:text-xs">Forn./Dest.</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right print:text-xs">Tara</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right print:text-xs">Bruto</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-right print:text-xs">Líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pesagensFiltradas.map((p) => (
                  <TableRow key={p.id} className="border-b border-slate-100 print:text-xs">
                    <TableCell className="font-medium text-slate-700">{format(new Date(p.data_pesagem), "dd/MM/yyyy", { locale: ptBR })}</TableCell>
                    <TableCell className="text-slate-700">{p.tipo_pesagem}</TableCell>
                    <TableCell className="font-semibold text-slate-900 uppercase">{p.placa_caminhao}</TableCell>
                    <TableCell className="text-slate-700">{p.nome_motorista}</TableCell>
                    <TableCell className="text-slate-700">{p.produto}</TableCell>
                    <TableCell className="text-slate-600">{p.fornecedor_destino || '-'}</TableCell>
                    <TableCell className="text-right font-mono text-slate-700">{formatarNumero(p.peso_tara)}</TableCell>
                    <TableCell className="text-right font-mono text-slate-700">{formatarNumero(p.peso_bruto)}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-green-700">{formatarNumero(p.peso_liquido)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:hidden">
        <Card className="shadow-lg border-green-200">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200">
            <CardTitle className="text-green-900">Pesagens por Tipo</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
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
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200">
            <CardTitle className="text-green-900">Pesagens por Dia</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dadosPorDia}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="data" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="quantidade" stroke="#10b981" strokeWidth={2} name="Quantidade" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200">
            <CardTitle className="text-green-900">Top 5 Produtos (Quantidade)</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dadosPorProduto}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="produto" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="quantidade" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-200">
            <CardTitle className="text-green-900">Top 5 Produtos (Peso Líquido)</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dadosPesoProduto}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="produto" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="peso" fill="#059669" name="Peso (kg)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
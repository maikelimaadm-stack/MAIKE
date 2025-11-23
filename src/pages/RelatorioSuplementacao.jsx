import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Printer, Download, Filter, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function RelatorioSuplementacao() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [pontoFiltro, setPontoFiltro] = useState("todos");
  const [produtoFiltro, setProdutoFiltro] = useState("");
  const [agruparPor, setAgruparPor] = useState("data");

  const { data: empresa } = useQuery({
    queryKey: ['empresa-atual', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Empresa.list();
      return all.find(e => e.id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

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

  const eventosFiltrados = useMemo(() => {
    return eventos.filter(e => {
      const dataEvento = new Date(e.data_lancamento);
      if (dataInicio && dataEvento < new Date(dataInicio)) return false;
      if (dataFim && dataEvento > new Date(dataFim)) return false;
      if (pontoFiltro !== "todos" && e.ponto_suplementacao_id !== pontoFiltro) return false;
      if (produtoFiltro && !e.produto.toLowerCase().includes(produtoFiltro.toLowerCase())) return false;
      return true;
    }).sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento));
  }, [eventos, dataInicio, dataFim, pontoFiltro, produtoFiltro]);

  const dadosAgrupados = useMemo(() => {
    const grupos = {};
    
    eventosFiltrados.forEach(e => {
      let chave;
      switch (agruparPor) {
        case 'ponto':
          chave = e.ponto_nome;
          break;
        case 'produto':
          chave = e.produto;
          break;
        case 'area':
          chave = e.area_nome;
          break;
        case 'mes':
          chave = new Date(e.data_lancamento).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
          break;
        default:
          chave = new Date(e.data_lancamento).toLocaleDateString('pt-BR');
      }
      
      if (!grupos[chave]) {
        grupos[chave] = { eventos: [], total: 0, cabecas: 0 };
      }
      grupos[chave].eventos.push(e);
      grupos[chave].total += e.quantidade_total_kg;
      grupos[chave].cabecas += e.total_cabecas_afetadas;
    });
    
    return Object.entries(grupos).map(([nome, dados]) => ({
      nome,
      eventos: dados.eventos,
      lancamentos: dados.eventos.length,
      total: dados.total,
      media: dados.total / dados.lancamentos,
      cabecas: dados.cabecas / dados.lancamentos
    }));
  }, [eventosFiltrados, agruparPor]);

  const totais = {
    lancamentos: eventosFiltrados.length,
    quantidade: eventosFiltrados.reduce((sum, e) => sum + e.quantidade_total_kg, 0),
    cabecas: eventosFiltrados.reduce((sum, e) => sum + e.total_cabecas_afetadas, 0) / (eventosFiltrados.length || 1),
    consumoMedio: eventosFiltrados.length > 0 
      ? eventosFiltrados.reduce((sum, e) => sum + (e.consumo_medio_por_cabeca_kg || 0), 0) / eventosFiltrados.length
      : 0
  };

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setPontoFiltro("todos");
    setProdutoFiltro("");
  };

  const exportarCSV = () => {
    const headers = ['Data', 'Ponto', 'Área', 'Produto', 'Quantidade (kg)', 'Cabeças', 'Consumo/Cabeça (kg)'];
    const rows = eventosFiltrados.map(e => [
      new Date(e.data_lancamento).toLocaleDateString('pt-BR'),
      e.ponto_nome,
      e.area_nome,
      e.produto,
      e.quantidade_total_kg.toFixed(2),
      e.total_cabecas_afetadas,
      e.consumo_medio_por_cabeca_kg.toFixed(3)
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_suplementacao_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const imprimir = () => {
    window.print();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="print:hidden flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Relatório de Suplementação</h1>
          <p className="text-sm text-slate-600 mt-1">Análise detalhada dos lançamentos de suplementação</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportarCSV}>
            <Download className="w-4 h-4 mr-2" />
            Exportar CSV
          </Button>
          <Button size="sm" onClick={imprimir}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
        </div>
      </div>

      <Card className="print:hidden">
        <CardHeader className="border-b py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Filtros</CardTitle>
            {(dataInicio || dataFim || pontoFiltro !== "todos" || produtoFiltro) && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-7 text-xs">
                <X className="w-3 h-3 mr-1" />
                Limpar
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Data Início</label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Data Fim</label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Ponto</label>
              <Select value={pontoFiltro} onValueChange={setPontoFiltro}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos os pontos</SelectItem>
                  {pontos.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.nome_ponto}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Produto</label>
              <Input
                value={produtoFiltro}
                onChange={(e) => setProdutoFiltro(e.target.value)}
                placeholder="Filtrar por produto..."
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-1 block">Agrupar por</label>
              <Select value={agruparPor} onValueChange={setAgruparPor}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="data" className="text-xs">Data</SelectItem>
                  <SelectItem value="mes" className="text-xs">Mês</SelectItem>
                  <SelectItem value="ponto" className="text-xs">Ponto</SelectItem>
                  <SelectItem value="produto" className="text-xs">Produto</SelectItem>
                  <SelectItem value="area" className="text-xs">Área</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="hidden print:block mb-6">
        <div className="text-center mb-4">
          <h2 className="text-xl font-bold">{empresa?.nome || 'Empresa'}</h2>
          <p className="text-sm text-slate-600">Relatório de Suplementação</p>
          <p className="text-xs text-slate-500">Gerado em {new Date().toLocaleString('pt-BR')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-600">Lançamentos</div>
            <div className="text-2xl font-bold text-slate-900">{totais.lancamentos}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-600">Total Fornecido</div>
            <div className="text-2xl font-bold text-slate-900">{totais.quantidade.toFixed(0)} kg</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-600">Média Cabeças</div>
            <div className="text-2xl font-bold text-slate-900">{totais.cabecas.toFixed(0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-600">Consumo Médio</div>
            <div className="text-2xl font-bold text-slate-900">{totais.consumoMedio.toFixed(3)} kg/cab</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-semibold">
            Dados Agrupados por {agruparPor === 'data' ? 'Data' : agruparPor === 'mes' ? 'Mês' : agruparPor === 'ponto' ? 'Ponto' : agruparPor === 'produto' ? 'Produto' : 'Área'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold text-slate-700">
                    {agruparPor === 'data' ? 'Data' : agruparPor === 'mes' ? 'Mês' : agruparPor === 'ponto' ? 'Ponto' : agruparPor === 'produto' ? 'Produto' : 'Área'}
                  </th>
                  <th className="text-right py-2 font-semibold text-slate-700">Lançamentos</th>
                  <th className="text-right py-2 font-semibold text-slate-700">Total (kg)</th>
                  <th className="text-right py-2 font-semibold text-slate-700">Média (kg)</th>
                  <th className="text-right py-2 font-semibold text-slate-700">Cabeças</th>
                </tr>
              </thead>
              <tbody>
                {dadosAgrupados.map((grupo, index) => (
                  <tr key={index} className="border-b hover:bg-slate-50">
                    <td className="py-2 text-slate-900">{grupo.nome}</td>
                    <td className="text-right py-2 text-slate-700">{grupo.lancamentos}</td>
                    <td className="text-right py-2 text-slate-700">{grupo.total.toFixed(1)}</td>
                    <td className="text-right py-2 text-slate-700">{grupo.media.toFixed(1)}</td>
                    <td className="text-right py-2 text-slate-700">{grupo.cabecas.toFixed(0)}</td>
                  </tr>
                ))}
                <tr className="font-bold bg-slate-50">
                  <td className="py-2 text-slate-900">TOTAL GERAL</td>
                  <td className="text-right py-2 text-slate-900">{totais.lancamentos}</td>
                  <td className="text-right py-2 text-slate-900">{totais.quantidade.toFixed(1)}</td>
                  <td className="text-right py-2 text-slate-900">-</td>
                  <td className="text-right py-2 text-slate-900">{totais.cabecas.toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="print:break-before-page">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm font-semibold">Detalhamento dos Lançamentos</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 font-semibold text-slate-700">Data</th>
                  <th className="text-left py-2 font-semibold text-slate-700">Ponto</th>
                  <th className="text-left py-2 font-semibold text-slate-700">Área</th>
                  <th className="text-left py-2 font-semibold text-slate-700">Produto</th>
                  <th className="text-right py-2 font-semibold text-slate-700">Quantidade (kg)</th>
                  <th className="text-right py-2 font-semibold text-slate-700">Cabeças</th>
                  <th className="text-right py-2 font-semibold text-slate-700">kg/cab</th>
                </tr>
              </thead>
              <tbody>
                {eventosFiltrados.map((evento, index) => (
                  <tr key={index} className="border-b hover:bg-slate-50">
                    <td className="py-2 text-slate-700">
                      {new Date(evento.data_lancamento).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="py-2 text-slate-700">{evento.ponto_nome}</td>
                    <td className="py-2 text-slate-700">{evento.area_nome}</td>
                    <td className="py-2 text-slate-700">{evento.produto}</td>
                    <td className="text-right py-2 text-slate-700">{evento.quantidade_total_kg.toFixed(1)}</td>
                    <td className="text-right py-2 text-slate-700">{evento.total_cabecas_afetadas}</td>
                    <td className="text-right py-2 text-slate-700">{(evento.consumo_medio_por_cabeca_kg || 0).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
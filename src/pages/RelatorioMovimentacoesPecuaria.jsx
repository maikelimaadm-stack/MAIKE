import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Printer, Settings, TrendingUp, TrendingDown, ArrowRightLeft, List, BarChart3, FileText, Filter } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0";
  return numero.toLocaleString('pt-BR');
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return format(date, 'dd/MM/yyyy', { locale: ptBR });
  } catch {
    return '-';
  }
};

export default function RelatorioMovimentacoesPecuaria() {
  const [tipoRelatorio, setTipoRelatorio] = useState("resumo");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [categoriaSelecionada, setCategoriaSelecionada] = useState("todas");
  const [marcaSelecionada, setMarcaSelecionada] = useState("todas");
  const [tipoSelecionado, setTipoSelecionado] = useState("todos");

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['movimentacoes-pecuaria-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return null;
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaSelecionadaId) || null;
    },
    enabled: !!empresaSelecionadaId,
  });

  const categoriasUnicas = [...new Set(movimentacoes.map(m => m.categoria_animal))].filter(Boolean).sort();
  const marcasUnicas = [...new Set(movimentacoes.map(m => m.marca))].filter(Boolean).sort();

  const movimentacoesFiltradas = useMemo(() => {
    return movimentacoes.filter(m => {
      if (tipoSelecionado !== "todos" && m.tipo !== tipoSelecionado) return false;
      if (categoriaSelecionada !== "todas" && m.categoria_animal !== categoriaSelecionada) return false;
      if (marcaSelecionada !== "todas" && m.marca !== marcaSelecionada) return false;
      
      if (dataInicio) {
        const dataMovimentacao = new Date(m.data_movimentacao);
        const inicio = new Date(dataInicio);
        if (dataMovimentacao < inicio) return false;
      }
      if (dataFim) {
        const dataMovimentacao = new Date(m.data_movimentacao);
        const fim = new Date(dataFim);
        fim.setHours(23, 59, 59);
        if (dataMovimentacao > fim) return false;
      }
      
      return true;
    });
  }, [movimentacoes, tipoSelecionado, categoriaSelecionada, marcaSelecionada, dataInicio, dataFim]);

  // Calcular resumos por categoria
  const resumoPorCategoria = useMemo(() => {
    const resumo = {};
    
    movimentacoesFiltradas.forEach(m => {
      const cat = m.categoria_animal || 'Sem Categoria';
      if (!resumo[cat]) {
        resumo[cat] = { entradas: 0, saidas: 0, saldo: 0 };
      }
      
      const qtd = m.quantidade_animais || 0;
      if (m.tipo === 'Entrada') {
        resumo[cat].entradas += qtd;
        resumo[cat].saldo += qtd;
      } else if (m.tipo === 'Saída') {
        resumo[cat].saidas += qtd;
        resumo[cat].saldo -= qtd;
      }
    });
    
    return Object.entries(resumo)
      .map(([categoria, dados]) => ({ categoria, ...dados }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria, 'pt-BR'));
  }, [movimentacoesFiltradas]);

  // Calcular resumos por marca
  const resumoPorMarca = useMemo(() => {
    const resumo = {};
    
    movimentacoesFiltradas.forEach(m => {
      const marca = m.marca || 'Sem Marca';
      if (!resumo[marca]) {
        resumo[marca] = { entradas: 0, saidas: 0, saldo: 0 };
      }
      
      const qtd = m.quantidade_animais || 0;
      if (m.tipo === 'Entrada') {
        resumo[marca].entradas += qtd;
        resumo[marca].saldo += qtd;
      } else if (m.tipo === 'Saída') {
        resumo[marca].saidas += qtd;
        resumo[marca].saldo -= qtd;
      }
    });
    
    return Object.entries(resumo)
      .map(([marca, dados]) => ({ marca, ...dados }))
      .sort((a, b) => a.marca.localeCompare(b.marca, 'pt-BR'));
  }, [movimentacoesFiltradas]);

  // Calcular resumos por motivo
  const resumoPorMotivo = useMemo(() => {
    const resumo = {};
    
    movimentacoesFiltradas.forEach(m => {
      const motivo = m.motivo || 'Sem Motivo';
      const chave = `${m.tipo} - ${motivo}`;
      if (!resumo[chave]) {
        resumo[chave] = { tipo: m.tipo, motivo, quantidade: 0 };
      }
      resumo[chave].quantidade += m.quantidade_animais || 0;
    });
    
    return Object.values(resumo).sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
      return b.quantidade - a.quantidade;
    });
  }, [movimentacoesFiltradas]);

  const totalEntradas = movimentacoesFiltradas.filter(m => m.tipo === 'Entrada').reduce((sum, m) => sum + (m.quantidade_animais || 0), 0);
  const totalSaidas = movimentacoesFiltradas.filter(m => m.tipo === 'Saída').reduce((sum, m) => sum + (m.quantidade_animais || 0), 0);
  const saldoPeriodo = totalEntradas - totalSaidas;

  const limparFiltros = () => {
    setTipoSelecionado("todos");
    setCategoriaSelecionada("todas");
    setMarcaSelecionada("todas");
    setDataInicio("");
    setDataFim("");
    toast.info("Filtros limpos!");
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Movimentações Pecuárias</h1>
          <p className="text-xs text-slate-600">Análise completa de entradas, saídas e saldos do rebanho</p>
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros */}
      <Card className="shadow-sm print:hidden">
        <CardHeader className="py-2 px-4 bg-slate-50 border-b">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={tipoSelecionado} onValueChange={setTipoSelecionado}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  <SelectItem value="Entrada" className="text-xs">Entradas</SelectItem>
                  <SelectItem value="Saída" className="text-xs">Saídas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={categoriaSelecionada} onValueChange={setCategoriaSelecionada}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                  {categoriasUnicas.map(cat => (
                    <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Marca</Label>
              <Select value={marcaSelecionada} onValueChange={setMarcaSelecionada}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                  {marcasUnicas.map(marca => (
                    <SelectItem key={marca} value={marca} className="text-xs">{marca}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex items-end">
              <Button variant="outline" size="sm" onClick={limparFiltros} className="h-8 text-xs w-full">
                Limpar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cards de resumo geral */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="shadow-sm border-l-4 border-l-blue-500">
          <CardContent className="p-3">
            <p className="text-[10px] font-medium text-slate-600">Total Movimentações</p>
            <p className="text-xl font-bold text-blue-700">{movimentacoesFiltradas.length}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-l-4 border-l-emerald-500">
          <CardContent className="p-3">
            <p className="text-[10px] font-medium text-slate-600">Total Entradas</p>
            <p className="text-xl font-bold text-emerald-700">+{formatarNumero(totalEntradas)} cab</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-l-4 border-l-red-500">
          <CardContent className="p-3">
            <p className="text-[10px] font-medium text-slate-600">Total Saídas</p>
            <p className="text-xl font-bold text-red-700">-{formatarNumero(totalSaidas)} cab</p>
          </CardContent>
        </Card>
        <Card className={`shadow-sm border-l-4 ${saldoPeriodo >= 0 ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
          <CardContent className="p-3">
            <p className="text-[10px] font-medium text-slate-600">Saldo Período</p>
            <p className={`text-xl font-bold ${saldoPeriodo >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Abas de relatórios */}
      <Tabs value={tipoRelatorio} onValueChange={setTipoRelatorio} className="print:hidden">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="resumo" className="text-xs gap-1">
            <BarChart3 className="w-3.5 h-3.5" />
            Resumo
          </TabsTrigger>
          <TabsTrigger value="categoria" className="text-xs gap-1">
            <List className="w-3.5 h-3.5" />
            Categoria
          </TabsTrigger>
          <TabsTrigger value="marca" className="text-xs gap-1">
            <List className="w-3.5 h-3.5" />
            Marca
          </TabsTrigger>
          <TabsTrigger value="lista" className="text-xs gap-1">
            <FileText className="w-3.5 h-3.5" />
            Lista
          </TabsTrigger>
        </TabsList>

        {/* Resumo por Motivo */}
        <TabsContent value="resumo" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader className="py-2 px-4 bg-slate-50 border-b">
              <CardTitle className="text-sm font-semibold">Resumo por Motivo</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-semibold">Tipo</TableHead>
                    <TableHead className="text-xs font-semibold">Motivo</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Quantidade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumoPorMotivo.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-xs">
                        <Badge variant="outline" className={item.tipo === 'Entrada' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                          {item.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-medium">{item.motivo}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold">{formatarNumero(item.quantidade)} cab</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Por Categoria */}
        <TabsContent value="categoria" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader className="py-2 px-4 bg-slate-50 border-b">
              <CardTitle className="text-sm font-semibold">Saldo por Categoria</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-semibold">Categoria</TableHead>
                    <TableHead className="text-xs font-semibold text-center text-green-700">
                      <div className="flex items-center justify-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Entradas
                      </div>
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-center text-red-700">
                      <div className="flex items-center justify-center gap-1">
                        <TrendingDown className="w-3 h-3" /> Saídas
                      </div>
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-center text-blue-700">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumoPorCategoria.map((item) => (
                    <TableRow key={item.categoria}>
                      <TableCell className="text-xs font-medium">{item.categoria}</TableCell>
                      <TableCell className="text-xs text-center font-mono text-green-700 font-semibold">+{formatarNumero(item.entradas)}</TableCell>
                      <TableCell className="text-xs text-center font-mono text-red-700 font-semibold">-{formatarNumero(item.saidas)}</TableCell>
                      <TableCell className={`text-xs text-center font-mono font-bold ${item.saldo >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                        {item.saldo >= 0 ? '+' : ''}{formatarNumero(item.saldo)} cab
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-100 border-t-2">
                    <TableCell className="text-xs font-bold">TOTAL</TableCell>
                    <TableCell className="text-xs text-center font-mono text-green-700 font-bold">+{formatarNumero(totalEntradas)}</TableCell>
                    <TableCell className="text-xs text-center font-mono text-red-700 font-bold">-{formatarNumero(totalSaidas)}</TableCell>
                    <TableCell className={`text-xs text-center font-mono font-bold ${saldoPeriodo >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                      {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Por Marca */}
        <TabsContent value="marca" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader className="py-2 px-4 bg-slate-50 border-b">
              <CardTitle className="text-sm font-semibold">Saldo por Marca</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="text-xs font-semibold">Marca</TableHead>
                    <TableHead className="text-xs font-semibold text-center text-green-700">
                      <div className="flex items-center justify-center gap-1">
                        <TrendingUp className="w-3 h-3" /> Entradas
                      </div>
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-center text-red-700">
                      <div className="flex items-center justify-center gap-1">
                        <TrendingDown className="w-3 h-3" /> Saídas
                      </div>
                    </TableHead>
                    <TableHead className="text-xs font-semibold text-center text-blue-700">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumoPorMarca.map((item) => (
                    <TableRow key={item.marca}>
                      <TableCell className="text-xs font-medium">{item.marca}</TableCell>
                      <TableCell className="text-xs text-center font-mono text-green-700 font-semibold">+{formatarNumero(item.entradas)}</TableCell>
                      <TableCell className="text-xs text-center font-mono text-red-700 font-semibold">-{formatarNumero(item.saidas)}</TableCell>
                      <TableCell className={`text-xs text-center font-mono font-bold ${item.saldo >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                        {item.saldo >= 0 ? '+' : ''}{formatarNumero(item.saldo)} cab
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-100 border-t-2">
                    <TableCell className="text-xs font-bold">TOTAL</TableCell>
                    <TableCell className="text-xs text-center font-mono text-green-700 font-bold">+{formatarNumero(totalEntradas)}</TableCell>
                    <TableCell className="text-xs text-center font-mono text-red-700 font-bold">-{formatarNumero(totalSaidas)}</TableCell>
                    <TableCell className={`text-xs text-center font-mono font-bold ${saldoPeriodo >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                      {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Lista Detalhada */}
        <TabsContent value="lista" className="mt-4">
          <Card className="shadow-sm">
            <CardHeader className="py-2 px-4 bg-slate-50 border-b">
              <CardTitle className="text-sm font-semibold">Lista Detalhada de Movimentações</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[500px]">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs font-semibold">Data</TableHead>
                      <TableHead className="text-xs font-semibold">Tipo</TableHead>
                      <TableHead className="text-xs font-semibold">Motivo</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Qtd</TableHead>
                      <TableHead className="text-xs font-semibold">Categoria</TableHead>
                      <TableHead className="text-xs font-semibold">Marca</TableHead>
                      <TableHead className="text-xs font-semibold">Sexo</TableHead>
                      <TableHead className="text-xs font-semibold">Área</TableHead>
                      <TableHead className="text-xs font-semibold">Fornec./Comprador</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movimentacoesFiltradas.slice(0, 100).map((m) => {
                      const areaExibir = m.tipo === 'Entrada' ? m.area_destino_nome : m.area_origem_nome;
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs">{formatarData(m.data_movimentacao)}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className={m.tipo === 'Entrada' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                              {m.tipo}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{m.motivo || '-'}</TableCell>
                          <TableCell className="text-xs text-right font-mono font-semibold">{m.quantidade_animais}</TableCell>
                          <TableCell className="text-xs">{m.categoria_animal || '-'}</TableCell>
                          <TableCell className="text-xs font-semibold text-blue-700">{m.marca || '-'}</TableCell>
                          <TableCell className="text-xs">{m.sexo || '-'}</TableCell>
                          <TableCell className="text-xs">{areaExibir || '-'}</TableCell>
                          <TableCell className="text-xs">{m.fornecedor_origem || m.destino_venda || '-'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {movimentacoesFiltradas.length > 100 && (
                <div className="p-2 text-center text-xs text-slate-500 bg-slate-50 border-t">
                  Mostrando 100 de {movimentacoesFiltradas.length} registros. Use os filtros para refinar.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Área de Impressão */}
      <div className="hidden print:block print-area">
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page { size: A4 landscape; margin: 1cm; }
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; }
          }
        `}} />
        
        <div className="p-4">
          <div className="border-b-2 border-black pb-2 mb-4">
            <h1 className="text-lg font-bold">{empresaAtual?.nome || 'Empresa'}</h1>
            <h2 className="text-base font-semibold">Relatório de Movimentações Pecuárias</h2>
            {(dataInicio || dataFim) && (
              <p className="text-xs">Período: {dataInicio ? formatarData(dataInicio) : 'Início'} a {dataFim ? formatarData(dataFim) : 'Atual'}</p>
            )}
          </div>

          <div className="mb-4 p-2 bg-gray-100 rounded text-sm">
            <strong>Resumo:</strong> Entradas: +{formatarNumero(totalEntradas)} cab | Saídas: -{formatarNumero(totalSaidas)} cab | Saldo: {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
          </div>

          <h3 className="text-sm font-bold mb-2">Saldo por Categoria</h3>
          <table className="w-full text-xs border-collapse mb-4">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-black p-1 text-left">Categoria</th>
                <th className="border border-black p-1 text-right">Entradas</th>
                <th className="border border-black p-1 text-right">Saídas</th>
                <th className="border border-black p-1 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {resumoPorCategoria.map((item) => (
                <tr key={item.categoria}>
                  <td className="border border-gray-300 p-1">{item.categoria}</td>
                  <td className="border border-gray-300 p-1 text-right text-green-700">+{formatarNumero(item.entradas)}</td>
                  <td className="border border-gray-300 p-1 text-right text-red-700">-{formatarNumero(item.saidas)}</td>
                  <td className="border border-gray-300 p-1 text-right font-bold">{item.saldo >= 0 ? '+' : ''}{formatarNumero(item.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="text-sm font-bold mb-2">Saldo por Marca</h3>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-200">
                <th className="border border-black p-1 text-left">Marca</th>
                <th className="border border-black p-1 text-right">Entradas</th>
                <th className="border border-black p-1 text-right">Saídas</th>
                <th className="border border-black p-1 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {resumoPorMarca.map((item) => (
                <tr key={item.marca}>
                  <td className="border border-gray-300 p-1">{item.marca}</td>
                  <td className="border border-gray-300 p-1 text-right text-green-700">+{formatarNumero(item.entradas)}</td>
                  <td className="border border-gray-300 p-1 text-right text-red-700">-{formatarNumero(item.saidas)}</td>
                  <td className="border border-gray-300 p-1 text-right font-bold">{item.saldo >= 0 ? '+' : ''}{formatarNumero(item.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 pt-2 border-t text-center text-xs text-gray-500">
            Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          </div>
        </div>
      </div>
    </div>
  );
}
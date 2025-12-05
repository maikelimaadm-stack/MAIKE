import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { 
  RefreshCw, Calendar, Filter, X, ChevronRight, ChevronDown, 
  Beef, Scale, DollarSign, Package, Eye, List
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0";
  return numero.toLocaleString('pt-BR');
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const dataStr = dataString.split('T')[0];
    const [ano, mes, dia] = dataStr.split('-');
    return `${dia}/${mes}/${ano}`;
  } catch { return '--/--/----'; }
};

export default function DashboardPublico() {
  const urlParams = new URLSearchParams(window.location.search);
  const empresaIdParam = urlParams.get('empresa');
  
  const [empresaSelecionada, setEmpresaSelecionada] = useState(empresaIdParam || localStorage.getItem('empresa_selecionada_id') || '');
  const [periodoFiltro, setPeriodoFiltro] = useState('mes_atual');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [abaAtiva, setAbaAtiva] = useState('pecuaria');

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
      case 'todos':
        return { dataInicioCalc: null, dataFimCalc: null };
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

  // Refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchMov(), refetchPes(), refetchFin(), refetchProd()]);
    setIsRefreshing(false);
  };

  const isLoading = loadingMov || loadingPes || loadingFin;

  return (
    <div className="min-h-screen bg-slate-50 p-2 md:p-4">
      {/* Header Compacto */}
      <div className="bg-white rounded-lg p-3 shadow-sm border mb-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {empresaAtual?.logotipo_url && (
                <img src={empresaAtual.logotipo_url} alt="Logo" className="h-8 w-8 object-contain rounded" />
              )}
              <div>
                <h1 className="text-sm font-bold text-slate-900">{empresaAtual?.apelido || empresaAtual?.nome || 'Dashboard'}</h1>
                <p className="text-[10px] text-slate-500">Painel Executivo</p>
              </div>
            </div>
            <Button onClick={handleRefresh} disabled={isRefreshing} size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700">
              <RefreshCw className={`w-3 h-3 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>

          {/* Filtros de Período */}
          <div className="flex flex-wrap items-center gap-2">
            {!empresaIdParam && empresas.length > 1 && (
              <Select value={empresaSelecionada} onValueChange={setEmpresaSelecionada}>
                <SelectTrigger className="h-7 w-36 text-xs">
                  <SelectValue placeholder="Empresa" />
                </SelectTrigger>
                <SelectContent>
                  {empresas.map(e => (
                    <SelectItem key={e.id} value={e.id}>{e.apelido || e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Select value={periodoFiltro} onValueChange={setPeriodoFiltro}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="ultimos_7">Últimos 7 dias</SelectItem>
                <SelectItem value="ultimos_30">Últimos 30 dias</SelectItem>
                <SelectItem value="mes_atual">Mês Atual</SelectItem>
                <SelectItem value="ano_atual">Ano Atual</SelectItem>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="personalizado">Personalizado</SelectItem>
              </SelectContent>
            </Select>

            {periodoFiltro === 'personalizado' && (
              <>
                <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="h-7 w-28 text-xs" />
                <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="h-7 w-28 text-xs" />
              </>
            )}

            <Badge variant="outline" className="text-[10px] h-6">
              <Calendar className="w-3 h-3 mr-1" />
              {dataInicioCalc && dataFimCalc 
                ? `${formatarData(dataInicioCalc)} a ${formatarData(dataFimCalc)}`
                : 'Todo período'}
            </Badge>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
        </div>
      ) : (
        <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
          <TabsList className="bg-white border w-full justify-start overflow-x-auto">
            <TabsTrigger value="pecuaria" className="text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <Beef className="w-3 h-3 mr-1" /> Pecuária
            </TabsTrigger>
            <TabsTrigger value="pesagens" className="text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <Scale className="w-3 h-3 mr-1" /> Pesagens
            </TabsTrigger>
            <TabsTrigger value="financeiro" className="text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <DollarSign className="w-3 h-3 mr-1" /> Financeiro
            </TabsTrigger>
            <TabsTrigger value="estoque" className="text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <Package className="w-3 h-3 mr-1" /> Estoque
            </TabsTrigger>
          </TabsList>

          {/* TAB PECUÁRIA */}
          <TabsContent value="pecuaria" className="mt-3">
            <SecaoPecuaria 
              movimentacoes={movimentacoes} 
              dataInicioCalc={dataInicioCalc} 
              dataFimCalc={dataFimCalc} 
            />
          </TabsContent>

          {/* TAB PESAGENS */}
          <TabsContent value="pesagens" className="mt-3">
            <SecaoPesagens 
              pesagens={pesagensInd} 
              dataInicioCalc={dataInicioCalc} 
              dataFimCalc={dataFimCalc} 
            />
          </TabsContent>

          {/* TAB FINANCEIRO */}
          <TabsContent value="financeiro" className="mt-3">
            <SecaoFinanceiro 
              lancamentos={lancamentos} 
              dataInicioCalc={dataInicioCalc} 
              dataFimCalc={dataFimCalc} 
            />
          </TabsContent>

          {/* TAB ESTOQUE */}
          <TabsContent value="estoque" className="mt-3">
            <SecaoEstoque produtos={produtos} />
          </TabsContent>
        </Tabs>
      )}

      {/* Footer */}
      <div className="mt-4 text-center text-slate-400 text-[10px]">
        Atualizado: {format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}
      </div>
    </div>
  );
}

// ========== SEÇÃO PECUÁRIA ==========
function SecaoPecuaria({ movimentacoes, dataInicioCalc, dataFimCalc }) {
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroMotivo, setFiltroMotivo] = useState('todos');
  const [filtroCategoria, setFiltroCategoria] = useState('todos');
  const [filtroMarca, setFiltroMarca] = useState('todos');
  const [filtroSetor, setFiltroSetor] = useState('todos');
  const [expandido, setExpandido] = useState(null);

  // Filtrar por período
  const movPeriodo = useMemo(() => {
    return movimentacoes.filter(m => {
      if (!m.data_movimentacao) return false;
      const dataM = m.data_movimentacao.split('T')[0];
      if (dataInicioCalc && dataM < dataInicioCalc) return false;
      if (dataFimCalc && dataM > dataFimCalc) return false;
      return true;
    });
  }, [movimentacoes, dataInicioCalc, dataFimCalc]);

  // Valores únicos
  const motivosUnicos = [...new Set(movPeriodo.map(m => m.motivo))].filter(Boolean).sort();
  const categoriasUnicas = [...new Set(movPeriodo.map(m => m.categoria_animal))].filter(Boolean).sort();
  const marcasUnicas = [...new Set(movPeriodo.map(m => m.marca))].filter(Boolean).sort();
  const setoresUnicos = [...new Set(movPeriodo.map(m => m.setor_nome))].filter(Boolean).sort();

  // Aplicar filtros
  const movFiltradas = useMemo(() => {
    return movPeriodo.filter(m => {
      if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false;
      if (filtroMotivo !== 'todos' && m.motivo !== filtroMotivo) return false;
      if (filtroCategoria !== 'todos' && m.categoria_animal !== filtroCategoria) return false;
      if (filtroMarca !== 'todos' && m.marca !== filtroMarca) return false;
      if (filtroSetor !== 'todos' && m.setor_nome !== filtroSetor) return false;
      return true;
    });
  }, [movPeriodo, filtroTipo, filtroMotivo, filtroCategoria, filtroMarca, filtroSetor]);

  // Resumo
  const resumo = useMemo(() => {
    const entradas = movFiltradas.filter(m => m.tipo === 'Entrada');
    const saidas = movFiltradas.filter(m => m.tipo === 'Saída');
    
    const totalEntradas = entradas.reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const totalSaidas = saidas.reduce((s, m) => s + (m.quantidade_animais || 0), 0);

    // Por motivo
    const porMotivo = {};
    movFiltradas.forEach(m => {
      const motivo = m.motivo || 'Sem motivo';
      if (!porMotivo[motivo]) porMotivo[motivo] = { entradas: 0, saidas: 0, valor: 0, registros: [] };
      if (m.tipo === 'Entrada') {
        porMotivo[motivo].entradas += m.quantidade_animais || 0;
      } else {
        porMotivo[motivo].saidas += m.quantidade_animais || 0;
      }
      porMotivo[motivo].valor += m.valor_total || 0;
      porMotivo[motivo].registros.push(m);
    });

    // Por categoria
    const porCategoria = {};
    movFiltradas.forEach(m => {
      const cat = m.categoria_animal || 'Sem categoria';
      if (!porCategoria[cat]) porCategoria[cat] = { entradas: 0, saidas: 0, registros: [] };
      if (m.tipo === 'Entrada') {
        porCategoria[cat].entradas += m.quantidade_animais || 0;
      } else {
        porCategoria[cat].saidas += m.quantidade_animais || 0;
      }
      porCategoria[cat].registros.push(m);
    });

    // Por setor
    const porSetor = {};
    movFiltradas.forEach(m => {
      const setor = m.setor_nome || 'Sem setor';
      if (!porSetor[setor]) porSetor[setor] = { entradas: 0, saidas: 0, registros: [] };
      if (m.tipo === 'Entrada') {
        porSetor[setor].entradas += m.quantidade_animais || 0;
      } else {
        porSetor[setor].saidas += m.quantidade_animais || 0;
      }
      porSetor[setor].registros.push(m);
    });

    return { totalEntradas, totalSaidas, saldo: totalEntradas - totalSaidas, porMotivo, porCategoria, porSetor, total: movFiltradas.length };
  }, [movFiltradas]);

  const limparFiltros = () => {
    setFiltroTipo('todos');
    setFiltroMotivo('todos');
    setFiltroCategoria('todos');
    setFiltroMarca('todos');
    setFiltroSetor('todos');
  };

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos Tipos</SelectItem>
                <SelectItem value="Entrada">Entrada</SelectItem>
                <SelectItem value="Saída">Saída</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroMotivo} onValueChange={setFiltroMotivo}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Motivo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos Motivos</SelectItem>
                {motivosUnicos.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas Categorias</SelectItem>
                {categoriasUnicas.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroMarca} onValueChange={setFiltroMarca}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Marca" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas Marcas</SelectItem>
                {marcasUnicas.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroSetor} onValueChange={setFiltroSetor}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Setor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos Setores</SelectItem>
                {setoresUnicos.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={limparFiltros}>
              <X className="w-3 h-3 mr-1" /> Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumo Geral */}
      <Card className="bg-emerald-50 border-emerald-200">
        <CardContent className="p-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-[10px] text-slate-600">Registros</p>
              <p className="text-lg font-bold text-slate-800">{formatarNumero(resumo.total)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Entradas</p>
              <p className="text-lg font-bold text-green-600">+{formatarNumero(resumo.totalEntradas)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Saídas</p>
              <p className="text-lg font-bold text-red-600">-{formatarNumero(resumo.totalSaidas)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Saldo</p>
              <p className={`text-lg font-bold ${resumo.saldo >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                {formatarNumero(resumo.saldo)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista por Motivo */}
      <Card>
        <CardHeader className="py-2 px-3 border-b bg-slate-50">
          <CardTitle className="text-xs font-semibold">Por Motivo</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {Object.entries(resumo.porMotivo).sort((a, b) => (b[1].entradas + b[1].saidas) - (a[1].entradas + a[1].saidas)).map(([motivo, dados]) => (
            <div key={motivo} className="border-b last:border-b-0">
              <div 
                className="flex items-center justify-between p-2 hover:bg-slate-50 cursor-pointer"
                onClick={() => setExpandido(expandido === `motivo-${motivo}` ? null : `motivo-${motivo}`)}
              >
                <div className="flex items-center gap-2">
                  {expandido === `motivo-${motivo}` ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-xs font-medium">{motivo}</span>
                  <Badge variant="outline" className="text-[10px]">{dados.registros.length} reg.</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {dados.entradas > 0 && <span className="text-green-600">+{formatarNumero(dados.entradas)}</span>}
                  {dados.saidas > 0 && <span className="text-red-600">-{formatarNumero(dados.saidas)}</span>}
                  {dados.valor > 0 && <span className="text-slate-500">{formatarMoeda(dados.valor)}</span>}
                </div>
              </div>
              {expandido === `motivo-${motivo}` && (
                <div className="bg-slate-50 p-2 max-h-60 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] py-1">Data</TableHead>
                        <TableHead className="text-[10px] py-1">Tipo</TableHead>
                        <TableHead className="text-[10px] py-1 text-right">Qtd</TableHead>
                        <TableHead className="text-[10px] py-1">Categoria</TableHead>
                        <TableHead className="text-[10px] py-1">Marca</TableHead>
                        <TableHead className="text-[10px] py-1">Setor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dados.registros.slice(0, 50).map((m, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-[10px] py-1">{formatarData(m.data_movimentacao)}</TableCell>
                          <TableCell className="text-[10px] py-1">
                            <Badge className={`text-[9px] ${m.tipo === 'Entrada' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {m.tipo}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] py-1 text-right font-medium">{m.quantidade_animais}</TableCell>
                          <TableCell className="text-[10px] py-1">{m.categoria_animal || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1">{m.marca || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1">{m.setor_nome || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {dados.registros.length > 50 && (
                    <p className="text-[10px] text-center text-slate-500 mt-1">Mostrando 50 de {dados.registros.length} registros</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Lista por Categoria */}
      <Card>
        <CardHeader className="py-2 px-3 border-b bg-slate-50">
          <CardTitle className="text-xs font-semibold">Por Categoria</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {Object.entries(resumo.porCategoria).sort((a, b) => Math.abs(b[1].entradas - b[1].saidas) - Math.abs(a[1].entradas - a[1].saidas)).map(([cat, dados]) => (
            <div key={cat} className="border-b last:border-b-0">
              <div 
                className="flex items-center justify-between p-2 hover:bg-slate-50 cursor-pointer"
                onClick={() => setExpandido(expandido === `cat-${cat}` ? null : `cat-${cat}`)}
              >
                <div className="flex items-center gap-2">
                  {expandido === `cat-${cat}` ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-xs font-medium">{cat}</span>
                  <Badge variant="outline" className="text-[10px]">{dados.registros.length} reg.</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {dados.entradas > 0 && <span className="text-green-600">+{formatarNumero(dados.entradas)}</span>}
                  {dados.saidas > 0 && <span className="text-red-600">-{formatarNumero(dados.saidas)}</span>}
                  <span className={`font-bold ${(dados.entradas - dados.saidas) >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    = {formatarNumero(dados.entradas - dados.saidas)}
                  </span>
                </div>
              </div>
              {expandido === `cat-${cat}` && (
                <div className="bg-slate-50 p-2 max-h-60 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] py-1">Data</TableHead>
                        <TableHead className="text-[10px] py-1">Tipo</TableHead>
                        <TableHead className="text-[10px] py-1">Motivo</TableHead>
                        <TableHead className="text-[10px] py-1 text-right">Qtd</TableHead>
                        <TableHead className="text-[10px] py-1">Marca</TableHead>
                        <TableHead className="text-[10px] py-1">Setor</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dados.registros.slice(0, 50).map((m, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-[10px] py-1">{formatarData(m.data_movimentacao)}</TableCell>
                          <TableCell className="text-[10px] py-1">
                            <Badge className={`text-[9px] ${m.tipo === 'Entrada' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {m.tipo}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] py-1">{m.motivo || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1 text-right font-medium">{m.quantidade_animais}</TableCell>
                          <TableCell className="text-[10px] py-1">{m.marca || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1">{m.setor_nome || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Lista por Setor */}
      <Card>
        <CardHeader className="py-2 px-3 border-b bg-slate-50">
          <CardTitle className="text-xs font-semibold">Por Setor</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {Object.entries(resumo.porSetor).sort((a, b) => Math.abs(b[1].entradas - b[1].saidas) - Math.abs(a[1].entradas - a[1].saidas)).map(([setor, dados]) => (
            <div key={setor} className="border-b last:border-b-0">
              <div 
                className="flex items-center justify-between p-2 hover:bg-slate-50 cursor-pointer"
                onClick={() => setExpandido(expandido === `setor-${setor}` ? null : `setor-${setor}`)}
              >
                <div className="flex items-center gap-2">
                  {expandido === `setor-${setor}` ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-xs font-medium">{setor}</span>
                  <Badge variant="outline" className="text-[10px]">{dados.registros.length} reg.</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {dados.entradas > 0 && <span className="text-green-600">+{formatarNumero(dados.entradas)}</span>}
                  {dados.saidas > 0 && <span className="text-red-600">-{formatarNumero(dados.saidas)}</span>}
                  <span className={`font-bold ${(dados.entradas - dados.saidas) >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    = {formatarNumero(dados.entradas - dados.saidas)}
                  </span>
                </div>
              </div>
              {expandido === `setor-${setor}` && (
                <div className="bg-slate-50 p-2 max-h-60 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] py-1">Data</TableHead>
                        <TableHead className="text-[10px] py-1">Tipo</TableHead>
                        <TableHead className="text-[10px] py-1">Motivo</TableHead>
                        <TableHead className="text-[10px] py-1 text-right">Qtd</TableHead>
                        <TableHead className="text-[10px] py-1">Categoria</TableHead>
                        <TableHead className="text-[10px] py-1">Marca</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dados.registros.slice(0, 50).map((m, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-[10px] py-1">{formatarData(m.data_movimentacao)}</TableCell>
                          <TableCell className="text-[10px] py-1">
                            <Badge className={`text-[9px] ${m.tipo === 'Entrada' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {m.tipo}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[10px] py-1">{m.motivo || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1 text-right font-medium">{m.quantidade_animais}</TableCell>
                          <TableCell className="text-[10px] py-1">{m.categoria_animal || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1">{m.marca || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ========== SEÇÃO PESAGENS ==========
function SecaoPesagens({ pesagens, dataInicioCalc, dataFimCalc }) {
  const [filtroApartacao, setFiltroApartacao] = useState('todos');
  const [filtroLote, setFiltroLote] = useState('todos');
  const [filtroSexo, setFiltroSexo] = useState('todos');
  const [expandido, setExpandido] = useState(null);

  // Filtrar por período
  const pesPeriodo = useMemo(() => {
    return pesagens.filter(p => {
      if (!p.data_pesagem) return false;
      const dataP = p.data_pesagem.split('T')[0];
      if (dataInicioCalc && dataP < dataInicioCalc) return false;
      if (dataFimCalc && dataP > dataFimCalc) return false;
      return true;
    });
  }, [pesagens, dataInicioCalc, dataFimCalc]);

  const apartacoesUnicas = [...new Set(pesPeriodo.map(p => p.nome_apartacao))].filter(Boolean).sort();
  const lotesUnicos = [...new Set(pesPeriodo.map(p => p.nome_lote))].filter(Boolean).sort();

  const pesFiltradas = useMemo(() => {
    return pesPeriodo.filter(p => {
      if (filtroApartacao !== 'todos' && p.nome_apartacao !== filtroApartacao) return false;
      if (filtroLote !== 'todos' && p.nome_lote !== filtroLote) return false;
      if (filtroSexo !== 'todos' && p.sexo !== filtroSexo) return false;
      return true;
    });
  }, [pesPeriodo, filtroApartacao, filtroLote, filtroSexo]);

  const resumo = useMemo(() => {
    const total = pesFiltradas.length;
    const pesoTotal = pesFiltradas.reduce((s, p) => s + (p.peso || 0), 0);
    const pesoMedio = total > 0 ? pesoTotal / total : 0;
    const comGmd = pesFiltradas.filter(p => p.gmd && p.gmd !== 0);
    const gmdMedio = comGmd.length > 0 ? comGmd.reduce((s, p) => s + p.gmd, 0) / comGmd.length : 0;

    // Por apartação
    const porApartacao = {};
    pesFiltradas.forEach(p => {
      const apt = p.nome_apartacao || 'Sem apartação';
      if (!porApartacao[apt]) porApartacao[apt] = { qtd: 0, peso: 0, registros: [] };
      porApartacao[apt].qtd++;
      porApartacao[apt].peso += p.peso || 0;
      porApartacao[apt].registros.push(p);
    });

    // Por lote
    const porLote = {};
    pesFiltradas.forEach(p => {
      const lote = p.nome_lote || 'Sem lote';
      if (!porLote[lote]) porLote[lote] = { qtd: 0, peso: 0, registros: [] };
      porLote[lote].qtd++;
      porLote[lote].peso += p.peso || 0;
      porLote[lote].registros.push(p);
    });

    return { total, pesoTotal, pesoMedio, gmdMedio, porApartacao, porLote };
  }, [pesFiltradas]);

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            <Select value={filtroApartacao} onValueChange={setFiltroApartacao}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Apartação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas Apartações</SelectItem>
                {apartacoesUnicas.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroLote} onValueChange={setFiltroLote}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Lote" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos Lotes</SelectItem>
                {lotesUnicos.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroSexo} onValueChange={setFiltroSexo}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Sexo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="M">Macho</SelectItem>
                <SelectItem value="F">Fêmea</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setFiltroApartacao('todos'); setFiltroLote('todos'); setFiltroSexo('todos'); }}>
              <X className="w-3 h-3 mr-1" /> Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-[10px] text-slate-600">Animais</p>
              <p className="text-lg font-bold text-slate-800">{formatarNumero(resumo.total)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Peso Total</p>
              <p className="text-lg font-bold text-blue-600">{formatarNumero(resumo.pesoTotal)} kg</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Peso Médio</p>
              <p className="text-lg font-bold text-emerald-600">{resumo.pesoMedio.toFixed(1)} kg</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">GMD Médio</p>
              <p className="text-lg font-bold text-purple-600">{resumo.gmdMedio.toFixed(3)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Por Apartação */}
      <Card>
        <CardHeader className="py-2 px-3 border-b bg-slate-50">
          <CardTitle className="text-xs font-semibold">Por Apartação</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {Object.entries(resumo.porApartacao).sort((a, b) => b[1].qtd - a[1].qtd).map(([apt, dados]) => (
            <div key={apt} className="border-b last:border-b-0">
              <div 
                className="flex items-center justify-between p-2 hover:bg-slate-50 cursor-pointer"
                onClick={() => setExpandido(expandido === `apt-${apt}` ? null : `apt-${apt}`)}
              >
                <div className="flex items-center gap-2">
                  {expandido === `apt-${apt}` ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-xs font-medium">{apt}</span>
                  <Badge variant="outline" className="text-[10px]">{dados.qtd} cab.</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-600">{formatarNumero(dados.peso)} kg</span>
                  <span className="text-blue-600 font-medium">{(dados.peso / dados.qtd).toFixed(1)} kg/cab</span>
                </div>
              </div>
              {expandido === `apt-${apt}` && (
                <div className="bg-slate-50 p-2 max-h-60 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] py-1">Data</TableHead>
                        <TableHead className="text-[10px] py-1">Animal</TableHead>
                        <TableHead className="text-[10px] py-1 text-right">Peso</TableHead>
                        <TableHead className="text-[10px] py-1">Sexo</TableHead>
                        <TableHead className="text-[10px] py-1">Lote</TableHead>
                        <TableHead className="text-[10px] py-1 text-right">GMD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dados.registros.slice(0, 50).map((p, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-[10px] py-1">{formatarData(p.data_pesagem)}</TableCell>
                          <TableCell className="text-[10px] py-1 font-medium">{p.numero_animal}</TableCell>
                          <TableCell className="text-[10px] py-1 text-right">{p.peso} kg</TableCell>
                          <TableCell className="text-[10px] py-1">{p.sexo || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1">{p.nome_lote || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1 text-right">{p.gmd ? p.gmd.toFixed(3) : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Por Lote */}
      <Card>
        <CardHeader className="py-2 px-3 border-b bg-slate-50">
          <CardTitle className="text-xs font-semibold">Por Lote</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {Object.entries(resumo.porLote).sort((a, b) => b[1].qtd - a[1].qtd).map(([lote, dados]) => (
            <div key={lote} className="border-b last:border-b-0">
              <div 
                className="flex items-center justify-between p-2 hover:bg-slate-50 cursor-pointer"
                onClick={() => setExpandido(expandido === `lote-${lote}` ? null : `lote-${lote}`)}
              >
                <div className="flex items-center gap-2">
                  {expandido === `lote-${lote}` ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="text-xs font-medium">{lote}</span>
                  <Badge variant="outline" className="text-[10px]">{dados.qtd} cab.</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-slate-600">{formatarNumero(dados.peso)} kg</span>
                  <span className="text-blue-600 font-medium">{(dados.peso / dados.qtd).toFixed(1)} kg/cab</span>
                </div>
              </div>
              {expandido === `lote-${lote}` && (
                <div className="bg-slate-50 p-2 max-h-60 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] py-1">Data</TableHead>
                        <TableHead className="text-[10px] py-1">Animal</TableHead>
                        <TableHead className="text-[10px] py-1 text-right">Peso</TableHead>
                        <TableHead className="text-[10px] py-1">Sexo</TableHead>
                        <TableHead className="text-[10px] py-1 text-right">GMD</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dados.registros.slice(0, 50).map((p, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="text-[10px] py-1">{formatarData(p.data_pesagem)}</TableCell>
                          <TableCell className="text-[10px] py-1 font-medium">{p.numero_animal}</TableCell>
                          <TableCell className="text-[10px] py-1 text-right">{p.peso} kg</TableCell>
                          <TableCell className="text-[10px] py-1">{p.sexo || '-'}</TableCell>
                          <TableCell className="text-[10px] py-1 text-right">{p.gmd ? p.gmd.toFixed(3) : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ========== SEÇÃO FINANCEIRO ==========
function SecaoFinanceiro({ lancamentos, dataInicioCalc, dataFimCalc }) {
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [expandido, setExpandido] = useState(null);

  const lancPeriodo = useMemo(() => {
    return lancamentos.filter(l => {
      if (!l.data_vencimento) return false;
      const dataL = l.data_vencimento.split('T')[0];
      if (dataInicioCalc && dataL < dataInicioCalc) return false;
      if (dataFimCalc && dataL > dataFimCalc) return false;
      return true;
    });
  }, [lancamentos, dataInicioCalc, dataFimCalc]);

  const lancFiltrados = useMemo(() => {
    return lancPeriodo.filter(l => {
      if (filtroTipo !== 'todos' && l.tipo !== filtroTipo) return false;
      if (filtroStatus !== 'todos' && l.status !== filtroStatus) return false;
      return true;
    });
  }, [lancPeriodo, filtroTipo, filtroStatus]);

  const resumo = useMemo(() => {
    const pagar = lancFiltrados.filter(l => l.tipo === 'Pagar');
    const receber = lancFiltrados.filter(l => l.tipo === 'Receber');

    const totalPagar = pagar.reduce((s, l) => s + (l.valor_total || 0), 0);
    const totalReceber = receber.reduce((s, l) => s + (l.valor_total || 0), 0);

    const vencidos = lancFiltrados.filter(l => l.status === 'Vencido');
    const pendentes = lancFiltrados.filter(l => l.status === 'Pendente');
    const pagos = lancFiltrados.filter(l => l.status === 'Pago');

    return { 
      totalPagar, totalReceber, saldo: totalReceber - totalPagar, 
      pagar, receber, vencidos, pendentes, pagos, total: lancFiltrados.length 
    };
  }, [lancFiltrados]);

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-3 gap-2">
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="Pagar">A Pagar</SelectItem>
                <SelectItem value="Receber">A Receber</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos Status</SelectItem>
                <SelectItem value="Pendente">Pendente</SelectItem>
                <SelectItem value="Pago">Pago</SelectItem>
                <SelectItem value="Vencido">Vencido</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setFiltroTipo('todos'); setFiltroStatus('todos'); }}>
              <X className="w-3 h-3 mr-1" /> Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="p-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <p className="text-[10px] text-slate-600">Registros</p>
              <p className="text-lg font-bold text-slate-800">{resumo.total}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">A Pagar</p>
              <p className="text-sm font-bold text-red-600">{formatarMoeda(resumo.totalPagar)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">A Receber</p>
              <p className="text-sm font-bold text-green-600">{formatarMoeda(resumo.totalReceber)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Saldo</p>
              <p className={`text-sm font-bold ${resumo.saldo >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                {formatarMoeda(resumo.saldo)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vencidos */}
      {resumo.vencidos.length > 0 && (
        <Card className="border-red-300">
          <CardHeader className="py-2 px-3 border-b bg-red-50">
            <CardTitle className="text-xs font-semibold text-red-700">Vencidos ({resumo.vencidos.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-60 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] py-1">Vencimento</TableHead>
                    <TableHead className="text-[10px] py-1">Tipo</TableHead>
                    <TableHead className="text-[10px] py-1">Fornec./Cliente</TableHead>
                    <TableHead className="text-[10px] py-1 text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumo.vencidos.map((l, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-[10px] py-1">{formatarData(l.data_vencimento)}</TableCell>
                      <TableCell className="text-[10px] py-1">
                        <Badge className={`text-[9px] ${l.tipo === 'Receber' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{l.tipo}</Badge>
                      </TableCell>
                      <TableCell className="text-[10px] py-1">{l.fornecedor_nome || l.cliente_nome || '-'}</TableCell>
                      <TableCell className="text-[10px] py-1 text-right font-medium">{formatarMoeda(l.valor_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pendentes */}
      <Card>
        <CardHeader className="py-2 px-3 border-b bg-slate-50">
          <CardTitle className="text-xs font-semibold">Pendentes ({resumo.pendentes.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-60 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] py-1">Vencimento</TableHead>
                  <TableHead className="text-[10px] py-1">Tipo</TableHead>
                  <TableHead className="text-[10px] py-1">Fornec./Cliente</TableHead>
                  <TableHead className="text-[10px] py-1 text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumo.pendentes.slice(0, 30).map((l, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-[10px] py-1">{formatarData(l.data_vencimento)}</TableCell>
                    <TableCell className="text-[10px] py-1">
                      <Badge className={`text-[9px] ${l.tipo === 'Receber' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{l.tipo}</Badge>
                    </TableCell>
                    <TableCell className="text-[10px] py-1">{l.fornecedor_nome || l.cliente_nome || '-'}</TableCell>
                    <TableCell className="text-[10px] py-1 text-right font-medium">{formatarMoeda(l.valor_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ========== SEÇÃO ESTOQUE ==========
function SecaoEstoque({ produtos }) {
  const [filtroCategoria, setFiltroCategoria] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');

  const categoriasUnicas = [...new Set(produtos.map(p => p.categoria))].filter(Boolean).sort();

  const produtosFiltrados = useMemo(() => {
    return produtos.filter(p => {
      if (filtroCategoria !== 'todos' && p.categoria !== filtroCategoria) return false;
      if (filtroStatus === 'baixo' && (p.estoque_atual || 0) >= (p.estoque_minimo || 0)) return false;
      if (filtroStatus === 'ok' && (p.estoque_atual || 0) < (p.estoque_minimo || 0)) return false;
      return true;
    });
  }, [produtos, filtroCategoria, filtroStatus]);

  const resumo = useMemo(() => {
    const total = produtos.length;
    const comEstoque = produtos.filter(p => (p.estoque_atual || 0) > 0).length;
    const abaixoMinimo = produtos.filter(p => (p.estoque_atual || 0) < (p.estoque_minimo || 0)).length;
    return { total, comEstoque, abaixoMinimo };
  }, [produtos]);

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <Card>
        <CardContent className="p-2">
          <div className="grid grid-cols-3 gap-2">
            <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas Categorias</SelectItem>
                {categoriasUnicas.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="baixo">Abaixo do Mínimo</SelectItem>
                <SelectItem value="ok">Estoque OK</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setFiltroCategoria('todos'); setFiltroStatus('todos'); }}>
              <X className="w-3 h-3 mr-1" /> Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      <Card className="bg-purple-50 border-purple-200">
        <CardContent className="p-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] text-slate-600">Total Produtos</p>
              <p className="text-lg font-bold text-slate-800">{resumo.total}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Com Estoque</p>
              <p className="text-lg font-bold text-green-600">{resumo.comEstoque}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-600">Abaixo Mínimo</p>
              <p className="text-lg font-bold text-red-600">{resumo.abaixoMinimo}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Produtos */}
      <Card>
        <CardHeader className="py-2 px-3 border-b bg-slate-50">
          <CardTitle className="text-xs font-semibold">Produtos ({produtosFiltrados.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px] py-1">Produto</TableHead>
                  <TableHead className="text-[10px] py-1">Categoria</TableHead>
                  <TableHead className="text-[10px] py-1 text-right">Estoque</TableHead>
                  <TableHead className="text-[10px] py-1 text-right">Mínimo</TableHead>
                  <TableHead className="text-[10px] py-1">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtosFiltrados.map((p, idx) => {
                  const abaixo = (p.estoque_atual || 0) < (p.estoque_minimo || 0);
                  return (
                    <TableRow key={idx}>
                      <TableCell className="text-[10px] py-1 font-medium">{p.nome_produto}</TableCell>
                      <TableCell className="text-[10px] py-1">{p.categoria || '-'}</TableCell>
                      <TableCell className="text-[10px] py-1 text-right">{formatarNumero(p.estoque_atual || 0)} {p.unidade_medida}</TableCell>
                      <TableCell className="text-[10px] py-1 text-right">{formatarNumero(p.estoque_minimo || 0)}</TableCell>
                      <TableCell className="py-1">
                        <Badge className={`text-[9px] ${abaixo ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
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
    </div>
  );
}
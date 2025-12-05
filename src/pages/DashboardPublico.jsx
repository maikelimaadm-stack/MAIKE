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
  TrendingUp, TrendingDown, Users, Package, Scale, DollarSign, 
  Calendar, RefreshCw, BarChart3, PieChart, Activity, Beef,
  ArrowUp, ArrowDown, Minus, Target, AlertTriangle, Filter,
  X, Eye, ChevronRight, List, FileText
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

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '--/--/----';
    return format(date, "dd/MM/yyyy", { locale: ptBR });
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

  // Filtros específicos
  const [filtroTipos, setFiltroTipos] = useState([]);
  const [filtroMotivos, setFiltroMotivos] = useState([]);
  const [filtroCategorias, setFiltroCategorias] = useState([]);
  const [filtroMarcas, setFiltroMarcas] = useState([]);
  const [filtroSetores, setFiltroSetores] = useState([]);

  // Dialog de detalhes
  const [dialogDetalhes, setDialogDetalhes] = useState({ open: false, titulo: '', dados: [], tipo: '' });

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

  // Valores únicos para filtros
  const tiposUnicos = ['Entrada', 'Saída'];
  const motivosUnicos = [...new Set(movimentacoes.map(m => m.motivo))].filter(Boolean).sort();
  const categoriasUnicas = [...new Set(movimentacoes.map(m => m.categoria_animal))].filter(Boolean).sort();
  const marcasUnicas = [...new Set(movimentacoes.map(m => m.marca))].filter(Boolean).sort();
  const setoresUnicos = [...new Set(movimentacoes.map(m => m.setor_nome))].filter(Boolean).sort();

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

  // Filtrar movimentações por período e filtros
  const movFiltradas = useMemo(() => {
    return movimentacoes.filter(m => {
      if (dataInicioCalc && m.data_movimentacao) {
        const dataM = m.data_movimentacao.split('T')[0];
        if (dataM < dataInicioCalc) return false;
      }
      if (dataFimCalc && m.data_movimentacao) {
        const dataM = m.data_movimentacao.split('T')[0];
        if (dataM > dataFimCalc) return false;
      }
      if (filtroTipos.length > 0 && !filtroTipos.includes(m.tipo)) return false;
      if (filtroMotivos.length > 0 && !filtroMotivos.includes(m.motivo)) return false;
      if (filtroCategorias.length > 0 && !filtroCategorias.includes(m.categoria_animal)) return false;
      if (filtroMarcas.length > 0 && !filtroMarcas.includes(m.marca)) return false;
      if (filtroSetores.length > 0 && !filtroSetores.includes(m.setor_nome)) return false;
      return true;
    });
  }, [movimentacoes, dataInicioCalc, dataFimCalc, filtroTipos, filtroMotivos, filtroCategorias, filtroMarcas, filtroSetores]);

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
    const compras = entradas.filter(m => m.motivo === 'Compra');
    const nascimentos = entradas.filter(m => m.motivo === 'Nascimento');
    const vendas = saidas.filter(m => m.motivo === 'Venda');
    const abates = saidas.filter(m => m.motivo === 'Abate');
    const mortes = saidas.filter(m => m.motivo === 'Morte');

    const qtdCompras = compras.reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const qtdNascimentos = nascimentos.reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const qtdVendas = vendas.reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const qtdAbates = abates.reduce((s, m) => s + (m.quantidade_animais || 0), 0);
    const qtdMortes = mortes.reduce((s, m) => s + (m.quantidade_animais || 0), 0);

    // Valor total vendas
    const valorVendas = [...vendas, ...abates].reduce((s, m) => s + (m.valor_total || 0), 0);
    const valorCompras = compras.reduce((s, m) => s + (m.valor_total || 0), 0);

    // Por categoria
    const porCategoria = {};
    movFiltradas.forEach(m => {
      const cat = m.categoria_animal || 'Sem categoria';
      if (!porCategoria[cat]) porCategoria[cat] = { entradas: 0, saidas: 0, saldo: 0, registros: [] };
      if (m.tipo === 'Entrada') {
        porCategoria[cat].entradas += m.quantidade_animais || 0;
      } else {
        porCategoria[cat].saidas += m.quantidade_animais || 0;
      }
      porCategoria[cat].saldo = porCategoria[cat].entradas - porCategoria[cat].saidas;
      porCategoria[cat].registros.push(m);
    });

    // Por setor
    const porSetor = {};
    movFiltradas.forEach(m => {
      const setor = m.setor_nome || 'Sem setor';
      if (!porSetor[setor]) porSetor[setor] = { entradas: 0, saidas: 0, saldo: 0, registros: [] };
      if (m.tipo === 'Entrada') {
        porSetor[setor].entradas += m.quantidade_animais || 0;
      } else {
        porSetor[setor].saidas += m.quantidade_animais || 0;
      }
      porSetor[setor].saldo = porSetor[setor].entradas - porSetor[setor].saidas;
      porSetor[setor].registros.push(m);
    });

    // Por marca
    const porMarca = {};
    movFiltradas.forEach(m => {
      const marca = m.marca || 'Sem marca';
      if (!porMarca[marca]) porMarca[marca] = { entradas: 0, saidas: 0, saldo: 0, registros: [] };
      if (m.tipo === 'Entrada') {
        porMarca[marca].entradas += m.quantidade_animais || 0;
      } else {
        porMarca[marca].saidas += m.quantidade_animais || 0;
      }
      porMarca[marca].saldo = porMarca[marca].entradas - porMarca[marca].saidas;
      porMarca[marca].registros.push(m);
    });

    return {
      totalEntradas, totalSaidas, saldo,
      compras, nascimentos, vendas, abates, mortes,
      qtdCompras, qtdNascimentos, qtdVendas, qtdAbates, qtdMortes,
      valorVendas, valorCompras,
      porCategoria, porSetor, porMarca,
      entradas, saidas
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
      if (!porApartacao[apt]) porApartacao[apt] = { qtd: 0, peso: 0, registros: [] };
      porApartacao[apt].qtd++;
      porApartacao[apt].peso += p.peso || 0;
      porApartacao[apt].registros.push(p);
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

    const vencidos = lancFiltrados.filter(l => l.status === 'Vencido');
    const pendentes = lancFiltrados.filter(l => l.status === 'Pendente');

    return { totalPagar, totalReceber, saldo, pagoPagar, pagoReceber, vencidos, pendentes, pagar, receber };
  }, [lancFiltrados]);

  // ========== GRÁFICOS ==========
  const dadosMovMensal = useMemo(() => {
    const meses = {};
    movFiltradas.forEach(m => {
      if (!m.data_movimentacao) return;
      const mes = m.data_movimentacao.substring(0, 7);
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

  const dadosCategorias = useMemo(() => {
    return Object.entries(indicadoresPecuaria.porCategoria)
      .map(([nome, dados]) => ({ nome, valor: Math.abs(dados.saldo), ...dados }))
      .filter(d => d.valor > 0)
      .sort((a, b) => b.valor - a.valor);
  }, [indicadoresPecuaria.porCategoria]);

  const dadosSetores = useMemo(() => {
    return Object.entries(indicadoresPecuaria.porSetor)
      .map(([nome, dados]) => ({ nome, entradas: dados.entradas, saidas: dados.saidas, saldo: dados.saldo, registros: dados.registros }))
      .sort((a, b) => b.saldo - a.saldo);
  }, [indicadoresPecuaria.porSetor]);

  // Toggle filtro
  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const limparFiltros = () => {
    setFiltroTipos([]);
    setFiltroMotivos([]);
    setFiltroCategorias([]);
    setFiltroMarcas([]);
    setFiltroSetores([]);
  };

  const totalFiltrosAtivos = filtroTipos.length + filtroMotivos.length + filtroCategorias.length + filtroMarcas.length + filtroSetores.length;

  // Abrir dialog de detalhes
  const abrirDetalhes = (titulo, dados, tipo) => {
    setDialogDetalhes({ open: true, titulo, dados, tipo });
  };

  // Refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchMov(), refetchPes(), refetchFin(), refetchProd()]);
    setIsRefreshing(false);
  };

  const isLoading = loadingMov || loadingPes || loadingFin;

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 bg-white rounded-lg p-4 shadow-sm border">
        <div className="flex items-center gap-4">
          {empresaAtual?.logotipo_url && (
            <img src={empresaAtual.logotipo_url} alt="Logo" className="h-12 w-12 object-contain rounded" />
          )}
          <div>
            <h1 className="text-xl font-bold text-slate-900">{empresaAtual?.apelido || empresaAtual?.nome || 'Dashboard Executivo'}</h1>
            <p className="text-slate-500 text-xs">Painel de Gestão em Tempo Real</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!empresaIdParam && empresas.length > 1 && (
            <Select value={empresaSelecionada} onValueChange={setEmpresaSelecionada}>
              <SelectTrigger className="h-8 w-44 text-xs">
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
            <SelectTrigger className="h-8 w-36 text-xs">
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
              <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="h-8 w-32 text-xs" />
              <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="h-8 w-32 text-xs" />
            </>
          )}

          <Button onClick={handleRefresh} disabled={isRefreshing} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
              <Filter className="w-3.5 h-3.5" /> Filtros:
            </span>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Tipo {filtroTipos.length > 0 && `(${filtroTipos.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-40">
                <div className="space-y-2">
                  {tiposUnicos.map(t => (
                    <div key={t} className="flex items-center space-x-2">
                      <Checkbox checked={filtroTipos.includes(t)} onCheckedChange={() => toggleFiltro(filtroTipos, setFiltroTipos, t)} />
                      <label className="text-xs cursor-pointer">{t}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Motivo {filtroMotivos.length > 0 && `(${filtroMotivos.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 max-h-64 overflow-auto">
                <div className="space-y-2">
                  {motivosUnicos.map(m => (
                    <div key={m} className="flex items-center space-x-2">
                      <Checkbox checked={filtroMotivos.includes(m)} onCheckedChange={() => toggleFiltro(filtroMotivos, setFiltroMotivos, m)} />
                      <label className="text-xs cursor-pointer">{m}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Categoria {filtroCategorias.length > 0 && `(${filtroCategorias.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 max-h-64 overflow-auto">
                <div className="space-y-2">
                  {categoriasUnicas.map(c => (
                    <div key={c} className="flex items-center space-x-2">
                      <Checkbox checked={filtroCategorias.includes(c)} onCheckedChange={() => toggleFiltro(filtroCategorias, setFiltroCategorias, c)} />
                      <label className="text-xs cursor-pointer">{c}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Marca {filtroMarcas.length > 0 && `(${filtroMarcas.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 max-h-64 overflow-auto">
                <div className="space-y-2">
                  {marcasUnicas.map(m => (
                    <div key={m} className="flex items-center space-x-2">
                      <Checkbox checked={filtroMarcas.includes(m)} onCheckedChange={() => toggleFiltro(filtroMarcas, setFiltroMarcas, m)} />
                      <label className="text-xs cursor-pointer">{m}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Setor {filtroSetores.length > 0 && `(${filtroSetores.length})`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 max-h-64 overflow-auto">
                <div className="space-y-2">
                  {setoresUnicos.map(s => (
                    <div key={s} className="flex items-center space-x-2">
                      <Checkbox checked={filtroSetores.includes(s)} onCheckedChange={() => toggleFiltro(filtroSetores, setFiltroSetores, s)} />
                      <label className="text-xs cursor-pointer">{s}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {totalFiltrosAtivos > 0 && (
              <Button variant="outline" size="sm" className="h-7 text-xs text-red-600" onClick={limparFiltros}>
                <X className="w-3 h-3 mr-1" /> Limpar ({totalFiltrosAtivos})
              </Button>
            )}

            <Badge variant="outline" className="text-xs ml-auto">
              <Calendar className="w-3 h-3 mr-1" />
              {dataInicioCalc && dataFimCalc 
                ? `${formatarData(dataInicioCalc)} a ${formatarData(dataFimCalc)}`
                : 'Todo período'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      ) : (
        <Tabs defaultValue="pecuaria" className="space-y-4">
          <TabsList className="bg-white border">
            <TabsTrigger value="pecuaria" className="text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <Beef className="w-3.5 h-3.5 mr-1" /> Pecuária
            </TabsTrigger>
            <TabsTrigger value="pesagens" className="text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <Scale className="w-3.5 h-3.5 mr-1" /> Pesagens
            </TabsTrigger>
            <TabsTrigger value="financeiro" className="text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <DollarSign className="w-3.5 h-3.5 mr-1" /> Financeiro
            </TabsTrigger>
            <TabsTrigger value="estoque" className="text-xs data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
              <Package className="w-3.5 h-3.5 mr-1" /> Estoque
            </TabsTrigger>
          </TabsList>

          {/* TAB PECUÁRIA */}
          <TabsContent value="pecuaria" className="space-y-4">
            {/* KPIs Clicáveis */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Card className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-green-500" onClick={() => abrirDetalhes('Entradas', indicadoresPecuaria.entradas, 'movimentacao')}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-500 text-[10px]">Entradas</p>
                      <p className="text-xl font-bold text-green-600">{formatarNumero(indicadoresPecuaria.totalEntradas)}</p>
                    </div>
                    <ArrowUp className="w-6 h-6 text-green-200" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 flex items-center"><Eye className="w-3 h-3 mr-1" /> Clique para ver</p>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-red-500" onClick={() => abrirDetalhes('Saídas', indicadoresPecuaria.saidas, 'movimentacao')}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-500 text-[10px]">Saídas</p>
                      <p className="text-xl font-bold text-red-600">{formatarNumero(indicadoresPecuaria.totalSaidas)}</p>
                    </div>
                    <ArrowDown className="w-6 h-6 text-red-200" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 flex items-center"><Eye className="w-3 h-3 mr-1" /> Clique para ver</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-blue-500">
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Saldo Período</p>
                  <p className={`text-xl font-bold ${indicadoresPecuaria.saldo >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                    {formatarNumero(indicadoresPecuaria.saldo)}
                  </p>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => abrirDetalhes('Compras', indicadoresPecuaria.compras, 'movimentacao')}>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Compras</p>
                  <p className="text-lg font-bold text-emerald-600">{formatarNumero(indicadoresPecuaria.qtdCompras)}</p>
                  <p className="text-[10px] text-slate-400">{formatarMoeda(indicadoresPecuaria.valorCompras)}</p>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => abrirDetalhes('Vendas/Abates', [...indicadoresPecuaria.vendas, ...indicadoresPecuaria.abates], 'movimentacao')}>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Vendas/Abates</p>
                  <p className="text-lg font-bold text-amber-600">{formatarNumero(indicadoresPecuaria.qtdVendas + indicadoresPecuaria.qtdAbates)}</p>
                  <p className="text-[10px] text-slate-400">{formatarMoeda(indicadoresPecuaria.valorVendas)}</p>
                </CardContent>
              </Card>

              <Card className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-red-600" onClick={() => abrirDetalhes('Mortes', indicadoresPecuaria.mortes, 'movimentacao')}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-slate-500 text-[10px]">Mortes</p>
                      <p className="text-lg font-bold text-red-600">{formatarNumero(indicadoresPecuaria.qtdMortes)}</p>
                    </div>
                    <AlertTriangle className="w-5 h-5 text-red-200" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-xs text-slate-600 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> Movimentações por Período
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={dadosMovMensal}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="mesLabel" tick={{ fill: '#6b7280', fontSize: 10 }} />
                      <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="entradas" name="Entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="saidas" name="Saídas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-xs text-slate-600 flex items-center gap-2">
                    <PieChart className="w-4 h-4" /> Distribuição por Categoria
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2">
                  <ResponsiveContainer width="100%" height={220}>
                    <RechartsPie>
                      <Pie
                        data={dadosCategorias}
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        dataKey="valor"
                        nameKey="nome"
                        label={({ nome, percent }) => `${nome}: ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {dadosCategorias.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                    </RechartsPie>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Tabelas Clicáveis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="py-2 px-3 border-b">
                  <CardTitle className="text-xs text-slate-600">Por Setor</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs py-1">Setor</TableHead>
                          <TableHead className="text-xs py-1 text-right">Ent.</TableHead>
                          <TableHead className="text-xs py-1 text-right">Saí.</TableHead>
                          <TableHead className="text-xs py-1 text-right">Saldo</TableHead>
                          <TableHead className="text-xs py-1 w-8"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dadosSetores.map((setor, idx) => (
                          <TableRow key={idx} className="cursor-pointer hover:bg-slate-50" onClick={() => abrirDetalhes(`Setor: ${setor.nome}`, setor.registros, 'movimentacao')}>
                            <TableCell className="text-xs py-1">{setor.nome}</TableCell>
                            <TableCell className="text-xs py-1 text-right text-green-600">{formatarNumero(setor.entradas)}</TableCell>
                            <TableCell className="text-xs py-1 text-right text-red-600">{formatarNumero(setor.saidas)}</TableCell>
                            <TableCell className={`text-xs py-1 text-right font-bold ${setor.saldo >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                              {formatarNumero(setor.saldo)}
                            </TableCell>
                            <TableCell className="py-1"><ChevronRight className="w-3 h-3 text-slate-400" /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="py-2 px-3 border-b">
                  <CardTitle className="text-xs text-slate-600">Por Categoria</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-64">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs py-1">Categoria</TableHead>
                          <TableHead className="text-xs py-1 text-right">Ent.</TableHead>
                          <TableHead className="text-xs py-1 text-right">Saí.</TableHead>
                          <TableHead className="text-xs py-1 text-right">Saldo</TableHead>
                          <TableHead className="text-xs py-1 w-8"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(indicadoresPecuaria.porCategoria).sort((a, b) => b[1].saldo - a[1].saldo).map(([cat, dados], idx) => (
                          <TableRow key={idx} className="cursor-pointer hover:bg-slate-50" onClick={() => abrirDetalhes(`Categoria: ${cat}`, dados.registros, 'movimentacao')}>
                            <TableCell className="text-xs py-1">{cat}</TableCell>
                            <TableCell className="text-xs py-1 text-right text-green-600">{formatarNumero(dados.entradas)}</TableCell>
                            <TableCell className="text-xs py-1 text-right text-red-600">{formatarNumero(dados.saidas)}</TableCell>
                            <TableCell className={`text-xs py-1 text-right font-bold ${dados.saldo >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>
                              {formatarNumero(dados.saldo)}
                            </TableCell>
                            <TableCell className="py-1"><ChevronRight className="w-3 h-3 text-slate-400" /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB PESAGENS */}
          <TabsContent value="pesagens" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="cursor-pointer hover:shadow-md" onClick={() => abrirDetalhes('Pesagens', pesFiltradas, 'pesagem')}>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Animais Pesados</p>
                  <p className="text-xl font-bold text-emerald-600">{formatarNumero(indicadoresPesagens.totalAnimais)}</p>
                  <p className="text-[10px] text-slate-400 flex items-center"><Eye className="w-3 h-3 mr-1" /> Clique para ver</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Peso Total</p>
                  <p className="text-xl font-bold text-blue-600">{formatarNumero(indicadoresPesagens.pesoTotal)} kg</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Peso Médio</p>
                  <p className="text-xl font-bold text-amber-600">{indicadoresPesagens.pesoMedio.toFixed(2)} kg</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">GMD Médio</p>
                  <p className="text-xl font-bold text-purple-600">{indicadoresPesagens.gmdMedio.toFixed(3)} kg/dia</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="py-2 px-3 border-b">
                <CardTitle className="text-xs text-slate-600">Pesagens por Apartação</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs py-1">Apartação</TableHead>
                      <TableHead className="text-xs py-1 text-right">Quantidade</TableHead>
                      <TableHead className="text-xs py-1 text-right">Peso Total</TableHead>
                      <TableHead className="text-xs py-1 text-right">Peso Médio</TableHead>
                      <TableHead className="text-xs py-1 w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(indicadoresPesagens.porApartacao).map(([apt, dados], idx) => (
                      <TableRow key={idx} className="cursor-pointer hover:bg-slate-50" onClick={() => abrirDetalhes(`Apartação: ${apt}`, dados.registros, 'pesagem')}>
                        <TableCell className="text-xs py-1">{apt}</TableCell>
                        <TableCell className="text-xs py-1 text-right">{formatarNumero(dados.qtd)}</TableCell>
                        <TableCell className="text-xs py-1 text-right">{formatarNumero(dados.peso)} kg</TableCell>
                        <TableCell className="text-xs py-1 text-right">{(dados.peso / dados.qtd).toFixed(2)} kg</TableCell>
                        <TableCell className="py-1"><ChevronRight className="w-3 h-3 text-slate-400" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB FINANCEIRO */}
          <TabsContent value="financeiro" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <Card className="cursor-pointer hover:shadow-md border-l-4 border-l-red-500" onClick={() => abrirDetalhes('Contas a Pagar', indicadoresFinanceiros.pagar, 'financeiro')}>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Total a Pagar</p>
                  <p className="text-lg font-bold text-red-600">{formatarMoeda(indicadoresFinanceiros.totalPagar)}</p>
                  <p className="text-[10px] text-slate-400 flex items-center"><Eye className="w-3 h-3 mr-1" /> Ver detalhes</p>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md border-l-4 border-l-green-500" onClick={() => abrirDetalhes('Contas a Receber', indicadoresFinanceiros.receber, 'financeiro')}>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Total a Receber</p>
                  <p className="text-lg font-bold text-green-600">{formatarMoeda(indicadoresFinanceiros.totalReceber)}</p>
                  <p className="text-[10px] text-slate-400 flex items-center"><Eye className="w-3 h-3 mr-1" /> Ver detalhes</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-blue-500">
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Saldo Previsto</p>
                  <p className={`text-lg font-bold ${indicadoresFinanceiros.saldo >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                    {formatarMoeda(indicadoresFinanceiros.saldo)}
                  </p>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md" onClick={() => abrirDetalhes('Pendentes', indicadoresFinanceiros.pendentes, 'financeiro')}>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Pendentes</p>
                  <p className="text-lg font-bold text-amber-600">{indicadoresFinanceiros.pendentes.length}</p>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md border-l-4 border-l-red-600" onClick={() => abrirDetalhes('Vencidos', indicadoresFinanceiros.vencidos, 'financeiro')}>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Vencidos</p>
                  <p className="text-lg font-bold text-red-600">{indicadoresFinanceiros.vencidos.length}</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* TAB ESTOQUE */}
          <TabsContent value="estoque" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Total de Produtos</p>
                  <p className="text-xl font-bold text-emerald-600">{produtos.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Em Estoque</p>
                  <p className="text-xl font-bold text-blue-600">
                    {produtos.filter(p => (p.estoque_atual || 0) > 0).length}
                  </p>
                </CardContent>
              </Card>
              <Card className="cursor-pointer hover:shadow-md border-l-4 border-l-red-500" onClick={() => abrirDetalhes('Abaixo do Mínimo', produtos.filter(p => (p.estoque_atual || 0) < (p.estoque_minimo || 0)), 'produto')}>
                <CardContent className="p-3">
                  <p className="text-slate-500 text-[10px]">Abaixo do Mínimo</p>
                  <p className="text-xl font-bold text-red-600">
                    {produtos.filter(p => (p.estoque_atual || 0) < (p.estoque_minimo || 0)).length}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="py-2 px-3 border-b">
                <CardTitle className="text-xs text-slate-600">Produtos em Estoque</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-80">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs py-1">Produto</TableHead>
                        <TableHead className="text-xs py-1">Categoria</TableHead>
                        <TableHead className="text-xs py-1 text-right">Estoque</TableHead>
                        <TableHead className="text-xs py-1 text-right">Mínimo</TableHead>
                        <TableHead className="text-xs py-1">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {produtos.map((prod, idx) => {
                        const abaixo = (prod.estoque_atual || 0) < (prod.estoque_minimo || 0);
                        return (
                          <TableRow key={idx}>
                            <TableCell className="text-xs py-1">{prod.nome_produto}</TableCell>
                            <TableCell className="text-xs py-1">{prod.categoria || '-'}</TableCell>
                            <TableCell className="text-xs py-1 text-right">{formatarNumero(prod.estoque_atual || 0)} {prod.unidade_medida}</TableCell>
                            <TableCell className="text-xs py-1 text-right">{formatarNumero(prod.estoque_minimo || 0)}</TableCell>
                            <TableCell className="py-1">
                              <Badge className={`text-[10px] ${abaixo ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                {abaixo ? 'Baixo' : 'OK'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Footer */}
      <div className="mt-6 text-center text-slate-400 text-xs">
        Última atualização: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
      </div>

      {/* Dialog de Detalhes */}
      <Dialog open={dialogDetalhes.open} onOpenChange={(open) => setDialogDetalhes(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <List className="w-4 h-4" /> {dialogDetalhes.titulo} ({dialogDetalhes.dados.length} registros)
            </DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="flex-1">
            {dialogDetalhes.tipo === 'movimentacao' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs py-1">Data</TableHead>
                    <TableHead className="text-xs py-1">Tipo</TableHead>
                    <TableHead className="text-xs py-1">Motivo</TableHead>
                    <TableHead className="text-xs py-1 text-right">Qtd</TableHead>
                    <TableHead className="text-xs py-1">Categoria</TableHead>
                    <TableHead className="text-xs py-1">Marca</TableHead>
                    <TableHead className="text-xs py-1">Setor</TableHead>
                    <TableHead className="text-xs py-1 text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dialogDetalhes.dados.map((m, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-xs py-1">{formatarData(m.data_movimentacao)}</TableCell>
                      <TableCell className="text-xs py-1">
                        <Badge className={`text-[10px] ${m.tipo === 'Entrada' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {m.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1">{m.motivo || '-'}</TableCell>
                      <TableCell className="text-xs py-1 text-right font-medium">{formatarNumero(m.quantidade_animais)}</TableCell>
                      <TableCell className="text-xs py-1">{m.categoria_animal || '-'}</TableCell>
                      <TableCell className="text-xs py-1">{m.marca || '-'}</TableCell>
                      <TableCell className="text-xs py-1">{m.setor_nome || '-'}</TableCell>
                      <TableCell className="text-xs py-1 text-right">{m.valor_total ? formatarMoeda(m.valor_total) : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {dialogDetalhes.tipo === 'pesagem' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs py-1">Data</TableHead>
                    <TableHead className="text-xs py-1">Animal</TableHead>
                    <TableHead className="text-xs py-1 text-right">Peso</TableHead>
                    <TableHead className="text-xs py-1">Sexo</TableHead>
                    <TableHead className="text-xs py-1">Raça</TableHead>
                    <TableHead className="text-xs py-1">Apartação</TableHead>
                    <TableHead className="text-xs py-1">Lote</TableHead>
                    <TableHead className="text-xs py-1 text-right">GMD</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dialogDetalhes.dados.map((p, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-xs py-1">{formatarData(p.data_pesagem)}</TableCell>
                      <TableCell className="text-xs py-1 font-medium">{p.numero_animal}</TableCell>
                      <TableCell className="text-xs py-1 text-right">{p.peso} kg</TableCell>
                      <TableCell className="text-xs py-1">{p.sexo || '-'}</TableCell>
                      <TableCell className="text-xs py-1">{p.raca || '-'}</TableCell>
                      <TableCell className="text-xs py-1">{p.nome_apartacao || '-'}</TableCell>
                      <TableCell className="text-xs py-1">{p.nome_lote || '-'}</TableCell>
                      <TableCell className="text-xs py-1 text-right">{p.gmd ? p.gmd.toFixed(3) : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {dialogDetalhes.tipo === 'financeiro' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs py-1">Vencimento</TableHead>
                    <TableHead className="text-xs py-1">Tipo</TableHead>
                    <TableHead className="text-xs py-1">Fornecedor/Cliente</TableHead>
                    <TableHead className="text-xs py-1">Documento</TableHead>
                    <TableHead className="text-xs py-1 text-right">Valor</TableHead>
                    <TableHead className="text-xs py-1">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dialogDetalhes.dados.map((l, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-xs py-1">{formatarData(l.data_vencimento)}</TableCell>
                      <TableCell className="text-xs py-1">
                        <Badge className={`text-[10px] ${l.tipo === 'Receber' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {l.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1">{l.fornecedor_nome || l.cliente_nome || '-'}</TableCell>
                      <TableCell className="text-xs py-1">{l.numero_documento || '-'}</TableCell>
                      <TableCell className="text-xs py-1 text-right font-medium">{formatarMoeda(l.valor_total)}</TableCell>
                      <TableCell className="text-xs py-1">
                        <Badge className={`text-[10px] ${
                          l.status === 'Pago' ? 'bg-green-100 text-green-700' :
                          l.status === 'Vencido' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {l.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {dialogDetalhes.tipo === 'produto' && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs py-1">Produto</TableHead>
                    <TableHead className="text-xs py-1">Categoria</TableHead>
                    <TableHead className="text-xs py-1 text-right">Estoque</TableHead>
                    <TableHead className="text-xs py-1 text-right">Mínimo</TableHead>
                    <TableHead className="text-xs py-1">Local</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dialogDetalhes.dados.map((p, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-xs py-1 font-medium">{p.nome_produto}</TableCell>
                      <TableCell className="text-xs py-1">{p.categoria || '-'}</TableCell>
                      <TableCell className="text-xs py-1 text-right">{formatarNumero(p.estoque_atual || 0)} {p.unidade_medida}</TableCell>
                      <TableCell className="text-xs py-1 text-right">{formatarNumero(p.estoque_minimo || 0)}</TableCell>
                      <TableCell className="text-xs py-1">{p.local_estoque || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
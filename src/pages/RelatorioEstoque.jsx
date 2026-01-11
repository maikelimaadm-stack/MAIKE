import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { 
  Search, ChevronLeft, ChevronRight, Download, 
  ArrowUpDown, ArrowUp, ArrowDown, Settings 
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { toast } from "sonner";

// ========== CONFIGURAÇÕES ==========
const TIPOS_MOVIMENTACAO = [
  { value: 'todos', label: 'Todos' },
  { value: 'Entrada', label: 'Entrada' },
  { value: 'Saída', label: 'Saída' },
  { value: 'Transferência', label: 'Transferência' },
  { value: 'Ajuste', label: 'Ajuste' }
];

const OPERACOES_POR_TIPO = {
  'Entrada': ['compra', 'compra_vista', 'devolucao_cliente', 'bonificacao', 'doacao_recebida', 'producao_entrada', 'transferencia_recebida', 'ajuste_positivo', 'outros_entrada'],
  'Saída': ['venda', 'venda_vista', 'consumo_interno', 'suplementacao', 'aplicacao_area', 'manutencao', 'doacao', 'perda', 'quebra', 'transferencia_enviada', 'ajuste_negativo', 'outros_saida'],
  'Transferência': ['entre_locais', 'outros_transferencia'],
  'Ajuste': ['ajuste_positivo', 'ajuste_negativo', 'inventario', 'correcao']
};

const COLUNAS_EXTRATO = [
  { id: 'data', label: 'Data', default: true, sortable: true },
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'tipo', label: 'Tipo', default: true, sortable: true },
  { id: 'operacao', label: 'Operação', default: true, sortable: true },
  { id: 'produto', label: 'Produto', default: true, sortable: true },
  { id: 'codigo', label: 'Código', default: true, sortable: false },
  { id: 'quantidade', label: 'Qtd', default: true, sortable: true },
  { id: 'unidade', label: 'UN', default: true, sortable: false },
  { id: 'origem', label: 'Origem', default: true, sortable: false },
  { id: 'destino', label: 'Destino', default: true, sortable: false },
  { id: 'centro_custo', label: 'C. Custo', default: true, sortable: false },
  { id: 'documento', label: 'Documento', default: false, sortable: false },
  { id: 'fornecedor', label: 'Forn./Cliente', default: false, sortable: false },
  { id: 'valor_unitario', label: 'Vlr. Unit.', default: false, sortable: true },
  { id: 'valor_total', label: 'Vlr. Total', default: false, sortable: true },
  { id: 'observacoes', label: 'Observações', default: false, sortable: false }
];

const ITEMS_PER_PAGE = 50;

// ========== FUNÇÕES AUXILIARES ==========
const calcularSaldoPorProdutoELocal = (movimentacoes, produtos) => {
  const saldos = {};

  produtos.forEach(p => {
    saldos[p.id] = { 
      produto: p, 
      total: 0, 
      porLocal: {},
      totalEntradas: 0,
      totalSaidas: 0
    };
  });

  movimentacoes.forEach(mov => {
    if (!mov.produto_id || !saldos[mov.produto_id]) return;

    const qtd = mov.quantidade || 0;
    const origemId = mov.local_estoque_origem_id;
    const destinoId = mov.local_estoque_destino_id;

    if (mov.tipo_movimentacao === 'Entrada') {
      saldos[mov.produto_id].total += qtd;
      saldos[mov.produto_id].totalEntradas += qtd;
      if (destinoId) {
        if (!saldos[mov.produto_id].porLocal[destinoId]) saldos[mov.produto_id].porLocal[destinoId] = 0;
        saldos[mov.produto_id].porLocal[destinoId] += qtd;
      }
    } else if (mov.tipo_movimentacao === 'Saída') {
      saldos[mov.produto_id].total -= qtd;
      saldos[mov.produto_id].totalSaidas += qtd;
      if (origemId) {
        if (!saldos[mov.produto_id].porLocal[origemId]) saldos[mov.produto_id].porLocal[origemId] = 0;
        saldos[mov.produto_id].porLocal[origemId] -= qtd;
      }
    } else if (mov.tipo_movimentacao === 'Transferência') {
      if (origemId) {
        if (!saldos[mov.produto_id].porLocal[origemId]) saldos[mov.produto_id].porLocal[origemId] = 0;
        saldos[mov.produto_id].porLocal[origemId] -= qtd;
      }
      if (destinoId) {
        if (!saldos[mov.produto_id].porLocal[destinoId]) saldos[mov.produto_id].porLocal[destinoId] = 0;
        saldos[mov.produto_id].porLocal[destinoId] += qtd;
      }
    } else if (mov.tipo_movimentacao === 'Ajuste') {
      const localId = destinoId || origemId;
      const isPositivo = mov.tipo_detalhado?.toLowerCase().includes('positivo') || mov.tipo_detalhado?.toLowerCase().includes('inventário');
      if (isPositivo) {
        saldos[mov.produto_id].total += qtd;
        saldos[mov.produto_id].totalEntradas += qtd;
        if (localId) {
          if (!saldos[mov.produto_id].porLocal[localId]) saldos[mov.produto_id].porLocal[localId] = 0;
          saldos[mov.produto_id].porLocal[localId] += qtd;
        }
      } else {
        saldos[mov.produto_id].total -= qtd;
        saldos[mov.produto_id].totalSaidas += qtd;
        if (localId) {
          if (!saldos[mov.produto_id].porLocal[localId]) saldos[mov.produto_id].porLocal[localId] = 0;
          saldos[mov.produto_id].porLocal[localId] -= qtd;
        }
      }
    }
  });

  return saldos;
};

const filtrarMovimentacoes = (movimentacoes, filtros) => {
  return movimentacoes.filter(mov => {
    if (filtros.dataInicial) {
      const dataInicio = new Date(filtros.dataInicial);
      const dataMov = new Date(mov.data_movimentacao);
      if (dataMov < dataInicio) return false;
    }
    if (filtros.dataFinal) {
      const dataFim = new Date(filtros.dataFinal);
      dataFim.setHours(23, 59, 59, 999);
      const dataMov = new Date(mov.data_movimentacao);
      if (dataMov > dataFim) return false;
    }
    if (filtros.localId && filtros.localId !== 'todos') {
      const matchOrigem = mov.local_estoque_origem_id === filtros.localId;
      const matchDestino = mov.local_estoque_destino_id === filtros.localId;
      if (!matchOrigem && !matchDestino) return false;
    }
    if (filtros.produtoId && filtros.produtoId !== 'todos') {
      if (mov.produto_id !== filtros.produtoId) return false;
    }
    if (filtros.buscaProduto) {
      const busca = filtros.buscaProduto.toLowerCase();
      const matchNome = mov.produto_nome?.toLowerCase().includes(busca);
      const matchCodigo = mov.produto_codigo?.toLowerCase().includes(busca);
      if (!matchNome && !matchCodigo) return false;
    }
    if (filtros.tipo && filtros.tipo !== 'todos') {
      if (mov.tipo_movimentacao !== filtros.tipo) return false;
    }
    if (filtros.tipoDetalhado && filtros.tipoDetalhado !== 'todos') {
      if (mov.tipo_detalhado !== filtros.tipoDetalhado) return false;
    }
    if (filtros.centroCustoId && filtros.centroCustoId !== 'todos') {
      if (mov.centro_custo_id !== filtros.centroCustoId) return false;
    }
    if (filtros.parceiroId && filtros.parceiroId !== 'todos') {
      if (mov.fornecedor_id !== filtros.parceiroId && mov.cliente_id !== filtros.parceiroId) return false;
    }
    return true;
  });
};

export default function RelatorioEstoque() {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  const [abaAtiva, setAbaAtiva] = useState('saldo');
  
  // Filtros
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');
  const [localId, setLocalId] = useState('todos');
  const [produtoId, setProdutoId] = useState('todos');
  const [buscaProduto, setBuscaProduto] = useState('');
  const [tipo, setTipo] = useState('todos');
  const [tipoDetalhado, setTipoDetalhado] = useState('todos');
  const [centroCustoId, setCentroCustoId] = useState('todos');
  const [parceiroId, setParceiroId] = useState('todos');
  const [apenasComSaldo, setApenasComSaldo] = useState(false);
  const [apenasSaldoNegativo, setApenasSaldoNegativo] = useState(false);

  // Paginação e ordenação
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');

  // Colunas visíveis (Extrato)
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_estoque');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_EXTRATO.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_EXTRATO.filter(c => c.default).map(c => c.id);
  });

  // ========== QUERIES ==========
  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['movimentacoes_relatorio', empresaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaId && m.status === 'Ativa');
    },
    enabled: !!empresaId
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_relatorio', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaId);
    },
    enabled: !!empresaId
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais_relatorio'],
    queryFn: () => base44.entities.LocalEstoque.list()
  });

  const { data: centrosCusto = [] } = useQuery({
    queryKey: ['centros_relatorio', empresaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list();
      return all.filter(c => c.empresa_id === empresaId);
    },
    enabled: !!empresaId
  });

  const { data: fornecedores = [] } = useQuery({
    queryKey: ['fornecedores_relatorio', empresaId],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter(f => f.empresa_id === empresaId);
    },
    enabled: !!empresaId
  });

  // ========== FILTROS APLICADOS ==========
  const filtrosAtivos = useMemo(() => ({
    dataInicial,
    dataFinal,
    localId,
    produtoId,
    buscaProduto,
    tipo,
    tipoDetalhado,
    centroCustoId,
    parceiroId,
    apenasComSaldo,
    apenasSaldoNegativo
  }), [dataInicial, dataFinal, localId, produtoId, buscaProduto, tipo, tipoDetalhado, centroCustoId, parceiroId, apenasComSaldo, apenasSaldoNegativo]);

  const movimentacoesFiltradas = useMemo(() => {
    return filtrarMovimentacoes(movimentacoes, filtrosAtivos);
  }, [movimentacoes, filtrosAtivos]);

  const saldosTotais = useMemo(() => {
    return calcularSaldoPorProdutoELocal(movimentacoes, produtos);
  }, [movimentacoes, produtos]);

  // ========== SALDO ATUAL ==========
  const listaSaldos = useMemo(() => {
    let lista = Object.values(saldosTotais).map(s => ({
      ...s,
      saldoNoLocal: filtrosAtivos.localId && filtrosAtivos.localId !== 'todos' 
        ? (s.porLocal[filtrosAtivos.localId] || 0) 
        : null
    }));

    if (filtrosAtivos.buscaProduto) {
      const busca = filtrosAtivos.buscaProduto.toLowerCase();
      lista = lista.filter(s => 
        s.produto.nome_produto?.toLowerCase().includes(busca) ||
        s.produto.codigo_interno?.toLowerCase().includes(busca) ||
        s.produto.codigo_barras?.toLowerCase().includes(busca)
      );
    }

    if (filtrosAtivos.apenasComSaldo) {
      lista = lista.filter(s => {
        if (filtrosAtivos.localId && filtrosAtivos.localId !== 'todos') {
          return (s.porLocal[filtrosAtivos.localId] || 0) > 0;
        }
        return s.total > 0;
      });
    }

    if (filtrosAtivos.apenasSaldoNegativo) {
      lista = lista.filter(s => {
        if (filtrosAtivos.localId && filtrosAtivos.localId !== 'todos') {
          return (s.porLocal[filtrosAtivos.localId] || 0) < 0;
        }
        return s.total < 0;
      });
    }

    return lista.sort((a, b) => a.produto.nome_produto?.localeCompare(b.produto.nome_produto || ''));
  }, [saldosTotais, filtrosAtivos]);

  // ========== RESUMO POR PERÍODO ==========
  const resumoPeriodo = useMemo(() => {
    const resumo = {};

    movimentacoesFiltradas.forEach(mov => {
      if (!mov.produto_id) return;

      const key = mov.produto_id;
      if (!resumo[key]) {
        resumo[key] = {
          produto_id: mov.produto_id,
          produto_nome: mov.produto_nome,
          produto_codigo: mov.produto_codigo,
          unidade: mov.unidade_medida,
          entradas: 0,
          saidas: 0,
          saldo: 0
        };
      }

      const qtd = mov.quantidade || 0;

      if (mov.tipo_movimentacao === 'Entrada') {
        resumo[key].entradas += qtd;
        resumo[key].saldo += qtd;
      } else if (mov.tipo_movimentacao === 'Saída') {
        resumo[key].saidas += qtd;
        resumo[key].saldo -= qtd;
      } else if (mov.tipo_movimentacao === 'Ajuste') {
        const isPositivo = mov.tipo_detalhado?.toLowerCase().includes('positivo');
        if (isPositivo) {
          resumo[key].entradas += qtd;
          resumo[key].saldo += qtd;
        } else {
          resumo[key].saidas += qtd;
          resumo[key].saldo -= qtd;
        }
      }
    });

    return Object.values(resumo).sort((a, b) => a.produto_nome?.localeCompare(b.produto_nome || ''));
  }, [movimentacoesFiltradas]);

  // Totalizadores
  const totalizadores = useMemo(() => ({
    totalEntradas: movimentacoesFiltradas.filter(m => m.tipo_movimentacao === 'Entrada' || (m.tipo_movimentacao === 'Ajuste' && m.tipo_detalhado?.toLowerCase().includes('positivo'))).reduce((s, m) => s + (m.quantidade || 0), 0),
    totalSaidas: movimentacoesFiltradas.filter(m => m.tipo_movimentacao === 'Saída' || (m.tipo_movimentacao === 'Ajuste' && !m.tipo_detalhado?.toLowerCase().includes('positivo'))).reduce((s, m) => s + (m.quantidade || 0), 0),
    totalMovimentacoes: movimentacoesFiltradas.length,
    saldoGeral: listaSaldos.reduce((s, item) => s + item.total, 0)
  }), [movimentacoesFiltradas, listaSaldos]);

  // ========== ORDENAÇÃO E PAGINAÇÃO ==========
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const sortedExtrato = useMemo(() => {
    if (!sortField) return movimentacoesFiltradas;

    return [...movimentacoesFiltradas].sort((a, b) => {
      let aValue, bValue;

      switch (sortField) {
        case 'data':
          aValue = new Date(a.data_movimentacao).getTime();
          bValue = new Date(b.data_movimentacao).getTime();
          break;
        case 'numero':
          aValue = parseInt(a.numero_movimentacao) || 0;
          bValue = parseInt(b.numero_movimentacao) || 0;
          break;
        case 'tipo':
          aValue = a.tipo_movimentacao || '';
          bValue = b.tipo_movimentacao || '';
          break;
        case 'operacao':
          aValue = a.tipo_detalhado || '';
          bValue = b.tipo_detalhado || '';
          break;
        case 'produto':
          aValue = a.produto_nome || '';
          bValue = b.produto_nome || '';
          break;
        case 'quantidade':
          aValue = a.quantidade || 0;
          bValue = b.quantidade || 0;
          break;
        case 'valor_unitario':
          aValue = a.valor_unitario || 0;
          bValue = b.valor_unitario || 0;
          break;
        case 'valor_total':
          aValue = a.valor_total || 0;
          bValue = b.valor_total || 0;
          break;
        default:
          return 0;
      }

      if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [movimentacoesFiltradas, sortField, sortDirection]);

  const totalPages = Math.ceil(sortedExtrato.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedExtrato = sortedExtrato.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  const tiposDetalhadosDisponiveis = useMemo(() => {
    if (!tipo || tipo === 'todos') return [];
    return OPERACOES_POR_TIPO[tipo] || [];
  }, [tipo]);

  const handleLimparFiltros = () => {
    setDataInicial('');
    setDataFinal('');
    setLocalId('todos');
    setProdutoId('todos');
    setBuscaProduto('');
    setTipo('todos');
    setTipoDetalhado('todos');
    setCentroCustoId('todos');
    setParceiroId('todos');
    setApenasComSaldo(false);
    setApenasSaldoNegativo(false);
    setCurrentPage(1);
  };

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_estoque', JSON.stringify(novasColunas));
      return novasColunas;
    });
  };

  const colunasVisiveisOrdenadas = COLUNAS_EXTRATO.filter(c => colunasVisiveis.includes(c.id));

  const handleExport = () => {
    const csvRows = [];
    const headers = ['Data', 'Tipo', 'Operação', 'Produto', 'Código', 'Qtd', 'UN', 'Origem', 'Destino', 'C.Custo', 'Documento', 'Forn./Cliente', 'Vlr.Unit.', 'Vlr.Total', 'Obs'];
    csvRows.push(headers.join(';'));

    movimentacoesFiltradas.forEach(m => {
      const row = [
        m.data_movimentacao ? format(new Date(m.data_movimentacao), 'dd/MM/yyyy') : '',
        m.tipo_movimentacao || '',
        m.tipo_detalhado || '',
        m.produto_nome || '',
        m.produto_codigo || '',
        m.quantidade || '',
        m.unidade_medida || '',
        m.local_estoque_origem || '',
        m.local_estoque_destino || '',
        m.centro_custo_nome || '',
        m.numero_documento ? `${m.tipo_documento || ''} ${m.numero_documento}` : '',
        m.fornecedor_nome || m.cliente_nome || '',
        m.valor_unitario || '',
        m.valor_total || '',
        m.observacoes || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_estoque_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.csv`;
    link.click();
    toast.success('Relatório exportado!');
  };

  const renderCell = (coluna, mov) => {
    switch (coluna.id) {
      case 'data':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.data_movimentacao ? format(new Date(mov.data_movimentacao), 'dd/MM/yyyy') : '-'}</TableCell>;
      case 'numero':
        return <TableCell className="text-xs py-1 border border-gray-300 font-mono">{mov.numero_movimentacao || '-'}</TableCell>;
      case 'tipo':
        return (
          <TableCell className="py-1 border border-gray-300">
            <Badge variant="outline" className={`text-xs ${
              mov.tipo_movimentacao === 'Entrada' ? 'bg-green-100 text-green-800 border-green-300' :
              mov.tipo_movimentacao === 'Saída' ? 'bg-red-100 text-red-800 border-red-300' :
              mov.tipo_movimentacao === 'Transferência' ? 'bg-blue-100 text-blue-800 border-blue-300' :
              'bg-amber-100 text-amber-800 border-amber-300'
            }`}>
              {mov.tipo_movimentacao}
            </Badge>
          </TableCell>
        );
      case 'operacao':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.tipo_detalhado || '-'}</TableCell>;
      case 'produto':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.produto_nome || '-'}</TableCell>;
      case 'codigo':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.produto_codigo || '-'}</TableCell>;
      case 'quantidade':
        return <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{mov.quantidade?.toFixed(2)}</TableCell>;
      case 'unidade':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.unidade_medida || '-'}</TableCell>;
      case 'origem':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.local_estoque_origem || '-'}</TableCell>;
      case 'destino':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.local_estoque_destino || '-'}</TableCell>;
      case 'centro_custo':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.centro_custo_nome || '-'}</TableCell>;
      case 'documento':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.numero_documento ? `${mov.tipo_documento || ''} ${mov.numero_documento}` : '-'}</TableCell>;
      case 'fornecedor':
        return <TableCell className="text-xs py-1 border border-gray-300">{mov.fornecedor_nome || mov.cliente_nome || '-'}</TableCell>;
      case 'valor_unitario':
        return <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono">{mov.valor_unitario ? mov.valor_unitario.toFixed(2) : '-'}</TableCell>;
      case 'valor_total':
        return <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono font-semibold">{mov.valor_total ? mov.valor_total.toFixed(2) : '-'}</TableCell>;
      case 'observacoes':
        return <TableCell className="text-xs py-1 border border-gray-300 max-w-[200px] truncate" title={mov.observacoes}>{mov.observacoes || '-'}</TableCell>;
      default:
        return <TableCell className="text-xs py-1 border border-gray-300">-</TableCell>;
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Estoque</h1>
          <p className="text-xs text-slate-600">Saldos, movimentações e resumos</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExport} variant="outline" size="sm" className="h-8 text-xs">
            <Download className="w-3.5 h-3.5 mr-1" />
            Exportar
          </Button>
        </div>
      </div>

      {/* FILTROS */}
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-9 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar produto..."
                value={buscaProduto}
                onChange={(e) => setBuscaProduto(e.target.value)}
                className="h-8 text-xs pl-8"
              />
            </div>
            <Select value={tipo} onValueChange={(v) => { setTipo(v); setTipoDetalhado('todos'); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
              <SelectContent>
                {TIPOS_MOVIMENTACAO.map(t => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={tipoDetalhado} onValueChange={setTipoDetalhado} disabled={tipo === 'todos'}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Operação" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todas</SelectItem>
                {tiposDetalhadosDisponiveis.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={localId} onValueChange={setLocalId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Local" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                {locais.map(l => <SelectItem key={l.id} value={l.id} className="text-xs">{l.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={centroCustoId} onValueChange={setCentroCustoId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="C. Custo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                {centrosCusto.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={parceiroId} onValueChange={setParceiroId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Forn./Cliente" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                {fornecedores.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} className="h-8 text-xs" placeholder="Data início" />
            <Input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} className="h-8 text-xs" placeholder="Data fim" />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="apenasComSaldo" 
                  checked={apenasComSaldo}
                  onCheckedChange={(v) => { setApenasComSaldo(v); if (v) setApenasSaldoNegativo(false); }}
                />
                <Label htmlFor="apenasComSaldo" className="text-xs">Saldo {'>'} 0</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox 
                  id="apenasSaldoNegativo" 
                  checked={apenasSaldoNegativo}
                  onCheckedChange={(v) => { setApenasSaldoNegativo(v); if (v) setApenasComSaldo(false); }}
                />
                <Label htmlFor="apenasSaldoNegativo" className="text-xs">Saldo {'<'} 0</Label>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {movimentacoesFiltradas.length} de {movimentacoes.length} registros
            </div>
            <Button variant="outline" size="sm" onClick={handleLimparFiltros} className="h-7 text-xs">
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ABAS */}
      <Tabs value={abaAtiva} onValueChange={setAbaAtiva}>
        <TabsList className="grid w-full grid-cols-3 h-9">
          <TabsTrigger value="saldo" className="text-xs">Saldo Atual</TabsTrigger>
          <TabsTrigger value="extrato" className="text-xs">Extrato de Movimentações</TabsTrigger>
          <TabsTrigger value="resumo" className="text-xs">Resumo por Período</TabsTrigger>
        </TabsList>

        {/* ABA SALDO ATUAL */}
        <TabsContent value="saldo">
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Saldo Atual ({listaSaldos.length} produtos)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500">Carregando...</div>
              ) : listaSaldos.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">Nenhum produto encontrado</div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50 border-b">
                          <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Entradas</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Saídas</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Saldo Total</TableHead>
                          {filtrosAtivos.localId && filtrosAtivos.localId !== 'todos' && (
                            <TableHead className="text-xs font-bold py-1 border border-black text-right">Saldo no Local</TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {listaSaldos.map((item) => (
                          <TableRow key={item.produto.id} className="hover:bg-slate-50 border-b">
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto.nome_produto}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto.codigo_interno || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto.unidade_medida || 'UN'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-emerald-600">{item.totalEntradas.toFixed(2)}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-red-600">{item.totalSaidas.toFixed(2)}</TableCell>
                            <TableCell className={`text-xs py-1 border border-gray-300 text-right font-mono font-semibold ${item.total < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                              {item.total.toFixed(2)}
                            </TableCell>
                            {filtrosAtivos.localId && filtrosAtivos.localId !== 'todos' && (
                              <TableCell className={`text-xs py-1 border border-gray-300 text-right font-mono font-semibold ${(item.saldoNoLocal || 0) < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                {(item.saldoNoLocal || 0).toFixed(2)}
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="bg-slate-100 p-2 border-t flex justify-end gap-4 text-xs">
                    <span>Produtos: {listaSaldos.length}</span>
                    <span className="font-semibold">Saldo Geral: {totalizadores.saldoGeral.toFixed(2)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA EXTRATO */}
        <TabsContent value="extrato">
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Extrato ({movimentacoesFiltradas.length})
                </CardTitle>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs">
                      <Settings className="w-3.5 h-3.5 mr-1" />
                      Colunas
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-xs">Visibilidade das Colunas</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {COLUNAS_EXTRATO.map((coluna) => (
                      <DropdownMenuCheckboxItem
                        key={coluna.id}
                        checked={colunasVisiveis.includes(coluna.id)}
                        onCheckedChange={() => toggleColuna(coluna.id)}
                        className="text-xs"
                      >
                        {coluna.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500">Carregando...</div>
              ) : movimentacoesFiltradas.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">Nenhuma movimentação encontrada</div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50 border-b">
                          {colunasVisiveisOrdenadas.map((coluna) => (
                            <TableHead 
                              key={coluna.id}
                              className={`text-xs font-bold py-1 border border-black ${coluna.sortable ? 'cursor-pointer hover:bg-slate-100' : ''}`}
                              onClick={() => coluna.sortable && handleSort(coluna.id)}
                            >
                              <div className="flex items-center">
                                {coluna.label}
                                {coluna.sortable && getSortIcon(coluna.id)}
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedExtrato.map((mov) => (
                          <TableRow key={mov.id} className="hover:bg-slate-50 border-b">
                            {colunasVisiveisOrdenadas.map(coluna => (
                              <React.Fragment key={coluna.id}>
                                {renderCell(coluna, mov)}
                              </React.Fragment>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-end px-4 py-3 border-t border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-600 mr-2">
                          Página {currentPage} de {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                          className="h-7 text-xs"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                          Anterior
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={currentPage === totalPages}
                          className="h-7 text-xs"
                        >
                          Próxima
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="bg-slate-100 p-2 border-t flex justify-end gap-4 text-xs">
                    <span>Total: {totalizadores.totalMovimentacoes}</span>
                    <span className="text-emerald-600">Entradas: {totalizadores.totalEntradas.toFixed(2)}</span>
                    <span className="text-red-600">Saídas: {totalizadores.totalSaidas.toFixed(2)}</span>
                    <span className="font-semibold">Saldo: {(totalizadores.totalEntradas - totalizadores.totalSaidas).toFixed(2)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ABA RESUMO */}
        <TabsContent value="resumo">
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Resumo por Período ({resumoPeriodo.length} produtos)
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500">Carregando...</div>
              ) : resumoPeriodo.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">Nenhum dado encontrado</div>
              ) : (
                <>
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-slate-50 border-b">
                          <TableHead className="text-xs font-bold py-1 border border-black">Produto</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">Código</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black">UN</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Entradas</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Saídas</TableHead>
                          <TableHead className="text-xs font-bold py-1 border border-black text-right">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {resumoPeriodo.map((item) => (
                          <TableRow key={item.produto_id} className="hover:bg-slate-50 border-b">
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto_nome}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.produto_codigo || '-'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300">{item.unidade || 'UN'}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-emerald-600 font-semibold">{item.entradas.toFixed(2)}</TableCell>
                            <TableCell className="text-xs py-1 border border-gray-300 text-right font-mono text-red-600 font-semibold">{item.saidas.toFixed(2)}</TableCell>
                            <TableCell className={`text-xs py-1 border border-gray-300 text-right font-mono font-bold ${item.saldo < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                              {item.saldo.toFixed(2)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="bg-slate-100 p-2 border-t flex justify-end gap-4 text-xs">
                    <span>Produtos: {resumoPeriodo.length}</span>
                    <span className="text-emerald-600">Entradas: {resumoPeriodo.reduce((s, i) => s + i.entradas, 0).toFixed(2)}</span>
                    <span className="text-red-600">Saídas: {resumoPeriodo.reduce((s, i) => s + i.saidas, 0).toFixed(2)}</span>
                    <span className="font-semibold">Saldo: {resumoPeriodo.reduce((s, i) => s + i.saldo, 0).toFixed(2)}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
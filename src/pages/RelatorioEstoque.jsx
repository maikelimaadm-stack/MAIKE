import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Printer, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ========== CONFIGURAÇÕES ==========
const TIPOS_MOVIMENTACAO = [
  { value: 'Entrada', label: 'Entrada' },
  { value: 'Saída', label: 'Saída' },
  { value: 'Transferência', label: 'Transferência' },
  { value: 'Ajuste', label: 'Ajuste' }
];

const COLUNAS_EXTRATO = [
  { id: 'data', label: 'Data', default: true },
  { id: 'numero', label: 'Nº', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'operacao', label: 'Operação', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'codigo', label: 'Código', default: true },
  { id: 'quantidade', label: 'Qtd', default: true },
  { id: 'unidade', label: 'UN', default: true },
  { id: 'origem', label: 'Origem', default: true },
  { id: 'destino', label: 'Destino', default: true },
  { id: 'centro_custo', label: 'C. Custo', default: false },
  { id: 'documento', label: 'Documento', default: false },
  { id: 'fornecedor', label: 'Forn./Cliente', default: false },
  { id: 'valor_unitario', label: 'Vlr. Unit.', default: false },
  { id: 'valor_total', label: 'Vlr. Total', default: false },
  { id: 'observacoes', label: 'Observações', default: false }
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antiga)' },
  { value: 'quantidade_desc', label: 'Quantidade (Maior)' },
  { value: 'quantidade_asc', label: 'Quantidade (Menor)' },
  { value: 'produto_asc', label: 'Produto (A-Z)' },
];

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "";
  return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarData = (dataString) => {
  if (!dataString) return '--/--/----';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '--/--/----';
    return format(date, "dd/MM/yyyy", { locale: ptBR });
  } catch { return '--/--/----'; }
};

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

export default function RelatorioEstoque() {
  const empresaId = localStorage.getItem('empresa_selecionada_id');
  
  // Tipo de Relatório
  const [tipoRelatorio, setTipoRelatorio] = useState("saldo");
  const [orientacao, setOrientacao] = useState("paisagem");
  const [ordenacao, setOrdenacao] = useState('data_desc');

  // Filtros
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');
  const [localId, setLocalId] = useState('');
  const [buscaProduto, setBuscaProduto] = useState('');
  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [centroCustoId, setCentroCustoId] = useState('');
  const [apenasComSaldo, setApenasComSaldo] = useState(false);
  const [apenasSaldoNegativo, setApenasSaldoNegativo] = useState(false);

  // Colunas visíveis (Extrato)
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_estoque');
    if (saved) {
      try { return JSON.parse(saved); } catch { }
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

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual-relatorio', empresaId],
    queryFn: async () => {
      if (!empresaId) return null;
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaId) || null;
    },
    enabled: !!empresaId,
  });

  // Valores únicos para filtros
  const locaisUnicos = locais.map(l => l.nome).filter(Boolean).sort();
  const centrosUnicos = centrosCusto.map(c => c.nome).filter(Boolean).sort();

  // ========== FILTROS APLICADOS ==========
  const movimentacoesFiltradas = useMemo(() => {
    let filtered = movimentacoes.filter(m => {
      if (dataInicial && m.data_movimentacao) {
        const mDate = new Date(m.data_movimentacao);
        const iDate = new Date(dataInicial);
        iDate.setHours(0, 0, 0, 0);
        if (mDate < iDate) return false;
      }
      if (dataFinal && m.data_movimentacao) {
        const mDate = new Date(m.data_movimentacao);
        const fDate = new Date(dataFinal);
        fDate.setHours(23, 59, 59, 999);
        if (mDate > fDate) return false;
      }
      if (localId) {
        const matchOrigem = m.local_estoque_origem_id === localId;
        const matchDestino = m.local_estoque_destino_id === localId;
        if (!matchOrigem && !matchDestino) return false;
      }
      if (buscaProduto) {
        const busca = buscaProduto.toLowerCase();
        const matchNome = m.produto_nome?.toLowerCase().includes(busca);
        const matchCodigo = m.produto_codigo?.toLowerCase().includes(busca);
        if (!matchNome && !matchCodigo) return false;
      }
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(m.tipo_movimentacao)) return false;
      if (centroCustoId && m.centro_custo_id !== centroCustoId) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc': return new Date(b.data_movimentacao || 0) - new Date(a.data_movimentacao || 0);
        case 'data_asc': return new Date(a.data_movimentacao || 0) - new Date(b.data_movimentacao || 0);
        case 'quantidade_desc': return (b.quantidade || 0) - (a.quantidade || 0);
        case 'quantidade_asc': return (a.quantidade || 0) - (b.quantidade || 0);
        case 'produto_asc': return (a.produto_nome || '').localeCompare(b.produto_nome || '');
        default: return 0;
      }
    });

    return filtered;
  }, [movimentacoes, dataInicial, dataFinal, localId, buscaProduto, tiposSelecionados, centroCustoId, ordenacao]);

  const saldosTotais = useMemo(() => {
    return calcularSaldoPorProdutoELocal(movimentacoes, produtos);
  }, [movimentacoes, produtos]);

  // ========== SALDO ATUAL ==========
  const listaSaldos = useMemo(() => {
    let lista = Object.values(saldosTotais).map(s => ({
      ...s,
      saldoNoLocal: localId ? (s.porLocal[localId] || 0) : null
    }));

    if (buscaProduto) {
      const busca = buscaProduto.toLowerCase();
      lista = lista.filter(s => 
        s.produto.nome_produto?.toLowerCase().includes(busca) ||
        s.produto.codigo_interno?.toLowerCase().includes(busca) ||
        s.produto.codigo_barras?.toLowerCase().includes(busca)
      );
    }

    if (apenasComSaldo) {
      lista = lista.filter(s => {
        if (localId) return (s.porLocal[localId] || 0) > 0;
        return s.total > 0;
      });
    }

    if (apenasSaldoNegativo) {
      lista = lista.filter(s => {
        if (localId) return (s.porLocal[localId] || 0) < 0;
        return s.total < 0;
      });
    }

    return lista.sort((a, b) => a.produto.nome_produto?.localeCompare(b.produto.nome_produto || ''));
  }, [saldosTotais, localId, buscaProduto, apenasComSaldo, apenasSaldoNegativo]);

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

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_estoque', JSON.stringify(novas));
      return novas;
    });
  };

  const toggleTipo = (tipo) => {
    setTiposSelecionados(prev => prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo]);
  };

  const limparFiltros = () => {
    setDataInicial('');
    setDataFinal('');
    setLocalId('');
    setBuscaProduto('');
    setTiposSelecionados([]);
    setCentroCustoId('');
    setApenasComSaldo(false);
    setApenasSaldoNegativo(false);
    setOrdenacao('data_desc');
    setTipoRelatorio('saldo');
  };

  const localSelecionadoNome = locais.find(l => l.id === localId)?.nome || '';

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Estoque</h1>
          <p className="text-xs text-slate-600">Saldos, movimentações e resumos</p>
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros */}
      <Card className="print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Orientação</Label>
              <Select value={orientacao} onValueChange={setOrientacao}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="retrato">Retrato</SelectItem>
                  <SelectItem value="paisagem">Paisagem</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo Relatório</Label>
              <Select value={tipoRelatorio} onValueChange={setTipoRelatorio}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="saldo">Saldo Atual</SelectItem>
                  <SelectItem value="extrato">Extrato Movimentações</SelectItem>
                  <SelectItem value="resumo">Resumo por Período</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Local de Estoque</Label>
              <Select value={localId} onValueChange={setLocalId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Todos</SelectItem>
                  {locais.map(l => <SelectItem key={l.id} value={l.id} className="text-xs">{l.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ordenar Por</Label>
              <Select value={ordenacao} onValueChange={setOrdenacao}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORDENACAO_OPCOES.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Buscar Produto</Label>
              <Input 
                value={buscaProduto} 
                onChange={(e) => setBuscaProduto(e.target.value)} 
                placeholder="Nome, código interno ou barras..." 
                className="h-8 text-xs" 
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Centro de Custo</Label>
              <Select value={centroCustoId} onValueChange={setCentroCustoId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>Todos</SelectItem>
                  {centrosCusto.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-4">
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
          </div>

          <div className="flex gap-2 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Tipos {tiposSelecionados.length > 0 && `(${tiposSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-48">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Tipos de Movimentação</h4>
                  {TIPOS_MOVIMENTACAO.map(t => (
                    <div key={t.value} className="flex items-center space-x-2">
                      <Checkbox checked={tiposSelecionados.includes(t.value)} onCheckedChange={() => toggleTipo(t.value)} />
                      <label className="text-sm cursor-pointer">{t.label}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {tipoRelatorio === 'extrato' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                    <Settings className="w-3.5 h-3.5" />
                    Colunas
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
                  <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COLUNAS_EXTRATO.map((coluna) => (
                    <DropdownMenuCheckboxItem
                      key={coluna.id}
                      checked={colunasVisiveis.includes(coluna.id)}
                      onCheckedChange={() => toggleColuna(coluna.id)}
                    >
                      {coluna.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={limparFiltros}>Limpar Filtros</Button>
          </div>
        </CardContent>
      </Card>

      {/* Área de Impressão */}
      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page { size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'}; margin: 1.5cm 1cm 2cm 1cm; }
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; }
            header, nav, .no-print, .print\\:hidden { display: none !important; }
          }
        `}} />

        <div className="print-area p-8 print:p-0">
          {/* Cabeçalho */}
          <div className="border-b-2 border-black pb-1 mb-2">
            <div className="flex items-center justify-between gap-3">
              {empresaAtual?.logotipo_url && (
                <img src={empresaAtual.logotipo_url} alt={empresaAtual.apelido || "Logo"} className="h-24 w-24 object-contain" />
              )}
              <div className="flex-1 text-center">
                <h1 className="text-base font-bold leading-tight uppercase">{empresaAtual?.nome || 'Empresa'}</h1>
                {empresaAtual?.apelido && empresaAtual.apelido !== empresaAtual.nome && (
                  <p className="text-xs leading-tight">{empresaAtual.apelido}</p>
                )}
                {empresaAtual?.endereco && (
                  <p className="text-xs leading-tight">
                    {empresaAtual.endereco}
                    {empresaAtual?.cidade && empresaAtual?.estado && `, ${empresaAtual.cidade}-${empresaAtual.estado}`}
                  </p>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold">
                Relatório de Estoque - {tipoRelatorio === 'saldo' ? 'Saldo Atual' : tipoRelatorio === 'extrato' ? 'Extrato de Movimentações' : 'Resumo por Período'}
              </h2>
              {(dataInicial || dataFinal) && (
                <p className="text-xs text-gray-600">
                  Período: {dataInicial ? formatarData(dataInicial) : "Início"} a {dataFinal ? formatarData(dataFinal) : "Hoje"}
                </p>
              )}
              {localId && <p className="text-xs text-gray-600">Local: {localSelecionadoNome}</p>}
              <p className="text-xs text-gray-600">
                {tipoRelatorio === 'saldo' && `${listaSaldos.length} produtos | Saldo Geral: ${formatarNumero(totalizadores.saldoGeral)}`}
                {tipoRelatorio === 'extrato' && `${movimentacoesFiltradas.length} movimentações | Entradas: ${formatarNumero(totalizadores.totalEntradas)} | Saídas: ${formatarNumero(totalizadores.totalSaidas)}`}
                {tipoRelatorio === 'resumo' && `${resumoPeriodo.length} produtos | Entradas: ${formatarNumero(resumoPeriodo.reduce((s, i) => s + i.entradas, 0))} | Saídas: ${formatarNumero(resumoPeriodo.reduce((s, i) => s + i.saidas, 0))}`}
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-12 text-slate-400">Carregando...</div>
          ) : tipoRelatorio === 'saldo' ? (
            /* RELATÓRIO - SALDO ATUAL */
            <>
              {listaSaldos.length === 0 ? (
                <div className="text-center py-12 text-slate-400">Nenhum produto encontrado.</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>
                        <TableHead className="border border-black text-xs font-bold py-1">Código</TableHead>
                        <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>
                        <TableHead className="border border-black text-xs font-bold text-right py-1">Entradas</TableHead>
                        <TableHead className="border border-black text-xs font-bold text-right py-1">Saídas</TableHead>
                        <TableHead className="border border-black text-xs font-bold text-right py-1">Saldo Total</TableHead>
                        {localId && <TableHead className="border border-black text-xs font-bold text-right py-1">Saldo Local</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {listaSaldos.map((item) => (
                        <TableRow key={item.produto.id} className="hover:bg-gray-50">
                          <TableCell className="border border-gray-300 text-xs py-1">{item.produto.nome_produto}</TableCell>
                          <TableCell className="border border-gray-300 text-xs py-1">{item.produto.codigo_interno || '-'}</TableCell>
                          <TableCell className="border border-gray-300 text-xs py-1">{item.produto.unidade_medida || 'UN'}</TableCell>
                          <TableCell className="border border-gray-300 text-xs py-1 text-right text-green-700">{formatarNumero(item.totalEntradas)}</TableCell>
                          <TableCell className="border border-gray-300 text-xs py-1 text-right text-red-700">{formatarNumero(item.totalSaidas)}</TableCell>
                          <TableCell className={`border border-gray-300 text-xs py-1 text-right font-bold ${item.total < 0 ? 'text-red-700' : ''}`}>
                            {formatarNumero(item.total)}
                          </TableCell>
                          {localId && (
                            <TableCell className={`border border-gray-300 text-xs py-1 text-right font-bold ${(item.saldoNoLocal || 0) < 0 ? 'text-red-700' : ''}`}>
                              {formatarNumero(item.saldoNoLocal || 0)}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Table className="mt-1">
                    <TableBody>
                      <TableRow className="bg-gray-100 font-bold">
                        <TableCell colSpan={10} className="border border-black text-xs py-1">
                          TOTAL: {listaSaldos.length} produtos | Saldo Geral: {formatarNumero(totalizadores.saldoGeral)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </>
              )}
            </>
          ) : tipoRelatorio === 'extrato' ? (
            /* RELATÓRIO - EXTRATO */
            <>
              {movimentacoesFiltradas.length === 0 ? (
                <div className="text-center py-12 text-slate-400">Nenhuma movimentação encontrada.</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {colunasVisiveis.includes('data') && <TableHead className="border border-black text-xs font-bold py-1">Data</TableHead>}
                        {colunasVisiveis.includes('numero') && <TableHead className="border border-black text-xs font-bold py-1">Nº</TableHead>}
                        {colunasVisiveis.includes('tipo') && <TableHead className="border border-black text-xs font-bold py-1">Tipo</TableHead>}
                        {colunasVisiveis.includes('operacao') && <TableHead className="border border-black text-xs font-bold py-1">Operação</TableHead>}
                        {colunasVisiveis.includes('produto') && <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>}
                        {colunasVisiveis.includes('codigo') && <TableHead className="border border-black text-xs font-bold py-1">Código</TableHead>}
                        {colunasVisiveis.includes('quantidade') && <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd</TableHead>}
                        {colunasVisiveis.includes('unidade') && <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>}
                        {colunasVisiveis.includes('origem') && <TableHead className="border border-black text-xs font-bold py-1">Origem</TableHead>}
                        {colunasVisiveis.includes('destino') && <TableHead className="border border-black text-xs font-bold py-1">Destino</TableHead>}
                        {colunasVisiveis.includes('centro_custo') && <TableHead className="border border-black text-xs font-bold py-1">C.Custo</TableHead>}
                        {colunasVisiveis.includes('documento') && <TableHead className="border border-black text-xs font-bold py-1">Doc</TableHead>}
                        {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Forn./Cli</TableHead>}
                        {colunasVisiveis.includes('valor_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr.Unit</TableHead>}
                        {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr.Total</TableHead>}
                        {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Obs</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movimentacoesFiltradas.map((mov) => (
                        <TableRow key={mov.id} className="hover:bg-gray-50">
                          {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(mov.data_movimentacao)}</TableCell>}
                          {colunasVisiveis.includes('numero') && <TableCell className="border border-gray-300 text-xs py-1">{mov.numero_movimentacao || '-'}</TableCell>}
                          {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs py-1">{mov.tipo_movimentacao}</TableCell>}
                          {colunasVisiveis.includes('operacao') && <TableCell className="border border-gray-300 text-xs py-1">{mov.tipo_detalhado || '-'}</TableCell>}
                          {colunasVisiveis.includes('produto') && <TableCell className="border border-gray-300 text-xs py-1">{mov.produto_nome}</TableCell>}
                          {colunasVisiveis.includes('codigo') && <TableCell className="border border-gray-300 text-xs py-1">{mov.produto_codigo || '-'}</TableCell>}
                          {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs py-1 text-right">{formatarNumero(mov.quantidade)}</TableCell>}
                          {colunasVisiveis.includes('unidade') && <TableCell className="border border-gray-300 text-xs py-1">{mov.unidade_medida || '-'}</TableCell>}
                          {colunasVisiveis.includes('origem') && <TableCell className="border border-gray-300 text-xs py-1">{mov.local_estoque_origem || '-'}</TableCell>}
                          {colunasVisiveis.includes('destino') && <TableCell className="border border-gray-300 text-xs py-1">{mov.local_estoque_destino || '-'}</TableCell>}
                          {colunasVisiveis.includes('centro_custo') && <TableCell className="border border-gray-300 text-xs py-1">{mov.centro_custo_nome || '-'}</TableCell>}
                          {colunasVisiveis.includes('documento') && <TableCell className="border border-gray-300 text-xs py-1">{mov.numero_documento || '-'}</TableCell>}
                          {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{mov.fornecedor_nome || mov.cliente_nome || '-'}</TableCell>}
                          {colunasVisiveis.includes('valor_unitario') && <TableCell className="border border-gray-300 text-xs py-1 text-right">{mov.valor_unitario ? formatarNumero(mov.valor_unitario) : '-'}</TableCell>}
                          {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs py-1 text-right">{mov.valor_total ? formatarNumero(mov.valor_total) : '-'}</TableCell>}
                          {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1 max-w-[100px] truncate">{mov.observacoes || '-'}</TableCell>}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Table className="mt-1">
                    <TableBody>
                      <TableRow className="bg-gray-100 font-bold">
                        <TableCell colSpan={20} className="border border-black text-xs py-1">
                          TOTAL: {movimentacoesFiltradas.length} movimentações | Entradas: {formatarNumero(totalizadores.totalEntradas)} | Saídas: {formatarNumero(totalizadores.totalSaidas)} | Saldo: {formatarNumero(totalizadores.totalEntradas - totalizadores.totalSaidas)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </>
              )}
            </>
          ) : (
            /* RELATÓRIO - RESUMO POR PERÍODO */
            <>
              {resumoPeriodo.length === 0 ? (
                <div className="text-center py-12 text-slate-400">Nenhum dado encontrado.</div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>
                        <TableHead className="border border-black text-xs font-bold py-1">Código</TableHead>
                        <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>
                        <TableHead className="border border-black text-xs font-bold text-right py-1">Entradas</TableHead>
                        <TableHead className="border border-black text-xs font-bold text-right py-1">Saídas</TableHead>
                        <TableHead className="border border-black text-xs font-bold text-right py-1">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resumoPeriodo.map((item) => (
                        <TableRow key={item.produto_id} className="hover:bg-gray-50">
                          <TableCell className="border border-gray-300 text-xs py-1">{item.produto_nome}</TableCell>
                          <TableCell className="border border-gray-300 text-xs py-1">{item.produto_codigo || '-'}</TableCell>
                          <TableCell className="border border-gray-300 text-xs py-1">{item.unidade || 'UN'}</TableCell>
                          <TableCell className="border border-gray-300 text-xs py-1 text-right text-green-700 font-semibold">{formatarNumero(item.entradas)}</TableCell>
                          <TableCell className="border border-gray-300 text-xs py-1 text-right text-red-700 font-semibold">{formatarNumero(item.saidas)}</TableCell>
                          <TableCell className={`border border-gray-300 text-xs py-1 text-right font-bold ${item.saldo < 0 ? 'text-red-700' : ''}`}>
                            {formatarNumero(item.saldo)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Table className="mt-1">
                    <TableBody>
                      <TableRow className="bg-gray-100 font-bold">
                        <TableCell colSpan={10} className="border border-black text-xs py-1">
                          TOTAL: {resumoPeriodo.length} produtos | Entradas: {formatarNumero(resumoPeriodo.reduce((s, i) => s + i.entradas, 0))} | Saídas: {formatarNumero(resumoPeriodo.reduce((s, i) => s + i.saidas, 0))} | Saldo: {formatarNumero(resumoPeriodo.reduce((s, i) => s + i.saldo, 0))}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </>
              )}
            </>
          )}

          {/* Rodapé */}
          <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
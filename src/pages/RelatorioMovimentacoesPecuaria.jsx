import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, TrendingUp, TrendingDown, Filter } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "";
  if (numero === 0) return "";
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

const COLUNAS_ANALITICO = [
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'motivo', label: 'Motivo', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'categoria_nova', label: 'Cat. Nova', default: false },
  { id: 'marca', label: 'Marca', default: true },
  { id: 'sexo', label: 'Sexo', default: false },
  { id: 'peso_medio', label: 'Peso Médio', default: false },
  { id: 'peso_total', label: 'Peso Total', default: false },
  { id: 'area_origem', label: 'Área Origem', default: false },
  { id: 'area_destino', label: 'Área Destino', default: false },
  { id: 'area', label: 'Área (Orig/Dest)', default: true },
  { id: 'fornecedor', label: 'Fornecedor', default: false },
  { id: 'comprador', label: 'Comprador/Destino', default: false },
  { id: 'nota_fiscal', label: 'Nota Fiscal', default: false },
  { id: 'gta', label: 'GTA', default: false },
  { id: 'causa_morte', label: 'Causa Morte', default: false },
  { id: 'transf_origem', label: 'Transf. Origem', default: false },
  { id: 'transf_destino', label: 'Transf. Destino', default: false },
  { id: 'valor_unitario', label: 'Valor Unit.', default: false },
  { id: 'valor_total', label: 'Valor Total', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
  { id: 'responsavel', label: 'Responsável', default: false },
];

const AGRUPAMENTOS_DISPONIVEIS = [
  { id: 'categoria', label: 'Categoria' },
  { id: 'marca', label: 'Marca' },
  { id: 'motivo', label: 'Motivo' },
  { id: 'tipo', label: 'Tipo (Entrada/Saída)' },
  { id: 'area_origem', label: 'Área Origem' },
  { id: 'area_destino', label: 'Área Destino' },
  { id: 'fornecedor', label: 'Fornecedor' },
  { id: 'comprador', label: 'Comprador/Destino' },
  { id: 'sexo', label: 'Sexo' },
  { id: 'mes', label: 'Mês/Ano' },
];

const COLUNAS_SINTETICO = [
  { id: 'agrupamento', label: 'Agrupamento', default: true },
  { id: 'entradas', label: 'Entradas', default: true },
  { id: 'saidas', label: 'Saídas', default: true },
  { id: 'saldo', label: 'Saldo', default: true },
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antigo)' },
  { value: 'quantidade_desc', label: 'Quantidade (Maior)' },
  { value: 'quantidade_asc', label: 'Quantidade (Menor)' },
  { value: 'categoria_asc', label: 'Categoria (A-Z)' },
  { value: 'categoria_desc', label: 'Categoria (Z-A)' },
];

export default function RelatorioMovimentacoesPecuaria() {
  const [showConfig, setShowConfig] = useState(false);
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico");
  const [orientacao, setOrientacao] = useState("paisagem");
  const [ordenacao, setOrdenacao] = useState('data_desc');
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [tipoSelecionado, setTipoSelecionado] = useState("todos");
  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [marcasSelecionadas, setMarcasSelecionadas] = useState([]);
  const [motivosSelecionados, setMotivosSelecionados] = useState([]);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const getColunasDisponiveis = () => {
    return tipoRelatorio === 'sintetico' ? COLUNAS_SINTETICO : COLUNAS_ANALITICO;
  };

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    return getColunasDisponiveis().filter(c => c.default).map(c => c.id);
  });

  React.useEffect(() => {
    setColunasVisiveis(getColunasDisponiveis().filter(c => c.default).map(c => c.id));
  }, [tipoRelatorio]);

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
  const motivosUnicos = [...new Set(movimentacoes.map(m => m.motivo))].filter(Boolean).sort();
  const areasOrigemUnicas = [...new Set(movimentacoes.map(m => m.area_origem_nome))].filter(Boolean).sort();
  const areasDestinoUnicas = [...new Set(movimentacoes.map(m => m.area_destino_nome))].filter(Boolean).sort();
  const fornecedoresUnicos = [...new Set(movimentacoes.map(m => m.fornecedor_origem))].filter(Boolean).sort();
  const compradoresUnicos = [...new Set(movimentacoes.map(m => m.destino_venda))].filter(Boolean).sort();

  const movimentacoesFiltradas = useMemo(() => {
    let filtered = movimentacoes.filter(m => {
      if (tipoSelecionado !== "todos" && m.tipo !== tipoSelecionado) return false;
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(m.categoria_animal)) return false;
      if (marcasSelecionadas.length > 0 && !marcasSelecionadas.includes(m.marca)) return false;
      if (motivosSelecionados.length > 0 && !motivosSelecionados.includes(m.motivo)) return false;
      
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

    // Ordenação
    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_asc': return new Date(a.data_movimentacao) - new Date(b.data_movimentacao);
        case 'data_desc': return new Date(b.data_movimentacao) - new Date(a.data_movimentacao);
        case 'quantidade_asc': return (a.quantidade_animais || 0) - (b.quantidade_animais || 0);
        case 'quantidade_desc': return (b.quantidade_animais || 0) - (a.quantidade_animais || 0);
        case 'categoria_asc': return (a.categoria_animal || '').localeCompare(b.categoria_animal || '');
        case 'categoria_desc': return (b.categoria_animal || '').localeCompare(a.categoria_animal || '');
        default: return 0;
      }
    });

    return filtered;
  }, [movimentacoes, tipoSelecionado, categoriasSelecionadas, marcasSelecionadas, motivosSelecionados, dataInicio, dataFim, ordenacao]);

  // Função para obter valor do campo de agrupamento
  const getValorAgrupamento = (m, campo) => {
    switch (campo) {
      case 'categoria': return m.categoria_animal || 'Sem Categoria';
      case 'marca': return m.marca || 'Sem Marca';
      case 'motivo': return m.motivo || 'Sem Motivo';
      case 'tipo': return m.tipo || 'Sem Tipo';
      case 'area_origem': return m.area_origem_nome || 'Sem Origem';
      case 'area_destino': return m.area_destino_nome || 'Sem Destino';
      case 'fornecedor': return m.fornecedor_origem || 'Sem Fornecedor';
      case 'comprador': return m.destino_venda || 'Sem Comprador';
      case 'sexo': return m.sexo || 'Sem Sexo';
      case 'mes': 
        if (!m.data_movimentacao) return 'Sem Data';
        const d = new Date(m.data_movimentacao);
        return format(d, 'MM/yyyy', { locale: ptBR });
      default: return 'Sem classificação';
    }
  };

  // Dados para relatório
  const dadosRelatorio = useMemo(() => {
    const agrupamentos = agrupamentosAtivos.length > 0 ? agrupamentosAtivos : ['categoria'];

    if (tipoRelatorio === 'sintetico') {
      const grupos = {};
      
      movimentacoesFiltradas.forEach(m => {
        // Gera chave composta para múltiplos agrupamentos
        const partesChave = agrupamentos.map(ag => getValorAgrupamento(m, ag));
        const chave = partesChave.join(' | ');
        
        if (!grupos[chave]) {
          grupos[chave] = { 
            agrupamento: chave, 
            partes: partesChave,
            entradas: 0, 
            saidas: 0, 
            saldo: 0,
            peso_total: 0,
            valor_total: 0
          };
        }
        
        const qtd = m.quantidade_animais || 0;
        if (m.tipo === 'Entrada') {
          grupos[chave].entradas += qtd;
          grupos[chave].saldo += qtd;
        } else {
          grupos[chave].saidas += qtd;
          grupos[chave].saldo -= qtd;
        }
        grupos[chave].peso_total += m.peso_total || 0;
        grupos[chave].valor_total += m.valor_total || 0;
      });
      
      return { 
        tipo: 'sintetico', 
        dados: Object.values(grupos).sort((a, b) => a.agrupamento.localeCompare(b.agrupamento)),
        agrupamentos
      };
    } else {
      // Analítico com agrupamento opcional (múltiplos níveis)
      if (agrupamentosAtivos.length === 0) {
        return { tipo: 'analitico', dados: { "Todas as Movimentações": movimentacoesFiltradas }, agrupamentos: [] };
      }

      const grupos = {};
      movimentacoesFiltradas.forEach(m => {
        const partesChave = agrupamentos.map(ag => getValorAgrupamento(m, ag));
        const chave = partesChave.join(' | ');
        if (!grupos[chave]) grupos[chave] = [];
        grupos[chave].push(m);
      });
      return { tipo: 'analitico', dados: grupos, agrupamentos };
    }
  }, [tipoRelatorio, movimentacoesFiltradas, agrupamentosAtivos]);

  const totalEntradas = movimentacoesFiltradas.filter(m => m.tipo === 'Entrada').reduce((sum, m) => sum + (m.quantidade_animais || 0), 0);
  const totalSaidas = movimentacoesFiltradas.filter(m => m.tipo === 'Saída').reduce((sum, m) => sum + (m.quantidade_animais || 0), 0);
  const saldoPeriodo = totalEntradas - totalSaidas;

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId]);
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const toggleAgrupamento = (tipo) => {
    setAgrupamentosAtivos(prev => {
      if (prev.includes(tipo)) {
        return prev.filter(t => t !== tipo);
      }
      // Permite múltiplos agrupamentos
      return [...prev, tipo];
    });
  };

  const limparFiltros = () => {
    setCategoriasSelecionadas([]);
    setMarcasSelecionadas([]);
    setMotivosSelecionados([]);
    setDataInicio("");
    setDataFim("");
    setTipoSelecionado('todos');
    setAgrupamentosAtivos([]);
    setOrdenacao('data_desc');
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Movimentações Pecuárias</h1>
          <p className="text-xs text-slate-600">Análise de entradas, saídas e saldos do rebanho</p>
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros e Configurações - Visíveis na Tela */}
      <Card className="print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Tipo Relatório</Label>
              <Select value={tipoRelatorio} onValueChange={setTipoRelatorio}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="analitico">Analítico</SelectItem>
                  <SelectItem value="sintetico">Sintético</SelectItem>
                </SelectContent>
              </Select>
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
              <Label className="text-xs">Tipo Mov.</Label>
              <Select value={tipoSelecionado} onValueChange={setTipoSelecionado}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="Entrada">Entradas</SelectItem>
                  <SelectItem value="Saída">Saídas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipoRelatorio === 'analitico' && (
              <div className="space-y-1">
                <Label className="text-xs">Ordenar</Label>
                <Select value={ordenacao} onValueChange={setOrdenacao}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORDENACAO_OPCOES.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Categorias {categoriasSelecionadas.length > 0 && `(${categoriasSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Categorias</h4>
                  {categoriasUnicas.map(c => (
                    <div key={c} className="flex items-center space-x-2">
                      <Checkbox checked={categoriasSelecionadas.includes(c)} onCheckedChange={() => toggleFiltro(categoriasSelecionadas, setCategoriasSelecionadas, c)} />
                      <label className="text-sm cursor-pointer">{c}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Marcas {marcasSelecionadas.length > 0 && `(${marcasSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Marcas</h4>
                  {marcasUnicas.map(m => (
                    <div key={m} className="flex items-center space-x-2">
                      <Checkbox checked={marcasSelecionadas.includes(m)} onCheckedChange={() => toggleFiltro(marcasSelecionadas, setMarcasSelecionadas, m)} />
                      <label className="text-sm cursor-pointer">{m}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Motivos {motivosSelecionados.length > 0 && `(${motivosSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Motivos</h4>
                  {motivosUnicos.map(m => (
                    <div key={m} className="flex items-center space-x-2">
                      <Checkbox checked={motivosSelecionados.includes(m)} onCheckedChange={() => toggleFiltro(motivosSelecionados, setMotivosSelecionados, m)} />
                      <label className="text-sm cursor-pointer">{m}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                  <Settings className="w-3.5 h-3.5" />
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-auto">
                <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {getColunasDisponiveis().map((coluna) => (
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

            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={limparFiltros}>Limpar</Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Agrupar Por</Label>
            <div className="flex flex-wrap gap-1">
              {AGRUPAMENTOS_DISPONIVEIS.map((ag) => (
                <Button 
                  key={ag.id} 
                  variant={agrupamentosAtivos.includes(ag.id) ? "default" : "outline"} 
                  size="sm" 
                  onClick={() => toggleAgrupamento(ag.id)} 
                  className={`h-7 text-xs ${agrupamentosAtivos.includes(ag.id) ? "bg-slate-700 hover:bg-slate-800" : ""}`}
                >
                  {ag.label}
                  {agrupamentosAtivos.includes(ag.id) && agrupamentosAtivos.length > 1 && (
                    <span className="ml-1 text-[10px] bg-white text-slate-700 px-1 rounded">
                      {agrupamentosAtivos.indexOf(ag.id) + 1}
                    </span>
                  )}
                </Button>
              ))}
            </div>
            {agrupamentosAtivos.length > 1 && (
              <p className="text-xs text-slate-500">Ordem: {agrupamentosAtivos.map(a => AGRUPAMENTOS_DISPONIVEIS.find(ag => ag.id === a)?.label).join(' → ')}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Área de Impressão */}
      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page {
              size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'};
              margin: 1.5cm 1cm 2cm 1cm;
            }
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
              {empresaAtual?.logotipo_url ? (
                <img src={empresaAtual.logotipo_url} alt={empresaAtual.apelido || "Logo"} className="h-24 w-24 object-contain" />
              ) : (
                <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" alt="Logo" className="h-24 w-24 object-contain" />
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
                Relatório de Movimentações Pecuárias - {tipoRelatorio === 'analitico' ? 'ANALÍTICO' : 'SINTÉTICO'}
              </h2>
              {(dataInicio || dataFim) && (
                <p className="text-xs text-gray-600">
                  Período: {dataInicio ? formatarData(dataInicio) : 'Início'} a {dataFim ? formatarData(dataFim) : 'Atual'}
                </p>
              )}
              <p className="text-xs text-gray-600">
                {movimentacoesFiltradas.length} registro(s) • Entradas: +{formatarNumero(totalEntradas)} cab • Saídas: -{formatarNumero(totalSaidas)} cab • Saldo: {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
              </p>
            </div>
          </div>

          {/* Conteúdo do Relatório */}
          {dadosRelatorio.tipo === 'sintetico' && (
            <Table>
              <TableHeader>
                <TableRow className="border-black">
                  {dadosRelatorio.agrupamentos?.map((ag, i) => (
                    <TableHead key={ag} className="border border-black text-xs font-bold py-1">
                      {AGRUPAMENTOS_DISPONIVEIS.find(a => a.id === ag)?.label || ag}
                    </TableHead>
                  ))}
                  {colunasVisiveis.includes('entradas') && <TableHead className="border border-black text-xs font-bold text-right py-1">Entradas</TableHead>}
                  {colunasVisiveis.includes('saidas') && <TableHead className="border border-black text-xs font-bold text-right py-1">Saídas</TableHead>}
                  {colunasVisiveis.includes('saldo') && <TableHead className="border border-black text-xs font-bold text-right py-1">Saldo</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dadosRelatorio.dados.map((grupo, idx) => (
                  <TableRow key={idx}>
                    {grupo.partes?.map((parte, i) => (
                      <TableCell key={i} className="border border-gray-300 text-xs py-1 font-semibold">{parte}</TableCell>
                    ))}
                    {colunasVisiveis.includes('entradas') && <TableCell className="border border-gray-300 text-xs text-right py-1">{grupo.entradas ? formatarNumero(grupo.entradas) : ''}</TableCell>}
                    {colunasVisiveis.includes('saidas') && <TableCell className="border border-gray-300 text-xs text-right py-1">{grupo.saidas ? formatarNumero(grupo.saidas) : ''}</TableCell>}
                    {colunasVisiveis.includes('saldo') && <TableCell className="border border-gray-300 text-xs text-right py-1 font-bold">{grupo.saldo ? `${formatarNumero(grupo.saldo)} cab` : ''}</TableCell>}
                  </TableRow>
                ))}
                <TableRow className="bg-gray-100 font-bold">
                  <TableCell colSpan={dadosRelatorio.agrupamentos?.length || 1} className="border border-black text-xs py-1">TOTAL GERAL</TableCell>
                  {colunasVisiveis.includes('entradas') && <TableCell className="border border-black text-xs text-right py-1">{totalEntradas ? formatarNumero(totalEntradas) : ''}</TableCell>}
                  {colunasVisiveis.includes('saidas') && <TableCell className="border border-black text-xs text-right py-1">{totalSaidas ? formatarNumero(totalSaidas) : ''}</TableCell>}
                  {colunasVisiveis.includes('saldo') && <TableCell className="border border-black text-xs text-right py-1">{saldoPeriodo ? `${formatarNumero(saldoPeriodo)} cab` : ''}</TableCell>}
                </TableRow>
              </TableBody>
            </Table>
          )}

          {dadosRelatorio.tipo === 'analitico' && (
            Object.entries(dadosRelatorio.dados).map(([grupo, registros], idx) => {
              const totalGrupoEntradas = registros.filter(r => r.tipo === 'Entrada').reduce((s, r) => s + (r.quantidade_animais || 0), 0);
              const totalGrupoSaidas = registros.filter(r => r.tipo === 'Saída').reduce((s, r) => s + (r.quantidade_animais || 0), 0);
              const saldoGrupo = totalGrupoEntradas - totalGrupoSaidas;
              
              return (
                <div key={idx} className="mb-4">
                  {agrupamentosAtivos.length > 0 && (
                    <div className="bg-gray-200 px-2 py-1 mb-1">
                      <h3 className="font-bold text-xs">{grupo} ({registros.length} registro(s)) • Ent: +{formatarNumero(totalGrupoEntradas)} • Saí: -{formatarNumero(totalGrupoSaidas)} • Saldo: {saldoGrupo >= 0 ? '+' : ''}{formatarNumero(saldoGrupo)}</h3>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow className="border-black">
                        {colunasVisiveis.includes('data') && <TableHead className="border border-black text-xs font-bold py-1">Data</TableHead>}
                        {colunasVisiveis.includes('tipo') && <TableHead className="border border-black text-xs font-bold py-1">Tipo</TableHead>}
                        {colunasVisiveis.includes('motivo') && <TableHead className="border border-black text-xs font-bold py-1">Motivo</TableHead>}
                        {colunasVisiveis.includes('quantidade') && <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd</TableHead>}
                        {colunasVisiveis.includes('categoria') && <TableHead className="border border-black text-xs font-bold py-1">Categoria</TableHead>}
                        {colunasVisiveis.includes('categoria_nova') && <TableHead className="border border-black text-xs font-bold py-1">Cat. Nova</TableHead>}
                        {colunasVisiveis.includes('marca') && <TableHead className="border border-black text-xs font-bold py-1">Marca</TableHead>}
                        {colunasVisiveis.includes('sexo') && <TableHead className="border border-black text-xs font-bold py-1">Sexo</TableHead>}
                        {colunasVisiveis.includes('peso_medio') && <TableHead className="border border-black text-xs font-bold text-right py-1">Peso Méd.</TableHead>}
                        {colunasVisiveis.includes('peso_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Peso Total</TableHead>}
                        {colunasVisiveis.includes('area_origem') && <TableHead className="border border-black text-xs font-bold py-1">Origem</TableHead>}
                        {colunasVisiveis.includes('area_destino') && <TableHead className="border border-black text-xs font-bold py-1">Destino</TableHead>}
                        {colunasVisiveis.includes('area') && <TableHead className="border border-black text-xs font-bold py-1">Área</TableHead>}
                        {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Fornecedor</TableHead>}
                        {colunasVisiveis.includes('comprador') && <TableHead className="border border-black text-xs font-bold py-1">Comprador</TableHead>}
                        {colunasVisiveis.includes('nota_fiscal') && <TableHead className="border border-black text-xs font-bold py-1">NF</TableHead>}
                        {colunasVisiveis.includes('gta') && <TableHead className="border border-black text-xs font-bold py-1">GTA</TableHead>}
                        {colunasVisiveis.includes('causa_morte') && <TableHead className="border border-black text-xs font-bold py-1">Causa Morte</TableHead>}
                        {colunasVisiveis.includes('transf_origem') && <TableHead className="border border-black text-xs font-bold py-1">Transf. Orig.</TableHead>}
                        {colunasVisiveis.includes('transf_destino') && <TableHead className="border border-black text-xs font-bold py-1">Transf. Dest.</TableHead>}
                        {colunasVisiveis.includes('valor_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr Unit.</TableHead>}
                        {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr Total</TableHead>}
                        {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Obs.</TableHead>}
                        {colunasVisiveis.includes('responsavel') && <TableHead className="border border-black text-xs font-bold py-1">Resp.</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registros.map((m) => {
                        const areaExibir = m.tipo === 'Entrada' ? m.area_destino_nome : m.area_origem_nome;
                        return (
                          <TableRow key={m.id}>
                            {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(m.data_movimentacao)}</TableCell>}
                            {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs py-1">{m.tipo || ''}</TableCell>}
                            {colunasVisiveis.includes('motivo') && <TableCell className="border border-gray-300 text-xs py-1">{m.motivo || ''}</TableCell>}
                            {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.quantidade_animais || ''}</TableCell>}
                            {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs py-1">{m.categoria_animal || ''}</TableCell>}
                            {colunasVisiveis.includes('categoria_nova') && <TableCell className="border border-gray-300 text-xs py-1">{m.categoria_nova || ''}</TableCell>}
                            {colunasVisiveis.includes('marca') && <TableCell className="border border-gray-300 text-xs py-1">{m.marca || ''}</TableCell>}
                            {colunasVisiveis.includes('sexo') && <TableCell className="border border-gray-300 text-xs py-1">{m.sexo || ''}</TableCell>}
                            {colunasVisiveis.includes('peso_medio') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.peso_medio ? `${m.peso_medio} kg` : ''}</TableCell>}
                            {colunasVisiveis.includes('peso_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.peso_total ? `${m.peso_total} kg` : ''}</TableCell>}
                            {colunasVisiveis.includes('area_origem') && <TableCell className="border border-gray-300 text-xs py-1">{m.area_origem_nome || ''}</TableCell>}
                            {colunasVisiveis.includes('area_destino') && <TableCell className="border border-gray-300 text-xs py-1">{m.area_destino_nome || ''}</TableCell>}
                            {colunasVisiveis.includes('area') && <TableCell className="border border-gray-300 text-xs py-1">{areaExibir || ''}</TableCell>}
                            {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{m.fornecedor_origem || ''}</TableCell>}
                            {colunasVisiveis.includes('comprador') && <TableCell className="border border-gray-300 text-xs py-1">{m.destino_venda || ''}</TableCell>}
                            {colunasVisiveis.includes('nota_fiscal') && <TableCell className="border border-gray-300 text-xs py-1">{m.nota_fiscal || ''}</TableCell>}
                            {colunasVisiveis.includes('gta') && <TableCell className="border border-gray-300 text-xs py-1">{m.gta || ''}</TableCell>}
                            {colunasVisiveis.includes('causa_morte') && <TableCell className="border border-gray-300 text-xs py-1">{m.causa_morte || ''}</TableCell>}
                            {colunasVisiveis.includes('transf_origem') && <TableCell className="border border-gray-300 text-xs py-1">{m.transferencia_origem || ''}</TableCell>}
                            {colunasVisiveis.includes('transf_destino') && <TableCell className="border border-gray-300 text-xs py-1">{m.transferencia_destino || ''}</TableCell>}
                            {colunasVisiveis.includes('valor_unitario') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.valor_unitario ? `R$ ${m.valor_unitario.toFixed(2)}` : ''}</TableCell>}
                            {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.valor_total ? `R$ ${m.valor_total.toFixed(2)}` : ''}</TableCell>}
                            {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1 max-w-[100px] truncate" title={m.observacoes}>{m.observacoes || ''}</TableCell>}
                            {colunasVisiveis.includes('responsavel') && <TableCell className="border border-gray-300 text-xs py-1">{m.created_by || ''}</TableCell>}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })
          )}

          {/* Rodapé */}
          <div className="mt-4 border-t-2 border-black pt-2">
            <div className="flex justify-between items-center">
              <div className="text-xs font-bold">TOTAL: {movimentacoesFiltradas.length} registro(s)</div>
              <div className="text-xs font-bold">
                Entradas: +{formatarNumero(totalEntradas)} cab | Saídas: -{formatarNumero(totalSaidas)} cab | Saldo: {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
              </div>
            </div>
          </div>

          <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
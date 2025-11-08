
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return format(date, "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return '-';
  }
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true },
  { id: 'safra', label: 'Safra', default: true },
  { id: 'fornecedor', label: 'Fornecedor', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'quantidade_entregue', label: 'Qtd Entregue', default: true },
  { id: 'quantidade_restante', label: 'Qtd Restante', default: true },
  { id: 'unidade', label: 'Unidade', default: true },
  { id: 'valor_unitario', label: 'Valor Unit.', default: true },
  { id: 'valor_total', label: 'Valor Total', default: true },
  { id: 'prazo_entrega', label: 'Prazo Entrega', default: true },
  { id: 'data_entrega', label: 'Data Entrega', default: false },
  { id: 'status', label: 'Status', default: true },
  { id: 'forma_pagamento', label: 'Forma Pagamento', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
];

const ORDENACAO_OPCOES = [
  { value: 'numero_desc', label: 'Número (Mais Recente)' },
  { value: 'numero_asc', label: 'Número (Mais Antigo)' },
  { value: 'safra_asc', label: 'Safra (A-Z)' },
  { value: 'safra_desc', label: 'Safra (Z-A)' },
  { value: 'fornecedor_asc', label: 'Fornecedor (A-Z)' },
  { value: 'fornecedor_desc', label: 'Fornecedor (Z-A)' },
  { value: 'produto_asc', label: 'Produto (A-Z)' },
  { value: 'produto_desc', label: 'Produto (Z-A)' },
  { value: 'valor_asc', label: 'Valor Total (Menor)' },
  { value: 'valor_desc', label: 'Valor Total (Maior)' },
];

export default function RelatorioCustosSafra() {
  const [orientacao, setOrientacao] = useState("paisagem");
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('numero_desc');
  const [tipoVisualizacao, setTipoVisualizacao] = useState('detalhado');
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico"); // New state
  const [dataInicio, setDataInicio] = useState(""); // New state
  const [dataFim, setDataFim] = useState(""); // New state
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('colunas_relatorio_custos_safra');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
        }
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [safrasSelecionadas, setSafrasSelecionadas] = useState([]);
  const [fornecedoresSelecionados, setFornecedoresSelecionados] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [statusSelecionados, setStatusSelecionados] = useState([]);
  const [buscaObservacoes, setBuscaObservacoes] = useState("");

  const empresaSelecionadaId = typeof window !== 'undefined' ? localStorage.getItem('empresa_selecionada_id') : null;

  const { data: custos = [] } = useQuery({
    queryKey: ['custos_relatorio', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CustoSafra.list('-created_date');
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: safras = [] } = useQuery({
    queryKey: ['safras', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list();
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
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

  const custosComSafra = useMemo(() => {
    return custos.map(c => {
      const safra = safras.find(s => s.id === c.safra_id);
      return {
        ...c,
        safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : 'Sem safra'
      };
    });
  }, [custos, safras]);

  const safrasUnicas = [...new Set(custosComSafra.map(c => c.safra_nome))].filter(Boolean);
  const fornecedoresUnicos = [...new Set(custosComSafra.map(c => c.fornecedor_nome))].filter(Boolean);
  const produtosUnicos = [...new Set(custosComSafra.map(c => c.produto_nome))].filter(Boolean);
  const statusUnicos = ['Pendente', 'Em Trânsito', 'Entregue', 'Cancelado'];

  const custosFiltrados = useMemo(() => {
    let filtered = custosComSafra.filter(c => {
      if (safrasSelecionadas.length > 0 && !safrasSelecionadas.includes(c.safra_nome)) return false;
      if (fornecedoresSelecionados.length > 0 && !fornecedoresSelecionados.includes(c.fornecedor_nome)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(c.produto_nome)) return false;
      if (statusSelecionados.length > 0 && !statusSelecionados.includes(c.status_entrega)) return false;
      if (buscaObservacoes && !c.observacoes?.toLowerCase().includes(buscaObservacoes.toLowerCase())) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'numero_desc':
          return parseInt(b.numero_lancamento || 0) - parseInt(a.numero_lancamento || 0);
        case 'numero_asc':
          return parseInt(a.numero_lancamento || 0) - parseInt(b.numero_lancamento || 0);
        case 'safra_asc':
          return (a.safra_nome || '').localeCompare(b.safra_nome || '');
        case 'safra_desc':
          return (b.safra_nome || '').localeCompare(a.safra_nome || '');
        case 'fornecedor_asc':
          return (a.fornecedor_nome || '').localeCompare(b.fornecedor_nome || '');
        case 'fornecedor_desc':
          return (b.fornecedor_nome || '').localeCompare(a.fornecedor_nome || '');
        case 'produto_asc':
          return (a.produto_nome || '').localeCompare(b.produto_nome || '');
        case 'produto_desc':
          return (b.produto_nome || '').localeCompare(a.produto_nome || '');
        case 'valor_asc':
          return (a.valor_total || 0) - (b.valor_total || 0);
        case 'valor_desc':
          return (b.valor_total || 0) - (a.valor_total || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [custosComSafra, safrasSelecionadas, fornecedoresSelecionados, produtosSelecionados, statusSelecionados, buscaObservacoes, ordenacao]);

  const custosAgrupados = useMemo(() => {
    if (tipoVisualizacao === 'detalhado') {
      if (agrupamentosAtivos.length === 0) {
        return { "Todos os Registros": custosFiltrados };
      }

      const grupos = {};
      custosFiltrados.forEach(c => {
        let chaveArray = [];
        agrupamentosAtivos.forEach(tipo => {
          let valor;
          switch (tipo) {
            case "safra":
              valor = c.safra_nome || "Sem safra";
              break;
            case "fornecedor":
              valor = c.fornecedor_nome || "Sem fornecedor";
              break;
            case "produto":
              valor = c.produto_nome || "Sem produto";
              break;
            case "status":
              valor = c.status_entrega || "Sem status";
              break;
            default:
              valor = "Sem classificação";
          }
          chaveArray.push(valor);
        });
        const chave = chaveArray.join(" → ");
        if (!grupos[chave]) grupos[chave] = [];
        grupos[chave].push(c);
      });
      return grupos;
    } else {
      const grupos = {};
      custosFiltrados.forEach(c => {
        let actualGroupingKeys = agrupamentosAtivos.length === 0 ? ['fornecedor', 'produto'] : agrupamentosAtivos;
        
        let chaveArray = [];
        actualGroupingKeys.forEach(tipo => {
          let valor;
          switch (tipo) {
            case "safra":
              valor = c.safra_nome || "Sem safra";
              break;
            case "fornecedor":
              valor = c.fornecedor_nome || "Sem fornecedor";
              break;
            case "produto":
              valor = c.produto_nome || "Sem produto";
              break;
            case "status":
              valor = c.status_entrega || "Sem status";
              break;
            default:
              valor = "Sem classificação";
          }
          chaveArray.push(valor);
        });
        const chave = chaveArray.join(" → ");
        
        if (!grupos[chave]) {
          grupos[chave] = {
            chave,
            quantidade_total: 0,
            quantidade_entregue_total: 0,
            quantidade_restante_total: 0,
            valor_unitario_medio: 0,
            valor_total: 0,
            registros: []
          };
        }
        grupos[chave].quantidade_total += c.quantidade || 0;
        grupos[chave].quantidade_entregue_total += c.quantidade_entregue || 0;
        grupos[chave].quantidade_restante_total += (c.quantidade || 0) - (c.quantidade_entregue || 0);
        grupos[chave].valor_total += c.valor_total || 0;
        grupos[chave].registros.push(c);
      });
      
      Object.keys(grupos).forEach(chave => {
        grupos[chave].valor_unitario_medio = grupos[chave].quantidade_total > 0 ? grupos[chave].valor_total / grupos[chave].quantidade_total : 0;
      });
      
      return grupos;
    }
  }, [custosFiltrados, agrupamentosAtivos, tipoVisualizacao]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      if (typeof window !== 'undefined') {
        localStorage.setItem('colunas_relatorio_custos_safra', JSON.stringify(novasColunas));
      }
      return novasColunas;
    });
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const toggleAgrupamento = (tipo) => {
    setAgrupamentosAtivos(prev => prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo]);
  };

  const limparFiltros = () => {
    setSafrasSelecionadas([]);
    setFornecedoresSelecionados([]);
    setProdutosSelecionados([]);
    setStatusSelecionados([]);
    setBuscaObservacoes("");
    setAgrupamentosAtivos([]);
    setOrdenacao('numero_desc');
    setTipoVisualizacao('detalhado');
    setTipoRelatorio('analitico'); // Reset new state
    setDataInicio(''); // Reset new state
    setDataFim(''); // Reset new state
  };

  const imprimir = () => window.print();

  const totalValor = custosFiltrados.reduce((sum, c) => sum + (c.valor_total || 0), 0);

  const selecionarTodosSafras = () => setSafrasSelecionadas(safrasUnicas);
  const desmarcarTodosSafras = () => setSafrasSelecionadas([]);
  const selecionarTodosFornecedores = () => setFornecedoresSelecionados(fornecedoresUnicos);
  const desmarcarTodosFornecedores = () => setFornecedoresSelecionados([]);
  const selecionarTodosProdutos = () => setProdutosSelecionados(produtosUnicos);
  const desmarcarTodosProdutos = () => setProdutosSelecionados([]);
  const selecionarTodosStatus = () => setStatusSelecionados(statusUnicos);
  const desmarcarTodosStatus = () => setStatusSelecionados([]);

  return (
    <div className="p-6 space-y-6">
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center shadow-lg">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-900">Relatório de Custos de Safra</h1>
            <p className="text-green-700">Configure e imprima o relatório</p>
          </div>
        </div>
        <Button onClick={imprimir} className="bg-green-600 hover:bg-green-700 gap-2">
          <Printer className="w-4 h-4" />
          Imprimir
        </Button>
      </div>

      <Card className="shadow-lg border-green-200 print:hidden">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b">
          <CardTitle className="text-green-900">Filtros e Configurações</CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Orientação</Label>
              <select value={orientacao} onChange={(e) => setOrientacao(e.target.value)} className="w-full h-10 px-3 border rounded-md">
                <option value="retrato">Retrato</option>
                <option value="paisagem">Paisagem</option>
              </select>
            </div>
            {/* New: Tipo de Relatório */}
            <div className="space-y-2">
              <Label>Tipo de Relatório</Label>
              <Select value={tipoRelatorio} onValueChange={setTipoRelatorio}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analitico">Analítico</SelectItem>
                  <SelectItem value="sintetico">Sintético</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* End New: Tipo de Relatório */}
            <div className="space-y-2">
              <Label>Tipo de Visualização</Label>
              <Select value={tipoVisualizacao} onValueChange={setTipoVisualizacao}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="detalhado">Detalhado (Todos Lançamentos)</SelectItem>
                  <SelectItem value="agrupado">Agrupado (Soma Valores)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ordenar Por</Label>
              <Select value={ordenacao} onValueChange={setOrdenacao}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDENACAO_OPCOES.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Buscar em Observações</Label>
              <Input placeholder="Digite para buscar..." value={buscaObservacoes} onChange={(e) => setBuscaObservacoes(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Agrupar Por (Múltipla Seleção)</Label>
            <div className="flex flex-wrap gap-2">
              {['safra', 'fornecedor', 'produto', 'status'].map((tipo) => (
                <Button key={tipo} variant={agrupamentosAtivos.includes(tipo) ? "default" : "outline"} size="sm" onClick={() => toggleAgrupamento(tipo)} className={agrupamentosAtivos.includes(tipo) ? "bg-green-600 hover:bg-green-700" : ""}>
                  {tipo.charAt(0).toUpperCase() + tipo.slice(1)}
                  {agrupamentosAtivos.includes(tipo) && (
                    <span className="ml-2 bg-white text-green-600 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                      {agrupamentosAtivos.indexOf(tipo) + 1}
                    </span>
                  )}
                </Button>
              ))}
            </div>
            {agrupamentosAtivos.length > 0 && (
              <p className="text-xs text-slate-600">
                <strong>Ordem:</strong> {agrupamentosAtivos.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' → ')}
              </p>
            )}
          </div>

          <div className="flex gap-3 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">Safras {safrasSelecionadas.length > 0 && `(${safrasSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                    <h4 className="font-semibold text-sm">Selecione Safras</h4>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosSafras}>Todos</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosSafras}>Nenhum</Button>
                    </div>
                  </div>
                  {safrasUnicas.map(safra => (
                    <div key={safra} className="flex items-center space-x-2">
                      <Checkbox checked={safrasSelecionadas.includes(safra)} onCheckedChange={() => toggleFiltro(safrasSelecionadas, setSafrasSelecionadas, safra)} />
                      <label className="text-sm cursor-pointer">{safra}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">Fornecedores {fornecedoresSelecionados.length > 0 && `(${fornecedoresSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                    <h4 className="font-semibold text-sm">Fornecedores</h4>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosFornecedores}>Todos</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosFornecedores}>Nenhum</Button>
                    </div>
                  </div>
                  {fornecedoresUnicos.map(f => (
                    <div key={f} className="flex items-center space-x-2">
                      <Checkbox checked={fornecedoresSelecionados.includes(f)} onCheckedChange={() => toggleFiltro(fornecedoresSelecionados, setFornecedoresSelecionados, f)} />
                      <label className="text-sm cursor-pointer">{f}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">Produtos {produtosSelecionados.length > 0 && `(${produtosSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                    <h4 className="font-semibold text-sm">Produtos</h4>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosProdutos}>Todos</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosProdutos}>Nenhum</Button>
                    </div>
                  </div>
                  {produtosUnicos.map(p => (
                    <div key={p} className="flex items-center space-x-2">
                      <Checkbox checked={produtosSelecionados.includes(p)} onCheckedChange={() => toggleFiltro(produtosSelecionados, setProdutosSelecionados, p)} />
                      <label className="text-sm cursor-pointer">{p}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">Status {statusSelecionados.length > 0 && `(${statusSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64">
                <div className="space-y-2">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-semibold text-sm">Status</h4>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosStatus}>Todos</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosStatus}>Nenhum</Button>
                    </div>
                  </div>
                  {statusUnicos.map(s => (
                    <div key={s} className="flex items-center space-x-2">
                      <Checkbox checked={statusSelecionados.includes(s)} onCheckedChange={() => toggleFiltro(statusSelecionados, setStatusSelecionados, s)} />
                      <label className="text-sm cursor-pointer">{s}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Settings className="w-4 h-4" />
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUNAS_DISPONIVEIS.map((coluna) => (
                  <DropdownMenuCheckboxItem key={coluna.id} checked={colunasVisiveis.includes(coluna.id)} onCheckedChange={() => toggleColuna(coluna.id)}>
                    {coluna.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button variant="outline" onClick={limparFiltros}>Limpar Filtros</Button>
          </div>
        </CardContent>
      </Card>

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
            header, nav, .no-print { display: none !important; }
          }
        `}} />

        <div className="print-area p-8 print:p-0">
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
                <p className="text-xs leading-tight">
                  {empresaAtual?.telefone && `Telefone: ${empresaAtual.telefone}`}
                  {empresaAtual?.email && ` E-mail: ${empresaAtual.email}`}
                </p>
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold">Relatório de Custos de Safra - {tipoVisualizacao === 'agrupado' ? 'AGRUPADO' : 'DETALHADO'}</h2>
            </div>
          </div>

          {tipoVisualizacao === 'detalhado' ? (
            Object.entries(custosAgrupados).map(([grupo, registros], idx) => {
              const totalGrupo = registros.reduce((sum, c) => sum + (c.valor_total || 0), 0);
              const totalQtdGrupo = registros.reduce((sum, c) => sum + (c.quantidade || 0), 0);
              const totalQtdEntregueGrupo = registros.reduce((sum, c) => sum + (c.quantidade_entregue || 0), 0);
              const totalQtdRestanteGrupo = registros.reduce((sum, c) => sum + ((c.quantidade || 0) - (c.quantidade_entregue || 0)), 0);
              const valorUnitarioMedio = totalQtdGrupo > 0 ? totalGrupo / totalQtdGrupo : 0;
              
              return (
                <div key={idx} className="mb-4">
                  {agrupamentosAtivos.length > 0 && (
                    <div className="bg-gray-200 px-2 py-1 mb-1">
                      <h3 className="font-bold text-xs">{grupo} ({registros.length} {registros.length === 1 ? 'registro' : 'registros'})</h3>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow className="border-black">
                        {colunasVisiveis.includes('numero') && <TableHead className="border border-black text-xs font-bold py-1">Nº</TableHead>}
                        {colunasVisiveis.includes('safra') && <TableHead className="border border-black text-xs font-bold py-1">Safra</TableHead>}
                        {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Fornecedor</TableHead>}
                        {colunasVisiveis.includes('produto') && <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>}
                        {colunasVisiveis.includes('quantidade') && <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd</TableHead>}
                        {colunasVisiveis.includes('quantidade_entregue') && <TableHead className="border border-black text-xs font-bold text-right py-1">Entregue</TableHead>}
                        {colunasVisiveis.includes('quantidade_restante') && <TableHead className="border border-black text-xs font-bold text-right py-1">Restante</TableHead>}
                        {colunasVisiveis.includes('unidade') && <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>}
                        {colunasVisiveis.includes('valor_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr Unit.</TableHead>}
                        {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr Total</TableHead>}
                        {colunasVisiveis.includes('prazo_entrega') && <TableHead className="border border-black text-xs font-bold py-1">Prazo</TableHead>}
                        {colunasVisiveis.includes('data_entrega') && <TableHead className="border border-black text-xs font-bold py-1">Data Entr.</TableHead>}
                        {colunasVisiveis.includes('status') && <TableHead className="border border-black text-xs font-bold py-1">Status</TableHead>}
                        {colunasVisiveis.includes('forma_pagamento') && <TableHead className="border border-black text-xs font-bold py-1">Forma Pgto</TableHead>}
                        {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Obs</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registros.map((c) => {
                        const qtdEntregue = c.quantidade_entregue || 0;
                        const qtdRestante = (c.quantidade || 0) - qtdEntregue;
                        return (
                          <TableRow key={c.id}>
                            {colunasVisiveis.includes('numero') && <TableCell className="border border-gray-300 text-xs py-1">{c.numero_lancamento || '-'}</TableCell>}
                            {colunasVisiveis.includes('safra') && <TableCell className="border border-gray-300 text-xs py-1">{c.safra_nome}</TableCell>}
                            {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{c.fornecedor_nome}</TableCell>}
                            {colunasVisiveis.includes('produto') && <TableCell className="border border-gray-300 text-xs py-1">{c.produto_nome}</TableCell>}
                            {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(c.quantidade)}</TableCell>}
                            {colunasVisiveis.includes('quantidade_entregue') && <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold text-blue-700">{formatarNumero(qtdEntregue)}</TableCell>}
                            {colunasVisiveis.includes('quantidade_restante') && <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold text-orange-700">{formatarNumero(qtdRestante)}</TableCell>}
                            {colunasVisiveis.includes('unidade') && <TableCell className="border border-gray-300 text-xs py-1">{c.unidade_medida}</TableCell>}
                            {colunasVisiveis.includes('valor_unitario') && <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(c.valor_unitario)}</TableCell>}
                            {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right font-semibold py-1">R$ {formatarNumero(c.valor_total)}</TableCell>}
                            {colunasVisiveis.includes('prazo_entrega') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(c.prazo_entrega)}</TableCell>}
                            {colunasVisiveis.includes('data_entrega') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(c.data_entrega)}</TableCell>}
                            {colunasVisiveis.includes('status') && <TableCell className="border border-gray-300 text-xs py-1">{c.status_entrega}</TableCell>}
                            {colunasVisiveis.includes('forma_pagamento') && <TableCell className="border border-gray-300 text-xs py-1">{c.forma_pagamento || '-'}</TableCell>}
                            {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1">{c.observacoes || '-'}</TableCell>}
                          </TableRow>
                        );
                      })}
                      <TableRow className="bg-gray-100 font-bold">
                        <TableCell colSpan={Math.max(1, colunasVisiveis.indexOf('quantidade') > -1 ? colunasVisiveis.indexOf('quantidade') : 0)} className="border border-black text-xs py-1">
                          SUBTOTAL ({registros.length} registro(s))
                        </TableCell>
                        {colunasVisiveis.includes('quantidade') && <TableCell className="border border-black text-xs text-right py-1">{formatarNumero(totalQtdGrupo)}</TableCell>}
                        {colunasVisiveis.includes('quantidade_entregue') && <TableCell className="border border-black text-xs text-right py-1 text-blue-700">{formatarNumero(totalQtdEntregueGrupo)}</TableCell>}
                        {colunasVisiveis.includes('quantidade_restante') && <TableCell className="border border-black text-xs text-right py-1 text-orange-700">{formatarNumero(totalQtdRestanteGrupo)}</TableCell>}
                        {colunasVisiveis.includes('unidade') && <TableCell className="border border-black text-xs py-1">-</TableCell>}
                        {colunasVisiveis.includes('valor_unitario') && <TableCell className="border border-black text-xs text-right py-1">R$ {formatarNumero(valorUnitarioMedio)}</TableCell>}
                        {colunasVisiveis.includes('valor_total') && <TableCell className="border border-black text-xs text-right py-1">R$ {formatarNumero(totalGrupo)}</TableCell>}
                        {/* Fill remaining cells if columns after valor_total are visible */}
                        {colunasVisiveis.slice(colunasVisiveis.indexOf('valor_total') + 1).map((colId) => {
                          const originalCol = COLUNAS_DISPONIVEIS.find(c => c.id === colId);
                          return originalCol ? <TableCell key={colId} className="border border-black text-xs py-1">-</TableCell> : null;
                        })}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              );
            })
          ) : (
            <div className="mb-4">
              <Table>
                <TableHeader>
                  <TableRow className="border-black">
                    <TableHead className="border border-black text-xs font-bold py-1">Agrupamento</TableHead>
                    <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd Lançamentos</TableHead>
                    <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd Comprada</TableHead>
                    <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd Entregue</TableHead>
                    <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd Restante</TableHead>
                    <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr Unit. Médio</TableHead>
                    <TableHead className="border border-black text-xs font-bold text-right py-1">Valor Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(custosAgrupados).map(([grupo, dados], idx) => (
                    <TableRow key={idx}>
                      <TableCell className="border border-gray-300 text-xs py-1 font-semibold">{grupo}</TableCell>
                      <TableCell className="border border-gray-300 text-xs text-right py-1">{dados.registros.length}</TableCell>
                      <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold">{formatarNumero(dados.quantidade_total)}</TableCell>
                      <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold text-blue-700">{formatarNumero(dados.quantidade_entregue_total)}</TableCell>
                      <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold text-orange-700">{formatarNumero(dados.quantidade_restante_total)}</TableCell>
                      <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(dados.valor_unitario_medio)}</TableCell>
                      <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold text-green-700">R$ {formatarNumero(dados.valor_total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-gray-100 font-bold">
                    <TableCell colSpan={6} className="border border-black text-xs py-1">TOTAL GERAL ({custosFiltrados.length} lançamento(s))</TableCell>
                    <TableCell className="border border-black text-xs text-right py-1">R$ {formatarNumero(totalValor)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          <div className="mt-4 border-t-2 border-black pt-2">
            <div className="flex justify-between items-center">
              <div className="text-xs font-bold">TOTAL GERAL: {custosFiltrados.length} lançamento(s)</div>
              <div className="text-xs font-bold">Valor Total: R$ {formatarNumero(totalValor)}</div>
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

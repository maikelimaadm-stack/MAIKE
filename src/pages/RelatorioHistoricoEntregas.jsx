
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, Truck } from "lucide-react";
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
  { id: 'data', label: 'Data Entrega', default: true },
  { id: 'safra', label: 'Safra', default: true },
  { id: 'fornecedor', label: 'Fornecedor', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'unidade', label: 'Unidade', default: true },
  { id: 'nfe', label: 'Nº NF-e', default: true },
  { id: 'chave', label: 'Chave NF-e', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antiga)' },
  { value: 'fornecedor_asc', label: 'Fornecedor (A-Z)' },
  { value: 'fornecedor_desc', label: 'Fornecedor (Z-A)' },
  { value: 'produto_asc', label: 'Produto (A-Z)' },
  { value: 'produto_desc', label: 'Produto (Z-A)' },
  { value: 'quantidade_asc', label: 'Quantidade (Menor)' },
  { value: 'quantidade_desc', label: 'Quantidade (Maior)' },
];

export default function RelatorioHistoricoEntregas() {
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico");
  const [orientacao, setOrientacao] = useState("paisagem");
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('data_desc');
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_historico_entregas');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Ensure that old column IDs are mapped to new ones if necessary, and filter out removed ones
        const currentValidColumns = COLUNAS_DISPONIVEIS.map(c => c.id);
        const mappedColumns = parsed.map(id => {
          if (id === 'numero_nfe') return 'nfe';
          if (id === 'chave_nfe') return 'chave';
          // 'observacoes_nfe' would simply be filtered out if it's not in currentValidColumns
          return id;
        }).filter(id => currentValidColumns.includes(id));

        return Array.from(new Set(mappedColumns)); // Use Set to remove duplicates
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [safrasSelecionadas, setSafrasSelecionadas] = useState([]);
  const [fornecedoresSelecionados, setFornecedoresSelecionados] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: entregas = [] } = useQuery({
    queryKey: ['historico_entregas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.HistoricoEntrega.list('-created_date');
      return all.filter(e => e.empresa_id === empresaSelecionadaId);
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

  const entregasComSafra = useMemo(() => {
    return entregas.map(e => {
      const safra = safras.find(s => s.id === e.safra_id);
      return {
        ...e,
        safra_nome: safra ? `${safra.ano_inicio}/${safra.ano_fim}` : 'Sem safra'
      };
    });
  }, [entregas, safras]);

  const safrasUnicas = [...new Set(entregasComSafra.map(e => e.safra_nome))].filter(Boolean);
  const fornecedoresUnicos = [...new Set(entregasComSafra.map(e => e.fornecedor_nome))].filter(Boolean);
  const produtosUnicos = [...new Set(entregasComSafra.map(e => e.produto_nome))].filter(Boolean);

  const entregasFiltradas = useMemo(() => {
    let filtered = entregasComSafra.filter(e => {
      if (safrasSelecionadas.length > 0 && !safrasSelecionadas.includes(e.safra_nome)) return false;
      if (fornecedoresSelecionados.length > 0 && !fornecedoresSelecionados.includes(e.fornecedor_nome)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(e.produto_nome)) return false;
      
      if (dataInicio && e.data_entrega) {
        const dataEntrega = new Date(e.data_entrega);
        const dataInicial = new Date(dataInicio);
        if (dataEntrega < dataInicial) return false;
      }
      
      if (dataFim && e.data_entrega) {
        const dataEntrega = new Date(e.data_entrega);
        const dataFinal = new Date(dataFim);
        if (dataEntrega > dataFinal) return false;
      }
      
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc':
          return new Date(b.data_entrega || 0) - new Date(a.data_entrega || 0);
        case 'data_asc':
          return new Date(a.data_entrega || 0) - new Date(b.data_entrega || 0);
        case 'fornecedor_asc':
          return (a.fornecedor_nome || '').localeCompare(b.fornecedor_nome || '');
        case 'fornecedor_desc':
          return (b.fornecedor_nome || '').localeCompare(a.fornecedor_nome || '');
        case 'produto_asc':
          return (a.produto_nome || '').localeCompare(b.produto_nome || '');
        case 'produto_desc':
          return (b.produto_nome || '').localeCompare(a.produto_nome || '');
        case 'quantidade_asc':
          return (a.quantidade_entregue || 0) - (b.quantidade_entregue || 0);
        case 'quantidade_desc':
          return (b.quantidade_entregue || 0) - (a.quantidade_entregue || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [entregasComSafra, safrasSelecionadas, fornecedoresSelecionados, produtosSelecionados, dataInicio, dataFim, ordenacao]);

  const entregasAgrupadas = useMemo(() => {
    if (agrupamentosAtivos.length === 0) {
      return { "Todos os Registros": entregasFiltradas };
    }

    const grupos = {};
    entregasFiltradas.forEach(e => {
      let chaveArray = [];
      agrupamentosAtivos.forEach(tipo => {
        let valor;
        switch (tipo) {
          case "safra":
            valor = e.safra_nome || "Sem safra";
            break;
          case "fornecedor":
            valor = e.fornecedor_nome || "Sem fornecedor";
            break;
          case "produto":
            valor = e.produto_nome || "Sem produto";
            break;
          default:
            valor = "Sem classificação";
        }
        chaveArray.push(valor);
      });
      const chave = chaveArray.join(" → ");
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push(e);
    });
    return grupos;
  }, [entregasFiltradas, agrupamentosAtivos]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_historico_entregas', JSON.stringify(novasColunas));
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
    setDataInicio("");
    setDataFim("");
    setAgrupamentosAtivos([]);
    setOrdenacao('data_desc');
  };

  const imprimir = () => window.print();

  const totalEntregas = entregasFiltradas.length;
  const totalQuantidade = entregasFiltradas.reduce((sum, e) => sum + (e.quantidade_entregue || 0), 0);

  const selecionarTodosSafras = () => setSafrasSelecionadas(safrasUnicas);
  const desmarcarTodosSafras = () => setSafrasSelecionadas([]);
  const selecionarTodosFornecedores = () => setFornecedoresSelecionados(fornecedoresUnicos);
  const desmarcarTodosFornecedores = () => setFornecedoresSelecionados([]);
  const selecionarTodosProdutos = () => setProdutosSelecionados(produtosUnicos);
  const desmarcarTodosProdutos = () => setProdutosSelecionados([]);

  return (
    <div className="p-6 space-y-6">
      {/* Controles */}
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center shadow-lg">
            <Truck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-900">Histórico de Entregas</h1>
            <p className="text-green-700">Configure e imprima o relatório</p>
          </div>
        </div>
        <Button onClick={imprimir} className="bg-green-600 hover:bg-green-700 gap-2">
          <Printer className="w-4 h-4" />
          Imprimir
        </Button>
      </div>

      {/* Filtros */}
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
              <Label>Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Agrupar Por (Múltipla Seleção)</Label>
            <div className="flex flex-wrap gap-2">
              {['safra', 'fornecedor', 'produto'].map((tipo) => (
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
          </div>

          <div className="flex gap-3 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Safras {safrasSelecionadas.length > 0 && `(${safrasSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                    <h4 className="font-semibold text-sm">Safras</h4>
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
                <Button variant="outline">Fornecedores {fornecedoresSelecionados.length > 0 && `(${fornecedoresSelecionados.length})`}</Button>
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
                <Button variant="outline">Produtos {produtosSelecionados.length > 0 && `(${produtosSelecionados.length})`}</Button>
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 border-slate-300">
                  <Settings className="w-4 h-4" />
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
                <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUNAS_DISPONIVEIS.map((coluna) => (
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

            <Button variant="outline" onClick={limparFiltros}>Limpar Filtros</Button>
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
              <h2 className="text-base font-bold">Histórico de Entregas</h2>
              <p className="text-xs text-gray-600">
                {totalEntregas} entrega(s) • Total: {formatarNumero(totalQuantidade)}
              </p>
            </div>
          </div>

          {Object.entries(entregasAgrupadas).map(([grupo, registros], idx) => {
            const totalGrupo = registros.reduce((sum, e) => sum + (e.quantidade_entregue || 0), 0);
            return (
              <div key={idx} className="mb-4">
                {agrupamentosAtivos.length > 0 && (
                  <div className="bg-gray-200 px-2 py-1 mb-1">
                    <h3 className="font-bold text-xs">{grupo} ({registros.length} entrega(s))</h3>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow className="border-black">
                      {colunasVisiveis.includes('numero') && <TableHead className="border border-black text-xs font-bold py-1">Nº</TableHead>}
                      {colunasVisiveis.includes('data') && <TableHead className="border border-black text-xs font-bold py-1">Data Entrega</TableHead>}
                      {colunasVisiveis.includes('safra') && <TableHead className="border border-black text-xs font-bold py-1">Safra</TableHead>}
                      {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Fornecedor</TableHead>}
                      {colunasVisiveis.includes('produto') && <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>}
                      {colunasVisiveis.includes('quantidade') && <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd</TableHead>}
                      {colunasVisiveis.includes('unidade') && <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>}
                      {colunasVisiveis.includes('nfe') && <TableHead className="border border-black text-xs font-bold py-1">Nº NF-e</TableHead>}
                      {colunasVisiveis.includes('chave') && <TableHead className="border border-black text-xs font-bold py-1">Chave NF-e</TableHead>}
                      {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Obs</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registros.map((e, index) => (
                      <TableRow key={e.id}>
                        {colunasVisiveis.includes('numero') && <TableCell className="border border-gray-300 text-xs py-1">{index + 1}</TableCell>}
                        {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(e.data_entrega)}</TableCell>}
                        {colunasVisiveis.includes('safra') && <TableCell className="border border-gray-300 text-xs py-1">{e.safra_nome}</TableCell>}
                        {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{e.fornecedor_nome}</TableCell>}
                        {colunasVisiveis.includes('produto') && <TableCell className="border border-gray-300 text-xs py-1">{e.produto_nome}</TableCell>}
                        {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(e.quantidade_entregue)}</TableCell>}
                        {colunasVisiveis.includes('unidade') && <TableCell className="border border-gray-300 text-xs py-1">{e.unidade_medida}</TableCell>}
                        {colunasVisiveis.includes('nfe') && <TableCell className="border border-gray-300 text-xs py-1">{e.numero_nfe || '-'}</TableCell>}
                        {colunasVisiveis.includes('chave') && <TableCell className="border border-gray-300 text-xs py-1">{e.chave_nfe || '-'}</TableCell>}
                        {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1">{e.observacoes || '-'}</TableCell>}
                      </TableRow>
                    ))}
                    <TableRow className="bg-gray-100 font-bold">
                      <TableCell colSpan={colunasVisiveis.length - (colunasVisiveis.includes('quantidade') ? 1 : 0)} className="border border-black text-xs py-1">
                        SUBTOTAL ({registros.length} entrega(s))
                      </TableCell>
                      {colunasVisiveis.includes('quantidade') && <TableCell className="border border-black text-xs text-right py-1">{formatarNumero(totalGrupo)}</TableCell>}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            );
          })}

          <div className="mt-4 border-t-2 border-black pt-2">
            <div className="flex justify-between items-center">
              <div className="text-xs font-bold">TOTAL GERAL: {totalEntregas} entrega(s)</div>
              <div className="text-xs font-bold">Total: {formatarNumero(totalQuantidade)}</div>
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


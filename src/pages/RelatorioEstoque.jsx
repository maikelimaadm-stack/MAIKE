
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Printer, Settings, Package } from "lucide-react";
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
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CartoesResumo from "../components/shared/CartoesResumo";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS_ANALITICO = [
  { id: 'numero', label: 'Nº Produto', default: true },
  { id: 'codigo', label: 'Código', default: true },
  { id: 'nome', label: 'Nome do Produto', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'unidade', label: 'UN', default: true },
  { id: 'estoque_atual', label: 'Estoque Atual', default: true },
  { id: 'estoque_minimo', label: 'Estoque Mínimo', default: true },
  { id: 'custo_unitario', label: 'Custo Unitário', default: true },
  { id: 'valor_total', label: 'Valor Total', default: true },
  { id: 'local', label: 'Local', default: true },
];

const COLUNAS_DISPONIVEIS_SINTETICO = [
  { id: 'agrupamento', label: 'Agrupamento', default: true },
  { id: 'quantidade_itens', label: 'Qtd Itens', default: true },
  { id: 'estoque_total', label: 'Estoque Total', default: true },
  { id: 'valor_total', label: 'Valor Total', default: true },
];

const COLUNAS_DISPONIVEIS_POR_NFE = [
  { id: 'nfe', label: 'NF-e', default: true },
  { id: 'data', label: 'Data', default: true },
  { id: 'fornecedor', label: 'Fornecedor', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'valor_unitario', label: 'Vlr Unit.', default: true },
  { id: 'valor_total', label: 'Valor Total', default: true },
  { id: 'local', label: 'Local', default: true },
];

const COLUNAS_DISPONIVEIS_POR_LOCAL = [
  { id: 'local', label: 'Local', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'codigo', label: 'Código', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'estoque_atual', label: 'Estoque', default: true },
  { id: 'custo_unitario', label: 'Custo Unit.', default: true },
  { id: 'valor_total', label: 'Valor Total', default: true },
];

const ORDENACAO_OPCOES = [
  { value: 'nome_asc', label: 'Nome (A-Z)' },
  { value: 'nome_desc', label: 'Nome (Z-A)' },
  { value: 'codigo_asc', label: 'Código (A-Z)' },
  { value: 'codigo_desc', label: 'Código (Z-A)' },
  { value: 'estoque_asc', label: 'Estoque (Menor)' },
  { value: 'estoque_desc', label: 'Estoque (Maior)' },
  { value: 'categoria_asc', label: 'Categoria (A-Z)' },
  { value: 'categoria_desc', label: 'Categoria (Z-A)' },
  { value: 'valor_asc', label: 'Valor Total (Menor)' },
  { value: 'valor_desc', label: 'Valor Total (Maior)' },
];

export default function RelatorioEstoque() {
  const [orientacao, setOrientacao] = useState("paisagem");
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico"); // analitico, sintetico, por_nfe, por_local
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('nome_asc');
  const [filtroSituacao, setFiltroSituacao] = useState('todos');
  const [showConfig, setShowConfig] = useState(false); // State for the config dialog
  
  const getColunasDisponiveis = () => {
    switch (tipoRelatorio) {
      case 'sintetico': return COLUNAS_DISPONIVEIS_SINTETICO;
      case 'por_nfe': return COLUNAS_DISPONIVEIS_POR_NFE;
      case 'por_local': return COLUNAS_DISPONIVEIS_POR_LOCAL;
      default: return COLUNAS_DISPONIVEIS_ANALITICO;
    }
  };

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    return getColunasDisponiveis().filter(c => c.default).map(c => c.id);
  });

  // Reset colunas quando mudar tipo de relatório
  React.useEffect(() => {
    setColunasVisiveis(getColunasDisponiveis().filter(c => c.default).map(c => c.id));
  }, [tipoRelatorio]);

  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [locaisSelecionados, setLocaisSelecionados] = useState([]);
  const [fornecedoresSelecionados, setFornecedoresSelecionados] = useState([]);
  const [nfesSelecionadas, setNfesSelecionadas] = useState([]);
  const [buscaNome, setBuscaNome] = useState("");
  const [buscaCodigo, setBuscaCodigo] = useState("");

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos_estoque', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list('nome_produto');
      return all.filter(p => p.empresa_id === empresaSelecionadaId).map(p => ({
        ...p,
        valor_total_estoque: (p.preco_custo || 0) * (p.estoque_atual || 0),
        situacao: (p.estoque_atual || 0) <= (p.estoque_minimo || 0) ? 'Baixo' : 'Normal'
      }));
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoes_nfe', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao');
      return all.filter(m => 
        m.empresa_id === empresaSelecionadaId && 
        m.status === 'Ativa' && 
        m.chave_documento && 
        m.tipo_movimentacao === 'Entrada'
      );
    },
    enabled: !!empresaSelecionadaId && (tipoRelatorio === 'por_nfe'),
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

  const categoriasUnicas = [...new Set(produtos.map(p => p.categoria))].filter(Boolean);
  const produtosUnicos = produtos.map(p => ({ id: p.id, nome: p.nome_produto }));
  const locaisUnicos = [...new Set(produtos.map(p => p.local_estoque))].filter(Boolean);
  const fornecedoresUnicos = [...new Set(movimentacoes.map(m => m.fornecedor_nome))].filter(Boolean);
  const nfesUnicas = [...new Set(movimentacoes.map(m => m.numero_documento))].filter(Boolean);

  const produtosFiltrados = useMemo(() => {
    let filtered = produtos.filter(p => {
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(p.categoria)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(p.id)) return false;
      if (locaisSelecionados.length > 0 && !locaisSelecionados.includes(p.local_estoque)) return false;
      if (buscaNome && !p.nome_produto?.toLowerCase().includes(buscaNome.toLowerCase())) return false;
      if (buscaCodigo && !p.codigo_interno?.toLowerCase().includes(buscaCodigo.toLowerCase())) return false;
      if (filtroSituacao === 'baixo' && p.situacao !== 'Baixo') return false;
      if (filtroSituacao === 'normal' && p.situacao !== 'Normal') return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'nome_asc': return (a.nome_produto || '').localeCompare(b.nome_produto || '');
        case 'nome_desc': return (b.nome_produto || '').localeCompare(a.nome_produto || '');
        case 'codigo_asc': return (a.codigo_interno || '').localeCompare(b.codigo_interno || '');
        case 'codigo_desc': return (b.codigo_interno || '').localeCompare(a.codigo_interno || '');
        case 'estoque_asc': return (a.estoque_atual || 0) - (b.estoque_atual || 0);
        case 'estoque_desc': return (b.estoque_atual || 0) - (a.estoque_atual || 0);
        case 'categoria_asc': return (a.categoria || '').localeCompare(b.categoria || '');
        case 'categoria_desc': return (b.categoria || '').localeCompare(a.categoria || '');
        case 'valor_asc': return (a.valor_total_estoque || 0) - (b.valor_total_estoque || 0);
        case 'valor_desc': return (b.valor_total_estoque || 0) - (a.valor_total_estoque || 0);
        default: return 0;
      }
    });

    return filtered;
  }, [produtos, categoriasSelecionadas, produtosSelecionados, locaisSelecionados, buscaNome, buscaCodigo, filtroSituacao, ordenacao]);

  const movimentacoesFiltradas = useMemo(() => {
    return movimentacoes.filter(m => {
      if (fornecedoresSelecionados.length > 0 && !fornecedoresSelecionados.includes(m.fornecedor_nome)) return false;
      if (nfesSelecionadas.length > 0 && !nfesSelecionadas.includes(m.numero_documento)) return false;
      if (locaisSelecionados.length > 0 && !locaisSelecionados.includes(m.local_estoque_destino)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(m.produto_id)) return false;
      return true;
    });
  }, [movimentacoes, fornecedoresSelecionados, nfesSelecionadas, locaisSelecionados, produtosSelecionados]);

  const dadosRelatorio = useMemo(() => {
    if (tipoRelatorio === 'sintetico') {
      // Agrupar e somar
      const grupos = {};
      const campoAgrupamento = agrupamentosAtivos[0] || 'categoria';
      
      produtosFiltrados.forEach(p => {
        let chave;
        switch (campoAgrupamento) {
          case 'categoria': chave = p.categoria || 'Sem categoria'; break;
          case 'local': chave = p.local_estoque || 'Sem local'; break;
          case 'situacao': chave = p.situacao || 'Sem situação'; break;
          default: chave = 'Sem classificação';
        }
        
        if (!grupos[chave]) {
          grupos[chave] = {
            agrupamento: chave,
            quantidade_itens: 0,
            estoque_total: 0,
            valor_total: 0
          };
        }
        
        grupos[chave].quantidade_itens++;
        grupos[chave].estoque_total += p.estoque_atual || 0;
        grupos[chave].valor_total += p.valor_total_estoque || 0;
      });
      
      return { tipo: 'sintetico', dados: Object.values(grupos) };
    } else if (tipoRelatorio === 'por_nfe') {
      return { tipo: 'por_nfe', dados: movimentacoesFiltradas };
    } else if (tipoRelatorio === 'por_local') {
      const grupos = {};
      produtosFiltrados.forEach(p => {
        const local = p.local_estoque || 'Sem local';
        if (!grupos[local]) grupos[local] = [];
        grupos[local].push(p);
      });
      return { tipo: 'por_local', dados: grupos };
    } else {
      // Analítico - com agrupamento opcional
      if (agrupamentosAtivos.length === 0) {
        return { tipo: 'analitico', dados: { "Todos os Produtos": produtosFiltrados } };
      }

      const grupos = {};
      produtosFiltrados.forEach(p => {
        let chaveArray = [];
        agrupamentosAtivos.forEach(tipo => {
          let valor;
          switch (tipo) {
            case "categoria": valor = p.categoria || "Sem categoria"; break;
            case "local": valor = p.local_estoque || "Sem local"; break;
            case "situacao": valor = p.situacao || "Sem situação"; break;
            default: valor = "Sem classificação";
          }
          chaveArray.push(valor);
        });
        const chave = chaveArray.join(" → ");
        if (!grupos[chave]) grupos[chave] = [];
        grupos[chave].push(p);
      });
      return { tipo: 'analitico', dados: grupos };
    }
  }, [tipoRelatorio, produtosFiltrados, movimentacoesFiltradas, agrupamentosAtivos]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
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
    setCategoriasSelecionadas([]);
    setProdutosSelecionados([]);
    setLocaisSelecionados([]);
    setFornecedoresSelecionados([]);
    setNfesSelecionadas([]);
    setBuscaNome("");
    setBuscaCodigo("");
    setFiltroSituacao('todos');
    setAgrupamentosAtivos([]);
    setOrdenacao('nome_asc');
  };

  const totalItens = produtosFiltrados.length;
  const totalValorEstoque = produtosFiltrados.reduce((sum, p) => sum + (p.valor_total_estoque || 0), 0);
  const totalEstoqueBaixo = produtosFiltrados.filter(p => p.situacao === 'Baixo').length;

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Estoque</h1>
          <p className="text-xs text-slate-600">Posição atual</p>
        </div>
        <div className="flex gap-2 print:hidden"> {/* Added print:hidden here */}
          <Button variant="outline" size="sm" onClick={() => setShowConfig(true)} className="h-8 gap-1 text-xs">
            <Settings className="w-3.5 h-3.5" />
            Config
          </Button>
          <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
            <Printer className="w-3.5 h-3.5" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* Cartões de Resumo - Visível apenas fora da impressão */}
      <div className="print:hidden">
        <CartoesResumo
          data={[
            { id: 'total_itens', label: 'Total de Itens', value: totalItens, icon: Package },
            { id: 'valor_total', label: 'Valor Total do Estoque', value: `R$ ${formatarNumero(totalValorEstoque)}`, icon: FileText },
            { id: 'estoque_baixo', label: 'Itens em Estoque Baixo', value: totalEstoqueBaixo, icon: FileText, subText: "Verificar reposição" },
          ]}
        />
      </div>

      {/* Configurações em Modal/Dialog */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="max-w-4xl p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>Filtros e Configurações do Relatório</DialogTitle>
          </DialogHeader>
          <Card className="shadow-none border-none"> {/* Removed shadow and border as it's inside a dialog */}
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Tipo de Relatório</Label>
                  <Select value={tipoRelatorio} onValueChange={setTipoRelatorio}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="analitico">Analítico (Detalhado)</SelectItem>
                      <SelectItem value="sintetico">Sintético (Agrupado)</SelectItem>
                      <SelectItem value="por_nfe">Por NF-e</SelectItem>
                      <SelectItem value="por_local">Por Local de Estoque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Orientação</Label>
                  <Select value={orientacao} onValueChange={setOrientacao}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retrato">Retrato</SelectItem>
                      <SelectItem value="paisagem">Paisagem</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {tipoRelatorio === 'analitico' && (
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
                )}
                {(tipoRelatorio === 'analitico' || tipoRelatorio === 'por_local') && (
                  <div className="space-y-2">
                    <Label>Situação do Estoque</Label>
                    <Select value={filtroSituacao} onValueChange={setFiltroSituacao}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="baixo">Estoque Baixo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {(tipoRelatorio === 'analitico' || tipoRelatorio === 'por_local') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Buscar por Nome</Label>
                    <Input placeholder="Digite o nome..." value={buscaNome} onChange={(e) => setBuscaNome(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Buscar por Código</Label>
                    <Input placeholder="Digite o código..." value={buscaCodigo} onChange={(e) => setBuscaCodigo(e.target.value)} />
                  </div>
                </div>
              )}

              {tipoRelatorio !== 'por_nfe' && (
                <div className="space-y-2">
                  <Label>Agrupar Por (Múltipla Seleção)</Label>
                  <div className="flex flex-wrap gap-2">
                    {['categoria', 'local', 'situacao'].map((tipo) => (
                      <Button 
                        key={tipo} 
                        variant={agrupamentosAtivos.includes(tipo) ? "default" : "outline"} 
                        size="sm" 
                        onClick={() => toggleAgrupamento(tipo)} 
                        className={agrupamentosAtivos.includes(tipo) ? "bg-green-600 hover:bg-green-700" : ""}
                      >
                        {tipo.charAt(0).toUpperCase() + tipo.slice(1)}
                        {agrupamentosAtivos.includes(tipo) && (
                          <span className="ml-2 bg-white text-green-600 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                            {agrupamentosAtivos.indexOf(tipo) + 1}
                          </span>
                        )}
                      </Button>
                    ))}
                  </div>
                  {tipoRelatorio === 'sintetico' && agrupamentosAtivos.length === 0 && (
                    <p className="text-xs text-orange-600">* No modo Sintético, selecione apenas 1 agrupamento (será usado: {agrupamentosAtivos[0] || 'categoria'})</p>
                  )}
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                {tipoRelatorio === 'por_nfe' && (
                  <>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline">Fornecedores {fornecedoresSelecionados.length > 0 && `(${fornecedoresSelecionados.length})`}</Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 max-h-96 overflow-auto">
                        <div className="space-y-2">
                          <h4 className="font-semibold text-sm mb-2">Fornecedores</h4>
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
                        <Button variant="outline">NF-e {nfesSelecionadas.length > 0 && `(${nfesSelecionadas.length})`}</Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-64 max-h-96 overflow-auto">
                        <div className="space-y-2">
                          <h4 className="font-semibold text-sm mb-2">Notas Fiscais</h4>
                          {nfesUnicas.map(nfe => (
                            <div key={nfe} className="flex items-center space-x-2">
                              <Checkbox checked={nfesSelecionadas.includes(nfe)} onCheckedChange={() => toggleFiltro(nfesSelecionadas, setNfesSelecionadas, nfe)} />
                              <label className="text-sm cursor-pointer">{nfe}</label>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </>
                )}

                {(tipoRelatorio === 'analitico' || tipoRelatorio === 'por_local' || tipoRelatorio === 'sintetico') && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline">Categorias {categoriasSelecionadas.length > 0 && `(${categoriasSelecionadas.length})`}</Button>
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
                )}

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline">Locais {locaisSelecionados.length > 0 && `(${locaisSelecionados.length})`}</Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm mb-2">Locais</h4>
                      {locaisUnicos.map(l => (
                        <div key={l} className="flex items-center space-x-2">
                          <Checkbox checked={locaisSelecionados.includes(l)} onCheckedChange={() => toggleFiltro(locaisSelecionados, setLocaisSelecionados, l)} />
                          <label className="text-sm cursor-pointer">{l}</label>
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

                <Button variant="outline" onClick={limparFiltros}>Limpar Filtros</Button>
              </div>
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>

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
                <p className="text-xs leading-tight">
                  {empresaAtual?.telefone && `Telefone: ${empresaAtual.telefone}`}
                  {empresaAtual?.email && ` E-mail: ${empresaAtual.email}`}
                </p>
              </div>
            </div>
            <div>
              <h2 className="text-base font-bold">
                Relatório de Estoque - {
                  tipoRelatorio === 'analitico' ? 'ANALÍTICO' :
                  tipoRelatorio === 'sintetico' ? 'SINTÉTICO' :
                  tipoRelatorio === 'por_nfe' ? 'POR NF-e' :
                  'POR LOCAL'
                }
              </h2>
              {tipoRelatorio !== 'por_nfe' && (
                <p className="text-xs text-gray-600">
                  {totalItens} produto(s) • Valor: R$ {formatarNumero(totalValorEstoque)} • Estoque Baixo: {totalEstoqueBaixo}
                </p>
              )}
            </div>
          </div>

          {/* Conteúdo do Relatório */}
          {dadosRelatorio.tipo === 'sintetico' && (
            <Table>
              <TableHeader>
                <TableRow className="border-black">
                  {colunasVisiveis.includes('agrupamento') && <TableHead className="border border-black text-xs font-bold py-1">Agrupamento</TableHead>}
                  {colunasVisiveis.includes('quantidade_itens') && <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd Itens</TableHead>}
                  {colunasVisiveis.includes('estoque_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Estoque Total</TableHead>}
                  {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Valor Total</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dadosRelatorio.dados.map((grupo, idx) => (
                  <TableRow key={idx}>
                    {colunasVisiveis.includes('agrupamento') && <TableCell className="border border-gray-300 text-xs py-1 font-semibold">{grupo.agrupamento}</TableCell>}
                    {colunasVisiveis.includes('quantidade_itens') && <TableCell className="border border-gray-300 text-xs text-right py-1">{grupo.quantidade_itens}</TableCell>}
                    {colunasVisiveis.includes('estoque_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(grupo.estoque_total)}</TableCell>}
                    {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold">R$ {formatarNumero(grupo.valor_total)}</TableCell>}
                  </TableRow>
                ))}
                <TableRow className="bg-gray-100 font-bold">
                  <TableCell className="border border-black text-xs py-1">TOTAL GERAL</TableCell>
                  {colunasVisiveis.includes('quantidade_itens') && <TableCell className="border border-black text-xs text-right py-1">{totalItens}</TableCell>}
                  {colunasVisiveis.includes('estoque_total') && <TableCell className="border border-black text-xs text-right py-1">{formatarNumero(produtosFiltrados.reduce((s,p) => s + (p.estoque_atual||0), 0))}</TableCell>}
                  {colunasVisiveis.includes('valor_total') && <TableCell className="border border-black text-xs text-right py-1">R$ {formatarNumero(totalValorEstoque)}</TableCell>}
                </TableRow>
              </TableBody>
            </Table>
          )}

          {dadosRelatorio.tipo === 'por_nfe' && (
            <div>
              {Object.entries(
                dadosRelatorio.dados.reduce((acc, m) => {
                  const nfe = m.numero_documento || 'Sem NF-e';
                  if (!acc[nfe]) acc[nfe] = [];
                  acc[nfe].push(m);
                  return acc;
                }, {})
              ).map(([nfe, itens], idx) => {
                const totalNfe = itens.reduce((s, m) => s + (m.valor_total || 0), 0);
                return (
                  <div key={idx} className="mb-4">
                    <div className="bg-gray-200 px-2 py-1 mb-1">
                      <h3 className="font-bold text-xs">NF-e: {nfe} • {itens[0]?.fornecedor_nome} • {itens.length} item(ns)</h3>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-black">
                          {colunasVisiveis.includes('data') && <TableHead className="border border-black text-xs font-bold py-1">Data</TableHead>}
                          {colunasVisiveis.includes('produto') && <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>}
                          {colunasVisiveis.includes('quantidade') && <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd</TableHead>}
                          {colunasVisiveis.includes('valor_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr Unit.</TableHead>}
                          {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr Total</TableHead>}
                          {colunasVisiveis.includes('local') && <TableHead className="border border-black text-xs font-bold py-1">Local</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {itens.map((m) => (
                          <TableRow key={m.id}>
                            {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{format(new Date(m.data_movimentacao), 'dd/MM/yyyy')}</TableCell>}
                            {colunasVisiveis.includes('produto') && <TableCell className="border border-gray-300 text-xs py-1">{m.produto_nome}</TableCell>}
                            {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(m.quantidade)}</TableCell>}
                            {colunasVisiveis.includes('valor_unitario') && <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(m.valor_unitario || 0)}</TableCell>}
                            {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold">R$ {formatarNumero(m.valor_total || 0)}</TableCell>}
                            {colunasVisiveis.includes('local') && <TableCell className="border border-gray-300 text-xs py-1">{m.local_estoque_destino || '-'}</TableCell>}
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-100 font-bold">
                          <TableCell colSpan={colunasVisiveis.filter(c => !['valor_total'].includes(c)).length} className="border border-black text-xs py-1">
                            SUBTOTAL NF-e {nfe}
                          </TableCell>
                          {colunasVisiveis.includes('valor_total') && <TableCell className="border border-black text-xs text-right py-1">R$ {formatarNumero(totalNfe)}</TableCell>}
                          {colunasVisiveis.includes('local') && <TableCell className="border border-black text-xs py-1"></TableCell>}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}

          {dadosRelatorio.tipo === 'por_local' && (
            Object.entries(dadosRelatorio.dados).map(([local, produtos], idx) => {
              const totalLocal = produtos.reduce((s, p) => s + (p.valor_total_estoque || 0), 0);
              return (
                <div key={idx} className="mb-4">
                  <div className="bg-gray-200 px-2 py-1 mb-1">
                    <h3 className="font-bold text-xs">{local} • {produtos.length} produto(s)</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-black">
                        {colunasVisiveis.includes('produto') && <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>}
                        {colunasVisiveis.includes('codigo') && <TableHead className="border border-black text-xs font-bold py-1">Código</TableHead>}
                        {colunasVisiveis.includes('categoria') && <TableHead className="border border-black text-xs font-bold py-1">Categoria</TableHead>}
                        {colunasVisiveis.includes('estoque_atual') && <TableHead className="border border-black text-xs font-bold text-right py-1">Estoque</TableHead>}
                        {colunasVisiveis.includes('custo_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Custo Unit.</TableHead>}
                        {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Valor Total</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {produtos.map((p) => (
                        <TableRow key={p.id}>
                          {colunasVisiveis.includes('produto') && <TableCell className="border border-gray-300 text-xs py-1">{p.nome_produto}</TableCell>}
                          {colunasVisiveis.includes('codigo') && <TableCell className="border border-gray-300 text-xs py-1">{p.codigo_interno || '-'}</TableCell>}
                          {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs py-1">{p.categoria || '-'}</TableCell>}
                          {colunasVisiveis.includes('estoque_atual') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(p.estoque_atual || 0)}</TableCell>}
                          {colunasVisiveis.includes('custo_unitario') && <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(p.preco_custo || 0)}</TableCell>}
                          {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold">R$ {formatarNumero(p.valor_total_estoque)}</TableCell>}
                        </TableRow>
                      ))}
                      <TableRow className="bg-gray-100 font-bold">
                        <TableCell colSpan={colunasVisiveis.filter(c => c !== 'valor_total').length} className="border border-black text-xs py-1">
                          SUBTOTAL {local}
                        </TableCell>
                        {colunasVisiveis.includes('valor_total') && <TableCell className="border border-black text-xs text-right py-1">R$ {formatarNumero(totalLocal)}</TableCell>}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              );
            })
          )}

          {dadosRelatorio.tipo === 'analitico' && (
            Object.entries(dadosRelatorio.dados).map(([grupo, registros], idx) => {
              const totalGrupo = registros.reduce((sum, p) => sum + (p.valor_total_estoque || 0), 0);
              return (
                <div key={idx} className="mb-4">
                  {agrupamentosAtivos.length > 0 && (
                    <div className="bg-gray-200 px-2 py-1 mb-1">
                      <h3 className="font-bold text-xs">{grupo} ({registros.length} produto(s))</h3>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow className="border-black">
                        {colunasVisiveis.includes('numero') && <TableHead className="border border-black text-xs font-bold py-1">Nº</TableHead>}
                        {colunasVisiveis.includes('codigo') && <TableHead className="border border-black text-xs font-bold py-1">Código</TableHead>}
                        {colunasVisiveis.includes('nome') && <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>}
                        {colunasVisiveis.includes('categoria') && <TableHead className="border border-black text-xs font-bold py-1">Categoria</TableHead>}
                        {colunasVisiveis.includes('unidade') && <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>}
                        {colunasVisiveis.includes('estoque_atual') && <TableHead className="border border-black text-xs font-bold text-right py-1">Estoque</TableHead>}
                        {colunasVisiveis.includes('estoque_minimo') && <TableHead className="border border-black text-xs font-bold text-right py-1">Mínimo</TableHead>}
                        {colunasVisiveis.includes('custo_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Custo</TableHead>}
                        {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Total</TableHead>}
                        {colunasVisiveis.includes('local') && <TableHead className="border border-black text-xs font-bold py-1">Local</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registros.map((p) => (
                        <TableRow key={p.id}>
                          {colunasVisiveis.includes('numero') && <TableCell className="border border-gray-300 text-xs py-1">{p.numero_produto}</TableCell>}
                          {colunasVisiveis.includes('codigo') && <TableCell className="border border-gray-300 text-xs py-1">{p.codigo_interno || '-'}</TableCell>}
                          {colunasVisiveis.includes('nome') && <TableCell className="border border-gray-300 text-xs py-1">{p.nome_produto}</TableCell>}
                          {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs py-1">{p.categoria || '-'}</TableCell>}
                          {colunasVisiveis.includes('unidade') && <TableCell className="border border-gray-300 text-xs py-1">{p.unidade_medida}</TableCell>}
                          {colunasVisiveis.includes('estoque_atual') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(p.estoque_atual || 0)}</TableCell>}
                          {colunasVisiveis.includes('estoque_minimo') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(p.estoque_minimo || 0)}</TableCell>}
                          {colunasVisiveis.includes('custo_unitario') && <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(p.preco_custo || 0)}</TableCell>}
                          {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right font-semibold py-1">R$ {formatarNumero(p.valor_total_estoque)}</TableCell>}
                          {colunasVisiveis.includes('local') && <TableCell className="border border-gray-300 text-xs py-1">{p.local_estoque || '-'}</TableCell>}
                        </TableRow>
                      ))}
                      <TableRow className="bg-gray-100 font-bold">
                        <TableCell colSpan={colunasVisiveis.length - (colunasVisiveis.includes('valor_total') ? 1 : 0)} className="border border-black text-xs py-1">
                          SUBTOTAL ({registros.length})
                        </TableCell>
                        {colunasVisiveis.includes('valor_total') && <TableCell className="border border-black text-xs text-right py-1">R$ {formatarNumero(totalGrupo)}</TableCell>}
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              );
            })
          )}

          {/* Rodapé */}
          {tipoRelatorio !== 'por_nfe' && (
            <div className="mt-4 border-t-2 border-black pt-2">
              <div className="flex justify-between items-center">
                <div className="text-xs font-bold">TOTAL: {totalItens} produto(s) • Estoque Baixo: {totalEstoqueBaixo}</div>
                <div className="text-xs font-bold">Valor Total: R$ {formatarNumero(totalValorEstoque)}</div>
              </div>
            </div>
          )}

          <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

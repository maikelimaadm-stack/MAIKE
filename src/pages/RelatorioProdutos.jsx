
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, Package, FileText } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatarMoeda = (valor) => {
  if (typeof valor !== 'number') return '0,00';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº Produto', default: true },
  { id: 'codigo', label: 'Código', default: true },
  { id: 'barras', label: 'Cód. Barras', default: false },
  { id: 'nome', label: 'Nome', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'unidade', label: 'UN', default: true },
  { id: 'estoque', label: 'Estoque', default: true },
  { id: 'custo', label: 'Custo', default: true },
  { id: 'venda', label: 'Venda', default: true },
];

const ORDENACAO_OPCOES = [
  { value: 'nome_asc', label: 'Nome (A-Z)' },
  { value: 'nome_desc', label: 'Nome (Z-A)' },
  { value: 'codigo_asc', label: 'Código (A-Z)' },
  { value: 'codigo_desc', label: 'Código (Z-A)' },
  { value: 'categoria_asc', label: 'Categoria (A-Z)' },
  { value: 'categoria_desc', label: 'Categoria (Z-A)' },
  { value: 'estoque_asc', label: 'Estoque (Menor)' },
  { value: 'estoque_desc', label: 'Estoque (Maior)' },
];

export default function RelatorioProdutos() {
  const [orientacao, setOrientacao] = useState("retrato");
  const [ordenacao, setOrdenacao] = useState('nome_asc');
  const [showConfig, setShowConfig] = useState(false); // New state for config dialog

  // Carregar configuração de colunas do localStorage
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_produtos');
    let initialVisibleColumns = [];
    if (saved) {
      try {
        const parsedSaved = JSON.parse(saved);
        // Filter out any old/invalid IDs and only keep IDs present in the new COLUNAS_DISPONIVEIS
        initialVisibleColumns = parsedSaved.filter(id => COLUNAS_DISPONIVEIS.some(col => col.id === id));
      } catch (e) {
        console.error("Failed to parse colunas_relatorio_produtos from localStorage", e);
      }
    }
    // If nothing valid was saved or saved list is empty, use defaults from COLUNAS_DISPONIVEIS
    if (initialVisibleColumns.length === 0) {
      initialVisibleColumns = COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
    }
    return initialVisibleColumns;
  });

  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [unidadesSelecionadas, setUnidadesSelecionadas] = useState([]);

  // Filtros de busca por texto
  const [buscaCodigo, setBuscaCodigo] = useState("");
  const [buscaBarras, setBuscaBarras] = useState("");
  const [buscaNome, setBuscaNome] = useState("");

  // Pegar empresa selecionada
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: produtos, isLoading } = useQuery({
    queryKey: ['produtos', empresaSelecionadaId],
    queryFn: async () => {
      const allProdutos = await base44.entities.Produto.list('nome_produto');
      return allProdutos.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    initialData: [],
    enabled: !!empresaSelecionadaId,
  });

  // Buscar dados da empresa selecionada
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
  const unidadesUnicas = [...new Set(produtos.map(p => p.unidade_medida))].filter(Boolean);

  const produtosFiltrados = useMemo(() => {
    let filtered = produtos.filter(p => {
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(p.categoria)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(p.id)) return false;
      if (unidadesSelecionadas.length > 0 && !unidadesSelecionadas.includes(p.unidade_medida)) return false;
      if (buscaCodigo && !p.codigo_interno?.toLowerCase().includes(buscaCodigo.toLowerCase())) return false;
      if (buscaBarras && !p.codigo_barras?.includes(buscaBarras)) return false;
      if (buscaNome && !p.nome_produto?.toLowerCase().includes(buscaNome.toLowerCase())) return false;
      return true;
    });

    // Aplicar ordenação
    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'nome_asc':
          return (a.nome_produto || '').localeCompare(b.nome_produto || '');
        case 'nome_desc':
          return (b.nome_produto || '').localeCompare(a.nome_produto || '');
        case 'codigo_asc':
          return (a.codigo_interno || '').localeCompare(b.codigo_interno || '');
        case 'codigo_desc':
          return (b.codigo_interno || '').localeCompare(a.codigo_interno || '');
        case 'categoria_asc':
          return (a.categoria || '').localeCompare(b.categoria || '');
        case 'categoria_desc':
          return (b.categoria || '').localeCompare(a.categoria || '');
        case 'estoque_asc':
          return (a.estoque_atual || 0) - (b.estoque_atual || 0);
        case 'estoque_desc':
          return (b.estoque_atual || 0) - (a.estoque_atual || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [produtos, categoriasSelecionadas, produtosSelecionados, unidadesSelecionadas, buscaCodigo, buscaBarras, buscaNome, ordenacao]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      // Salvar no localStorage
      localStorage.setItem('colunas_relatorio_produtos', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev =>
      prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]
    );
  };

  const limparFiltros = () => {
    setCategoriasSelecionadas([]);
    setProdutosSelecionados([]);
    setUnidadesSelecionadas([]);
    setBuscaCodigo("");
    setBuscaBarras("");
    setBuscaNome("");
  };

  const selecionarTodasCategorias = () => {
    setCategoriasSelecionadas(categoriasUnicas);
  };

  const desmarcarTodasCategorias = () => {
    setCategoriasSelecionadas([]);
  };

  const selecionarTodosProdutos = () => {
    setProdutosSelecionados(produtosUnicos.map(p => p.id));
  };

  const desmarcarTodosProdutos = () => {
    setProdutosSelecionados([]);
  };

  const selecionarTodasUnidades = () => {
    setUnidadesSelecionadas(unidadesUnicas);
  };

  const desmarcarTodasUnidades = () => {
    setUnidadesSelecionadas([]);
  };

  // Removed the 'imprimir' function as window.print() is called directly now.

  const valorTotalEstoque = produtosFiltrados.reduce((sum, p) => sum + ((p.preco_custo || 0) * (p.estoque_atual || 0)), 0);

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Lista de Produtos</h1>
          <p className="text-xs text-slate-600">Relatório completo</p>
        </div>
        <div className="flex gap-2">
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

      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="sm:max-w-[700px] p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle>Configurações do Relatório</DialogTitle>
          </DialogHeader>
          <Card className="shadow-none border-none">
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Orientação</Label>
                  <select
                    value={orientacao}
                    onChange={(e) => setOrientacao(e.target.value)}
                    className="w-full h-10 px-3 border rounded-md"
                  >
                    <option value="retrato">Retrato</option>
                    <option value="paisagem">Paisagem</option>
                  </select>
                </div>
                
                <div className="space-y-2">
                  <Label>Ordenar Por</Label>
                  <Select value={ordenacao} onValueChange={setOrdenacao}>
                    <SelectTrigger>
                      <SelectValue placeholder="Ordenar por..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ORDENACAO_OPCOES.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Buscas por texto */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Buscar por Nome</Label>
                  <Input
                    placeholder="Digite o nome..."
                    value={buscaNome}
                    onChange={(e) => setBuscaNome(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Buscar por Código</Label>
                  <Input
                    placeholder="Digite o código interno..."
                    value={buscaCodigo}
                    onChange={(e) => setBuscaCodigo(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Buscar por Cód. Barras</Label>
                  <Input
                    placeholder="Digite o código de barras..."
                    value={buscaBarras}
                    onChange={(e) => setBuscaBarras(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Produtos {produtosSelecionados.length > 0 && `(${produtosSelecionados.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                        <h4 className="font-semibold text-sm">Selecione Produtos</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosProdutos}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosProdutos}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {produtosUnicos.map(produto => (
                        <div key={produto.id} className="flex items-center space-x-2">
                          <Checkbox
                            checked={produtosSelecionados.includes(produto.id)}
                            onCheckedChange={() => toggleFiltro(produtosSelecionados, setProdutosSelecionados, produto.id)}
                          />
                          <label className="text-sm cursor-pointer">{produto.nome}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Categorias {categoriasSelecionadas.length > 0 && `(${categoriasSelecionadas.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                        <h4 className="font-semibold text-sm">Selecione Categorias</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodasCategorias}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodasCategorias}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {categoriasUnicas.map(categoria => (
                        <div key={categoria} className="flex items-center space-x-2">
                          <Checkbox
                            checked={categoriasSelecionadas.includes(categoria)}
                            onCheckedChange={() => toggleFiltro(categoriasSelecionadas, setCategoriasSelecionadas, categoria)}
                          />
                          <label className="text-sm cursor-pointer">{categoria}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Unidades {unidadesSelecionadas.length > 0 && `(${unidadesSelecionadas.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                        <h4 className="font-semibold text-sm">Unidades de Medida</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodasUnidades}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodasUnidades}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {unidadesUnicas.map(unidade => (
                        <div key={unidade} className="flex items-center space-x-2">
                          <Checkbox
                            checked={unidadesSelecionadas.includes(unidade)}
                            onCheckedChange={() => toggleFiltro(unidadesSelecionadas, setUnidadesSelecionadas, unidade)}
                          />
                          <label className="text-sm cursor-pointer">{unidade}</label>
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
        </DialogContent>
      </Dialog>
      
      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page {
              size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'};
              margin: 1.5cm 1cm 2cm 1cm;
            }
            body * {
              visibility: hidden;
            }
            .print-area, .print-area * {
              visibility: visible;
            }
            .print-area {
              position: absolute;
              left: 0;
              top: 0;
              width: 100%;
            }
            header, nav, .no-print {
              display: none !important;
            }
            body::before, body::after {
              content: none !important;
            }
          }
        `}} />
        
        <div className="print-area p-8 print:p-0">
          {/* Cabeçalho */}
          <div className="border-b-2 border-black pb-1 mb-2">
            <div className="flex items-center justify-between gap-3">
              {empresaAtual?.logotipo_url ? (
                <img 
                  src={empresaAtual.logotipo_url} 
                  alt={empresaAtual.apelido}
                  className="h-24 w-24 object-contain"
                />
              ) : (
                <img 
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                  alt="Logo"
                  className="h-24 w-24 object-contain"
                />
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
            
            {/* Título do Relatório */}
            <div>
              <h2 className="text-base font-bold">Lista de Produtos</h2>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-black">
                {colunasVisiveis.includes('numero') && <TableHead className="border border-black text-xs font-bold py-1">Nº</TableHead>}
                {colunasVisiveis.includes('nome') && <TableHead className="border border-black text-xs font-bold py-1">Nome</TableHead>}
                {colunasVisiveis.includes('codigo') && <TableHead className="border border-black text-xs font-bold py-1">Código</TableHead>}
                {colunasVisiveis.includes('barras') && <TableHead className="border border-black text-xs font-bold py-1">Cód. Barras</TableHead>}
                {colunasVisiveis.includes('categoria') && <TableHead className="border border-black text-xs font-bold py-1">Categoria</TableHead>}
                {colunasVisiveis.includes('unidade') && <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>}
                {colunasVisiveis.includes('estoque') && <TableHead className="border border-black text-xs font-bold text-right py-1">Estoque</TableHead>}
                {colunasVisiveis.includes('custo') && <TableHead className="border border-black text-xs font-bold text-right py-1">Custo</TableHead>}
                {colunasVisiveis.includes('venda') && <TableHead className="border border-black text-xs font-bold text-right py-1">Venda</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {produtosFiltrados.map((p, index) => (
                <TableRow key={p.id}>
                  {colunasVisiveis.includes('numero') && <TableCell className="border border-gray-300 text-xs py-1">{index + 1}</TableCell>}
                  {colunasVisiveis.includes('nome') && <TableCell className="border border-gray-300 text-xs py-1">{p.nome_produto}</TableCell>}
                  {colunasVisiveis.includes('codigo') && <TableCell className="border border-gray-300 text-xs py-1">{p.codigo_interno || '-'}</TableCell>}
                  {colunasVisiveis.includes('barras') && <TableCell className="border border-gray-300 text-xs py-1">{p.codigo_barras || '-'}</TableCell>}
                  {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs py-1">{p.categoria || '-'}</TableCell>}
                  {colunasVisiveis.includes('unidade') && <TableCell className="border border-gray-300 text-xs py-1">{p.unidade_medida}</TableCell>}
                  {colunasVisiveis.includes('estoque') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(p.estoque_atual || 0)}</TableCell>}
                  {colunasVisiveis.includes('custo') && <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(p.preco_custo || 0)}</TableCell>}
                  {colunasVisiveis.includes('venda') && <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(p.preco_venda || 0)}</TableCell>}
                </TableRow>
              ))}
              <TableRow className="bg-gray-100 font-bold">
                <TableCell colSpan={colunasVisiveis.includes('custo') ? colunasVisiveis.length -1 : colunasVisiveis.length} className="border border-black text-xs py-1">
                  TOTAL: {produtosFiltrados.length} produtos
                </TableCell>
                {colunasVisiveis.includes('custo') && (
                  <TableCell className="border border-black text-xs text-right py-1">
                    Valor Estoque: R$ {formatarNumero(valorTotalEstoque)}
                  </TableCell>
                )}
              </TableRow>
            </TableBody>
          </Table>

          {/* Rodapé */}
          <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

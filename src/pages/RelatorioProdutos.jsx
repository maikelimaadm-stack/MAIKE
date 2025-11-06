
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, Package } from "lucide-react";
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
import { Input } from "@/components/ui/input"; // Added Input import

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'nome', label: 'Nome do Produto', default: true },
  { id: 'codigo', label: 'Código Interno', default: true },
  { id: 'barras', label: 'Cód. Barras', default: false }, // Added new column
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'unidade', label: 'Unidade', default: true },
  { id: 'preco_custo', label: 'Preço Custo', default: true },
  { id: 'preco_venda', label: 'Preço Venda', default: true },
  { id: 'estoque', label: 'Estoque', default: true },
  { id: 'estoque_min', label: 'Estoque Mínimo', default: false }, // Added new column
];

export default function RelatorioProdutos() {
  const [orientacao, setOrientacao] = useState("retrato");
  const [colunasVisiveis, setColunasVisiveis] = useState(
    COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id)
  );

  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [unidadesSelecionadas, setUnidadesSelecionadas] = useState([]); // Added new state

  // Filtros de busca por texto
  const [buscaCodigo, setBuscaCodigo] = useState(""); // Added new state
  const [buscaBarras, setBuscaBarras] = useState(""); // Added new state
  const [buscaNome, setBuscaNome] = useState(""); // Added new state

  const { data: produtos, isLoading } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list('nome_produto'),
    initialData: [],
  });

  const categoriasUnicas = [...new Set(produtos.map(p => p.categoria))].filter(Boolean);
  const produtosUnicos = produtos.map(p => ({ id: p.id, nome: p.nome_produto }));
  const unidadesUnicas = [...new Set(produtos.map(p => p.unidade_medida))].filter(Boolean); // Added new unique list

  const produtosFiltrados = useMemo(() => {
    return produtos.filter(p => {
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(p.categoria)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(p.id)) return false;
      if (unidadesSelecionadas.length > 0 && !unidadesSelecionadas.includes(p.unidade_medida)) return false; // Added filter
      if (buscaCodigo && !p.codigo_interno?.toLowerCase().includes(buscaCodigo.toLowerCase())) return false; // Added filter
      if (buscaBarras && !p.codigo_barras?.includes(buscaBarras)) return false; // Added filter
      if (buscaNome && !p.nome_produto?.toLowerCase().includes(buscaNome.toLowerCase())) return false; // Added filter
      return true;
    });
  }, [produtos, categoriasSelecionadas, produtosSelecionados, unidadesSelecionadas, buscaCodigo, buscaBarras, buscaNome]); // Added new dependencies

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => 
      prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId]
    );
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev =>
      prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]
    );
  };

  const limparFiltros = () => {
    setCategoriasSelecionadas([]);
    setProdutosSelecionados([]);
    setUnidadesSelecionadas([]); // Added reset
    setBuscaCodigo(""); // Added reset
    setBuscaBarras(""); // Added reset
    setBuscaNome(""); // Added reset
  };

  const imprimir = () => {
    window.print();
  };

  const valorTotalEstoque = produtosFiltrados.reduce((sum, p) => sum + ((p.preco_custo || 0) * (p.estoque_atual || 0)), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center shadow-lg">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-900">Lista de Produtos</h1>
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
                  <h4 className="font-semibold text-sm mb-3">Selecione Produtos</h4>
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
                  <h4 className="font-semibold text-sm mb-3">Selecione Categorias</h4>
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
                  <h4 className="font-semibold text-sm mb-3">Selecione Unidades de Medida</h4>
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
                <Button variant="outline" className="gap-2">
                  <Settings className="w-4 h-4" />
                  Colunas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
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

      <div className={`bg-white print:shadow-none ${orientacao === 'paisagem' ? 'print:landscape' : ''}`}>
        <style dangerouslySetInnerHTML={{__html: `
          @media print {
            @page {
              size: ${orientacao === 'paisagem' ? 'A4 landscape' : 'A4 portrait'};
              margin: 1cm;
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
          }
        `}} />
        
        <div className="print-area p-8">
          <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-6">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
              alt="Fazenda Palmital"
              className="h-20"
            />
            <div className="text-right">
              <h1 className="text-2xl font-bold">Fazenda Palmital</h1>
              <p className="text-base">Antonio Lemos Beraldo</p>
              <p className="text-sm">Vila Bela da Ss. Trindade - MT</p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-xl font-bold">Lista de Produtos</h2>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-black">
                {colunasVisiveis.includes('nome') && <TableHead className="border border-black text-xs font-bold">Nome</TableHead>}
                {colunasVisiveis.includes('codigo') && <TableHead className="border border-black text-xs font-bold">Código</TableHead>}
                {colunasVisiveis.includes('barras') && <TableHead className="border border-black text-xs font-bold">Cód. Barras</TableHead>} {/* Added header */}
                {colunasVisiveis.includes('categoria') && <TableHead className="border border-black text-xs font-bold">Categoria</TableHead>}
                {colunasVisiveis.includes('unidade') && <TableHead className="border border-black text-xs font-bold">UN</TableHead>}
                {colunasVisiveis.includes('preco_custo') && <TableHead className="border border-black text-xs font-bold text-right">Custo</TableHead>}
                {colunasVisiveis.includes('preco_venda') && <TableHead className="border border-black text-xs font-bold text-right">Venda</TableHead>}
                {colunasVisiveis.includes('estoque') && <TableHead className="border border-black text-xs font-bold text-right">Estoque</TableHead>}
                {colunasVisiveis.includes('estoque_min') && <TableHead className="border border-black text-xs font-bold text-right">Est. Mínimo</TableHead>} {/* Added header */}
              </TableRow>
            </TableHeader>
            <TableBody>
              {produtosFiltrados.map((p) => (
                <TableRow key={p.id}>
                  {colunasVisiveis.includes('nome') && <TableCell className="border border-gray-300 text-xs">{p.nome_produto}</TableCell>}
                  {colunasVisiveis.includes('codigo') && <TableCell className="border border-gray-300 text-xs">{p.codigo_interno || '-'}</TableCell>}
                  {colunasVisiveis.includes('barras') && <TableCell className="border border-gray-300 text-xs">{p.codigo_barras || '-'}</TableCell>} {/* Added cell */}
                  {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs">{p.categoria || '-'}</TableCell>}
                  {colunasVisiveis.includes('unidade') && <TableCell className="border border-gray-300 text-xs">{p.unidade_medida}</TableCell>}
                  {colunasVisiveis.includes('preco_custo') && <TableCell className="border border-gray-300 text-xs text-right">R$ {formatarNumero(p.preco_custo || 0)}</TableCell>}
                  {colunasVisiveis.includes('preco_venda') && <TableCell className="border border-gray-300 text-xs text-right">R$ {formatarNumero(p.preco_venda || 0)}</TableCell>}
                  {colunasVisiveis.includes('estoque') && <TableCell className="border border-gray-300 text-xs text-right">{formatarNumero(p.estoque_atual || 0)}</TableCell>}
                  {colunasVisiveis.includes('estoque_min') && <TableCell className="border border-gray-300 text-xs text-right">{formatarNumero(p.estoque_minimo || 0)}</TableCell>} {/* Added cell */}
                </TableRow>
              ))}
              {/* This section for totals is preserved as per instructions, it automatically adjusts colSpan based on visible columns */}
              <TableRow className="bg-gray-100 font-bold">
                <TableCell colSpan={colunasVisiveis.length - (colunasVisiveis.includes('preco_custo') ? 1 : 0)} className="border border-black text-xs">
                  TOTAL: {produtosFiltrados.length} produtos
                </TableCell>
                {colunasVisiveis.includes('preco_custo') && (
                  <TableCell colSpan={colunasVisiveis.includes('preco_venda') || colunasVisiveis.includes('estoque') || colunasVisiveis.includes('estoque_min') ? 1 : undefined} className="border border-black text-xs text-right">
                    Valor Estoque: R$ {formatarNumero(valorTotalEstoque)}
                  </TableCell>
                )}
              </TableRow>
            </TableBody>
          </Table>

          <div className="mt-6 text-xs text-gray-500 text-right">
            Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          </div>
        </div>
      </div>
    </div>
  );
}

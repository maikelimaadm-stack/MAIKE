import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true },
  { id: 'nome', label: 'Nome', default: true },
  { id: 'codigo', label: 'Código', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'unidade', label: 'Unidade', default: true },
  { id: 'estoque', label: 'Estoque Atual', default: true },
  { id: 'estoque_min', label: 'Estoque Mínimo', default: true },
  { id: 'preco_custo', label: 'Preço Custo', default: true },
  { id: 'preco_venda', label: 'Preço Venda', default: true },
  { id: 'valor_total', label: 'Valor Total', default: true },
  { id: 'local', label: 'Local', default: false },
  { id: 'situacao', label: 'Situação', default: true },
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
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('nome_asc');
  const [filtroSituacao, setFiltroSituacao] = useState('todos');
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_estoque');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [locaisSelecionados, setLocaisSelecionados] = useState([]);
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
        case 'nome_asc':
          return (a.nome_produto || '').localeCompare(b.nome_produto || '');
        case 'nome_desc':
          return (b.nome_produto || '').localeCompare(a.nome_produto || '');
        case 'codigo_asc':
          return (a.codigo_interno || '').localeCompare(b.codigo_interno || '');
        case 'codigo_desc':
          return (b.codigo_interno || '').localeCompare(a.codigo_interno || '');
        case 'estoque_asc':
          return (a.estoque_atual || 0) - (b.estoque_atual || 0);
        case 'estoque_desc':
          return (b.estoque_atual || 0) - (a.estoque_atual || 0);
        case 'categoria_asc':
          return (a.categoria || '').localeCompare(b.categoria || '');
        case 'categoria_desc':
          return (b.categoria || '').localeCompare(a.categoria || '');
        case 'valor_asc':
          return (a.valor_total_estoque || 0) - (b.valor_total_estoque || 0);
        case 'valor_desc':
          return (b.valor_total_estoque || 0) - (a.valor_total_estoque || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [produtos, categoriasSelecionadas, produtosSelecionados, locaisSelecionados, buscaNome, buscaCodigo, filtroSituacao, ordenacao]);

  const produtosAgrupados = useMemo(() => {
    if (agrupamentosAtivos.length === 0) {
      return { "Todos os Produtos": produtosFiltrados };
    }

    const grupos = {};
    produtosFiltrados.forEach(p => {
      let chaveArray = [];
      agrupamentosAtivos.forEach(tipo => {
        let valor;
        switch (tipo) {
          case "categoria":
            valor = p.categoria || "Sem categoria";
            break;
          case "local":
            valor = p.local_estoque || "Sem local";
            break;
          case "situacao":
            valor = p.situacao || "Sem situação";
            break;
          default:
            valor = "Sem classificação";
        }
        chaveArray.push(valor);
      });
      const chave = chaveArray.join(" → ");
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push(p);
    });
    return grupos;
  }, [produtosFiltrados, agrupamentosAtivos]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_estoque', JSON.stringify(novasColunas));
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
    setBuscaNome("");
    setBuscaCodigo("");
    setFiltroSituacao('todos');
    setAgrupamentosAtivos([]);
    setOrdenacao('nome_asc');
  };

  const imprimir = () => window.print();

  const totalItens = produtosFiltrados.length;
  const totalValorEstoque = produtosFiltrados.reduce((sum, p) => sum + (p.valor_total_estoque || 0), 0);
  const totalEstoqueBaixo = produtosFiltrados.filter(p => p.situacao === 'Baixo').length;

  const selecionarTodasCategorias = () => setCategoriasSelecionadas(categoriasUnicas);
  const desmarcarTodasCategorias = () => setCategoriasSelecionadas([]);
  const selecionarTodosProdutos = () => setProdutosSelecionados(produtosUnicos.map(p => p.id));
  const desmarcarTodosProdutos = () => setProdutosSelecionados([]);
  const selecionarTodosLocais = () => setLocaisSelecionados(locaisUnicos);
  const desmarcarTodosLocais = () => setLocaisSelecionados([]);

  return (
    <div className="p-6 space-y-6">
      {/* Controles */}
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center shadow-lg">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-green-900">Relatório de Estoque</h1>
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
          </div>

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

          <div className="space-y-2">
            <Label>Agrupar Por (Múltipla Seleção)</Label>
            <div className="flex flex-wrap gap-2">
              {['categoria', 'local', 'situacao'].map((tipo) => (
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
                <Button variant="outline">Categorias {categoriasSelecionadas.length > 0 && `(${categoriasSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                    <h4 className="font-semibold text-sm">Categorias</h4>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodasCategorias}>Todos</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodasCategorias}>Nenhum</Button>
                    </div>
                  </div>
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
                    <div key={p.id} className="flex items-center space-x-2">
                      <Checkbox checked={produtosSelecionados.includes(p.id)} onCheckedChange={() => toggleFiltro(produtosSelecionados, setProdutosSelecionados, p.id)} />
                      <label className="text-sm cursor-pointer">{p.nome}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Locais {locaisSelecionados.length > 0 && `(${locaisSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                    <h4 className="font-semibold text-sm">Locais</h4>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosLocais}>Todos</Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosLocais}>Nenhum</Button>
                    </div>
                  </div>
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
              <h2 className="text-base font-bold">Relatório de Estoque</h2>
              <p className="text-xs text-gray-600">
                {totalItens} produto(s) • Valor: R$ {formatarNumero(totalValorEstoque)} • Estoque Baixo: {totalEstoqueBaixo}
              </p>
            </div>
          </div>

          {Object.entries(produtosAgrupados).map(([grupo, registros], idx) => {
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
                      {colunasVisiveis.includes('nome') && <TableHead className="border border-black text-xs font-bold py-1">Nome</TableHead>}
                      {colunasVisiveis.includes('codigo') && <TableHead className="border border-black text-xs font-bold py-1">Código</TableHead>}
                      {colunasVisiveis.includes('categoria') && <TableHead className="border border-black text-xs font-bold py-1">Categoria</TableHead>}
                      {colunasVisiveis.includes('unidade') && <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>}
                      {colunasVisiveis.includes('estoque') && <TableHead className="border border-black text-xs font-bold text-right py-1">Estoque</TableHead>}
                      {colunasVisiveis.includes('estoque_min') && <TableHead className="border border-black text-xs font-bold text-right py-1">Mínimo</TableHead>}
                      {colunasVisiveis.includes('preco_custo') && <TableHead className="border border-black text-xs font-bold text-right py-1">Custo</TableHead>}
                      {colunasVisiveis.includes('preco_venda') && <TableHead className="border border-black text-xs font-bold text-right py-1">Venda</TableHead>}
                      {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Valor Total</TableHead>}
                      {colunasVisiveis.includes('local') && <TableHead className="border border-black text-xs font-bold py-1">Local</TableHead>}
                      {colunasVisiveis.includes('situacao') && <TableHead className="border border-black text-xs font-bold py-1">Situação</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {registros.map((p) => (
                      <TableRow key={p.id}>
                        {colunasVisiveis.includes('numero') && <TableCell className="border border-gray-300 text-xs py-1">{p.numero_produto}</TableCell>}
                        {colunasVisiveis.includes('nome') && <TableCell className="border border-gray-300 text-xs py-1">{p.nome_produto}</TableCell>}
                        {colunasVisiveis.includes('codigo') && <TableCell className="border border-gray-300 text-xs py-1">{p.codigo_interno || '-'}</TableCell>}
                        {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs py-1">{p.categoria || '-'}</TableCell>}
                        {colunasVisiveis.includes('unidade') && <TableCell className="border border-gray-300 text-xs py-1">{p.unidade_medida}</TableCell>}
                        {colunasVisiveis.includes('estoque') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(p.estoque_atual || 0)}</TableCell>}
                        {colunasVisiveis.includes('estoque_min') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(p.estoque_minimo || 0)}</TableCell>}
                        {colunasVisiveis.includes('preco_custo') && <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(p.preco_custo || 0)}</TableCell>}
                        {colunasVisiveis.includes('preco_venda') && <TableCell className="border border-gray-300 text-xs text-right py-1">R$ {formatarNumero(p.preco_venda || 0)}</TableCell>}
                        {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right font-semibold py-1">R$ {formatarNumero(p.valor_total_estoque)}</TableCell>}
                        {colunasVisiveis.includes('local') && <TableCell className="border border-gray-300 text-xs py-1">{p.local_estoque || '-'}</TableCell>}
                        {colunasVisiveis.includes('situacao') && <TableCell className={`border border-gray-300 text-xs py-1 ${p.situacao === 'Baixo' ? 'font-bold text-red-600' : ''}`}>{p.situacao}</TableCell>}
                      </TableRow>
                    ))}
                    <TableRow className="bg-gray-100 font-bold">
                      <TableCell colSpan={colunasVisiveis.length - (colunasVisiveis.includes('valor_total') ? 1 : 0)} className="border border-black text-xs py-1">
                        SUBTOTAL ({registros.length} produto(s))
                      </TableCell>
                      {colunasVisiveis.includes('valor_total') && <TableCell className="border border-black text-xs text-right py-1">R$ {formatarNumero(totalGrupo)}</TableCell>}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            );
          })}

          <div className="mt-4 border-t-2 border-black pt-2">
            <div className="flex justify-between items-center">
              <div className="text-xs font-bold">TOTAL: {totalItens} produto(s) • Estoque Baixo: {totalEstoqueBaixo}</div>
              <div className="text-xs font-bold">Valor Total: R$ {formatarNumero(totalValorEstoque)}</div>
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
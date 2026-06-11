import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true },
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'placa', label: 'Placa', default: true },
  { id: 'motorista', label: 'Motorista', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'fornecedor', label: 'Fornecedor/Destino', default: true },
  { id: 'tara', label: 'Tara (kg)', default: true },
  { id: 'bruto', label: 'Bruto (kg)', default: true },
  { id: 'liquido', label: 'Líquido (kg)', default: true },
  { id: 'observacoes', label: 'Observações', default: false },
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antiga)' },
  { value: 'tipo_asc', label: 'Tipo (A-Z)' },
  { value: 'tipo_desc', label: 'Tipo (Z-A)' },
  { value: 'placa_asc', label: 'Placa (A-Z)' },
  { value: 'placa_desc', label: 'Placa (Z-A)' },
  { value: 'motorista_asc', label: 'Motorista (A-Z)' },
  { value: 'motorista_desc', label: 'Motorista (Z-A)' },
  { value: 'produto_asc', label: 'Produto (A-Z)' },
  { value: 'produto_desc', label: 'Produto (Z-A)' },
];

export default function RelatorioPesagens() {
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [orientacao, setOrientacao] = useState("retrato");
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('data_desc');
  const [showConfig, setShowConfig] = useState(false);
  
  // Carregar configuração de colunas do localStorage
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_pesagens');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fallback to default if parsing fails
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    // Default initial columns if nothing in localStorage
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [placasSelecionadas, setPlacasSelecionadas] = useState([]);
  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [motoristasSelecionados, setMotoristasSelecionados] = useState([]);
  const [fornecedoresSelecionados, setFornecedoresSelecionados] = useState([]);
  const [buscaObservacoes, setBuscaObservacoes] = useState("");

  // Pegar empresa selecionada
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: pesagens, isLoading } = useQuery({
    queryKey: ['pesagens', empresaSelecionadaId],
    queryFn: async () => {
      const allPesagens = await base44.entities.Pesagem.list('-data_pesagem');
      return allPesagens.filter(p => p.empresa_id === empresaSelecionadaId);
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

  const produtosUnicos = [...new Set(pesagens.map(p => p.produto))].filter(Boolean);
  const placasUnicas = [...new Set(pesagens.map(p => p.placa_caminhao))].filter(Boolean);
  const tiposUnicos = ['Entrada', 'Saída', 'Ambos'];
  const motoristasUnicos = [...new Set(pesagens.map(p => p.nome_motorista))].filter(Boolean);
  const fornecedoresUnicos = [...new Set(pesagens.map(p => p.fornecedor_destino))].filter(Boolean);

  const selecionarTodosProdutos = () => {
    setProdutosSelecionados(produtosUnicos);
  };

  const desmarcarTodosProdutos = () => {
    setProdutosSelecionados([]);
  };

  const selecionarTodasPlacas = () => {
    setPlacasSelecionadas(placasUnicas);
  };

  const desmarcarTodasPlacas = () => {
    setPlacasSelecionadas([]);
  };

  const selecionarTodosTipos = () => {
    setTiposSelecionados(tiposUnicos);
  };

  const desmarcarTodosTipos = () => {
    setTiposSelecionados([]);
  };

  const selecionarTodosMotoristas = () => {
    setMotoristasSelecionados(motoristasUnicos);
  };

  const desmarcarTodosMotoristas = () => {
    setMotoristasSelecionados([]);
  };

  const selecionarTodosFornecedores = () => {
    setFornecedoresSelecionados(fornecedoresUnicos);
  };

  const desmarcarTodosFornecedores = () => {
    setFornecedoresSelecionados([]);
  };

  const formatarData = (dataString) => {
    if (!dataString) return '--/--/----';
    try {
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '--/--/----';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return '--/--/----';
    }
  };

  const pesagensFiltradas = useMemo(() => {
    let filtered = pesagens.filter(p => {
      if (dataInicio && p.data_pesagem) {
        try {
          const pDate = new Date(p.data_pesagem);
          const iDate = new Date(dataInicio);
          // Set to start of day for comparison to include full day
          iDate.setHours(0, 0, 0, 0);
          if (!isNaN(pDate.getTime()) && !isNaN(iDate.getTime()) && pDate < iDate) return false;
        } catch {}
      }
      if (dataFim && p.data_pesagem) {
        try {
          const pDate = new Date(p.data_pesagem);
          const fDate = new Date(dataFim);
          // Set to end of day for comparison to include full day
          fDate.setHours(23, 59, 59, 999);
          if (!isNaN(pDate.getTime()) && !isNaN(fDate.getTime()) && pDate > fDate) return false;
        } catch {}
      }
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(p.produto)) return false;
      if (placasSelecionadas.length > 0 && !placasSelecionadas.includes(p.placa_caminhao)) return false;
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(p.tipo_pesagem)) return false;
      if (motoristasSelecionados.length > 0 && !motoristasSelecionados.includes(p.nome_motorista)) return false;
      if (fornecedoresSelecionados.length > 0 && !fornecedoresSelecionados.includes(p.fornecedor_destino)) return false;
      if (buscaObservacoes && !p.observacoes?.toLowerCase().includes(buscaObservacoes.toLowerCase())) return false;
      return true;
    });

    // Aplicar ordenação
    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc':
          return new Date(b.data_pesagem || 0) - new Date(a.data_pesagem || 0);
        case 'data_asc':
          return new Date(a.data_pesagem || 0) - new Date(b.data_pesagem || 0);
        case 'tipo_asc':
          return (a.tipo_pesagem || '').localeCompare(b.tipo_pesagem || '');
        case 'tipo_desc':
          return (b.tipo_pesagem || '').localeCompare(a.tipo_pesagem || '');
        case 'placa_asc':
          return (a.placa_caminhao || '').localeCompare(b.placa_caminhao || '');
        case 'placa_desc':
          return (b.placa_caminhao || '').localeCompare(a.placa_caminhao || '');
        case 'motorista_asc':
          return (a.nome_motorista || '').localeCompare(b.nome_motorista || '');
        case 'motorista_desc':
          return (b.nome_motorista || '').localeCompare(a.nome_motorista || '');
        case 'produto_asc':
          return (a.produto || '').localeCompare(b.produto || '');
        case 'produto_desc':
          return (b.produto || '').localeCompare(a.produto || '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [pesagens, dataInicio, dataFim, produtosSelecionados, placasSelecionadas, tiposSelecionados, motoristasSelecionados, fornecedoresSelecionados, buscaObservacoes, ordenacao]);

  const pesagensAgrupadas = useMemo(() => {
    if (agrupamentosAtivos.length === 0) {
      return { "Todos os Registros": pesagensFiltradas };
    }

    const grupos = {};

    pesagensFiltradas.forEach(p => {
      let chaveArray = [];

      agrupamentosAtivos.forEach(tipo => {
        let valor;
        switch (tipo) {
          case "data":
            valor = formatarData(p.data_pesagem);
            break;
          case "placa":
            valor = p.placa_caminhao || "Sem placa";
            break;
          case "tipo":
            valor = p.tipo_pesagem || "Sem tipo";
            break;
          case "motorista":
            valor = p.nome_motorista || "Sem motorista";
            break;
          case "produto":
            valor = p.produto || "Sem produto";
            break;
          case "fornecedor":
            valor = p.fornecedor_destino || "Sem fornecedor/destino";
            break;
          default:
            valor = "Sem classificação";
        }
        chaveArray.push(valor);
      });

      const chave = chaveArray.join(" → ");

      if (!grupos[chave]) {
        grupos[chave] = [];
      }
      grupos[chave].push(p);
    });

    return grupos;
  }, [pesagensFiltradas, agrupamentosAtivos]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      // Salvar no localStorage
      localStorage.setItem('colunas_relatorio_pesagens', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev =>
      prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]
    );
  };

  const toggleAgrupamento = (tipo) => {
    setAgrupamentosAtivos(prev =>
      prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo]
    );
  };

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setProdutosSelecionados([]);
    setPlacasSelecionadas([]);
    setTiposSelecionados([]);
    setMotoristasSelecionados([]);
    setFornecedoresSelecionados([]);
    setBuscaObservacoes("");
    setAgrupamentosAtivos([]);
    setOrdenacao('data_desc'); // Reset sorting as well
    setTipoRelatorio('analitico'); // Reset report type
  };

  const totalPesoLiquido = pesagensFiltradas.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);

  return (
    <div className="absolute inset-0 overflow-y-auto p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Pesagens</h1>
          <p className="text-xs text-slate-600">Análise e impressão</p>
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

      {/* Filtros e Configurações (moved to Dialog) */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto print:hidden">
          <DialogHeader>
            <DialogTitle>Configurações do Relatório</DialogTitle>
          </DialogHeader>
          <Card className="shadow-none border-none">
            <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b">
              <CardTitle className="text-green-900">Filtros e Configurações</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>Data Início</Label>
                  <Input
                    type="date"
                    value={dataInicio}
                    onChange={(e) => setDataInicio(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Data Fim</Label>
                  <Input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                  />
                </div>
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
                  <Label>Tipo de Relatório</Label>
                  <Select value={tipoRelatorio} onValueChange={setTipoRelatorio}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="analitico">Analítico (Detalhado)</SelectItem>
                      <SelectItem value="sintetico">Sintético (Resumido)</SelectItem>
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
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Agrupar Por</Label>
                <div className="flex flex-wrap gap-2">
                  {['data', 'tipo', 'placa', 'motorista', 'produto', 'fornecedor'].map((tipo) => (
                    <Button
                      key={tipo}
                      variant={agrupamentosAtivos.includes(tipo) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleAgrupamento(tipo)}
                      className={agrupamentosAtivos.includes(tipo) ? "bg-green-600 hover:bg-green-700" : ""}
                    >
                      {tipo.charAt(0).toUpperCase() + tipo.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Buscar em Observações</Label>
                <Input
                  placeholder="Digite para buscar nas observações..."
                  value={buscaObservacoes}
                  onChange={(e) => setBuscaObservacoes(e.target.value)}
                />
              </div>

              <div className="flex gap-3 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Tipos {tiposSelecionados.length > 0 && `(${tiposSelecionados.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-semibold text-sm">Selecione Tipos</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosTipos}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosTipos}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {tiposUnicos.map(tipo => (
                        <div key={tipo} className="flex items-center space-x-2">
                          <Checkbox
                            checked={tiposSelecionados.includes(tipo)}
                            onCheckedChange={() => toggleFiltro(tiposSelecionados, setTiposSelecionados, tipo)}
                          />
                          <label className="text-sm cursor-pointer">{tipo}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Placas {placasSelecionadas.length > 0 && `(${placasSelecionadas.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                        <h4 className="font-semibold text-sm">Selecione Placas</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodasPlacas}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodasPlacas}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {placasUnicas.map(placa => (
                        <div key={placa} className="flex items-center space-x-2">
                          <Checkbox
                            checked={placasSelecionadas.includes(placa)}
                            onCheckedChange={() => toggleFiltro(placasSelecionadas, setPlacasSelecionadas, placa)}
                          />
                          <label className="text-sm cursor-pointer uppercase">{placa}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Motoristas {motoristasSelecionados.length > 0 && `(${motoristasSelecionados.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                        <h4 className="font-semibold text-sm">Selecione Motoristas</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosMotoristas}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosMotoristas}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {motoristasUnicos.map(motorista => (
                        <div key={motorista} className="flex items-center space-x-2">
                          <Checkbox
                            checked={motoristasSelecionados.includes(motorista)}
                            onCheckedChange={() => toggleFiltro(motoristasSelecionados, setMotoristasSelecionados, motorista)}
                          />
                          <label className="text-sm cursor-pointer">{motorista}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

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
                        <div key={produto} className="flex items-center space-x-2">
                          <Checkbox
                            checked={produtosSelecionados.includes(produto)}
                            onCheckedChange={() => toggleFiltro(produtosSelecionados, setProdutosSelecionados, produto)}
                          />
                          <label className="text-sm cursor-pointer">{produto}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Fornec./Dest. {fornecedoresSelecionados.length > 0 && `(${fornecedoresSelecionados.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-96 overflow-auto">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center mb-3 sticky top-0 bg-white pb-2">
                        <h4 className="font-semibold text-sm">Fornecedores/Destinos</h4>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={selecionarTodosFornecedores}>
                            Todos
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={desmarcarTodosFornecedores}>
                            Nenhum
                          </Button>
                        </div>
                      </div>
                      {fornecedoresUnicos.map(fornecedor => (
                        <div key={fornecedor} className="flex items-center space-x-2">
                          <Checkbox
                            checked={fornecedoresSelecionados.includes(fornecedor)}
                            onCheckedChange={() => toggleFiltro(fornecedoresSelecionados, setFornecedoresSelecionados, fornecedor)}
                          />
                          <label className="text-sm cursor-pointer">{fornecedor}</label>
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

      {/* Área de Impressão */}
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
            @page {
              @bottom-center {
                content: "Página " counter(page) " de " counter(pages);
              }
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
                  alt={empresaAtual.apelido || "Logo"}
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
              <h2 className="text-base font-bold">Relatório de Pesagens {tipoRelatorio === 'analitico' ? '(Analítico)' : '(Sintético)'}</h2>
              {(dataInicio || dataFim) && (
                <p className="text-xs text-gray-600">
                  Período: {dataInicio ? formatarData(dataInicio) : "Início"} a {dataFim ? formatarData(dataFim) : "Hoje"}
                </p>
              )}
            </div>
          </div>

          {pesagensFiltradas.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>Nenhuma pesagem encontrada com os filtros aplicados.</p>
            </div>
          ) : (
            <>
              {/* Tabelas Agrupadas */}
              {Object.entries(pesagensAgrupadas).map(([grupo, registros], idx) => {
                const totalGrupo = registros.reduce((sum, p) => sum + (p.peso_liquido || 0), 0);

                return (
                  <div key={idx} className="mb-4">
                    {agrupamentosAtivos.length > 0 && (
                      <div className="bg-gray-200 px-2 py-1 mb-1">
                        <h3 className="font-bold text-xs">{grupo} ({registros.length} {registros.length === 1 ? 'registro' : 'registros'})</h3>
                      </div>
                    )}

                    {tipoRelatorio === 'analitico' && (
                      <Table>
                        <TableHeader>
                          <TableRow className="border-black">
                            {colunasVisiveis.includes('numero') && <TableHead className="border border-black text-xs font-bold py-1">Nº</TableHead>}
                            {colunasVisiveis.includes('data') && <TableHead className="border border-black text-xs font-bold py-1">Data</TableHead>}
                            {colunasVisiveis.includes('tipo') && <TableHead className="border border-black text-xs font-bold py-1">Tipo</TableHead>}
                            {colunasVisiveis.includes('placa') && <TableHead className="border border-black text-xs font-bold py-1">Placa</TableHead>}
                            {colunasVisiveis.includes('motorista') && <TableHead className="border border-black text-xs font-bold py-1">Motorista</TableHead>}
                            {colunasVisiveis.includes('produto') && <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>}
                            {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Forn./Dest.</TableHead>}
                            {colunasVisiveis.includes('tara') && <TableHead className="border border-black text-xs font-bold text-right py-1">Tara</TableHead>}
                            {colunasVisiveis.includes('bruto') && <TableHead className="border border-black text-xs font-bold text-right py-1">Bruto</TableHead>}
                            {colunasVisiveis.includes('liquido') && <TableHead className="border border-black text-xs font-bold text-right py-1">Líquido</TableHead>}
                            {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Observações</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {registros.map((p, rowIndex) => (
                            <TableRow key={p.id}>
                              {colunasVisiveis.includes('numero') && <TableCell className="border border-gray-300 text-xs py-1">{rowIndex + 1}</TableCell>}
                              {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(p.data_pesagem)}</TableCell>}
                              {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs py-1">{p.tipo_pesagem}</TableCell>}
                              {colunasVisiveis.includes('placa') && <TableCell className="border border-gray-300 text-xs uppercase py-1">{p.placa_caminhao}</TableCell>}
                              {colunasVisiveis.includes('motorista') && <TableCell className="border border-gray-300 text-xs py-1">{p.nome_motorista}</TableCell>}
                              {colunasVisiveis.includes('produto') && <TableCell className="border border-gray-300 text-xs py-1">{p.produto}</TableCell>}
                              {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{p.fornecedor_destino || '-'}</TableCell>}
                              {colunasVisiveis.includes('tara') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(p.peso_tara)}</TableCell>}
                              {colunasVisiveis.includes('bruto') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(p.peso_bruto)}</TableCell>}
                              {colunasVisiveis.includes('liquido') && <TableCell className="border border-gray-300 text-xs text-right font-semibold py-1">{formatarNumero(p.peso_liquido)}</TableCell>}
                              {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1">{p.observacoes || '-'}</TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    <Table className="mt-1">
                      <TableBody>
                        <TableRow className="bg-gray-100 font-bold">
                          <TableCell colSpan={tipoRelatorio === 'analitico' ? colunasVisiveis.length - (colunasVisiveis.includes('liquido') ? 1 : 0) : 1} className="border border-black text-xs py-1">
                            SUBTOTAL ({registros.length} {registros.length === 1 ? 'registro' : 'registros'})
                          </TableCell>
                          <TableCell className="border border-black text-xs text-right py-1">{formatarNumero(totalGrupo)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                );
              })}

              {/* Total Geral */}
              <div className="mt-4 border-t-2 border-black pt-2">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-bold">
                    TOTAL GERAL: {pesagensFiltradas.length} {pesagensFiltradas.length === 1 ? 'pesagem' : 'pesagens'}
                  </div>
                  <div className="text-xs font-bold">
                    Peso Líquido Total: {formatarNumero(totalPesoLiquido)} kg
                  </div>
                </div>
              </div>

              {/* Rodapé */}
              <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
                <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
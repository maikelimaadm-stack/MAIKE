import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, TrendingUp, TrendingDown, ArrowRightLeft } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0";
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

const COLUNAS_DISPONIVEIS = [
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'motivo', label: 'Motivo', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'marca', label: 'Marca', default: true },
  { id: 'sexo', label: 'Sexo', default: false },
  { id: 'peso_medio', label: 'Peso Médio', default: false },
  { id: 'peso_total', label: 'Peso Total', default: false },
  { id: 'area', label: 'Área', default: true },
  { id: 'valor_unitario', label: 'Vlr. Unit.', default: false },
  { id: 'valor_total', label: 'Vlr. Total', default: false },
  { id: 'fornecedor', label: 'Fornec./Comprador', default: false },
  { id: 'causa_morte', label: 'Causa Morte', default: false },
  { id: 'transferencia', label: 'Origem/Destino Transf.', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais recente)' },
  { value: 'data_asc', label: 'Data (Mais antiga)' },
  { value: 'tipo_asc', label: 'Tipo (A-Z)' },
  { value: 'tipo_desc', label: 'Tipo (Z-A)' },
  { value: 'quantidade_desc', label: 'Quantidade (Maior)' },
  { value: 'quantidade_asc', label: 'Quantidade (Menor)' },
  { value: 'categoria_asc', label: 'Categoria (A-Z)' },
];

export default function RelatorioMovimentacoesPecuaria() {
  const [orientacao, setOrientacao] = useState("paisagem");
  const [ordenacao, setOrdenacao] = useState('data_desc');
  const [showConfig, setShowConfig] = useState(false);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_mov_pecuaria');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [motivosSelecionados, setMotivosSelecionados] = useState([]);
  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [marcasSelecionadas, setMarcasSelecionadas] = useState([]);
  const [areasSelecionadas, setAreasSelecionadas] = useState([]);
  
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [buscaTexto, setBuscaTexto] = useState("");

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

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

  const tiposUnicos = [...new Set(movimentacoes.map(m => m.tipo))].filter(Boolean).sort();
  const motivosUnicos = [...new Set(movimentacoes.map(m => m.motivo))].filter(Boolean).sort();
  const categoriasUnicas = [...new Set(movimentacoes.map(m => m.categoria_animal))].filter(Boolean).sort();
  const marcasUnicas = [...new Set(movimentacoes.map(m => m.marca))].filter(Boolean).sort();
  const areasUnicas = [...new Set([
    ...movimentacoes.map(m => m.area_origem_nome),
    ...movimentacoes.map(m => m.area_destino_nome)
  ])].filter(Boolean).sort();

  const movimentacoesFiltradas = useMemo(() => {
    let filtered = movimentacoes.filter(m => {
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(m.tipo)) return false;
      if (motivosSelecionados.length > 0 && !motivosSelecionados.includes(m.motivo)) return false;
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(m.categoria_animal)) return false;
      if (marcasSelecionadas.length > 0 && !marcasSelecionadas.includes(m.marca)) return false;
      if (areasSelecionadas.length > 0) {
        const areaMatch = areasSelecionadas.includes(m.area_origem_nome) || areasSelecionadas.includes(m.area_destino_nome);
        if (!areaMatch) return false;
      }
      
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
      
      if (buscaTexto) {
        const termo = buscaTexto.toLowerCase();
        const match = 
          m.categoria_animal?.toLowerCase().includes(termo) ||
          m.marca?.toLowerCase().includes(termo) ||
          m.observacoes?.toLowerCase().includes(termo) ||
          m.fornecedor_origem?.toLowerCase().includes(termo) ||
          m.destino_venda?.toLowerCase().includes(termo) ||
          m.causa_morte?.toLowerCase().includes(termo);
        if (!match) return false;
      }
      
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc':
          return new Date(b.data_movimentacao) - new Date(a.data_movimentacao);
        case 'data_asc':
          return new Date(a.data_movimentacao) - new Date(b.data_movimentacao);
        case 'tipo_asc':
          return (a.tipo || '').localeCompare(b.tipo || '');
        case 'tipo_desc':
          return (b.tipo || '').localeCompare(a.tipo || '');
        case 'quantidade_desc':
          return (b.quantidade_animais || 0) - (a.quantidade_animais || 0);
        case 'quantidade_asc':
          return (a.quantidade_animais || 0) - (b.quantidade_animais || 0);
        case 'categoria_asc':
          return (a.categoria_animal || '').localeCompare(b.categoria_animal || '');
        default:
          return 0;
      }
    });

    return filtered;
  }, [movimentacoes, tiposSelecionados, motivosSelecionados, categoriasSelecionadas, marcasSelecionadas, areasSelecionadas, dataInicio, dataFim, buscaTexto, ordenacao]);

  const totalEntradas = movimentacoesFiltradas.filter(m => m.tipo === 'Entrada').reduce((sum, m) => sum + (m.quantidade_animais || 0), 0);
  const totalSaidas = movimentacoesFiltradas.filter(m => m.tipo === 'Saída').reduce((sum, m) => sum + (m.quantidade_animais || 0), 0);
  const saldoPeriodo = totalEntradas - totalSaidas;

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_mov_pecuaria', JSON.stringify(novasColunas));
      return novasColunas;
    });
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev =>
      prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]
    );
  };

  const limparFiltros = () => {
    setTiposSelecionados([]);
    setMotivosSelecionados([]);
    setCategoriasSelecionadas([]);
    setMarcasSelecionadas([]);
    setAreasSelecionadas([]);
    setDataInicio("");
    setDataFim("");
    setBuscaTexto("");
    toast.info("Filtros limpos!");
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Movimentações Pecuárias</h1>
          <p className="text-xs text-slate-600">Entradas, saídas e movimentações do rebanho</p>
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

      {/* Cards de resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mb-2 print:hidden">
        <Card className="shadow-sm border-l-4 border-l-blue-500">
          <CardContent className="p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-600 mb-0.5">Total Movimentações</p>
                <p className="text-lg font-bold text-blue-700">{movimentacoesFiltradas.length}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">registros</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <ArrowRightLeft className="w-3.5 h-3.5 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm border-l-4 border-l-emerald-500">
          <CardContent className="p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-600 mb-0.5">Total Entradas</p>
                <p className="text-lg font-bold text-emerald-700">{formatarNumero(totalEntradas)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">cabeças</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-l-4 border-l-red-500">
          <CardContent className="p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-600 mb-0.5">Total Saídas</p>
                <p className="text-lg font-bold text-red-700">{formatarNumero(totalSaidas)}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">cabeças</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                <TrendingDown className="w-3.5 h-3.5 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={`shadow-sm border-l-4 ${saldoPeriodo >= 0 ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
          <CardContent className="p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-600 mb-0.5">Saldo Período</p>
                <p className={`text-lg font-bold ${saldoPeriodo >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">cabeças</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialog de Configuração */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto p-0">
          <DialogHeader className="p-6 pb-0">
            <DialogTitle className="text-lg font-semibold">Configurações do Relatório</DialogTitle>
          </DialogHeader>
          <div className="p-6 pt-4">
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

                <div className="space-y-2">
                  <Label>Buscar</Label>
                  <Input
                    placeholder="Categoria, marca, obs..."
                    value={buscaTexto}
                    onChange={(e) => setBuscaTexto(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Data Início</Label>
                  <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Data Fim</Label>
                  <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Tipo {tiposSelecionados.length > 0 && `(${tiposSelecionados.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64">
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm mb-3">Tipos</h4>
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
                      Motivo {motivosSelecionados.length > 0 && `(${motivosSelecionados.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-80 overflow-auto">
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm mb-3">Motivos</h4>
                      {motivosUnicos.map(motivo => (
                        <div key={motivo} className="flex items-center space-x-2">
                          <Checkbox
                            checked={motivosSelecionados.includes(motivo)}
                            onCheckedChange={() => toggleFiltro(motivosSelecionados, setMotivosSelecionados, motivo)}
                          />
                          <label className="text-sm cursor-pointer">{motivo}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Categoria {categoriasSelecionadas.length > 0 && `(${categoriasSelecionadas.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-80 overflow-auto">
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm mb-3">Categorias</h4>
                      {categoriasUnicas.map(cat => (
                        <div key={cat} className="flex items-center space-x-2">
                          <Checkbox
                            checked={categoriasSelecionadas.includes(cat)}
                            onCheckedChange={() => toggleFiltro(categoriasSelecionadas, setCategoriasSelecionadas, cat)}
                          />
                          <label className="text-sm cursor-pointer">{cat}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Marca {marcasSelecionadas.length > 0 && `(${marcasSelecionadas.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-80 overflow-auto">
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm mb-3">Marcas</h4>
                      {marcasUnicas.map(marca => (
                        <div key={marca} className="flex items-center space-x-2">
                          <Checkbox
                            checked={marcasSelecionadas.includes(marca)}
                            onCheckedChange={() => toggleFiltro(marcasSelecionadas, setMarcasSelecionadas, marca)}
                          />
                          <label className="text-sm cursor-pointer">{marca}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      Área {areasSelecionadas.length > 0 && `(${areasSelecionadas.length})`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 max-h-80 overflow-auto">
                    <div className="space-y-2">
                      <h4 className="font-semibold text-sm mb-3">Áreas</h4>
                      {areasUnicas.map(area => (
                        <div key={area} className="flex items-center space-x-2">
                          <Checkbox
                            checked={areasSelecionadas.includes(area)}
                            onCheckedChange={() => toggleFiltro(areasSelecionadas, setAreasSelecionadas, area)}
                          />
                          <label className="text-sm cursor-pointer">{area}</label>
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
            </div>
          </div>
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
          }
        `}} />
        
        <div className="print-area p-8 print:p-0">
          {/* Cabeçalho */}
          <div className="border-b-2 border-black pb-1 mb-2">
            <div className="flex items-center justify-between gap-3">
              {empresaAtual?.logotipo_url ? (
                <img 
                  src={empresaAtual.logotipo_url} 
                  alt={empresaAtual.apelido || "Logo da Empresa"}
                  className="h-24 w-24 object-contain"
                />
              ) : (
                <img 
                  src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/7f0d28c9d_Imagem1.jpg" 
                  alt="Logo Padrão"
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
            
            <div className="mt-2">
              <h2 className="text-base font-bold">Relatório de Movimentações Pecuárias</h2>
              {(dataInicio || dataFim) && (
                <p className="text-xs">
                  Período: {dataInicio ? formatarData(dataInicio) : 'Início'} a {dataFim ? formatarData(dataFim) : 'Atual'}
                </p>
              )}
            </div>
          </div>

          {/* Resumo */}
          <div className="mb-3 p-2 bg-gray-50 border rounded text-xs">
            <div className="flex gap-6">
              <span><strong>Total Entradas:</strong> {formatarNumero(totalEntradas)} cab</span>
              <span><strong>Total Saídas:</strong> {formatarNumero(totalSaidas)} cab</span>
              <span><strong>Saldo:</strong> {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab</span>
              <span><strong>Registros:</strong> {movimentacoesFiltradas.length}</span>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-black">
                {colunasVisiveis.includes('data') && <TableHead className="border border-black text-xs font-bold py-1">Data</TableHead>}
                {colunasVisiveis.includes('tipo') && <TableHead className="border border-black text-xs font-bold py-1">Tipo</TableHead>}
                {colunasVisiveis.includes('motivo') && <TableHead className="border border-black text-xs font-bold py-1">Motivo</TableHead>}
                {colunasVisiveis.includes('quantidade') && <TableHead className="border border-black text-xs font-bold py-1 text-right">Qtd</TableHead>}
                {colunasVisiveis.includes('categoria') && <TableHead className="border border-black text-xs font-bold py-1">Categoria</TableHead>}
                {colunasVisiveis.includes('marca') && <TableHead className="border border-black text-xs font-bold py-1">Marca</TableHead>}
                {colunasVisiveis.includes('sexo') && <TableHead className="border border-black text-xs font-bold py-1">Sexo</TableHead>}
                {colunasVisiveis.includes('peso_medio') && <TableHead className="border border-black text-xs font-bold py-1 text-right">Peso Méd.</TableHead>}
                {colunasVisiveis.includes('peso_total') && <TableHead className="border border-black text-xs font-bold py-1 text-right">Peso Tot.</TableHead>}
                {colunasVisiveis.includes('area') && <TableHead className="border border-black text-xs font-bold py-1">Área</TableHead>}
                {colunasVisiveis.includes('valor_unitario') && <TableHead className="border border-black text-xs font-bold py-1 text-right">Vlr Unit.</TableHead>}
                {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold py-1 text-right">Vlr Total</TableHead>}
                {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Fornec./Comprador</TableHead>}
                {colunasVisiveis.includes('causa_morte') && <TableHead className="border border-black text-xs font-bold py-1">Causa Morte</TableHead>}
                {colunasVisiveis.includes('transferencia') && <TableHead className="border border-black text-xs font-bold py-1">Origem/Destino</TableHead>}
                {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Obs</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {movimentacoesFiltradas.map((m) => {
                const areaExibir = m.tipo === 'Entrada' ? m.area_destino_nome : m.area_origem_nome;
                return (
                  <TableRow key={m.id}>
                    {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(m.data_movimentacao)}</TableCell>}
                    {colunasVisiveis.includes('tipo') && (
                      <TableCell className="border border-gray-300 text-xs py-1">
                        <span className={`px-1 py-0.5 rounded ${m.tipo === 'Entrada' ? 'bg-green-100' : 'bg-red-100'}`}>
                          {m.tipo}
                        </span>
                      </TableCell>
                    )}
                    {colunasVisiveis.includes('motivo') && <TableCell className="border border-gray-300 text-xs py-1">{m.motivo || '-'}</TableCell>}
                    {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs py-1 text-right font-semibold">{m.quantidade_animais}</TableCell>}
                    {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs py-1">{m.categoria_animal || '-'}</TableCell>}
                    {colunasVisiveis.includes('marca') && <TableCell className="border border-gray-300 text-xs py-1">{m.marca || '-'}</TableCell>}
                    {colunasVisiveis.includes('sexo') && <TableCell className="border border-gray-300 text-xs py-1">{m.sexo || '-'}</TableCell>}
                    {colunasVisiveis.includes('peso_medio') && <TableCell className="border border-gray-300 text-xs py-1 text-right">{m.peso_medio ? `${m.peso_medio} kg` : '-'}</TableCell>}
                    {colunasVisiveis.includes('peso_total') && <TableCell className="border border-gray-300 text-xs py-1 text-right">{m.peso_total ? `${m.peso_total} kg` : '-'}</TableCell>}
                    {colunasVisiveis.includes('area') && <TableCell className="border border-gray-300 text-xs py-1">{areaExibir || '-'}</TableCell>}
                    {colunasVisiveis.includes('valor_unitario') && <TableCell className="border border-gray-300 text-xs py-1 text-right">{m.valor_unitario ? `R$ ${m.valor_unitario.toFixed(2)}` : '-'}</TableCell>}
                    {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs py-1 text-right">{m.valor_total ? `R$ ${m.valor_total.toFixed(2)}` : '-'}</TableCell>}
                    {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{m.fornecedor_origem || m.destino_venda || '-'}</TableCell>}
                    {colunasVisiveis.includes('causa_morte') && <TableCell className="border border-gray-300 text-xs py-1">{m.causa_morte || '-'}</TableCell>}
                    {colunasVisiveis.includes('transferencia') && <TableCell className="border border-gray-300 text-xs py-1">{m.transferencia_origem || m.transferencia_destino ? `${m.transferencia_origem || ''} → ${m.transferencia_destino || ''}` : '-'}</TableCell>}
                    {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1 max-w-[150px] truncate">{m.observacoes || '-'}</TableCell>}
                  </TableRow>
                );
              })}
              <TableRow className="bg-gray-100 font-bold">
                <TableCell colSpan={colunasVisiveis.length} className="border border-black text-xs py-1">
                  TOTAL: {movimentacoesFiltradas.length} movimentações | Entradas: {formatarNumero(totalEntradas)} cab | Saídas: {formatarNumero(totalSaidas)} cab | Saldo: {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
                </TableCell>
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
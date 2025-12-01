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

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "";
  return numero.toLocaleString('pt-BR');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'motivo', label: 'Motivo', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'categoria_nova', label: 'Categoria Nova', default: false },
  { id: 'marca', label: 'Marca', default: true },
  { id: 'sexo', label: 'Sexo', default: false },
  { id: 'setor', label: 'Setor', default: false },
  { id: 'area', label: 'Área', default: false },
  { id: 'peso_medio', label: 'Peso Médio', default: false },
  { id: 'peso_total', label: 'Peso Total', default: false },
  { id: 'valor_unitario', label: 'Valor Unit.', default: false },
  { id: 'valor_total', label: 'Valor Total', default: false },
  { id: 'fornecedor', label: 'Fornecedor', default: false },
  { id: 'comprador', label: 'Comprador', default: false },
  { id: 'nota_fiscal', label: 'Nota Fiscal', default: false },
  { id: 'gta', label: 'GTA', default: false },
  { id: 'causa_morte', label: 'Causa Morte', default: false },
  { id: 'transferencia_origem', label: 'Transf. Origem', default: false },
  { id: 'transferencia_destino', label: 'Transf. Destino', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
  { id: 'responsavel', label: 'Responsável', default: false },
];

// Opções de coluna para o eixo X do relatório sintético (matriz)
const EIXO_X_OPCOES = [
  { value: 'setor', label: 'Setor/Fazenda' },
  { value: 'marca', label: 'Marca' },
  { value: 'motivo', label: 'Motivo' },
  { value: 'sexo', label: 'Sexo' },
  { value: 'tipo', label: 'Tipo (Entrada/Saída)' },
  { value: 'causa_morte', label: 'Causa Morte' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'comprador', label: 'Comprador/Destino' },
  { value: 'area', label: 'Área' },
  { value: 'nota_fiscal', label: 'Nota Fiscal' },
  { value: 'gta', label: 'GTA' },
  { value: 'categoria_nova', label: 'Categoria Nova' },
  { value: 'transferencia_origem', label: 'Transferência Origem' },
  { value: 'transferencia_destino', label: 'Transferência Destino' },
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antiga)' },
  { value: 'quantidade_desc', label: 'Quantidade (Maior)' },
  { value: 'quantidade_asc', label: 'Quantidade (Menor)' },
  { value: 'categoria_asc', label: 'Categoria (A-Z)' },
  { value: 'marca_asc', label: 'Marca (A-Z)' },
];

export default function RelatorioMovimentacoesPecuaria() {
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [orientacao, setOrientacao] = useState("paisagem");
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('data_desc');
  const [eixoXSintetico, setEixoXSintetico] = useState('setor'); // Coluna do eixo X na matriz sintética
  const [eixoYSintetico, setEixoYSintetico] = useState('categoria'); // Linha do eixo Y na matriz sintética

// Opções de linha para o eixo Y do relatório sintético (matriz)
const EIXO_Y_OPCOES = [
  { value: 'categoria', label: 'Categoria de Manejo' },
  { value: 'marca', label: 'Marca' },
  { value: 'setor', label: 'Setor/Fazenda' },
  { value: 'motivo', label: 'Motivo' },
  { value: 'sexo', label: 'Sexo' },
  { value: 'tipo', label: 'Tipo (Entrada/Saída)' },
  { value: 'causa_morte', label: 'Causa Morte' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'comprador', label: 'Comprador/Destino' },
  { value: 'area', label: 'Área' },
  { value: 'nota_fiscal', label: 'Nota Fiscal' },
  { value: 'gta', label: 'GTA' },
  { value: 'categoria_nova', label: 'Categoria Nova' },
  { value: 'transferencia_origem', label: 'Transferência Origem' },
  { value: 'transferencia_destino', label: 'Transferência Destino' },
];

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_mov_pecuaria');
    if (saved) {
      try { return JSON.parse(saved); } catch { }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [marcasSelecionadas, setMarcasSelecionadas] = useState([]);
  const [motivosSelecionados, setMotivosSelecionados] = useState([]);
  const [setoresSelecionados, setSetoresSelecionados] = useState([]);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['movimentacoes-pecuaria-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaSelecionadaId && !m.lote_id);
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

  const tiposUnicos = ['Entrada', 'Saída'];
  const categoriasUnicas = [...new Set(movimentacoes.map(m => m.categoria_animal))].filter(Boolean).sort();
  const marcasUnicas = [...new Set(movimentacoes.map(m => m.marca))].filter(Boolean).sort();
  const motivosUnicos = [...new Set(movimentacoes.map(m => m.motivo))].filter(Boolean).sort();
  const setoresUnicos = [...new Set(movimentacoes.map(m => m.setor_nome))].filter(Boolean).sort();

  const formatarData = (dataString) => {
    if (!dataString) return '--/--/----';
    try {
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '--/--/----';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch { return '--/--/----'; }
  };

  const movimentacoesFiltradas = useMemo(() => {
    let filtered = movimentacoes.filter(m => {
      if (dataInicio && m.data_movimentacao) {
        const mDate = new Date(m.data_movimentacao);
        const iDate = new Date(dataInicio);
        iDate.setHours(0, 0, 0, 0);
        if (mDate < iDate) return false;
      }
      if (dataFim && m.data_movimentacao) {
        const mDate = new Date(m.data_movimentacao);
        const fDate = new Date(dataFim);
        fDate.setHours(23, 59, 59, 999);
        if (mDate > fDate) return false;
      }
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(m.tipo)) return false;
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(m.categoria_animal)) return false;
      if (marcasSelecionadas.length > 0 && !marcasSelecionadas.includes(m.marca)) return false;
      if (motivosSelecionados.length > 0 && !motivosSelecionados.includes(m.motivo)) return false;
      if (setoresSelecionados.length > 0 && !setoresSelecionados.includes(m.setor_nome)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc': return new Date(b.data_movimentacao || 0) - new Date(a.data_movimentacao || 0);
        case 'data_asc': return new Date(a.data_movimentacao || 0) - new Date(b.data_movimentacao || 0);
        case 'quantidade_desc': return (b.quantidade_animais || 0) - (a.quantidade_animais || 0);
        case 'quantidade_asc': return (a.quantidade_animais || 0) - (b.quantidade_animais || 0);
        case 'categoria_asc': return (a.categoria_animal || '').localeCompare(b.categoria_animal || '');
        case 'marca_asc': return (a.marca || '').localeCompare(b.marca || '');
        default: return 0;
      }
    });

    return filtered;
  }, [movimentacoes, dataInicio, dataFim, tiposSelecionados, categoriasSelecionadas, marcasSelecionadas, motivosSelecionados, setoresSelecionados, ordenacao]);

  const movimentacoesAgrupadas = useMemo(() => {
    if (agrupamentosAtivos.length === 0) {
      return { "Todos os Registros": movimentacoesFiltradas };
    }

    const grupos = {};
    movimentacoesFiltradas.forEach(m => {
      let chaveArray = [];
      agrupamentosAtivos.forEach(tipo => {
        let valor;
        switch (tipo) {
          case "tipo": valor = m.tipo || "Sem tipo"; break;
          case "categoria": valor = m.categoria_animal || "Sem categoria"; break;
          case "marca": valor = m.marca || "Sem marca"; break;
          case "motivo": valor = m.motivo || "Sem motivo"; break;
          case "setor": valor = m.setor_nome || "Sem setor"; break;
          case "sexo": valor = m.sexo || "Sem sexo"; break;
          default: valor = "Sem classificação";
        }
        chaveArray.push(valor);
      });
      const chave = chaveArray.join(" → ");
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push(m);
    });

    return grupos;
  }, [movimentacoesFiltradas, agrupamentosAtivos]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_mov_pecuaria', JSON.stringify(novas));
      return novas;
    });
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const toggleAgrupamento = (tipo) => {
    setAgrupamentosAtivos(prev => prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo]);
  };

  const limparFiltros = () => {
    setDataInicio("");
    setDataFim("");
    setTiposSelecionados([]);
    setCategoriasSelecionadas([]);
    setMarcasSelecionadas([]);
    setMotivosSelecionados([]);
    setSetoresSelecionados([]);
    setAgrupamentosAtivos([]);
    setOrdenacao('data_desc');
    setTipoRelatorio('analitico');
  };

  const totalEntradas = movimentacoesFiltradas.filter(m => m.tipo === 'Entrada').reduce((s, m) => s + (m.quantidade_animais || 0), 0);
  const totalSaidas = movimentacoesFiltradas.filter(m => m.tipo === 'Saída').reduce((s, m) => s + (m.quantidade_animais || 0), 0);
  const saldoPeriodo = totalEntradas - totalSaidas;

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Movimentações Pecuárias</h1>
          <p className="text-xs text-slate-600">Análise e impressão</p>
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros na Tela */}
      <Card className="print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-8 text-xs" />
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
                  <SelectItem value="analitico">Analítico (Detalhado)</SelectItem>
                  <SelectItem value="sintetico">Sintético (Matriz)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipoRelatorio === 'sintetico' && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Linhas (Eixo Y)</Label>
                  <Select value={eixoYSintetico} onValueChange={setEixoYSintetico}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EIXO_Y_OPCOES.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Colunas (Eixo X)</Label>
                  <Select value={eixoXSintetico} onValueChange={setEixoXSintetico}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EIXO_X_OPCOES.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
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

          {tipoRelatorio === 'analitico' && (
            <div className="space-y-1">
              <Label className="text-xs">Agrupar Por</Label>
              <div className="flex flex-wrap gap-1">
                {['tipo', 'categoria', 'marca', 'motivo', 'setor', 'sexo'].map((tipo) => (
                  <Button
                    key={tipo}
                    variant={agrupamentosAtivos.includes(tipo) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleAgrupamento(tipo)}
                    className={`h-7 text-xs ${agrupamentosAtivos.includes(tipo) ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                  >
                    {tipo.charAt(0).toUpperCase() + tipo.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Tipos {tiposSelecionados.length > 0 && `(${tiposSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-48">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Tipos</h4>
                  {tiposUnicos.map(t => (
                    <div key={t} className="flex items-center space-x-2">
                      <Checkbox checked={tiposSelecionados.includes(t)} onCheckedChange={() => toggleFiltro(tiposSelecionados, setTiposSelecionados, t)} />
                      <label className="text-sm cursor-pointer">{t}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

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

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Setores {setoresSelecionados.length > 0 && `(${setoresSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Setores</h4>
                  {setoresUnicos.map(s => (
                    <div key={s} className="flex items-center space-x-2">
                      <Checkbox checked={setoresSelecionados.includes(s)} onCheckedChange={() => toggleFiltro(setoresSelecionados, setSetoresSelecionados, s)} />
                      <label className="text-sm cursor-pointer">{s}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {tipoRelatorio === 'analitico' && (
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
              <h2 className="text-base font-bold">Relatório de Movimentações Pecuárias {tipoRelatorio === 'analitico' ? '(Analítico)' : '(Sintético)'}</h2>
              {(dataInicio || dataFim) && (
                <p className="text-xs text-gray-600">
                  Período: {dataInicio ? formatarData(dataInicio) : "Início"} a {dataFim ? formatarData(dataFim) : "Hoje"}
                </p>
              )}
            </div>
          </div>

          {movimentacoesFiltradas.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>Nenhuma movimentação encontrada com os filtros aplicados.</p>
            </div>
          ) : tipoRelatorio === 'sintetico' ? (
            /* RELATÓRIO SINTÉTICO - MATRIZ DINÂMICA */
            (() => {
              // Função para obter valor do eixo - retorna null se não aplicável
              const getValorEixo = (m, eixo) => {
                switch (eixo) {
                  case 'categoria': return m.categoria_animal || null;
                  case 'setor': return m.setor_nome || null;
                  case 'marca': return m.marca || null;
                  case 'motivo': return m.motivo || null;
                  case 'sexo': return m.sexo || null;
                  case 'tipo': return m.tipo || null;
                  case 'causa_morte': 
                    if (m.motivo !== 'Morte') return null;
                    return m.causa_morte || 'Não Informada';
                  case 'fornecedor': 
                    if (m.motivo !== 'Compra') return null;
                    return m.fornecedor_origem || 'Não Informado';
                  case 'comprador': 
                    if (m.motivo !== 'Venda' && m.motivo !== 'Abate') return null;
                    return m.destino_venda || 'Não Informado';
                  case 'area': return (m.tipo === 'Entrada' ? m.area_destino_nome : m.area_origem_nome) || null;
                  case 'nota_fiscal': return m.nota_fiscal || null;
                  case 'gta': return m.gta || null;
                  case 'categoria_nova': 
                    if (m.motivo !== 'Mudança de Categoria') return null;
                    return m.categoria_nova || 'Não Informada';
                  case 'transferencia_origem': 
                    if (m.motivo !== 'Transferência entre Setores' && m.motivo !== 'Mudança de Categoria') return null;
                    return m.transferencia_origem || 'Não Informada';
                  case 'transferencia_destino': 
                    if (m.motivo !== 'Transferência entre Setores' && m.motivo !== 'Mudança de Categoria') return null;
                    return m.transferencia_destino || 'Não Informada';
                  default: return null;
                }
              };

              // Filtrar movimentações válidas
              const movimentacoesValidas = movimentacoesFiltradas.filter(m => {
                const linha = getValorEixo(m, eixoYSintetico);
                const col = getValorEixo(m, eixoXSintetico);
                return linha !== null && col !== null;
              });

              const linhasYValidas = [...new Set(movimentacoesValidas.map(m => getValorEixo(m, eixoYSintetico)))].filter(Boolean).sort();
              const colunasXValidas = [...new Set(movimentacoesValidas.map(m => getValorEixo(m, eixoXSintetico)))].filter(Boolean).sort();

              // Inicializar matriz
              const matrizFinal = {};
              const totaisLinhaFinal = {};
              const totaisColunaFinal = { entradas: {}, saidas: {}, saldo: {} };

              linhasYValidas.forEach(linha => {
                matrizFinal[linha] = {};
                totaisLinhaFinal[linha] = { entradas: 0, saidas: 0, saldo: 0 };
                colunasXValidas.forEach(col => {
                  matrizFinal[linha][col] = { entradas: 0, saidas: 0, saldo: 0 };
                });
              });
              colunasXValidas.forEach(col => {
                totaisColunaFinal.entradas[col] = 0;
                totaisColunaFinal.saidas[col] = 0;
                totaisColunaFinal.saldo[col] = 0;
              });

              movimentacoesValidas.forEach(m => {
                const linha = getValorEixo(m, eixoYSintetico);
                const col = getValorEixo(m, eixoXSintetico);
                const qtd = m.quantidade_animais || 0;

                if (matrizFinal[linha] && matrizFinal[linha][col]) {
                  if (m.tipo === 'Entrada') {
                    matrizFinal[linha][col].entradas += qtd;
                    totaisColunaFinal.entradas[col] = (totaisColunaFinal.entradas[col] || 0) + qtd;
                    totaisLinhaFinal[linha].entradas += qtd;
                  } else if (m.tipo === 'Saída') {
                    matrizFinal[linha][col].saidas += qtd;
                    totaisColunaFinal.saidas[col] = (totaisColunaFinal.saidas[col] || 0) + qtd;
                    totaisLinhaFinal[linha].saidas += qtd;
                  }
                }
              });

              // Calcular saldos
              linhasYValidas.forEach(linha => {
                totaisLinhaFinal[linha].saldo = totaisLinhaFinal[linha].entradas - totaisLinhaFinal[linha].saidas;
                colunasXValidas.forEach(col => {
                  matrizFinal[linha][col].saldo = matrizFinal[linha][col].entradas - matrizFinal[linha][col].saidas;
                });
              });
              colunasXValidas.forEach(col => {
                totaisColunaFinal.saldo[col] = (totaisColunaFinal.entradas[col] || 0) - (totaisColunaFinal.saidas[col] || 0);
              });

              const totalGeral = {
                entradas: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.entradas, 0),
                saidas: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.saidas, 0),
                saldo: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.saldo, 0),
              };

              const eixoYLabel = EIXO_Y_OPCOES.find(o => o.value === eixoYSintetico)?.label || 'Linha';
              const eixoXLabel = EIXO_X_OPCOES.find(o => o.value === eixoXSintetico)?.label || 'Coluna';

              if (linhasYValidas.length === 0 || colunasXValidas.length === 0) {
                return (
                  <div className="text-center py-8 text-slate-500">
                    <p>Nenhum dado encontrado para os eixos selecionados.</p>
                    <p className="text-xs mt-1">Tente selecionar outras opções de Linhas/Colunas.</p>
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="border border-black text-xs font-bold py-1 min-w-[140px]">
                          {eixoYLabel}
                        </TableHead>
                        {colunasXValidas.map(col => (
                          <TableHead key={col} className="border border-black text-xs font-bold text-center py-1 min-w-[80px] whitespace-nowrap">
                            {col}
                          </TableHead>
                        ))}
                        <TableHead className="border border-black text-xs font-bold text-center py-1 min-w-[70px] bg-green-50">
                          Entradas
                        </TableHead>
                        <TableHead className="border border-black text-xs font-bold text-center py-1 min-w-[70px] bg-red-50">
                          Saídas
                        </TableHead>
                        <TableHead className="border border-black text-xs font-bold text-center py-1 min-w-[70px] bg-yellow-50">
                          Saldo
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhasYValidas.map((linha, idx) => (
                        <TableRow key={linha} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                          <TableCell className="border border-gray-300 text-xs font-semibold py-1">
                            {linha}
                          </TableCell>
                          {colunasXValidas.map(col => {
                            const celula = matrizFinal[linha][col];
                            const valor = celula.saldo;
                            return (
                              <TableCell 
                                key={col} 
                                className={`border border-gray-300 text-xs text-center py-1 font-mono ${valor < 0 ? 'text-red-600' : ''}`}
                              >
                                {valor !== 0 ? formatarNumero(valor) : ''}
                              </TableCell>
                            );
                          })}
                          <TableCell className="border border-black text-xs text-center font-mono py-1 bg-green-50 text-green-700">
                            {totaisLinhaFinal[linha].entradas > 0 ? formatarNumero(totaisLinhaFinal[linha].entradas) : ''}
                          </TableCell>
                          <TableCell className="border border-black text-xs text-center font-mono py-1 bg-red-50 text-red-700">
                            {totaisLinhaFinal[linha].saidas > 0 ? formatarNumero(totaisLinhaFinal[linha].saidas) : ''}
                          </TableCell>
                          <TableCell className="border border-black text-xs text-center font-mono font-bold py-1 bg-yellow-50">
                            {formatarNumero(totaisLinhaFinal[linha].saldo)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Linha de Total */}
                      <TableRow className="font-bold bg-emerald-50">
                        <TableCell className="border border-black text-xs font-bold py-1">
                          TOTAL
                        </TableCell>
                        {colunasXValidas.map(col => (
                          <TableCell key={col} className={`border border-black text-xs text-center font-mono font-bold py-1 ${totaisColunaFinal.saldo[col] < 0 ? 'text-red-600' : ''}`}>
                            {totaisColunaFinal.saldo[col] !== 0 ? formatarNumero(totaisColunaFinal.saldo[col]) : ''}
                          </TableCell>
                        ))}
                        <TableCell className="border border-black text-xs text-center font-mono font-bold py-1 bg-green-100 text-green-800">
                          {formatarNumero(totalGeral.entradas)}
                        </TableCell>
                        <TableCell className="border border-black text-xs text-center font-mono font-bold py-1 bg-red-100 text-red-800">
                          {formatarNumero(totalGeral.saidas)}
                        </TableCell>
                        <TableCell className="border border-black text-xs text-center font-mono font-bold py-1 bg-yellow-100 text-yellow-900">
                          {formatarNumero(totalGeral.saldo)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              );
            })()
          ) : (
            <>
              {Object.entries(movimentacoesAgrupadas).map(([grupo, registros], idx) => {
                const totalGrupoEnt = registros.filter(r => r.tipo === 'Entrada').reduce((s, r) => s + (r.quantidade_animais || 0), 0);
                const totalGrupoSai = registros.filter(r => r.tipo === 'Saída').reduce((s, r) => s + (r.quantidade_animais || 0), 0);
                const saldoGrupo = totalGrupoEnt - totalGrupoSai;

                return (
                  <div key={idx} className="mb-4">
                    {agrupamentosAtivos.length > 0 && (
                      <div className="bg-gray-200 px-2 py-1 mb-1">
                        <h3 className="font-bold text-xs">{grupo}</h3>
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
                            {colunasVisiveis.includes('marca') && <TableHead className="border border-black text-xs font-bold py-1">Marca</TableHead>}
                            {colunasVisiveis.includes('categoria_nova') && <TableHead className="border border-black text-xs font-bold py-1">Cat.Nova</TableHead>}
                            {colunasVisiveis.includes('sexo') && <TableHead className="border border-black text-xs font-bold py-1">Sexo</TableHead>}
                            {colunasVisiveis.includes('setor') && <TableHead className="border border-black text-xs font-bold py-1">Setor</TableHead>}
                            {colunasVisiveis.includes('area') && <TableHead className="border border-black text-xs font-bold py-1">Área</TableHead>}
                            {colunasVisiveis.includes('peso_medio') && <TableHead className="border border-black text-xs font-bold text-right py-1">P.Médio</TableHead>}
                            {colunasVisiveis.includes('peso_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">P.Total</TableHead>}
                            {colunasVisiveis.includes('valor_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr.Unit</TableHead>}
                            {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Vlr.Total</TableHead>}
                            {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Fornec.</TableHead>}
                            {colunasVisiveis.includes('comprador') && <TableHead className="border border-black text-xs font-bold py-1">Comprador</TableHead>}
                            {colunasVisiveis.includes('nota_fiscal') && <TableHead className="border border-black text-xs font-bold py-1">NF</TableHead>}
                            {colunasVisiveis.includes('gta') && <TableHead className="border border-black text-xs font-bold py-1">GTA</TableHead>}
                            {colunasVisiveis.includes('causa_morte') && <TableHead className="border border-black text-xs font-bold py-1">Causa Morte</TableHead>}
                            {colunasVisiveis.includes('transferencia_origem') && <TableHead className="border border-black text-xs font-bold py-1">Transf.Orig</TableHead>}
                            {colunasVisiveis.includes('transferencia_destino') && <TableHead className="border border-black text-xs font-bold py-1">Transf.Dest</TableHead>}
                            {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Obs</TableHead>}
                            {colunasVisiveis.includes('responsavel') && <TableHead className="border border-black text-xs font-bold py-1">Resp.</TableHead>}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {registros.map((m) => {
                            const areaExibir = m.tipo === 'Entrada' ? m.area_destino_nome : m.area_origem_nome;
                            return (
                              <TableRow key={m.id}>
                                {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(m.data_movimentacao)}</TableCell>}
                                {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs py-1">{m.tipo}</TableCell>}
                                {colunasVisiveis.includes('motivo') && <TableCell className="border border-gray-300 text-xs py-1">{m.motivo || ''}</TableCell>}
                                {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.quantidade_animais}</TableCell>}
                                {colunasVisiveis.includes('categoria') && <TableCell className="border border-gray-300 text-xs py-1">{m.categoria_animal || ''}</TableCell>}
                                {colunasVisiveis.includes('marca') && <TableCell className="border border-gray-300 text-xs py-1">{m.marca || ''}</TableCell>}
                                {colunasVisiveis.includes('categoria_nova') && <TableCell className="border border-gray-300 text-xs py-1">{m.categoria_nova || ''}</TableCell>}
                                {colunasVisiveis.includes('sexo') && <TableCell className="border border-gray-300 text-xs py-1">{m.sexo || ''}</TableCell>}
                                {colunasVisiveis.includes('setor') && <TableCell className="border border-gray-300 text-xs py-1">{m.setor_nome || ''}</TableCell>}
                                {colunasVisiveis.includes('area') && <TableCell className="border border-gray-300 text-xs py-1">{areaExibir || ''}</TableCell>}
                                {colunasVisiveis.includes('peso_medio') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.peso_medio ? `${m.peso_medio} kg` : ''}</TableCell>}
                                {colunasVisiveis.includes('peso_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.peso_total ? `${m.peso_total} kg` : ''}</TableCell>}
                                {colunasVisiveis.includes('valor_unitario') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.valor_unitario ? `R$ ${m.valor_unitario.toFixed(2)}` : ''}</TableCell>}
                                {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{m.valor_total ? `R$ ${m.valor_total.toFixed(2)}` : ''}</TableCell>}
                                {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{m.fornecedor_origem || ''}</TableCell>}
                                {colunasVisiveis.includes('comprador') && <TableCell className="border border-gray-300 text-xs py-1">{m.destino_venda || ''}</TableCell>}
                                {colunasVisiveis.includes('nota_fiscal') && <TableCell className="border border-gray-300 text-xs py-1">{m.nota_fiscal || ''}</TableCell>}
                                {colunasVisiveis.includes('gta') && <TableCell className="border border-gray-300 text-xs py-1">{m.gta || ''}</TableCell>}
                                {colunasVisiveis.includes('causa_morte') && <TableCell className="border border-gray-300 text-xs py-1">{m.causa_morte || ''}</TableCell>}
                                {colunasVisiveis.includes('transferencia_origem') && <TableCell className="border border-gray-300 text-xs py-1">{m.transferencia_origem || ''}</TableCell>}
                                {colunasVisiveis.includes('transferencia_destino') && <TableCell className="border border-gray-300 text-xs py-1">{m.transferencia_destino || ''}</TableCell>}
                                {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1 max-w-[100px] truncate">{m.observacoes || ''}</TableCell>}
                                {colunasVisiveis.includes('responsavel') && <TableCell className="border border-gray-300 text-xs py-1">{m.created_by || ''}</TableCell>}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>

                    <Table className="mt-1">
                      <TableBody>
                        <TableRow className="bg-gray-100 font-bold">
                          <TableCell colSpan={20} className="border border-black text-xs py-1">
                            Subtotal: {registros.length} registros | Entradas: {formatarNumero(totalGrupoEnt)} | Saídas: {formatarNumero(totalGrupoSai)} | Saldo: {formatarNumero(saldoGrupo)} cab
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                );
              })}

              {/* Total Geral */}
              <div className="mt-4 border-t-2 border-black pt-2">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-bold">TOTAL GERAL: {movimentacoesFiltradas.length} registros | Entradas: {formatarNumero(totalEntradas)} | Saídas: {formatarNumero(totalSaidas)} | Saldo: {formatarNumero(saldoPeriodo)} cab</div>
                </div>
              </div>

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
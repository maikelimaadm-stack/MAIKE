import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
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
import { getLocalEstoque as getLocalEstoqueUtil, getLabelOperacao } from "../components/movimentacoes/utils/movimentacaoUtils";
import { ehEntradaReal, ehSaidaReal } from "@/services/estoqueService";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "";
  return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const COLUNAS_DISPONIVEIS = [
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'operacao', label: 'Operação', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'codigo', label: 'Código', default: false },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'unidade', label: 'UN', default: true },
  { id: 'custo_unitario', label: 'Custo Unit.', default: true },
  { id: 'valor_total', label: 'Valor Total', default: true },
  { id: 'local_estoque', label: 'Local Estoque', default: true },
  { id: 'fornecedor', label: 'Fornecedor', default: false },
  { id: 'cliente', label: 'Cliente/Destino', default: false },
  { id: 'documento', label: 'Documento', default: false },
  { id: 'centro_custo', label: 'Centro Custo', default: false },
  { id: 'tipo_vinculo', label: 'Tipo Vínculo', default: false },
  { id: 'vinculo', label: 'Vínculo', default: true },
  { id: 'motivo', label: 'Motivo', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
  { id: 'responsavel', label: 'Responsável', default: false },
];

const EIXO_X_OPCOES = [
  { value: 'local_estoque', label: 'Local de Estoque' },
  { value: 'categoria', label: 'Categoria' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'cliente', label: 'Cliente/Destino' },
  { value: 'tipo_vinculo', label: 'Tipo Vínculo' },
  { value: 'vinculo', label: 'Vínculo (Lote/Área/Máquina)' },
  { value: 'centro_custo', label: 'Centro de Custo' },
  { value: 'operacao', label: 'Operação' },
  { value: 'documento', label: 'Documento' },
];

const EIXO_Y_OPCOES = [
  { value: 'produto', label: 'Produto' },
  { value: 'categoria', label: 'Categoria' },
  { value: 'local_estoque', label: 'Local de Estoque' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'cliente', label: 'Cliente/Destino' },
  { value: 'tipo_vinculo', label: 'Tipo Vínculo' },
  { value: 'vinculo', label: 'Vínculo (Lote/Área/Máquina)' },
  { value: 'centro_custo', label: 'Centro de Custo' },
  { value: 'operacao', label: 'Operação' },
];

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antiga)' },
  { value: 'valor_desc', label: 'Valor Total (Maior)' },
  { value: 'valor_asc', label: 'Valor Total (Menor)' },
  { value: 'quantidade_desc', label: 'Quantidade (Maior)' },
  { value: 'quantidade_asc', label: 'Quantidade (Menor)' },
  { value: 'produto_asc', label: 'Produto (A-Z)' },
];

export default function RelatorioEstoque() {
  const [tipoRelatorio, setTipoRelatorio] = useState("analitico");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [orientacao, setOrientacao] = useState("paisagem");
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [ordenacao, setOrdenacao] = useState('data_desc');
  const [eixosXSintetico, setEixosXSintetico] = useState(['local_estoque']);
  const [eixosYSintetico, setEixosYSintetico] = useState(['produto']);
  const [mostrarDetalhes, setMostrarDetalhes] = useState(false);

  const toggleEixoX = (valor) => {
    setEixosXSintetico(prev => 
      prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]
    );
  };

  const toggleEixoY = (valor) => {
    setEixosYSintetico(prev => 
      prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]
    );
  };

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_estoque_v2');
    if (saved) {
      try { return JSON.parse(saved); } catch { }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  // Filtros
  const [tiposSelecionados, setTiposSelecionados] = useState([]);
  const [operacoesSelecionadas, setOperacoesSelecionadas] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [locaisSelecionados, setLocaisSelecionados] = useState([]);
  const [fornecedoresSelecionados, setFornecedoresSelecionados] = useState([]);
  const [clientesSelecionados, setClientesSelecionados] = useState([]);
  const [centrosCustoSelecionados, setCentrosCustoSelecionados] = useState([]);
  const [tiposVinculoSelecionados, setTiposVinculoSelecionados] = useState([]);
  const [vinculosSelecionados, setVinculosSelecionados] = useState([]);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  // Queries
  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['movimentacoes-estoque-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoEstoque.list('-data_movimentacao');
      return all.filter(m => m.empresa_id === empresaSelecionadaId && m.status === 'Ativa');
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Produto.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: locais = [] } = useQuery({
    queryKey: ['locais-relatorio'],
    queryFn: () => base44.entities.LocalEstoque.list(),
  });
  const nomeLocal = (id) => locais.find(l => l.id === id)?.nome || id;

  const { data: empresaAtual } = useQuery({
    queryKey: ['empresa-atual-relatorio', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return null;
      const empresas = await base44.entities.Empresa.list();
      return empresas.find(e => e.id === empresaSelecionadaId) || null;
    },
    enabled: !!empresaSelecionadaId,
  });

  // Extrair valores únicos para filtros
  const tiposUnicos = ['Entrada', 'Saída', 'Transferência', 'Ajuste'];
  const operacoesUnicas = [...new Set(movimentacoes.map(m => m.tipo_detalhado))].filter(Boolean).sort();
  const produtosUnicos = [...new Set(movimentacoes.map(m => m.produto_nome))].filter(Boolean).sort();
  const categoriasUnicas = [...new Set(movimentacoes.map(m => m.produto_categoria))].filter(Boolean).sort();
  const locaisUnicos = [...new Set(movimentacoes.map(m => m.local_estoque_origem || m.local_estoque_destino))].filter(Boolean).sort();
  const fornecedoresUnicos = [...new Set(movimentacoes.map(m => m.fornecedor_nome))].filter(Boolean).sort();
  const clientesUnicos = [...new Set(movimentacoes.map(m => m.cliente_nome))].filter(Boolean).sort();
  const centrosCustoUnicos = [...new Set(movimentacoes.map(m => m.centro_custo_nome))].filter(Boolean).sort();
  const tiposVinculoUnicos = [...new Set(movimentacoes.map(m => m.tipo_vinculo))].filter(Boolean).sort();
  
  // Extrair vínculos (lote, área, máquina)
  const vinculosUnicos = [...new Set(movimentacoes.map(m => 
    m.lote_vinculado_nome || m.area_vinculada_nome || m.maquina_vinculada_nome
  ))].filter(Boolean).sort();

  const formatarData = (dataString) => {
    if (!dataString) return '--/--/----';
    try {
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '--/--/----';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch { return '--/--/----'; }
  };

  // Função para obter o vínculo de uma movimentação
  const getVinculo = (m) => {
    return m.lote_vinculado_nome || m.area_vinculada_nome || m.maquina_vinculada_nome || '';
  };

  // Função para obter o local de estoque usando utilitário centralizado
  const getLocalEstoque = (m) => {
    return getLocalEstoqueUtil(m);
  };

  // Movimentações filtradas
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
      if (tiposSelecionados.length > 0 && !tiposSelecionados.includes(m.tipo_movimentacao)) return false;
      if (operacoesSelecionadas.length > 0 && !operacoesSelecionadas.includes(m.tipo_detalhado)) return false;
      if (produtosSelecionados.length > 0 && !produtosSelecionados.includes(m.produto_nome)) return false;
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(m.produto_categoria)) return false;
      if (locaisSelecionados.length > 0) {
        const lids = [];
        if (m.tipo_movimentacao === 'Entrada') lids.push(m.local_estoque_destino);
        else if (m.tipo_movimentacao === 'Saída') lids.push(m.local_estoque_origem);
        else if (m.tipo_movimentacao === 'Transferência') lids.push(m.local_estoque_origem, m.local_estoque_destino);
        else {
          const tipoSlug = String(m.tipo_detalhado || '').toLowerCase();
          const isPos = tipoSlug.includes('ajuste_positivo');
          lids.push(isPos ? m.local_estoque_destino : m.local_estoque_origem);
        }
        if (!lids.some(l => l && locaisSelecionados.includes(l))) return false;
      }
      if (fornecedoresSelecionados.length > 0 && !fornecedoresSelecionados.includes(m.fornecedor_nome)) return false;
      if (clientesSelecionados.length > 0) {
        const cliente = m.cliente_nome;
        if (!clientesSelecionados.includes(cliente)) return false;
      }
      if (centrosCustoSelecionados.length > 0 && !centrosCustoSelecionados.includes(m.centro_custo_nome)) return false;
      if (tiposVinculoSelecionados.length > 0 && !tiposVinculoSelecionados.includes(m.tipo_vinculo)) return false;
      if (vinculosSelecionados.length > 0) {
        const vinculo = getVinculo(m);
        if (!vinculosSelecionados.includes(vinculo)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_desc': return new Date(b.data_movimentacao || 0) - new Date(a.data_movimentacao || 0);
        case 'data_asc': return new Date(a.data_movimentacao || 0) - new Date(b.data_movimentacao || 0);
        case 'valor_desc': return (b.valor_total || 0) - (a.valor_total || 0);
        case 'valor_asc': return (a.valor_total || 0) - (b.valor_total || 0);
        case 'quantidade_desc': return (b.quantidade || 0) - (a.quantidade || 0);
        case 'quantidade_asc': return (a.quantidade || 0) - (b.quantidade || 0);
        case 'produto_asc': return (a.produto_nome || '').localeCompare(b.produto_nome || '');
        default: return 0;
      }
    });

    return filtered;
  }, [movimentacoes, dataInicio, dataFim, tiposSelecionados, operacoesSelecionadas, produtosSelecionados, 
      categoriasSelecionadas, locaisSelecionados, fornecedoresSelecionados, clientesSelecionados,
      centrosCustoSelecionados, tiposVinculoSelecionados, vinculosSelecionados, ordenacao]);

  // Agrupamento para relatório analítico
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
          case "tipo": valor = m.tipo_movimentacao || "Sem tipo"; break;
          case "operacao": valor = m.tipo_detalhado || "Sem operação"; break;
          case "produto": valor = m.produto_nome || "Sem produto"; break;
          case "categoria": valor = m.produto_categoria || "Sem categoria"; break;
          case "local": valor = getLocalEstoque(m) || "Sem local"; break;
          case "fornecedor": valor = m.fornecedor_nome || "Sem fornecedor"; break;
          case "cliente": valor = m.cliente_nome || "Sem cliente"; break;
          case "centro_custo": valor = m.centro_custo_nome || "Sem centro de custo"; break;
          case "tipo_vinculo": valor = m.tipo_vinculo || "Sem vínculo"; break;
          case "vinculo": valor = getVinculo(m) || "Sem vínculo"; break;
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
      localStorage.setItem('colunas_relatorio_estoque_v2', JSON.stringify(novas));
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
    setOperacoesSelecionadas([]);
    setProdutosSelecionados([]);
    setCategoriasSelecionadas([]);
    setLocaisSelecionados([]);
    setFornecedoresSelecionados([]);
    setClientesSelecionados([]);
    setCentrosCustoSelecionados([]);
    setTiposVinculoSelecionados([]);
    setVinculosSelecionados([]);
    setAgrupamentosAtivos([]);
    setOrdenacao('data_desc');
    setTipoRelatorio('analitico');
    setEixosXSintetico(['local_estoque']);
    setEixosYSintetico(['produto']);
    setMostrarDetalhes(false);
  };

  // Totais — usa a classificação central (corrige "Ajuste Positivo" contado como
  // saída e evita contar em dobro as pernas de transferência interna).
  const isEntrada = ehEntradaReal;
  const isSaida = ehSaidaReal;
  const totalEntradas = movimentacoesFiltradas.filter(isEntrada).reduce((s, m) => s + (m.quantidade || 0), 0);
  const totalSaidas = movimentacoesFiltradas.filter(isSaida).reduce((s, m) => s + (m.quantidade || 0), 0);
  const valorTotalEntradas = movimentacoesFiltradas.filter(isEntrada).reduce((s, m) => s + (m.valor_total || 0), 0);
  const valorTotalSaidas = movimentacoesFiltradas.filter(isSaida).reduce((s, m) => s + (m.valor_total || 0), 0);
  const saldoQuantidade = totalEntradas - totalSaidas;
  const saldoValor = valorTotalEntradas - valorTotalSaidas;

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Movimentações de Estoque</h1>
          <p className="text-xs text-slate-600">Análise por vínculos, custos e valores</p>
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros */}
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
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs w-full justify-start">
                        {eixosYSintetico.length > 0 ? `${eixosYSintetico.length} selecionado(s)` : 'Selecionar'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 max-h-80 overflow-auto">
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm mb-2">Eixos Y (Linhas)</h4>
                        {EIXO_Y_OPCOES.map(opt => (
                          <div key={opt.value} className="flex items-center space-x-2">
                            <Checkbox checked={eixosYSintetico.includes(opt.value)} onCheckedChange={() => toggleEixoY(opt.value)} />
                            <label className="text-sm cursor-pointer">{opt.label}</label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Colunas (Eixo X)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs w-full justify-start">
                        {eixosXSintetico.length > 0 ? `${eixosXSintetico.length} selecionado(s)` : 'Selecionar'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 max-h-80 overflow-auto">
                      <div className="space-y-2">
                        <h4 className="font-semibold text-sm mb-2">Eixos X (Colunas)</h4>
                        {EIXO_X_OPCOES.map(opt => (
                          <div key={opt.value} className="flex items-center space-x-2">
                            <Checkbox checked={eixosXSintetico.includes(opt.value)} onCheckedChange={() => toggleEixoX(opt.value)} />
                            <label className="text-sm cursor-pointer">{opt.label}</label>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
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

          {tipoRelatorio === 'sintetico' && (
            <div className="flex items-center space-x-2">
              <Checkbox id="mostrarDetalhes" checked={mostrarDetalhes} onCheckedChange={setMostrarDetalhes} />
              <label htmlFor="mostrarDetalhes" className="text-xs cursor-pointer">Mostrar E/S/Saldo nas células</label>
            </div>
          )}

          {tipoRelatorio === 'analitico' && (
            <div className="space-y-1">
              <Label className="text-xs">Agrupar Por</Label>
              <div className="flex flex-wrap gap-1">
                {['tipo', 'operacao', 'produto', 'categoria', 'local', 'fornecedor', 'cliente', 'centro_custo', 'tipo_vinculo', 'vinculo'].map((tipo) => (
                  <Button
                    key={tipo}
                    variant={agrupamentosAtivos.includes(tipo) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleAgrupamento(tipo)}
                    className={`h-7 text-xs ${agrupamentosAtivos.includes(tipo) ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
                  >
                    {tipo.charAt(0).toUpperCase() + tipo.slice(1).replace('_', ' ')}
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
                <Button variant="outline" size="sm" className="h-8 text-xs">Operações {operacoesSelecionadas.length > 0 && `(${operacoesSelecionadas.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Operações</h4>
                  {operacoesUnicas.map(o => (
                    <div key={o} className="flex items-center space-x-2">
                      <Checkbox checked={operacoesSelecionadas.includes(o)} onCheckedChange={() => toggleFiltro(operacoesSelecionadas, setOperacoesSelecionadas, o)} />
                      <label className="text-sm cursor-pointer">{o}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Produtos {produtosSelecionados.length > 0 && `(${produtosSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Produtos</h4>
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
                <Button variant="outline" size="sm" className="h-8 text-xs">Locais {locaisSelecionados.length > 0 && `(${locaisSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Locais de Estoque</h4>
                  {locaisUnicos.map(l => (
                    <div key={l} className="flex items-center space-x-2">
                      <Checkbox checked={locaisSelecionados.includes(l)} onCheckedChange={() => toggleFiltro(locaisSelecionados, setLocaisSelecionados, l)} />
                      <label className="text-sm cursor-pointer">{nomeLocal(l)}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Vínculos {vinculosSelecionados.length > 0 && `(${vinculosSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Vínculos (Lote/Área/Máquina)</h4>
                  {vinculosUnicos.map(v => (
                    <div key={v} className="flex items-center space-x-2">
                      <Checkbox checked={vinculosSelecionados.includes(v)} onCheckedChange={() => toggleFiltro(vinculosSelecionados, setVinculosSelecionados, v)} />
                      <label className="text-sm cursor-pointer">{v}</label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">Centros Custo {centrosCustoSelecionados.length > 0 && `(${centrosCustoSelecionados.length})`}</Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 max-h-96 overflow-auto">
                <div className="space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Centros de Custo</h4>
                  {centrosCustoUnicos.map(c => (
                    <div key={c} className="flex items-center space-x-2">
                      <Checkbox checked={centrosCustoSelecionados.includes(c)} onCheckedChange={() => toggleFiltro(centrosCustoSelecionados, setCentrosCustoSelecionados, c)} />
                      <label className="text-sm cursor-pointer">{c}</label>
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
              <h2 className="text-base font-bold">Relatório de Movimentações de Estoque {tipoRelatorio === 'analitico' ? '(Analítico)' : '(Sintético)'}</h2>
              {(dataInicio || dataFim) && (
                <p className="text-xs text-gray-600">
                  Período: {dataInicio ? formatarData(dataInicio) : "Início"} a {dataFim ? formatarData(dataFim) : "Hoje"}
                </p>
              )}
              <p className="text-xs text-gray-600">
                {movimentacoesFiltradas.length} registros | Entradas: {formatarNumero(totalEntradas)} ({formatarMoeda(valorTotalEntradas)}) | Saídas: {formatarNumero(totalSaidas)} ({formatarMoeda(valorTotalSaidas)}) | Saldo: {formatarNumero(saldoQuantidade)} ({formatarMoeda(saldoValor)})
              </p>
            </div>
          </div>

          {movimentacoesFiltradas.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>Nenhuma movimentação encontrada com os filtros aplicados.</p>
            </div>
          ) : tipoRelatorio === 'sintetico' ? (
            /* RELATÓRIO SINTÉTICO - MATRIZ DINÂMICA */
            (() => {
              const getValorEixo = (m, eixo) => {
                switch (eixo) {
                  case 'produto': return m.produto_nome || null;
                  case 'categoria': return m.produto_categoria || null;
                  case 'local_estoque': return getLocalEstoque(m) || null;
                  case 'fornecedor': return m.fornecedor_nome || null;
                  case 'cliente': return m.cliente_nome || null;
                  case 'tipo_vinculo': return m.tipo_vinculo || null;
                  case 'vinculo': return getVinculo(m) || null;
                  case 'centro_custo': return m.centro_custo_nome || null;
                  case 'operacao': return m.tipo_detalhado || null;
                  case 'documento': return m.numero_documento || null;
                  default: return null;
                }
              };

              const getChaveComposta = (m, eixos) => {
                const valores = eixos.map(eixo => getValorEixo(m, eixo)).filter(v => v !== null);
                if (valores.length !== eixos.length) return null;
                return valores.join(' | ');
              };

              const movimentacoesValidas = movimentacoesFiltradas.filter(m => {
                const linhaKey = getChaveComposta(m, eixosYSintetico);
                const colunaKey = getChaveComposta(m, eixosXSintetico);
                return linhaKey !== null && colunaKey !== null;
              });

              const linhasYValidas = [...new Set(movimentacoesValidas.map(m => getChaveComposta(m, eixosYSintetico)))].filter(Boolean).sort();
              const colunasXValidas = [...new Set(movimentacoesValidas.map(m => getChaveComposta(m, eixosXSintetico)))].filter(Boolean).sort();

              const matrizFinal = {};
              const totaisLinhaFinal = {};
              const totaisColunaFinal = { entradas: {}, saidas: {}, saldo: {}, valorEntradas: {}, valorSaidas: {}, valorSaldo: {} };

              linhasYValidas.forEach(linha => {
                matrizFinal[linha] = {};
                totaisLinhaFinal[linha] = { entradas: 0, saidas: 0, saldo: 0, valorEntradas: 0, valorSaidas: 0, valorSaldo: 0 };
                colunasXValidas.forEach(col => {
                  matrizFinal[linha][col] = { entradas: 0, saidas: 0, saldo: 0, valorEntradas: 0, valorSaidas: 0, valorSaldo: 0 };
                });
              });
              colunasXValidas.forEach(col => {
                totaisColunaFinal.entradas[col] = 0;
                totaisColunaFinal.saidas[col] = 0;
                totaisColunaFinal.saldo[col] = 0;
                totaisColunaFinal.valorEntradas[col] = 0;
                totaisColunaFinal.valorSaidas[col] = 0;
                totaisColunaFinal.valorSaldo[col] = 0;
              });

              movimentacoesValidas.forEach(m => {
                const linha = getChaveComposta(m, eixosYSintetico);
                const col = getChaveComposta(m, eixosXSintetico);
                const qtd = m.quantidade || 0;
                const valor = m.valor_total || 0;

                if (matrizFinal[linha] && matrizFinal[linha][col]) {
                  const tipoSlug = String(m.tipo_detalhado || '').toLowerCase();
                  if (m.tipo_movimentacao === 'Entrada' || (m.tipo_movimentacao === 'Ajuste' && tipoSlug.includes('ajuste_positivo'))) {
                    matrizFinal[linha][col].entradas += qtd;
                    matrizFinal[linha][col].valorEntradas += valor;
                    totaisColunaFinal.entradas[col] += qtd;
                    totaisColunaFinal.valorEntradas[col] += valor;
                    totaisLinhaFinal[linha].entradas += qtd;
                    totaisLinhaFinal[linha].valorEntradas += valor;
                  } else if (m.tipo_movimentacao === 'Saída' || (m.tipo_movimentacao === 'Ajuste' && !tipoSlug.includes('ajuste_positivo'))) {
                    matrizFinal[linha][col].saidas += qtd;
                    matrizFinal[linha][col].valorSaidas += valor;
                    totaisColunaFinal.saidas[col] += qtd;
                    totaisColunaFinal.valorSaidas[col] += valor;
                    totaisLinhaFinal[linha].saidas += qtd;
                    totaisLinhaFinal[linha].valorSaidas += valor;
                  }
                }
              });

              linhasYValidas.forEach(linha => {
                totaisLinhaFinal[linha].saldo = totaisLinhaFinal[linha].entradas - totaisLinhaFinal[linha].saidas;
                totaisLinhaFinal[linha].valorSaldo = totaisLinhaFinal[linha].valorEntradas - totaisLinhaFinal[linha].valorSaidas;
                colunasXValidas.forEach(col => {
                  matrizFinal[linha][col].saldo = matrizFinal[linha][col].entradas - matrizFinal[linha][col].saidas;
                  matrizFinal[linha][col].valorSaldo = matrizFinal[linha][col].valorEntradas - matrizFinal[linha][col].valorSaidas;
                });
              });
              colunasXValidas.forEach(col => {
                totaisColunaFinal.saldo[col] = totaisColunaFinal.entradas[col] - totaisColunaFinal.saidas[col];
                totaisColunaFinal.valorSaldo[col] = totaisColunaFinal.valorEntradas[col] - totaisColunaFinal.valorSaidas[col];
              });

              const totalGeral = {
                entradas: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.entradas, 0),
                saidas: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.saidas, 0),
                saldo: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.saldo, 0),
                valorEntradas: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.valorEntradas, 0),
                valorSaidas: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.valorSaidas, 0),
                valorSaldo: Object.values(totaisLinhaFinal).reduce((a, b) => a + b.valorSaldo, 0),
              };

              const eixoYLabels = eixosYSintetico.map(e => EIXO_Y_OPCOES.find(o => o.value === e)?.label || e).join(' + ');
              const eixoXLabels = eixosXSintetico.map(e => EIXO_X_OPCOES.find(o => o.value === e)?.label || e).join(' + ');

              if (linhasYValidas.length === 0 || colunasXValidas.length === 0) {
                return (
                  <div className="text-center py-8 text-slate-500">
                    <p>Nenhum dado encontrado para os eixos selecionados.</p>
                  </div>
                );
              }

              return (
                <div className="overflow-x-auto">
                  <div className="text-xs mb-1">
                    <strong>Linhas:</strong> {eixoYLabels} | <strong>Colunas:</strong> {eixoXLabels}
                  </div>
                  
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="border border-black text-xs font-bold py-1 min-w-[160px]">{eixoYLabels}</TableHead>
                        {colunasXValidas.map(col => (
                          <TableHead key={col} className="border border-black text-xs font-bold text-center py-1 min-w-[100px] whitespace-nowrap">{col}</TableHead>
                        ))}
                        <TableHead className="border border-black text-xs font-bold text-center py-1 min-w-[80px] bg-green-50">Entradas</TableHead>
                        <TableHead className="border border-black text-xs font-bold text-center py-1 min-w-[80px] bg-red-50">Saídas</TableHead>
                        <TableHead className="border border-black text-xs font-bold text-center py-1 min-w-[80px] bg-blue-50">Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linhasYValidas.map((linha) => (
                        <TableRow key={linha}>
                          <TableCell className="border border-gray-300 text-xs py-1 font-medium">{linha}</TableCell>
                          {colunasXValidas.map(col => {
                            const celula = matrizFinal[linha][col];
                            if (mostrarDetalhes) {
                              return (
                                <TableCell key={col} className="border border-gray-300 text-[9px] text-center py-0.5 px-1">
                                  <div className="flex flex-col gap-0">
                                    {celula.entradas > 0 && <span className="text-green-700">+{formatarNumero(celula.entradas)}</span>}
                                    {celula.saidas > 0 && <span className="text-red-700">-{formatarNumero(celula.saidas)}</span>}
                                    {celula.saldo !== 0 && <span className="font-bold border-t border-gray-300">{formatarNumero(celula.saldo)}</span>}
                                    {celula.valorSaldo !== 0 && <span className="text-blue-600 text-[8px]">{formatarMoeda(celula.valorSaldo)}</span>}
                                  </div>
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell key={col} className="border border-gray-300 text-xs text-center py-1">
                                {celula.valorSaldo !== 0 ? formatarMoeda(celula.valorSaldo) : ''}
                              </TableCell>
                            );
                          })}
                          <TableCell className="border border-gray-300 text-xs text-center py-1 bg-green-50">
                            {totaisLinhaFinal[linha].valorEntradas > 0 ? formatarMoeda(totaisLinhaFinal[linha].valorEntradas) : ''}
                          </TableCell>
                          <TableCell className="border border-gray-300 text-xs text-center py-1 bg-red-50">
                            {totaisLinhaFinal[linha].valorSaidas > 0 ? formatarMoeda(totaisLinhaFinal[linha].valorSaidas) : ''}
                          </TableCell>
                          <TableCell className="border border-gray-300 text-xs text-center py-1 font-bold bg-blue-50">
                            {formatarMoeda(totaisLinhaFinal[linha].valorSaldo)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-gray-100">
                        <TableCell className="border border-gray-300 text-xs font-bold py-1">TOTAL</TableCell>
                        {colunasXValidas.map(col => {
                          if (mostrarDetalhes) {
                            return (
                              <TableCell key={col} className="border border-gray-300 text-[9px] text-center font-bold py-0.5 px-1">
                                <div className="flex flex-col gap-0">
                                  {totaisColunaFinal.entradas[col] > 0 && <span className="text-green-700">+{formatarNumero(totaisColunaFinal.entradas[col])}</span>}
                                  {totaisColunaFinal.saidas[col] > 0 && <span className="text-red-700">-{formatarNumero(totaisColunaFinal.saidas[col])}</span>}
                                  {totaisColunaFinal.saldo[col] !== 0 && <span className="border-t border-gray-300">{formatarNumero(totaisColunaFinal.saldo[col])}</span>}
                                  {totaisColunaFinal.valorSaldo[col] !== 0 && <span className="text-blue-600 text-[8px]">{formatarMoeda(totaisColunaFinal.valorSaldo[col])}</span>}
                                </div>
                              </TableCell>
                            );
                          }
                          return (
                            <TableCell key={col} className="border border-gray-300 text-xs text-center font-bold py-1">
                              {totaisColunaFinal.valorSaldo[col] !== 0 ? formatarMoeda(totaisColunaFinal.valorSaldo[col]) : ''}
                            </TableCell>
                          );
                        })}
                        <TableCell className="border border-gray-300 text-xs text-center font-bold py-1 bg-green-100">{formatarMoeda(totalGeral.valorEntradas)}</TableCell>
                        <TableCell className="border border-gray-300 text-xs text-center font-bold py-1 bg-red-100">{formatarMoeda(totalGeral.valorSaidas)}</TableCell>
                        <TableCell className="border border-gray-300 text-xs text-center font-bold py-1 bg-blue-100">{formatarMoeda(totalGeral.valorSaldo)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              );
            })()
          ) : (
            /* RELATÓRIO ANALÍTICO */
            <>
              {Object.entries(movimentacoesAgrupadas).map(([grupo, registros], idx) => {
                const totalGrupoEnt = registros.filter(isEntrada).reduce((s, r) => s + (r.quantidade || 0), 0);
                const totalGrupoSai = registros.filter(isSaida).reduce((s, r) => s + (r.quantidade || 0), 0);
                const valorGrupoEnt = registros.filter(isEntrada).reduce((s, r) => s + (r.valor_total || 0), 0);
                const valorGrupoSai = registros.filter(isSaida).reduce((s, r) => s + (r.valor_total || 0), 0);

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
                          {colunasVisiveis.includes('operacao') && <TableHead className="border border-black text-xs font-bold py-1">Operação</TableHead>}
                          {colunasVisiveis.includes('produto') && <TableHead className="border border-black text-xs font-bold py-1">Produto</TableHead>}
                          {colunasVisiveis.includes('codigo') && <TableHead className="border border-black text-xs font-bold py-1">Código</TableHead>}
                          {colunasVisiveis.includes('quantidade') && <TableHead className="border border-black text-xs font-bold text-right py-1">Qtd</TableHead>}
                          {colunasVisiveis.includes('unidade') && <TableHead className="border border-black text-xs font-bold py-1">UN</TableHead>}
                          {colunasVisiveis.includes('custo_unitario') && <TableHead className="border border-black text-xs font-bold text-right py-1">Custo Unit.</TableHead>}
                          {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Valor Total</TableHead>}
                          {colunasVisiveis.includes('local_estoque') && <TableHead className="border border-black text-xs font-bold py-1">Local</TableHead>}
                          {colunasVisiveis.includes('fornecedor') && <TableHead className="border border-black text-xs font-bold py-1">Fornecedor</TableHead>}
                          {colunasVisiveis.includes('cliente') && <TableHead className="border border-black text-xs font-bold py-1">Cliente</TableHead>}
                          {colunasVisiveis.includes('documento') && <TableHead className="border border-black text-xs font-bold py-1">Documento</TableHead>}
                          {colunasVisiveis.includes('centro_custo') && <TableHead className="border border-black text-xs font-bold py-1">C. Custo</TableHead>}
                          {colunasVisiveis.includes('tipo_vinculo') && <TableHead className="border border-black text-xs font-bold py-1">Tipo Vínc.</TableHead>}
                          {colunasVisiveis.includes('vinculo') && <TableHead className="border border-black text-xs font-bold py-1">Vínculo</TableHead>}
                          {colunasVisiveis.includes('motivo') && <TableHead className="border border-black text-xs font-bold py-1">Motivo</TableHead>}
                          {colunasVisiveis.includes('observacoes') && <TableHead className="border border-black text-xs font-bold py-1">Obs</TableHead>}
                          {colunasVisiveis.includes('responsavel') && <TableHead className="border border-black text-xs font-bold py-1">Resp.</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {registros.map((m) => (
                          <TableRow key={m.id}>
                            {colunasVisiveis.includes('data') && <TableCell className="border border-gray-300 text-xs py-1">{formatarData(m.data_movimentacao)}</TableCell>}
                            {colunasVisiveis.includes('tipo') && <TableCell className="border border-gray-300 text-xs py-1">{m.tipo_movimentacao}</TableCell>}
                            {colunasVisiveis.includes('operacao') && <TableCell className="border border-gray-300 text-xs py-1">{getLabelOperacao(m.tipo_detalhado)}</TableCell>}
                            {colunasVisiveis.includes('produto') && <TableCell className="border border-gray-300 text-xs py-1">{m.produto_nome}</TableCell>}
                            {colunasVisiveis.includes('codigo') && <TableCell className="border border-gray-300 text-xs py-1">{m.produto_codigo || ''}</TableCell>}
                            {colunasVisiveis.includes('quantidade') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarNumero(m.quantidade)}</TableCell>}
                            {colunasVisiveis.includes('unidade') && <TableCell className="border border-gray-300 text-xs py-1">{m.unidade_medida || ''}</TableCell>}
                            {colunasVisiveis.includes('custo_unitario') && <TableCell className="border border-gray-300 text-xs text-right py-1">{formatarMoeda(m.valor_unitario)}</TableCell>}
                            {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right py-1 font-semibold">{formatarMoeda(m.valor_total)}</TableCell>}
                            {colunasVisiveis.includes('local_estoque') && <TableCell className="border border-gray-300 text-xs py-1">{getLocalEstoque(m)}</TableCell>}
                            {colunasVisiveis.includes('fornecedor') && <TableCell className="border border-gray-300 text-xs py-1">{m.fornecedor_nome || ''}</TableCell>}
                            {colunasVisiveis.includes('cliente') && <TableCell className="border border-gray-300 text-xs py-1">{m.cliente_nome || ''}</TableCell>}
                            {colunasVisiveis.includes('documento') && <TableCell className="border border-gray-300 text-xs py-1">{m.numero_documento || ''}</TableCell>}
                            {colunasVisiveis.includes('centro_custo') && <TableCell className="border border-gray-300 text-xs py-1">{m.centro_custo_nome || ''}</TableCell>}
                            {colunasVisiveis.includes('tipo_vinculo') && <TableCell className="border border-gray-300 text-xs py-1">{m.tipo_vinculo || ''}</TableCell>}
                            {colunasVisiveis.includes('vinculo') && <TableCell className="border border-gray-300 text-xs py-1">{getVinculo(m)}</TableCell>}
                            {colunasVisiveis.includes('motivo') && <TableCell className="border border-gray-300 text-xs py-1">{m.motivo_movimentacao || ''}</TableCell>}
                            {colunasVisiveis.includes('observacoes') && <TableCell className="border border-gray-300 text-xs py-1 max-w-[100px] truncate">{m.observacoes || ''}</TableCell>}
                            {colunasVisiveis.includes('responsavel') && <TableCell className="border border-gray-300 text-xs py-1">{m.usuario_responsavel || m.created_by || ''}</TableCell>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    <Table className="mt-1">
                      <TableBody>
                        <TableRow className="bg-gray-100 font-bold">
                          <TableCell colSpan={20} className="border border-black text-xs py-1">
                            Subtotal: {registros.length} registros | Entradas: {formatarNumero(totalGrupoEnt)} ({formatarMoeda(valorGrupoEnt)}) | Saídas: {formatarNumero(totalGrupoSai)} ({formatarMoeda(valorGrupoSai)}) | Saldo: {formatarNumero(totalGrupoEnt - totalGrupoSai)} ({formatarMoeda(valorGrupoEnt - valorGrupoSai)})
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                );
              })}

              <div className="mt-4 border-t-2 border-black pt-2">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-bold">
                    TOTAL GERAL: {movimentacoesFiltradas.length} registros | Entradas: {formatarNumero(totalEntradas)} ({formatarMoeda(valorTotalEntradas)}) | Saídas: {formatarNumero(totalSaidas)} ({formatarMoeda(valorTotalSaidas)}) | Saldo: {formatarNumero(saldoQuantidade)} ({formatarMoeda(saldoValor)})
                  </div>
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
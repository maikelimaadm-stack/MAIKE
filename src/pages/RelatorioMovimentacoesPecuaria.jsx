import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, Settings, TrendingUp, TrendingDown, Filter, GripVertical } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "";
  if (numero === 0) return "";
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

const COLUNAS_ANALITICO = [
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'motivo', label: 'Motivo', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'categoria_nova', label: 'Cat. Nova', default: false },
  { id: 'marca', label: 'Marca', default: true },
  { id: 'sexo', label: 'Sexo', default: false },
  { id: 'peso_medio', label: 'Peso Médio', default: false },
  { id: 'peso_total', label: 'Peso Total', default: false },
  { id: 'area_origem', label: 'Área Origem', default: false },
  { id: 'area_destino', label: 'Área Destino', default: false },
  { id: 'area', label: 'Área (Orig/Dest)', default: true },
  { id: 'fornecedor', label: 'Fornecedor', default: false },
  { id: 'comprador', label: 'Comprador/Destino', default: false },
  { id: 'nota_fiscal', label: 'Nota Fiscal', default: false },
  { id: 'gta', label: 'GTA', default: false },
  { id: 'causa_morte', label: 'Causa Morte', default: false },
  { id: 'transf_origem', label: 'Faz. Origem', default: false },
  { id: 'transf_destino', label: 'Faz. Destino', default: false },
  { id: 'valor_unitario', label: 'Valor Unit.', default: false },
  { id: 'valor_total', label: 'Valor Total', default: false },
  { id: 'observacoes', label: 'Observações', default: false },
  { id: 'responsavel', label: 'Responsável', default: false },
];

const AGRUPAMENTOS_DISPONIVEIS = [
  { id: 'categoria', label: 'Categoria' },
  { id: 'marca', label: 'Marca' },
  { id: 'motivo', label: 'Motivo' },
  { id: 'tipo', label: 'Tipo (Entrada/Saída)' },
  { id: 'area_origem', label: 'Área Origem' },
  { id: 'area_destino', label: 'Área Destino' },
  { id: 'fornecedor', label: 'Fornecedor' },
  { id: 'comprador', label: 'Comprador/Destino' },
  { id: 'sexo', label: 'Sexo' },
  { id: 'mes', label: 'Mês/Ano' },
  { id: 'transf_origem', label: 'Fazenda Origem (Transf.)' },
  { id: 'transf_destino', label: 'Fazenda Destino (Transf.)' },
];

const COLUNAS_SINTETICO = [
  { id: 'agrupamento', label: 'Agrupamento', default: true },
  { id: 'entradas', label: 'Entradas', default: true },
  { id: 'saidas', label: 'Saídas', default: true },
  { id: 'saldo', label: 'Saldo', default: true },
  { id: 'peso_total', label: 'Peso Total', default: false },
  { id: 'peso_medio', label: 'Peso Médio', default: false },
  { id: 'valor_total', label: 'Valor Total', default: false },
];

const TIPOS_RELATORIO = [
  { id: 'analitico', label: 'Analítico (Detalhado)' },
  { id: 'sintetico', label: 'Sintético (Agrupado)' },
  { id: 'geral', label: 'Relatório Geral (Quadros)' },
  { id: 'peso', label: 'Relatório de Peso' },
  { id: 'financeiro', label: 'Relatório Financeiro' },
  { id: 'transferencia', label: 'Transferências entre Fazendas' },
  { id: 'mudanca_categoria', label: 'Mudanças de Categoria' },
];

const OPCOES_POR_TIPO = {
  geral: [
    { id: 'mostrar_resumo', label: 'Resumo Geral', default: true },
    { id: 'mostrar_categorias', label: 'Quadro por Categoria', default: true },
    { id: 'mostrar_marcas', label: 'Quadro por Marca', default: true },
    { id: 'mostrar_motivos', label: 'Quadros por Motivo', default: true },
    { id: 'mostrar_detalhes', label: 'Detalhamento dos Registros', default: false },
    { id: 'todos_registros', label: 'Mostrar Todos os Registros', default: false },
  ],
  transferencia: [
    { id: 'mostrar_resumo', label: 'Resumo por Fazenda', default: true },
    { id: 'mostrar_detalhes', label: 'Detalhamento', default: true },
    { id: 'todos_registros', label: 'Todos os Registros', default: false },
  ],
  mudanca_categoria: [
    { id: 'mostrar_resumo', label: 'Resumo DE/PARA', default: true },
    { id: 'mostrar_detalhes', label: 'Detalhamento', default: true },
    { id: 'todos_registros', label: 'Todos os Registros', default: false },
  ],
  peso: [
    { id: 'mostrar_resumo', label: 'Resumo por Categoria', default: true },
    { id: 'todos_registros', label: 'Todos os Registros', default: false },
  ],
  financeiro: [
    { id: 'mostrar_resumo', label: 'Resumo por Categoria', default: true },
    { id: 'todos_registros', label: 'Todos os Registros', default: false },
  ],
};

const ORDENACAO_OPCOES = [
  { value: 'data_desc', label: 'Data (Mais Recente)' },
  { value: 'data_asc', label: 'Data (Mais Antigo)' },
  { value: 'quantidade_desc', label: 'Quantidade (Maior)' },
  { value: 'quantidade_asc', label: 'Quantidade (Menor)' },
  { value: 'categoria_asc', label: 'Categoria (A-Z)' },
  { value: 'categoria_desc', label: 'Categoria (Z-A)' },
];

export default function RelatorioMovimentacoesPecuaria() {

  const [tipoRelatorio, setTipoRelatorio] = useState("analitico");
  const [orientacao, setOrientacao] = useState("paisagem");
  const [ordenacao, setOrdenacao] = useState('data_desc');
  const [agrupamentosAtivos, setAgrupamentosAtivos] = useState([]);
  const [opcoesRelatorio, setOpcoesRelatorio] = useState({});
  
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [tipoSelecionado, setTipoSelecionado] = useState("todos");
  const [categoriasSelecionadas, setCategoriasSelecionadas] = useState([]);
  const [marcasSelecionadas, setMarcasSelecionadas] = useState([]);
  const [motivosSelecionados, setMotivosSelecionados] = useState([]);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const [showConfigColunas, setShowConfigColunas] = useState(false);

  const getColunasDisponiveis = () => {
    return tipoRelatorio === 'sintetico' ? COLUNAS_SINTETICO : COLUNAS_ANALITICO;
  };

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_pecuaria_visiveis');
    if (saved) {
      try { return JSON.parse(saved); } catch { }
    }
    return COLUNAS_ANALITICO.filter(c => c.default).map(c => c.id);
  });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem('colunas_relatorio_pecuaria_ordem');
    if (saved) {
      try { return JSON.parse(saved); } catch { }
    }
    return COLUNAS_ANALITICO.map(c => c.id);
  });

  React.useEffect(() => {
    const colunas = getColunasDisponiveis();
    setColunasVisiveis(colunas.filter(c => c.default).map(c => c.id));
    setColunasOrdem(colunas.map(c => c.id));
    
    // Resetar opções do relatório
    const opcoesTipo = OPCOES_POR_TIPO[tipoRelatorio] || [];
    const novasOpcoes = {};
    opcoesTipo.forEach(op => { novasOpcoes[op.id] = op.default; });
    setOpcoesRelatorio(novasOpcoes);
  }, [tipoRelatorio]);

  const toggleOpcaoRelatorio = (opcaoId) => {
    setOpcoesRelatorio(prev => ({ ...prev, [opcaoId]: !prev[opcaoId] }));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColunasOrdem(items);
    localStorage.setItem('colunas_relatorio_pecuaria_ordem', JSON.stringify(items));
  };

  const colunasOrdenadas = colunasOrdem
    .map(id => getColunasDisponiveis().find(c => c.id === id))
    .filter(c => c && colunasVisiveis.includes(c.id));

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

  const categoriasUnicas = [...new Set(movimentacoes.map(m => m.categoria_animal))].filter(Boolean).sort();
  const marcasUnicas = [...new Set(movimentacoes.map(m => m.marca))].filter(Boolean).sort();
  const motivosUnicos = [...new Set(movimentacoes.map(m => m.motivo))].filter(Boolean).sort();
  const areasOrigemUnicas = [...new Set(movimentacoes.map(m => m.area_origem_nome))].filter(Boolean).sort();
  const areasDestinoUnicas = [...new Set(movimentacoes.map(m => m.area_destino_nome))].filter(Boolean).sort();
  const fornecedoresUnicos = [...new Set(movimentacoes.map(m => m.fornecedor_origem))].filter(Boolean).sort();
  const compradoresUnicos = [...new Set(movimentacoes.map(m => m.destino_venda))].filter(Boolean).sort();

  const movimentacoesFiltradas = useMemo(() => {
    let filtered = movimentacoes.filter(m => {
      if (tipoSelecionado !== "todos" && m.tipo !== tipoSelecionado) return false;
      if (categoriasSelecionadas.length > 0 && !categoriasSelecionadas.includes(m.categoria_animal)) return false;
      if (marcasSelecionadas.length > 0 && !marcasSelecionadas.includes(m.marca)) return false;
      if (motivosSelecionados.length > 0 && !motivosSelecionados.includes(m.motivo)) return false;
      
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
      
      return true;
    });

    // Ordenação
    filtered.sort((a, b) => {
      switch (ordenacao) {
        case 'data_asc': return new Date(a.data_movimentacao) - new Date(b.data_movimentacao);
        case 'data_desc': return new Date(b.data_movimentacao) - new Date(a.data_movimentacao);
        case 'quantidade_asc': return (a.quantidade_animais || 0) - (b.quantidade_animais || 0);
        case 'quantidade_desc': return (b.quantidade_animais || 0) - (a.quantidade_animais || 0);
        case 'categoria_asc': return (a.categoria_animal || '').localeCompare(b.categoria_animal || '');
        case 'categoria_desc': return (b.categoria_animal || '').localeCompare(a.categoria_animal || '');
        default: return 0;
      }
    });

    return filtered;
  }, [movimentacoes, tipoSelecionado, categoriasSelecionadas, marcasSelecionadas, motivosSelecionados, dataInicio, dataFim, ordenacao]);

  // Função para obter valor do campo de agrupamento
  const getValorAgrupamento = (m, campo) => {
    switch (campo) {
      case 'categoria': return m.categoria_animal || 'Sem Categoria';
      case 'marca': return m.marca || 'Sem Marca';
      case 'motivo': return m.motivo || 'Sem Motivo';
      case 'tipo': return m.tipo || 'Sem Tipo';
      case 'area_origem': return m.area_origem_nome || 'Sem Origem';
      case 'area_destino': return m.area_destino_nome || 'Sem Destino';
      case 'fornecedor': return m.fornecedor_origem || 'Sem Fornecedor';
      case 'comprador': return m.destino_venda || 'Sem Comprador';
      case 'sexo': return m.sexo || 'Sem Sexo';
      case 'transf_origem': return m.transferencia_origem || 'Sem Origem';
      case 'transf_destino': return m.transferencia_destino || 'Sem Destino';
      case 'mes': 
        if (!m.data_movimentacao) return 'Sem Data';
        const d = new Date(m.data_movimentacao);
        return format(d, 'MM/yyyy', { locale: ptBR });
      default: return 'Sem classificação';
    }
  };

  // Filtrar movimentações por tipo de relatório especial
  const movimentacoesPorTipoRelatorio = useMemo(() => {
    if (tipoRelatorio === 'transferencia') {
      // Incluir movimentações com motivo de transferência OU que tenham origem/destino preenchidos
      return movimentacoesFiltradas.filter(m => 
        m.motivo?.toLowerCase().includes('transferência') || 
        m.motivo?.toLowerCase().includes('transferencia') ||
        m.transferencia_origem || 
        m.transferencia_destino
      );
    }
    if (tipoRelatorio === 'mudanca_categoria') {
      // Incluir movimentações com motivo de mudança de categoria OU que tenham vínculo de mudança
      return movimentacoesFiltradas.filter(m => 
        m.motivo?.toLowerCase().includes('mudança de categoria') ||
        m.motivo?.toLowerCase().includes('mudanca de categoria') ||
        m.categoria_nova ||
        m.vinculo_mudanca_categoria
      );
    }
    if (tipoRelatorio === 'peso') {
      return movimentacoesFiltradas.filter(m => m.peso_medio || m.peso_total);
    }
    if (tipoRelatorio === 'financeiro') {
      return movimentacoesFiltradas.filter(m => m.valor_unitario || m.valor_total);
    }
    return movimentacoesFiltradas;
  }, [movimentacoesFiltradas, tipoRelatorio]);

  // Dados para Relatório Geral (múltiplos quadros por motivo)
  const dadosRelatorioGeral = useMemo(() => {
    if (tipoRelatorio !== 'geral') return null;

    const dados = movimentacoesFiltradas;
    
    // Agrupar por motivo
    const porMotivo = {};
    dados.forEach(m => {
      const motivo = m.motivo || 'Outros';
      if (!porMotivo[motivo]) {
        porMotivo[motivo] = {
          motivo,
          entradas: 0,
          saidas: 0,
          quantidade: 0,
          peso_total: 0,
          valor_total: 0,
          registros: [],
          porCategoria: {}
        };
      }
      const qtd = m.quantidade_animais || 0;
      porMotivo[motivo].quantidade += qtd;
      if (m.tipo === 'Entrada') porMotivo[motivo].entradas += qtd;
      else porMotivo[motivo].saidas += qtd;
      porMotivo[motivo].peso_total += m.peso_total || 0;
      porMotivo[motivo].valor_total += m.valor_total || 0;
      porMotivo[motivo].registros.push(m);

      // Por categoria dentro do motivo
      const cat = m.categoria_animal || 'Sem Categoria';
      if (!porMotivo[motivo].porCategoria[cat]) {
        porMotivo[motivo].porCategoria[cat] = { entradas: 0, saidas: 0, quantidade: 0 };
      }
      porMotivo[motivo].porCategoria[cat].quantidade += qtd;
      if (m.tipo === 'Entrada') porMotivo[motivo].porCategoria[cat].entradas += qtd;
      else porMotivo[motivo].porCategoria[cat].saidas += qtd;
    });

    // Resumo por categoria geral
    const porCategoriaGeral = {};
    dados.forEach(m => {
      const cat = m.categoria_animal || 'Sem Categoria';
      if (!porCategoriaGeral[cat]) {
        porCategoriaGeral[cat] = { entradas: 0, saidas: 0, saldo: 0 };
      }
      const qtd = m.quantidade_animais || 0;
      if (m.tipo === 'Entrada') {
        porCategoriaGeral[cat].entradas += qtd;
        porCategoriaGeral[cat].saldo += qtd;
      } else {
        porCategoriaGeral[cat].saidas += qtd;
        porCategoriaGeral[cat].saldo -= qtd;
      }
    });

    // Resumo por marca
    const porMarca = {};
    dados.forEach(m => {
      const marca = m.marca || 'Sem Marca';
      if (!porMarca[marca]) {
        porMarca[marca] = { entradas: 0, saidas: 0, saldo: 0 };
      }
      const qtd = m.quantidade_animais || 0;
      if (m.tipo === 'Entrada') {
        porMarca[marca].entradas += qtd;
        porMarca[marca].saldo += qtd;
      } else {
        porMarca[marca].saidas += qtd;
        porMarca[marca].saldo -= qtd;
      }
    });

    return {
      porMotivo: Object.values(porMotivo).sort((a, b) => b.quantidade - a.quantidade),
      porCategoriaGeral: Object.entries(porCategoriaGeral).map(([cat, d]) => ({ categoria: cat, ...d })).sort((a, b) => a.categoria.localeCompare(b.categoria)),
      porMarca: Object.entries(porMarca).map(([marca, d]) => ({ marca, ...d })).sort((a, b) => a.marca.localeCompare(b.marca)),
    };
  }, [tipoRelatorio, movimentacoesFiltradas]);

  // Dados para relatório
  const dadosRelatorio = useMemo(() => {
    const agrupamentos = agrupamentosAtivos.length > 0 ? agrupamentosAtivos : ['categoria'];
    const dados = movimentacoesPorTipoRelatorio;

    if (tipoRelatorio === 'geral') {
      return { tipo: 'geral', dados: dadosRelatorioGeral, agrupamentos: [] };
    }

    if (tipoRelatorio === 'sintetico' || tipoRelatorio === 'peso' || tipoRelatorio === 'financeiro') {
      const grupos = {};
      
      dados.forEach(m => {
        const partesChave = agrupamentos.map(ag => getValorAgrupamento(m, ag));
        const chave = partesChave.join(' | ');
        
        if (!grupos[chave]) {
          grupos[chave] = { 
            agrupamento: chave, 
            partes: partesChave,
            entradas: 0, 
            saidas: 0, 
            saldo: 0,
            peso_total: 0,
            peso_medio_acum: 0,
            qtd_peso: 0,
            valor_total: 0
          };
        }
        
        const qtd = m.quantidade_animais || 0;
        if (m.tipo === 'Entrada') {
          grupos[chave].entradas += qtd;
          grupos[chave].saldo += qtd;
        } else {
          grupos[chave].saidas += qtd;
          grupos[chave].saldo -= qtd;
        }
        grupos[chave].peso_total += m.peso_total || 0;
        if (m.peso_medio) {
          grupos[chave].peso_medio_acum += m.peso_medio * qtd;
          grupos[chave].qtd_peso += qtd;
        }
        grupos[chave].valor_total += m.valor_total || 0;
      });

      // Calcular peso médio
      Object.values(grupos).forEach(g => {
        g.peso_medio = g.qtd_peso > 0 ? g.peso_medio_acum / g.qtd_peso : 0;
      });
      
      return { 
        tipo: 'sintetico', 
        dados: Object.values(grupos).sort((a, b) => a.agrupamento.localeCompare(b.agrupamento)),
        agrupamentos
      };
    } else if (tipoRelatorio === 'mudanca_categoria') {
      // Relatório especial de mudança de categoria - mostra DE/PARA
      const grupos = {};
      dados.forEach(m => {
        const chave = `${m.categoria_animal || 'Sem Cat.'} → ${m.categoria_nova || 'Sem Cat.'}`;
        if (!grupos[chave]) {
          grupos[chave] = {
            categoria_origem: m.categoria_animal || 'Sem Categoria',
            categoria_destino: m.categoria_nova || 'Sem Categoria',
            quantidade: 0,
            registros: []
          };
        }
        grupos[chave].quantidade += m.quantidade_animais || 0;
        grupos[chave].registros.push(m);
      });
      return { tipo: 'mudanca_categoria', dados: Object.values(grupos), agrupamentos: [] };
    } else if (tipoRelatorio === 'transferencia') {
      // Relatório de transferências
      const grupos = {};
      dados.forEach(m => {
        const origem = m.transferencia_origem || 'Sem Origem';
        const destino = m.transferencia_destino || 'Sem Destino';
        const chave = `${origem} → ${destino}`;
        if (!grupos[chave]) {
          grupos[chave] = {
            fazenda_origem: origem,
            fazenda_destino: destino,
            quantidade: 0,
            registros: []
          };
        }
        grupos[chave].quantidade += m.quantidade_animais || 0;
        grupos[chave].registros.push(m);
      });
      return { tipo: 'transferencia', dados: Object.values(grupos), agrupamentos: [] };
    } else {
      // Analítico
      if (agrupamentosAtivos.length === 0) {
        return { tipo: 'analitico', dados: { "Todas as Movimentações": dados }, agrupamentos: [] };
      }

      const grupos = {};
      dados.forEach(m => {
        const partesChave = agrupamentos.map(ag => getValorAgrupamento(m, ag));
        const chave = partesChave.join(' | ');
        if (!grupos[chave]) grupos[chave] = [];
        grupos[chave].push(m);
      });
      return { tipo: 'analitico', dados: grupos, agrupamentos };
    }
  }, [tipoRelatorio, movimentacoesPorTipoRelatorio, agrupamentosAtivos, dadosRelatorioGeral]);

  const totalEntradas = movimentacoesPorTipoRelatorio.filter(m => m.tipo === 'Entrada').reduce((sum, m) => sum + (m.quantidade_animais || 0), 0);
  const totalSaidas = movimentacoesPorTipoRelatorio.filter(m => m.tipo === 'Saída').reduce((sum, m) => sum + (m.quantidade_animais || 0), 0);
  const saldoPeriodo = totalEntradas - totalSaidas;
  const totalPeso = movimentacoesPorTipoRelatorio.reduce((sum, m) => sum + (m.peso_total || 0), 0);
  const totalValor = movimentacoesPorTipoRelatorio.reduce((sum, m) => sum + (m.valor_total || 0), 0);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novas = prev.includes(colunaId) ? prev.filter(id => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem('colunas_relatorio_pecuaria_visiveis', JSON.stringify(novas));
      return novas;
    });
  };

  const toggleFiltro = (lista, setLista, valor) => {
    setLista(prev => prev.includes(valor) ? prev.filter(v => v !== valor) : [...prev, valor]);
  };

  const toggleAgrupamento = (tipo) => {
    setAgrupamentosAtivos(prev => {
      if (prev.includes(tipo)) {
        return prev.filter(t => t !== tipo);
      }
      // Permite múltiplos agrupamentos
      return [...prev, tipo];
    });
  };

  const limparFiltros = () => {
    setCategoriasSelecionadas([]);
    setMarcasSelecionadas([]);
    setMotivosSelecionados([]);
    setDataInicio("");
    setDataFim("");
    setTipoSelecionado('todos');
    setAgrupamentosAtivos([]);
    setOrdenacao('data_desc');
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Relatório de Movimentações Pecuárias</h1>
          <p className="text-xs text-slate-600">Análise de entradas, saídas e saldos do rebanho</p>
        </div>
        <Button onClick={() => window.print()} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
          <Printer className="w-3.5 h-3.5" />
          Imprimir
        </Button>
      </div>

      {/* Filtros e Configurações - Visíveis na Tela */}
      <Card className="print:hidden">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Tipo Relatório</Label>
              <Select value={tipoRelatorio} onValueChange={setTipoRelatorio}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_RELATORIO.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label className="text-xs">Tipo Mov.</Label>
              <Select value={tipoSelecionado} onValueChange={setTipoSelecionado}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="Entrada">Entradas</SelectItem>
                  <SelectItem value="Saída">Saídas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {tipoRelatorio === 'analitico' && (
              <div className="space-y-1">
                <Label className="text-xs">Ordenar</Label>
                <Select value={ordenacao} onValueChange={setOrdenacao}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORDENACAO_OPCOES.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Data Início</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap items-center">
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

            <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setShowConfigColunas(true)}>
              <Settings className="w-3.5 h-3.5" />
              Colunas
            </Button>

            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={limparFiltros}>Limpar</Button>
          </div>

          {/* Opções específicas do tipo de relatório */}
          {OPCOES_POR_TIPO[tipoRelatorio] && (
            <div className="p-2 bg-slate-50 rounded-lg border">
              <Label className="text-xs font-semibold text-slate-700 mb-2 block">Opções do Relatório</Label>
              <div className="flex flex-wrap gap-3">
                {OPCOES_POR_TIPO[tipoRelatorio].map((opcao) => (
                  <label key={opcao.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox 
                      checked={opcoesRelatorio[opcao.id] || false} 
                      onCheckedChange={() => toggleOpcaoRelatorio(opcao.id)} 
                    />
                    <span>{opcao.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs">Agrupar Por</Label>
            <div className="flex flex-wrap gap-1">
              {AGRUPAMENTOS_DISPONIVEIS.map((ag) => (
                <Button 
                  key={ag.id} 
                  variant={agrupamentosAtivos.includes(ag.id) ? "default" : "outline"} 
                  size="sm" 
                  onClick={() => toggleAgrupamento(ag.id)} 
                  className={`h-7 text-xs ${agrupamentosAtivos.includes(ag.id) ? "bg-slate-700 hover:bg-slate-800" : ""}`}
                >
                  {ag.label}
                  {agrupamentosAtivos.includes(ag.id) && agrupamentosAtivos.length > 1 && (
                    <span className="ml-1 text-[10px] bg-white text-slate-700 px-1 rounded">
                      {agrupamentosAtivos.indexOf(ag.id) + 1}
                    </span>
                  )}
                </Button>
              ))}
            </div>
            {agrupamentosAtivos.length > 1 && (
              <p className="text-xs text-slate-500">Ordem: {agrupamentosAtivos.map(a => AGRUPAMENTOS_DISPONIVEIS.find(ag => ag.id === a)?.label).join(' → ')}</p>
            )}
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
              <h2 className="text-base font-bold">
                {TIPOS_RELATORIO.find(t => t.id === tipoRelatorio)?.label || 'Relatório de Movimentações Pecuárias'}
              </h2>
              {(dataInicio || dataFim) && (
                <p className="text-xs text-gray-600">
                  Período: {dataInicio ? formatarData(dataInicio) : 'Início'} a {dataFim ? formatarData(dataFim) : 'Atual'}
                </p>
              )}
              <p className="text-xs text-gray-600">
                {movimentacoesPorTipoRelatorio.length} registro(s) • Entradas: +{formatarNumero(totalEntradas)} cab • Saídas: -{formatarNumero(totalSaidas)} cab • Saldo: {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
                {(tipoRelatorio === 'peso' || tipoRelatorio === 'financeiro') && (
                  <> • Peso: {formatarNumero(totalPeso)} kg • Valor: R$ {totalValor.toFixed(2)}</>
                )}
              </p>
            </div>
          </div>

          {/* Conteúdo do Relatório */}
          {dadosRelatorio.tipo === 'sintetico' && (
            <Table>
              <TableHeader>
                <TableRow className="border-black">
                  {dadosRelatorio.agrupamentos?.map((ag, i) => (
                    <TableHead key={ag} className="border border-black text-xs font-bold py-1">
                      {AGRUPAMENTOS_DISPONIVEIS.find(a => a.id === ag)?.label || ag}
                    </TableHead>
                  ))}
                  {colunasVisiveis.includes('entradas') && <TableHead className="border border-black text-xs font-bold text-right py-1">Entradas</TableHead>}
                  {colunasVisiveis.includes('saidas') && <TableHead className="border border-black text-xs font-bold text-right py-1">Saídas</TableHead>}
                  {colunasVisiveis.includes('saldo') && <TableHead className="border border-black text-xs font-bold text-right py-1">Saldo</TableHead>}
                  {colunasVisiveis.includes('peso_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Peso Total</TableHead>}
                  {colunasVisiveis.includes('peso_medio') && <TableHead className="border border-black text-xs font-bold text-right py-1">Peso Médio</TableHead>}
                  {colunasVisiveis.includes('valor_total') && <TableHead className="border border-black text-xs font-bold text-right py-1">Valor Total</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dadosRelatorio.dados.map((grupo, idx) => (
                  <TableRow key={idx}>
                    {grupo.partes?.map((parte, i) => (
                      <TableCell key={i} className="border border-gray-300 text-xs py-1 font-semibold">{parte}</TableCell>
                    ))}
                    {colunasVisiveis.includes('entradas') && <TableCell className="border border-gray-300 text-xs text-right py-1">{grupo.entradas ? formatarNumero(grupo.entradas) : ''}</TableCell>}
                    {colunasVisiveis.includes('saidas') && <TableCell className="border border-gray-300 text-xs text-right py-1">{grupo.saidas ? formatarNumero(grupo.saidas) : ''}</TableCell>}
                    {colunasVisiveis.includes('saldo') && <TableCell className="border border-gray-300 text-xs text-right py-1 font-bold">{grupo.saldo ? `${formatarNumero(grupo.saldo)} cab` : ''}</TableCell>}
                    {colunasVisiveis.includes('peso_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{grupo.peso_total ? `${formatarNumero(grupo.peso_total)} kg` : ''}</TableCell>}
                    {colunasVisiveis.includes('peso_medio') && <TableCell className="border border-gray-300 text-xs text-right py-1">{grupo.peso_medio ? `${grupo.peso_medio.toFixed(2)} kg` : ''}</TableCell>}
                    {colunasVisiveis.includes('valor_total') && <TableCell className="border border-gray-300 text-xs text-right py-1">{grupo.valor_total ? `R$ ${grupo.valor_total.toFixed(2)}` : ''}</TableCell>}
                  </TableRow>
                ))}
                <TableRow className="bg-gray-100 font-bold">
                  <TableCell colSpan={dadosRelatorio.agrupamentos?.length || 1} className="border border-black text-xs py-1">TOTAL GERAL</TableCell>
                  {colunasVisiveis.includes('entradas') && <TableCell className="border border-black text-xs text-right py-1">{totalEntradas ? formatarNumero(totalEntradas) : ''}</TableCell>}
                  {colunasVisiveis.includes('saidas') && <TableCell className="border border-black text-xs text-right py-1">{totalSaidas ? formatarNumero(totalSaidas) : ''}</TableCell>}
                  {colunasVisiveis.includes('saldo') && <TableCell className="border border-black text-xs text-right py-1">{saldoPeriodo ? `${formatarNumero(saldoPeriodo)} cab` : ''}</TableCell>}
                  {colunasVisiveis.includes('peso_total') && <TableCell className="border border-black text-xs text-right py-1">{totalPeso ? `${formatarNumero(totalPeso)} kg` : ''}</TableCell>}
                  {colunasVisiveis.includes('peso_medio') && <TableCell className="border border-black text-xs text-right py-1">-</TableCell>}
                  {colunasVisiveis.includes('valor_total') && <TableCell className="border border-black text-xs text-right py-1">{totalValor ? `R$ ${totalValor.toFixed(2)}` : ''}</TableCell>}
                </TableRow>
              </TableBody>
            </Table>
          )}

          {/* Relatório de Mudança de Categoria */}
          {dadosRelatorio.tipo === 'mudanca_categoria' && (
            <div className="space-y-4">
              {opcoesRelatorio.mostrar_resumo && (
                <Table>
                  <TableHeader>
                    <TableRow className="border-black">
                      <TableHead className="border border-black text-sm font-bold py-2">Categoria Origem (DE)</TableHead>
                      <TableHead className="border border-black text-sm font-bold py-2">Categoria Destino (PARA)</TableHead>
                      <TableHead className="border border-black text-sm font-bold text-right py-2">Quantidade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dadosRelatorio.dados.map((grupo, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="border border-gray-300 text-sm py-2 font-semibold">{grupo.categoria_origem}</TableCell>
                        <TableCell className="border border-gray-300 text-sm py-2 font-semibold">{grupo.categoria_destino}</TableCell>
                        <TableCell className="border border-gray-300 text-sm text-right py-2 font-bold">{formatarNumero(grupo.quantidade)} cab</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-gray-100 font-bold">
                      <TableCell colSpan={2} className="border border-black text-sm py-2">TOTAL DE MUDANÇAS</TableCell>
                      <TableCell className="border border-black text-sm text-right py-2">{formatarNumero(dadosRelatorio.dados.reduce((s, g) => s + g.quantidade, 0))} cab</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}

              {/* Detalhamento por grupo */}
              {(opcoesRelatorio.mostrar_detalhes || opcoesRelatorio.todos_registros) && dadosRelatorio.dados.map((grupo, idx) => {
                const registrosExibir = opcoesRelatorio.todos_registros ? grupo.registros : grupo.registros.slice(0, 10);
                return (
                  <div key={idx} className="mt-3">
                    <div className="bg-purple-600 text-white px-3 py-2">
                      <h3 className="font-bold text-sm">{grupo.categoria_origem} → {grupo.categoria_destino} ({grupo.quantidade} cab)</h3>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="border border-black text-sm font-bold py-2">Data</TableHead>
                          <TableHead className="border border-black text-sm font-bold py-2 text-right">Quantidade</TableHead>
                          <TableHead className="border border-black text-sm font-bold py-2">Marca</TableHead>
                          <TableHead className="border border-black text-sm font-bold py-2">Observações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {registrosExibir.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="border border-gray-300 text-sm py-2">{formatarData(m.data_movimentacao)}</TableCell>
                            <TableCell className="border border-gray-300 text-sm py-2 text-right font-semibold">{m.quantidade_animais} cab</TableCell>
                            <TableCell className="border border-gray-300 text-sm py-2">{m.marca || ''}</TableCell>
                            <TableCell className="border border-gray-300 text-sm py-2">{m.observacoes || ''}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {!opcoesRelatorio.todos_registros && grupo.registros.length > 10 && (
                      <p className="text-xs text-slate-500 mt-1">... e mais {grupo.registros.length - 10} registro(s)</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Relatório Geral (Múltiplos Quadros) */}
          {dadosRelatorio.tipo === 'geral' && dadosRelatorio.dados && (
            <div className="space-y-4">
              {/* Quadro Resumo Geral */}
              {opcoesRelatorio.mostrar_resumo && (
                <div>
                  <div className="bg-gray-200 border border-gray-400 px-2 py-1">
                    <h3 className="font-bold text-xs">RESUMO GERAL DO PERÍODO</h3>
                  </div>
                  <div className="grid grid-cols-4 gap-0 border border-gray-400 border-t-0">
                    <div className="p-2 border-r border-gray-400 text-center">
                      <div className="text-lg font-bold">+{formatarNumero(totalEntradas)}</div>
                      <div className="text-xs text-gray-600">Entradas</div>
                    </div>
                    <div className="p-2 border-r border-gray-400 text-center">
                      <div className="text-lg font-bold">-{formatarNumero(totalSaidas)}</div>
                      <div className="text-xs text-gray-600">Saídas</div>
                    </div>
                    <div className="p-2 border-r border-gray-400 text-center">
                      <div className="text-lg font-bold">{saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)}</div>
                      <div className="text-xs text-gray-600">Saldo</div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-lg font-bold">{movimentacoesFiltradas.length}</div>
                      <div className="text-xs text-gray-600">Registros</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Quadros lado a lado: Categoria e Marca */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Quadro por Categoria */}
                {opcoesRelatorio.mostrar_categorias && (
                  <div>
                    <div className="bg-gray-200 border border-gray-400 px-2 py-1">
                      <h3 className="font-bold text-xs">POR CATEGORIA</h3>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 bg-gray-100">Categoria</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Ent.</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Saí.</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dadosRelatorio.dados.porCategoriaGeral?.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="border border-gray-300 text-xs py-1">{item.categoria}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right">{item.entradas ? `+${formatarNumero(item.entradas)}` : ''}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right">{item.saidas ? `-${formatarNumero(item.saidas)}` : ''}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right font-semibold">{formatarNumero(item.saldo)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-100">
                          <TableCell className="border border-gray-400 text-xs py-1 font-bold">TOTAL</TableCell>
                          <TableCell className="border border-gray-400 text-xs py-1 text-right font-bold">+{formatarNumero(totalEntradas)}</TableCell>
                          <TableCell className="border border-gray-400 text-xs py-1 text-right font-bold">-{formatarNumero(totalSaidas)}</TableCell>
                          <TableCell className="border border-gray-400 text-xs py-1 text-right font-bold">{formatarNumero(saldoPeriodo)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Quadro por Marca */}
                {opcoesRelatorio.mostrar_marcas && (
                  <div>
                    <div className="bg-gray-200 border border-gray-400 px-2 py-1">
                      <h3 className="font-bold text-xs">POR MARCA</h3>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 bg-gray-100">Marca</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Ent.</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Saí.</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dadosRelatorio.dados.porMarca?.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="border border-gray-300 text-xs py-1">{item.marca}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right">{item.entradas ? `+${formatarNumero(item.entradas)}` : ''}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right">{item.saidas ? `-${formatarNumero(item.saidas)}` : ''}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right font-semibold">{formatarNumero(item.saldo)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Quadros por Motivo */}
              {opcoesRelatorio.mostrar_motivos && dadosRelatorio.dados.porMotivo?.map((grupo, idx) => {
                const mostrarTodosRegistros = opcoesRelatorio.todos_registros;
                const registrosExibir = mostrarTodosRegistros ? grupo.registros : grupo.registros.slice(0, 5);
                
                return (
                  <div key={idx} className="break-inside-avoid mt-3">
                    <div className="bg-gray-200 border border-gray-400 px-2 py-1 flex justify-between items-center">
                      <h3 className="font-bold text-xs">{grupo.motivo.toUpperCase()}</h3>
                      <div className="flex gap-2 text-xs">
                        <span>{grupo.quantidade} cab</span>
                        {grupo.peso_total > 0 && <span>| {formatarNumero(grupo.peso_total)} kg</span>}
                        {grupo.valor_total > 0 && <span>| R$ {grupo.valor_total.toFixed(2)}</span>}
                      </div>
                    </div>

                    {/* Por categoria dentro do motivo */}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 bg-gray-100">Categoria</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Ent.</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Saí.</TableHead>
                          <TableHead className="border border-gray-400 text-xs font-bold py-1 text-right bg-gray-100">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(grupo.porCategoria).sort(([a], [b]) => a.localeCompare(b)).map(([cat, dados], catIdx) => (
                          <TableRow key={catIdx}>
                            <TableCell className="border border-gray-300 text-xs py-1">{cat}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right">{dados.entradas ? `+${formatarNumero(dados.entradas)}` : ''}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right">{dados.saidas ? `-${formatarNumero(dados.saidas)}` : ''}</TableCell>
                            <TableCell className="border border-gray-300 text-xs py-1 text-right font-semibold">{formatarNumero(dados.quantidade)}</TableCell>
                          </TableRow>
                        ))}
                        <TableRow className="bg-gray-100">
                          <TableCell className="border border-gray-400 text-xs py-1 font-bold">SUBTOTAL</TableCell>
                          <TableCell className="border border-gray-400 text-xs py-1 text-right font-bold">{grupo.entradas ? `+${formatarNumero(grupo.entradas)}` : ''}</TableCell>
                          <TableCell className="border border-gray-400 text-xs py-1 text-right font-bold">{grupo.saidas ? `-${formatarNumero(grupo.saidas)}` : ''}</TableCell>
                          <TableCell className="border border-gray-400 text-xs py-1 text-right font-bold">{formatarNumero(grupo.quantidade)}</TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>

                    {/* Detalhamento de registros */}
                    {opcoesRelatorio.mostrar_detalhes && grupo.registros.length > 0 && (
                      <div className="mt-1 mb-3">
                        <p className="text-[10px] text-gray-500 mb-0.5">
                          {mostrarTodosRegistros ? `${grupo.registros.length} registros:` : `Últimos ${Math.min(5, grupo.registros.length)}:`}
                        </p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">Data</TableHead>
                              <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">Qtd</TableHead>
                              <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">Categoria</TableHead>
                              <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">Marca</TableHead>
                              {grupo.motivo.includes('Compra') && <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">Fornecedor</TableHead>}
                              {(grupo.motivo.includes('Venda') || grupo.motivo.includes('Abate')) && <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">Comprador</TableHead>}
                              {grupo.motivo.includes('Morte') && <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">Causa</TableHead>}
                              {grupo.motivo.includes('Transferência') && <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">Orig. → Dest.</TableHead>}
                              {grupo.motivo.includes('Mudança') && <TableHead className="border border-gray-300 text-[10px] font-bold py-0.5 bg-gray-50">De → Para</TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {registrosExibir.map((m) => (
                              <TableRow key={m.id}>
                                <TableCell className="border border-gray-200 text-[10px] py-0.5">{formatarData(m.data_movimentacao)}</TableCell>
                                <TableCell className="border border-gray-200 text-[10px] py-0.5">{m.quantidade_animais}</TableCell>
                                <TableCell className="border border-gray-200 text-[10px] py-0.5">{m.categoria_animal || ''}</TableCell>
                                <TableCell className="border border-gray-200 text-[10px] py-0.5">{m.marca || ''}</TableCell>
                                {grupo.motivo.includes('Compra') && <TableCell className="border border-gray-200 text-[10px] py-0.5">{m.fornecedor_origem || ''}</TableCell>}
                                {(grupo.motivo.includes('Venda') || grupo.motivo.includes('Abate')) && <TableCell className="border border-gray-200 text-[10px] py-0.5">{m.destino_venda || ''}</TableCell>}
                                {grupo.motivo.includes('Morte') && <TableCell className="border border-gray-200 text-[10px] py-0.5">{m.causa_morte || ''}</TableCell>}
                                {grupo.motivo.includes('Transferência') && <TableCell className="border border-gray-200 text-[10px] py-0.5">{m.transferencia_origem || ''} → {m.transferencia_destino || ''}</TableCell>}
                                {grupo.motivo.includes('Mudança') && <TableCell className="border border-gray-200 text-[10px] py-0.5">{m.transferencia_origem || ''} → {m.transferencia_destino || ''}</TableCell>}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {!mostrarTodosRegistros && grupo.registros.length > 5 && (
                          <p className="text-[10px] text-gray-400">... +{grupo.registros.length - 5}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Relatório de Transferências */}
          {dadosRelatorio.tipo === 'transferencia' && (
            <div className="space-y-4">
              {opcoesRelatorio.mostrar_resumo && (
                <Table>
                  <TableHeader>
                    <TableRow className="border-black">
                      <TableHead className="border border-black text-sm font-bold py-2">Fazenda Origem</TableHead>
                      <TableHead className="border border-black text-sm font-bold py-2">Fazenda Destino</TableHead>
                      <TableHead className="border border-black text-sm font-bold text-right py-2">Quantidade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dadosRelatorio.dados.map((grupo, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="border border-gray-300 text-sm py-2 font-semibold">{grupo.fazenda_origem}</TableCell>
                        <TableCell className="border border-gray-300 text-sm py-2 font-semibold">{grupo.fazenda_destino}</TableCell>
                        <TableCell className="border border-gray-300 text-sm text-right py-2 font-bold">{formatarNumero(grupo.quantidade)} cab</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-gray-100 font-bold">
                      <TableCell colSpan={2} className="border border-black text-sm py-2">TOTAL DE TRANSFERÊNCIAS</TableCell>
                      <TableCell className="border border-black text-sm text-right py-2">{formatarNumero(dadosRelatorio.dados.reduce((s, g) => s + g.quantidade, 0))} cab</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}

              {/* Detalhamento por grupo */}
              {(opcoesRelatorio.mostrar_detalhes || opcoesRelatorio.todos_registros) && dadosRelatorio.dados.map((grupo, idx) => {
                const registrosExibir = opcoesRelatorio.todos_registros ? grupo.registros : grupo.registros.slice(0, 10);
                return (
                  <div key={idx} className="mt-3">
                    <div className="bg-indigo-600 text-white px-3 py-2">
                      <h3 className="font-bold text-sm">{grupo.fazenda_origem} → {grupo.fazenda_destino} ({grupo.quantidade} cab)</h3>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="border border-black text-sm font-bold py-2">Data</TableHead>
                          <TableHead className="border border-black text-sm font-bold py-2 text-right">Quantidade</TableHead>
                          <TableHead className="border border-black text-sm font-bold py-2">Categoria</TableHead>
                          <TableHead className="border border-black text-sm font-bold py-2">Marca</TableHead>
                          <TableHead className="border border-black text-sm font-bold py-2">NF</TableHead>
                          <TableHead className="border border-black text-sm font-bold py-2">GTA</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {registrosExibir.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="border border-gray-300 text-sm py-2">{formatarData(m.data_movimentacao)}</TableCell>
                            <TableCell className="border border-gray-300 text-sm py-2 text-right font-semibold">{m.quantidade_animais} cab</TableCell>
                            <TableCell className="border border-gray-300 text-sm py-2">{m.categoria_animal || ''}</TableCell>
                            <TableCell className="border border-gray-300 text-sm py-2">{m.marca || ''}</TableCell>
                            <TableCell className="border border-gray-300 text-sm py-2">{m.nota_fiscal || ''}</TableCell>
                            <TableCell className="border border-gray-300 text-sm py-2">{m.gta || ''}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {!opcoesRelatorio.todos_registros && grupo.registros.length > 10 && (
                      <p className="text-xs text-slate-500 mt-1">... e mais {grupo.registros.length - 10} registro(s)</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {dadosRelatorio.tipo === 'analitico' && (
            Object.entries(dadosRelatorio.dados).map(([grupo, registros], idx) => {
              const totalGrupoEntradas = registros.filter(r => r.tipo === 'Entrada').reduce((s, r) => s + (r.quantidade_animais || 0), 0);
              const totalGrupoSaidas = registros.filter(r => r.tipo === 'Saída').reduce((s, r) => s + (r.quantidade_animais || 0), 0);
              const saldoGrupo = totalGrupoEntradas - totalGrupoSaidas;
              
              return (
                <div key={idx} className="mb-4">
                  {agrupamentosAtivos.length > 0 && (
                    <div className="bg-gray-200 px-2 py-1 mb-1">
                      <h3 className="font-bold text-xs">{grupo} ({registros.length} registro(s)) • Ent: +{formatarNumero(totalGrupoEntradas)} • Saí: -{formatarNumero(totalGrupoSaidas)} • Saldo: {saldoGrupo >= 0 ? '+' : ''}{formatarNumero(saldoGrupo)}</h3>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow className="border-black">
                        {colunasOrdenadas.map((coluna) => (
                          <TableHead key={coluna.id} className="border border-black text-xs font-bold py-1">
                            {coluna.label}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registros.map((m) => {
                        const areaExibir = m.tipo === 'Entrada' ? m.area_destino_nome : m.area_origem_nome;
                        return (
                          <TableRow key={m.id}>
                            {colunasOrdenadas.map((coluna) => {
                              switch (coluna.id) {
                                case 'data': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{formatarData(m.data_movimentacao)}</TableCell>;
                                case 'tipo': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.tipo || ''}</TableCell>;
                                case 'motivo': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.motivo || ''}</TableCell>;
                                case 'quantidade': return <TableCell key={coluna.id} className="border border-gray-300 text-xs text-right py-1">{m.quantidade_animais || ''}</TableCell>;
                                case 'categoria': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.categoria_animal || ''}</TableCell>;
                                case 'categoria_nova': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.categoria_nova || ''}</TableCell>;
                                case 'marca': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.marca || ''}</TableCell>;
                                case 'sexo': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.sexo || ''}</TableCell>;
                                case 'peso_medio': return <TableCell key={coluna.id} className="border border-gray-300 text-xs text-right py-1">{m.peso_medio ? `${m.peso_medio} kg` : ''}</TableCell>;
                                case 'peso_total': return <TableCell key={coluna.id} className="border border-gray-300 text-xs text-right py-1">{m.peso_total ? `${m.peso_total} kg` : ''}</TableCell>;
                                case 'area_origem': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.area_origem_nome || ''}</TableCell>;
                                case 'area_destino': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.area_destino_nome || ''}</TableCell>;
                                case 'area': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{areaExibir || ''}</TableCell>;
                                case 'fornecedor': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.fornecedor_origem || ''}</TableCell>;
                                case 'comprador': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.destino_venda || ''}</TableCell>;
                                case 'nota_fiscal': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.nota_fiscal || ''}</TableCell>;
                                case 'gta': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.gta || ''}</TableCell>;
                                case 'causa_morte': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.causa_morte || ''}</TableCell>;
                                case 'transf_origem': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.transferencia_origem || ''}</TableCell>;
                                case 'transf_destino': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.transferencia_destino || ''}</TableCell>;
                                case 'valor_unitario': return <TableCell key={coluna.id} className="border border-gray-300 text-xs text-right py-1">{m.valor_unitario ? `R$ ${m.valor_unitario.toFixed(2)}` : ''}</TableCell>;
                                case 'valor_total': return <TableCell key={coluna.id} className="border border-gray-300 text-xs text-right py-1">{m.valor_total ? `R$ ${m.valor_total.toFixed(2)}` : ''}</TableCell>;
                                case 'observacoes': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1 max-w-[100px] truncate" title={m.observacoes}>{m.observacoes || ''}</TableCell>;
                                case 'responsavel': return <TableCell key={coluna.id} className="border border-gray-300 text-xs py-1">{m.created_by || ''}</TableCell>;
                                default: return null;
                              }
                            })}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              );
            })
          )}

          {/* Rodapé */}
          <div className="mt-4 border-t-2 border-black pt-2">
            <div className="flex justify-between items-center">
              <div className="text-xs font-bold">TOTAL: {movimentacoesPorTipoRelatorio.length} registro(s)</div>
              <div className="text-xs font-bold">
                Entradas: +{formatarNumero(totalEntradas)} cab | Saídas: -{formatarNumero(totalSaidas)} cab | Saldo: {saldoPeriodo >= 0 ? '+' : ''}{formatarNumero(saldoPeriodo)} cab
              </div>
            </div>
          </div>

          <div className="mt-6 pt-2 border-t border-gray-300 text-center text-xs text-gray-500">
            <p>Impresso em: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>

      {/* Modal de Configuração de Colunas */}
      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-3 gap-2">
                {getColunasDisponiveis().map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={colunasVisiveis.includes(coluna.id)}
                      onChange={() => toggleColuna(coluna.id)}
                      className="rounded"
                    />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="colunas">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((colunaId, index) => {
                        const coluna = getColunasDisponiveis().find(c => c.id === colunaId);
                        if (!coluna) return null;
                        
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`flex items-center gap-2 p-2 border rounded text-xs ${
                                  snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'
                                } ${!colunasVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}
                              >
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasVisiveis.includes(colunaId) && (
                                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">Visível</Badge>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setShowConfigColunas(false)} size="sm" className="h-7 text-xs">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
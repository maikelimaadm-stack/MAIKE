
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Trash2, Search, Settings, Eye, ArrowUpDown, ArrowUp, ArrowDown, XCircle, CheckCircle, GripVertical, Download, MoreVertical, Calendar, Edit2, Layers, X, Package } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toast } from "sonner";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0";
  const num = typeof numero === 'number' ? numero : parseFloat(String(numero).replace(/\./g, '').replace(',', '.'));
  if (isNaN(num)) return "0";
  return num.toLocaleString('pt-BR');
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString + 'T00:00:00');
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
};

const calcularDias = (dataVencimento) => {
  if (!dataVencimento) return '-';
  try {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const venc = new Date(dataVencimento + 'T00:00:00');
    if (isNaN(venc.getTime())) return '-';
    venc.setHours(0, 0, 0, 0);
    const diff = Math.floor((venc - hoje) / (1000 * 60 * 60 * 24));
    
    if (diff > 0) return `${diff}d`;
    if (diff < 0) return `${Math.abs(diff)}d vencido`;
    return 'Hoje';
  } catch {
    return '-';
  }
};

const getBadgeStyle = (status) => {
  const styles = {
    'Pendente': 'bg-slate-100 text-slate-700 border-slate-300',
    'Pago Parcial': 'bg-blue-50 text-blue-700 border-blue-300',
    'Pago': 'bg-slate-100 text-slate-700 border-slate-300',
    'Vencido': 'bg-red-50 text-red-700 border-red-300',
    'Cancelado': 'bg-slate-100 text-slate-500 border-slate-300',
  };
  return styles[status] || 'bg-slate-100 text-slate-700 border';
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true },
  { id: 'parcela', label: 'Parcela', default: false },
  { id: 'emissao', label: 'Emissão', default: true },
  { id: 'vencimento', label: 'Vencimento', default: true },
  { id: 'dias', label: 'Dias', default: true },
  { id: 'fornecedor_cliente', label: 'Fornecedor/Cliente', default: true },
  { id: 'tipo_documento', label: 'Tipo Doc', default: true },
  { id: 'documento', label: 'Nº Doc', default: true },
  { id: 'chave_nfe', label: 'Chave NF-e', default: false },
  { id: 'serie', label: 'Série', default: false },
  { id: 'cfop', label: 'CFOP', default: false },
  { id: 'valor_total', label: 'Vlr. Total', default: true },
  { id: 'valor_pago', label: 'Vlr. Pago', default: true },
  { id: 'saldo', label: 'Vlr. Saldo', default: true },
  { id: 'status', label: 'Status', default: true },
  { id: 'safra', label: 'Safra', default: false },
  { id: 'centro_custo', label: 'Centro Custo', default: false },
  { id: 'plano_contas', label: 'Plano Contas', default: false },
  { id: 'grupo', label: 'Grupo', default: false },
  { id: 'forma_pagamento', label: 'Forma Pgto', default: false },
  { id: 'valor_produtos', label: 'Vlr. Produtos', default: false },
  { id: 'valor_frete', label: 'Vlr. Frete', default: false },
  { id: 'valor_seguro', label: 'Vlr. Seguro', default: false },
  { id: 'outras_despesas', label: 'Outras Desp.', default: false },
  { id: 'valor_desconto', label: 'Vlr. Desc.', default: false },
  { id: 'valor_ipi', label: 'IPI', default: false },
  { id: 'valor_icms', label: 'ICMS', default: false },
  { id: 'valor_pis', label: 'PIS', default: false },
  { id: 'valor_cofins', label: 'COFINS', default: false },
  { id: 'base_icms', label: 'Base ICMS', default: false },
];

export default function TabelaFinanceiro({ lancamentos, tipo, onEdit, onDelete, onBaixa, onCancelarBaixa, isLoading, fornecedores, produtos, safras, centrosCusto, planosContas, gruposFinanceiros, onUpdateLote }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("vencimento");
  const [sortDirection, setSortDirection] = useState("asc");
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  const [produtosDialog, setProdutosDialog] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [selecionados, setSelecionados] = useState([]);
  const [parcelasDialog, setParcelasDialog] = useState(null);
  const [showEditarLote, setShowEditarLote] = useState(false);
  const [edicaoLote, setEdicaoLote] = useState({
    safra_id: "",
    centro_custo_id: "",
    plano_contas_id: "",
    grupo_id: "",
    observacoes: ""
  });
  
  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem(`colunas_ordem_financeiro_${tipo.toLowerCase()}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map(c => c.id);
  });
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem(`colunas_tabela_financeiro_${tipo.toLowerCase()}`);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const toggleColuna = (colunaId) => {
    const novasColunas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter(id => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    
    setColunasVisiveis(novasColunas);
    localStorage.setItem(`colunas_tabela_financeiro_${tipo.toLowerCase()}`, JSON.stringify(novasColunas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem(`colunas_ordem_financeiro_${tipo.toLowerCase()}`, JSON.stringify(items));
  };

  const colunasOrdenadas = colunasOrdem
    .map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id))
    .filter(c => c && colunasVisiveis.includes(c.id));

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const handleSelecionarTodos = () => {
    if (selecionados.length === lancamentosOrdenados.length && lancamentosOrdenados.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(lancamentosOrdenados.map(l => l.id));
    }
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleEditarEmLote = () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos um lançamento!');
      return;
    }
    setShowEditarLote(true);
  };

  const handleConfirmarEdicaoLote = async () => {
    const dadosParaAtualizar = {};
    
    if (edicaoLote.safra_id) {
      const safra = safras?.find(s => s.id === edicaoLote.safra_id);
      dadosParaAtualizar.safra_id = edicaoLote.safra_id;
      dadosParaAtualizar.safra_nome = safra ? `${safra.ano_inicio}/${safra.ano_fim}` : undefined;
    }
    
    if (edicaoLote.centro_custo_id) {
      const centro = centrosCusto?.find(c => c.id === edicaoLote.centro_custo_id);
      dadosParaAtualizar.centro_custo_id = edicaoLote.centro_custo_id;
      dadosParaAtualizar.centro_custo_nome = centro?.nome;
    }
    
    if (edicaoLote.plano_contas_id) {
      const plano = planosContas?.find(p => p.id === edicaoLote.plano_contas_id);
      dadosParaAtualizar.plano_contas_id = edicaoLote.plano_contas_id;
      dadosParaAtualizar.plano_contas_nome = plano ? `${plano.codigo} - ${plano.descricao}` : undefined;
    }
    
    if (edicaoLote.grupo_id) {
      const grupo = gruposFinanceiros?.find(g => g.id === edicaoLote.grupo_id);
      dadosParaAtualizar.grupo_id = edicaoLote.grupo_id;
      dadosParaAtualizar.grupo_nome = grupo?.descricao;
    }
    
    if (edicaoLote.observacoes) {
      dadosParaAtualizar.observacoes = edicaoLote.observacoes.toUpperCase();
    }

    if (Object.keys(dadosParaAtualizar).length === 0) {
      toast.error('Preencha ao menos um campo!');
      return;
    }

    if (window.confirm(`Confirma a edição de ${selecionados.length} lançamento(s)?`)) {
      await onUpdateLote(selecionados, dadosParaAtualizar);
      setShowEditarLote(false);
      setEdicaoLote({ safra_id: "", centro_custo_id: "", plano_contas_id: "", grupo_id: "", observacoes: "" });
      setSelecionados([]);
      toast.success(`${selecionados.length} lançamento(s) atualizado(s)!`);
    }
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos um lançamento!');
      return;
    }

    if (window.confirm(`⚠️ Confirma a exclusão de ${selecionados.length} lançamento(s)?`)) {
      let excluidos = 0;
      for (const id of selecionados) {
        try {
          await onDelete(id, true);
          excluidos++;
        } catch (error) {
          console.error('Erro:', error);
        }
      }
      setSelecionados([]);
      toast.success(`${excluidos} lançamento(s) excluído(s)!`);
    }
  };

  const handleExportarSelecionados = () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos um lançamento!');
      return;
    }
    
    const lancamentosSelecionados = lancamentos.filter(l => selecionados.includes(l.id));
    
    const csvRows = [];
    const headers = ['Nº', 'Emissão', 'Vencimento', 'Fornecedor/Cliente', 'Tipo Doc', 'Nº Doc', 'Valor Total', 'Valor Pago', 'Saldo', 'Status'];
    csvRows.push(headers.join(';'));

    lancamentosSelecionados.forEach(l => {
      const row = [
        l.numero_lancamento || '',
        formatarData(l.data_emissao),
        formatarData(l.data_vencimento),
        l.fornecedor_nome || l.cliente_nome || '',
        l.tipo_documento || '',
        l.numero_documento || '',
        l.valor_total || 0,
        l.valor_pago || 0,
        (l.valor_total || 0) - (l.valor_pago || 0),
        l.status || ''
      ];
      csvRows.push(row.join(';'));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `lancamentos_selecionados_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success(`${selecionados.length} lançamento(s) exportado(s)!`);
  };

  const lancamentosFiltrados = lancamentos.filter((l) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      l.numero_lancamento?.toLowerCase().includes(search) ||
      l.fornecedor_nome?.toLowerCase().includes(search) ||
      l.cliente_nome?.toLowerCase().includes(search) ||
      l.numero_documento?.toLowerCase().includes(search) ||
      l.tipo_documento?.toLowerCase().includes(search)
    );
  });

  const lancamentosOrdenados = [...lancamentosFiltrados].sort((a, b) => {
    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a?.numero_lancamento) || 0;
        bValue = parseInt(b?.numero_lancamento) || 0;
        break;
      case 'emissao':
        aValue = new Date(a?.data_emissao).getTime();
        bValue = new Date(b?.data_emissao).getTime();
        break;
      case 'vencimento':
        aValue = new Date(a?.data_vencimento).getTime();
        bValue = new Date(b?.data_vencimento).getTime();
        break;
      case 'fornecedor_cliente':
        aValue = (a?.fornecedor_nome || a?.cliente_nome || '').toLowerCase();
        bValue = (b?.fornecedor_nome || b?.cliente_nome || '').toLowerCase();
        break;
      case 'valor_total':
        aValue = a?.valor_total || 0;
        bValue = b?.valor_total || 0;
        break;
      case 'saldo':
        aValue = (a?.valor_total || 0) - (a?.valor_pago || 0);
        bValue = (b?.valor_total || 0) - (b?.valor_pago || 0);
        break;
      case 'status':
        aValue = (a?.status || '').toLowerCase();
        bValue = (b?.status || '').toLowerCase();
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const abrirDetalhes = (lancamento) => {
    setDetalhesAberto(lancamento);
  };

  const abrirParcelas = (lancamento) => {
    setParcelasDialog(lancamento);
  };

  const abrirProdutos = (lancamento) => {
    setProdutosDialog(lancamento);
  };

  const fornecedorDoLancamento = (lancamento) => fornecedores?.find(f => f.id === lancamento?.fornecedor_id);

  const renderCell = (coluna, lancamento) => {
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="font-semibold text-xs">{formatarNumero(parseInt(lancamento?.numero_lancamento || 0))}</TableCell>;
      case 'parcela':
        return (
          <TableCell className="text-xs text-center">
            {lancamento?.numero_parcela && lancamento?.total_parcelas ? (
              <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-300 text-[10px]">
                {lancamento.numero_parcela}/{lancamento.total_parcelas}
              </Badge>
            ) : '-'}
          </TableCell>
        );
      case 'emissao':
        return <TableCell className="text-xs text-slate-600">{formatarData(lancamento?.data_emissao)}</TableCell>;
      case 'vencimento':
        return <TableCell className="text-xs text-slate-600">{formatarData(lancamento?.data_vencimento)}</TableCell>;
      case 'dias':
        return (
          <TableCell className="text-xs">
            {(lancamento?.status === 'Pendente' || lancamento?.status === 'Pago Parcial') && (
              <span className={`font-medium ${calcularDias(lancamento?.data_vencimento).includes('vencido') ? 'text-red-600' : 'text-slate-600'}`}>
                {calcularDias(lancamento?.data_vencimento)}
              </span>
            )}
          </TableCell>
        );
      case 'fornecedor_cliente':
        return <TableCell className="max-w-xs truncate text-xs">{lancamento?.fornecedor_nome || lancamento?.cliente_nome || '-'}</TableCell>;
      case 'tipo_documento':
        return <TableCell className="text-xs text-slate-600">{lancamento?.tipo_documento || '-'}</TableCell>;
      case 'documento':
        return <TableCell className="font-mono text-xs text-slate-600">{lancamento?.numero_documento || '-'}</TableCell>;
      case 'chave_nfe':
        return <TableCell className="font-mono text-[10px] text-slate-600 max-w-[120px] truncate" title={lancamento?.chave_nfe}>{lancamento?.chave_nfe || '-'}</TableCell>;
      case 'serie':
        return <TableCell className="text-xs text-slate-600">{lancamento?.serie_documento || '-'}</TableCell>;
      case 'cfop':
        return <TableCell className="text-xs font-mono text-slate-600">{lancamento?.cfop || '-'}</TableCell>;
      case 'valor_total':
        return <TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda(lancamento?.valor_total || 0)}</TableCell>;
      case 'valor_pago':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_pago || 0)}</TableCell>;
      case 'saldo':
        return <TableCell className="text-right font-mono text-xs font-semibold text-slate-700">{formatarMoeda((lancamento?.valor_total || 0) - (lancamento?.valor_pago || 0))}</TableCell>;
      case 'status':
        return (
          <TableCell>
            <div className="flex flex-col gap-1">
              <Badge variant="outline" className={`${getBadgeStyle(lancamento?.status)} text-xs`}>
                {lancamento?.status}
              </Badge>
              {lancamento?.parcelas && lancamento.parcelas.length > 0 && (
                <Badge 
                  variant="outline" 
                  className="bg-violet-50 text-violet-700 border-violet-300 text-[10px] cursor-pointer hover:bg-violet-100" 
                  onClick={() => abrirParcelas(lancamento)}
                >
                  <Calendar className="w-2.5 h-2.5 mr-0.5" />
                  {lancamento.parcelas.length} parcela(s)
                </Badge>
              )}
            </div>
          </TableCell>
        );
      case 'safra':
        return <TableCell className="text-xs text-slate-600">{lancamento?.safra_nome || '-'}</TableCell>;
      case 'centro_custo':
        return <TableCell className="text-xs text-slate-600 max-w-xs truncate">{lancamento?.centro_custo_nome || '-'}</TableCell>;
      case 'plano_contas':
        return <TableCell className="text-xs max-w-xs truncate text-slate-600">{lancamento?.plano_contas_nome || '-'}</TableCell>;
      case 'grupo':
        return <TableCell className="text-xs text-slate-600">{lancamento?.grupo_nome || '-'}</TableCell>;
      case 'forma_pagamento':
        return <TableCell className="text-xs text-slate-600">{lancamento?.forma_pagamento_nome || '-'}</TableCell>;
      case 'valor_produtos':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_produtos || 0)}</TableCell>;
      case 'valor_frete':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_frete || 0)}</TableCell>;
      case 'valor_seguro':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_seguro || 0)}</TableCell>;
      case 'outras_despesas':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_outras_despesas || 0)}</TableCell>;
      case 'valor_desconto':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_desconto_total || 0)}</TableCell>;
      case 'valor_ipi':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_ipi || 0)}</TableCell>;
      case 'valor_icms':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_icms || 0)}</TableCell>;
      case 'valor_pis':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_pis || 0)}</TableCell>;
      case 'valor_cofins':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_cofins || 0)}</TableCell>;
      case 'base_icms':
        return <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.base_calculo_icms || 0)}</TableCell>;
      default:
        return <TableCell className="text-xs">-</TableCell>;
    }
  };

  return (
    <>
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-2">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Contas a {tipo} ({lancamentos.length})
            </CardTitle>
            <div className="flex gap-2 items-center">
              {selecionados.length > 0 && (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
                  <span className="text-xs font-semibold text-emerald-800">
                    {selecionados.length} selecionado(s)
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5">
                        <MoreVertical className="w-4 h-4 text-emerald-700" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleEditarEmLote} className="text-xs">
                        <Edit2 className="w-3.5 h-3.5 mr-2" />
                        Editar Lote
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleExportarSelecionados} className="text-xs">
                        <Download className="w-3.5 h-3.5 mr-2" />
                        Exportar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleExcluirEmMassa} className="text-xs text-red-600">
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Excluir
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setSelecionados([])} className="text-xs">
                        <X className="w-3.5 h-3.5 mr-2" />
                        Limpar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setShowConfigColunas(true)}>
                <Settings className="w-3.5 h-3.5" />
                Colunas
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b">
                  <TableHead className="w-8 text-xs">
                    <Checkbox 
                      checked={selecionados.length === lancamentosOrdenados.length && lancamentosOrdenados.length > 0}
                      onCheckedChange={handleSelecionarTodos}
                    />
                  </TableHead>
                  <TableHead className="text-xs text-center w-8"></TableHead>
                  {colunasOrdenadas.map((coluna) => {
                    const isSortable = ['numero', 'emissao', 'vencimento', 'fornecedor_cliente', 'valor_total', 'saldo', 'status'].includes(coluna.id);
                    return (
                      <TableHead 
                        key={coluna.id}
                        className={`text-xs ${isSortable ? 'cursor-pointer hover:bg-slate-100' : ''}`}
                        onClick={() => isSortable && handleSort(coluna.id)}
                      >
                        <div className="flex items-center">
                          {coluna.label}
                          {isSortable && getSortIcon(coluna.id)}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                    </TableRow>
                  ) : lancamentosOrdenados.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhum lançamento</TableCell>
                    </TableRow>
                  ) : (
                    lancamentosOrdenados.map((lancamento) => {
                      if (!lancamento) return null;
                      const temProdutos = lancamento.produtos_lancamento && lancamento.produtos_lancamento.length > 0;
                      
                      return (
                        <motion.tr 
                          key={lancamento.id}
                          initial={{ opacity: 0 }} 
                          animate={{ opacity: 1 }} 
                          exit={{ opacity: 0 }} 
                          className="hover:bg-slate-50 transition-colors border-b"
                        >
                          <TableCell>
                            <Checkbox
                              checked={selecionados.includes(lancamento.id)}
                              onCheckedChange={() => handleToggleSelecao(lancamento.id)}
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem onClick={() => abrirDetalhes(lancamento)} className="text-xs">
                                  <Eye className="w-3.5 h-3.5 mr-2" />
                                  Ver Detalhes
                                </DropdownMenuItem>
                                {temProdutos && (
                                  <DropdownMenuItem onClick={() => abrirProdutos(lancamento)} className="text-xs">
                                    <Package className="w-3.5 h-3.5 mr-2" />
                                    Ver Produtos ({lancamento.produtos_lancamento.length})
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => onEdit(lancamento)} className="text-xs">
                                  <Edit className="w-3.5 h-3.5 mr-2" />
                                  Editar
                                </DropdownMenuItem>
                                {lancamento.parcelas && lancamento.parcelas.length > 0 && (
                                  <DropdownMenuItem onClick={() => abrirParcelas(lancamento)} className="text-xs">
                                    <Calendar className="w-3.5 h-3.5 mr-2" />
                                    Ver Parcelas ({lancamento.parcelas.length})
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                {lancamento?.status !== 'Pago' && lancamento?.status !== 'Cancelado' && (
                                  <DropdownMenuItem onClick={() => onBaixa(lancamento)} className="text-xs">
                                    <CheckCircle className="w-3.5 h-3.5 mr-2 text-emerald-600" />
                                    Dar Baixa
                                  </DropdownMenuItem>
                                )}
                                {lancamento?.status === 'Pago' && onCancelarBaixa && (
                                  <DropdownMenuItem onClick={() => onCancelarBaixa(lancamento)} className="text-xs">
                                    <XCircle className="w-3.5 h-3.5 mr-2 text-orange-600" />
                                    Cancelar Baixa
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => onDelete(lancamento.id)} className="text-xs text-red-600">
                                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                                  Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          {colunasOrdenadas.map(coluna => (
                            <React.Fragment key={coluna.id}>
                              {renderCell(coluna, lancamento)}
                            </React.Fragment>
                          ))}
                        </motion.tr>
                      );
                    })
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showEditarLote} onOpenChange={setShowEditarLote}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              Editar {selecionados.length} Lançamento(s) em Lote
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-2">
              <p className="text-xs text-blue-800">
                💡 Apenas campos preenchidos serão atualizados. Valores e produtos não podem ser alterados em lote.
              </p>
            </div>

            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Safra</Label>
                <Select value={edicaoLote.safra_id} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, safra_id: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Manter atual" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null} className="text-xs">Não alterar</SelectItem>
                    {safras?.map(s => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">{s.ano_inicio}/{s.ano_fim}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Centro de Custo</Label>
                <Select value={edicaoLote.centro_custo_id} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, centro_custo_id: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Manter atual" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null} className="text-xs">Não alterar</SelectItem>
                    {centrosCusto?.map(c => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Plano de Contas</Label>
                <Select value={edicaoLote.plano_contas_id} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, plano_contas_id: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Manter atual" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null} className="text-xs">Não alterar</SelectItem>
                    {planosContas?.map(p => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">{p.codigo} - {p.descricao}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Grupo Financeiro</Label>
                <Select value={edicaoLote.grupo_id} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, grupo_id: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Manter atual" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null} className="text-xs">Não alterar</SelectItem>
                    {gruposFinanceiros?.map(g => (
                      <SelectItem key={g.id} value={g.id} className="text-xs">{g.codigo} - {g.descricao}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações (sobrescrever)</Label>
                <Textarea 
                  value={edicaoLote.observacoes} 
                  onChange={(e) => setEdicaoLote({ ...edicaoLote, observacoes: e.target.value })} 
                  placeholder="NOVA OBSERVAÇÃO..." 
                  className="text-xs uppercase" 
                  style={{ textTransform: 'uppercase' }}
                  rows={2} 
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowEditarLote(false)} size="sm" className="h-7 text-xs">
                Cancelar
              </Button>
              <Button onClick={handleConfirmarEdicaoLote} size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700">
                Atualizar {selecionados.length}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {COLUNAS_DISPONIVEIS.map((coluna) => (
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
                        const coluna = COLUNAS_DISPONIVEIS.find(c => c.id === colunaId);
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

      <Dialog open={!!parcelasDialog} onOpenChange={(open) => !open && setParcelasDialog(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Parcelas - Lançamento #{parcelasDialog?.numero_lancamento}</DialogTitle>
          </DialogHeader>
          {parcelasDialog && (
            <div className="space-y-3">
              <Card className="shadow-sm border-slate-200">
                <CardContent className="p-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><strong>Fornecedor/Cliente:</strong> {parcelasDialog.fornecedor_nome || parcelasDialog.cliente_nome || '-'}</div>
                    <div><strong>Documento:</strong> {parcelasDialog.numero_documento || '-'}</div>
                    <div><strong>Total:</strong> {formatarMoeda(parcelasDialog.valor_total || 0)}</div>
                    <div><strong>Pago:</strong> {formatarMoeda(parcelasDialog.valor_pago || 0)}</div>
                    <div className="col-span-2"><strong>Saldo:</strong> {formatarMoeda((parcelasDialog.valor_total || 0) - (parcelasDialog.valor_pago || 0))}</div>
                  </div>
                </CardContent>
              </Card>

              <div className="border rounded overflow-auto max-h-96">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Nº</TableHead>
                      <TableHead className="text-xs">Lançamento</TableHead>
                      <TableHead className="text-xs">Vencimento</TableHead>
                      <TableHead className="text-xs text-right">Valor</TableHead>
                      <TableHead className="text-xs text-right">Pago</TableHead>
                      <TableHead className="text-xs text-right">Saldo</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parcelasDialog.parcelas?.map((parcela, index) => {
                      const valorParcela = parcela.valor || 0;
                      const valorPago = parcela.valor_pago || 0;
                      const saldo = valorParcela - valorPago;
                      const isPaga = saldo <= 0.01;
                      
                      return (
                        <TableRow key={index}>
                          <TableCell className="font-semibold text-xs">{index + 1}/{parcelasDialog.parcelas.length}</TableCell>
                          <TableCell className="text-xs">
                            <div className="flex flex-col">
                              <span className="font-semibold">#{parcela.numero_lancamento || '-'}</span>
                              <span className="text-[10px] text-slate-500">{parcela.tipo_documento || '-'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{formatarData(parcela.data)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatarMoeda(valorParcela)}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(valorPago)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda(saldo)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${isPaga ? 'bg-slate-100 text-slate-700' : 'bg-orange-50 text-orange-700 border-orange-300'}`}>
                              {isPaga ? 'Paga' : 'Pendente'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!produtosDialog} onOpenChange={(open) => !open && setProdutosDialog(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Produtos - Lançamento #{produtosDialog?.numero_lancamento}</DialogTitle>
          </DialogHeader>
          {produtosDialog && (
            <div className="space-y-3">
              <Card className="shadow-sm border-slate-200">
                <CardContent className="p-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><strong>Fornecedor:</strong> {produtosDialog.fornecedor_nome || '-'}</div>
                    <div><strong>Documento:</strong> {produtosDialog.numero_documento || '-'}</div>
                    <div><strong>Data Emissão:</strong> {formatarData(produtosDialog.data_emissao)}</div>
                    <div><strong>Total Nota:</strong> {formatarMoeda(produtosDialog.valor_total || 0)}</div>
                  </div>
                </CardContent>
              </Card>

              <div className="border rounded overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="text-xs">Produto</TableHead>
                      <TableHead className="text-xs text-right">Quantidade</TableHead>
                      <TableHead className="text-xs text-center">Unidade</TableHead>
                      <TableHead className="text-xs text-right">Vlr. Unit.</TableHead>
                      <TableHead className="text-xs text-right">Total</TableHead>
                      <TableHead className="text-xs text-right">Desconto</TableHead>
                      <TableHead className="text-xs text-right">Líquido</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produtosDialog.produtos_lancamento?.map((produto, index) => {
                      const valorTotal = produto.valor_total || 0;
                      const desconto = produto.desconto_item || 0;
                      const liquido = valorTotal - desconto;
                      
                      return (
                        <TableRow key={index}>
                          <TableCell className="text-xs font-medium">{produto.produto_nome || '-'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{produto.quantidade?.toFixed(2) || '0.00'}</TableCell>
                          <TableCell className="text-center font-mono text-xs">{produto.unidade || '-'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatarMoeda(produto.valor_unitario || 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatarMoeda(valorTotal)}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-red-600">{formatarMoeda(desconto)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">{formatarMoeda(liquido)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-slate-100 border-t-2 font-semibold">
                      <TableCell colSpan={4} className="text-xs">TOTAL</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatarMoeda(produtosDialog.produtos_lancamento?.reduce((s, p) => s + (p.valor_total || 0), 0) || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-red-600">
                        {formatarMoeda(produtosDialog.produtos_lancamento?.reduce((s, p) => s + (p.desconto_item || 0), 0) || 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-700 font-bold">
                        {formatarMoeda(produtosDialog.produtos_lancamento?.reduce((s, p) => s + ((p.valor_total || 0) - (p.desconto_item || 0)), 0) || 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detalhesAberto} onOpenChange={(open) => !open && setDetalhesAberto(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">Lançamento #{detalhesAberto?.numero_lancamento}</DialogTitle>
          </DialogHeader>
          {detalhesAberto && (
            <div className="space-y-3">
              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold">Informações Gerais</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-xs">
                  <div><strong>Nº:</strong> {formatarNumero(parseInt(detalhesAberto.numero_lancamento))}</div>
                  <div><strong>Tipo:</strong> {detalhesAberto.tipo}</div>
                  {detalhesAberto.numero_parcela && detalhesAberto.total_parcelas && (
                    <div><strong>Parcela:</strong> {detalhesAberto.numero_parcela}/{detalhesAberto.total_parcelas}</div>
                  )}
                  <div><strong>Emissão:</strong> {formatarData(detalhesAberto.data_emissao)}</div>
                  <div><strong>Vencimento:</strong> {formatarData(detalhesAberto.data_vencimento)}</div>
                  <div><strong>Tipo Doc:</strong> {detalhesAberto.tipo_documento || '-'}</div>
                  <div><strong>Nº Doc:</strong> {detalhesAberto.numero_documento || '-'}</div>
                  {detalhesAberto.chave_nfe && (
                    <div className="col-span-2"><strong>Chave NF-e:</strong> <span className="font-mono text-[10px]">{detalhesAberto.chave_nfe}</span></div>
                  )}
                </CardContent>
              </Card>

              {tipo === 'Pagar' && detalhesAberto.fornecedor_id && (
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold">Fornecedor</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs">
                    {(() => {
                      const fornecedor = fornecedorDoLancamento(detalhesAberto);
                      return fornecedor ? (
                        <>
                          <div><strong>Nome:</strong> {fornecedor.nome}</div>
                          <div><strong>CPF/CNPJ:</strong> {fornecedor.cpf || fornecedor.cnpj || '-'}</div>
                        </>
                      ) : <div className="text-slate-500">Não encontrado</div>;
                    })()}
                  </CardContent>
                </Card>
              )}

              <Card className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-semibold">Valores</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-xs">
                  <div><strong>Vlr. Total:</strong> <span className="font-semibold">{formatarMoeda(detalhesAberto.valor_total || 0)}</span></div>
                  <div><strong>Vlr. Pago:</strong> <span className="text-slate-600">{formatarMoeda(detalhesAberto.valor_pago || 0)}</span></div>
                  <div className="col-span-2"><strong>Vlr. Saldo:</strong> <span className="font-semibold">{formatarMoeda((detalhesAberto.valor_total || 0) - (detalhesAberto.valor_pago || 0))}</span></div>
                </CardContent>
              </Card>

              {detalhesAberto.produtos_lancamento && detalhesAberto.produtos_lancamento.length > 0 && (
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold">Produtos Lançados</CardTitle>
                  </CardHeader>
                  <CardContent className="p-2">
                    <div className="border rounded overflow-auto max-h-60">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50">
                            <TableHead className="text-xs">Produto</TableHead>
                            <TableHead className="text-xs text-right">Qtd</TableHead>
                            <TableHead className="text-xs text-center">UN</TableHead>
                            <TableHead className="text-xs text-right">Vlr. Unit.</TableHead>
                            <TableHead className="text-xs text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detalhesAberto.produtos_lancamento.map((prod, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="text-xs">{prod.produto_nome || '-'}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{prod.quantidade?.toFixed(2) || '0.00'}</TableCell>
                              <TableCell className="text-center font-mono text-xs">{prod.unidade || '-'}</TableCell>
                              <TableCell className="text-right font-mono text-xs">{formatarMoeda(prod.valor_unitario || 0)}</TableCell>
                              <TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda((prod.valor_total || 0) - (prod.desconto_item || 0))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {detalhesAberto.observacoes && (
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold">Observações</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs whitespace-pre-wrap bg-slate-50 p-2 rounded">{detalhesAberto.observacoes}</p>
                  </CardContent>
                </Card>
              )}

              {detalhesAberto.observacoes_nfe && (
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-semibold">Observações NF-e</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs whitespace-pre-wrap bg-slate-50 p-2 rounded">{detalhesAberto.observacoes_nfe}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

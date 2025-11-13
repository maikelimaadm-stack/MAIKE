import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Trash2, Search, Settings, Eye, ArrowUpDown, ArrowUp, ArrowDown, XCircle, CheckCircle, GripVertical, FileText, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export default function TabelaFinanceiro({ lancamentos, tipo, onEdit, onDelete, onBaixa, onCancelarBaixa, isLoading, fornecedores, produtos }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("vencimento");
  const [sortDirection, setSortDirection] = useState("asc");
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [selecionados, setSelecionados] = useState([]);
  
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

  const handleBaixaEmMassa = () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos um lançamento!');
      return;
    }
    toast.info('Funcionalidade em desenvolvimento');
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
          await onDelete(id, true); // skipConfirm = true
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

  const fornecedorDoLancamento = (lancamento) => fornecedores?.find(f => f.id === lancamento?.fornecedor_id);

  const renderCell = (coluna, lancamento) => {
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="font-semibold text-xs">{formatarNumero(parseInt(lancamento?.numero_lancamento || 0))}</TableCell>;
      case 'emissao':
        return <TableCell className="text-xs text-slate-600">{formatarData(lancamento?.data_emissao)}</TableCell>;
      case 'vencimento':
        return <TableCell className="text-xs text-slate-600">{formatarData(lancamento?.data_vencimento)}</TableCell>;
      case 'dias':
        return (
          <TableCell className="text-xs">
            {lancamento?.status === 'Pendente' && (
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
        return <TableCell><Badge variant="outline" className={`${getBadgeStyle(lancamento?.status)} text-xs`}>{lancamento?.status}</Badge></TableCell>;
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
        <CardHeader className="bg-slate-50 border-b border-slate-200">
          <CardTitle className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">
              Contas a {tipo} ({lancamentos.length})
            </span>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setShowConfigColunas(true)}>
                <Settings className="w-3.5 h-3.5" />
                Colunas
              </Button>
            </div>
          </CardTitle>
        </CardHeader>

        {selecionados.length > 0 && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-800">
                {selecionados.length} lançamento(s) selecionado(s)
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleExportarSelecionados} className="h-7 gap-1 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-100">
                  <Download className="w-3 h-3" />
                  Exportar
                </Button>
                <Button size="sm" variant="outline" onClick={handleExcluirEmMassa} className="h-7 gap-1 text-xs border-red-300 text-red-700 hover:bg-red-100">
                  <Trash2 className="w-3 h-3" />
                  Excluir
                </Button>
                <Button size="sm" variant="outline" onClick={() => setSelecionados([])} className="h-7 gap-1 text-xs">
                  Limpar
                </Button>
              </div>
            </div>
          </div>
        )}

        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b">
                  <TableHead className="w-10 text-xs">
                    <Checkbox 
                      checked={selecionados.length === lancamentosOrdenados.length && lancamentosOrdenados.length > 0}
                      onCheckedChange={handleSelecionarTodos}
                    />
                  </TableHead>
                  <TableHead className="text-xs text-center w-[120px]">Ações</TableHead>
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
                            <div className="flex gap-1 justify-center">
                              <Button variant="ghost" size="icon" onClick={() => abrirDetalhes(lancamento)} className="h-7 w-7" title="Ver Detalhes">
                                <Eye className="w-3.5 h-3.5 text-slate-600" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => onEdit(lancamento)} className="h-7 w-7" title="Editar">
                                <Edit className="w-3.5 h-3.5 text-slate-600" />
                              </Button>
                              {lancamento?.status !== 'Pago' && lancamento?.status !== 'Cancelado' && (
                                <Button variant="ghost" size="icon" onClick={() => onBaixa(lancamento)} className="h-7 w-7" title="Dar Baixa">
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                                </Button>
                              )}
                              {lancamento?.status === 'Pago' && onCancelarBaixa && (
                                <Button variant="ghost" size="icon" onClick={() => onCancelarBaixa(lancamento)} className="h-7 w-7" title="Cancelar Baixa">
                                  <XCircle className="w-3.5 h-3.5 text-orange-600" />
                                </Button>
                              )}
                              <Button variant="ghost" size="icon" onClick={() => onDelete(lancamento.id)} className="h-7 w-7" title="Excluir">
                                <Trash2 className="w-3.5 h-3.5 text-red-600" />
                              </Button>
                            </div>
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
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
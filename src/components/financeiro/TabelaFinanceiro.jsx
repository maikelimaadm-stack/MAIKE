import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, DollarSign, Search, Settings, Eye, ArrowUpDown, ArrowUp, ArrowDown, Package, XCircle } from "lucide-react";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

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

const formatarNumeroDecimal = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  const num = typeof numero === 'number' ? numero : parseFloat(String(numero).replace(/\./g, '').replace(',', '.'));
  if (isNaN(num)) return "0,00";
  return num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
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

const formatarDataHora = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR');
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
    
    if (diff > 0) return `${diff}d p/ vencer`;
    if (diff < 0) return `${Math.abs(diff)}d vencido`;
    return 'Vence hoje';
  } catch {
    return '-';
  }
};

const getBadgeStyle = (status) => {
  const styles = {
    'Pendente': 'bg-yellow-100 text-yellow-800',
    'Pago Parcial': 'bg-blue-100 text-blue-800',
    'Pago': 'bg-green-100 text-green-800',
    'Vencido': 'bg-red-100 text-red-800',
    'Cancelado': 'bg-gray-100 text-gray-800',
  };
  return styles[status] || 'bg-gray-100 text-gray-800';
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true },
  { id: 'emissao', label: 'Emissão', default: true },
  { id: 'vencimento', label: 'Vencimento', default: true },
  { id: 'dias', label: 'Dias', default: true },
  { id: 'fornecedor_cliente', label: 'Fornecedor/Cliente', default: true },
  { id: 'tipo_documento', label: 'Tipo Doc', default: true },
  { id: 'documento', label: 'Nº Doc', default: true },
  { id: 'valor_total', label: 'Vlr. Total', default: true },
  { id: 'valor_pago', label: 'Vlr. Pago', default: true },
  { id: 'saldo', label: 'Vlr. Saldo', default: true },
  { id: 'status', label: 'Status', default: true },
  { id: 'plano_contas', label: 'Plano Contas', default: false },
  { id: 'grupo', label: 'Grupo', default: false },
];

export default function TabelaFinanceiro({ lancamentos = [], tipo = "Pagar", onEdit, onDelete, onBaixa, onCancelarBaixa, isLoading = false, fornecedores = [], produtos = [] }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("vencimento");
  const [sortDirection, setSortDirection] = useState("asc");
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  const [produtosAberto, setProdutosAberto] = useState(null);
  
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

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  const lancamentosValidos = (lancamentos || []).filter(l => l !== null && l !== undefined);

  const lancamentosFiltrados = lancamentosValidos.filter((l) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      (l.numero_lancamento || '').toLowerCase().includes(search) ||
      (l.fornecedor_nome || '').toLowerCase().includes(search) ||
      (l.cliente_nome || '').toLowerCase().includes(search) ||
      (l.numero_documento || '').toLowerCase().includes(search) ||
      (l.tipo_documento || '').toLowerCase().includes(search) ||
      (l.plano_contas_nome || '').toLowerCase().includes(search) ||
      (l.grupo_nome || '').toLowerCase().includes(search)
    );
  });

  const lancamentosOrdenados = [...lancamentosFiltrados].sort((a, b) => {
    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_lancamento || '0') || 0;
        bValue = parseInt(b.numero_lancamento || '0') || 0;
        break;
      case 'emissao':
        aValue = new Date(a.data_emissao || 0).getTime();
        bValue = new Date(b.data_emissao || 0).getTime();
        break;
      case 'vencimento':
        aValue = new Date(a.data_vencimento || 0).getTime();
        bValue = new Date(b.data_vencimento || 0).getTime();
        break;
      case 'fornecedor_cliente':
        aValue = (a.fornecedor_nome || a.cliente_nome || '').toLowerCase();
        bValue = (b.fornecedor_nome || b.cliente_nome || '').toLowerCase();
        break;
      case 'valor_total':
        aValue = a.valor_total || 0;
        bValue = b.valor_total || 0;
        break;
      case 'valor_pago':
        aValue = a.valor_pago || 0;
        bValue = b.valor_pago || 0;
        break;
      case 'saldo':
        aValue = a.valor_saldo || a.valor_total || 0;
        bValue = b.valor_saldo || b.valor_total || 0;
        break;
      case 'status':
        aValue = (a.status || '').toLowerCase();
        bValue = (b.status || '').toLowerCase();
        break;
      default:
        return 0;
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <>
      <Card className="shadow-xl border-slate-200">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-blue-50 border-b py-4">
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-3 text-lg">
              <DollarSign className="w-6 h-6 text-emerald-600" />
              Contas a {tipo}
            </span>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input 
                  placeholder="Buscar..." 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  className="pl-10 w-64 h-9"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="Configurar Colunas" className="h-9 w-9">
                    <Settings className="w-4 h-4" />
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
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  {colunasVisiveis.includes('numero') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('numero')}>
                      <div className="flex items-center font-semibold">Nº {getSortIcon('numero')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('emissao') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('emissao')}>
                      <div className="flex items-center font-semibold">Emissão {getSortIcon('emissao')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('vencimento') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('vencimento')}>
                      <div className="flex items-center font-semibold">Vencimento {getSortIcon('vencimento')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('dias') && <TableHead className="font-semibold">Dias</TableHead>}
                  {colunasVisiveis.includes('fornecedor_cliente') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('fornecedor_cliente')}>
                      <div className="flex items-center font-semibold">{tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'} {getSortIcon('fornecedor_cliente')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('tipo_documento') && <TableHead className="font-semibold">Tipo Doc</TableHead>}
                  {colunasVisiveis.includes('documento') && <TableHead className="font-semibold">Nº Doc</TableHead>}
                  {colunasVisiveis.includes('valor_total') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('valor_total')}>
                      <div className="flex items-center justify-end font-semibold">Vlr. Total {getSortIcon('valor_total')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('valor_pago') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('valor_pago')}>
                      <div className="flex items-center justify-end font-semibold">Vlr. Pago {getSortIcon('valor_pago')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('saldo') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('saldo')}>
                      <div className="flex items-center justify-end font-semibold">Vlr. Saldo {getSortIcon('saldo')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('status') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100" onClick={() => handleSort('status')}>
                      <div className="flex items-center font-semibold">Status {getSortIcon('status')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('plano_contas') && <TableHead className="font-semibold">Plano Contas</TableHead>}
                  {colunasVisiveis.includes('grupo') && <TableHead className="font-semibold">Grupo</TableHead>}
                  <TableHead className="text-center font-semibold">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={20} className="text-center py-12 text-slate-400">
                        Carregando...
                      </TableCell>
                    </TableRow>
                  ) : lancamentosOrdenados.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={20} className="text-center py-12">
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                          <DollarSign className="w-12 h-12" />
                          <p className="text-lg font-medium">Nenhum lançamento encontrado</p>
                          <p className="text-sm">
                            {searchTerm ? 'Tente ajustar sua busca' : 'Comece criando um novo lançamento'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    lancamentosOrdenados.map((lancamento) => {
                      const temProdutos = lancamento.produtos_lancamento && Array.isArray(lancamento.produtos_lancamento) && lancamento.produtos_lancamento.length > 0;
                      const valorSaldo = lancamento.valor_saldo || lancamento.valor_total || 0;
                      const valorPago = lancamento.valor_pago || 0;
                      const valorTotal = lancamento.valor_total || 0;
                      
                      return (
                        <ContextMenu key={lancamento.id}>
                          <ContextMenuTrigger asChild>
                            <motion.tr 
                              initial={{ opacity: 0 }} 
                              animate={{ opacity: 1 }} 
                              exit={{ opacity: 0 }} 
                              className="hover:bg-slate-50 transition-colors cursor-pointer border-b"
                            >
                              {colunasVisiveis.includes('numero') && (
                                <TableCell className="font-bold text-slate-900">
                                  {formatarNumero(parseInt(lancamento.numero_lancamento || '0'))}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('emissao') && (
                                <TableCell className="text-xs text-slate-700">
                                  {formatarData(lancamento.data_emissao)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('vencimento') && (
                                <TableCell className="text-xs text-slate-700">
                                  {formatarData(lancamento.data_vencimento)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('dias') && (
                                <TableCell className="text-xs">
                                  {lancamento.status === 'Pendente' && (
                                    <span className={`font-medium ${calcularDias(lancamento.data_vencimento).includes('vencido') ? 'text-red-600' : 'text-blue-600'}`}>
                                      {calcularDias(lancamento.data_vencimento)}
                                    </span>
                                  )}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('fornecedor_cliente') && (
                                <TableCell className="max-w-xs truncate text-slate-900">
                                  {lancamento.fornecedor_nome || lancamento.cliente_nome || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('tipo_documento') && (
                                <TableCell className="text-xs text-slate-700">
                                  {lancamento.tipo_documento || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('documento') && (
                                <TableCell className="font-mono text-xs text-slate-700">
                                  {lancamento.numero_documento || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('valor_total') && (
                                <TableCell className="text-right font-mono font-semibold text-slate-900">
                                  {formatarMoeda(valorTotal)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('valor_pago') && (
                                <TableCell className="text-right font-mono text-blue-700">
                                  {formatarMoeda(valorPago)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('saldo') && (
                                <TableCell className="text-right font-mono font-bold text-red-700">
                                  {formatarMoeda(valorSaldo)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('status') && (
                                <TableCell>
                                  <Badge className={getBadgeStyle(lancamento.status)}>
                                    {lancamento.status || 'Pendente'}
                                  </Badge>
                                  {lancamento.numero_parcela && (
                                    <div className="text-xs text-slate-500 mt-1">
                                      Parcela {lancamento.numero_parcela}/{lancamento.total_parcelas}
                                    </div>
                                  )}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('plano_contas') && (
                                <TableCell className="text-xs max-w-xs truncate text-slate-700">
                                  {lancamento.plano_contas_nome || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('grupo') && (
                                <TableCell className="text-xs text-slate-700">
                                  {lancamento.grupo_nome || '-'}
                                </TableCell>
                              )}
                              <TableCell>
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setDetalhesAberto(lancamento)}
                                    className="h-8 w-8 hover:bg-blue-50 hover:text-blue-700"
                                    title="Ver Detalhes"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onEdit && onEdit(lancamento)}
                                    className="h-8 w-8 hover:bg-emerald-50 hover:text-emerald-700"
                                    title="Editar"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  {lancamento.status !== 'Pago' && lancamento.status !== 'Cancelado' && onBaixa && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => onBaixa(lancamento)}
                                      className="h-8 w-8 hover:bg-green-50 hover:text-green-700"
                                      title="Dar Baixa"
                                    >
                                      <DollarSign className="w-4 h-4" />
                                    </Button>
                                  )}
                                  {lancamento.status === 'Pago' && onCancelarBaixa && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => onCancelarBaixa(lancamento)}
                                      className="h-8 w-8 hover:bg-orange-50 hover:text-orange-700"
                                      title="Cancelar Baixa"
                                    >
                                      <XCircle className="w-4 h-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onDelete && onDelete(lancamento.id)}
                                    className="h-8 w-8 hover:bg-red-50 hover:text-red-700"
                                    title="Excluir"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </motion.tr>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => setDetalhesAberto(lancamento)}>
                              <Eye className="w-4 h-4 mr-2 text-blue-600" />
                              Ver Detalhes
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onEdit && onEdit(lancamento)}>
                              <Edit className="w-4 h-4 mr-2 text-emerald-600" />
                              Editar
                            </ContextMenuItem>
                            {temProdutos && (
                              <ContextMenuItem onClick={() => setProdutosAberto(lancamento)}>
                                <Package className="w-4 h-4 mr-2 text-green-600" />
                                Ver Produtos
                              </ContextMenuItem>
                            )}
                            {lancamento.status !== 'Pago' && lancamento.status !== 'Cancelado' && onBaixa && (
                              <ContextMenuItem onClick={() => onBaixa(lancamento)}>
                                <DollarSign className="w-4 h-4 mr-2 text-green-600" />
                                Dar Baixa
                              </ContextMenuItem>
                            )}
                            {lancamento.status === 'Pago' && onCancelarBaixa && (
                              <ContextMenuItem onClick={() => onCancelarBaixa(lancamento)}>
                                <XCircle className="w-4 h-4 mr-2 text-orange-600" />
                                Cancelar Baixa
                              </ContextMenuItem>
                            )}
                            <ContextMenuItem onClick={() => onDelete && onDelete(lancamento.id)}>
                              <Trash2 className="w-4 h-4 mr-2 text-red-600" />
                              Excluir
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* DIALOG DETALHES */}
      <Dialog open={!!detalhesAberto} onOpenChange={(open) => !open && setDetalhesAberto(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes do Lançamento #{detalhesAberto?.numero_lancamento || '-'}</DialogTitle>
          </DialogHeader>
          {detalhesAberto && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-base">Informações Gerais</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div><strong>Nº:</strong> {formatarNumero(parseInt(detalhesAberto.numero_lancamento || '0'))}</div>
                  <div><strong>Tipo:</strong> {detalhesAberto.tipo || '-'}</div>
                  <div><strong>Emissão:</strong> {formatarData(detalhesAberto.data_emissao)}</div>
                  <div><strong>Vencimento:</strong> {formatarData(detalhesAberto.data_vencimento)}</div>
                  <div><strong>Tipo Doc:</strong> {detalhesAberto.tipo_documento || '-'}</div>
                  <div><strong>Nº Doc:</strong> {detalhesAberto.numero_documento || '-'}</div>
                  <div><strong>Fornecedor/Cliente:</strong> {detalhesAberto.fornecedor_nome || detalhesAberto.cliente_nome || '-'}</div>
                </CardContent>
              </Card>

              <Card className="bg-green-50 border-green-200">
                <CardHeader><CardTitle className="text-base">Valores</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2 text-lg">
                    <strong>Vlr. Total:</strong> 
                    <span className="text-blue-700 font-bold ml-2">
                      {formatarMoeda(detalhesAberto.valor_total || 0)}
                    </span>
                  </div>
                  <div className="text-blue-700">
                    <strong>Vlr. Pago:</strong> {formatarMoeda(detalhesAberto.valor_pago || 0)}
                  </div>
                  <div className="text-red-700">
                    <strong>Vlr. Saldo:</strong> {formatarMoeda(detalhesAberto.valor_saldo || detalhesAberto.valor_total || 0)}
                  </div>
                </CardContent>
              </Card>

              {detalhesAberto.observacoes && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap bg-slate-50 p-3 rounded">
                      {detalhesAberto.observacoes}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* DIALOG PRODUTOS */}
      <Dialog open={!!produtosAberto} onOpenChange={(open) => !open && setProdutosAberto(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-green-600" />
              Produtos - Lançamento #{produtosAberto?.numero_lancamento || '-'}
            </DialogTitle>
          </DialogHeader>
          {produtosAberto?.produtos_lancamento && Array.isArray(produtosAberto.produtos_lancamento) && produtosAberto.produtos_lancamento.length > 0 ? (
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead>UN</TableHead>
                      <TableHead className="text-right">Vlr. Unit.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {produtosAberto.produtos_lancamento.map((pl, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-semibold">{pl.produto_nome || '-'}</TableCell>
                        <TableCell className="text-right font-mono">{formatarNumeroDecimal(pl.quantidade || 0)}</TableCell>
                        <TableCell className="text-xs">{pl.unidade || '-'}</TableCell>
                        <TableCell className="text-right font-mono">{formatarMoeda(pl.valor_unitario || 0)}</TableCell>
                        <TableCell className="text-right font-mono font-bold text-green-700">
                          {formatarMoeda((pl.quantidade || 0) * (pl.valor_unitario || 0))}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-green-100 font-bold">
                      <TableCell colSpan={4} className="text-right">TOTAL:</TableCell>
                      <TableCell className="text-right text-green-800">
                        {formatarMoeda(produtosAberto.produtos_lancamento.reduce((s, p) => s + ((p.quantidade || 0) * (p.valor_unitario || 0)), 0))}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Nenhum produto vinculado</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
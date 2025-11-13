import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Search, Settings, Eye, ArrowUpDown, ArrowUp, ArrowDown, XCircle, CheckCircle } from "lucide-react";
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
  { id: 'valor_total', label: 'Vlr. Total', default: true },
  { id: 'valor_pago', label: 'Vlr. Pago', default: true },
  { id: 'saldo', label: 'Vlr. Saldo', default: true },
  { id: 'status', label: 'Status', default: true },
  { id: 'plano_contas', label: 'Plano Contas', default: false },
  { id: 'grupo', label: 'Grupo', default: false },
];

export default function TabelaFinanceiro({ lancamentos, tipo, onEdit, onDelete, onBaixa, onCancelarBaixa, isLoading, fornecedores, produtos }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState("vencimento");
  const [sortDirection, setSortDirection] = useState("asc");
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  
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
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                    <Settings className="w-3.5 h-3.5" />
                    Colunas
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuLabel className="text-xs">Colunas</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COLUNAS_DISPONIVEIS.map((coluna) => (
                    <DropdownMenuCheckboxItem key={coluna.id} checked={colunasVisiveis.includes(coluna.id)} onCheckedChange={() => toggleColuna(coluna.id)} className="text-xs">
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
                <TableRow className="bg-slate-50 border-b">
                  {colunasVisiveis.includes('numero') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100 text-xs" onClick={() => handleSort('numero')}>
                      <div className="flex items-center">Nº {getSortIcon('numero')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('emissao') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100 text-xs" onClick={() => handleSort('emissao')}>
                      <div className="flex items-center">Emissão {getSortIcon('emissao')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('vencimento') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100 text-xs" onClick={() => handleSort('vencimento')}>
                      <div className="flex items-center">Vencimento {getSortIcon('vencimento')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('dias') && <TableHead className="text-xs">Dias</TableHead>}
                  {colunasVisiveis.includes('fornecedor_cliente') && (
                    <TableHead className="cursor-pointer hover:bg-slate-100 text-xs" onClick={() => handleSort('fornecedor_cliente')}>
                      <div className="flex items-center">{tipo === 'Pagar' ? 'Fornecedor' : 'Cliente'} {getSortIcon('fornecedor_cliente')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('tipo_documento') && <TableHead className="text-xs">Tipo Doc</TableHead>}
                  {colunasVisiveis.includes('documento') && <TableHead className="text-xs">Nº Doc</TableHead>}
                  {colunasVisiveis.includes('valor_total') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100 text-xs" onClick={() => handleSort('valor_total')}>
                      <div className="flex items-center justify-end">Vlr. Total {getSortIcon('valor_total')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('valor_pago') && <TableHead className="text-right text-xs">Vlr. Pago</TableHead>}
                  {colunasVisiveis.includes('saldo') && (
                    <TableHead className="text-right cursor-pointer hover:bg-slate-100 text-xs" onClick={() => handleSort('saldo')}>
                      <div className="flex items-center justify-end">Vlr. Saldo {getSortIcon('saldo')}</div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('status') && <TableHead className="text-xs">Status</TableHead>}
                  {colunasVisiveis.includes('plano_contas') && <TableHead className="text-xs">Plano Contas</TableHead>}
                  {colunasVisiveis.includes('grupo') && <TableHead className="text-xs">Grupo</TableHead>}
                  <TableHead className="text-xs text-center">Ações</TableHead>
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
                          {colunasVisiveis.includes('numero') && <TableCell className="font-semibold text-xs">{formatarNumero(parseInt(lancamento?.numero_lancamento || 0))}</TableCell>}
                          {colunasVisiveis.includes('emissao') && <TableCell className="text-xs text-slate-600">{formatarData(lancamento?.data_emissao)}</TableCell>}
                          {colunasVisiveis.includes('vencimento') && <TableCell className="text-xs text-slate-600">{formatarData(lancamento?.data_vencimento)}</TableCell>}
                          {colunasVisiveis.includes('dias') && (
                            <TableCell className="text-xs">
                              {lancamento?.status === 'Pendente' && (
                                <span className={`font-medium ${calcularDias(lancamento?.data_vencimento).includes('vencido') ? 'text-red-600' : 'text-slate-600'}`}>
                                  {calcularDias(lancamento?.data_vencimento)}
                                </span>
                              )}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('fornecedor_cliente') && (
                            <TableCell className="max-w-xs truncate text-xs">
                              {lancamento?.fornecedor_nome || lancamento?.cliente_nome || '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('tipo_documento') && <TableCell className="text-xs text-slate-600">{lancamento?.tipo_documento || '-'}</TableCell>}
                          {colunasVisiveis.includes('documento') && <TableCell className="font-mono text-xs text-slate-600">{lancamento?.numero_documento || '-'}</TableCell>}
                          {colunasVisiveis.includes('valor_total') && <TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda(lancamento?.valor_total || 0)}</TableCell>}
                          {colunasVisiveis.includes('valor_pago') && <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(lancamento?.valor_pago || 0)}</TableCell>}
                          {colunasVisiveis.includes('saldo') && <TableCell className="text-right font-mono text-xs font-semibold text-slate-700">{formatarMoeda((lancamento?.valor_total || 0) - (lancamento?.valor_pago || 0))}</TableCell>}
                          {colunasVisiveis.includes('status') && (
                            <TableCell>
                              <Badge variant="outline" className={`${getBadgeStyle(lancamento?.status)} text-xs`}>{lancamento?.status}</Badge>
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('plano_contas') && <TableCell className="text-xs max-w-xs truncate text-slate-600">{lancamento?.plano_contas_nome || '-'}</TableCell>}
                          {colunasVisiveis.includes('grupo') && <TableCell className="text-xs text-slate-600">{lancamento?.grupo_nome || '-'}</TableCell>}
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
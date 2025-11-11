
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRightLeft, Search, Settings, Edit, Ban, Printer, CheckSquare, Loader2, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  // Handle potential string input with comma as decimal separator
  const numericValue = typeof numero === 'string' ? parseFloat(numero.replace('.', '').replace(',', '.')) : numero;
  if (isNaN(numericValue)) return "0,00";
  return numericValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  // Ensure valor is a number before calling toLocaleString
  const numericValue = typeof valor === 'string' ? parseFloat(valor.replace('.', '').replace(',', '.')) : valor;
  if (isNaN(numericValue)) return "R$ 0,00";
  return numericValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº Mov', default: true },
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'tipo_detalhado', label: 'Tipo Doc', default: true },
  { id: 'documento', label: 'Nº Documento', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'unidade', label: 'UN', default: true },
  { id: 'fornecedor', label: 'Fornecedor', default: true },
  { id: 'local_estoque_origem', label: 'Local Estoque Origem', default: false },
  { id: 'local_estoque_destino', label: 'Local Estoque Destino', default: true },
  { id: 'centro_custo', label: 'Centro de Custo', default: true },
  { id: 'safra', label: 'Safra', default: false },
  { id: 'valor_unitario', label: 'Vlr Unit.', default: false },
  { id: 'valor_total', label: 'Vlr Total', default: false },
  { id: 'status', label: 'Status', default: true },
];

export default function TabelaMovimentacoes({ movimentacoes = [], onEdit, onCancel, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  // Removed sortField and sortDirection state

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('colunas_movimentacoes');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Filter out any column IDs that no longer exist in COLUNAS_DISPONIVEIS
          const validColumns = COLUNAS_DISPONIVEIS.map(c => c.id);
          return parsed.filter(id => validColumns.includes(id));
        } catch {
          return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
        }
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });
  
  const [selectedItems, setSelectedItems] = useState([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [isCancelingBulk, setIsCancelingBulk] = useState(false);
  const [cancelProgress, setCancelProgress] = useState({ current: 0, total: 0 });

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('colunas_movimentacoes', JSON.stringify(novasColunas));
      }
      
      return novasColunas;
    });
  };

  const toggleSelectAll = () => {
    const ativas = filteredMovimentacoes.filter(m => m.status === 'Ativa');
    if (selectedItems.length === ativas.length && ativas.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(ativas.map(m => m.id));
    }
  };

  const toggleSelectItem = (id, status) => {
    if (status !== 'Ativa') return;
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkCancel = async () => {
    if (window.confirm(`⚠️ Cancelar ${selectedItems.length} movimentação(ões)?`)) {
      setIsCancelingBulk(true);
      setCancelProgress({ current: 0, total: selectedItems.length });
      
      let canceled = 0;
      for (const id of selectedItems) {
        try {
          await onCancel(id, true); // Pass true to indicate it's a bulk operation if needed by onCancel
          canceled++;
          setCancelProgress({ current: canceled, total: selectedItems.length });
        } catch (error) {
          console.error('Erro ao cancelar movimentação:', error);
          // Optionally, handle individual cancellation failures here
        }
      }
      
      setTimeout(() => {
        setIsCancelingBulk(false);
        setSelectedItems([]);
        setShowBulkActions(false);
      }, 500); // Give a small delay to show completion
    }
  };

  const handleBulkPrint = () => {
    selectedItems.forEach(id => {
      const mov = movimentacoes.find(m => m.id === id);
      if (mov && onPrint) onPrint(mov);
    });
    setShowBulkActions(false);
  };

  const filteredMovimentacoes = movimentacoes.filter(mov => {
    const searchLower = searchTerm.toLowerCase();
    return (
      mov.produto_nome?.toLowerCase().includes(searchLower) ||
      mov.produto_codigo?.toLowerCase().includes(searchLower) ||
      mov.produto_categoria?.toLowerCase().includes(searchLower) ||
      mov.tipo_movimentacao?.toLowerCase().includes(searchLower) ||
      mov.tipo_detalhado?.toLowerCase().includes(searchLower) ||
      mov.fornecedor_nome?.toLowerCase().includes(searchLower) ||
      mov.cliente_nome?.toLowerCase().includes(searchLower) ||
      mov.numero_documento?.toLowerCase().includes(searchLower) ||
      String(mov.numero_movimentacao)?.includes(searchLower) ||
      mov.usuario_responsavel?.toLowerCase().includes(searchLower) ||
      // mov.tipo_documento?.toLowerCase().includes(searchLower) || // Removed as per COLUNAS_DISPONIVEIS update
      mov.centro_custo_nome?.toLowerCase().includes(searchLower) ||
      mov.safra_nome?.toLowerCase().includes(searchLower) ||
      mov.observacoes?.toLowerCase().includes(searchLower) ||
      mov.local_estoque_origem?.toLowerCase().includes(searchLower) ||
      mov.local_estoque_destino?.toLowerCase().includes(searchLower)
    );
  });

  // Removed sortedMovimentacoes as sorting is no longer active

  const cancelProgressPercentage = cancelProgress.total > 0 
    ? Math.round((cancelProgress.current / cancelProgress.total) * 100) 
    : 0;

  return (
    <>
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <CardTitle className="flex items-center gap-3 text-slate-900">
              <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
                <ArrowRightLeft className="w-5 h-5 text-white" />
              </div>
              Movimentações de Estoque
              <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
                {filteredMovimentacoes.length} {filteredMovimentacoes.length === 1 ? 'movimentação' : 'movimentações'}
              </Badge>
              {selectedItems.length > 0 && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-300">
                  {selectedItems.length} selecionados
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-3 w-full md:w-auto">
              {selectedItems.length > 0 && (
                <DropdownMenu open={showBulkActions} onOpenChange={setShowBulkActions}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2 border-blue-300 text-blue-700">
                      <CheckSquare className="w-4 h-4" />
                      Ações em Massa
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Ações para {selectedItems.length} itens</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <ContextMenuItem onClick={handleBulkPrint} className="cursor-pointer">
                      <Printer className="w-4 h-4 mr-2" />
                      Imprimir Todos
                    </ContextMenuItem>
                    <ContextMenuItem onClick={handleBulkCancel} className="text-red-600 cursor-pointer">
                      <Ban className="w-4 h-4 mr-2" />
                      Cancelar Todos
                    </ContextMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              
              <div className="relative flex-1 md:w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  placeholder="Buscar por produto, tipo, documento, usuário..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 border-slate-300 focus:border-green-500 focus:ring-green-500"
                />
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="Configurar Colunas" className="border-slate-300">
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedItems.length === filteredMovimentacoes.filter(m => m.status === 'Ativa').length && filteredMovimentacoes.filter(m => m.status === 'Ativa').length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  {colunasVisiveis.includes('numero') && <TableHead className="font-semibold text-slate-700">Nº Mov</TableHead>}
                  {colunasVisiveis.includes('data') && <TableHead className="font-semibold text-slate-700">Data</TableHead>}
                  {colunasVisiveis.includes('tipo') && <TableHead className="font-semibold text-slate-700">Tipo</TableHead>}
                  {colunasVisiveis.includes('tipo_detalhado') && <TableHead className="font-semibold text-slate-700">Tipo Doc</TableHead>}
                  {colunasVisiveis.includes('documento') && <TableHead className="font-semibold text-slate-700">Nº Documento</TableHead>}
                  {colunasVisiveis.includes('produto') && <TableHead className="font-semibold text-slate-700">Produto</TableHead>}
                  {colunasVisiveis.includes('quantidade') && <TableHead className="font-semibold text-slate-700 text-right">Qtd</TableHead>}
                  {colunasVisiveis.includes('unidade') && <TableHead className="font-semibold text-slate-700">UN</TableHead>}
                  {colunasVisiveis.includes('fornecedor') && <TableHead className="font-semibold text-slate-700">Fornecedor</TableHead>}
                  {colunasVisiveis.includes('local_estoque_origem') && <TableHead className="font-semibold text-slate-700">Local Estoque Origem</TableHead>}
                  {colunasVisiveis.includes('local_estoque_destino') && <TableHead className="font-semibold text-slate-700">Local Estoque Destino</TableHead>}
                  {colunasVisiveis.includes('centro_custo') && <TableHead className="font-semibold text-slate-700">Centro de Custo</TableHead>}
                  {colunasVisiveis.includes('safra') && <TableHead className="font-semibold text-slate-700">Safra</TableHead>}
                  {colunasVisiveis.includes('valor_unitario') && <TableHead className="font-semibold text-slate-700 text-right">Vlr Unit.</TableHead>}
                  {colunasVisiveis.includes('valor_total') && <TableHead className="font-semibold text-slate-700 text-right">Vlr Total</TableHead>}
                  {colunasVisiveis.includes('status') && <TableHead className="font-semibold text-slate-700">Status</TableHead>}
                  <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence mode="wait">
                  {isLoading ? (
                    Array(5).fill(0).map((_, i) => (
                      <TableRow key={i} className="animate-pulse">
                        <TableCell><div className="h-4 bg-slate-200 rounded w-4"></div></TableCell>
                        {/* Render placeholder cells based on visible columns count */}
                        {colunasVisiveis.map((colId, idx) => (
                          <TableCell key={idx}><div className="h-4 bg-slate-200 rounded w-full"></div></TableCell>
                        ))}
                        <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                      </TableRow>
                    ))
                  ) : filteredMovimentacoes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasVisiveis.length + 2} className="text-center py-12">
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                          <ArrowRightLeft className="w-12 h-12" />
                          <p className="text-lg font-medium">Nenhuma movimentação encontrada</p>
                          <p className="text-sm">
                            {searchTerm ? 'Tente ajustar sua busca' : 'Comece registrando uma nova movimentação'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMovimentacoes.map((mov) => {
                      const getBadgeTipo = (tipo) => {
                        const config = {
                          'Entrada': 'bg-blue-100 text-blue-800 border-blue-300',
                          'Saída': 'bg-orange-100 text-orange-800 border-orange-300',
                          'Transferência': 'bg-purple-100 text-purple-800 border-purple-300',
                          'Ajuste': 'bg-slate-100 text-slate-800 border-slate-300',
                        };
                        return config[tipo] || '';
                      };

                      return (
                        <ContextMenu key={mov.id}>
                          <ContextMenuTrigger asChild>
                            <motion.tr
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${mov.status === 'Cancelada' ? 'opacity-50 bg-red-50' : ''}`}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={selectedItems.includes(mov.id)}
                                  onCheckedChange={() => toggleSelectItem(mov.id, mov.status)}
                                  disabled={mov.status !== 'Ativa'}
                                />
                              </TableCell>
                              {colunasVisiveis.includes('numero') && (
                                <TableCell className="font-bold text-slate-900">{mov.numero_movimentacao || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('data') && (
                                <TableCell className="text-slate-700 text-xs">{formatarData(mov.data_movimentacao)}</TableCell>
                              )}
                              {colunasVisiveis.includes('tipo') && (
                                <TableCell>
                                  <Badge className={`${getBadgeTipo(mov.tipo_movimentacao)} border`}>
                                    {mov.tipo_movimentacao}
                                  </Badge>
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('tipo_detalhado') && (
                                <TableCell className="text-xs text-slate-700">{mov.tipo_detalhado || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('documento') && (
                                <TableCell className="font-mono text-xs" title={`${mov.tipo_documento || ''}: ${mov.numero_documento || ''}`}>{mov.numero_documento || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('produto') && (
                                <TableCell className="font-semibold text-slate-900">{mov.produto_nome}</TableCell>
                              )}
                              {colunasVisiveis.includes('quantidade') && (
                                <TableCell className="text-right font-mono font-bold text-green-700">
                                  {formatarNumero(mov.quantidade)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('unidade') && (
                                <TableCell className="text-xs">{mov.unidade_medida || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('fornecedor') && (
                                <TableCell className="text-slate-700 text-xs" title={mov.fornecedor_nome}>{(mov.tipo_movimentacao === 'Entrada' || mov.tipo_movimentacao === 'Saída') ? (mov.fornecedor_nome || mov.cliente_nome || '-') : '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('local_estoque_origem') && (
                                <TableCell className="text-slate-700 text-xs max-w-[120px] truncate" title={mov.local_estoque_origem}>
                                  {mov.local_estoque_origem || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('local_estoque_destino') && (
                                <TableCell className="text-slate-700 text-xs max-w-[120px] truncate" title={mov.local_estoque_destino}>
                                  {mov.local_estoque_destino || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('centro_custo') && (
                                <TableCell className="text-slate-700 text-xs">{mov.centro_custo_nome || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('safra') && (
                                <TableCell className="text-slate-700 text-xs">{mov.safra_nome || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('valor_unitario') && (
                                <TableCell className="text-right font-mono text-slate-700">
                                  {formatarMoeda(mov.valor_unitario)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('valor_total') && (
                                <TableCell className="text-right font-mono font-bold text-green-700">
                                  {formatarMoeda(mov.valor_total)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('status') && (
                                <TableCell>
                                  <Badge className={mov.status === 'Ativa' ? 'bg-emerald-100 text-emerald-800 border-emerald-300 border' : 'bg-red-100 text-red-800 border-red-300 border'}>
                                    {mov.status}
                                  </Badge>
                                </TableCell>
                              )}
                              <TableCell>
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onEdit && onEdit(mov)}
                                    className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                    title="Editar"
                                    disabled={mov.status === 'Cancelada'}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onPrint && onPrint(mov)}
                                    className="hover:bg-green-50 hover:text-green-700 transition-colors"
                                    title="Imprimir"
                                  >
                                    <Printer className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onCancel && onCancel(mov.id)}
                                    className="hover:bg-red-50 hover:text-red-700 transition-colors"
                                    title="Cancelar"
                                    disabled={mov.status === 'Cancelada'}
                                  >
                                    <Ban className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </motion.tr>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => onEdit && onEdit(mov)} disabled={mov.status === 'Cancelada'}>
                              <Edit className="w-4 h-4 mr-2 text-blue-600" />
                              Editar
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onPrint && onPrint(mov)}>
                              <Printer className="w-4 h-4 mr-2 text-green-600" />
                              Imprimir
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onCancel && onCancel(mov.id)} disabled={mov.status === 'Cancelada'}>
                              <Ban className="w-4 h-4 mr-2 text-red-600" />
                              Cancelar
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

      <Dialog open={isCancelingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-red-600" />
              Cancelando Movimentações
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto cancelamos as movimentações selecionadas...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {cancelProgress.current} de {cancelProgress.total}
                </span>
              </div>
              <Progress value={cancelProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-red-600">
                {cancelProgressPercentage}%
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

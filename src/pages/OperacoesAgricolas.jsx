import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Edit2, Trash2, Tractor, MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, Settings, X, Download, Eye } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import FormularioOperacao from "../components/operacoes/FormularioOperacao";

const TIPOS_OPERACAO = ["Gradagem", "Aração", "Plantio", "Pulverização", "Adubação", "Colheita", "Roçagem", "Calagem", "Dessecação", "Subsolagem", "Outro"];

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "-";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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

export default function OperacoesAgricolas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editingOperacao, setEditingOperacao] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [sortField, setSortField] = useState('data_inicio');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selecionados, setSelecionados] = useState([]);
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  const queryClient = useQueryClient();

  const { data: operacoes = [], isLoading } = useQuery({
    queryKey: ['operacoes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.OperacaoAgricola.list('-data_inicio');
      return all.filter(o => o.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.OperacaoAgricola.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operacoes'] });
      toast.success('Operação excluída');
    },
  });

  const operacoesFiltradas = useMemo(() => {
    let filtered = operacoes.filter(o => {
      if (filtroTipo !== 'todos' && o.tipo_operacao !== filtroTipo) return false;
      if (filtroStatus !== 'todos' && o.status !== filtroStatus) return false;
      if (busca && !o.area_nome?.toLowerCase().includes(busca.toLowerCase()) &&
          !o.maquina_nome?.toLowerCase().includes(busca.toLowerCase()) &&
          !o.tipo_operacao?.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });

    filtered.sort((a, b) => {
      let aValue, bValue;
      switch (sortField) {
        case 'data_inicio':
          aValue = new Date(a?.data_inicio).getTime() || 0;
          bValue = new Date(b?.data_inicio).getTime() || 0;
          break;
        case 'tipo_operacao':
          aValue = (a?.tipo_operacao || '').toLowerCase();
          bValue = (b?.tipo_operacao || '').toLowerCase();
          break;
        case 'area_nome':
          aValue = (a?.area_nome || '').toLowerCase();
          bValue = (b?.area_nome || '').toLowerCase();
          break;
        case 'custo_total':
          aValue = a?.custo_total || 0;
          bValue = b?.custo_total || 0;
          break;
        default:
          return 0;
      }
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [operacoes, filtroTipo, filtroStatus, busca, sortField, sortDirection]);

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
    if (selecionados.length === operacoesFiltradas.length && operacoesFiltradas.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(operacoesFiltradas.map(o => o.id));
    }
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos uma operação!');
      return;
    }
    if (window.confirm(`Excluir ${selecionados.length} operação(ões)?`)) {
      for (const id of selecionados) {
        await deleteMutation.mutateAsync(id);
      }
      setSelecionados([]);
    }
  };

  // Resumo
  const totalHectares = operacoes.filter(o => o.status === 'Concluída').reduce((sum, o) => sum + (o.hectares_trabalhados || 0), 0);
  const totalHoras = operacoes.filter(o => o.status === 'Concluída').reduce((sum, o) => sum + (o.horas_trabalhadas || 0), 0);
  const custoTotal = operacoes.filter(o => o.status === 'Concluída').reduce((sum, o) => sum + (o.custo_total || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {!showForm ? (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Operações</h1>
              <p className="text-xs text-slate-600">{operacoes.length} operações registradas</p>
            </div>
            <Button onClick={() => { setEditingOperacao(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
              <Plus className="w-3 h-3" />
              Nova Operação
            </Button>
          </div>

          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{totalHectares.toFixed(1)} ha</div>
                <div className="text-xs text-slate-600">Total Trabalhado</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{totalHoras.toFixed(1)}h</div>
                <div className="text-xs text-slate-600">Horas Trabalhadas</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{operacoes.filter(o => o.status === 'Em Andamento').length}</div>
                <div className="text-xs text-slate-600">Em Andamento</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{formatarMoeda(custoTotal)}</div>
                <div className="text-xs text-slate-600">Custo Total</div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Operações ({operacoesFiltradas.length})
                </CardTitle>
                <div className="flex gap-2 items-center">
                  {selecionados.length > 0 && (
                    <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 rounded px-2 py-1">
                      <span className="text-xs font-semibold text-slate-800">
                        {selecionados.length} selecionado(s)
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 px-1.5">
                            <MoreVertical className="w-4 h-4 text-slate-700" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
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
                    <Input placeholder="Buscar..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
                  </div>
                  <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                    <SelectTrigger className="w-32 h-8 text-xs">
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos" className="text-xs">Todos tipos</SelectItem>
                      {TIPOS_OPERACAO.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                    <SelectTrigger className="w-32 h-8 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                      <SelectItem value="Planejada" className="text-xs">Planejada</SelectItem>
                      <SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem>
                      <SelectItem value="Concluída" className="text-xs">Concluída</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 border-b">
                      <TableHead className="w-8 text-xs border-r border-slate-200">
                        <Checkbox 
                          checked={selecionados.length === operacoesFiltradas.length && operacoesFiltradas.length > 0}
                          onCheckedChange={handleSelecionarTodos}
                        />
                      </TableHead>
                      <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('data_inicio')}>
                        <div className="flex items-center">Data {getSortIcon('data_inicio')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('tipo_operacao')}>
                        <div className="flex items-center">Tipo {getSortIcon('tipo_operacao')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('area_nome')}>
                        <div className="flex items-center">Área {getSortIcon('area_nome')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Máquina</TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right">Hectares</TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right">Horas</TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('custo_total')}>
                        <div className="flex items-center justify-end">Custo {getSortIcon('custo_total')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                        </TableRow>
                      ) : operacoesFiltradas.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">
                            <Tractor className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>Nenhuma operação encontrada</p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        operacoesFiltradas.map((op) => (
                          <motion.tr 
                            key={op.id}
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }} 
                            exit={{ opacity: 0 }} 
                            className="hover:bg-slate-50 transition-colors border-b"
                          >
                            <TableCell className="border-r border-slate-200">
                              <Checkbox
                                checked={selecionados.includes(op.id)}
                                onCheckedChange={() => handleToggleSelecao(op.id)}
                              />
                            </TableCell>
                            <TableCell className="text-center border-r border-slate-200">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem onClick={() => setDetalhesAberto(op)} className="text-xs">
                                    <Eye className="w-3.5 h-3.5 mr-2" />
                                    Ver Detalhes
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setEditingOperacao(op); setShowForm(true); }} className="text-xs">
                                    <Edit2 className="w-3.5 h-3.5 mr-2" />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => {
                                    if (confirm('Excluir esta operação?')) deleteMutation.mutate(op.id);
                                  }} className="text-xs text-red-600">
                                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                            <TableCell className="text-xs border-r border-slate-200">{formatarData(op.data_inicio)}</TableCell>
                            <TableCell className="text-xs font-medium border-r border-slate-200">{op.tipo_operacao}</TableCell>
                            <TableCell className="text-xs border-r border-slate-200">{op.area_nome || '-'}</TableCell>
                            <TableCell className="text-xs border-r border-slate-200">{op.maquina_nome || '-'}</TableCell>
                            <TableCell className="text-xs text-right font-mono border-r border-slate-200">{op.hectares_trabalhados?.toFixed(1) || '-'}</TableCell>
                            <TableCell className="text-xs text-right font-mono border-r border-slate-200">{op.horas_trabalhadas?.toFixed(1) || '-'}</TableCell>
                            <TableCell className="text-xs text-right font-mono font-semibold border-r border-slate-200">{op.custo_total ? formatarMoeda(op.custo_total) : '-'}</TableCell>
                            <TableCell className="border-r border-slate-200">
                              <Badge className="text-[10px] bg-slate-100 text-slate-700">{op.status}</Badge>
                            </TableCell>
                          </motion.tr>
                        ))
                      )}
                    </AnimatePresence>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Dialog Detalhes */}
          <Dialog open={!!detalhesAberto} onOpenChange={(open) => !open && setDetalhesAberto(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="text-sm">Detalhes da Operação</DialogTitle>
              </DialogHeader>
              {detalhesAberto && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div><strong>Tipo:</strong> {detalhesAberto.tipo_operacao}</div>
                    <div><strong>Status:</strong> {detalhesAberto.status}</div>
                    <div><strong>Área:</strong> {detalhesAberto.area_nome || '-'}</div>
                    <div><strong>Máquina:</strong> {detalhesAberto.maquina_nome || '-'}</div>
                    <div><strong>Data Início:</strong> {formatarData(detalhesAberto.data_inicio)}</div>
                    <div><strong>Data Fim:</strong> {formatarData(detalhesAberto.data_fim)}</div>
                    <div><strong>Hectares:</strong> {detalhesAberto.hectares_trabalhados || '-'}</div>
                    <div><strong>Horas:</strong> {detalhesAberto.horas_trabalhadas || '-'}</div>
                    <div><strong>Combustível:</strong> {detalhesAberto.combustivel_consumido ? `${detalhesAberto.combustivel_consumido} L` : '-'}</div>
                    <div><strong>Operador:</strong> {detalhesAberto.operador || '-'}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div><strong>Custo Combustível:</strong> {formatarMoeda(detalhesAberto.valor_combustivel || 0)}</div>
                      <div><strong>Custo Máquina:</strong> {formatarMoeda(detalhesAberto.custo_maquina_total || 0)}</div>
                      <div><strong>Custo Produto:</strong> {formatarMoeda(detalhesAberto.custo_produto || 0)}</div>
                      <div><strong>Mão de Obra:</strong> {formatarMoeda(detalhesAberto.custo_mao_obra || 0)}</div>
                      <div className="col-span-2 pt-2 border-t">
                        <strong className="text-slate-900">CUSTO TOTAL:</strong> 
                        <span className="ml-2 font-bold text-slate-900">{formatarMoeda(detalhesAberto.custo_total || 0)}</span>
                        {detalhesAberto.custo_por_hectare && (
                          <span className="ml-4 text-slate-600">({formatarMoeda(detalhesAberto.custo_por_hectare)}/ha)</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {detalhesAberto.observacoes && (
                    <div className="text-xs">
                      <strong>Observações:</strong>
                      <p className="mt-1 p-2 bg-slate-50 rounded">{detalhesAberto.observacoes}</p>
                    </div>
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {editingOperacao ? 'Editar Operação' : 'Nova Operação'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <FormularioOperacao
              operacao={editingOperacao}
              onSave={() => {
                setShowForm(false);
                setEditingOperacao(null);
                queryClient.invalidateQueries({ queryKey: ['operacoes'] });
              }}
              onCancel={() => { setShowForm(false); setEditingOperacao(null); }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
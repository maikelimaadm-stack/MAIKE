import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Edit2, Trash2, Tractor, Calendar, MapPin, MoreHorizontal, Settings2, ChevronDown, ChevronUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import FormularioOperacao from "../components/operacoes/FormularioOperacao";

const TIPOS_OPERACAO = ["Gradagem", "Aração", "Plantio", "Pulverização", "Adubação", "Colheita", "Roçagem", "Calagem", "Dessecação", "Subsolagem", "Outro"];

export default function OperacoesAgricolas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editingOperacao, setEditingOperacao] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [sortField, setSortField] = useState('data_inicio');
  const [sortOrder, setSortOrder] = useState(-1);
  const [selectedIds, setSelectedIds] = useState([]);
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

    // Ordenação
    filtered.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') valA = valA?.toLowerCase() || '';
      if (typeof valB === 'string') valB = valB?.toLowerCase() || '';
      if (valA < valB) return -1 * sortOrder;
      if (valA > valB) return 1 * sortOrder;
      return 0;
    });

    return filtered;
  }, [operacoes, filtroTipo, filtroStatus, busca, sortField, sortOrder]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder * -1);
    } else {
      setSortField(field);
      setSortOrder(1);
    }
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(operacoesFiltradas.map(o => o.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelect = (id, checked) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter(i => i !== id));
    }
  };

  const handleDeleteSelected = () => {
    if (window.confirm(`Excluir ${selectedIds.length} operações selecionadas?`)) {
      selectedIds.forEach(id => deleteMutation.mutate(id));
      setSelectedIds([]);
    }
  };

  // Resumo
  const totalHectares = operacoes.filter(o => o.status === 'Concluída').reduce((sum, o) => sum + (o.hectares_trabalhados || 0), 0);
  const totalHoras = operacoes.filter(o => o.status === 'Concluída').reduce((sum, o) => sum + (o.horas_trabalhadas || 0), 0);
  const custoTotal = operacoes.filter(o => o.status === 'Concluída').reduce((sum, o) => sum + (o.custo_total || 0), 0);

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortOrder === 1 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

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
                <div className="text-lg font-bold text-slate-700">R$ {custoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                <div className="text-xs text-slate-600">Custo Total</div>
              </CardContent>
            </Card>
          </div>

          {/* Filtros */}
          <Card className="shadow-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Buscar por área, máquina ou tipo..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="pl-10 h-9"
                  />
                </div>
                <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                  <SelectTrigger className="w-full md:w-40 h-9">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos os tipos</SelectItem>
                    {TIPOS_OPERACAO.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger className="w-full md:w-40 h-9">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="Planejada">Planejada</SelectItem>
                    <SelectItem value="Em Andamento">Em Andamento</SelectItem>
                    <SelectItem value="Concluída">Concluída</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Ações em lote */}
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-2 p-2 bg-slate-100 rounded-lg">
              <span className="text-xs text-slate-600">{selectedIds.length} selecionados</span>
              <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={handleDeleteSelected}>
                <Trash2 className="w-3 h-3 mr-1" /> Excluir
              </Button>
            </div>
          )}

          {/* Tabela */}
          <Card className="shadow-sm border-slate-200">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={selectedIds.length === operacoesFiltradas.length && operacoesFiltradas.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="cursor-pointer text-xs" onClick={() => handleSort('data_inicio')}>
                      <div className="flex items-center gap-1">Data <SortIcon field="data_inicio" /></div>
                    </TableHead>
                    <TableHead className="cursor-pointer text-xs" onClick={() => handleSort('tipo_operacao')}>
                      <div className="flex items-center gap-1">Tipo <SortIcon field="tipo_operacao" /></div>
                    </TableHead>
                    <TableHead className="cursor-pointer text-xs" onClick={() => handleSort('area_nome')}>
                      <div className="flex items-center gap-1">Área <SortIcon field="area_nome" /></div>
                    </TableHead>
                    <TableHead className="cursor-pointer text-xs" onClick={() => handleSort('maquina_nome')}>
                      <div className="flex items-center gap-1">Máquina <SortIcon field="maquina_nome" /></div>
                    </TableHead>
                    <TableHead className="text-xs text-right">Hectares</TableHead>
                    <TableHead className="text-xs text-right">Horas</TableHead>
                    <TableHead className="text-xs text-right">Custo</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {operacoesFiltradas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-slate-500">
                        <Tractor className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>Nenhuma operação encontrada</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    operacoesFiltradas.map(op => (
                      <TableRow key={op.id} className="hover:bg-slate-50">
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.includes(op.id)}
                            onCheckedChange={(checked) => handleSelect(op.id, checked)}
                          />
                        </TableCell>
                        <TableCell className="text-xs">
                          {op.data_inicio ? format(new Date(op.data_inicio), 'dd/MM/yyyy') : '-'}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{op.tipo_operacao}</TableCell>
                        <TableCell className="text-xs">{op.area_nome || '-'}</TableCell>
                        <TableCell className="text-xs">{op.maquina_nome || '-'}</TableCell>
                        <TableCell className="text-xs text-right">{op.hectares_trabalhados?.toFixed(1) || '-'}</TableCell>
                        <TableCell className="text-xs text-right">{op.horas_trabalhadas?.toFixed(1) || '-'}</TableCell>
                        <TableCell className="text-xs text-right font-medium">
                          {op.custo_total ? `R$ ${op.custo_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className="text-[10px] bg-slate-100 text-slate-700">{op.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditingOperacao(op); setShowForm(true); }}>
                                <Edit2 className="w-3 h-3 mr-2" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-red-600"
                                onClick={() => {
                                  if (confirm('Excluir esta operação?')) {
                                    deleteMutation.mutate(op.id);
                                  }
                                }}
                              >
                                <Trash2 className="w-3 h-3 mr-2" /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      ) : (
        <FormularioOperacao
          operacao={editingOperacao}
          onSave={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['operacoes'] });
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
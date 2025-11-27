import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Edit2, Trash2, MapPin, Leaf, MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, X, Eye } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import FormularioControleArea from "../components/areas/FormularioControleArea";

const STATUS_AREA = ["Pousio", "Preparação", "Plantada", "Em Desenvolvimento", "Colheita", "Colhida"];

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

export default function ControleAreas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editingControle, setEditingControle] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [sortField, setSortField] = useState('created_date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selecionados, setSelecionados] = useState([]);
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  const queryClient = useQueryClient();

  const { data: controles = [], isLoading } = useQuery({
    queryKey: ['controle-areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ControleArea.list('-created_date');
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ControleArea.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['controle-areas'] });
      toast.success('Registro excluído');
    },
  });

  const controlesFiltrados = useMemo(() => {
    let filtered = controles.filter(c => {
      if (filtroStatus !== 'todos' && c.status !== filtroStatus) return false;
      if (busca && !c.area_nome?.toLowerCase().includes(busca.toLowerCase()) &&
          !c.cultura?.toLowerCase().includes(busca.toLowerCase()) &&
          !c.variedade?.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });

    filtered.sort((a, b) => {
      let aValue, bValue;
      switch (sortField) {
        case 'area_nome':
          aValue = (a?.area_nome || '').toLowerCase();
          bValue = (b?.area_nome || '').toLowerCase();
          break;
        case 'cultura':
          aValue = (a?.cultura || '').toLowerCase();
          bValue = (b?.cultura || '').toLowerCase();
          break;
        case 'data_plantio':
          aValue = new Date(a?.data_plantio).getTime() || 0;
          bValue = new Date(b?.data_plantio).getTime() || 0;
          break;
        case 'producao_estimada_kg':
          aValue = a?.producao_estimada_kg || 0;
          bValue = b?.producao_estimada_kg || 0;
          break;
        default:
          aValue = new Date(a?.created_date).getTime() || 0;
          bValue = new Date(b?.created_date).getTime() || 0;
      }
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [controles, filtroStatus, busca, sortField, sortDirection]);

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
    if (selecionados.length === controlesFiltrados.length && controlesFiltrados.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(controlesFiltrados.map(c => c.id));
    }
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos um registro!');
      return;
    }
    if (window.confirm(`Excluir ${selecionados.length} registro(s)?`)) {
      for (const id of selecionados) {
        await deleteMutation.mutateAsync(id);
      }
      setSelecionados([]);
    }
  };

  // Resumo
  const totalAreaPlantada = controles.filter(c => ['Plantada', 'Em Desenvolvimento', 'Colheita'].includes(c.status))
    .reduce((sum, c) => sum + (c.area_plantada_ha || 0), 0);
  const producaoEstimada = controles.reduce((sum, c) => sum + (c.producao_estimada_kg || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {!showForm ? (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Controle de Áreas</h1>
              <p className="text-xs text-slate-600">Gestão de culturas e produtividade</p>
            </div>
            <Button onClick={() => { setEditingControle(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
              <Plus className="w-3 h-3" />
              Novo Registro
            </Button>
          </div>

          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{totalAreaPlantada.toFixed(1)} ha</div>
                <div className="text-xs text-slate-600">Área Plantada</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{(producaoEstimada / 1000).toFixed(1)} t</div>
                <div className="text-xs text-slate-600">Produção Estimada</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{controles.filter(c => c.status === 'Colheita').length}</div>
                <div className="text-xs text-slate-600">Em Colheita</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{controles.length}</div>
                <div className="text-xs text-slate-600">Total Registros</div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Controle de Áreas ({controlesFiltrados.length})
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
                  <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                    <SelectTrigger className="w-40 h-8 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                      {STATUS_AREA.map(s => <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>)}
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
                          checked={selecionados.length === controlesFiltrados.length && controlesFiltrados.length > 0}
                          onCheckedChange={handleSelecionarTodos}
                        />
                      </TableHead>
                      <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('area_nome')}>
                        <div className="flex items-center">Área {getSortIcon('area_nome')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('cultura')}>
                        <div className="flex items-center">Cultura {getSortIcon('cultura')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Variedade</TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('data_plantio')}>
                        <div className="flex items-center">Plantio {getSortIcon('data_plantio')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right">Área (ha)</TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('producao_estimada_kg')}>
                        <div className="flex items-center justify-end">Prod. Est. {getSortIcon('producao_estimada_kg')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right">sc/ha</TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                        </TableRow>
                      ) : controlesFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">
                            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>Nenhum registro encontrado</p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        controlesFiltrados.map((ctrl) => (
                          <motion.tr 
                            key={ctrl.id}
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }} 
                            exit={{ opacity: 0 }} 
                            className="hover:bg-slate-50 transition-colors border-b"
                          >
                            <TableCell className="border-r border-slate-200">
                              <Checkbox
                                checked={selecionados.includes(ctrl.id)}
                                onCheckedChange={() => handleToggleSelecao(ctrl.id)}
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
                                  <DropdownMenuItem onClick={() => setDetalhesAberto(ctrl)} className="text-xs">
                                    <Eye className="w-3.5 h-3.5 mr-2" />
                                    Ver Detalhes
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setEditingControle(ctrl); setShowForm(true); }} className="text-xs">
                                    <Edit2 className="w-3.5 h-3.5 mr-2" />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => {
                                    if (confirm('Excluir este registro?')) deleteMutation.mutate(ctrl.id);
                                  }} className="text-xs text-red-600">
                                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                            <TableCell className="text-xs font-medium border-r border-slate-200">{ctrl.area_nome || '-'}</TableCell>
                            <TableCell className="text-xs border-r border-slate-200">{ctrl.cultura || '-'}</TableCell>
                            <TableCell className="text-xs border-r border-slate-200">{ctrl.variedade || '-'}</TableCell>
                            <TableCell className="text-xs border-r border-slate-200">{formatarData(ctrl.data_plantio)}</TableCell>
                            <TableCell className="text-xs text-right font-mono border-r border-slate-200">{ctrl.area_plantada_ha?.toFixed(1) || '-'}</TableCell>
                            <TableCell className="text-xs text-right font-mono border-r border-slate-200">
                              {ctrl.producao_estimada_kg ? `${(ctrl.producao_estimada_kg / 1000).toFixed(1)}t` : '-'}
                            </TableCell>
                            <TableCell className="text-xs text-right font-mono font-semibold border-r border-slate-200">{ctrl.produtividade_sc_ha || '-'}</TableCell>
                            <TableCell className="border-r border-slate-200">
                              <Badge className="text-[10px] bg-slate-100 text-slate-700">{ctrl.status}</Badge>
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
                <DialogTitle className="text-sm">Detalhes do Controle de Área</DialogTitle>
              </DialogHeader>
              {detalhesAberto && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div><strong>Área:</strong> {detalhesAberto.area_nome || '-'}</div>
                    <div><strong>Status:</strong> {detalhesAberto.status}</div>
                    <div><strong>Cultura:</strong> {detalhesAberto.cultura || '-'}</div>
                    <div><strong>Variedade:</strong> {detalhesAberto.variedade || '-'}</div>
                    <div><strong>Área Plantada:</strong> {detalhesAberto.area_plantada_ha ? `${detalhesAberto.area_plantada_ha} ha` : '-'}</div>
                    <div><strong>Safra:</strong> {detalhesAberto.safra_nome || '-'}</div>
                    <div><strong>Data Plantio:</strong> {formatarData(detalhesAberto.data_plantio)}</div>
                    <div><strong>Colheita Prevista:</strong> {formatarData(detalhesAberto.data_colheita_prevista)}</div>
                    <div><strong>População:</strong> {detalhesAberto.populacao_plantas ? `${detalhesAberto.populacao_plantas} pl/ha` : '-'}</div>
                    <div><strong>Espaçamento:</strong> {detalhesAberto.espacamento_linha ? `${detalhesAberto.espacamento_linha} cm` : '-'}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <h4 className="text-xs font-semibold mb-2">Produção</h4>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div><strong>Produção Estimada:</strong> {detalhesAberto.producao_estimada_kg ? `${(detalhesAberto.producao_estimada_kg / 1000).toFixed(1)} t` : '-'}</div>
                      <div><strong>Produção Real:</strong> {detalhesAberto.producao_real_kg ? `${(detalhesAberto.producao_real_kg / 1000).toFixed(1)} t` : '-'}</div>
                      <div><strong>Produtividade:</strong> {detalhesAberto.produtividade_sc_ha ? `${detalhesAberto.produtividade_sc_ha} sc/ha` : '-'}</div>
                    </div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <h4 className="text-xs font-semibold mb-2">Financeiro</h4>
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div><strong>Custo Total:</strong> {formatarMoeda(detalhesAberto.custo_total || 0)}</div>
                      <div><strong>Custo/ha:</strong> {formatarMoeda(detalhesAberto.custo_por_hectare || 0)}</div>
                      <div><strong>Receita Total:</strong> {formatarMoeda(detalhesAberto.receita_total || 0)}</div>
                      <div><strong>Lucro/Prejuízo:</strong> {formatarMoeda(detalhesAberto.lucro_prejuizo || 0)}</div>
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
              {editingControle ? 'Editar Registro' : 'Novo Registro'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <FormularioControleArea
              controle={editingControle}
              onSave={() => {
                setShowForm(false);
                setEditingControle(null);
                queryClient.invalidateQueries({ queryKey: ['controle-areas'] });
              }}
              onCancel={() => { setShowForm(false); setEditingControle(null); }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Edit2, Trash2, MapPin, Leaf, Calendar, TrendingUp, MoreHorizontal, ChevronDown, ChevronUp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { format } from "date-fns";
import FormularioControleArea from "../components/areas/FormularioControleArea";

const STATUS_AREA = ["Pousio", "Preparação", "Plantada", "Em Desenvolvimento", "Colheita", "Colhida"];

export default function ControleAreas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editingControle, setEditingControle] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [sortField, setSortField] = useState('created_date');
  const [sortOrder, setSortOrder] = useState(-1);
  const [selectedIds, setSelectedIds] = useState([]);
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
  }, [controles, filtroStatus, busca, sortField, sortOrder]);

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
      setSelectedIds(controlesFiltrados.map(c => c.id));
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
    if (window.confirm(`Excluir ${selectedIds.length} registros selecionados?`)) {
      selectedIds.forEach(id => deleteMutation.mutate(id));
      setSelectedIds([]);
    }
  };

  // Resumo
  const totalAreaPlantada = controles.filter(c => ['Plantada', 'Em Desenvolvimento', 'Colheita'].includes(c.status))
    .reduce((sum, c) => sum + (c.area_plantada_ha || 0), 0);
  const producaoEstimada = controles.reduce((sum, c) => sum + (c.producao_estimada_kg || 0), 0);

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

          {/* Filtros */}
          <Card className="shadow-sm border-slate-200">
            <CardContent className="p-4">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Buscar por área, cultura ou variedade..."
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="pl-10 h-9"
                  />
                </div>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger className="w-full md:w-48 h-9">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {STATUS_AREA.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                        checked={selectedIds.length === controlesFiltrados.length && controlesFiltrados.length > 0}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="cursor-pointer text-xs" onClick={() => handleSort('area_nome')}>
                      <div className="flex items-center gap-1">Área <SortIcon field="area_nome" /></div>
                    </TableHead>
                    <TableHead className="cursor-pointer text-xs" onClick={() => handleSort('cultura')}>
                      <div className="flex items-center gap-1">Cultura <SortIcon field="cultura" /></div>
                    </TableHead>
                    <TableHead className="text-xs">Variedade</TableHead>
                    <TableHead className="cursor-pointer text-xs" onClick={() => handleSort('data_plantio')}>
                      <div className="flex items-center gap-1">Plantio <SortIcon field="data_plantio" /></div>
                    </TableHead>
                    <TableHead className="text-xs text-right">Área (ha)</TableHead>
                    <TableHead className="text-xs text-right">Prod. Est.</TableHead>
                    <TableHead className="text-xs text-right">sc/ha</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {controlesFiltrados.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12 text-slate-500">
                        <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <p>Nenhum registro encontrado</p>
                      </TableCell>
                    </TableRow>
                  ) : (
                    controlesFiltrados.map(ctrl => (
                      <TableRow key={ctrl.id} className="hover:bg-slate-50">
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.includes(ctrl.id)}
                            onCheckedChange={(checked) => handleSelect(ctrl.id, checked)}
                          />
                        </TableCell>
                        <TableCell className="text-xs font-medium">{ctrl.area_nome || '-'}</TableCell>
                        <TableCell className="text-xs">{ctrl.cultura || '-'}</TableCell>
                        <TableCell className="text-xs">{ctrl.variedade || '-'}</TableCell>
                        <TableCell className="text-xs">
                          {ctrl.data_plantio ? format(new Date(ctrl.data_plantio), 'dd/MM/yyyy') : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-right">{ctrl.area_plantada_ha?.toFixed(1) || '-'}</TableCell>
                        <TableCell className="text-xs text-right">
                          {ctrl.producao_estimada_kg ? `${(ctrl.producao_estimada_kg / 1000).toFixed(1)}t` : '-'}
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium">
                          {ctrl.produtividade_sc_ha || '-'}
                        </TableCell>
                        <TableCell>
                          <Badge className="text-[10px] bg-slate-100 text-slate-700">{ctrl.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditingControle(ctrl); setShowForm(true); }}>
                                <Edit2 className="w-3 h-3 mr-2" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-red-600"
                                onClick={() => {
                                  if (confirm('Excluir este registro?')) {
                                    deleteMutation.mutate(ctrl.id);
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
        <FormularioControleArea
          controle={editingControle}
          onSave={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['controle-areas'] });
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}
import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Search, Edit2, Trash2, Truck, MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, X, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import FormularioMaquina from "../components/maquinas/FormularioMaquina";
import FichaMaquina from "../components/maquinas/FichaMaquina";

const TIPOS = ["Trator", "Colheitadeira", "Plantadeira", "Pulverizador", "Caminhão", "Pickup", "Motocicleta", "Implemento", "Outro"];

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "-";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function CadastroMaquinas() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [showFicha, setShowFicha] = useState(false);
  const [editingMaquina, setEditingMaquina] = useState(null);
  const [selectedMaquina, setSelectedMaquina] = useState(null);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [sortField, setSortField] = useState('nome');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selecionados, setSelecionados] = useState([]);
  const queryClient = useQueryClient();

  const { data: maquinas = [], isLoading } = useQuery({
    queryKey: ['maquinas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Maquina.list();
      return all.filter(m => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Maquina.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maquinas'] });
      toast.success('Máquina excluída');
    },
  });

  const maquinasFiltradas = useMemo(() => {
    let filtered = maquinas.filter(m => {
      if (filtroTipo !== 'todos' && m.tipo !== filtroTipo) return false;
      if (filtroStatus !== 'todos' && m.status !== filtroStatus) return false;
      if (busca && !m.nome?.toLowerCase().includes(busca.toLowerCase()) && 
          !m.codigo?.toLowerCase().includes(busca.toLowerCase()) &&
          !m.placa?.toLowerCase().includes(busca.toLowerCase())) return false;
      return true;
    });

    filtered.sort((a, b) => {
      let aValue = a[sortField] || '';
      let bValue = b[sortField] || '';
      if (typeof aValue === 'string') aValue = aValue.toLowerCase();
      if (typeof bValue === 'string') bValue = bValue.toLowerCase();
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [maquinas, filtroTipo, filtroStatus, busca, sortField, sortDirection]);

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
    if (selecionados.length === maquinasFiltradas.length && maquinasFiltradas.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(maquinasFiltradas.map(m => m.id));
    }
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos uma máquina!');
      return;
    }
    if (window.confirm(`Excluir ${selecionados.length} máquina(s)?`)) {
      for (const id of selecionados) {
        await deleteMutation.mutateAsync(id);
      }
      setSelecionados([]);
    }
  };

  // Resumo
  const totalAtivas = maquinas.filter(m => m.status === 'Ativo').length;
  const totalManutencao = maquinas.filter(m => m.status === 'Em Manutenção').length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {!showForm ? (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Máquinas e Veículos</h1>
              <p className="text-xs text-slate-600">{maquinas.length} máquinas cadastradas</p>
            </div>
            <Button onClick={() => { setEditingMaquina(null); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5" />
              Nova Máquina
            </Button>
          </div>

          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{maquinas.length}</div>
                <div className="text-xs text-slate-600">Total</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{totalAtivas}</div>
                <div className="text-xs text-slate-600">Ativas</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{totalManutencao}</div>
                <div className="text-xs text-slate-600">Em Manutenção</div>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="text-lg font-bold text-slate-700">{maquinas.filter(m => m.tipo === 'Trator').length}</div>
                <div className="text-xs text-slate-600">Tratores</div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Máquinas ({maquinasFiltradas.length})
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
                      {TIPOS.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                    <SelectTrigger className="w-32 h-8 text-xs">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                      <SelectItem value="Ativo" className="text-xs">Ativo</SelectItem>
                      <SelectItem value="Em Manutenção" className="text-xs">Em Manutenção</SelectItem>
                      <SelectItem value="Inativo" className="text-xs">Inativo</SelectItem>
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
                          checked={selecionados.length === maquinasFiltradas.length && maquinasFiltradas.length > 0}
                          onCheckedChange={handleSelecionarTodos}
                        />
                      </TableHead>
                      <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Código</TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('nome')}>
                        <div className="flex items-center">Nome {getSortIcon('nome')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('tipo')}>
                        <div className="flex items-center">Tipo {getSortIcon('tipo')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Marca/Modelo</TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Placa</TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right">Horímetro</TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right">Custo/h</TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence>
                      {isLoading ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                        </TableRow>
                      ) : maquinasFiltradas.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-12 text-slate-400 text-xs">
                            <Truck className="w-12 h-12 mx-auto mb-3 opacity-50" />
                            <p>Nenhuma máquina encontrada</p>
                          </TableCell>
                        </TableRow>
                      ) : (
                        maquinasFiltradas.map((maquina) => (
                          <motion.tr 
                            key={maquina.id}
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }} 
                            exit={{ opacity: 0 }} 
                            className="hover:bg-slate-50 transition-colors border-b"
                          >
                            <TableCell className="border-r border-slate-200">
                              <Checkbox
                                checked={selecionados.includes(maquina.id)}
                                onCheckedChange={() => handleToggleSelecao(maquina.id)}
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
                                  <DropdownMenuItem onClick={() => { setSelectedMaquina(maquina); setShowFicha(true); }} className="text-xs">
                                    <Eye className="w-3.5 h-3.5 mr-2" />
                                    Ver Ficha
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { setEditingMaquina(maquina); setShowForm(true); }} className="text-xs">
                                    <Edit2 className="w-3.5 h-3.5 mr-2" />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => {
                                    if (confirm('Excluir esta máquina?')) deleteMutation.mutate(maquina.id);
                                  }} className="text-xs text-red-600">
                                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                            <TableCell className="text-xs font-mono border-r border-slate-200">{maquina.codigo || '-'}</TableCell>
                            <TableCell className="text-xs font-medium border-r border-slate-200">{maquina.nome}</TableCell>
                            <TableCell className="text-xs border-r border-slate-200">{maquina.tipo}</TableCell>
                            <TableCell className="text-xs border-r border-slate-200">{maquina.marca} {maquina.modelo}</TableCell>
                            <TableCell className="text-xs font-mono border-r border-slate-200">{maquina.placa || '-'}</TableCell>
                            <TableCell className="text-xs text-right font-mono border-r border-slate-200">{maquina.horimetro_atual ? `${maquina.horimetro_atual}h` : '-'}</TableCell>
                            <TableCell className="text-xs text-right font-mono border-r border-slate-200">{maquina.custo_hora ? formatarMoeda(maquina.custo_hora) : '-'}</TableCell>
                            <TableCell className="border-r border-slate-200">
                              <Badge className="text-[10px] bg-slate-100 text-slate-700">{maquina.status}</Badge>
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

          {/* Dialog Ficha */}
          <Dialog open={showFicha} onOpenChange={setShowFicha}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-sm">Ficha da Máquina</DialogTitle>
              </DialogHeader>
              {selectedMaquina && (
                <FichaMaquina maquina={selectedMaquina} onClose={() => setShowFicha(false)} />
              )}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {editingMaquina ? 'Editar Máquina' : 'Nova Máquina'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <FormularioMaquina
              maquina={editingMaquina}
              onSave={() => {
                setShowForm(false);
                setEditingMaquina(null);
                queryClient.invalidateQueries({ queryKey: ['maquinas'] });
              }}
              onCancel={() => { setShowForm(false); setEditingMaquina(null); }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
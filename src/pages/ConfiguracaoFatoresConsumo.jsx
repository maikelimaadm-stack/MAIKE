import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Check, X, MoreVertical, Edit2, ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export default function ConfiguracaoFatoresConsumo() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [busca, setBusca] = useState('');
  const [sortField, setSortField] = useState('categoria');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selecionados, setSelecionados] = useState([]);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    categoria: "",
    fator: "",
    descricao: ""
  });

  const { data: fatores = [] } = useQuery({
    queryKey: ['fatores-consumo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FatorConsumoCategoria.list();
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.tipo_entidade === 'Lote' && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FatorConsumoCategoria.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fatores-consumo'] });
      setFormData({ categoria: "", fator: "", descricao: "" });
      setShowForm(false);
      toast.success('Fator cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FatorConsumoCategoria.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fatores-consumo'] });
      setEditando(null);
      setShowForm(false);
      toast.success('Fator atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FatorConsumoCategoria.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fatores-consumo'] });
      toast.success('Fator excluído!');
    },
  });

  const fatoresFiltrados = useMemo(() => {
    let filtered = fatores.filter(f => {
      if (busca && !f.categoria?.toLowerCase().includes(busca.toLowerCase())) return false;
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
  }, [fatores, busca, sortField, sortDirection]);

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
    if (selecionados.length === fatoresFiltrados.length && fatoresFiltrados.length > 0) {
      setSelecionados([]);
    } else {
      setSelecionados(fatoresFiltrados.map(f => f.id));
    }
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) {
      toast.error('Selecione ao menos um fator!');
      return;
    }
    if (window.confirm(`Excluir ${selecionados.length} fator(es)?`)) {
      for (const id of selecionados) {
        await deleteMutation.mutateAsync(id);
      }
      setSelecionados([]);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.categoria || !formData.fator) {
      toast.error('Preencha categoria e fator!');
      return;
    }

    const data = {
      empresa_id: empresaSelecionadaId,
      categoria: formData.categoria.toUpperCase(),
      fator: parseFloat(formData.fator),
      descricao: formData.descricao?.toUpperCase(),
      ativo: true
    };

    if (editando) {
      updateMutation.mutate({ id: editando.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (fator) => {
    setEditando(fator);
    setFormData({
      categoria: fator.categoria,
      fator: fator.fator,
      descricao: fator.descricao || ""
    });
    setShowForm(true);
  };

  const categoriasDisponiveis = iconesConfig.map(ic => ic.categoria).filter(Boolean);
  const fatoresPadrao = [
    { categoria: "BEZERRO 0 A 12 MESES", fator: 0.5 },
    { categoria: "BEZERRA 0 A 12 MESES", fator: 0.5 },
    { categoria: "NOVILHO 12 A 24 MESES", fator: 0.8 },
    { categoria: "NOVILHA 12 A 24 MESES", fator: 0.75 },
    { categoria: "GARROTE 24 A 36 MESES", fator: 0.9 },
    { categoria: "VACA SECA", fator: 1.0 },
    { categoria: "VACA LACTAÇÃO", fator: 1.2 },
    { categoria: "TOURO", fator: 1.3 }
  ];

  const aplicarFatoresPadrao = () => {
    fatoresPadrao.forEach(fp => {
      const existe = fatores.find(f => f.categoria === fp.categoria);
      if (!existe) {
        createMutation.mutate({
          empresa_id: empresaSelecionadaId,
          categoria: fp.categoria,
          fator: fp.fator,
          descricao: `Fator padrão para ${fp.categoria}`,
          ativo: true
        });
      }
    });
    toast.success('Fatores padrão aplicados!');
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {!showForm ? (
        <>
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Fatores de Consumo</h1>
              <p className="text-xs text-slate-600">Configure os fatores para cálculo de suplementação</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={aplicarFatoresPadrao} variant="outline" size="sm" className="h-8 text-xs">
                Aplicar Padrão
              </Button>
              <Button onClick={() => { setEditando(null); setFormData({ categoria: "", fator: "", descricao: "" }); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
                <Plus className="w-3 h-3" />
                Novo Fator
              </Button>
            </div>
          </div>

          {/* Tabela */}
          <Card className="shadow-sm border-slate-300">
            <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Fatores Cadastrados ({fatoresFiltrados.length})
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
                          checked={selecionados.length === fatoresFiltrados.length && fatoresFiltrados.length > 0}
                          onCheckedChange={handleSelecionarTodos}
                        />
                      </TableHead>
                      <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                      <TableHead className="text-xs border-r border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('categoria')}>
                        <div className="flex items-center">Categoria {getSortIcon('categoria')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('fator')}>
                        <div className="flex items-center justify-end">Fator {getSortIcon('fator')}</div>
                      </TableHead>
                      <TableHead className="text-xs border-r border-slate-200">Descrição</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence>
                      {fatoresFiltrados.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-12 text-slate-400 text-xs">
                            Nenhum fator cadastrado
                          </TableCell>
                        </TableRow>
                      ) : (
                        fatoresFiltrados.map((fator) => (
                          <motion.tr 
                            key={fator.id}
                            initial={{ opacity: 0 }} 
                            animate={{ opacity: 1 }} 
                            exit={{ opacity: 0 }} 
                            className="hover:bg-slate-50 transition-colors border-b"
                          >
                            <TableCell className="border-r border-slate-200">
                              <Checkbox
                                checked={selecionados.includes(fator.id)}
                                onCheckedChange={() => handleToggleSelecao(fator.id)}
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
                                  <DropdownMenuItem onClick={() => handleEdit(fator)} className="text-xs">
                                    <Edit2 className="w-3.5 h-3.5 mr-2" />
                                    Editar
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => {
                                    if (confirm('Excluir este fator?')) deleteMutation.mutate(fator.id);
                                  }} className="text-xs text-red-600">
                                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                            <TableCell className="text-xs font-medium border-r border-slate-200">{fator.categoria}</TableCell>
                            <TableCell className="text-xs text-right font-mono font-semibold border-r border-slate-200">
                              <Badge className="bg-slate-100 text-slate-700">{fator.fator}</Badge>
                            </TableCell>
                            <TableCell className="text-xs text-slate-600 border-r border-slate-200">{fator.descricao || '-'}</TableCell>
                          </motion.tr>
                        ))
                      )}
                    </AnimatePresence>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <div className="text-xs text-blue-900 space-y-2">
                <p className="font-semibold">ℹ️ Como funciona:</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Os fatores definem quanto cada categoria consome em relação a uma vaca padrão (fator 1.0)</li>
                  <li>Bezerros (fator 0.5) consomem metade do que uma vaca</li>
                  <li>Vacas em lactação (fator 1.2) consomem 20% a mais</li>
                  <li>O sistema distribui automaticamente o suplemento considerando esses fatores</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
            <CardTitle className="text-sm font-semibold text-slate-900">
              {editando ? 'Editar Fator' : 'Novo Fator'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Categoria *</Label>
                  <Input
                    value={formData.categoria}
                    onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                    placeholder="VACA SECA"
                    className="h-9 text-xs uppercase"
                    list="categorias-list"
                  />
                  <datalist id="categorias-list">
                    {categoriasDisponiveis.map(cat => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Fator *</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={formData.fator}
                    onChange={(e) => setFormData({ ...formData, fator: e.target.value })}
                    placeholder="1.0"
                    className="h-9 text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Descrição</Label>
                  <Input
                    value={formData.descricao}
                    onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                    placeholder="DESCRIÇÃO"
                    className="h-9 text-xs uppercase"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditando(null); }}>
                  Cancelar
                </Button>
                <Button type="submit">
                  {editando ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, FolderOpen, Search } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";

const getNextNumber = async (empresaId) => {
  const all = await base44.entities.GrupoFinanceiro.list();
  const filtered = all.filter(g => g.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, g) => Math.max(max, parseInt(g.numero_grupo) || 0), 0);
  return maxNum + 1;
};

export default function GruposFinanceiros() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    descricao: "",
    tipo: "Despesa",
    plano_contas_id: "",
    ativo: true
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: grupos = [] } = useQuery({
    queryKey: ['grupos_financeiros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.GrupoFinanceiro.list('descricao');
      return all.filter(g => g.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: planosContas = [] } = useQuery({
    queryKey: ['planos_contas_grupos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const numero = await getNextNumber(empresaSelecionadaId);
      return base44.entities.GrupoFinanceiro.create({ ...data, empresa_id: empresaSelecionadaId, numero_grupo: String(numero) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grupos_financeiros'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
      toast.success('Grupo cadastrado!');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GrupoFinanceiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grupos_financeiros'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
      toast.success('Grupo atualizado!');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const lancamentos = await base44.entities.LancamentoFinanceiro.list();
      const temVinculo = lancamentos.some(l => l.grupo_id === id);
      if (temVinculo) throw new Error('❌ Possui lançamentos vinculados!');
      return base44.entities.GrupoFinanceiro.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['grupos_financeiros'] });
      toast.success('Grupo excluído!');
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.descricao) {
      toast.error('Preencha descrição!');
      return;
    }

    const plano = planosContas.find(p => p.id === formData.plano_contas_id);
    const data = {
      descricao: formData.descricao.toUpperCase(),
      tipo: formData.tipo,
      plano_contas_id: formData.plano_contas_id || undefined,
      plano_contas_nome: plano ? `${plano.codigo} - ${plano.descricao}` : undefined,
      ativo: formData.ativo
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({
      descricao: item.descricao,
      tipo: item.tipo,
      plano_contas_id: item.plano_contas_id || "",
      ativo: item.ativo !== false
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({ descricao: "", tipo: "Despesa", plano_contas_id: "", ativo: true });
  };

  const filteredGrupos = grupos.filter(g =>
    g.descricao?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    g.tipo?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Grupos Financeiros</h1>
          <p className="text-xs text-slate-600">Gerenciar grupos</p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingItem(null); resetForm(); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-3.5 h-3.5" />
            Novo Grupo
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{editingItem ? 'Editar Grupo' : 'Novo Grupo'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Descrição *</Label>
                      <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} placeholder="DESCRIÇÃO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo *</Label>
                      <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Receita" className="text-xs">Receita</SelectItem>
                          <SelectItem value="Despesa" className="text-xs">Despesa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Plano de Contas</Label>
                    <Select value={formData.plano_contas_id} onValueChange={(v) => setFormData({ ...formData, plano_contas_id: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger>
                      <SelectContent>
                        {planosContas.filter(p => p.tipo === formData.tipo).map(p => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">{p.codigo} - {p.descricao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox checked={formData.ativo} onCheckedChange={(v) => setFormData({ ...formData, ativo: v })} />
                    <label className="text-xs">Ativo</label>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingItem(null); resetForm(); }} size="sm" className="h-8 text-xs">
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                      {editingItem ? 'Atualizar' : 'Salvar'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {!showForm && (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FolderOpen className="w-4 h-4" />
                Grupos ({filteredGrupos.length})
              </CardTitle>
              <div className="relative w-52">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-slate-400 w-3 h-3" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-8 text-xs" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Nº</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Plano de Contas</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGrupos.map((grupo) => (
                    <TableRow key={grupo.id} className="text-xs">
                      <TableCell className="font-bold">{grupo.numero_grupo}</TableCell>
                      <TableCell className="font-semibold">{grupo.descricao}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs py-0 ${grupo.tipo === 'Receita' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {grupo.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell>{grupo.plano_contas_nome || '-'}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs py-0 ${grupo.ativo !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'}`}>
                          {grupo.ativo !== false ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(grupo)} className="h-7 w-7">
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(grupo.id)} className="h-7 w-7 text-red-600 hover:bg-red-50">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

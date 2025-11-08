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
      if (temVinculo) {
        throw new Error('❌ EXCLUSÃO BLOQUEADA! Este grupo possui lançamentos financeiros vinculados.');
      }
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
      toast.error('Preencha a descrição!');
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
    setFormData({
      descricao: "",
      tipo: "Despesa",
      plano_contas_id: "",
      ativo: true
    });
  };

  const filteredGrupos = grupos.filter(g =>
    g.descricao?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    g.tipo?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-green-900">Grupos Financeiros</h1>
          <p className="text-green-700">Gerenciar grupos de despesas e receitas</p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingItem(null); resetForm(); setShowForm(true); }} className="bg-green-600 gap-2">
            <Plus className="w-5 h-5" />
            Novo Grupo
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-xl">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
                <CardTitle>{editingItem ? 'Editar Grupo' : 'Novo Grupo Financeiro'}</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Descrição *</Label>
                      <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} placeholder="DESCRIÇÃO" className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo *</Label>
                      <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Receita">Receita</SelectItem>
                          <SelectItem value="Despesa">Despesa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Plano de Contas Vinculado</Label>
                    <Select value={formData.plano_contas_id} onValueChange={(v) => setFormData({ ...formData, plano_contas_id: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione (opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {planosContas.filter(p => p.tipo === formData.tipo).map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.codigo} - {p.descricao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox checked={formData.ativo} onCheckedChange={(v) => setFormData({ ...formData, ativo: v })} />
                    <label>Ativo</label>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingItem(null); resetForm(); }}>
                      Cancelar
                    </Button>
                    <Button type="submit" className="bg-green-600">
                      {editingItem ? 'Atualizar' : 'Salvar'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="shadow-xl">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50">
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-3">
              <FolderOpen className="w-5 h-5" />
              Grupos Cadastrados ({filteredGrupos.length})
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
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
                <TableRow key={grupo.id}>
                  <TableCell className="font-bold">{grupo.numero_grupo}</TableCell>
                  <TableCell className="font-semibold">{grupo.descricao}</TableCell>
                  <TableCell>
                    <Badge className={grupo.tipo === 'Receita' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                      {grupo.tipo}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{grupo.plano_contas_nome || '-'}</TableCell>
                  <TableCell>
                    <Badge className={grupo.ativo !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                      {grupo.ativo !== false ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2 justify-center">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(grupo)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(grupo.id)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
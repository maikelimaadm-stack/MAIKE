import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { motion, AnimatePresence } from "framer-motion";

export default function PlanoContas() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({
    codigo: "",
    descricao: "",
    tipo: "Despesa",
    nivel: 1,
    conta_pai_id: "",
    aceita_lancamento: true,
    ativo: true
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ['plano_contas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PlanoContas.list('codigo');
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Verificar se existe lançamento financeiro vinculado
      const existente = contas.find(c => c.codigo === data.codigo && (!editingItem || c.id !== editingItem.id));
      if (existente) throw new Error('Já existe uma conta com este código!');
      
      return base44.entities.PlanoContas.create({ ...data, empresa_id: empresaSelecionadaId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plano_contas'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
      toast.success('Conta cadastrada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao salvar.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PlanoContas.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plano_contas'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
      toast.success('Conta atualizada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      // Verificar se tem lançamentos vinculados
      const lancamentos = await base44.entities.LancamentoFinanceiro.list();
      const temVinculo = lancamentos.some(l => l.plano_contas_id === id);
      if (temVinculo) {
        throw new Error('❌ EXCLUSÃO BLOQUEADA! Esta conta possui lançamentos financeiros vinculados. Não é possível excluir.');
      }
      
      // Verificar se tem contas filhas
      const temFilhas = contas.some(c => c.conta_pai_id === id);
      if (temFilhas) {
        throw new Error('❌ EXCLUSÃO BLOQUEADA! Esta conta possui subcontas vinculadas. Não é possível excluir.');
      }
      
      return base44.entities.PlanoContas.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plano_contas'] });
      toast.success('Conta excluída!');
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.codigo || !formData.descricao) {
      toast.error('Preencha os campos obrigatórios!');
      return;
    }

    const data = {
      codigo: formData.codigo.toUpperCase(),
      descricao: formData.descricao.toUpperCase(),
      tipo: formData.tipo,
      nivel: parseInt(formData.nivel),
      conta_pai_id: formData.conta_pai_id || undefined,
      aceita_lancamento: formData.aceita_lancamento,
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
      codigo: item.codigo,
      descricao: item.descricao,
      tipo: item.tipo,
      nivel: item.nivel,
      conta_pai_id: item.conta_pai_id || "",
      aceita_lancamento: item.aceita_lancamento !== false,
      ativo: item.ativo !== false
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ Deseja realmente excluir esta conta?')) {
      deleteMutation.mutate(id);
    }
  };

  const resetForm = () => {
    setFormData({
      codigo: "",
      descricao: "",
      tipo: "Despesa",
      nivel: 1,
      conta_pai_id: "",
      aceita_lancamento: true,
      ativo: true
    });
  };

  const contasPai = contas.filter(c => c.nivel < (formData.nivel || 1));

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-green-900">Plano de Contas</h1>
          <p className="text-green-700">Gerenciar estrutura de contas contábeis</p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingItem(null); resetForm(); setShowForm(true); }} className="bg-green-600 gap-2">
            <Plus className="w-5 h-5" />
            Nova Conta
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-xl">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
                <CardTitle>{editingItem ? 'Editar Conta' : 'Nova Conta'}</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Código *</Label>
                      <Input value={formData.codigo} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} placeholder="1.1.1" className="uppercase" style={{ textTransform: 'uppercase' }} />
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
                    <div className="space-y-2">
                      <Label>Nível *</Label>
                      <Input type="number" min="1" max="5" value={formData.nivel} onChange={(e) => setFormData({ ...formData, nivel: e.target.value })} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Descrição *</Label>
                    <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} placeholder="DESCRIÇÃO DA CONTA" className="uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>

                  {formData.nivel > 1 && (
                    <div className="space-y-2">
                      <Label>Conta Pai</Label>
                      <Select value={formData.conta_pai_id} onValueChange={(v) => setFormData({ ...formData, conta_pai_id: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {contasPai.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.codigo} - {c.descricao}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex items-center space-x-6">
                    <div className="flex items-center space-x-2">
                      <Checkbox checked={formData.aceita_lancamento} onCheckedChange={(v) => setFormData({ ...formData, aceita_lancamento: v })} />
                      <label>Aceita Lançamento</label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox checked={formData.ativo} onCheckedChange={(v) => setFormData({ ...formData, ativo: v })} />
                      <label>Ativo</label>
                    </div>
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
          <CardTitle className="flex items-center gap-3">
            <FileText className="w-5 h-5" />
            Contas Cadastradas ({contas.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead>Lançamento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contas.map((conta) => (
                <TableRow key={conta.id}>
                  <TableCell className="font-mono font-bold">{conta.codigo}</TableCell>
                  <TableCell style={{ paddingLeft: `${(conta.nivel - 1) * 20}px` }}>{conta.descricao}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded text-xs ${conta.tipo === 'Receita' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {conta.tipo}
                    </span>
                  </TableCell>
                  <TableCell>{conta.nivel}</TableCell>
                  <TableCell>{conta.aceita_lancamento !== false ? 'Sim' : 'Não'}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded text-xs ${conta.ativo !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                      {conta.ativo !== false ? 'Ativo' : 'Inativo'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2 justify-center">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(conta)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(conta.id)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
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
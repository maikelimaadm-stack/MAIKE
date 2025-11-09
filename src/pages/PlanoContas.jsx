
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
      const existente = contas.find(c => c.codigo === data.codigo && (!editingItem || c.id !== editingItem.id));
      if (existente) throw new Error('Código já existe!');
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
      toast.error(error.message || 'Erro.');
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
      toast.error(error.message || 'Erro.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const lancamentos = await base44.entities.LancamentoFinanceiro.list();
      const temVinculo = lancamentos.some(l => l.plano_contas_id === id);
      if (temVinculo) throw new Error('❌ Possui lançamentos vinculados!');
      const temFilhas = contas.some(c => c.conta_pai_id === id);
      if (temFilhas) throw new Error('❌ Possui subcontas vinculadas!');
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
      toast.error('Preencha os campos!');
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
    if (window.confirm('⚠️ Excluir conta?')) {
      deleteMutation.mutate(id);
    }
  };

  const resetForm = () => {
    setFormData({ codigo: "", descricao: "", tipo: "Despesa", nivel: 1, conta_pai_id: "", aceita_lancamento: true, ativo: true });
  };

  const contasPai = contas.filter(c => c.nivel < (formData.nivel || 1));

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Plano de Contas</h1>
          <p className="text-xs text-slate-600">Estrutura contábil</p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingItem(null); resetForm(); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-3.5 h-3.5" />
            Nova Conta
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{editingItem ? 'Editar Conta' : 'Nova Conta'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Código *</Label>
                      <Input value={formData.codigo} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} placeholder="1.1.1" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
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
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nível *</Label>
                      <Input type="number" min="1" max="5" value={formData.nivel} onChange={(e) => setFormData({ ...formData, nivel: e.target.value })} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Descrição *</Label>
                    <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} placeholder="DESCRIÇÃO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>

                  {formData.nivel > 1 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Conta Pai</Label>
                      <Select value={formData.conta_pai_id} onValueChange={(v) => setFormData({ ...formData, conta_pai_id: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {contasPai.map(c => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">{c.codigo} - {c.descricao}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex items-center gap-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox checked={formData.aceita_lancamento} onCheckedChange={(v) => setFormData({ ...formData, aceita_lancamento: v })} />
                      <label className="text-xs">Aceita Lançamento</label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox checked={formData.ativo} onCheckedChange={(v) => setFormData({ ...formData, ativo: v })} />
                      <label className="text-xs">Ativo</label>
                    </div>
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
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4" />
              Contas ({contas.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
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
                    <TableRow key={conta.id} className="text-xs">
                      <TableCell className="font-mono font-bold">{conta.codigo}</TableCell>
                      <TableCell style={{ paddingLeft: `${(conta.nivel - 1) * 20}px` }}>{conta.descricao}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs ${conta.tipo === 'Receita' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {conta.tipo}
                        </span>
                      </TableCell>
                      <TableCell>{conta.nivel}</TableCell>
                      <TableCell>{conta.aceita_lancamento !== false ? 'Sim' : 'Não'}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-0.5 rounded text-xs ${conta.ativo !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'}`}>
                          {conta.ativo !== false ? 'Ativo' : 'Inativo'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(conta)} className="h-7 w-7">
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(conta.id)} className="h-7 w-7 text-red-600 hover:bg-red-50">
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

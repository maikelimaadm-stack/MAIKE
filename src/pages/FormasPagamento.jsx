import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, CreditCard, Search } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";

const getNextNumber = async (empresaId) => {
  const all = await base44.entities.FormaPagamento.list();
  const filtered = all.filter(f => f.empresa_id === empresaId);
  const maxNum = filtered.reduce((max, f) => Math.max(max, parseInt(f.numero_forma) || 0), 0);
  return maxNum + 1;
};

export default function FormasPagamento() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    descricao: "",
    tipo: "Dinheiro",
    prazo_padrao_dias: 0,
    conta_bancaria: "",
    padrao: false,
    ativo: true
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: formas = [], isLoading } = useQuery({
    queryKey: ['formas_pagamento', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.FormaPagamento.list('descricao');
      return all.filter(f => f.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const numero = await getNextNumber(empresaSelecionadaId);
      return base44.entities.FormaPagamento.create({ ...data, empresa_id: empresaSelecionadaId, numero_forma: String(numero) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formas_pagamento'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
      toast.success('Forma de pagamento cadastrada!');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FormaPagamento.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formas_pagamento'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
      toast.success('Forma de pagamento atualizada!');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const lancamentos = await base44.entities.LancamentoFinanceiro.list();
      const temVinculo = lancamentos.some(l => l.forma_pagamento_id === id);
      if (temVinculo) {
        throw new Error('❌ EXCLUSÃO BLOQUEADA! Esta forma de pagamento possui lançamentos financeiros vinculados.');
      }
      
      const baixas = await base44.entities.BaixaFinanceira.list();
      const temBaixas = baixas.some(b => b.forma_pagamento_id === id);
      if (temBaixas) {
        throw new Error('❌ EXCLUSÃO BLOQUEADA! Esta forma de pagamento possui baixas financeiras vinculadas.');
      }
      
      return base44.entities.FormaPagamento.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formas_pagamento'] });
      toast.success('Forma de pagamento excluída!');
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

    const data = {
      descricao: formData.descricao.toUpperCase(),
      tipo: formData.tipo,
      prazo_padrao_dias: parseInt(formData.prazo_padrao_dias) || 0,
      conta_bancaria: formData.conta_bancaria?.toUpperCase() || undefined,
      padrao: formData.padrao,
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
      prazo_padrao_dias: item.prazo_padrao_dias || 0,
      conta_bancaria: item.conta_bancaria || "",
      padrao: item.padrao || false,
      ativo: item.ativo !== false
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      descricao: "",
      tipo: "Dinheiro",
      prazo_padrao_dias: 0,
      conta_bancaria: "",
      padrao: false,
      ativo: true
    });
  };

  const filteredFormas = formas.filter(f =>
    f.descricao?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.tipo?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-green-900">Formas de Pagamento</h1>
          <p className="text-green-700">Gerenciar formas de pagamento do sistema</p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingItem(null); resetForm(); setShowForm(true); }} className="bg-green-600 gap-2">
            <Plus className="w-5 h-5" />
            Nova Forma
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-xl">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
                <CardTitle>{editingItem ? 'Editar Forma' : 'Nova Forma de Pagamento'}</CardTitle>
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
                          <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                          <SelectItem value="Pix">Pix</SelectItem>
                          <SelectItem value="Boleto">Boleto</SelectItem>
                          <SelectItem value="Cartão Crédito">Cartão Crédito</SelectItem>
                          <SelectItem value="Cartão Débito">Cartão Débito</SelectItem>
                          <SelectItem value="Transferência">Transferência</SelectItem>
                          <SelectItem value="Cheque">Cheque</SelectItem>
                          <SelectItem value="Depósito">Depósito</SelectItem>
                          <SelectItem value="Outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Prazo Padrão (Dias)</Label>
                      <Input type="number" min="0" value={formData.prazo_padrao_dias} onChange={(e) => setFormData({ ...formData, prazo_padrao_dias: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Conta Bancária</Label>
                      <Input value={formData.conta_bancaria} onChange={(e) => setFormData({ ...formData, conta_bancaria: e.target.value })} placeholder="CONTA" className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                  </div>

                  <div className="flex items-center space-x-6">
                    <div className="flex items-center space-x-2">
                      <Checkbox checked={formData.padrao} onCheckedChange={(v) => setFormData({ ...formData, padrao: v })} />
                      <label>Forma Padrão</label>
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
          <div className="flex justify-between items-center">
            <CardTitle className="flex items-center gap-3">
              <CreditCard className="w-5 h-5" />
              Formas Cadastradas ({filteredFormas.length})
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
                <TableHead>Prazo</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Padrão</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFormas.map((forma) => (
                <TableRow key={forma.id}>
                  <TableCell className="font-bold">{forma.numero_forma}</TableCell>
                  <TableCell className="font-semibold">{forma.descricao}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{forma.tipo}</Badge>
                  </TableCell>
                  <TableCell>{forma.prazo_padrao_dias || 0} dias</TableCell>
                  <TableCell>{forma.conta_bancaria || '-'}</TableCell>
                  <TableCell>
                    {forma.padrao && <Badge className="bg-blue-100 text-blue-800">Padrão</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge className={forma.ativo !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                      {forma.ativo !== false ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2 justify-center">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(forma)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(forma.id)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
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
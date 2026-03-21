import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, CreditCard, Search, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmDialog from "@/components/common/ConfirmDialog";

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
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
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
      toast.success('Forma cadastrada!');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FormaPagamento.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formas_pagamento'] });
      setShowForm(false);
      setEditingItem(null);
      resetForm();
      toast.success('Forma atualizada!');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const lancamentos = await base44.entities.LancamentoFinanceiro.list();
      const temVinculo = lancamentos.some(l => l.forma_pagamento_id === id);
      if (temVinculo) throw new Error('❌ Possui lançamentos vinculados!');
      
      const baixas = await base44.entities.BaixaFinanceira.list();
      const temBaixas = baixas.some(b => b.forma_pagamento_id === id);
      if (temBaixas) throw new Error('❌ Possui baixas vinculadas!');
      
      return base44.entities.FormaPagamento.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formas_pagamento'] });
      toast.success('Forma excluída!');
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
    setFormData({ descricao: "", tipo: "Dinheiro", prazo_padrao_dias: 0, conta_bancaria: "", padrao: false, ativo: true });
  };

  const filteredFormas = formas.filter(f =>
    f.descricao?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.tipo?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Formas de Pagamento</h1>
          <p className="text-xs text-slate-600">Gerenciar formas</p>
        </div>
        {!showForm && (
          <Button onClick={() => { setEditingItem(null); resetForm(); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-3.5 h-3.5" />
            Nova Forma
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{editingItem ? 'Editar Forma' : 'Nova Forma'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Descrição *</Label>
                      <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} placeholder="DESCRIÇÃO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo *</Label>
                      <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Dinheiro" className="text-xs">Dinheiro</SelectItem>
                          <SelectItem value="Pix" className="text-xs">Pix</SelectItem>
                          <SelectItem value="Boleto" className="text-xs">Boleto</SelectItem>
                          <SelectItem value="Cartão Crédito" className="text-xs">Cartão Crédito</SelectItem>
                          <SelectItem value="Cartão Débito" className="text-xs">Cartão Débito</SelectItem>
                          <SelectItem value="Transferência" className="text-xs">Transferência</SelectItem>
                          <SelectItem value="Cheque" className="text-xs">Cheque</SelectItem>
                          <SelectItem value="Depósito" className="text-xs">Depósito</SelectItem>
                          <SelectItem value="Outro" className="text-xs">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                    <div className="space-y-1">
                      <Label className="text-xs">Prazo Padrão (Dias)</Label>
                      <Input type="number" min="0" value={formData.prazo_padrao_dias} onChange={(e) => setFormData({ ...formData, prazo_padrao_dias: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Conta Bancária</Label>
                      <Input value={formData.conta_bancaria} onChange={(e) => setFormData({ ...formData, conta_bancaria: e.target.value })} placeholder="CONTA" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox checked={formData.padrao} onCheckedChange={(v) => setFormData({ ...formData, padrao: v })} />
                      <label className="text-xs">Forma Padrão</label>
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
            <div className="flex justify-between items-center">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CreditCard className="w-4 h-4" />
                Formas ({filteredFormas.length})
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
                    <TableHead>Prazo</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Padrão</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFormas.map((forma) => (
                    <TableRow key={forma.id} className="text-xs">
                      <TableCell className="font-bold">{forma.numero_forma}</TableCell>
                      <TableCell className="font-semibold">{forma.descricao}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs py-0">{forma.tipo}</Badge></TableCell>
                      <TableCell>{forma.prazo_padrao_dias || 0}d</TableCell>
                      <TableCell>{forma.conta_bancaria || '-'}</TableCell>
                      <TableCell>{forma.padrao && <Badge className="bg-blue-100 text-blue-800 text-xs py-0">Padrão</Badge>}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs py-0 ${forma.ativo !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'}`}>
                          {forma.ativo !== false ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => handleEdit(forma)} className="text-xs">Editar</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDeleteConfirmId(forma.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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
      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
        title="Confirmar exclusão"
        description="Tem certeza que deseja excluir esta forma de pagamento? Esta ação não pode ser desfeita."
        onConfirm={() => {
          deleteMutation.mutate(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </div>
  );
}
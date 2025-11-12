import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CreditCard, Plus, Edit, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

export default function FormasPagamento() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    codigo: "",
    nome: "",
    tipo: "PIX",
    prazo_dias: "0",
    taxa_percentual: "0",
    permite_parcelamento: false,
    max_parcelas: "",
    conta_bancaria_padrao_id: "",
    gera_boleto: false,
    ativa: true,
    observacoes: ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: formas = [], isLoading } = useQuery({
    queryKey: ['formas_pagamento', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return [];
      const all = await base44.entities.FormaPagamento.list();
      return all.filter(f => f && f.empresa_id === empresaSelecionadaId) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: contas = [] } = useQuery({
    queryKey: ['contas_fp'],
    queryFn: async () => {
      const all = await base44.entities.ContaBancaria.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId && c.ativa !== false) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.FormaPagamento.create({
      empresa_id: empresaSelecionadaId,
      ...data,
      prazo_dias: parseInt(data.prazo_dias) || 0,
      taxa_percentual: parseFloat(data.taxa_percentual) || 0,
      max_parcelas: parseInt(data.max_parcelas) || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formas_pagamento'] });
      resetForm();
      toast.success('✅ Forma de pagamento cadastrada!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FormaPagamento.update(id, {
      ...data,
      prazo_dias: parseInt(data.prazo_dias) || 0,
      taxa_percentual: parseFloat(data.taxa_percentual) || 0,
      max_parcelas: parseInt(data.max_parcelas) || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formas_pagamento'] });
      resetForm();
      toast.success('✅ Forma atualizada!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.FormaPagamento.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['formas_pagamento'] });
      toast.success('✅ Forma excluída!');
    },
  });

  const resetForm = () => {
    setFormData({
      codigo: "",
      nome: "",
      tipo: "PIX",
      prazo_dias: "0",
      taxa_percentual: "0",
      permite_parcelamento: false,
      max_parcelas: "",
      conta_bancaria_padrao_id: "",
      gera_boleto: false,
      ativa: true,
      observacoes: ""
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome || !formData.tipo) {
      toast.error('❌ Preencha os campos obrigatórios!');
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (forma) => {
    setFormData({
      ...forma,
      prazo_dias: String(forma.prazo_dias || 0),
      taxa_percentual: String(forma.taxa_percentual || 0),
      max_parcelas: String(forma.max_parcelas || ''),
    });
    setEditingId(forma.id);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ Deseja excluir esta forma de pagamento?')) {
      deleteMutation.mutate(id);
    }
  };

  const formasFiltradas = formas.filter(f => {
    const searchLower = searchTerm.toLowerCase();
    return !searchTerm ||
      f.nome?.toLowerCase().includes(searchLower) ||
      f.codigo?.toLowerCase().includes(searchLower) ||
      f.tipo?.toLowerCase().includes(searchLower);
  });

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Formas de Pagamento</h1>
          <p className="text-sm text-slate-600 mt-1">Configure as formas de pagamento aceitas</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          Nova Forma
        </Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card>
              <CardHeader className="border-b bg-slate-50">
                <CardTitle className="text-base">
                  {editingId ? 'Editar Forma de Pagamento' : 'Nova Forma de Pagamento'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Nome *</Label>
                      <Input
                        value={formData.nome}
                        onChange={(e) => setFormData({...formData, nome: e.target.value})}
                        placeholder="Ex: PIX à Vista"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Código</Label>
                      <Input
                        value={formData.codigo}
                        onChange={(e) => setFormData({...formData, codigo: e.target.value})}
                        placeholder="Ex: PIX-01"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Tipo *</Label>
                      <Select value={formData.tipo} onValueChange={(v) => setFormData({...formData, tipo: v})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PIX">PIX</SelectItem>
                          <SelectItem value="Boleto">Boleto</SelectItem>
                          <SelectItem value="TED/DOC">TED/DOC</SelectItem>
                          <SelectItem value="Cartão Crédito">Cartão Crédito</SelectItem>
                          <SelectItem value="Cartão Débito">Cartão Débito</SelectItem>
                          <SelectItem value="Cheque">Cheque</SelectItem>
                          <SelectItem value="Dinheiro">Dinheiro</SelectItem>
                          <SelectItem value="Depósito">Depósito</SelectItem>
                          <SelectItem value="Outros">Outros</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Prazo (dias)</Label>
                      <Input
                        type="number"
                        value={formData.prazo_dias}
                        onChange={(e) => setFormData({...formData, prazo_dias: e.target.value})}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Taxa %</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.taxa_percentual}
                        onChange={(e) => setFormData({...formData, taxa_percentual: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Conta Bancária Padrão</Label>
                    <Select value={formData.conta_bancaria_padrao_id} onValueChange={(v) => setFormData({...formData, conta_bancaria_padrao_id: v})}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione (opcional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {contas.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.nome_conta}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={formData.permite_parcelamento}
                        onCheckedChange={(v) => setFormData({...formData, permite_parcelamento: v})}
                      />
                      <Label>Permite Parcelamento</Label>
                    </div>

                    {formData.permite_parcelamento && (
                      <div className="space-y-2">
                        <Label>Máximo de Parcelas</Label>
                        <Input
                          type="number"
                          value={formData.max_parcelas}
                          onChange={(e) => setFormData({...formData, max_parcelas: e.target.value})}
                          placeholder="Ex: 12"
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.gera_boleto}
                      onCheckedChange={(v) => setFormData({...formData, gera_boleto: v})}
                    />
                    <Label>Gera Boleto Automaticamente</Label>
                  </div>

                  <div className="space-y-2">
                    <Label>Observações</Label>
                    <Textarea
                      value={formData.observacoes}
                      onChange={(e) => setFormData({...formData, observacoes: e.target.value})}
                      rows={2}
                      className="text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={formData.ativa}
                      onCheckedChange={(v) => setFormData({...formData, ativa: v})}
                    />
                    <Label>Forma Ativa</Label>
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancelar
                    </Button>
                    <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                      {editingId ? 'Atualizar' : 'Cadastrar'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TABELA */}
      <Card>
        <CardHeader className="border-b bg-slate-50">
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Formas Cadastradas
              <Badge variant="secondary">{formasFiltradas.length}</Badge>
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar forma..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="h-8 text-xs">Código</TableHead>
                  <TableHead className="h-8 text-xs">Nome</TableHead>
                  <TableHead className="h-8 text-xs">Tipo</TableHead>
                  <TableHead className="h-8 text-xs">Prazo</TableHead>
                  <TableHead className="h-8 text-xs">Taxa %</TableHead>
                  <TableHead className="h-8 text-xs">Parcela</TableHead>
                  <TableHead className="h-8 text-xs">Status</TableHead>
                  <TableHead className="h-8 text-xs text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-4 text-xs">Carregando...</TableCell>
                  </TableRow>
                ) : formasFiltradas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <CreditCard className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-xs text-slate-500">Nenhuma forma de pagamento cadastrada</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  formasFiltradas.map((forma) => (
                    <TableRow key={forma.id} className="hover:bg-slate-50">
                      <TableCell className="py-2 text-xs font-mono">{forma.codigo || '-'}</TableCell>
                      <TableCell className="py-2 text-xs font-medium">{forma.nome}</TableCell>
                      <TableCell className="py-2">
                        <Badge variant="outline" className="text-xs">{forma.tipo}</Badge>
                      </TableCell>
                      <TableCell className="py-2 text-xs">{forma.prazo_dias} dias</TableCell>
                      <TableCell className="py-2 text-xs">{forma.taxa_percentual}%</TableCell>
                      <TableCell className="py-2 text-xs">
                        {forma.permite_parcelamento ? `Até ${forma.max_parcelas || '∞'}x` : 'Não'}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge className={forma.ativa ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}>
                          {forma.ativa ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(forma)} className="h-6 w-6">
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(forma.id)} className="h-6 w-6 text-red-600">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
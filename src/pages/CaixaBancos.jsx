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
import { Textarea } from "@/components/ui/textarea";
import { Wallet, Plus, Edit, Trash2, DollarSign, Save, X } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function CaixaBancos() {
  const [showForm, setShowForm] = useState(false);
  const [editingConta, setEditingConta] = useState(null);
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const [formData, setFormData] = useState({
    tipo: "Conta Corrente",
    banco: "",
    agencia: "",
    numero: "",
    titular: "",
    documento_titular: "",
    saldo_inicial: "",
    data_abertura: "",
    limite_credito: "",
    ativo: true,
    observacoes: ""
  });

  const queryClient = useQueryClient();

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ['contas_bancarias', empresaSelecionadaId],
    queryFn: async () => {
      const result = await base44.entities.ContaBancaria.filter({ empresa_id: empresaSelecionadaId });
      return result || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.ContaBancaria.list();
      const maxNum = all.reduce((max, c) => Math.max(max, parseInt(c.numero_conta) || 0), 0);
      return base44.entities.ContaBancaria.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_conta: String(maxNum + 1),
        saldo_atual: data.saldo_inicial
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas_bancarias'] });
      queryClient.invalidateQueries({ queryKey: ['contas_form'] });
      resetForm();
      toast.success('Conta cadastrada!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ContaBancaria.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas_bancarias'] });
      queryClient.invalidateQueries({ queryKey: ['contas_form'] });
      resetForm();
      toast.success('Conta atualizada!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ContaBancaria.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas_bancarias'] });
      queryClient.invalidateQueries({ queryKey: ['contas_form'] });
      toast.success('Conta excluída!');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.tipo || !formData.titular || !formData.banco || !formData.agencia || !formData.numero || !formData.documento_titular || !formData.saldo_inicial || !formData.data_abertura) {
      toast.error('Preencha todos os campos obrigatórios!');
      return;
    }

    const dataToSubmit = {
      tipo: formData.tipo,
      banco: formData.banco.toUpperCase(),
      agencia: formData.agencia,
      numero: formData.numero,
      titular: formData.titular.toUpperCase(),
      documento_titular: formData.documento_titular,
      saldo_inicial: parseFloat(formData.saldo_inicial.replace(',', '.')) || 0,
      data_abertura: formData.data_abertura,
      limite_credito: parseFloat(formData.limite_credito.replace(',', '.')) || 0,
      ativo: formData.ativo,
      observacoes: formData.observacoes?.toUpperCase() || ""
    };

    if (editingConta) {
      updateMutation.mutate({ id: editingConta.id, data: dataToSubmit });
    } else {
      createMutation.mutate(dataToSubmit);
    }
  };

  const handleEdit = (conta) => {
    setEditingConta(conta);
    setFormData({
      tipo: conta.tipo,
      banco: conta.banco || "",
      agencia: conta.agencia || "",
      numero: conta.numero || "",
      titular: conta.titular,
      documento_titular: conta.documento_titular || "",
      saldo_inicial: String(conta.saldo_inicial || 0).replace('.', ','),
      data_abertura: conta.data_abertura || "",
      limite_credito: String(conta.limite_credito || 0).replace('.', ','),
      ativo: conta.ativo,
      observacoes: conta.observacoes || ""
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Deseja realmente excluir esta conta?')) {
      deleteMutation.mutate(id);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingConta(null);
    setFormData({
      tipo: "Conta Corrente",
      banco: "",
      agencia: "",
      numero: "",
      titular: "",
      documento_titular: "",
      saldo_inicial: "",
      data_abertura: "",
      limite_credito: "",
      ativo: true,
      observacoes: ""
    });
  };

  const saldoTotal = contas.filter(c => c.ativo).reduce((sum, c) => sum + (c.saldo_atual || 0), 0);

  return (
    <div className="p-6 space-y-4">
      {!showForm && (
        <>
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Caixa & Bancos</h1>
              <p className="text-sm text-slate-600">Gerencie contas bancárias e caixa</p>
            </div>
            <Button onClick={() => setShowForm(true)} size="sm" className="h-9 gap-1.5 bg-slate-700 hover:bg-slate-800">
              <Plus className="w-4 h-4" />
              Nova Conta
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                  <Wallet className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-600">Saldo Total</p>
                  <p className="text-lg font-bold text-slate-900">{formatarMoeda(saldoTotal)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-600">Contas Ativas</p>
                  <p className="text-lg font-bold text-slate-900">{contas.filter(c => c.ativo).length}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs">Tipo</TableHead>
                    <TableHead className="text-xs">Titular</TableHead>
                    <TableHead className="text-xs">Banco/Agência/Conta</TableHead>
                    <TableHead className="text-xs text-right">Saldo</TableHead>
                    <TableHead className="text-xs text-center">Status</TableHead>
                    <TableHead className="text-xs text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell></TableRow>
                  ) : contas.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-slate-400 text-xs">Nenhuma conta cadastrada</TableCell></TableRow>
                  ) : (
                    contas.map((conta) => (
                      <TableRow key={conta.id} className="hover:bg-slate-50">
                        <TableCell className="text-xs"><Badge variant="outline">{conta.tipo}</Badge></TableCell>
                        <TableCell className="text-xs font-medium">{conta.titular}</TableCell>
                        <TableCell className="text-xs text-slate-600">{conta.banco} {conta.agencia && `• ${conta.agencia}`} {conta.numero && `• ${conta.numero}`}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda(conta.saldo_atual || 0)}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={conta.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                            {conta.ativo ? 'Ativa' : 'Inativa'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1">
                            <Button onClick={() => handleEdit(conta)} variant="ghost" size="icon" className="h-7 w-7"><Edit className="w-3.5 h-3.5" /></Button>
                            <Button onClick={() => handleDelete(conta.id)} variant="ghost" size="icon" className="h-7 w-7 text-red-600"><Trash2 className="w-3.5 h-3.5" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {showForm && (
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
          <Card className="shadow-xl border-slate-200 bg-white">
            <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
              <CardTitle className="flex items-center gap-3 text-slate-900">
                <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-white" />
                </div>
                {editingConta ? 'Editar Conta' : 'Nova Conta Bancária'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Tipo *</Label>
                    <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })} required>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Conta Corrente">Conta Corrente</SelectItem>
                        <SelectItem value="Poupança">Poupança</SelectItem>
                        <SelectItem value="Caixa">Caixa</SelectItem>
                        <SelectItem value="Aplicação">Aplicação</SelectItem>
                        <SelectItem value="Cartão de Crédito">Cartão de Crédito</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Titular *</Label>
                    <Input value={formData.titular} onChange={(e) => setFormData({ ...formData, titular: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} required />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>Banco *</Label>
                    <Input value={formData.banco} onChange={(e) => setFormData({ ...formData, banco: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Agência *</Label>
                    <Input value={formData.agencia} onChange={(e) => setFormData({ ...formData, agencia: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Número *</Label>
                    <Input value={formData.numero} onChange={(e) => setFormData({ ...formData, numero: e.target.value })} required />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>CPF/CNPJ *</Label>
                    <Input value={formData.documento_titular} onChange={(e) => setFormData({ ...formData, documento_titular: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Saldo Inicial *</Label>
                    <Input value={formData.saldo_inicial} onChange={(e) => setFormData({ ...formData, saldo_inicial: e.target.value })} placeholder="0,00" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Data Abertura *</Label>
                    <Input type="date" value={formData.data_abertura} onChange={(e) => setFormData({ ...formData, data_abertura: e.target.value })} required />
                  </div>
                </div>

                {formData.tipo === "Cartão de Crédito" && (
                  <div className="space-y-2">
                    <Label>Limite de Crédito</Label>
                    <Input value={formData.limite_credito} onChange={(e) => setFormData({ ...formData, limite_credito: e.target.value })} placeholder="0,00" />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Observações</Label>
                  <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                </div>

                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={formData.ativo} onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })} className="rounded" />
                  <Label>Conta Ativa</Label>
                </div>

                <div className="flex justify-end gap-3 pt-6 border-t">
                  <Button type="button" variant="outline" onClick={resetForm} className="gap-2">
                    <X className="w-4 h-4" />
                    Cancelar
                  </Button>
                  <Button type="submit" className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg">
                    <Save className="w-4 h-4" />
                    {editingConta ? 'Atualizar' : 'Salvar'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
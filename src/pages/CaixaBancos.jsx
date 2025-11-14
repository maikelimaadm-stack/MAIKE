import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Wallet, Plus, Save, X, Edit, Trash2, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { getEmpresaSelecionada } from "@/Layout";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function CaixaBancos() {
  const [showForm, setShowForm] = useState(false);
  const [editingConta, setEditingConta] = useState(null);
  const empresaSelecionadaId = getEmpresaSelecionada();

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
      resetForm();
      toast.success('Conta cadastrada!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ContaBancaria.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas_bancarias'] });
      resetForm();
      toast.success('Conta atualizada!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ContaBancaria.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas_bancarias'] });
      toast.success('Conta excluída!');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.tipo || !formData.titular || !formData.banco || !formData.agencia || !formData.numero || !formData.documento_titular || !formData.saldo_inicial || !formData.data_abertura) {
      toast.error('❌ Preencha todos os campos obrigatórios!');
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

  const handleNovo = () => {
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
    setShowForm(true);
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
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Caixa & Bancos</h1>
              <p className="text-sm text-slate-600">Gerencie contas bancárias e caixa</p>
            </div>
            <Button onClick={handleNovo} size="sm" className="h-9 gap-1.5 bg-slate-700 hover:bg-slate-800">
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

          <Card className="shadow-sm border-slate-200">
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[600px]">
                <table className="w-full">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr className="border-b border-slate-200">
                      <th className="text-left text-xs font-semibold text-slate-700 px-4 py-3">Tipo</th>
                      <th className="text-left text-xs font-semibold text-slate-700 px-4 py-3">Titular</th>
                      <th className="text-left text-xs font-semibold text-slate-700 px-4 py-3">Banco</th>
                      <th className="text-left text-xs font-semibold text-slate-700 px-4 py-3">Agência/Conta</th>
                      <th className="text-right text-xs font-semibold text-slate-700 px-4 py-3">Saldo</th>
                      <th className="text-center text-xs font-semibold text-slate-700 px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-xs">Carregando...</td></tr>
                    ) : contas.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-xs">Nenhuma conta cadastrada</td></tr>
                    ) : (
                      contas.map((conta) => (
                        <ContextMenu key={conta.id}>
                          <ContextMenuTrigger asChild>
                            <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-context-menu">
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-slate-100 text-slate-700">{conta.tipo}</span>
                              </td>
                              <td className="px-4 py-3 text-xs font-medium">{conta.titular}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{conta.banco}</td>
                              <td className="px-4 py-3 text-xs text-slate-600">{conta.agencia} / {conta.numero}</td>
                              <td className="px-4 py-3 text-right font-mono text-xs font-semibold">{formatarMoeda(conta.saldo_atual || 0)}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${conta.ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {conta.ativo ? 'Ativa' : 'Inativa'}
                                </span>
                              </td>
                            </tr>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => handleEdit(conta)} className="text-xs">
                              <Edit className="w-3 h-3 mr-2" />
                              Editar
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => handleDelete(conta.id)} className="text-xs text-red-600">
                              <Trash2 className="w-3 h-3 mr-2" />
                              Excluir
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
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
                {editingConta ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Tipo de Conta *</Label>
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
                    <Input value={formData.titular} onChange={(e) => setFormData({ ...formData, titular: e.target.value })} className="uppercase" required />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>Banco *</Label>
                    <Input value={formData.banco} onChange={(e) => setFormData({ ...formData, banco: e.target.value })} className="uppercase" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Agência *</Label>
                    <Input value={formData.agencia} onChange={(e) => setFormData({ ...formData, agencia: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Número da Conta *</Label>
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
                    <Label>Limite de Crédito *</Label>
                    <Input value={formData.limite_credito} onChange={(e) => setFormData({ ...formData, limite_credito: e.target.value })} placeholder="0,00" required />
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Observações</Label>
                  <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="uppercase" rows={3} />
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
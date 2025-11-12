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
import { Landmark, Plus, Edit, Trash2, Search, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const getNextNumero = async (empresaId) => {
  const all = await base44.entities.ContaBancaria.list();
  const filtered = all.filter(c => c && c.empresa_id === empresaId);
  return filtered.reduce((max, c) => Math.max(max, parseInt(c.numero_conta) || 0), 0) + 1;
};

export default function ContasBancarias() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    nome_conta: "",
    banco_codigo: "",
    banco_nome: "",
    agencia: "",
    agencia_digito: "",
    conta: "",
    conta_digito: "",
    tipo_conta: "Corrente",
    saldo_inicial: "0",
    convenio: "",
    carteira: "",
    gerente_nome: "",
    gerente_telefone: "",
    data_abertura: new Date().toISOString().split('T')[0],
    ativa: true,
    observacoes: ""
  });

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();

  const { data: contas = [], isLoading } = useQuery({
    queryKey: ['contas_bancarias', empresaSelecionadaId],
    queryFn: async () => {
      if (!empresaSelecionadaId) return [];
      const all = await base44.entities.ContaBancaria.list();
      return all.filter(c => c && c.empresa_id === empresaSelecionadaId) || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const numero = await getNextNumero(empresaSelecionadaId);
      return base44.entities.ContaBancaria.create({
        empresa_id: empresaSelecionadaId,
        numero_conta: String(numero),
        ...data,
        saldo_inicial: parseFloat(data.saldo_inicial) || 0,
        saldo_atual: parseFloat(data.saldo_inicial) || 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas_bancarias'] });
      resetForm();
      toast.success('✅ Conta bancária cadastrada!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ContaBancaria.update(id, {
      ...data,
      saldo_inicial: parseFloat(data.saldo_inicial) || 0,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas_bancarias'] });
      resetForm();
      toast.success('✅ Conta atualizada!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ContaBancaria.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas_bancarias'] });
      toast.success('✅ Conta excluída!');
    },
  });

  const resetForm = () => {
    setFormData({
      nome_conta: "",
      banco_codigo: "",
      banco_nome: "",
      agencia: "",
      agencia_digito: "",
      conta: "",
      conta_digito: "",
      tipo_conta: "Corrente",
      saldo_inicial: "0",
      convenio: "",
      carteira: "",
      gerente_nome: "",
      gerente_telefone: "",
      data_abertura: new Date().toISOString().split('T')[0],
      ativa: true,
      observacoes: ""
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.nome_conta || !formData.banco_codigo || !formData.conta) {
      toast.error('❌ Preencha os campos obrigatórios!');
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleEdit = (conta) => {
    setFormData({
      ...conta,
      saldo_inicial: String(conta.saldo_inicial || 0),
    });
    setEditingId(conta.id);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ Deseja excluir esta conta bancária?')) {
      deleteMutation.mutate(id);
    }
  };

  const contasFiltradas = contas.filter(c => {
    const searchLower = searchTerm.toLowerCase();
    return !searchTerm ||
      c.nome_conta?.toLowerCase().includes(searchLower) ||
      c.banco_nome?.toLowerCase().includes(searchLower) ||
      c.agencia?.includes(searchTerm) ||
      c.conta?.includes(searchTerm);
  });

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contas Bancárias</h1>
          <p className="text-sm text-slate-600 mt-1">Gerencie as contas bancárias da empresa</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          Nova Conta
        </Button>
      </div>

      {/* FORMULÁRIO */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card>
              <CardHeader className="border-b bg-slate-50">
                <CardTitle className="text-base">
                  {editingId ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Nome da Conta *</Label>
                      <Input
                        value={formData.nome_conta}
                        onChange={(e) => setFormData({...formData, nome_conta: e.target.value})}
                        placeholder="Ex: Banco do Brasil - Conta Corrente"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Tipo de Conta</Label>
                      <Select value={formData.tipo_conta} onValueChange={(v) => setFormData({...formData, tipo_conta: v})}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Corrente">Conta Corrente</SelectItem>
                          <SelectItem value="Poupança">Poupança</SelectItem>
                          <SelectItem value="Investimento">Investimento</SelectItem>
                          <SelectItem value="Caixa">Caixa</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Código do Banco *</Label>
                      <Input
                        value={formData.banco_codigo}
                        onChange={(e) => setFormData({...formData, banco_codigo: e.target.value})}
                        placeholder="001, 237, 341..."
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Nome do Banco</Label>
                      <Input
                        value={formData.banco_nome}
                        onChange={(e) => setFormData({...formData, banco_nome: e.target.value})}
                        placeholder="Ex: Banco do Brasil"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Agência *</Label>
                      <Input
                        value={formData.agencia}
                        onChange={(e) => setFormData({...formData, agencia: e.target.value})}
                        placeholder="0000"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Dígito Agência</Label>
                      <Input
                        value={formData.agencia_digito}
                        onChange={(e) => setFormData({...formData, agencia_digito: e.target.value})}
                        placeholder="0"
                        maxLength={1}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Data Abertura</Label>
                      <Input
                        type="date"
                        value={formData.data_abertura}
                        onChange={(e) => setFormData({...formData, data_abertura: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Conta *</Label>
                      <Input
                        value={formData.conta}
                        onChange={(e) => setFormData({...formData, conta: e.target.value})}
                        placeholder="00000"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Dígito Conta</Label>
                      <Input
                        value={formData.conta_digito}
                        onChange={(e) => setFormData({...formData, conta_digito: e.target.value})}
                        placeholder="0"
                        maxLength={1}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Saldo Inicial</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={formData.saldo_inicial}
                        onChange={(e) => setFormData({...formData, saldo_inicial: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Convênio (Boleto/CNAB)</Label>
                      <Input
                        value={formData.convenio}
                        onChange={(e) => setFormData({...formData, convenio: e.target.value})}
                        placeholder="Número do convênio"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Carteira</Label>
                      <Input
                        value={formData.carteira}
                        onChange={(e) => setFormData({...formData, carteira: e.target.value})}
                        placeholder="Ex: 17, 18"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Gerente</Label>
                      <Input
                        value={formData.gerente_nome}
                        onChange={(e) => setFormData({...formData, gerente_nome: e.target.value})}
                        placeholder="Nome do gerente"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Telefone Gerente</Label>
                      <Input
                        value={formData.gerente_telefone}
                        onChange={(e) => setFormData({...formData, gerente_telefone: e.target.value})}
                        placeholder="(00) 00000-0000"
                      />
                    </div>
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
                    <Label>Conta Ativa</Label>
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
              <Landmark className="w-5 h-5" />
              Contas Cadastradas
              <Badge variant="secondary">{contasFiltradas.length}</Badge>
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar conta..."
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
                  <TableHead className="h-8 text-xs">Nº</TableHead>
                  <TableHead className="h-8 text-xs">Nome da Conta</TableHead>
                  <TableHead className="h-8 text-xs">Banco</TableHead>
                  <TableHead className="h-8 text-xs">Agência</TableHead>
                  <TableHead className="h-8 text-xs">Conta</TableHead>
                  <TableHead className="h-8 text-xs">Tipo</TableHead>
                  <TableHead className="h-8 text-xs text-right">Saldo Atual</TableHead>
                  <TableHead className="h-8 text-xs">Status</TableHead>
                  <TableHead className="h-8 text-xs text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-4 text-xs">Carregando...</TableCell>
                  </TableRow>
                ) : contasFiltradas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <Landmark className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-xs text-slate-500">Nenhuma conta bancária cadastrada</p>
                    </TableCell>
                  </TableRow>
                ) : (
                  contasFiltradas.map((conta) => (
                    <TableRow key={conta.id} className="hover:bg-slate-50">
                      <TableCell className="py-2 text-xs font-semibold">{conta.numero_conta}</TableCell>
                      <TableCell className="py-2 text-xs font-medium">{conta.nome_conta}</TableCell>
                      <TableCell className="py-2 text-xs">{conta.banco_codigo} - {conta.banco_nome || '-'}</TableCell>
                      <TableCell className="py-2 text-xs font-mono">
                        {conta.agencia}{conta.agencia_digito ? `-${conta.agencia_digito}` : ''}
                      </TableCell>
                      <TableCell className="py-2 text-xs font-mono">
                        {conta.conta}{conta.conta_digito ? `-${conta.conta_digito}` : ''}
                      </TableCell>
                      <TableCell className="py-2 text-xs">{conta.tipo_conta}</TableCell>
                      <TableCell className="py-2 text-xs text-right font-mono font-semibold text-blue-600">
                        {formatarMoeda(conta.saldo_atual)}
                      </TableCell>
                      <TableCell className="py-2">
                        <Badge className={conta.ativa ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}>
                          {conta.ativa ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex gap-1 justify-center">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(conta)} className="h-6 w-6">
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(conta.id)} className="h-6 w-6 text-red-600">
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
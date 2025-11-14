
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
import { Package, Plus, Edit, Trash2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function AtivosFixos() {
  const [showForm, setShowForm] = useState(false);
  const [editingAtivo, setEditingAtivo] = useState(null);
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const [formData, setFormData] = useState({
    tipo: "Veículo",
    descricao: "",
    marca: "",
    modelo: "",
    ano_fabricacao: "",
    placa_chassi: "",
    data_aquisicao: "",
    valor_aquisicao: "",
    valor_atual: "",
    fornecedor_id: "",
    vida_util_anos: "",
    taxa_depreciacao: "",
    localizacao: "",
    status: "Ativo",
    observacoes: ""
  });

  const queryClient = useQueryClient();

  const { data: ativos = [], isLoading } = useQuery({
    queryKey: ['ativos_fixos', empresaSelecionadaId],
    queryFn: async () => {
      const result = await base44.entities.AtivoFixo.filter({ empresa_id: empresaSelecionadaId });
      return result || [];
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const all = await base44.entities.AtivoFixo.list();
      const maxNum = all.reduce((max, a) => Math.max(max, parseInt(a.numero_ativo) || 0), 0);
      return base44.entities.AtivoFixo.create({ ...data, empresa_id: empresaSelecionadaId, numero_ativo: String(maxNum + 1) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ativos_fixos'] });
      resetForm();
      toast.success('Ativo cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AtivoFixo.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ativos_fixos'] });
      resetForm();
      toast.success('Ativo atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AtivoFixo.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ativos_fixos'] });
      toast.success('Ativo excluído!');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    const dataToSubmit = {
      tipo: formData.tipo,
      descricao: formData.descricao.toUpperCase(),
      marca: formData.marca?.toUpperCase(),
      modelo: formData.modelo?.toUpperCase(),
      ano_fabricacao: formData.ano_fabricacao,
      placa_chassi: formData.placa_chassi?.toUpperCase(),
      data_aquisicao: formData.data_aquisicao,
      valor_aquisicao: parseFloat(formData.valor_aquisicao.replace(',', '.')) || 0,
      valor_atual: parseFloat(formData.valor_atual.replace(',', '.')) || 0,
      fornecedor_id: formData.fornecedor_id || undefined,
      vida_util_anos: parseFloat(formData.vida_util_anos) || 0,
      taxa_depreciacao: parseFloat(formData.taxa_depreciacao) || 0,
      localizacao: formData.localizacao?.toUpperCase(),
      status: formData.status,
      observacoes: formData.observacoes?.toUpperCase() || ""
    };

    if (editingAtivo) {
      updateMutation.mutate({ id: editingAtivo.id, data: dataToSubmit });
    } else {
      createMutation.mutate(dataToSubmit);
    }
  };

  const handleEdit = (ativo) => {
    setEditingAtivo(ativo);
    setFormData({
      tipo: ativo.tipo,
      descricao: ativo.descricao,
      marca: ativo.marca || "",
      modelo: ativo.modelo || "",
      ano_fabricacao: ativo.ano_fabricacao || "",
      placa_chassi: ativo.placa_chassi || "",
      data_aquisicao: ativo.data_aquisicao,
      valor_aquisicao: String(ativo.valor_aquisicao || 0).replace('.', ','),
      valor_atual: String(ativo.valor_atual || 0).replace('.', ','),
      fornecedor_id: ativo.fornecedor_id || "",
      vida_util_anos: String(ativo.vida_util_anos || ""),
      taxa_depreciacao: String(ativo.taxa_depreciacao || ""),
      localizacao: ativo.localizacao || "",
      status: ativo.status,
      observacoes: ativo.observacoes || ""
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Deseja realmente excluir este ativo?')) {
      deleteMutation.mutate(id);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingAtivo(null);
    setFormData({
      tipo: "Veículo",
      descricao: "",
      marca: "",
      modelo: "",
      ano_fabricacao: "",
      placa_chassi: "",
      data_aquisicao: "",
      valor_aquisicao: "",
      valor_atual: "",
      fornecedor_id: "",
      vida_util_anos: "",
      taxa_depreciacao: "",
      localizacao: "",
      status: "Ativo",
      observacoes: ""
    });
  };

  return (
    <div className="p-6 space-y-4">
      {!showForm && (
        <>
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Ativos Fixos</h1>
              <p className="text-sm text-slate-600">Gerencie veículos, máquinas e equipamentos</p>
            </div>
            <Button onClick={() => setShowForm(true)} size="sm" className="h-9 gap-1.5 bg-slate-700 hover:bg-slate-800">
              <Plus className="w-4 h-4" />
              Novo Ativo
            </Button>
          </div>

          <Card className="shadow-sm">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs">Tipo</TableHead>
                    <TableHead className="text-xs">Descrição</TableHead>
                    <TableHead className="text-xs">Marca/Modelo</TableHead>
                    <TableHead className="text-xs text-right">Valor Atual</TableHead>
                    <TableHead className="text-xs text-center">Status</TableHead>
                    <TableHead className="text-xs text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell></TableRow>
                  ) : ativos.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-12 text-slate-400 text-xs">Nenhum ativo cadastrado</TableCell></TableRow>
                  ) : (
                    ativos.map((ativo) => (
                      <TableRow key={ativo.id} className="hover:bg-slate-50">
                        <TableCell className="text-xs"><Badge variant="outline">{ativo.tipo}</Badge></TableCell>
                        <TableCell className="text-xs font-medium">{ativo.descricao}</TableCell>
                        <TableCell className="text-xs text-slate-600">{ativo.marca} {ativo.modelo}</TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda(ativo.valor_atual || 0)}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={ativo.status === 'Ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                            {ativo.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1">
                            <Button onClick={() => handleEdit(ativo)} variant="ghost" size="icon" className="h-7 w-7"><Edit className="w-3.5 h-3.5" /></Button>
                            <Button onClick={() => handleDelete(ativo.id)} variant="ghost" size="icon" className="h-7 w-7 text-red-600"><Trash2 className="w-3.5 h-3.5" /></Button>
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
                <div className="w-10 h-10 bg-slate-700 rounded-xl flex items-center justify-center">
                  <Package className="w-5 h-5 text-white" />
                </div>
                {editingAtivo ? 'Editar Ativo' : 'Novo Ativo Fixo'}
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
                        {["Veículo", "Máquina", "Equipamento", "Imóvel", "Terra", "Benfeitorias", "Animais de Trabalho", "Outros"].map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição *</Label>
                    <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} required />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>Marca</Label>
                    <Input value={formData.marca} onChange={(e) => setFormData({ ...formData, marca: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-2">
                    <Label>Modelo</Label>
                    <Input value={formData.modelo} onChange={(e) => setFormData({ ...formData, modelo: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-2">
                    <Label>Ano</Label>
                    <Input value={formData.ano_fabricacao} onChange={(e) => setFormData({ ...formData, ano_fabricacao: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Placa/Chassi</Label>
                    <Input value={formData.placa_chassi} onChange={(e) => setFormData({ ...formData, placa_chassi: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>
                  <div className="space-y-2">
                    <Label>Data Aquisição *</Label>
                    <Input type="date" value={formData.data_aquisicao} onChange={(e) => setFormData({ ...formData, data_aquisicao: e.target.value })} required />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Valor Aquisição *</Label>
                    <Input value={formData.valor_aquisicao} onChange={(e) => setFormData({ ...formData, valor_aquisicao: e.target.value })} placeholder="0,00" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Valor Atual</Label>
                    <Input value={formData.valor_atual} onChange={(e) => setFormData({ ...formData, valor_atual: e.target.value })} placeholder="0,00" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <Label>Vida Útil (anos)</Label>
                    <Input type="number" value={formData.vida_util_anos} onChange={(e) => setFormData({ ...formData, vida_util_anos: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Taxa Depreciação (%)</Label>
                    <Input type="number" step="0.01" value={formData.taxa_depreciacao} onChange={(e) => setFormData({ ...formData, taxa_depreciacao: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["Ativo", "Em Manutenção", "Inativo", "Vendido", "Sucateado"].map(s => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Localização</Label>
                  <Input value={formData.localizacao} onChange={(e) => setFormData({ ...formData, localizacao: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                </div>

                <div className="space-y-2">
                  <Label>Observações</Label>
                  <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                </div>

                <div className="flex justify-end gap-3 pt-6 border-t">
                  <Button type="button" variant="outline" onClick={resetForm} className="gap-2">
                    <X className="w-4 h-4" />
                    Cancelar
                  </Button>
                  <Button type="submit" className="bg-slate-700 hover:bg-slate-800 gap-2 shadow-lg">
                    <Save className="w-4 h-4" />
                    {editingAtivo ? 'Atualizar' : 'Salvar'}
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

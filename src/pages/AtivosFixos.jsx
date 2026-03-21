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
import { Plus, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { getEmpresaSelecionada } from "@/Layout";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function AtivosFixos() {
  const [showForm, setShowForm] = useState(false);
  const [editingAtivo, setEditingAtivo] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const empresaSelecionadaId = getEmpresaSelecionada();

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
      ...formData,
      valor_aquisicao: parseFloat(formData.valor_aquisicao.replace(',', '.')) || 0,
      valor_atual: parseFloat(formData.valor_atual.replace(',', '.')) || 0,
      vida_util_anos: parseFloat(formData.vida_util_anos) || 0,
      taxa_depreciacao: parseFloat(formData.taxa_depreciacao) || 0,
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

  const handleDelete = (id, skipConfirm = false) => {
    if (!skipConfirm) {
      setDeleteConfirmId(id);
      return;
    }
    deleteMutation.mutate(id);
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
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Ativos Fixos</h1>
          <p className="text-sm text-slate-600">Gerencie veículos, máquinas e equipamentos</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
          Novo Ativo
        </Button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-lg border-slate-300">
              <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-50 border-b py-3">
                <CardTitle className="text-sm font-semibold">{editingAtivo ? 'Editar Ativo' : 'Novo Ativo'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Tipo *</Label>
                      <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["Veículo", "Máquina", "Equipamento", "Imóvel", "Terra", "Benfeitorias", "Animais de Trabalho", "Outros"].map(t => (
                            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Descrição *</Label>
                      <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} className="h-8 text-xs uppercase" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Marca</Label>
                      <Input value={formData.marca} onChange={(e) => setFormData({ ...formData, marca: e.target.value })} className="h-8 text-xs uppercase" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Modelo</Label>
                      <Input value={formData.modelo} onChange={(e) => setFormData({ ...formData, modelo: e.target.value })} className="h-8 text-xs uppercase" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Ano</Label>
                      <Input value={formData.ano_fabricacao} onChange={(e) => setFormData({ ...formData, ano_fabricacao: e.target.value })} className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Placa/Chassi</Label>
                      <Input value={formData.placa_chassi} onChange={(e) => setFormData({ ...formData, placa_chassi: e.target.value })} className="h-8 text-xs uppercase" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Data Aquisição *</Label>
                      <Input type="date" value={formData.data_aquisicao} onChange={(e) => setFormData({ ...formData, data_aquisicao: e.target.value })} className="h-8 text-xs" required />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Valor Aquisição *</Label>
                      <Input value={formData.valor_aquisicao} onChange={(e) => setFormData({ ...formData, valor_aquisicao: e.target.value })} placeholder="0,00" className="h-8 text-xs" required />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Valor Atual</Label>
                      <Input value={formData.valor_atual} onChange={(e) => setFormData({ ...formData, valor_atual: e.target.value })} placeholder="0,00" className="h-8 text-xs" />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Vida Útil (anos)</Label>
                      <Input type="number" value={formData.vida_util_anos} onChange={(e) => setFormData({ ...formData, vida_util_anos: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Taxa Depreciação (%)</Label>
                      <Input type="number" step="0.01" value={formData.taxa_depreciacao} onChange={(e) => setFormData({ ...formData, taxa_depreciacao: e.target.value })} className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Status</Label>
                      <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["Ativo", "Em Manutenção", "Inativo", "Vendido", "Sucateado"].map(s => (
                            <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Localização</Label>
                    <Input value={formData.localizacao} onChange={(e) => setFormData({ ...formData, localizacao: e.target.value })} className="h-8 text-xs uppercase" />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Observações</Label>
                    <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} className="text-xs uppercase" rows={2} />
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={resetForm} size="sm" className="h-8 text-xs">Cancelar</Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">Salvar</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
        title="Confirmar exclusão"
        description="Tem certeza que deseja excluir este ativo? Esta ação não pode ser desfeita."
        onConfirm={() => {
          handleDelete(deleteConfirmId, true);
          setDeleteConfirmId(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />

      <Card className="shadow-sm border-slate-300">
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
                    <TableCell className="text-xs"><Badge variant="outline" className="text-xs">{ativo.tipo}</Badge></TableCell>
                    <TableCell className="text-xs font-medium">{ativo.descricao}</TableCell>
                    <TableCell className="text-xs text-slate-600">{ativo.marca} {ativo.modelo}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda(ativo.valor_atual || 0)}</TableCell>
                    <TableCell className="text-center">
                      <Badge className={`text-xs ${ativo.status === 'Ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {ativo.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center gap-1">
                        <Button onClick={() => handleEdit(ativo)} variant="ghost" size="icon" className="h-7 w-7"><Edit className="w-3.5 h-3.5" /></Button>
                        <Button onClick={() => setDeleteConfirmId(ativo.id)} variant="ghost" size="icon" className="h-7 w-7 text-red-600"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
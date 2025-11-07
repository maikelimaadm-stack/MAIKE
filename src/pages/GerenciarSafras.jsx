import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, Layers, Save, X, Calendar } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";

export default function GerenciarSafras() {
  const [showForm, setShowForm] = useState(false);
  const [editingSafra, setEditingSafra] = useState(null);
  const [formData, setFormData] = useState({
    ano_inicio: "",
    ano_fim: "",
    descricao: "",
    status: "Planejamento",
    observacoes: ""
  });

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: safras = [] } = useQuery({
    queryKey: ['safras', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Safra.list('-created_date');
      return all.filter(s => s.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Safra.create({
      ...data,
      empresa_id: empresaSelecionadaId
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      setShowForm(false);
      setEditingSafra(null);
      resetForm();
      toast.success('Safra cadastrada com sucesso!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Safra.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      setShowForm(false);
      setEditingSafra(null);
      resetForm();
      toast.success('Safra atualizada com sucesso!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Safra.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      toast.success('Safra excluída com sucesso!');
    },
  });

  const resetForm = () => {
    setFormData({
      ano_inicio: "",
      ano_fim: "",
      descricao: "",
      status: "Planejamento",
      observacoes: ""
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const data = {
      ano_inicio: formData.ano_inicio,
      ano_fim: formData.ano_fim,
      descricao: formData.descricao?.toUpperCase(),
      status: formData.status,
      observacoes: formData.observacoes?.toUpperCase()
    };

    if (editingSafra) {
      updateMutation.mutate({ id: editingSafra.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (safra) => {
    setEditingSafra(safra);
    setFormData({
      ano_inicio: safra.ano_inicio,
      ano_fim: safra.ano_fim,
      descricao: safra.descricao || "",
      status: safra.status || "Planejamento",
      observacoes: safra.observacoes || ""
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Deseja realmente excluir esta safra? Esta ação não pode ser desfeita.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleNew = () => {
    setEditingSafra(null);
    resetForm();
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingSafra(null);
    resetForm();
  };

  const getStatusBadge = (status) => {
    const config = {
      'Planejamento': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'Em Andamento': 'bg-blue-100 text-blue-800 border-blue-300',
      'Finalizada': 'bg-green-100 text-green-800 border-green-300',
    };
    return config[status] || config['Planejamento'];
  };

  const totalSafras = safras.length;
  const safrasEmAndamento = safras.filter(s => s.status === 'Em Andamento').length;
  const safrasFinalizadas = safras.filter(s => s.status === 'Finalizada').length;

  return (
    <div className="p-6 space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total de Safras</CardTitle>
            <Layers className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalSafras}</div>
            <p className="text-xs text-green-600 mt-1">Safras cadastradas</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Em Andamento</CardTitle>
            <Calendar className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{safrasEmAndamento}</div>
            <p className="text-xs text-blue-600 mt-1">Safras ativas</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-purple-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Finalizadas</CardTitle>
            <Calendar className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{safrasFinalizadas}</div>
            <p className="text-xs text-purple-600 mt-1">Safras concluídas</p>
          </CardContent>
        </Card>
      </div>

      {/* Botão Nova Safra */}
      {!showForm && (
        <div className="flex justify-end">
          <Button onClick={handleNew} className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg" size="lg">
            <Plus className="w-5 h-5" />
            Nova Safra
          </Button>
        </div>
      )}

      {/* Formulário */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-xl border-slate-200 bg-white">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200">
                <CardTitle className="flex items-center gap-3 text-slate-900">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center">
                    <Layers className="w-5 h-5 text-white" />
                  </div>
                  {editingSafra ? 'Editar Safra' : 'Nova Safra'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <Label className="text-slate-700 font-medium">Ano Início *</Label>
                      <Input
                        type="number"
                        value={formData.ano_inicio}
                        onChange={(e) => setFormData({ ...formData, ano_inicio: e.target.value })}
                        placeholder="2024"
                        required
                        className="border-slate-300 focus:border-green-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-slate-700 font-medium">Ano Fim *</Label>
                      <Input
                        type="number"
                        value={formData.ano_fim}
                        onChange={(e) => setFormData({ ...formData, ano_fim: e.target.value })}
                        placeholder="2025"
                        required
                        className="border-slate-300 focus:border-green-500"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-slate-700 font-medium">Status</Label>
                      <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                        <SelectTrigger className="border-slate-300 focus:border-green-500">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Planejamento">Planejamento</SelectItem>
                          <SelectItem value="Em Andamento">Em Andamento</SelectItem>
                          <SelectItem value="Finalizada">Finalizada</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium">Descrição</Label>
                    <Input
                      value={formData.descricao}
                      onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                      placeholder="DESCRIÇÃO DA SAFRA"
                      className="border-slate-300 focus:border-green-500 uppercase"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium">Observações</Label>
                    <Textarea
                      value={formData.observacoes}
                      onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                      placeholder="OBSERVAÇÕES SOBRE A SAFRA..."
                      className="border-slate-300 focus:border-green-500 min-h-20 uppercase"
                      style={{ textTransform: 'uppercase' }}
                    />
                  </div>

                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={handleCancel} className="gap-2">
                      <X className="w-4 h-4" />
                      Cancelar
                    </Button>
                    <Button type="submit" className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 gap-2 shadow-lg">
                      <Save className="w-4 h-4" />
                      {editingSafra ? 'Atualizar' : 'Salvar'} Safra
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabela */}
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <Layers className="w-5 h-5 text-white" />
            </div>
            Safras Cadastradas
            <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
              {safras.length} {safras.length === 1 ? 'safra' : 'safras'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50">
                  <TableHead className="font-semibold text-slate-700">Período</TableHead>
                  <TableHead className="font-semibold text-slate-700">Descrição</TableHead>
                  <TableHead className="font-semibold text-slate-700">Status</TableHead>
                  <TableHead className="font-semibold text-slate-700">Observações</TableHead>
                  <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {safras.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Layers className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhuma safra cadastrada</p>
                        <p className="text-sm">Comece cadastrando uma nova safra</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  safras.map((safra) => (
                    <TableRow key={safra.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <TableCell className="font-bold text-slate-900">
                        {safra.ano_inicio}/{safra.ano_fim}
                      </TableCell>
                      <TableCell className="text-slate-700">{safra.descricao || '-'}</TableCell>
                      <TableCell>
                        <Badge className={`${getStatusBadge(safra.status)} border`}>
                          {safra.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 max-w-xs truncate">
                        {safra.observacoes || '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(safra)}
                            className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                            title="Editar"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(safra.id)}
                            className="hover:bg-red-50 hover:text-red-700 transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
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
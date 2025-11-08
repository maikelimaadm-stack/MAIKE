import React, { useState, useEffect } from "react";
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
import { Plus, Edit, Trash2, Layers, Save, X, Building } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Switch } from "@/components/ui/switch";

const getNextNumero = async () => {
  try {
    const all = await base44.entities.CentroCusto.list();
    const numeros = all.map(c => parseInt(c.numero_centro) || 0).filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch {
    return 1;
  }
};

export default function CentrosCusto() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({
    nome: "",
    tipo: "Setor",
    codigo: "",
    responsavel: "",
    descricao: "",
    ativo: true
  });

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: centros = [] } = useQuery({
    queryKey: ['centros', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CentroCusto.list('-created_date');
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    const numerarExistentes = async () => {
      const semNumero = centros.filter(c => !c.numero_centro);
      if (semNumero.length > 0) {
        for (const centro of semNumero) {
          const num = await getNextNumero();
          await base44.entities.CentroCusto.update(centro.id, { numero_centro: String(num) });
        }
        queryClient.invalidateQueries({ queryKey: ['centros'] });
      }
    };
    if (centros.length > 0) numerarExistentes();
  }, [centros, queryClient]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const num = await getNextNumero();
      return base44.entities.CentroCusto.create({ ...data, numero_centro: String(num), empresa_id: empresaSelecionadaId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['centros'] });
      setShowForm(false);
      resetForm();
      toast.success('Centro de custo cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CentroCusto.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['centros'] });
      setShowForm(false);
      setEditing(null);
      resetForm();
      toast.success('Centro atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CentroCusto.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['centros'] });
      toast.success('Centro excluído!');
    },
  });

  const resetForm = () => {
    setFormData({ nome: "", tipo: "Setor", codigo: "", responsavel: "", descricao: "", ativo: true });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const data = {
      nome: formData.nome?.toUpperCase(),
      tipo: formData.tipo,
      codigo: formData.codigo?.toUpperCase() || undefined,
      responsavel: formData.responsavel?.toUpperCase() || undefined,
      descricao: formData.descricao?.toUpperCase() || undefined,
      ativo: formData.ativo
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (centro) => {
    setEditing(centro);
    setFormData({
      nome: centro.nome || "",
      tipo: centro.tipo || "Setor",
      codigo: centro.codigo || "",
      responsavel: centro.responsavel || "",
      descricao: centro.descricao || "",
      ativo: centro.ativo !== false
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('Deseja excluir este centro de custo?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleNew = () => {
    setEditing(null);
    resetForm();
    setShowForm(true);
  };

  const totalCentros = centros.length;
  const centrosAtivos = centros.filter(c => c.ativo !== false).length;

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-green-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Total</CardTitle>
            <Building className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">{totalCentros}</div>
            <p className="text-xs text-green-600 mt-1">Centros cadastrados</p>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-green-200 bg-gradient-to-br from-white to-blue-50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Ativos</CardTitle>
            <Layers className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-900">{centrosAtivos}</div>
            <p className="text-xs text-blue-600 mt-1">Em uso</p>
          </CardContent>
        </Card>
      </div>

      {!showForm && (
        <div className="flex justify-end">
          <Button onClick={handleNew} className="bg-gradient-to-r from-green-600 to-green-700 gap-2 shadow-lg" size="lg">
            <Plus className="w-5 h-5" />
            Novo Centro de Custo
          </Button>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-xl border-slate-200">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b">
                <CardTitle className="flex items-center gap-3">
                  <Building className="w-5 h-5 text-green-600" />
                  {editing ? 'Editar Centro de Custo' : 'Novo Centro de Custo'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Nome *</Label>
                      <Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} required className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo *</Label>
                      <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Setor">Setor</SelectItem>
                          <SelectItem value="Departamento">Departamento</SelectItem>
                          <SelectItem value="Filial">Filial</SelectItem>
                          <SelectItem value="Projeto">Projeto</SelectItem>
                          <SelectItem value="Outro">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Código</Label>
                      <Input value={formData.codigo} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} placeholder="CÓDIGO" className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-2">
                      <Label>Responsável</Label>
                      <Input value={formData.responsavel} onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })} placeholder="NOME DO RESPONSÁVEL" className="uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Textarea value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} className="uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>

                  <div className="flex items-center gap-3">
                    <Switch checked={formData.ativo} onCheckedChange={(v) => setFormData({ ...formData, ativo: v })} />
                    <Label>Centro de Custo Ativo</Label>
                  </div>

                  <div className="flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); resetForm(); }}>
                      <X className="w-4 h-4 mr-2" />
                      Cancelar
                    </Button>
                    <Button type="submit" className="bg-green-600">
                      <Save className="w-4 h-4 mr-2" />
                      {editing ? 'Atualizar' : 'Salvar'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="shadow-xl border-slate-200">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b">
          <CardTitle className="flex items-center gap-3">
            <Building className="w-5 h-5 text-slate-700" />
            Centros de Custo
            <Badge variant="secondary" className="bg-green-100 text-green-700">{centros.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>Nº</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {centros.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <Building className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                    <p className="text-slate-500">Nenhum centro de custo cadastrado</p>
                  </TableCell>
                </TableRow>
              ) : (
                centros.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-bold">{c.numero_centro}</TableCell>
                    <TableCell className="font-mono">{c.codigo || '-'}</TableCell>
                    <TableCell className="font-semibold">{c.nome}</TableCell>
                    <TableCell>{c.tipo}</TableCell>
                    <TableCell>{c.responsavel || '-'}</TableCell>
                    <TableCell>
                      <Badge className={c.ativo !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                        {c.ativo !== false ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(c)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
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
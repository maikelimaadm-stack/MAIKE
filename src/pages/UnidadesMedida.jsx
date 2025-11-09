
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Ruler, Trash2, Edit } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";
import CartoesResumo from "../components/shared/CartoesResumo";

// Função para obter próximo número de unidade
const getNextUnidadeNumber = async () => {
  try {
    const all = await base44.entities.UnidadeMedida.list();
    const numeros = all.map(u => parseInt(u.numero_unidade) || 0).filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch {
    return 1;
  }
};

export default function UnidadesMedida() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({ sigla: "", descricao: "" });

  const queryClient = useQueryClient();

  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ['unidades_medida'],
    queryFn: async () => {
      const data = await base44.entities.UnidadeMedida.list();
      return data.sort((a, b) => a.sigla.localeCompare(b.sigla));
    },
    initialData: [],
  });

  useEffect(() => {
    const numerarUnidadesExistentes = async () => {
      // Filter units that do not have a numero_unidade defined or it's an empty string
      const semNumero = unidades.filter(u => !u.numero_unidade || u.numero_unidade === "");

      if (semNumero.length > 0) {
        for (const unidade of semNumero) {
          try {
            const num = await getNextUnidadeNumber();
            await base44.entities.UnidadeMedida.update(unidade.id, { numero_unidade: String(num) });
          } catch (error) {
            console.error(`Erro ao numerar unidade ${unidade.id}:`, error);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      }
    };

    // Only run this effect if units have been loaded and there are units to process
    if (!isLoading && unidades.length > 0) {
      numerarUnidadesExistentes();
    }
  }, [unidades, isLoading, queryClient]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const num = await getNextUnidadeNumber();
      return base44.entities.UnidadeMedida.create({ ...data, numero_unidade: String(num) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      setShowForm(false);
      resetForm();
      toast.success('Unidade cadastrada!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.UnidadeMedida.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      setShowForm(false);
      setEditing(null);
      resetForm();
      toast.success('Unidade atualizada!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const produtos = await base44.entities.Produto.list();
      const temProdutos = produtos.some(p => p.unidade_medida === unidades.find(u => u.id === id)?.sigla);
      if (temProdutos) throw new Error('❌ Possui produtos vinculados!');
      return base44.entities.UnidadeMedida.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      toast.success('Unidade excluída!');
    },
    onError: (error) => {
      toast.error(error.message);
    }
  });

  const resetForm = () => {
    setFormData({ sigla: "", descricao: "" });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { sigla: formData.sigla?.toUpperCase(), descricao: formData.descricao?.toUpperCase() };

    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (unidade) => {
    setEditing(unidade);
    setFormData({ sigla: unidade.sigla || "", descricao: unidade.descricao || "" });
    setShowForm(true);
  };

  const cartoes = [
    { id: 'total', label: 'Unidades Cadastradas', valor: unidades.length, sublabel: 'Total', icon: Ruler, cor: 'blue', tipo: 'numero' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Unidades de Medida</h1>
              <p className="text-xs text-slate-600">Gerenciar unidades</p>
            </div>
          </div>

          <CartoesResumo cartoes={cartoes} />

          <div className="flex justify-end">
            <Button onClick={() => { setEditing(null); resetForm(); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5" />
              Nova Unidade
            </Button>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{editing ? 'Editar Unidade' : 'Nova Unidade'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Sigla *</Label>
                      <Input value={formData.sigla} onChange={(e) => setFormData({ ...formData, sigla: e.target.value })} placeholder="UN, KG, L" required className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Descrição *</Label>
                      <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} placeholder="UNIDADE, QUILOGRAMA" required className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); resetForm(); }} size="sm" className="h-8 text-xs">
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                      {editing ? 'Atualizar' : 'Salvar'}
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
            <CardTitle className="flex items-center gap-2 text-sm">
              <Ruler className="w-4 h-4" />
              Unidades ({unidades.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Nº</TableHead>
                    <TableHead>Sigla</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center">Carregando...</TableCell>
                    </TableRow>
                  ) : unidades.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-slate-400">
                        Nenhuma unidade cadastrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    unidades.map((unidade) => (
                      <TableRow key={unidade.id} className="text-xs">
                        <TableCell className="font-bold">{unidade.numero_unidade || 'N/A'}</TableCell>
                        <TableCell className="font-mono font-semibold">{unidade.sigla}</TableCell>
                        <TableCell>{unidade.descricao}</TableCell>
                        <TableCell>
                          <div className="flex justify-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(unidade)} className="h-7 w-7">
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => { if (window.confirm('⚠️ Excluir unidade?')) deleteMutation.mutate(unidade.id); }} className="h-7 w-7 text-red-600 hover:bg-red-50">
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
      )}
    </div>
  );
}

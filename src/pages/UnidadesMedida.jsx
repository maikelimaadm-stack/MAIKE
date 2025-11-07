
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Ruler, Trash2, Edit, X, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";

// Função para obter próximo número de unidade
const getNextUnidadeNumber = async () => {
  try {
    const unidades = await base44.entities.UnidadeMedida.list();
    const numeros = unidades
      .map(u => parseInt(u.numero_unidade) || 0) // Convert to int, default to 0 if not a number or null/undefined
      .filter(n => n > 0); // Filter out 0 and negative numbers

    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    console.error('Erro ao obter próximo número:', error);
    // As per instruction, fallback to Date.now() on error.
    // This might generate non-sequential numbers but ensures a unique fallback in case of API issues.
    return Date.now();
  }
};

export default function UnidadesMedida() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({ sigla: "", descricao: "" });

  const queryClient = useQueryClient();

  const { data: unidades, isLoading } = useQuery({
    queryKey: ['unidades_medida'],
    queryFn: async () => {
      const data = await base44.entities.UnidadeMedida.list();
      return data.sort((a, b) => a.sigla.localeCompare(b.sigla));
    },
    initialData: [],
  });

  // Numerar unidades existentes automaticamente
  React.useEffect(() => {
    const numerarUnidadesExistentes = async () => {
      if (!unidades || unidades.length === 0) return;
      
      // Filter units that do not have a numero_unidade defined or it's an empty string
      const unidadesSemNumero = unidades.filter(u => !u.numero_unidade || u.numero_unidade === "");
      
      if (unidadesSemNumero.length > 0) {
        console.log(`Numerando ${unidadesSemNumero.length} unidades sem número...`);
        
        // Use a Set to keep track of used numbers to avoid immediate conflicts
        // when assigning numbers in a quick succession if getNextUnidadeNumber is called rapidly.
        // However, getNextUnidadeNumber itself already queries all existing units,
        // so it should already return the next available global number.
        // The sequential assignment below will ensure each gets a unique incremented number.
        
        let shouldInvalidate = false;
        for (const unidade of unidadesSemNumero) {
          try {
            const proximoNumero = await getNextUnidadeNumber(); // Get the next global number
            await base44.entities.UnidadeMedida.update(unidade.id, {
              numero_unidade: String(proximoNumero)
            });
            shouldInvalidate = true; // Mark for invalidation if at least one update happened
          } catch (error) {
            console.error(`Erro ao numerar unidade ${unidade.id}:`, error);
            toast.error(`Erro ao numerar unidade ${unidade.sigla}.`);
          }
        }
        
        if (shouldInvalidate) {
          queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
          toast.success('Unidades existentes numeradas automaticamente!');
        }
      }
    };

    // Only run this effect if units have been loaded and there are units to process
    if (!isLoading && unidades.length > 0) {
      numerarUnidadesExistentes();
    }
  }, [unidades, isLoading, queryClient]); // Add isLoading to dependencies to ensure it runs after data is fetched

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const proximoNumero = await getNextUnidadeNumber();
      return base44.entities.UnidadeMedida.create({
        ...data,
        numero_unidade: String(proximoNumero)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      setShowForm(false);
      setFormData({ sigla: "", descricao: "" });
      toast.success('Unidade cadastrada com sucesso!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.UnidadeMedida.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      setShowForm(false);
      setEditingItem(null);
      setFormData({ sigla: "", descricao: "" });
      toast.success('Unidade atualizada com sucesso!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.UnidadeMedida.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unidades_medida'] });
      toast.success('Unidade excluída com sucesso!');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const dataToSend = {
      sigla: formData.sigla.toUpperCase(),
      descricao: formData.descricao.toUpperCase()
    };

    if (editingItem) {
      // When editing, we do not re-assign numero_unidade, as it's already set.
      // We only update sigla and descricao.
      updateMutation.mutate({ id: editingItem.id, data: dataToSend });
    } else {
      createMutation.mutate(dataToSend);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({ sigla: item.sigla, descricao: item.descricao });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ ATENÇÃO: Deseja realmente excluir esta unidade de medida? Esta ação não pode ser desfeita.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleNew = () => {
    setEditingItem(null);
    setFormData({ sigla: "", descricao: "" });
    setShowForm(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Unidades de Medida</h1>
        {!showForm && (
          <Button onClick={handleNew} className="bg-green-600 hover:bg-green-700 gap-2">
            <Plus className="w-4 h-4" />
            Nova Unidade
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Ruler className="w-5 h-5" />
                  {editingItem ? 'Editar Unidade' : 'Nova Unidade'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Sigla *</Label>
                      <Input
                        value={formData.sigla}
                        onChange={(e) => setFormData({ ...formData, sigla: e.target.value.toUpperCase() })}
                        placeholder="EX: UN, KG, LT"
                        required
                        maxLength={5}
                        className="uppercase"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Descrição *</Label>
                      <Input
                        value={formData.descricao}
                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })}
                        placeholder="UNIDADE, QUILOGRAMA, LITRO"
                        required
                        className="uppercase"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingItem(null); }}>
                      <X className="w-4 h-4 mr-2" />
                      Cancelar
                    </Button>
                    <Button type="submit" className="bg-green-600 hover:bg-green-700">
                      <Save className="w-4 h-4 mr-2" />
                      Salvar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead> {/* New column for numero_unidade */}
                <TableHead>Sigla</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center">Carregando...</TableCell> {/* Updated colSpan */}
                </TableRow>
              ) : unidades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-slate-400"> {/* Updated colSpan */}
                    Nenhuma unidade cadastrada
                  </TableCell>
                </TableRow>
              ) : (
                unidades.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.numero_unidade || 'N/A'}</TableCell> {/* Display numero_unidade */}
                    <TableCell className="font-bold">{item.sigla}</TableCell>
                    <TableCell>{item.descricao}</TableCell>
                    <TableCell>
                      <div className="flex justify-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="w-4 h-4 text-red-600" />
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

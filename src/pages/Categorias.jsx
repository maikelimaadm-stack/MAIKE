
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Edit, Trash2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import CartoesResumo from "../components/shared/CartoesResumo"; // Adjusted path as per common structure, assuming it's in a shared components folder.

// Função para obter próximo número de categoria
const getNextCategoryNumber = async () => {
  try {
    const all = await base44.entities.Categoria.list();
    const numeros = all
      .map(c => parseInt(c.numero_categoria) || 0)
      .filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch {
    // Return 1 on error to ensure a starting number is always available
    return 1;
  }
};

export default function Categorias() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // Renamed from editingItem to editing
  const [formData, setFormData] = useState({ nome: "", descricao: "" }); // Removed subcategoria

  const queryClient = useQueryClient();

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(), // Simplified queryFn
    initialData: [],
  });

  // Sorting logic moved outside the queryFn
  const categoriasSorted = [...categorias].sort((a, b) => {
    const numA = parseInt(a.numero_categoria) || 0;
    const numB = parseInt(b.numero_categoria) || 0;
    if (numA !== numB) {
      return numA - numB;
    }
    return (a.nome || '').localeCompare(b.nome || ''); // Handle potential null/undefined nome
  });

  // Numerar categorias existentes automaticamente
  useEffect(() => {
    const numerarCategoriasExistentes = async () => {
      // Only proceed if categories are loaded and there are some
      // and filter out categories that already have a number
      const semNumero = categorias.filter(c => !c.numero_categoria);

      if (semNumero.length > 0) {
        let updateCount = 0; // Track if any updates were made
        for (const categoria of semNumero) {
          try {
            // Get the next available number dynamically for each unnumbered category
            const proximoNumero = await getNextCategoryNumber();
            await base44.entities.Categoria.update(categoria.id, {
              numero_categoria: String(proximoNumero)
            });
            updateCount++;
          } catch (error) {
            console.error(`Erro ao numerar categoria ${categoria.id}:`, error);
            toast.error(`Erro ao numerar categoria ${categoria.nome}.`);
          }
        }
        // Invalidate queries only if updates were actually performed
        if (updateCount > 0) {
          queryClient.invalidateQueries({ queryKey: ['categorias'] });
          toast.success('Categorias sem número foram numeradas automaticamente.');
        }
      }
    };

    // Only run if categories data is available
    if (categorias.length > 0) {
      numerarCategoriasExistentes();
    }
  }, [categorias, queryClient]); // Removed isLoading from dependencies as per outline

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const num = await getNextCategoryNumber();
      return base44.entities.Categoria.create({
        ...data,
        numero_categoria: String(num)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setShowForm(false);
      resetForm(); // Use resetForm function
      toast.success('Categoria cadastrada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao cadastrar categoria.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Categoria.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setShowForm(false);
      setEditing(null); // Renamed from setEditingItem
      resetForm(); // Use resetForm function
      toast.success('Categoria atualizada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar categoria.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      // Verificar se existem produtos vinculados
      const todosProdutos = await base44.entities.Produto.list();
      const categoriaToDelete = categorias.find(c => c.id === id); // Find the category being deleted

      // Check if any product's category name matches the category being deleted
      const temProdutos = todosProdutos.some(p => p.categoria === categoriaToDelete?.nome);
      
      if (temProdutos) {
        throw new Error('❌ Possui produtos vinculados! Não é possível excluir.');
      }
      
      return base44.entities.Categoria.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      toast.success('Categoria excluída!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao excluir categoria.');
    }
  });

  // New reset form function
  const resetForm = () => {
    setFormData({ nome: "", descricao: "" });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { 
      nome: formData.nome?.toUpperCase(), // Ensure uppercase and handle potential null
      descricao: formData.descricao?.toUpperCase() || undefined // Ensure uppercase, or undefined if empty
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (categoria) => { // Renamed item to categoria
    setEditing(categoria); // Renamed from setEditingItem
    setFormData({ 
      nome: categoria.nome || "", 
      descricao: categoria.descricao || "" 
    }); // Removed subcategoria
    setShowForm(true);
  };

  // Card summary data
  const cartoes = [
    { id: 'total', label: 'Categorias Cadastradas', valor: categorias.length, sublabel: 'Total', icon: FolderOpen, cor: 'blue', tipo: 'numero' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Categorias</h1>
              <p className="text-xs text-slate-600">Gerenciar categorias</p>
            </div>
          </div>

          <CartoesResumo cartoes={cartoes} />

          <div className="flex justify-end">
            <Button onClick={() => { setEditing(null); resetForm(); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5" />
              Nova Categoria
            </Button>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{editing ? 'Editar Categoria' : 'Nova Categoria'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nome *</Label>
                      <Input
                        value={formData.nome}
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                        placeholder="NOME"
                        required
                        className="h-8 text-xs uppercase"
                        style={{ textTransform: 'uppercase' }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Descrição</Label>
                      <Input // Changed from Textarea to Input
                        value={formData.descricao}
                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                        placeholder="DESCRIÇÃO"
                        className="h-8 text-xs uppercase"
                        style={{ textTransform: 'uppercase' }}
                      />
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
              <FolderOpen className="w-4 h-4" />
              Categorias ({categorias.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Nº</TableHead> {/* Updated column name */}
                    <TableHead>Nome</TableHead>
                    <TableHead>Descrição</TableHead> {/* Subcategoria column removed */}
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-4">Carregando...</TableCell> {/* Updated colspan */}
                    </TableRow>
                  ) : categoriasSorted.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-slate-400"> {/* Updated colspan */}
                        Nenhuma categoria cadastrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    categoriasSorted.map((categoria) => (
                      <TableRow key={categoria.id} className="text-xs">
                        <TableCell className="font-bold">{categoria.numero_categoria || '-'}</TableCell> {/* Display numero_categoria */}
                        <TableCell className="font-semibold">{categoria.nome}</TableCell>
                        <TableCell>{categoria.descricao || '-'}</TableCell> {/* Changed from subcategoria to descricao */}
                        <TableCell>
                          <div className="flex justify-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(categoria)} className="h-7 w-7">
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { if (window.confirm('⚠️ Excluir categoria? Esta ação não pode ser desfeita.')) deleteMutation.mutate(categoria.id); }}
                              className="h-7 w-7 text-red-600 hover:bg-red-50"
                            >
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


import React, { useState, useEffect } from "react"; // Added useEffect
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Tag, Trash2, Edit, X, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";

// Função para obter próximo número de categoria
const getNextCategoriaNumber = async () => {
  try {
    const categorias = await base44.entities.Categoria.list();
    const numeros = categorias
      .map(c => parseInt(c.numero_categoria) || 0)
      .filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    console.error('Erro ao obter próximo número:', error);
    // As per outline, return Date.now() on error, although returning 1 might be more logical for sequencing.
    // For now, adhering strictly to the provided outline.
    return Date.now(); 
  }
};

export default function Categorias() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({ nome: "", subcategoria: "", descricao: "" });

  const queryClient = useQueryClient();

  const { data: categorias, isLoading } = useQuery({
    queryKey: ['categorias'],
    queryFn: async () => {
      const data = await base44.entities.Categoria.list();
      // Ensure sorting takes numero_categoria into account first, then nome
      return data.sort((a, b) => {
        const numA = parseInt(a.numero_categoria) || 0;
        const numB = parseInt(b.numero_categoria) || 0;
        if (numA !== numB) {
          return numA - numB;
        }
        return a.nome.localeCompare(b.nome);
      });
    },
    initialData: [],
  });

  // Numerar categorias existentes automaticamente
  useEffect(() => {
    const numerarCategoriasExistentes = async () => {
      // Only proceed if categories are loaded and there are some
      if (!categorias || categorias.length === 0 || isLoading) return;
      
      const categoriasSemNumero = categorias.filter(c => !c.numero_categoria);
      
      if (categoriasSemNumero.length > 0) {
        console.log(`Numerando ${categoriasSemNumero.length} categorias sem número...`);
        
        // Using a sequential counter for assigning numbers to unnumbered categories
        // based on the max existing number to avoid conflicts and ensure sequence.
        let currentMaxNumber = Math.max(...categorias.map(c => parseInt(c.numero_categoria) || 0)) || 0;

        for (const categoria of categoriasSemNumero) {
          try {
            currentMaxNumber++; // Increment for each unnumbered category
            await base44.entities.Categoria.update(categoria.id, {
              ...categoria, // Spread existing properties to ensure other fields are preserved
              numero_categoria: String(currentMaxNumber)
            });
            console.log(`Categoria ${categoria.nome} (#${categoria.id}) numerada com sucesso como ${currentMaxNumber}`);
          } catch (error) {
            console.error(`Erro ao numerar categoria ${categoria.id}:`, error);
          }
        }
        
        queryClient.invalidateQueries({ queryKey: ['categorias'] });
        toast.success('Categorias sem número foram numeradas automaticamente.');
      }
    };

    numerarCategoriasExistentes();
  }, [categorias, isLoading, queryClient]); // Add isLoading to dependencies to ensure it runs after data is loaded

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const proximoNumero = await getNextCategoriaNumber();
      return base44.entities.Categoria.create({
        ...data,
        numero_categoria: String(proximoNumero)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setShowForm(false);
      setFormData({ nome: "", subcategoria: "", descricao: "" });
      toast.success('Categoria cadastrada com sucesso!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Categoria.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setShowForm(false);
      setEditingItem(null);
      setFormData({ nome: "", subcategoria: "", descricao: "" });
      toast.success('Categoria atualizada com sucesso!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Categoria.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      toast.success('Categoria excluída com sucesso!');
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const dataToSend = {
      nome: formData.nome.toUpperCase(),
      subcategoria: formData.subcategoria?.toUpperCase() || undefined,
      descricao: formData.descricao?.toUpperCase() || undefined
    };

    if (editingItem) {
      // When editing, numero_categoria is not part of the form, it's auto-managed
      // Only send the fields that are actually being edited.
      updateMutation.mutate({ id: editingItem.id, data: dataToSend });
    } else {
      createMutation.mutate(dataToSend);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({ 
      nome: item.nome, 
      subcategoria: item.subcategoria || "", 
      descricao: item.descricao || "" 
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ ATENÇÃO: Deseja realmente excluir esta categoria? Esta ação não pode ser desfeita.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleNew = () => {
    setEditingItem(null);
    setFormData({ nome: "", subcategoria: "", descricao: "" });
    setShowForm(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Categorias de Produtos</h1>
        {!showForm && (
          <Button onClick={handleNew} className="bg-green-600 hover:bg-green-700 gap-2">
            <Plus className="w-4 h-4" />
            Nova Categoria
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="w-5 h-5" />
                  {editingItem ? 'Editar Categoria' : 'Nova Categoria'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Nome da Categoria *</Label>
                      <Input
                        value={formData.nome}
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value.toUpperCase() })}
                        placeholder="INSUMOS, FERRAMENTAS, ETC"
                        required
                        className="uppercase"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Subcategoria</Label>
                      <Input
                        value={formData.subcategoria}
                        onChange={(e) => setFormData({ ...formData, subcategoria: e.target.value.toUpperCase() })}
                        placeholder="SUBCATEGORIA (OPCIONAL)"
                        className="uppercase"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Descrição</Label>
                    <Textarea
                      value={formData.descricao}
                      onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })}
                      placeholder="DESCRIÇÃO DA CATEGORIA (OPCIONAL)"
                      className="uppercase"
                    />
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
                <TableHead className="w-[100px]">Número</TableHead> {/* Added column for numero_categoria */}
                <TableHead>Categoria</TableHead>
                <TableHead>Subcategoria</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">Carregando...</TableCell> {/* Updated colspan */}
                </TableRow>
              ) : categorias.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-400"> {/* Updated colspan */}
                    Nenhuma categoria cadastrada
                  </TableCell>
                </TableRow>
              ) : (
                categorias.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-center">{item.numero_categoria || '-'}</TableCell> {/* Display numero_categoria */}
                    <TableCell className="font-bold">{item.nome}</TableCell>
                    <TableCell>{item.subcategoria || '-'}</TableCell>
                    <TableCell>{item.descricao || '-'}</TableCell>
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

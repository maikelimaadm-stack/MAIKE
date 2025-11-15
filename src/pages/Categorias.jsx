
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, FolderOpen, Settings, Search } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const getNextCategoryNumber = async () => {
  try {
    const all = await base44.entities.Categoria.list();
    const numeros = all
      .map(c => parseInt(c.numero_categoria) || 0)
      .filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch {
    return 1;
  }
};

export default function Categorias() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({ nome: "", descricao: "" });
  const [searchTerm, setSearchTerm] = useState("");

  const queryClient = useQueryClient();

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  const categoriasSorted = [...categorias].sort((a, b) => {
    const numA = parseInt(a.numero_categoria) || 0;
    const numB = parseInt(b.numero_categoria) || 0;
    if (numA !== numB) {
      return numA - numB;
    }
    return (a.nome || '').localeCompare(b.nome || '');
  });

  useEffect(() => {
    const numerarCategoriasExistentes = async () => {
      const semNumero = categorias.filter(c => !c.numero_categoria);

      if (semNumero.length > 0) {
        let updateCount = 0;
        for (const categoria of semNumero) {
          try {
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
        if (updateCount > 0) {
          queryClient.invalidateQueries({ queryKey: ['categorias'] });
          toast.success('Categorias sem número foram numeradas automaticamente.');
        }
      }
    };

    if (categorias.length > 0) {
      numerarCategoriasExistentes();
    }
  }, [categorias, queryClient]);

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
      resetForm();
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
      setEditing(null);
      resetForm();
      toast.success('Categoria atualizada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar categoria.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const todosProdutos = await base44.entities.Produto.list();
      const categoriaToDelete = categorias.find(c => c.id === id);
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

  const resetForm = () => {
    setFormData({ nome: "", descricao: "" });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { 
      nome: formData.nome?.toUpperCase(),
      descricao: formData.descricao?.toUpperCase() || undefined
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (categoria) => {
    setEditing(categoria);
    setFormData({ 
      nome: categoria.nome || "", 
      descricao: categoria.descricao || "" 
    });
    setShowForm(true);
  };

  const filteredCategorias = categoriasSorted.filter(c => {
    const searchLower = searchTerm.toLowerCase();
    return (
      c.nome?.toLowerCase().includes(searchLower) ||
      c.descricao?.toLowerCase().includes(searchLower) ||
      c.numero_categoria?.includes(searchLower)
    );
  });

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

          <div className="flex justify-between gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-8 text-xs border-slate-300"
              />
            </div>
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
                      <Input
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
              Categorias ({filteredCategorias.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50 text-xs">
                    <TableHead className="font-semibold text-slate-700">Nº</TableHead>
                    <TableHead className="font-semibold text-slate-700">Nome</TableHead>
                    <TableHead className="font-semibold text-slate-700">Descrição</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-4">Carregando...</TableCell>
                    </TableRow>
                  ) : filteredCategorias.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-slate-400">
                        {searchTerm ? 'Nenhuma categoria encontrada' : 'Nenhuma categoria cadastrada'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCategorias.map((categoria) => (
                      <ContextMenu key={categoria.id}>
                        <ContextMenuTrigger asChild>
                          <motion.tr
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer text-xs"
                          >
                            <TableCell className="font-bold">{categoria.numero_categoria || '-'}</TableCell>
                            <TableCell className="font-semibold">{categoria.nome}</TableCell>
                            <TableCell>{categoria.descricao || '-'}</TableCell>
                          </motion.tr>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => handleEdit(categoria)}>
                            <Edit className="w-4 h-4 mr-2 text-blue-600" />
                            Editar
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => { if (window.confirm('⚠️ Excluir categoria? Esta ação não pode ser desfeita.')) deleteMutation.mutate(categoria.id); }}>
                            <Trash2 className="w-4 h-4 mr-2 text-red-600" />
                            Excluir
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
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

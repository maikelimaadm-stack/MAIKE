
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Warehouse, Trash2, Edit, X, Save } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";

// Função para obter próximo número de local
const getNextLocalNumber = async () => {
  try {
    const locais = await base44.entities.LocalEstoque.list();
    const numeros = locais
      .map(l => parseInt(l.numero_local) || 0)
      .filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    console.error('Erro ao obter próximo número:', error);
    return Date.now(); // Fallback to a unique timestamp on error
  }
};

export default function LocaisEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState({ nome: "", descricao: "", capacidade: "" });

  const queryClient = useQueryClient();

  const { data: locais, isLoading } = useQuery({
    queryKey: ['locais_estoque'],
    queryFn: async () => {
      const data = await base44.entities.LocalEstoque.list();
      return data.sort((a, b) => a.nome.localeCompare(b.nome));
    },
    initialData: [],
  });

  // Numerar locais existentes automaticamente
  React.useEffect(() => {
    const numerarLocaisExistentes = async () => {
      // Only proceed if not loading and locales data is available
      if (isLoading || !locais || locais.length === 0) {
        return;
      }

      const locaisSemNumero = locais.filter(l => !l.numero_local);

      if (locaisSemNumero.length > 0) {
        console.log(`Numerando ${locaisSemNumero.length} locais sem número...`);

        for (const local of locaisSemNumero) {
          try {
            const proximoNumero = await getNextLocalNumber();
            await base44.entities.LocalEstoque.update(local.id, {
              ...local, // Preserve other properties
              numero_local: String(proximoNumero)
            });
            console.log(`Local ${local.nome} (${local.id}) atualizado com numero_local: ${proximoNumero}`);
          } catch (error) {
            console.error(`Erro ao numerar local ${local.id}:`, error);
            toast.error(`Falha ao numerar local ${local.nome}. Por favor, tente novamente ou verifique o console.`);
          }
        }

        queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
        toast.success('Locais numerados automaticamente.');
      }
    };

    // Run when 'locais' data changes or loading state changes
    numerarLocaisExistentes();
  }, [locais, queryClient, isLoading]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const proximoNumero = await getNextLocalNumber();
      return base44.entities.LocalEstoque.create({
        ...data,
        numero_local: String(proximoNumero)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      setShowForm(false);
      setFormData({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local cadastrado com sucesso!');
    },
    onError: (error) => {
      console.error('Erro ao cadastrar local:', error);
      toast.error('Erro ao cadastrar local. Por favor, tente novamente.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.LocalEstoque.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      setShowForm(false);
      setEditingItem(null);
      setFormData({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local atualizado com sucesso!');
    },
    onError: (error) => {
      console.error('Erro ao atualizar local:', error);
      toast.error('Erro ao atualizar local. Por favor, tente novamente.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      // Verificar se existem produtos vinculados
      const todosProdutos = await base44.entities.Produto.list();
      const local = locais.find(l => l.id === id);
      const produtosVinculados = todosProdutos.filter(p => p.local_estoque === local?.nome);
      
      if (produtosVinculados.length > 0) {
        throw new Error(`❌ EXCLUSÃO BLOQUEADA! Este local possui ${produtosVinculados.length} produto(s) vinculado(s). Não é possível excluir.`);
      }

      // Verificar se existem movimentações vinculadas
      const todasMovimentacoes = await base44.entities.MovimentacaoEstoque.list();
      const movimentacoesVinculadas = todasMovimentacoes.filter(m => 
        m.local_estoque_origem === local?.nome || 
        m.local_estoque_destino === local?.nome
      );
      
      if (movimentacoesVinculadas.length > 0) {
        throw new Error(`❌ EXCLUSÃO BLOQUEADA! Este local possui ${movimentacoesVinculadas.length} movimentação(ões) de estoque vinculada(s). Não é possível excluir.`);
      }
      
      return base44.entities.LocalEstoque.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      toast.success('Local excluído com sucesso!');
    },
    onError: (error) => {
      console.error('Erro ao excluir local:', error);
      toast.error(error.message || 'Erro ao excluir local. Por favor, tente novamente.');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const dataToSend = {
      nome: formData.nome.toUpperCase(),
      descricao: formData.descricao?.toUpperCase() || undefined,
      capacidade: formData.capacidade?.toUpperCase() || undefined
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: dataToSend });
    } else {
      createMutation.mutate(dataToSend);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({
      nome: item.nome,
      descricao: item.descricao || "",
      capacidade: item.capacidade || ""
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (window.confirm('⚠️ ATENÇÃO: Deseja realmente excluir este local de estoque? Esta ação não pode ser desfeita.')) {
      deleteMutation.mutate(id);
    }
  };

  const handleNew = () => {
    setEditingItem(null);
    setFormData({ nome: "", descricao: "", capacidade: "" });
    setShowForm(true);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-slate-900">Locais de Estoque</h1>
        {!showForm && (
          <Button onClick={handleNew} className="bg-green-600 hover:bg-green-700 gap-2">
            <Plus className="w-4 h-4" />
            Novo Local
          </Button>
        )}
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Warehouse className="w-5 h-5" />
                  {editingItem ? 'Editar Local' : 'Novo Local'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="nome">Nome do Local *</Label>
                    <Input
                      id="nome"
                      value={formData.nome}
                      onChange={(e) => setFormData({ ...formData, nome: e.target.value.toUpperCase() })}
                      placeholder="GALPÃO 1, DEPÓSITO A, ETC"
                      required
                      className="uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="capacidade">Capacidade</Label>
                    <Input
                      id="capacidade"
                      value={formData.capacidade}
                      onChange={(e) => setFormData({ ...formData, capacidade: e.target.value.toUpperCase() })}
                      placeholder="EX: 500 SACAS, 10 TONELADAS"
                      className="uppercase"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="descricao">Descrição</Label>
                    <Textarea
                      id="descricao"
                      value={formData.descricao}
                      onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })}
                      placeholder="DESCRIÇÃO DO LOCAL (OPCIONAL)"
                      className="uppercase"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingItem(null); }}>
                      <X className="w-4 h-4 mr-2" />
                      Cancelar
                    </Button>
                    <Button type="submit" className="bg-green-600 hover:bg-green-700"
                      disabled={createMutation.isPending || updateMutation.isPending}>
                      <Save className="w-4 h-4 mr-2" />
                      {createMutation.isPending || updateMutation.isPending ? 'Salvando...' : 'Salvar'}
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
                <TableHead>Nome</TableHead>
                <TableHead>Número</TableHead> {/* Added Number column */}
                <TableHead>Capacidade</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">Carregando...</TableCell>
                </TableRow>
              ) : locais.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-slate-400">
                    Nenhum local cadastrado
                  </TableCell>
                </TableRow>
              ) : (
                locais.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-bold">{item.nome}</TableCell>
                    <TableCell>{item.numero_local || '-'}</TableCell> {/* Display numero_local */}
                    <TableCell>{item.capacidade || '-'}</TableCell>
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

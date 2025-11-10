import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tantml:react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Warehouse, Trash2, Edit, X, Save, Search } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";
import CartoesResumo from "../components/shared/CartoesResumo";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const getNextLocalNumber = async () => {
  try {
    const locais = await base44.entities.LocalEstoque.list();
    const numeros = locais.map(l => parseInt(l.numero_local) || 0).filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    console.error('Erro:', error);
    return 1;
  }
};

export default function LocaisEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
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

  useEffect(() => {
    const numerarLocaisExistentes = async () => {
      if (isLoading || !locais || locais.length === 0) return;
      const locaisSemNumero = locais.filter(l => !l.numero_local);
      if (locaisSemNumero.length > 0) {
        for (const local of locaisSemNumero) {
          try {
            const proximoNumero = await getNextLocalNumber();
            await base44.entities.LocalEstoque.update(local.id, { ...local, numero_local: String(proximoNumero) });
          } catch (error) {
            console.error(`Erro:`, error);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      }
    };
    numerarLocaisExistentes();
  }, [locais, queryClient, isLoading]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const proximoNumero = await getNextLocalNumber();
      return base44.entities.LocalEstoque.create({ ...data, numero_local: String(proximoNumero) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      setShowForm(false);
      setFormData({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.LocalEstoque.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      setShowForm(false);
      setEditingItem(null);
      setFormData({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const todosProdutos = await base44.entities.Produto.list();
      const local = locais.find(l => l.id === id);
      const produtosVinculados = todosProdutos.filter(p => p.local_estoque === local?.nome);
      if (produtosVinculados.length > 0) {
        throw new Error(`❌ Possui ${produtosVinculados.length} produto(s). Não é possível excluir.`);
      }
      const todasMovimentacoes = await base44.entities.MovimentacaoEstoque.list();
      const movimentacoesVinculadas = todasMovimentacoes.filter(m => 
        m.local_estoque_origem === local?.nome || m.local_estoque_destino === local?.nome
      );
      if (movimentacoesVinculadas.length > 0) {
        throw new Error(`❌ Possui ${movimentacoesVinculadas.length} movimentação(ões). Não é possível excluir.`);
      }
      return base44.entities.LocalEstoque.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      toast.success('Local excluído!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro.');
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
    setFormData({ nome: item.nome, descricao: item.descricao || "", capacidade: item.capacidade || "" });
    setShowForm(true);
  };

  const filteredLocais = locais.filter(l => {
    const searchLower = searchTerm.toLowerCase();
    return (
      l.nome?.toLowerCase().includes(searchLower) ||
      l.descricao?.toLowerCase().includes(searchLower) ||
      l.numero_local?.includes(searchLower)
    );
  });

  const cartoes = [
    { id: 'total', label: 'Total de Locais', valor: locais.length, sublabel: 'Cadastrados', icon: Warehouse, cor: 'blue', tipo: 'numero' },
  ];

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Locais de Estoque</h1>
              <p className="text-xs text-slate-600">Gerenciar locais</p>
            </div>
          </div>

          <CartoesResumo cartoes={cartoes} />

          <div className="flex justify-between gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar por nº, nome, descrição..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-8 text-xs border-slate-300"
              />
            </div>
            <Button onClick={() => { setEditingItem(null); setFormData({ nome: "", descricao: "", capacidade: "" }); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5" />
              Novo Local
            </Button>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{editingItem ? 'Editar Local' : 'Novo Local'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Nome *</Label>
                    <Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value.toUpperCase() })} placeholder="GALPÃO 1" required className="h-8 text-xs uppercase" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Capacidade</Label>
                    <Input value={formData.capacidade} onChange={(e) => setFormData({ ...formData, capacidade: e.target.value.toUpperCase() })} placeholder="500 SACAS" className="h-8 text-xs uppercase" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Descrição</Label>
                    <Textarea value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })} placeholder="DESCRIÇÃO" className="text-xs uppercase" rows={2} />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingItem(null); }} size="sm" className="h-8 text-xs">
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                      {editingItem ? 'Atualizar' : 'Salvar'}
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
              <Warehouse className="w-4 h-4" />
              Locais ({filteredLocais.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50 text-xs">
                    <TableHead className="font-semibold text-slate-700">Nº</TableHead>
                    <TableHead className="font-semibold text-slate-700">Nome</TableHead>
                    <TableHead className="font-semibold text-slate-700">Capacidade</TableHead>
                    <TableHead className="font-semibold text-slate-700">Descrição</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {locais.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-slate-400 text-xs">
                        {searchTerm ? 'Nenhum local encontrado' : 'Nenhum local cadastrado'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredLocais.map((item) => (
                      <ContextMenu key={item.id}>
                        <ContextMenuTrigger asChild>
                          <motion.tr
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer text-xs"
                          >
                            <TableCell className="font-bold">{item.numero_local || '-'}</TableCell>
                            <TableCell className="font-semibold">{item.nome}</TableCell>
                            <TableCell>{item.capacidade || '-'}</TableCell>
                            <TableCell>{item.descricao || '-'}</TableCell>
                          </motion.tr>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => handleEdit(item)}>
                            <Edit className="w-4 h-4 mr-2 text-blue-600" />
                            Editar
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => { if (window.confirm('⚠️ Excluir local?')) deleteMutation.mutate(item.id); }}>
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
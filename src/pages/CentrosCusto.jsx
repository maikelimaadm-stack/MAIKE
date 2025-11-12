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
import { Plus, Edit, Trash2, Building, Save, X, Search, Settings } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { Switch } from "@/components/ui/switch";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

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
  const [searchTerm, setSearchTerm] = useState("");
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
      toast.success('Centro cadastrado!');
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
    mutationFn: async (id) => {
      const lancamentos = await base44.entities.LancamentoFinanceiro.list();
      const temLancamentos = lancamentos.some(l => l.centro_custo_id === id);
      if (temLancamentos) throw new Error('❌ Possui lançamentos vinculados!');
      const movimentacoes = await base44.entities.MovimentacaoEstoque.list();
      const temMovimentacoes = movimentacoes.some(m => m.centro_custo_id === id);
      if (temMovimentacoes) throw new Error('❌ Possui movimentações vinculadas!');
      const custos = await base44.entities.CustoSafra.list();
      const temCustos = custos.some(c => c.centro_custo_id === id);
      if (temCustos) throw new Error('❌ Possui custos de safra vinculados!');
      return base44.entities.CentroCusto.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['centros'] });
      toast.success('Centro excluído!');
    },
    onError: (error) => {
      toast.error(error.message);
    }
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

  const filteredCentros = centros.filter(c => {
    const searchLower = searchTerm.toLowerCase();
    return (
      c.nome?.toLowerCase().includes(searchLower) ||
      c.codigo?.toLowerCase().includes(searchLower) ||
      c.responsavel?.toLowerCase().includes(searchLower) ||
      c.numero_centro?.includes(searchLower)
    );
  });

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Centros de Custo</h1>
              <p className="text-xs text-slate-600">Gerenciar centros</p>
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar por nº, nome, código..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-8 text-xs border-slate-300"
              />
            </div>
            <Button onClick={() => { setEditing(null); resetForm(); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5" />
              Novo Centro
            </Button>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{editing ? 'Editar Centro' : 'Novo Centro'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Nome *</Label>
                      <Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value })} required className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tipo *</Label>
                      <Select value={formData.tipo} onValueChange={(v) => setFormData({ ...formData, tipo: v })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Setor" className="text-xs">Setor</SelectItem>
                          <SelectItem value="Departamento" className="text-xs">Departamento</SelectItem>
                          <SelectItem value="Filial" className="text-xs">Filial</SelectItem>
                          <SelectItem value="Projeto" className="text-xs">Projeto</SelectItem>
                          <SelectItem value="Outro" className="text-xs">Outro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Código</Label>
                      <Input value={formData.codigo} onChange={(e) => setFormData({ ...formData, codigo: e.target.value })} placeholder="CÓDIGO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Responsável</Label>
                      <Input value={formData.responsavel} onChange={(e) => setFormData({ ...formData, responsavel: e.target.value })} placeholder="NOME" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Descrição</Label>
                    <Textarea value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} className="text-xs uppercase" style={{ textTransform: 'uppercase' }} rows={2} />
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch checked={formData.ativo} onCheckedChange={(v) => setFormData({ ...formData, ativo: v })} />
                    <Label className="text-xs">Centro Ativo</Label>
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
              <Building className="w-4 h-4" />
              Centros ({filteredCentros.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50 text-xs">
                    <TableHead className="font-semibold text-slate-700">Nº</TableHead>
                    <TableHead className="font-semibold text-slate-700">Código</TableHead>
                    <TableHead className="font-semibold text-slate-700">Nome</TableHead>
                    <TableHead className="font-semibold text-slate-700">Tipo</TableHead>
                    <TableHead className="font-semibold text-slate-700">Responsável</TableHead>
                    <TableHead className="font-semibold text-slate-700">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCentros.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-slate-400 text-xs">
                        {searchTerm ? 'Nenhum centro encontrado' : 'Nenhum centro cadastrado'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredCentros.map(c => (
                      <ContextMenu key={c.id}>
                        <ContextMenuTrigger asChild>
                          <motion.tr
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer text-xs"
                          >
                            <TableCell className="font-bold">{c.numero_centro}</TableCell>
                            <TableCell className="font-mono">{c.codigo || '-'}</TableCell>
                            <TableCell className="font-semibold">{c.nome}</TableCell>
                            <TableCell>{c.tipo}</TableCell>
                            <TableCell>{c.responsavel || '-'}</TableCell>
                            <TableCell>
                              <Badge className={`text-xs py-0 ${c.ativo !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'}`}>
                                {c.ativo !== false ? 'Ativo' : 'Inativo'}
                              </Badge>
                            </TableCell>
                          </motion.tr>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => handleEdit(c)}>
                            <Edit className="w-4 h-4 mr-2 text-blue-600" />
                            Editar
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => { if (window.confirm('⚠️ Excluir centro?')) deleteMutation.mutate(c.id); }}>
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
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
import { Plus, Edit, Trash2, Layers, Save, X, Calendar, Search } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export default function GerenciarSafras() {
  const [showForm, setShowForm] = useState(false);
  const [editingSafra, setEditingSafra] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
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
    mutationFn: (data) => base44.entities.Safra.create({ ...data, empresa_id: empresaSelecionadaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      setShowForm(false);
      setEditingSafra(null);
      resetForm();
      toast.success('Safra cadastrada!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Safra.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      setShowForm(false);
      setEditingSafra(null);
      resetForm();
      toast.success('Safra atualizada!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const todosCustos = await base44.entities.CustoSafra.list();
      const custosVinculados = todosCustos.filter(c => c.safra_id === id);
      if (custosVinculados.length > 0) {
        throw new Error(`❌ Possui ${custosVinculados.length} custo(s). Não é possível excluir.`);
      }
      const lancamentos = await base44.entities.LancamentoFinanceiro.list();
      const lancamentosVinculados = lancamentos.filter(l => l.safra_id === id);
      if (lancamentosVinculados.length > 0) {
        throw new Error(`❌ Possui ${lancamentosVinculados.length} lançamento(s). Não é possível excluir.`);
      }
      return base44.entities.Safra.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safras'] });
      toast.success('Safra excluída!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro.');
    }
  });

  const resetForm = () => {
    setFormData({ ano_inicio: "", ano_fim: "", descricao: "", status: "Planejamento", observacoes: "" });
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

  const getStatusBadge = (status) => {
    const config = {
      'Planejamento': 'bg-yellow-100 text-yellow-800',
      'Em Andamento': 'bg-blue-100 text-blue-800',
      'Finalizada': 'bg-emerald-100 text-emerald-800',
    };
    return config[status] || config['Planejamento'];
  };

  const filteredSafras = safras.filter(s => {
    const searchLower = searchTerm.toLowerCase();
    return (
      `${s.ano_inicio}/${s.ano_fim}`.includes(searchLower) ||
      s.descricao?.toLowerCase().includes(searchLower) ||
      s.status?.toLowerCase().includes(searchLower)
    );
  });

  const filteredSafras = safras.filter(s => {
    const searchLower = searchTerm.toLowerCase();
    return (
      `${s.ano_inicio}/${s.ano_fim}`.includes(searchLower) ||
      s.descricao?.toLowerCase().includes(searchLower) ||
      s.status?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Safras</h1>
              <p className="text-xs text-slate-600">Gerenciar safras</p>
            </div>
          </div>

          <div className="flex justify-between gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar por período, descrição, status..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-8 text-xs border-slate-300"
              />
            </div>
            <Button onClick={() => { setEditingSafra(null); resetForm(); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5" />
              Nova Safra
            </Button>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{editingSafra ? 'Editar Safra' : 'Nova Safra'}</CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Ano Início *</Label>
                      <Input type="number" value={formData.ano_inicio} onChange={(e) => setFormData({ ...formData, ano_inicio: e.target.value })} placeholder="2024" required className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Ano Fim *</Label>
                      <Input type="number" value={formData.ano_fim} onChange={(e) => setFormData({ ...formData, ano_fim: e.target.value })} placeholder="2025" required className="h-8 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Status</Label>
                      <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Planejamento" className="text-xs">Planejamento</SelectItem>
                          <SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem>
                          <SelectItem value="Finalizada" className="text-xs">Finalizada</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Descrição</Label>
                    <Input value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value })} placeholder="DESCRIÇÃO" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Observações</Label>
                    <Textarea value={formData.observacoes} onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })} placeholder="OBSERVAÇÕES" className="text-xs uppercase" style={{ textTransform: 'uppercase' }} rows={2} />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingSafra(null); resetForm(); }} size="sm" className="h-8 text-xs">
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                      {editingSafra ? 'Atualizar' : 'Salvar'}
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
              <Layers className="w-4 h-4" />
              Safras ({filteredSafras.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50 text-xs">
                    <TableHead className="font-semibold text-slate-700">Período</TableHead>
                    <TableHead className="font-semibold text-slate-700">Descrição</TableHead>
                    <TableHead className="font-semibold text-slate-700">Status</TableHead>
                    <TableHead className="font-semibold text-slate-700">Observações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {safras.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-slate-400 text-xs">
                        {searchTerm ? 'Nenhuma safra encontrada' : 'Nenhuma safra cadastrada'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredSafras.map((safra) => (
                      <ContextMenu key={safra.id}>
                        <ContextMenuTrigger asChild>
                          <motion.tr
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer text-xs"
                          >
                            <TableCell className="font-bold">{safra.ano_inicio}/{safra.ano_fim}</TableCell>
                            <TableCell>{safra.descricao || '-'}</TableCell>
                            <TableCell>
                              <Badge className={`${getStatusBadge(safra.status)} text-xs py-0`}>
                                {safra.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-xs truncate">{safra.observacoes || '-'}</TableCell>
                          </motion.tr>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem onClick={() => handleEdit(safra)}>
                            <Edit className="w-4 h-4 mr-2 text-blue-600" />
                            Editar
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => { if (window.confirm('⚠️ Excluir safra?')) deleteMutation.mutate(safra.id); }}>
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
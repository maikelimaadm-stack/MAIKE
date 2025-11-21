import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowRightLeft, X, Edit2, Trash2, Search, Calendar,
  TrendingUp, FileText, Filter
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const tipoIcons = {
  'Transferência de Área': ArrowRightLeft,
  'Morte': X,
  'Nascimento': TrendingUp,
  'Abate': X,
  'Mudança de Categoria': ArrowRightLeft,
  'Pesagem': TrendingUp,
};

const tipoColors = {
  'Transferência de Área': 'bg-blue-100 text-blue-800',
  'Morte': 'bg-red-100 text-red-800',
  'Nascimento': 'bg-green-100 text-green-800',
  'Abate': 'bg-orange-100 text-orange-800',
  'Mudança de Categoria': 'bg-purple-100 text-purple-800',
  'Pesagem': 'bg-emerald-100 text-emerald-800',
};

export default function HistoricoMovimentacoesPecuaria() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const queryClient = useQueryClient();
  
  const [filtros, setFiltros] = useState({
    tipo: 'todos',
    lote: '',
    dataInicio: '',
    dataFim: ''
  });
  
  const [editando, setEditando] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deletarId, setDeletarId] = useState(null);

  const { data: movimentacoes = [], isLoading } = useQuery({
    queryKey: ['movimentacoes-pecuaria', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.MovimentacaoPecuaria.list('-created_date');
      return all.filter(m => m.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.MovimentacaoPecuaria.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      toast.success('Movimentação atualizada');
      setShowEdit(false);
      setEditando(null);
    },
    onError: () => {
      toast.error('Erro ao atualizar movimentação');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      return await base44.entities.MovimentacaoPecuaria.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      toast.success('Movimentação excluída');
      setShowDelete(false);
      setDeletarId(null);
    },
    onError: () => {
      toast.error('Erro ao excluir movimentação');
    }
  });

  const movimentacoesFiltradas = movimentacoes.filter(mov => {
    if (filtros.tipo !== 'todos' && mov.tipo !== filtros.tipo) return false;
    if (filtros.lote && !mov.lote?.toLowerCase().includes(filtros.lote.toLowerCase())) return false;
    if (filtros.dataInicio && new Date(mov.data_movimentacao) < new Date(filtros.dataInicio)) return false;
    if (filtros.dataFim && new Date(mov.data_movimentacao) > new Date(filtros.dataFim)) return false;
    return true;
  });

  const tiposDisponiveis = [...new Set(movimentacoes.map(m => m.tipo))].sort();

  const handleEdit = (mov) => {
    setEditando({ ...mov });
    setShowEdit(true);
  };

  const handleDelete = (id) => {
    setDeletarId(id);
    setShowDelete(true);
  };

  const handleSaveEdit = () => {
    if (!editando) return;
    updateMutation.mutate({
      id: editando.id,
      data: {
        data_movimentacao: editando.data_movimentacao,
        quantidade_animais: editando.quantidade_animais,
        peso_medio: editando.peso_medio,
        observacoes: editando.observacoes
      }
    });
  };

  const confirmDelete = () => {
    if (deletarId) {
      deleteMutation.mutate(deletarId);
    }
  };

  const limparFiltros = () => {
    setFiltros({ tipo: 'todos', lote: '', dataInicio: '', dataFim: '' });
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Histórico de Movimentações</h1>
        <p className="text-sm text-slate-600">Gerencie todo o histórico de movimentações pecuárias</p>
      </div>

      <Card>
        <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-50 border-b">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Filter className="w-5 h-5 text-emerald-600" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo de Movimentação</Label>
              <Select value={filtros.tipo} onValueChange={(v) => setFiltros({ ...filtros, tipo: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                  {tiposDisponiveis.map(tipo => (
                    <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Lote</Label>
              <Input
                value={filtros.lote}
                onChange={(e) => setFiltros({ ...filtros, lote: e.target.value })}
                placeholder="Buscar lote..."
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data Início</Label>
              <Input
                type="date"
                value={filtros.dataInicio}
                onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value })}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Data Fim</Label>
              <Input
                type="date"
                value={filtros.dataFim}
                onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value })}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end mt-3">
            <Button onClick={limparFiltros} variant="outline" size="sm" className="h-8 text-xs">
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-600" />
              Movimentações ({movimentacoesFiltradas.length})
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-3"></div>
              <p className="text-sm text-slate-600">Carregando movimentações...</p>
            </div>
          ) : movimentacoesFiltradas.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-600">Nenhuma movimentação encontrada</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left text-xs font-semibold text-slate-700 p-3">Data</th>
                    <th className="text-left text-xs font-semibold text-slate-700 p-3">Tipo</th>
                    <th className="text-left text-xs font-semibold text-slate-700 p-3">Lote</th>
                    <th className="text-left text-xs font-semibold text-slate-700 p-3">Quantidade</th>
                    <th className="text-left text-xs font-semibold text-slate-700 p-3">Detalhes</th>
                    <th className="text-left text-xs font-semibold text-slate-700 p-3">Observações</th>
                    <th className="text-right text-xs font-semibold text-slate-700 p-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentacoesFiltradas.map((mov, index) => {
                    const Icon = tipoIcons[mov.tipo] || FileText;
                    return (
                      <tr key={mov.id} className={`border-b hover:bg-slate-50 ${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                        <td className="text-xs text-slate-700 p-3">
                          {new Date(mov.data_movimentacao).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-3">
                          <Badge className={`text-xs ${tipoColors[mov.tipo] || 'bg-slate-100 text-slate-800'}`}>
                            <Icon className="w-3 h-3 mr-1" />
                            {mov.tipo}
                          </Badge>
                        </td>
                        <td className="text-xs font-medium text-slate-900 p-3">{mov.lote}</td>
                        <td className="text-xs text-slate-700 p-3">{mov.quantidade_animais} cabeças</td>
                        <td className="text-xs text-slate-600 p-3">
                          {mov.area_origem_nome && mov.area_destino_nome && (
                            <span>{mov.area_origem_nome} → {mov.area_destino_nome}</span>
                          )}
                          {mov.peso_medio && <span>Peso: {mov.peso_medio}kg</span>}
                        </td>
                        <td className="text-xs text-slate-600 p-3 max-w-xs truncate">
                          {mov.observacoes || '-'}
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(mov)}
                              className="h-7 w-7 p-0"
                            >
                              <Edit2 className="w-3 h-3 text-blue-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(mov.id)}
                              className="h-7 w-7 p-0"
                            >
                              <Trash2 className="w-3 h-3 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar Movimentação</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Data</Label>
                  <Input
                    type="date"
                    value={editando.data_movimentacao?.split('T')[0] || ''}
                    onChange={(e) => setEditando({ ...editando, data_movimentacao: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Quantidade de Animais</Label>
                  <Input
                    type="number"
                    value={editando.quantidade_animais || ''}
                    onChange={(e) => setEditando({ ...editando, quantidade_animais: parseInt(e.target.value) || 0 })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {editando.peso_medio !== undefined && (
                <div className="space-y-1">
                  <Label className="text-xs">Peso Médio (kg)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={editando.peso_medio || ''}
                    onChange={(e) => setEditando({ ...editando, peso_medio: parseFloat(e.target.value) || null })}
                    className="h-8 text-xs"
                  />
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Textarea
                  value={editando.observacoes || ''}
                  onChange={(e) => setEditando({ ...editando, observacoes: e.target.value })}
                  className="text-xs"
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button onClick={() => setShowEdit(false)} variant="outline" size="sm" className="h-8 text-xs">
                  Cancelar
                </Button>
                <Button onClick={handleSaveEdit} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  Salvar Alterações
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Tem certeza que deseja excluir esta movimentação? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowDelete(false)} variant="outline" size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={confirmDelete} size="sm" className="h-8 text-xs bg-red-600 hover:bg-red-700">
                Excluir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
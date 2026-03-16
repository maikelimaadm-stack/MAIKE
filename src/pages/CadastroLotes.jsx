import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Download } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import FormularioLote from "@/components/lotes/FormularioLote";
import TabelaLotes from "@/components/lotes/TabelaLotes";

export default function CadastroLotes() {
  const [showForm, setShowForm] = useState(false);
  const [editingLote, setEditingLote] = useState(null);
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: lotes = [], isLoading } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const createLoteMutation = useMutation({
    mutationFn: async (data) => {
      const allLotes = await base44.entities.Lote.list();
      const maxNum = allLotes.reduce((max, l) => Math.max(max, parseInt(l.numero_lote) || 0), 0);
      return base44.entities.Lote.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_lote: String(maxNum + 1),
        status: 'Ativo'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      setShowForm(false);
      setEditingLote(null);
      toast.success('✅ Lote cadastrado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao cadastrar lote');
      console.error(error);
    }
  });

  const updateLoteMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Lote.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      setShowForm(false);
      setEditingLote(null);
      toast.success('✅ Lote atualizado!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar lote');
      console.error(error);
    }
  });

  const deleteLoteMutation = useMutation({
    mutationFn: (id) => base44.entities.Lote.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      toast.success('✅ Lote excluído!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao excluir lote');
      console.error(error);
    }
  });

  const handleSubmit = (data) => {
    if (editingLote) {
      updateLoteMutation.mutate({ id: editingLote.id, data });
    } else {
      createLoteMutation.mutate(data);
    }
  };

  const handleEdit = (lote) => {
    setEditingLote(lote);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    // Verificar se o lote tem histórico de movimentações
    const todasMovimentacoes = await base44.entities.MovimentacaoMapa.list();
    const lote = lotes.find(l => l.id === id);
    const temHistorico = todasMovimentacoes.some(m => 
      m.empresa_id === empresaSelecionadaId && 
      (m.lote_id === id || (lote && m.lote?.toUpperCase().trim() === lote.nome?.toUpperCase().trim()))
    );

    if (temHistorico) {
      toast.error('Este lote possui histórico de movimentações. Exclua todas as movimentações do lote antes de excluí-lo no cadastro.');
      return;
    }

    if (window.confirm('⚠️ Deseja realmente excluir este lote?')) {
      deleteLoteMutation.mutate(id);
    }
  };

  const handleExport = () => {
    const csv = [
      ['Código', 'Nome', 'Quantidade', 'Categoria', 'Peso Médio', 'Área Atual', 'Status', 'Valor Total'].join(';'),
      ...lotes.map(l => [
        l.numero_lote,
        l.nome,
        l.quantidade_cabecas,
        l.categoria,
        l.peso_medio_kg || '',
        l.area_atual_nome || '',
        l.status,
        l.valor_total_compra || ''
      ].join(';'))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `lotes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success('✅ Exportado com sucesso!');
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cadastro de Lotes</h1>
          <p className="text-xs text-slate-600">Gerencie lotes de gado (não individual)</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExport} variant="outline" size="sm" className="h-8 text-xs">
            Exportar
          </Button>
          {!showForm && (
            <Button 
              onClick={() => { setShowForm(true); setEditingLote(null); }} 
              size="sm" 
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
            >
              Novo Lote
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioLote
            key="form"
            initialData={editingLote}
            onSubmit={handleSubmit}
            onCancel={() => { setShowForm(false); setEditingLote(null); }}
          />
        ) : (
          <TabelaLotes
            key="table"
            lotes={lotes}
            areas={areas}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
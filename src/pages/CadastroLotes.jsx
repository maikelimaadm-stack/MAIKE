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

  const ORIGENS_SISTEMA = ['MOVIMENTAÇÃO', 'REVERSÃO MOVIMENTAÇÃO', 'Nascimento', 'Mudança de Categoria', 'NASCIMENTO', 'MUDANÇA DE CATEGORIA'];

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-cadastro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => 
        l.empresa_id === empresaSelecionadaId && 
        !ORIGENS_SISTEMA.includes(l.origem)
      );
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

  // Busca movimentações de AMBAS as fontes para saber quais lotes têm registros filhos
  const { data: lotesComMovimentacoes = [] } = useQuery({
    queryKey: ['lotes-com-movimentacoes', empresaSelecionadaId],
    queryFn: async () => {
      const [movsPecuaria, movsMapa] = await Promise.all([
        base44.entities.MovimentacaoPecuaria.list(),
        base44.entities.MovimentacaoMapa.list()
      ]);
      const idsPecuaria = movsPecuaria.filter(m => m.empresa_id === empresaSelecionadaId && m.lote_id).map(m => m.lote_id);
      const idsMapa = movsMapa.filter(m => m.empresa_id === empresaSelecionadaId && m.lote_id).map(m => m.lote_id);
      return [...new Set([...idsPecuaria, ...idsMapa])];
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
      toast.success('Lote cadastrado!');
    },
  });

  const updateLoteMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Lote.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      setShowForm(false);
      setEditingLote(null);
      toast.success('Lote atualizado!');
    },
  });

  const deleteLoteMutation = useMutation({
    mutationFn: (id) => base44.entities.Lote.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      toast.success('Lote excluído!');
    },
  });

  const handleSubmit = (data) => {
    if (editingLote) {
      updateLoteMutation.mutate({ id: editingLote.id, data });
    } else {
      createLoteMutation.mutate(data);
    }
  };

  const handleEdit = (lote) => {
    if (lotesComMovimentacoes.includes(lote.id)) {
      toast.error('Este lote possui movimentações registradas e não pode ser editado.');
      return;
    }
    setEditingLote(lote);
    setShowForm(true);
  };

  const handleDelete = (id) => {
    if (lotesComMovimentacoes.includes(id)) {
      toast.error('Este lote possui movimentações registradas e não pode ser excluído.');
      return;
    }
    if (window.confirm('Deseja realmente excluir este lote?')) {
      deleteLoteMutation.mutate(id);
    }
  };

  const handleExport = () => {
    const csv = [
      ['Código', 'Nome', 'Qtd Entrada', 'Motivo', 'Categoria Entrada', 'Sexo', 'Raça', 'Peso Entrada', 'Área Entrada', 'Status', 'Valor Total'].join(';'),
      ...lotes.map(l => [
        l.numero_lote, l.nome, l.quantidade_entrada || l.quantidade_cabecas, l.motivo_entrada || l.origem || '',
        l.categoria_entrada || l.categoria, l.sexo || '', l.raca_predominante || '', l.peso_entrada_kg || l.peso_medio_kg || '', 
        l.area_entrada_nome || '', l.status, l.valor_total_compra || ''
      ].join(';'))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `lotes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cadastro de Lotes</h1>
          <p className="text-xs text-slate-600">Registro fixo de entrada de lotes — dados não são alterados por movimentações</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExport} variant="outline" size="sm" className="h-8 text-xs">
            <Download className="w-3.5 h-3.5 mr-1" /> Exportar
          </Button>
          {!showForm && (
            <Button onClick={() => { setShowForm(true); setEditingLote(null); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5 mr-1" /> Novo Lote
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showForm ? (
          <FormularioLote
            key="form"
            initialData={editingLote}
            isEditing={!!editingLote}
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
            lotesComMovimentacoes={lotesComMovimentacoes}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
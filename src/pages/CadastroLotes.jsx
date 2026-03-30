import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import FormularioLote from "@/components/lotes/FormularioLote";
import TabelaLotes from "@/components/lotes/TabelaLotes";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { ensureDeleteAllowed } from "@/lib/entityDeleteGuards";

export default function CadastroLotes() {
  const [showForm, setShowForm] = useState(false);
  const [editingLote, setEditingLote] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const ORIGENS_SISTEMA = ['MOVIMENTAÇÃO', 'REVERSÃO MOVIMENTAÇÃO', 'Nascimento', 'Mudança de Categoria', 'NASCIMENTO', 'MUDANÇA DE CATEGORIA'];

  const { data: lotes = [], refetch } = useQuery({
    queryKey: ['lotes-cadastro', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter((l) =>
      l.empresa_id === empresaSelecionadaId &&
      !ORIGENS_SISTEMA.includes(l.origem)
      );
    },
    enabled: !!empresaSelecionadaId,
    initialData: []
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    initialData: []
  });

  const { data: lotesComMovimentacoes = [] } = useQuery({
    queryKey: ['lotes-com-movimentacoes', empresaSelecionadaId],
    queryFn: async () => {
      const [movsPecuaria, movsMapa] = await Promise.all([
      base44.entities.MovimentacaoPecuaria.list(),
      base44.entities.MovimentacaoMapa.list()]
      );
      const idsPecuaria = movsPecuaria.filter((m) => m.empresa_id === empresaSelecionadaId && m.lote_id).map((m) => m.lote_id);
      const idsMapa = movsMapa.filter((m) => m.empresa_id === empresaSelecionadaId && m.lote_id).map((m) => m.lote_id);
      return [...new Set([...idsPecuaria, ...idsMapa])];
    },
    enabled: !!empresaSelecionadaId,
    initialData: []
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
      queryClient.invalidateQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId] });
      setShowForm(false);
      setEditingLote(null);
      toast.success('Lote cadastrado!');
    }
  });

  const updateLoteMutation = useMutation({
    mutationFn: async ({ id, data, oldData }) => {
      const updated = await base44.entities.Lote.update(id, data);
      await base44.functions.invoke('syncEntityReferences', {
        event: { type: 'update', entity_name: 'Lote' },
        data: updated,
        old_data: oldData
      });
      return updated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId] });
      setShowForm(false);
      setEditingLote(null);
      toast.success('Lote atualizado!');
    }
  });

  const deleteLoteMutation = useMutation({
    mutationFn: (id) => base44.entities.Lote.delete(id)
  });

  const handleSubmit = (data) => {
    if (editingLote) {
      updateLoteMutation.mutate({ id: editingLote.id, data, oldData: editingLote });
    } else {
      createLoteMutation.mutate(data);
    }
  };

  const handleEdit = (lote) => {
    setEditingLote(lote);
    setShowForm(true);
  };

  const handleRequestDelete = (ids) => {
    setDeleteState({ open: true, ids: Array.isArray(ids) ? ids : [ids] });
  };

  const handleConfirmDelete = async () => {
    const ids = deleteState.ids;
    setDeleteState({ open: false, ids: [] });

    let deletedCount = 0;

    for (const id of ids) {
      try {
        await ensureDeleteAllowed(base44, 'Lote', id);
        await deleteLoteMutation.mutateAsync(id);
        deletedCount += 1;
      } catch {
      }
    }

    if (deletedCount > 0) {
      queryClient.invalidateQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId] });
      toast.success(deletedCount === 1 ? 'Lote excluído!' : `${deletedCount} lotes excluídos!`);
    }
  };

  const handleExport = () => {
    const csv = [
    ['Código', 'Nome', 'Qtd Entrada', 'Motivo', 'Categoria Entrada', 'Sexo', 'Raça', 'Peso Entrada', 'Área Entrada', 'Status', 'Valor Total'].join(';'),
    ...lotes.map((l) => [
    l.numero_lote, l.nome, l.quantidade_entrada || l.quantidade_cabecas, l.motivo_entrada || l.origem || '',
    l.categoria_entrada || l.categoria, l.sexo || '', l.raca_predominante || '', l.peso_entrada_kg || l.peso_medio_kg || '',
    l.area_entrada_nome || '', l.status, l.valor_total_compra || ''].
    join(';'))].
    join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `lotes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success('Exportado!');
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Cadastro de Lotes</h1>
          
        </div>
        <div className="flex flex-wrap gap-2">
          {!showForm &&
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="h-8 w-8">
              <Settings className="w-4 h-4" />
            </Button>
          }
          

          
          <Button onClick={handleExport} variant="outline" size="sm" className="h-8 text-xs">
            Exportar
          </Button>
          {!showForm &&
          <Button onClick={() => {setShowForm(true);setEditingLote(null);}} size="sm" className="bg-lime-500 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-8 hover:bg-emerald-700">
              Novo Lote
            </Button>
          }
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showForm ?
        <FormularioLote
          key="form"
          initialData={editingLote}
          isEditing={!!editingLote}
          onSubmit={handleSubmit}
          onCancel={() => {setShowForm(false);setEditingLote(null);}} /> :


        <TabelaLotes
          key="table"
          lotes={lotes}
          areas={areas}
          onEdit={handleEdit}
          onDelete={handleRequestDelete}
          lotesComMovimentacoes={lotesComMovimentacoes}
          showConfigColunas={showConfigColunas}
          setShowConfigColunas={setShowConfigColunas} />

        }
      </AnimatePresence>

      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Confirmar exclusão"
        description={deleteState.ids.length > 1 ? `Deseja realmente excluir ${deleteState.ids.length} lotes selecionados?` : 'Deseja realmente excluir este lote?'}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete} />
      
    </div>);

}
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import FormularioLote from "@/components/lotes/FormularioLote";
import TabelaLotes from "@/components/lotes/TabelaLotes";

export default function CadastroLotes() {
  const [showForm, setShowForm] = useState(false);
  const [editingLote, setEditingLote] = useState(null);
  const [hasChildrenEdit, setHasChildrenEdit] = useState(false);
  const [alertDialog, setAlertDialog] = useState({ open: false, message: '', type: '' });
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  // Origens criadas automaticamente pelo sistema
  const ORIGENS_SISTEMA = ['MOVIMENTAÇÃO', 'REVERSÃO MOVIMENTAÇÃO', 'Nascimento', 'Mudança de Categoria', 'NASCIMENTO', 'MUDANÇA DE CATEGORIA'];

  const { data: lotes = [], isLoading } = useQuery({
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

  // Verificar se um lote tem registros filhos (movimentações vinculadas)
  const verificarRegistrosFilhos = async (loteId, loteNome) => {
    const [movMapa, movPec] = await Promise.all([
      base44.entities.MovimentacaoMapa.list(),
      base44.entities.MovimentacaoPecuaria.list()
    ]);
    
    const temMovMapa = movMapa.some(m => 
      m.empresa_id === empresaSelecionadaId && 
      (m.lote_id === loteId || (loteNome && m.lote?.toUpperCase().trim() === loteNome.toUpperCase().trim()))
    );
    
    const temMovPec = movPec.some(m => 
      m.empresa_id === empresaSelecionadaId && 
      (m.lote_id === loteId || (loteNome && m.lote?.toUpperCase().trim() === loteNome.toUpperCase().trim()))
    );
    
    return temMovMapa || temMovPec;
  };

  const createLoteMutation = useMutation({
    mutationFn: async (data) => {
      const allLotes = await base44.entities.Lote.list();
      const maxNum = allLotes.reduce((max, l) => Math.max(max, parseInt(l.numero_lote) || 0), 0);
      
      // Criar o lote
      const novoLote = await base44.entities.Lote.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_lote: String(maxNum + 1),
        status: 'Ativo'
      });

      // Criar registro de movimentação automaticamente
      const allMovs = await base44.entities.MovimentacaoPecuaria.list();
      const maxMovNum = allMovs.reduce((max, m) => Math.max(max, parseInt(m.numero_movimentacao) || 0), 0);

      await base44.entities.MovimentacaoPecuaria.create({
        empresa_id: empresaSelecionadaId,
        numero_movimentacao: String(maxMovNum + 1),
        tipo: 'Entrada',
        motivo: data.motivo_entrada || 'Cadastro',
        data_movimentacao: data.data_entrada ? `${data.data_entrada}T12:00:00` : new Date().toISOString(),
        quantidade_animais: data.quantidade_cabecas || 0,
        categoria_animal: data.categoria || '',
        sexo: data.sexo || null,
        peso_medio: data.peso_medio_kg || null,
        area_destino_id: data.area_atual_id || null,
        area_destino_nome: data.area_atual_nome || null,
        fornecedor_origem: data.fornecedor_nome || null,
        nota_fiscal: data.nota_fiscal || null,
        gta: data.numero_gta || null,
        valor_unitario: data.valor_por_cabeca || null,
        valor_total: data.valor_total_compra || null,
        lote_id: novoLote.id,
        lote: data.nome,
        marca: data.raca_predominante || null,
        observacoes: `Cadastro de lote: ${data.nome} | Motivo: ${data.motivo_entrada || 'Cadastro'}`
      });

      return novoLote;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-pecuaria'] });
      setShowForm(false);
      setEditingLote(null);
      toast.success('Lote cadastrado e movimentação registrada!');
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

  const handleEdit = async (lote) => {
    const temFilhos = await verificarRegistrosFilhos(lote.id, lote.nome);
    setHasChildrenEdit(temFilhos);
    setEditingLote(lote);
    setShowForm(true);
    
    if (temFilhos) {
      setAlertDialog({
        open: true,
        message: 'Este lote possui movimentações vinculadas. Campos críticos (nome, quantidade, data, motivo) estarão bloqueados para edição. Apenas dados complementares podem ser alterados.',
        type: 'warning'
      });
    }
  };

  const handleDelete = async (id) => {
    const lote = lotes.find(l => l.id === id);
    const temFilhos = await verificarRegistrosFilhos(id, lote?.nome);

    if (temFilhos) {
      setAlertDialog({
        open: true,
        message: 'Não é possível excluir este lote pois existem movimentações vinculadas. Exclua todas as movimentações do lote antes.',
        type: 'error'
      });
      return;
    }

    if (window.confirm('Deseja realmente excluir este lote?')) {
      deleteLoteMutation.mutate(id);
    }
  };

  const handleExport = () => {
    const csv = [
      ['Código', 'Nome', 'Quantidade', 'Motivo Entrada', 'Categoria', 'Peso Médio', 'Área Atual', 'Status', 'Valor Total'].join(';'),
      ...lotes.map(l => [
        l.numero_lote, l.nome, l.quantidade_cabecas, l.motivo_entrada || l.origem || '',
        l.categoria, l.peso_medio_kg || '', l.area_atual_nome || '', l.status, l.valor_total_compra || ''
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
          <p className="text-xs text-slate-600">Registro fixo de entrada de lotes — as movimentações são gerenciadas separadamente</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExport} variant="outline" size="sm" className="h-8 text-xs">
            <Download className="w-3.5 h-3.5 mr-1" /> Exportar
          </Button>
          {!showForm && (
            <Button onClick={() => { setShowForm(true); setEditingLote(null); setHasChildrenEdit(false); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
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
            hasChildren={hasChildrenEdit}
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

      {/* Dialog de alerta */}
      <Dialog open={alertDialog.open} onOpenChange={(open) => setAlertDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className={`w-4 h-4 ${alertDialog.type === 'error' ? 'text-red-500' : 'text-amber-500'}`} />
              {alertDialog.type === 'error' ? 'Ação Bloqueada' : 'Atenção'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-600">{alertDialog.message}</p>
          <div className="flex justify-end">
            <Button size="sm" className="h-8 text-xs" onClick={() => setAlertDialog(prev => ({ ...prev, open: false }))}>
              Entendi
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
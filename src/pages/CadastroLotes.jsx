import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings, Layers } from "lucide-react";
import loteRepository from "@/core/repositories/loteRepository";
import cadastroRepository from "@/core/repositories/cadastroRepository";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import FormularioLote from "@/components/lotes/FormularioLote";
import FormularioLoteDinamico from "@/components/lotes/FormularioLoteDinamico";
import TabelaLotes from "@/components/lotes/TabelaLotes";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { refreshMapaCacheEntry } from "@/components/offline/mapaOfflineCache";

export default function CadastroLotes() {
  const [showForm, setShowForm] = useState(false);
  const [editingLote, setEditingLote] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [usarFormularioDinamico, setUsarFormularioDinamico] = useState(() => localStorage.getItem("cadastro_lotes_form_dinamico") === "true");
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-cadastro', empresaSelecionadaId],
    queryFn: () => loteRepository.list({ empresaId: empresaSelecionadaId }),
    enabled: !!empresaSelecionadaId,
    initialData: []
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: () => cadastroRepository.listAreasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
    initialData: []
  });

  const { data: lotesComMovimentacoes = [] } = useQuery({
    queryKey: ['lotes-com-movimentacoes', empresaSelecionadaId],
    queryFn: () => loteRepository.listIdsComMovimentacoes(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
    initialData: []
  });

  const createLoteMutation = useMutation({
    mutationFn: (data) => loteRepository.create(data, { empresaId: empresaSelecionadaId }),
    onSuccess: async (created) => {
      queryClient.setQueryData(['lotes-cadastro', empresaSelecionadaId], (current = []) => [created, ...current]);
      await queryClient.invalidateQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId] });
      await queryClient.refetchQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId], exact: true });
      await refreshMapaCacheEntry('lotes', empresaSelecionadaId, { force: true });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      setShowForm(false);
      setEditingLote(null);
      toast.success('Lote cadastrado!');
    }
  });

  const updateLoteMutation = useMutation({
    mutationFn: async ({ id, data, oldData }) => {
      const updated = await loteRepository.update(id, data);
      await loteRepository.syncReferences({ data: updated, oldData });
      return updated;
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(['lotes-cadastro', empresaSelecionadaId], (current = []) =>
      current.map((item) => item.id === updated.id ? updated : item)
      );
      await queryClient.invalidateQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId] });
      await queryClient.refetchQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId], exact: true });
      await refreshMapaCacheEntry('lotes', empresaSelecionadaId, { force: true });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      setShowForm(false);
      setEditingLote(null);
      toast.success('Lote atualizado!');
    }
  });

  const deleteLoteMutation = useMutation({
    mutationFn: (id) => loteRepository.delete(id)
  });

  const handleSubmit = (data) => {
    if (editingLote && !editingLote._isDuplicate) {
      updateLoteMutation.mutate({ id: editingLote.id, data, oldData: editingLote });
    } else {
      const { _isDuplicate, ...cleanData } = data;
      createLoteMutation.mutate(cleanData);
    }
  };

  const handleEdit = (lote) => {
    setEditingLote(lote);
    setShowForm(true);
  };

  const handleDuplicate = (lote) => {
    const { id, created_date, updated_date, created_by, numero_lote, status, ...duplicatedData } = lote;
    setEditingLote({
      ...duplicatedData,
      quantidade_cabecas: lote.quantidade_entrada ?? lote.quantidade_cabecas ?? '',
      quantidade_entrada: lote.quantidade_entrada ?? lote.quantidade_cabecas ?? '',
      categoria: lote.categoria_entrada ?? lote.categoria ?? '',
      categoria_entrada: lote.categoria_entrada ?? lote.categoria ?? '',
      categoria_manejo_id: lote.categoria_manejo_entrada_id ?? lote.categoria_manejo_id ?? '',
      categoria_manejo_nome: lote.categoria_manejo_entrada_nome ?? lote.categoria_manejo_nome ?? '',
      categoria_manejo_entrada_id: lote.categoria_manejo_entrada_id ?? lote.categoria_manejo_id ?? '',
      categoria_manejo_entrada_nome: lote.categoria_manejo_entrada_nome ?? lote.categoria_manejo_nome ?? '',
      peso_medio_kg: lote.peso_entrada_kg ?? lote.peso_medio_kg ?? '',
      peso_entrada_kg: lote.peso_entrada_kg ?? lote.peso_medio_kg ?? '',
      area_entrada_id: lote.area_entrada_id ?? lote.area_atual_id ?? '',
      area_entrada_nome: lote.area_entrada_nome ?? lote.area_atual_nome ?? '',
      area_atual_id: lote.area_entrada_id ?? lote.area_atual_id ?? '',
      area_atual_nome: lote.area_entrada_nome ?? lote.area_atual_nome ?? '',
      _isDuplicate: true
    });
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
        await deleteLoteMutation.mutateAsync(id);
        deletedCount += 1;
      } catch {
      }
    }

    if (deletedCount > 0) {
      await queryClient.invalidateQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId] });
      await queryClient.refetchQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId], exact: true });
      await refreshMapaCacheEntry('lotes', empresaSelecionadaId, { force: true });
      window.dispatchEvent(new CustomEvent('atualizar-mapa'));
      toast.success(deletedCount === 1 ? 'Lote excluído!' : `${deletedCount} lotes excluídos!`);
    }
  };


  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="font-bold text-slate-800">Cadastro de Lotes</h1>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7">
            <Settings className="w-4 h-4" />
          </Button>
          <Button
            variant={usarFormularioDinamico ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !usarFormularioDinamico;
              setUsarFormularioDinamico(next);
              localStorage.setItem("cadastro_lotes_form_dinamico", String(next));
            }}
            className={`h-7 text-xs px-2 ${usarFormularioDinamico ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}>
            <Layers className="w-3.5 h-3.5" />
            {usarFormularioDinamico ? "Dinâmico" : "Antigo"}
          </Button>
          <Button onClick={() => {setShowForm(true);setEditingLote(null);}} size="sm" className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow rounded-md px-3 bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs">
            Adicionar
          </Button>
        </div>
      </div>}

      <AnimatePresence mode="wait">
        {showForm ?
        (usarFormularioDinamico ?
          <FormularioLoteDinamico
            key="form-dinamico"
            initialData={editingLote}
            isEditing={!!editingLote}
            onSubmit={handleSubmit}
            onCancel={() => {setShowForm(false);setEditingLote(null);}} /> :
          <FormularioLote
            key="form"
            initialData={editingLote}
            isEditing={!!editingLote}
            onSubmit={handleSubmit}
            onCancel={() => {setShowForm(false);setEditingLote(null);}} />) :


        <TabelaLotes
          key="table"
          lotes={lotes}
          areas={areas}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
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
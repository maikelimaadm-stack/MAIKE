import React, { useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SankhyaListToolbar from "@/components/common/SankhyaListToolbar";
import { toast } from "sonner";
import FormularioLote from "@/components/lotes/FormularioLote";
import TabelaLotes from "@/components/lotes/TabelaLotes";
import ConfiguracaoCamposLoteDialog from "@/components/lotes/ConfiguracaoCamposLoteDialog";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { refreshMapaCacheEntry } from "@/components/offline/mapaOfflineCache";
import loteRepository from "@/core/repositories/loteRepository";

export default function CadastroLotes() {
  const [showForm, setShowForm] = useState(false);
  const [editingLote, setEditingLote] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [showConfigCampos, setShowConfigCampos] = useState(false);
  const [viewMode, setViewMode] = useState("table");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTableItems, setSelectedTableItems] = useState([]);
  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes-cadastro', empresaSelecionadaId],
    queryFn: () => loteRepository.list({ empresaId: empresaSelecionadaId, incluirSistema: false }),
    enabled: !!empresaSelecionadaId,
    initialData: []
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: () => loteRepository.listAreasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
    initialData: []
  });

  const { data: lotesComMovimentacoes = [] } = useQuery({
    queryKey: ['lotes-com-movimentacoes', empresaSelecionadaId],
    queryFn: () => loteRepository.listLotesComMovimentacoes(empresaSelecionadaId),
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
    mutationFn: ({ id, data, oldData }) => loteRepository.update(id, data, { oldData }),
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
    const index = lotes.findIndex((item) => item.id === lote.id);
    if (index >= 0) setSelectedIndex(index);
    setEditingLote(lote);
    setShowForm(true);
    setViewMode("record");
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

  const handleOpenConfigCampos = () => {
    setShowConfigCampos(true);
  };

  const currentLote = lotes[selectedIndex] || lotes[0] || null;
  const selectedTableLote = selectedTableItems.length === 1 ? lotes.find((item) => item.id === selectedTableItems[0]) : null;

  const handleTableSelectionChange = useCallback((ids) => {
    setSelectedTableItems(ids);
    if (ids.length === 1) {
      const index = lotes.findIndex((item) => item.id === ids[0]);
      if (index >= 0) setSelectedIndex(index);
    }
  }, [lotes]);

  const handleToggleView = () => {
    if (showForm) {
      setShowForm(false);
      setEditingLote(null);
      setViewMode("table");
      return;
    }
    if (!currentLote) return;
    setEditingLote(currentLote);
    setShowForm(true);
    setViewMode("record");
  };

  const navigateRecord = (index) => {
    if (!showForm) return;
    const nextIndex = Math.min(Math.max(index, 0), Math.max(lotes.length - 1, 0));
    setSelectedIndex(nextIndex);
    if (lotes[nextIndex]) setEditingLote(lotes[nextIndex]);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['lotes-cadastro', empresaSelecionadaId] });
  };

  const handleConfirmDelete = async () => {
    const ids = deleteState.ids;
    setDeleteState({ open: false, ids: [] });

    let deletedCount = 0;

    for (const id of ids) {
      try {
        await loteRepository.ensureDeleteAllowed(id);
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
      {!showForm && (
        <SankhyaListToolbar
          viewMode={viewMode}
          total={lotes.length}
          currentIndex={selectedIndex}
          searchValue={searchTerm}
          onSearchChange={setSearchTerm}
          onNew={() => {setShowForm(true);setEditingLote(null);setViewMode("record");}}
          onToggleView={handleToggleView}
          onFirst={() => navigateRecord(0)}
          onPrevious={() => navigateRecord(selectedIndex - 1)}
          onNext={() => navigateRecord(selectedIndex + 1)}
          onLast={() => navigateRecord(lotes.length - 1)}
          onDelete={() => selectedTableItems.length > 0 && handleRequestDelete(selectedTableItems)}
          onDuplicate={() => selectedTableLote && handleDuplicate(selectedTableLote)}
          onRefresh={handleRefresh}
          onSettingsClick={() => setShowConfigColunas(true)}
          selectedCount={selectedTableItems.length}
        />
      )}

      {showForm ? (
        <FormularioLote
          key="form"
          initialData={editingLote}
          isEditing={!!editingLote}
          onSubmit={handleSubmit}
          onCancel={() => {setShowForm(false);setEditingLote(null);setViewMode("table");}}
          onSettingsClick={handleOpenConfigCampos}
          onToggleView={handleToggleView}
          total={lotes.length}
          currentIndex={selectedIndex}
          onNew={() => {setShowForm(true);setEditingLote(null);setViewMode("record");}}
          onFirst={() => navigateRecord(0)}
          onPrevious={() => navigateRecord(selectedIndex - 1)}
          onNext={() => navigateRecord(selectedIndex + 1)}
          onLast={() => navigateRecord(lotes.length - 1)}
          onDelete={() => editingLote?.id && handleRequestDelete(editingLote.id)}
          onDuplicate={() => editingLote && handleDuplicate(editingLote)}
          onRefresh={handleRefresh} />
      ) : (
        <TabelaLotes
          key="table"
          lotes={lotes}
          areas={areas}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
          onDelete={handleRequestDelete}
          lotesComMovimentacoes={lotesComMovimentacoes}
          showConfigColunas={showConfigColunas}
          setShowConfigColunas={setShowConfigColunas}
          searchTerm={searchTerm}
          onSelectionChange={handleTableSelectionChange} />
      )}

      <ConfiguracaoCamposLoteDialog
        open={showConfigCampos}
        onOpenChange={setShowConfigCampos} />

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
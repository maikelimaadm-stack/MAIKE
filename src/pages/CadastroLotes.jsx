import React, { useCallback, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import SankhyaListToolbar from "@/components/common/SankhyaListToolbar";
import SankhyaFilterPanel from "@/components/common/SankhyaFilterPanel";
import { toast } from "sonner";
import FormularioLote from "@/components/lotes/FormularioLote";
import TabelaLotes from "@/components/lotes/TabelaLotes";
import ConfiguracaoCamposLoteDialog from "@/components/lotes/ConfiguracaoCamposLoteDialog";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import RegistroAnexosDialog from "@/components/common/RegistroAnexosDialog";
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
  const [formVersion, setFormVersion] = useState(0);
  const [returnRecordAfterNew, setReturnRecordAfterNew] = useState(null);
  const [attachmentsRecord, setAttachmentsRecord] = useState(null);
  const [newRecordAttachmentsOpen, setNewRecordAttachmentsOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [filters, setFilters] = useState({ status: "todos" });
  const [appliedFilters, setAppliedFilters] = useState({ status: "todos" });
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

  const hasActiveFilters = useMemo(() => {
    return Object.entries(appliedFilters).some(([key, value]) => {
      if (key === "status") return value && value !== "todos";
      return Boolean(String(value || "").trim());
    });
  }, [appliedFilters]);

  const lotesFiltradosPainel = useMemo(() => {
    return lotes.filter((lote) => {
      const contains = (field, value) => String(field || "").toLowerCase().includes(String(value || "").toLowerCase().trim());
      if (appliedFilters.numero_lote && !contains(lote.numero_lote, appliedFilters.numero_lote)) return false;
      if (appliedFilters.nome && !contains(lote.nome, appliedFilters.nome)) return false;
      if (appliedFilters.categoria && !contains(lote.categoria, appliedFilters.categoria)) return false;
      if (appliedFilters.status && appliedFilters.status !== "todos" && lote.status !== appliedFilters.status) return false;
      const dataEntrada = String(lote.data_entrada || "").split("T")[0];
      if (appliedFilters.data_inicio && dataEntrada < appliedFilters.data_inicio) return false;
      if (appliedFilters.data_fim && dataEntrada > appliedFilters.data_fim) return false;
      return true;
    });
  }, [lotes, appliedFilters]);

  const createLoteMutation = useMutation({
    mutationFn: (data) => loteRepository.create(data, { empresaId: empresaSelecionadaId }),
    onSuccess: async (created) => {
      if (pendingAttachments.length) {
        await Promise.all(pendingAttachments.map(({ id, ...anexo }) => base44.entities.RegistroAnexo.create({
          ...anexo,
          entity_name: "Lote",
          record_id: created.id
        })));
        setPendingAttachments([]);
      }
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
    const index = lotesFiltradosPainel.findIndex((item) => item.id === lote.id);
    if (index >= 0) setSelectedIndex(index);
    setSelectedTableItems([lote.id]);
    setEditingLote(lote);
    setShowForm(true);
    setViewMode("record");
  };

  const handleNew = () => {
    setReturnRecordAfterNew(showForm && viewMode === "record" ? editingLote || currentLote : null);
    setEditingLote(null);
    setShowForm(true);
    setViewMode("record");
    setPendingAttachments([]);
    setFormVersion((prev) => prev + 1);
  };

  const handleDuplicate = (lote) => {
    setReturnRecordAfterNew(showForm && viewMode === "record" ? lote : null);
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
    setViewMode("record");
    setFormVersion((prev) => prev + 1);
  };

  const handleRequestDelete = (ids) => {
    setDeleteState({ open: true, ids: Array.isArray(ids) ? ids : [ids] });
  };

  const handleOpenConfigCampos = () => {
    setShowConfigCampos(true);
  };

  const currentLote = lotesFiltradosPainel[selectedIndex] || lotesFiltradosPainel[0] || null;
  const selectedTableLote = selectedTableItems.length === 1 ? lotesFiltradosPainel.find((item) => item.id === selectedTableItems[0]) : null;
  const recordForAttachments = showForm ? editingLote : selectedTableLote;

  const handleTableSelectionChange = useCallback((ids) => {
    setSelectedTableItems((prev) => {
      const sameSelection = prev.length === ids.length && prev.every((id, index) => id === ids[index]);
      return sameSelection ? prev : ids;
    });
    if (ids.length === 1) {
      const index = lotesFiltradosPainel.findIndex((item) => item.id === ids[0]);
      if (index >= 0) setSelectedIndex(index);
    }
  }, [lotesFiltradosPainel]);

  const handleToggleView = () => {
    if (showForm) {
      setShowForm(false);
      setEditingLote(null);
      setViewMode("table");
      return;
    }
    if (selectedTableItems.length > 1) return;
    const loteParaVisualizar = selectedTableLote || currentLote;
    if (!loteParaVisualizar) return;
    setEditingLote(loteParaVisualizar);
    setShowForm(true);
    setViewMode("record");
  };

  const navigateRecord = (index) => {
    if (!showForm) return;
    const nextIndex = Math.min(Math.max(index, 0), Math.max(lotesFiltradosPainel.length - 1, 0));
    setSelectedIndex(nextIndex);
    if (lotesFiltradosPainel[nextIndex]) {
      setEditingLote(lotesFiltradosPainel[nextIndex]);
      setSelectedTableItems([lotesFiltradosPainel[nextIndex].id]);
    }
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
    <div className="space-y-1 p-0 md:p-0 bg-white">
      {showForm &&
      <FormularioLote
        key={`form-${formVersion}-${editingLote?.id || editingLote?._isDuplicate || 'new'}`}
        initialData={editingLote}
        isEditing={!!editingLote}
        onSubmit={handleSubmit}
        onCancel={() => {
          if (editingLote && !editingLote._isDuplicate) {
            setFormVersion((prev) => prev + 1);
            setViewMode("record");
            return;
          }
          if (editingLote?._isDuplicate && returnRecordAfterNew) {
            setEditingLote(returnRecordAfterNew);
            setShowForm(true);
            setViewMode("record");
            setReturnRecordAfterNew(null);
            return;
          }
          if (!editingLote && returnRecordAfterNew) {
            setEditingLote(returnRecordAfterNew);
            setShowForm(true);
            setViewMode("record");
            setReturnRecordAfterNew(null);
            return;
          }
          setShowForm(false);
          setEditingLote(null);
          setViewMode("table");
          setReturnRecordAfterNew(null);
          setPendingAttachments([]);
          setNewRecordAttachmentsOpen(false);
        }}
        onSettingsClick={handleOpenConfigCampos}
        onToggleView={handleToggleView}
        total={lotesFiltradosPainel.length}
        currentIndex={selectedIndex}
        onNew={handleNew}
        onFirst={() => navigateRecord(0)}
        onPrevious={() => navigateRecord(selectedIndex - 1)}
        onNext={() => navigateRecord(selectedIndex + 1)}
        onLast={() => navigateRecord(lotesFiltradosPainel.length - 1)}
        onDelete={() => editingLote?.id && handleRequestDelete(editingLote.id)}
        onDuplicate={() => editingLote && handleDuplicate(editingLote)}
        onAttachClick={() => editingLote?.id ? setAttachmentsRecord(editingLote) : setNewRecordAttachmentsOpen(true)}
        attachDisabled={false}
        onRefresh={handleRefresh} />
      }

      <div className={showForm ? "hidden" : "flex items-start min-h-0 w-full overflow-hidden"}>
        <SankhyaFilterPanel
          open={filterPanelOpen}
          filters={filters}
          onChange={setFilters}
          onApply={() => setAppliedFilters(filters)}
          onClear={() => { setFilters({ status: "todos" }); setAppliedFilters({ status: "todos" }); }} />
        <div className="min-w-0 flex-1 overflow-hidden">
          <SankhyaListToolbar
            viewMode={viewMode}
            total={lotesFiltradosPainel.length}
            currentIndex={selectedIndex}
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            onNew={handleNew}
            onToggleView={handleToggleView}
            toggleViewDisabled={selectedTableItems.length > 1}
            filterOpen={filterPanelOpen}
            filterActive={hasActiveFilters}
            onToggleFilter={() => setFilterPanelOpen((open) => !open)}
            onClearFilter={() => { setFilters({ status: "todos" }); setAppliedFilters({ status: "todos" }); }}
            onFirst={() => navigateRecord(0)}
            onPrevious={() => navigateRecord(selectedIndex - 1)}
            onNext={() => navigateRecord(selectedIndex + 1)}
            onLast={() => navigateRecord(lotesFiltradosPainel.length - 1)}
            onDelete={() => selectedTableItems.length > 0 && handleRequestDelete(selectedTableItems)}
            onDuplicate={() => selectedTableLote && handleDuplicate(selectedTableLote)}
            onRefresh={handleRefresh}
            onAttachClick={() => selectedTableLote && setAttachmentsRecord(selectedTableLote)}
            attachDisabled={selectedTableItems.length !== 1}
            onSettingsClick={() => setShowConfigColunas(true)}
            selectedCount={selectedTableItems.length}
            title="Cadastro de Lotes"
            recordLabel="" />
          <TabelaLotes
            key="table"
            lotes={lotesFiltradosPainel}
            areas={areas}
            onEdit={handleEdit}
            onDuplicate={handleDuplicate}
            onDelete={handleRequestDelete}
            lotesComMovimentacoes={lotesComMovimentacoes}
            showConfigColunas={showConfigColunas}
            setShowConfigColunas={setShowConfigColunas}
            searchTerm={searchTerm}
            selectedRecordId={showForm ? editingLote?.id : undefined}
            onSelectionChange={handleTableSelectionChange} />
        </div>
      </div>

      <ConfiguracaoCamposLoteDialog
        open={showConfigCampos}
        onOpenChange={setShowConfigCampos} />

      <RegistroAnexosDialog
        open={!!attachmentsRecord?.id || newRecordAttachmentsOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAttachmentsRecord(null);
            setNewRecordAttachmentsOpen(false);
          }
        }}
        entityName="Lote"
        recordId={attachmentsRecord?.id}
        title={attachmentsRecord?.nome || attachmentsRecord?.numero_lote || "Novo lote"}
        pendingAnexos={pendingAttachments}
        onPendingChange={setPendingAttachments} />

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
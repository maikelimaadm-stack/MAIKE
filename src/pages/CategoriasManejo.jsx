import React, { useCallback, useMemo, useState } from "react";
import {
  listarCategoriasManejoDaEmpresa,
  listarIconesDeLoteDaEmpresa,
  criarCategoriaManejo,
  atualizarCategoriaManejo,
  excluirCategoriaManejo,
} from "@/services/categoriaManejoService";
import { getApiErrorMessage, hasApiErrorCode, API_ERROR_CODES } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroRecordHeader from "@/components/cadastro/base1/CadastroRecordHeader";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { useCadastroPageListBindings } from "@/hooks/useCadastroPageListBindings";
import { useCadastroDuplicateAction } from "@/hooks/useCadastroDuplicateAction";
import TabelaCategoriasManejo, {
  CATEGORIAS_MANEJO_COLUNAS,
  getCategoriaManejoFieldValue,
} from "@/components/categorias-manejo/TabelaCategoriasManejo";
import { exportCadastroCsv } from "@/components/cadastro/base1/cadastroExportCsv";
import FormularioCategoriaManejo from "@/components/categorias-manejo/FormularioCategoriaManejo";

const getInitialFormData = () => ({
  nome: "",
  sigla: "",
  especie: "Bovinos",
  sexo: "",
  raca: "",
  idade_minima_meses: "",
  idade_maxima_meses: "",
  categoria_oficial: "",
  ganho_peso_anual_kg: "",
  gmd_janeiro: "",
  gmd_fevereiro: "",
  gmd_marco: "",
  gmd_abril: "",
  gmd_maio: "",
  gmd_junho: "",
  gmd_julho: "",
  gmd_agosto: "",
  gmd_setembro: "",
  gmd_outubro: "",
  gmd_novembro: "",
  gmd_dezembro: "",
});

export default function CategoriasManejo() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [editando, setEditando] = useState(null);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const chrome = useCadastroListaChromeState();
  const listBindings = useCadastroPageListBindings({ storageKey: "colunas_largura_categorias_manejo", columns: CATEGORIAS_MANEJO_COLUNAS, chrome });

  const handleDuplicateSelected = useCadastroDuplicateAction({
    chrome,
    findById: (id) => categorias.find((row) => row.id === id),
    openDraft: (draft) => {
      setEditando({ ...getInitialFormData(), ...draft });
      setShowForm(true);
    },
    labelField: "nome",
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias-manejo", empresaSelecionadaId],
    queryFn: async () => listarCategoriasManejoDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => listarIconesDeLoteDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: (formData) => criarCategoriaManejo(formData, { empresaId: empresaSelecionadaId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias-manejo", empresaSelecionadaId] });
      setShowForm(false);
      setEditando(null);
      toast.success("Categoria cadastrada!");
    },
  });

  const updateMutation = useMutation(
    /** @type {import('@tanstack/react-query').UseMutationOptions<
     *   unknown,
     *   Error,
     *   { id: string, data: Record<string, unknown>, oldData?: object }
     * >} */ ({
      mutationFn: ({ id, data, oldData: _oldData }) =>
        atualizarCategoriaManejo(id, data, { empresaId: empresaSelecionadaId }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["categorias-manejo", empresaSelecionadaId] });
        setShowForm(false);
        setEditando(null);
        toast.success("Categoria atualizada!");
      },
    })
  );

  const deleteMutation = useMutation({
    mutationFn: (id) => excluirCategoriaManejo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias-manejo", empresaSelecionadaId] });
      chrome.setSelectedIds([]);
      toast.success("Categoria excluída!");
    },
    onError: (error) => {
      if (hasApiErrorCode(error, API_ERROR_CODES.CATEGORIA_MANEJO_DELETE_BLOCKED)) return;
      toast.error(getApiErrorMessage(error, "Erro ao excluir."));
    },
  });

  const categoriasOficiaisDisponiveis = useMemo(() => {
    const categoriasPadrao = [
      "Bezerro 0 a 12 meses",
      "Bezerra 0 a 12 meses",
      "Garrote 13 a 24 meses",
      "Novilha 13 a 24 meses",
      "Boi 25 a 36 meses",
      "Vaca 25 a 36 meses",
      "Touro + 36 meses",
      "Vaca + 36 meses",
    ];

    const categoriasIcones = iconesConfig
      .filter((ic) => ic.tipo_entidade === "Lote")
      .map((ic) => ic.categoria)
      .filter((cat) => cat && cat.toUpperCase() !== "MISTO");

    return [...new Set([...categoriasPadrao, ...categoriasIcones])].sort();
  }, [iconesConfig]);

  const closeForm = () => {
    setShowForm(false);
    setEditando(null);
    chrome.exitRecordView();
  };

  const openNew = () => {
    setEditando(null);
    setShowForm(true);
    chrome.setViewMode("record");
  };

  const handleEdit = (categoria) => {
    setEditando(categoria);
    setShowForm(true);
    chrome.setViewMode("record");
    if (categoria?.id) chrome.onSelectionChange([categoria.id]);
  };

  const handleEditSelected = () => {
    const item = categorias.find((c) => c.id === chrome.selectedIds[0]);
    if (item) handleEdit(item);
  };

  const handleRequestDelete = (id) => {
    const ids = Array.isArray(id) ? id : [id];
    setDeleteState({ open: true, ids });
  };

  const handleDeleteSelected = () => {
    if (!chrome.selectedIds.length) return;
    handleRequestDelete(chrome.selectedIds);
  };

  const handleConfirmDelete = () => {
    const [firstId] = deleteState.ids;
    if (firstId) deleteMutation.mutate(firstId);
    setDeleteState({ open: false, ids: [] });
  };

  const handleSubmit = (formData) => {
    if (editando) {
      updateMutation.mutate({ id: editando.id, data: formData, oldData: editando });
      return;
    }
    createMutation.mutate(formData);
  };

  const onViewModeChange = useCallback(
    (mode) => {
      chrome.handleViewModeChange(mode, {
        onOpenRecord: () => handleEditSelected(),
        onExitRecord: closeForm,
      });
    },
    [chrome, handleEditSelected, closeForm],
  );

  const filtradosCount = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return categorias.length;
    return categorias.filter((c) => {
      const hay = [c.nome, c.sigla, c.raca, c.categoria_oficial].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [categorias, chrome.appliedSearch]);

  const formInitialData = editando
    ? {
        ...getInitialFormData(),
        ...editando,
        idade_minima_meses: editando.idade_minima_meses || "",
        idade_maxima_meses: editando.idade_maxima_meses || "",
        ganho_peso_anual_kg: editando.ganho_peso_anual_kg || "",
        gmd_janeiro: editando.gmd_janeiro || "",
        gmd_fevereiro: editando.gmd_fevereiro || "",
        gmd_marco: editando.gmd_marco || "",
        gmd_abril: editando.gmd_abril || "",
        gmd_maio: editando.gmd_maio || "",
        gmd_junho: editando.gmd_junho || "",
        gmd_julho: editando.gmd_julho || "",
        gmd_agosto: editando.gmd_agosto || "",
        gmd_setembro: editando.gmd_setembro || "",
        gmd_outubro: editando.gmd_outubro || "",
        gmd_novembro: editando.gmd_novembro || "",
        gmd_dezembro: editando.gmd_dezembro || "",
      }
    : getInitialFormData();

  const detailTitle = editando?.id ? editando.nome || "Categoria" : "Nova categoria de manejo";

  const recordNavRows = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return categorias;
    return categorias.filter((c) => {
      const hay = [c.nome, c.sigla, c.raca, c.categoria_oficial].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [categorias, chrome.appliedSearch]);

  const recordIndex = editando?.id
    ? Math.max(0, recordNavRows.findIndex((c) => c.id === editando.id))
    : 0;

  const goRecord = (index) => {
    const row = recordNavRows[index];
    if (row) handleEdit(row);
  };

  return (
    <>
      <CadastroWorkspace
        mode="list"
        title="Categorias de manejo"
        subtitle="Categorias de lotes e parâmetros de ganho de peso."
        toolbar={null}
      >
        <CadastroListaChrome
          recordMode={showForm}
          secondaryToolsLocked={showForm}
          recordHeader={
            showForm ? (
              <CadastroRecordHeader
                title={detailTitle}
                code={editando?.sigla ? String(editando.sigla) : undefined}
                index={recordIndex}
                total={recordNavRows.length}
                onGo={editando?.id ? goRecord : undefined}
                navDisabled={!editando?.id}
              />
            ) : null
          }
          recordBody={
            showForm ? (
              <FormularioCategoriaManejo
                variant="embedded"
                initialData={formInitialData}
                isEditing={!!editando}
                onSubmit={handleSubmit}
                onCancel={closeForm}
                categoriasOficiaisDisponiveis={categoriasOficiaisDisponiveis}
              />
            ) : null
          }
          selectedCount={chrome.selectedIds.length}
          {...listBindings.listFooter.chromeFooter}
          onNew={openNew}
          onEdit={handleEditSelected}
          onDelete={handleDeleteSelected}
          onDuplicate={handleDuplicateSelected}
          onPrint={() => window.print()}
          cardsModeAvailable
          cardsToolbar={listBindings.cardsToolbar}
          searchValue={chrome.searchInput}
          onSearchChange={chrome.setSearchInput}
          onSearchApply={chrome.applySearch}
          searchActive={chrome.searchActive}
          searchPlaceholder="Buscar categorias…"
          onConfigureColumns={() => setShowConfigColunas(true)}
          onExportCsv={() =>
            exportCadastroCsv(
              "categorias-manejo.csv",
              CATEGORIAS_MANEJO_COLUNAS,
              categorias,
              getCategoriaManejoFieldValue,
            )
          }
          onClearFilters={chrome.clearFilters}
          filtersActive={chrome.filtersActive}
          viewMode={showForm ? "record" : chrome.viewMode}
          onViewModeChange={onViewModeChange}
        >
          {!showForm ? (
            <TabelaCategoriasManejo
              categorias={categorias}
              onEdit={handleEdit}
              onDelete={handleRequestDelete}
              showConfigColunas={showConfigColunas}
              setShowConfigColunas={setShowConfigColunas}
              searchQuery={chrome.appliedSearch}
              resetFiltersKey={chrome.resetFiltersKey}
              onSelectionChange={chrome.onSelectionChange}
              onFiltersActiveChange={chrome.setFiltersActive}
              viewMode={chrome.viewMode === "cards" ? "cards" : "table"}
              displayLimit={listBindings.listFooter.gradePaging.displayLimit}
              onListMetrics={listBindings.listFooter.gradePaging.onListMetrics}
              cardFields={listBindings.cardsPrefs.cardFields}
              cardsPerRow={listBindings.cardsPrefs.cardsPerRow}
            />
          ) : null}
        </CadastroListaChrome>
      </CadastroWorkspace>

      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Excluir categoria de manejo"
        description="Se esta categoria possuir registros lançados, a exclusão será bloqueada automaticamente."
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

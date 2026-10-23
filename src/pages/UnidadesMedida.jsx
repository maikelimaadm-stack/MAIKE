import React, { useCallback, useState, useEffect, useMemo } from "react";
import {
  listarUnidades,
  criarUnidade,
  atualizarUnidade,
  numerarUnidadesSemNumero,
  excluirUnidades,
} from "@/services/unidadeMedidaService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import CadastroWorkspace from "@/components/cadastro/CadastroWorkspace";
import CadastroListaChrome from "@/components/cadastro/base1/CadastroListaChrome";
import CadastroBase1Grade from "@/components/cadastro/base1/CadastroBase1Grade";
import { useCadastroListaChromeState } from "@/hooks/useCadastroListaChromeState";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";

const COLUNAS = [
  { id: "numero", label: "Nº", default: true, sortable: true, align: "left", width: 60 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, align: "left", width: 120 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, align: "left", width: 300 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
];

const FL = ({ label, required, error, children, dataField }) => (
  <div data-field={dataField}>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div
      className={`rounded-md border ${error ? "border-red-500 bg-red-50" : "border-slate-300"} focus-within:border-emerald-500 transition-colors`}
    >
      {children}
    </div>
  </div>
);

/** @param {object} item @param {string} colId */
function getFieldValue(item, colId) {
  if (colId === "numero") return item.numero_unidade || "";
  if (colId === "sigla") return item.sigla || "";
  if (colId === "descricao") return item.descricao || "";
  if (colId === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
  return "";
}

/** @param {object} item @param {string} colId */
function renderCell(item, colId) {
  if (colId === "numero") return item.numero_unidade || "–";
  if (colId === "sigla") {
    return (
      <span className={`uppercase font-mono font-semibold ${item.ativo === false ? "text-slate-400 line-through" : ""}`}>
        {item.sigla || "–"}
      </span>
    );
  }
  if (colId === "descricao") return item.descricao || "–";
  if (colId === "ativo") {
    return item.ativo !== false ? (
      <Badge className="text-[10px] bg-emerald-100 text-emerald-700">Ativo</Badge>
    ) : (
      <Badge className="text-[10px] bg-slate-100 text-slate-500">Inativo</Badge>
    );
  }
  return "–";
}

export default function UnidadesMedida() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({ sigla: "", descricao: "", ativo: true });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [errors, setErrors] = useState({});
  const chrome = useCadastroListaChromeState();
  const queryClient = useQueryClient();
  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ["unidades_medida"],
    queryFn: () => listarUnidades(),
    initialData: [],
  });

  useEffect(() => {
    const numerar = async () => {
      const { numeradas } = await numerarUnidadesSemNumero(unidades);
      if (numeradas.length) queryClient.invalidateQueries({ queryKey: ["unidades_medida"] });
    };
    if (!isLoading && unidades.length > 0) numerar();
  }, [unidades, isLoading, queryClient]);

  const createMutation = useMutation({
    mutationFn: (data) => criarUnidade(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unidades_medida"] });
      setShowForm(false);
      setEditing(null);
      toast.success("Unidade cadastrada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar a unidade.")),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => atualizarUnidade(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unidades_medida"] });
      setShowForm(false);
      setEditing(null);
      toast.success("Unidade atualizada!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar a unidade.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (ids) => excluirUnidades(ids, { unidades }),
    onSuccess: ({ excluidas, bloqueadas }) => {
      queryClient.invalidateQueries({ queryKey: ["unidades_medida"] });
      chrome.setSelectedIds([]);
      if (excluidas.length) toast.success(excluidas.length === 1 ? "Unidade excluída!" : `${excluidas.length} unidades excluídas!`);
      if (bloqueadas.length) {
        toast.error(
          bloqueadas.length === 1
            ? "1 unidade não pôde ser excluída: existem registros vinculados."
            : `${bloqueadas.length} unidades não puderam ser excluídas: existem registros vinculados.`,
        );
      }
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível excluir.")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const ne = {};
    if (!formData.sigla?.trim()) ne.sigla = true;
    if (!formData.descricao?.trim()) ne.descricao = true;
    setErrors(ne);
    if (Object.keys(ne).length > 0) {
      toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
      return;
    }
    const data = {
      sigla: formData.sigla.toUpperCase(),
      descricao: formData.descricao.toUpperCase(),
      ativo: formData.ativo,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  };
  const handleEdit = (item) => {
    setEditing(item);
    setFormData({ sigla: item.sigla || "", descricao: item.descricao || "", ativo: item.ativo !== false });
    setShowForm(true);
  };
  const handleRequestDelete = (id) => {
    const ids = Array.isArray(id) ? id : [id];
    setDeleteState({ open: true, ids });
  };
  const handleConfirmDelete = () => {
    deleteMutation.mutate(deleteState.ids);
    setDeleteState({ open: false, ids: [] });
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setFormData({ sigla: "", descricao: "", ativo: true });
    setErrors({});
    chrome.setViewMode("table");
  };

  const openNewForm = () => {
    setEditing(null);
    setFormData({ sigla: "", descricao: "", ativo: true });
    setErrors({});
    setShowForm(true);
  };

  const handleEditSelected = useCallback(() => {
    const item = unidades.find((u) => u.id === chrome.selectedIds[0]);
    if (item) handleEdit(item);
  }, [unidades, chrome.selectedIds]);

  const handleDeleteSelected = () => {
    if (!chrome.selectedIds.length) return;
    handleRequestDelete(chrome.selectedIds);
  };

  const onViewModeChange = useCallback(
    (mode) => {
      chrome.handleViewModeChange(mode, { onOpenRecord: () => handleEditSelected() });
    },
    [chrome, handleEditSelected],
  );

  const filtradosCount = useMemo(() => {
    const q = chrome.appliedSearch.trim().toLowerCase();
    if (!q) return unidades.length;
    return unidades.filter((u) => {
      const hay = [u.sigla, u.descricao, u.numero_unidade].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [unidades, chrome.appliedSearch]);

  useEffect(() => {
    chrome.setSelectedIds((prev) => prev.filter((id) => unidades.some((c) => c.id === id)));
  }, [unidades, chrome.setSelectedIds]);

  const detailTitle = editing?.id ? "Editar unidade de medida" : "Nova unidade de medida";

  return (
    <>
      <CadastroWorkspace
        mode={showForm ? "detail" : "list"}
        title={showForm ? detailTitle : "Unidades de medida"}
        subtitle={
          showForm
            ? "Preencha os dados e salve para voltar à lista."
            : "Siglas e descrições usadas nos cadastros de produto."
        }
        onBack={showForm ? closeForm : undefined}
        toolbar={null}
      >
        <AnimatePresence mode="wait">
          {showForm ? (
            <motion.div key="form" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
              <Card className="shadow-sm border-slate-300">
                <CardContent className="p-3 pt-2">
                  <form onSubmit={handleSubmit} className="space-y-0.5">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                      <FL label="Sigla" required error={errors.sigla} dataField="sigla">
                        <Input
                          value={formData.sigla}
                          onChange={(e) => {
                            setErrors((p) => ({ ...p, sigla: false }));
                            setFormData((p) => ({ ...p, sigla: e.target.value }));
                          }}
                          placeholder="UN, KG, L"
                          className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                          style={{ textTransform: "uppercase" }}
                        />
                      </FL>
                      <FL label="Descrição" required error={errors.descricao} dataField="descricao" className="col-span-2">
                        <Input
                          value={formData.descricao}
                          onChange={(e) => {
                            setErrors((p) => ({ ...p, descricao: false }));
                            setFormData((p) => ({ ...p, descricao: e.target.value }));
                          }}
                          placeholder="UNIDADE, QUILOGRAMA"
                          className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                          style={{ textTransform: "uppercase" }}
                        />
                      </FL>
                    </div>
                    <div className="flex flex-wrap gap-6 py-1 px-1">
                      <div className="flex items-center gap-2">
                        <Checkbox id="um_ativo" checked={formData.ativo} onCheckedChange={(v) => setFormData((p) => ({ ...p, ativo: v }))} />
                        <label htmlFor="um_ativo" className="text-xs text-slate-700 cursor-pointer">
                          Ativo
                        </label>
                      </div>
                    </div>
                    <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
                      <Button type="button" variant="outline" onClick={closeForm} size="sm" className="h-7 text-xs px-3">
                        Cancelar
                      </Button>
                      <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">
                        {editing ? "Atualizar" : "Salvar"}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <CadastroListaChrome
              key="chrome"
              selectedCount={chrome.selectedIds.length}
              listados={unidades.length}
              filtrados={filtradosCount}
              totais={unidades.length}
              onNew={openNewForm}
              onEdit={handleEditSelected}
              onDelete={handleDeleteSelected}
              searchValue={chrome.searchInput}
              onSearchChange={chrome.setSearchInput}
              onSearchApply={chrome.applySearch}
              searchActive={chrome.searchActive}
              searchPlaceholder="Buscar unidades…"
              onConfigureColumns={() => setShowConfigColunas(true)}
              onClearFilters={chrome.clearFilters}
              filtersActive={chrome.filtersActive}
              viewMode={chrome.viewMode}
              onViewModeChange={onViewModeChange}
            >
              <div className="overflow-hidden">
                <CadastroBase1Grade
                  rows={unidades}
                  columns={COLUNAS}
                  storageKey="colunas_unidades_medida"
                  droppableId="colunas-unidades-medida"
                  getFieldValue={getFieldValue}
                  renderCell={renderCell}
                  defaultSortKey="sigla"
                  emptyText="Nenhuma unidade encontrada"
                  isLoading={isLoading}
                  onOpen={handleEdit}
                  showConfigColunas={showConfigColunas}
                  setShowConfigColunas={setShowConfigColunas}
                  searchQuery={chrome.appliedSearch}
                  resetFiltersKey={chrome.resetFiltersKey}
                  onSelectionChange={chrome.onSelectionChange}
                  onFiltersActiveChange={chrome.setFiltersActive}
                  matchesSearch={(item, q) => {
                    const hay = [item.sigla, item.descricao, item.numero_unidade].filter(Boolean).join(" ").toLowerCase();
                    return hay.includes(q);
                  }}
                />
              </div>
            </CadastroListaChrome>
          )}
        </AnimatePresence>
      </CadastroWorkspace>
      <ConfirmDialog
        open={deleteState.open}
        onOpenChange={(open) => setDeleteState((prev) => ({ ...prev, open }))}
        title="Confirmar exclusão"
        description={
          deleteState.ids.length > 1
            ? `Deseja excluir ${deleteState.ids.length} unidades selecionadas?`
            : "Deseja excluir esta unidade?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

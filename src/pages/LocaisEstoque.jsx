import React, { useCallback, useState, useEffect, useMemo } from "react";
import {
  listarLocais,
  criarLocal,
  atualizarLocal,
  numerarLocaisSemNumero,
  excluirLocais,
} from "@/services/localEstoqueService";
import { getApiErrorMessage } from "@/apis/_core/ApiError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left", width: 220 },
  { id: "capacidade", label: "Capacidade", default: true, sortable: true, align: "left", width: 150 },
  { id: "descricao", label: "Descrição", default: true, sortable: false, align: "left", width: 250 },
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
  if (colId === "numero") return item.numero_local || "";
  if (colId === "nome") return item.nome || "";
  if (colId === "capacidade") return item.capacidade || "";
  if (colId === "descricao") return item.descricao || "";
  if (colId === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
  return "";
}

/** @param {object} item @param {string} colId */
function renderCell(item, colId) {
  if (colId === "numero") return item.numero_local || "–";
  if (colId === "nome") {
    return (
      <span className={`uppercase font-medium ${item.ativo === false ? "text-slate-400 line-through" : ""}`}>
        {item.nome || "–"}
      </span>
    );
  }
  if (colId === "capacidade") return item.capacidade || "–";
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

export default function LocaisEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({ nome: "", descricao: "", capacidade: "", ativo: true });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [errors, setErrors] = useState({});
  const chrome = useCadastroListaChromeState();
  const queryClient = useQueryClient();
  const { data: locais = [], isLoading } = useQuery({
    queryKey: ["locais_estoque"],
    queryFn: () => listarLocais(),
    initialData: [],
  });

  useEffect(() => {
    const numerar = async () => {
      const { numerados } = await numerarLocaisSemNumero(locais);
      if (numerados.length) queryClient.invalidateQueries({ queryKey: ["locais_estoque"] });
    };
    if (locais.length > 0) numerar();
  }, [locais, queryClient]);

  const createMutation = useMutation({
    mutationFn: (data) => criarLocal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locais_estoque"] });
      setShowForm(false);
      setEditing(null);
      toast.success("Local cadastrado!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar o local.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => atualizarLocal({ id, dados: data, locais }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locais_estoque"] });
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          ["pontos", "pontos-suplementacao-form", "mapa-pontos", "mapa-pontos-supl", "pontos-suplementacao"].includes(
            q.queryKey[0],
          ),
      });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      setShowForm(false);
      setEditing(null);
      toast.success("Local atualizado!");
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível salvar o local.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (ids) => excluirLocais(ids, { locais }),
    onSuccess: ({ excluidos, bloqueados }) => {
      queryClient.invalidateQueries({ queryKey: ["locais_estoque"] });
      chrome.setSelectedIds([]);
      if (excluidos.length) toast.success(excluidos.length === 1 ? "Local excluído!" : `${excluidos.length} locais excluídos!`);
      if (bloqueados.length) {
        toast.error(
          bloqueados.length === 1
            ? "1 local não pôde ser excluído: existem registros vinculados."
            : `${bloqueados.length} locais não puderam ser excluídos: existem registros vinculados.`,
        );
      }
    },
    onError: (err) => toast.error(getApiErrorMessage(err, "Não foi possível excluir.")),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const ne = {};
    if (!formData.nome?.trim()) ne.nome = true;
    setErrors(ne);
    if (Object.keys(ne).length > 0) {
      toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
      return;
    }
    const data = {
      nome: formData.nome.toUpperCase(),
      descricao: formData.descricao?.toUpperCase() || undefined,
      capacidade: formData.capacidade?.toUpperCase() || undefined,
      ativo: formData.ativo,
    };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  };
  const handleEdit = (item) => {
    setEditing(item);
    setFormData({
      nome: item.nome || "",
      descricao: item.descricao || "",
      capacidade: item.capacidade || "",
      ativo: item.ativo !== false,
    });
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
    setFormData({ nome: "", descricao: "", capacidade: "", ativo: true });
    setErrors({});
    chrome.setViewMode("table");
  };

  const openNewForm = () => {
    setEditing(null);
    setFormData({ nome: "", descricao: "", capacidade: "", ativo: true });
    setErrors({});
    setShowForm(true);
  };

  const handleEditSelected = useCallback(() => {
    const item = locais.find((l) => l.id === chrome.selectedIds[0]);
    if (item) handleEdit(item);
  }, [locais, chrome.selectedIds]);

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
    if (!q) return locais.length;
    return locais.filter((l) => {
      const hay = [l.nome, l.descricao, l.capacidade, l.numero_local].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    }).length;
  }, [locais, chrome.appliedSearch]);

  useEffect(() => {
    chrome.setSelectedIds((prev) => prev.filter((id) => locais.some((c) => c.id === id)));
  }, [locais, chrome.setSelectedIds]);

  const detailTitle = editing?.id ? "Editar local de estoque" : "Novo local de estoque";

  return (
    <>
      <CadastroWorkspace
        mode={showForm ? "detail" : "list"}
        title={showForm ? detailTitle : "Locais de estoque"}
        subtitle={
          showForm
            ? "Preencha os dados e salve para voltar à lista."
            : "Depósitos e pontos de armazenamento vinculados ao estoque."
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
                      <FL label="Nome" required error={errors.nome} dataField="nome">
                        <Input
                          value={formData.nome}
                          onChange={(e) => {
                            setErrors((p) => ({ ...p, nome: false }));
                            setFormData((p) => ({ ...p, nome: e.target.value }));
                          }}
                          placeholder="GALPÃO 1"
                          className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                          style={{ textTransform: "uppercase" }}
                        />
                      </FL>
                      <FL label="Capacidade" dataField="capacidade">
                        <Input
                          value={formData.capacidade}
                          onChange={(e) => setFormData((p) => ({ ...p, capacidade: e.target.value }))}
                          placeholder="500 SACAS"
                          className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                          style={{ textTransform: "uppercase" }}
                        />
                      </FL>
                      <FL label="Descrição" dataField="descricao">
                        <Textarea
                          value={formData.descricao}
                          onChange={(e) => setFormData((p) => ({ ...p, descricao: e.target.value }))}
                          placeholder="DESCRIÇÃO"
                          className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent"
                          style={{ textTransform: "uppercase" }}
                          rows={2}
                        />
                      </FL>
                    </div>
                    <div className="flex flex-wrap gap-6 py-1 px-1">
                      <div className="flex items-center gap-2">
                        <Checkbox id="le_ativo" checked={formData.ativo} onCheckedChange={(v) => setFormData((p) => ({ ...p, ativo: v }))} />
                        <label htmlFor="le_ativo" className="text-xs text-slate-700 cursor-pointer">
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
              listados={locais.length}
              filtrados={filtradosCount}
              totais={locais.length}
              onNew={openNewForm}
              onEdit={handleEditSelected}
              onDelete={handleDeleteSelected}
              searchValue={chrome.searchInput}
              onSearchChange={chrome.setSearchInput}
              onSearchApply={chrome.applySearch}
              searchActive={chrome.searchActive}
              searchPlaceholder="Buscar locais…"
              onConfigureColumns={() => setShowConfigColunas(true)}
              onClearFilters={chrome.clearFilters}
              filtersActive={chrome.filtersActive}
              viewMode={chrome.viewMode}
              onViewModeChange={onViewModeChange}
            >
              <div className="overflow-hidden">
                <CadastroBase1Grade
                  rows={locais}
                  columns={COLUNAS}
                  storageKey="colunas_locais_estoque"
                  droppableId="colunas-locais-estoque"
                  getFieldValue={getFieldValue}
                  renderCell={renderCell}
                  defaultSortKey="nome"
                  emptyText="Nenhum local encontrado"
                  isLoading={isLoading}
                  onOpen={handleEdit}
                  showConfigColunas={showConfigColunas}
                  setShowConfigColunas={setShowConfigColunas}
                  searchQuery={chrome.appliedSearch}
                  resetFiltersKey={chrome.resetFiltersKey}
                  onSelectionChange={chrome.onSelectionChange}
                  onFiltersActiveChange={chrome.setFiltersActive}
                  matchesSearch={(item, q) => {
                    const hay = [item.nome, item.descricao, item.capacidade, item.numero_local].filter(Boolean).join(" ").toLowerCase();
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
            ? `Deseja excluir ${deleteState.ids.length} locais selecionados?`
            : "Deseja excluir este local?"
        }
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}

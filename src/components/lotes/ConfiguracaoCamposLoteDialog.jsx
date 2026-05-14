import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ToggleSwitch from "@/components/common/ToggleSwitch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import loteRepository from "@/core/repositories/loteRepository";
import GuidedRelationConfig from "./GuidedRelationConfig";
import ManualSelectOptionsConfig from "./ManualSelectOptionsConfig";
import VisualCalculationBuilder from "./VisualCalculationBuilder";
import DecimalConfig from "./DecimalConfig";
import LegacyRecordToolbar from "./LegacyRecordToolbar.jsx";
import SankhyaListToolbar from "@/components/common/SankhyaListToolbar";
import { montarCamposDisponiveis, montarFormulaVisual } from "./camposConfigOptions";

const TIPOS_CAMPO = [
{ value: "text", label: "Texto" },
{ value: "textarea", label: "Observação" },
{ value: "number", label: "Número" },
{ value: "date", label: "Data" },
{ value: "datetime", label: "Data e Hora" },
{ value: "time", label: "Hora" },
{ value: "select", label: "Lista de seleção" },
{ value: "relation", label: "Relação com cadastro" },
{ value: "calculado", label: "Calculado" }];


const toSnakeCase = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
const toTitleCase = (value) => String(value || "").toLowerCase().replace(/(^|\s)([a-záàâãéèêíïóôõöúçñ])/g, (match) => match.toUpperCase());

const initialForm = {
  label: "",
  field_name: "",
  placeholder: "",
  descricao: "",
  tipo: "text",
  col_span: 12,
  largura_coluna: 160,
  ordem_tabela: 999,
  obrigatorio: false,
  read_only: false,
  visivel_form: true,
  visivel_tabela: true,
  visivel_relatorio: true,
  ordenavel: true,
  filtravel: true,
  alinhamento: "left",
  agregacao_tipo: "none",
  agregacao_campo_base: "",
  options_source_entity: "",
  options_text: "",
  options_label_field: "nome",
  options_value_field: "id",
  relation_entity: "",
  relation_display_field: "nome",
  formula: "",
  calculation_builder: { items: [{ field: "", operator: "*" }, { field: "", operator: "*" }] },
  campos_dependentes: [],
  usar_decimal: false,
  decimal_places: 2
};

export default function ConfiguracaoCamposLoteDialog({ open, onOpenChange, inline = false }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedCampoIds, setSelectedCampoIds] = useState([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const { data: campos = [], isLoading } = useQuery({
    queryKey: ["lote-campos-personalizados"],
    queryFn: () => loteRepository.listCamposPersonalizados(),
    enabled: open,
    initialData: []
  });

  const camposCalculo = useMemo(() => montarCamposDisponiveis(campos, editingId), [campos, editingId]);
  const selectedCampoId = selectedCampoIds[0] || null;
  const selectedCampo = campos.find((campo) => (campo.id || campo.field_id) === selectedCampoId) || campos[0] || null;
  const selectedIndex = Math.max(0, campos.findIndex((campo) => (campo.id || campo.field_id) === (selectedCampo?.id || selectedCampo?.field_id)));
  const calculationItems = form.calculation_builder?.items || [];
  const calculationFields = calculationItems.map((item) => item.field).filter(Boolean);
  const hasInvalidCalculation = form.tipo === "calculado" && (calculationItems.length < 2 || calculationItems.some((item) => !item.field) || new Set(calculationFields).size !== calculationFields.length);
  const isReadOnly = !!editingId && !isDuplicating && !editMode;
  const isNativeSelect = !!form.metadata?.native_select;

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      return editingId ? loteRepository.updateCampoPersonalizado(editingId, payload) : loteRepository.createCampoPersonalizado(payload);
    },
    onSuccess: async (saved) => {
      const wasEditing = !!editingId;
      const result = await queryClient.invalidateQueries({ queryKey: ["lote-campos-personalizados"] });
      const updated = await loteRepository.listCamposPersonalizados();
      const savedId = saved?.id || editingId;
      const target = updated.find((c) => c.id === savedId) || saved;
      if (target) loadCampoForm(target);
      toast.success(wasEditing ? "Campo atualizado." : "Campo criado.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (campo) => loteRepository.deleteCampoPersonalizado(campo),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lote-campos-personalizados"] });
      toast.success("Campo excluído.");
    },
    onError: (error) => toast.error(error.message || "Não foi possível excluir o campo.")
  });

  const buildPayload = () => {
    const calculationItems = form.calculation_builder?.items || [];
    const formula = form.tipo === "calculado" ? montarFormulaVisual(calculationItems) : "";
    const deps = calculationItems.map((item) => item.field).filter(Boolean);
    const protectedOptions = form.metadata?.protected_options || [];
    const manualOptions = form.tipo === "select" ? [...new Set([...protectedOptions, ...String(form.options_text || "").split("\n").map((item) => item.trim().toUpperCase()).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })).map((item) => ({ value: item, label: item, protected: protectedOptions.includes(item) })) : [];

    return {
      ...form,
      field_name: editingId ? form.field_name : toSnakeCase(form.label),
      metadata: form.metadata || {},
      col_span: 12,
      largura_coluna: 160,
      ordem_tabela: 999,
      read_only: form.tipo === "calculado",
      ordenavel: true,
      filtravel: !["textarea"].includes(form.tipo),
      alinhamento: ["number", "calculado"].includes(form.tipo) ? "right" : "left",
      options: manualOptions,
      options_text: form.tipo === "select" ? manualOptions.map((option) => option.label).join("\n") : "",
      options_source: "",
      agregacao_tipo: form.agregacao_tipo === "none" ? undefined : form.agregacao_tipo,
      agregacao_campo_base: "",
      formula,
      calculation_builder: { items: calculationItems },
      campos_dependentes: deps,
      dependencias: deps,
      decimal_places: Math.min(6, Math.max(0, Number(form.decimal_places) || 0)),
      usar_decimal: !!form.usar_decimal,
      visivel_form: true,
      label: toTitleCase(form.label),
      placeholder: String(form.placeholder || "").toUpperCase(),
      descricao: String(form.descricao || "").toUpperCase()
    };
  };

  const resetForm = () => {
    setForm(initialForm);
    setEditingId(null);
    setIsDirty(false);
    setIsDuplicating(false);
    setEditMode(false);
    setShowForm(false);
  };

  const handleToggleView = () => {
    if (showForm) {
      resetForm();
      return;
    }
    if (selectedCampo && selectedCampoIds.length <= 1) handleEdit(selectedCampo);
  };

  const handleRowSelect = (campo, event) => {
    const id = campo.id || campo.field_id;
    setSelectedCampoIds((prev) => {
      if (event?.ctrlKey || event?.metaKey) {
        return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
      }
      return [id];
    });
  };

  const navigateCampo = (index) => {
    const nextIndex = Math.min(Math.max(index, 0), Math.max(campos.length - 1, 0));
    const campo = campos[nextIndex];
    if (!campo) return;
    setSelectedCampoIds([campo.id || campo.field_id]);
    handleEdit(campo);
  };

  const handleNew = () => {
    setForm(initialForm);
    setEditingId(null);
    setSelectedCampoIds([]);
    setIsDirty(true);
    setIsDuplicating(false);
    setEditMode(true);
    setShowForm(true);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isReadOnly) return;
    const labelTrim = form.label.trim().toUpperCase();
    const fieldName = editingId ? form.field_name : toSnakeCase(labelTrim);
    if (!labelTrim || !fieldName) return toast.error("Informe o nome do campo.");
    if (isNativeSelect) {
      const protectedOptions = form.metadata?.protected_options || [];
      const currentOptions = String(form.options_text || "").split("\n").map((item) => item.trim().toUpperCase()).filter(Boolean);
      const missing = protectedOptions.find((option) => !currentOptions.includes(option));
      if (missing) return toast.error(`A opção padrão "${missing}" não pode ser removida.`);
    }
    const duplicate = campos.find((c) => c.id !== editingId && (
    String(c.label || "").trim().toUpperCase() === labelTrim ||
    String(c.field_name || "").toLowerCase() === fieldName.toLowerCase())
    );
    if (duplicate) return toast.error(`Já existe um campo com o nome "${duplicate.label}".`);
    if (form.tipo === "calculado" && hasInvalidCalculation) return toast.error("Complete o cálculo com campos diferentes.");
    if (form.tipo === "relation" && !form.relation_entity) return toast.error("Selecione o cadastro relacionado.");
    if (form.tipo === "select" && String(form.options_text || "").split("\n").map((item) => item.trim()).filter(Boolean).length === 0) return toast.error("Informe pelo menos uma opção da lista.");
    saveMutation.mutate();
  };

  const updateForm = (field, value) => {
    if (isReadOnly) return;
    setIsDirty(true);
    const upperFields = ["placeholder", "descricao"];
    const finalValue = upperFields.includes(field) && typeof value === "string" ? value.toUpperCase() : value;
    setForm((prev) => {
      const next = { ...prev, [field]: finalValue, ...(field === "label" && !editingId ? { field_name: toSnakeCase(finalValue) } : {}) };
      if (field === "tipo") {
        next.agregacao_tipo = "none";
        next.usar_decimal = ["number", "calculado"].includes(value);
        next.read_only = value === "calculado";
        next.visivel_form = value !== "calculado";
        if (value !== "select") {
          next.options = [];
          next.options_text = "";
        }
        next.options_source_entity = "";
        next.options_label_field = "nome";
        next.options_value_field = "id";
        if (value !== "relation") {
          next.relation_entity = "";
          next.relation_display_field = "nome";
        }
        if (value !== "calculado") {
          next.calculation_builder = initialForm.calculation_builder;
          next.formula = "";
          next.campos_dependentes = [];
        }
      }
      return next;
    });
  };

  const loadCampoForm = (campo) => {
    const items = campo.calculation_builder?.items || (campo.campos_dependentes || campo.dependencias || []).map((field, index) => ({ field, operator: index === 0 ? "*" : "*" }));
    setEditingId(campo.id || campo.field_id);
    setSelectedCampoIds([campo.id || campo.field_id]);
    setIsDirty(false);
    setIsDuplicating(false);
    setEditMode(false);
    setShowForm(true);
    setForm({
      ...initialForm,
      ...campo,
      options_text: campo.options_text || (campo.options || []).map((option) => option.label || option.value || option).join("\n"),
      agregacao_tipo: campo.agregacao_tipo || campo.agregacao || "none",
      calculation_builder: { items: items.length ? items : initialForm.calculation_builder.items },
      usar_decimal: !!campo.usar_decimal,
      decimal_places: campo.decimal_places ?? 2
    });
  };

  const handleEdit = (campo) => {
    loadCampoForm(campo);
  };

  const handleDiscard = () => {
    // Editando registro existente: reverte para visualização do mesmo registro
    if (editingId && !isDuplicating) {
      const original = campos.find((campo) => campo.id === editingId);
      if (original) {
        loadCampoForm(original);
        return;
      }
    }
    // Novo/Duplicação: se houver registro selecionado anterior, abre em visualização; senão volta para lista
    const previousId = selectedCampoIds[0];
    const previous = previousId ? campos.find((c) => (c.id || c.field_id) === previousId) : null;
    if (previous) {
      loadCampoForm(previous);
      return;
    }
    if (campos.length > 0) {
      loadCampoForm(campos[0]);
      return;
    }
    resetForm();
  };

  const handleDelete = (campo) => {
    if (campo?.metadata?.native_select) return toast.error("Esta lista é nativa do sistema e não pode ser excluída.");
    if (!window.confirm(`Excluir o campo "${campo.label}"? Esta ação não poderá ser desfeita.`)) return;
    deleteMutation.mutate(campo);
  };

  const handleDeleteSelected = () => {
    const selecionados = campos.filter((campo) => selectedCampoIds.includes(campo.id || campo.field_id));
    if (selecionados.length === 0) return;
    if (!window.confirm(selecionados.length === 1 ? `Excluir o campo "${selecionados[0].label}"?` : `Excluir ${selecionados.length} campos selecionados?`)) return;
    selecionados.forEach((campo) => deleteMutation.mutate(campo));
    setSelectedCampoIds([]);
  };

  const handleDeleteCurrent = () => {
    if (!selectedCampo) return;
    handleDelete(selectedCampo);
    resetForm();
  };

  const handleDuplicateCurrent = () => {
    if (!selectedCampo) return;
    if (selectedCampo?.metadata?.native_select) return toast.error("Esta lista é nativa do sistema e não pode ser duplicada.");
    const { id, field_id, created_date, updated_date, created_by, ...copy } = selectedCampo;
    setForm({
      ...initialForm,
      ...copy,
      options_text: copy.options_text || (copy.options || []).map((option) => option.label || option.value || option).join("\n"),
      label: `${selectedCampo.label || "Campo"} - Cópia`,
      field_name: "",
      agregacao_tipo: selectedCampo.agregacao_tipo || selectedCampo.agregacao || "none",
      usar_decimal: !!selectedCampo.usar_decimal,
      decimal_places: selectedCampo.decimal_places ?? 2
    });
    setEditingId(null);
    setSelectedCampoIds([]);
    setIsDirty(true);
    setIsDuplicating(true);
    setEditMode(true);
    setShowForm(true);
  };

  const operationLabel = isDuplicating ? "NOVO REGISTRO DUPLICADO" : editingId ? editMode ? "EDIÇÃO DE REGISTRO" : "VISUALIZAÇÃO DE REGISTRO" : "NOVO REGISTRO";

  const content =
  <div className="w-full h-full overflow-hidden flex flex-col bg-white">
      {!inline &&
    <DialogHeader className="sr-only">
          <DialogTitle>Configuração de campos personalizados</DialogTitle>
        </DialogHeader>
    }

        {showForm ?
    <form onSubmit={handleSubmit} className="bg-white flex-1 min-h-0 flex flex-col overflow-hidden">
            <LegacyRecordToolbar
        title={form.label || (editingId ? "EDITAR CAMPO" : "NOVO CAMPO")}
        badgeLabel="CAMPO PERSONALIZADO"
        operationLabel={operationLabel}
        showSaveActions={editMode}
        showEditAction={isReadOnly}
        showDeleteDuplicateActions={!!editingId && !editMode && !isDuplicating && !isNativeSelect}
        onSave={() => handleSubmit({ preventDefault: () => {} })}
        onCancel={handleDiscard}
        onEditRecord={() => setEditMode(true)}
        onToggleView={handleToggleView}
        onBack={() => onOpenChange(false)}
        onNew={handleNew}
        total={campos.length}
        currentIndex={selectedIndex}
        onFirst={() => navigateCampo(0)}
        onPrevious={() => navigateCampo(selectedIndex - 1)}
        onNext={() => navigateCampo(selectedIndex + 1)}
        onLast={() => navigateCampo(campos.length - 1)}
        onDelete={handleDeleteCurrent}
        onDuplicate={handleDuplicateCurrent}
        onSettingsClick={() => {}}
        showUtilityActions={false} />
          

            <fieldset className={`flex-1 overflow-y-auto ${isReadOnly ? "pointer-events-none [&_input]:cursor-default [&_textarea]:cursor-default [&_button]:cursor-default" : ""}`}>
              <div className="px-4 md:px-8 py-2 space-y-1 max-w-[780px]">
              <Field label="Nome do campo" required><Input value={form.label} onChange={(e) => updateForm("label", e.target.value)} readOnly={isNativeSelect} placeholder="EX: PESO TOTAL" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" /></Field>
              <Field label="Tipo"><AutocompleteGenerico items={TIPOS_CAMPO.map((tipo) => ({ ...tipo, id: tipo.value }))} value={form.tipo} onChange={(value) => updateForm("tipo", value)} placeholder="BUSCAR TIPO..." displayField="label" searchFields={["label", "value"]} disabled={isNativeSelect} readOnly={isNativeSelect} className="w-full" inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1 uppercase" /></Field>
              <Field label="Texto de ajuda"><Input value={form.placeholder} onChange={(e) => updateForm("placeholder", e.target.value)} placeholder="TEXTO MOSTRADO NO CAMPO" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" /></Field>
              <Field label="Descrição"><Input value={form.descricao} onChange={(e) => updateForm("descricao", e.target.value)} placeholder="EXPLICAÇÃO OPCIONAL" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" /></Field>

              {form.tipo === "select" && <ManualSelectOptionsConfig form={form} updateForm={updateForm} />}
              {form.tipo === "relation" && <GuidedRelationConfig form={form} updateForm={updateForm} mode="relation" />}
              {form.tipo === "calculado" && <VisualCalculationBuilder value={form.calculation_builder?.items || []} fields={camposCalculo} onChange={(items) => updateForm("calculation_builder", { items })} />}
              <DecimalConfig form={form} updateForm={updateForm} />
              <Field label="Prévia" wide>
                <div className="px-2 py-1 text-xs text-slate-700 uppercase bg-slate-50 min-h-[48px]">
                  {form.label || "Nome do campo"}: {form.tipo === "calculado" ? montarFormulaVisual(form.calculation_builder?.items || []) || "Calculado automaticamente" : form.placeholder || "Valor do campo"}
                </div>
              </Field>
              <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1 pt-1">
                <span className="text-[12px] text-slate-600 text-right leading-none">Exibir em:</span>
                <div className="flex items-center gap-4">
                  {[["obrigatorio", "Obrigatório"], ["visivel_tabela", "Tabela"], ["visivel_relatorio", "Relatório"]].map(([field, label]) =>
              <button key={field} type="button" onClick={() => updateForm(field, !form[field])} className="h-[22px] flex items-center gap-1.5 bg-transparent">
                      <span className="text-[12px] text-slate-600">{label}:</span>
                      <ToggleSwitch checked={!!form[field]} onChange={(checked) => updateForm(field, checked)} disabled={isReadOnly} />
                    </button>
              )}
                </div>
              </div>
              </div>
            </fieldset>

            {editMode &&
      <div className="flex justify-end gap-1 p-2 bg-slate-50 border-t border-slate-200 hidden">
                <Button type="button" variant="outline" onClick={handleDiscard} size="sm" className="h-7 text-xs px-3">Descartar</Button>
                <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{isDuplicating ? "Salvar" : editingId ? "Atualizar" : "Salvar"}</Button>
              </div>
      }
          </form> :

    <div className="flex-1 min-h-0 overflow-hidden bg-white flex flex-col">
            <SankhyaListToolbar
        viewMode="table"
        total={campos.length}
        currentIndex={selectedIndex}
        onNew={handleNew}
        onToggleView={handleToggleView}
        onBack={() => onOpenChange(false)}
        toggleViewDisabled={!selectedCampo || selectedCampoIds.length > 1}
        onDelete={handleDeleteSelected}
        onSettingsClick={() => {}}
        onAttachClick={() => {}}
        attachDisabled
        selectedCount={selectedCampoIds.length}
        title="Campos Personalizados"
        recordLabel=""
        showUtilityActions={false}
        showSearch={false} />
            <div className="overflow-auto flex-1 min-h-0">
              <Table className="w-full min-w-[760px] border-separate border-spacing-0 table-fixed">
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white">
                    <TableHead className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 text-xs font-medium text-left border-r border-b border-gray-300 bg-white whitespace-nowrap h-7 w-[260px]">Campo</TableHead>
                    <TableHead className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 text-xs font-medium text-left border-r border-b border-gray-300 bg-white whitespace-nowrap h-7 w-[150px]">Tipo</TableHead>
                    <TableHead className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 text-xs font-medium text-left border-r border-b border-gray-300 bg-white whitespace-nowrap h-7">Uso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ?
            <TableRow><TableCell colSpan={3} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Carregando...</TableCell></TableRow> :
            campos.length === 0 ?
            <TableRow><TableCell colSpan={3} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhum campo criado.</TableCell></TableRow> :
            campos.map((campo, index) =>
            <TableRow
              key={campo.id || campo.field_id}
              className={`${selectedCampoIds.includes(campo.id || campo.field_id) ? "bg-green-500 hover:bg-green-600 text-white" : index % 2 === 0 ? "bg-gray-100 hover:bg-gray-200" : "bg-white hover:bg-gray-100"} transition-colors border-b cursor-pointer select-none`}
              onClick={(event) => handleRowSelect(campo, event)}
              onDoubleClick={() => selectedCampoIds.length <= 1 && handleEdit(campo)}>
                      <TableCell className={`h-7 px-2 py-0 text-xs leading-7 align-middle border-r border-b whitespace-nowrap overflow-hidden text-ellipsis font-medium ${selectedCampoIds.includes(campo.id || campo.field_id) ? "text-white border-green-600" : "text-gray-700 border-gray-300"}`}>{campo.label}</TableCell>
                      <TableCell className={`h-7 px-2 py-0 text-xs leading-7 align-middle border-r border-b whitespace-nowrap overflow-hidden text-ellipsis ${selectedCampoIds.includes(campo.id || campo.field_id) ? "text-white border-green-600" : "text-gray-700 border-gray-300"}`}>{TIPOS_CAMPO.find((tipo) => tipo.value === campo.tipo)?.label || campo.tipo}</TableCell>
                      <TableCell className={`h-7 px-2 py-0 text-xs align-middle border-r border-b whitespace-nowrap overflow-hidden ${selectedCampoIds.includes(campo.id || campo.field_id) ? "text-white border-green-600" : "text-gray-700 border-gray-300"}`}>
                        <div className="h-full flex items-center gap-1 overflow-hidden">
                          {campo.metadata?.native_select && <Badge variant="secondary" className="text-[10px]">Nativa</Badge>}
                          {campo.visivel_form && <Badge variant="outline" className="text-[10px] bg-white/90 text-slate-700">Form</Badge>}
                          {campo.visivel_tabela && <Badge variant="outline" className="text-[10px] bg-white/90 text-slate-700">Tabela</Badge>}
                          {(campo.options_source_entity || campo.relation_entity) && <Badge variant="secondary" className="text-[10px]">Vínculo</Badge>}
                          {(campo.agregacao_tipo || campo.agregacao) && <Badge variant="secondary" className="text-[10px]">Total</Badge>}
                          {campo.usar_decimal && <Badge variant="secondary" className="text-[10px]">{campo.decimal_places ?? 2} dec.</Badge>}
                        </div>
                      </TableCell>
                    </TableRow>
            )}
                </TableBody>
              </Table>
            </div>
          </div>
    }
    </div>;


  if (inline) return open ? content : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-screen !max-w-none !h-screen !max-h-none overflow-hidden flex flex-col !p-0 !rounded-none">
        {content}
      </DialogContent>
    </Dialog>);

}

function Field({ label, children, className = "", required = false, wide = false, compact = false, medium = false }) {
  return (
    <div className={`grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1 ${wide ? "md:col-span-2" : ""} ${className}`}>
      <label className="text-[12px] text-slate-600 text-right leading-none">
        {label}:{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className={`${wide ? 'min-h-6' : 'h-6'} ${medium ? 'w-64 max-w-full' : compact ? 'w-44 max-w-full' : 'w-full'} border border-slate-300 bg-white focus-within:border-green-500 transition-colors overflow-hidden [&_input]:h-[22px] [&_input]:border-0 [&_input]:rounded-none [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_button]:h-[22px] [&_button]:border-0 [&_button]:rounded-none [&_button]:shadow-none [&_textarea]:min-h-[48px] [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:shadow-none [&_textarea]:focus-visible:ring-0`}>
        {children}
      </div>
    </div>);

}
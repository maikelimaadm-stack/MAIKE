import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import LegacyRecordToolbar from "@/components/lotes/LegacyRecordToolbar.jsx";
import SankhyaListToolbar from "@/components/common/SankhyaListToolbar";
import FilterFieldValueEditor from "@/components/filters/FilterFieldValueEditor";

const OPERATOR_LABELS = {
  contains: "Contém",
  notContains: "Não contém",
  exact: "Exato",
  different: "Diferente",
  startsWith: "Começa com",
  endsWith: "Termina com",
  empty: "Vazio",
  notEmpty: "Não vazio",
  gte: "Maior igual",
  lte: "Menor igual",
  gt: "Maior que",
  lt: "Menor que",
  between: "Entre",
  in: "Dentro da lista",
  notIn: "Fora da lista",
  custom: "Personalizado"
};

const getOperatorOptions = (field) => {
  if (field.type === "number" || field.type === "date") return ["between", "gte", "lte", "gt", "lt", "exact", "different", "empty", "notEmpty", "in", "notIn", "custom"];
  return ["contains", "notContains", "exact", "different", "startsWith", "endsWith", "empty", "notEmpty", "in", "notIn", "custom"];
};

const makeFolderId = () => `pasta_${Date.now()}_${Math.random().toString(16).slice(2)}`;

export default function SankhyaFilterConfigDialog({
  open,
  onOpenChange,
  fields,
  visibleFields,
  setVisibleFields,
  operators,
  setOperators,
  filterFolders,
  setFilterFolders,
  fieldGroups,
  setFieldGroups,
  fieldValues,
  setFieldValues,
  fieldConfigs,
  setFieldConfigs,
  setOpenGroups,
  filterConfigs = [],
  activeConfigId,
  onSelectConfig,
  onSaveConfig,
  onDeleteConfig,
  relationOptions = {},
  inline = false
}) {
  const [showForm, setShowForm] = useState(false);
  const [configName, setConfigName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [draftNew, setDraftNew] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState(filterFolders[0]?.id || "");
  const [selectedFieldId, setSelectedFieldId] = useState("");

  const selectedConfig = filterConfigs.find((config) => config.id === activeConfigId) || filterConfigs[0] || null;
  const selectedIndex = Math.max(0, filterConfigs.findIndex((config) => config.id === activeConfigId));
  const isReadOnly = !!selectedConfig && !draftNew && !isDuplicating && !editMode;

  const loadConfigState = (config) => {
    setVisibleFields(config.visibleFields || []);
    setOperators(config.operators || {});
    setFilterFolders(config.filterFolders || []);
    setFieldGroups(config.fieldGroups || {});
    setFieldValues(config.fieldValues || {});
    setFieldConfigs(config.fieldConfigs || {});
    setOpenGroups(Object.fromEntries((config.filterFolders || []).map((folder) => [folder.id, true])));
  };

  const openConfig = (config) => {
    if (!config) return;
    setDraftNew(false);
    setIsDuplicating(false);
    setEditMode(false);
    onSelectConfig(config.id);
    loadConfigState(config);
    setConfigName(config.name || "");
    setSelectedFolderId((config.filterFolders || [])[0]?.id || "");
    setSelectedFieldId("");
    setShowForm(true);
  };

  const handleNew = () => {
    const folder = { id: makeFolderId(), name: "GERAL" };
    setDraftNew(true);
    setIsDuplicating(false);
    setEditMode(true);
    setConfigName("NOVO FILTRO");
    setVisibleFields([]);
    setOperators({});
    setFilterFolders([folder]);
    setFieldGroups({});
    setFieldValues({});
    setFieldConfigs({});
    setOpenGroups({ [folder.id]: true });
    setSelectedFolderId(folder.id);
    setSelectedFieldId("");
    setShowForm(true);
  };

  const handleSave = () => {
    if (!editMode) return;
    const name = String(configName || "").trim().toUpperCase();
    if (!name) return;
    onSaveConfig(name, draftNew || isDuplicating);
    setDraftNew(false);
    setIsDuplicating(false);
    setEditMode(false);
  };

  const handleDiscard = () => {
    if (selectedConfig && !draftNew && !isDuplicating) {
      openConfig(selectedConfig);
      return;
    }
    if (selectedConfig) {
      openConfig(selectedConfig);
      return;
    }
    setDraftNew(false);
    setIsDuplicating(false);
    setEditMode(false);
    setShowForm(false);
  };

  const handleDuplicateCurrent = () => {
    if (!selectedConfig) return;
    loadConfigState(selectedConfig);
    setConfigName(`${selectedConfig.name || "FILTRO"} - CÓPIA`);
    setDraftNew(false);
    setIsDuplicating(true);
    setEditMode(true);
    setSelectedFieldId("");
    setShowForm(true);
  };

  const operationLabel = isDuplicating ? "NOVO REGISTRO DUPLICADO" : selectedConfig && !draftNew ? editMode ? "EDIÇÃO DE REGISTRO" : "VISUALIZAÇÃO DE REGISTRO" : "NOVO REGISTRO";

  const moveField = (fieldId, direction) => {
    if (isReadOnly) return;
    const index = visibleFields.indexOf(fieldId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= visibleFields.length) return;
    const next = [...visibleFields];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setVisibleFields(next);
  };

  const addFolder = () => {
    if (isReadOnly) return;
    const name = newFolderName.trim().toUpperCase();
    if (!name) return;
    const folder = { id: makeFolderId(), name };
    setFilterFolders([...filterFolders, folder]);
    setOpenGroups((prev) => ({ ...prev, [folder.id]: true }));
    setSelectedFolderId(folder.id);
    setNewFolderName("");
  };

  const renameFolder = (folderId, name) => {
    if (isReadOnly) return;
    setFilterFolders(filterFolders.map((folder) => folder.id === folderId ? { ...folder, name: String(name || "").toUpperCase() } : folder));
  };

  const removeFolder = (folderId) => {
    if (isReadOnly) return;
    if (filterFolders.length <= 1) return;
    const fallbackId = filterFolders.find((folder) => folder.id !== folderId)?.id;
    setFilterFolders(filterFolders.filter((folder) => folder.id !== folderId));
    setFieldGroups(Object.fromEntries(Object.entries(fieldGroups).map(([fieldId, currentFolderId]) => [fieldId, currentFolderId === folderId ? fallbackId : currentFolderId])));
  };

  const moveFolder = (folderId, direction) => {
    if (isReadOnly) return;
    const index = filterFolders.findIndex((folder) => folder.id === folderId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= filterFolders.length) return;
    const next = [...filterFolders];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setFilterFolders(next);
  };

  const availableFields = fields.
  filter((field) => !visibleFields.includes(field.id)).
  sort((a, b) => String(a.label).localeCompare(String(b.label), "pt-BR", { sensitivity: "base" }));

  const selectedFields = visibleFields.
  map((id) => fields.find((field) => field.id === id)).
  filter(Boolean);

  const addSelectedField = () => {
    if (isReadOnly) return;
    if (!selectedFieldId || visibleFields.includes(selectedFieldId)) return;
    const folderId = selectedFolderId || filterFolders[0]?.id;
    setVisibleFields([...visibleFields, selectedFieldId]);
    setFieldGroups({ ...fieldGroups, [selectedFieldId]: folderId });
    setSelectedFieldId("");
  };

  const removeSelectedField = (fieldId) => {
    if (isReadOnly) return;
    setVisibleFields(visibleFields.filter((id) => id !== fieldId));
    const nextGroups = { ...fieldGroups };
    const nextValues = { ...fieldValues };
    const nextConfigs = { ...fieldConfigs };
    delete nextGroups[fieldId];
    delete nextValues[fieldId];
    delete nextConfigs[fieldId];
    setFieldGroups(nextGroups);
    setFieldValues(nextValues);
    setFieldConfigs(nextConfigs);
  };

  const updateFieldOperator = (fieldId, value) => {
    if (isReadOnly) return;
    setOperators({ ...operators, [fieldId]: value });
    setFieldValues({ ...fieldValues, [fieldId]: {} });
    setFieldConfigs({ ...fieldConfigs, [fieldId]: { ...(fieldConfigs[fieldId] || {}), operator: value, value: {}, defaultValue: {} } });
  };

  const updateFieldValue = (fieldId, value) => {
    if (isReadOnly) return;
    setFieldValues({ ...fieldValues, [fieldId]: value });
    setFieldConfigs({ ...fieldConfigs, [fieldId]: { ...(fieldConfigs[fieldId] || {}), value, defaultValue: value } });
  };

  if (!open) return null;

  const content =
  <div className={inline ? "w-full h-full min-h-0 overflow-hidden flex flex-col bg-white" : "w-full overflow-hidden flex flex-col"}>
      {!inline &&
    <DialogHeader className="sr-only">
          <DialogTitle>Configuração de filtros personalizados</DialogTitle>
        </DialogHeader>
    }

      {showForm ?
    <div className={`bg-white min-h-[420px] flex flex-col overflow-hidden ${inline ? "h-full" : "h-[calc(90vh-90px)]"}`}>
            <LegacyRecordToolbar
        title={configName || selectedConfig?.name || "FILTRO PERSONALIZADO"}
        badgeLabel="FILTRO"
        operationLabel={operationLabel}
        showSaveActions={editMode}
        showEditAction={isReadOnly}
        showDeleteDuplicateActions={!!selectedConfig && !editMode && !draftNew && !isDuplicating}
        onSave={handleSave}
        onCancel={handleDiscard}
        onEditRecord={() => setEditMode(true)}
        onToggleView={() => setShowForm(false)}
        onBack={() => onOpenChange(false)}
        onNew={handleNew}
        total={filterConfigs.length}
        currentIndex={selectedIndex}
        onFirst={() => openConfig(filterConfigs[0])}
        onPrevious={() => openConfig(filterConfigs[selectedIndex - 1])}
        onNext={() => openConfig(filterConfigs[selectedIndex + 1])}
        onLast={() => openConfig(filterConfigs[filterConfigs.length - 1])}
        onDelete={() => selectedConfig && onDeleteConfig(selectedConfig.id)}
        onDuplicate={handleDuplicateCurrent}
        onSettingsClick={() => {}}
        showUtilityActions={false} />
          

            <div className={`flex-1 overflow-auto w-full md:px-1 py-1 space-y-1 px-1 ${isReadOnly ? "[&_input]:cursor-default [&_button]:cursor-default" : ""}`}>
              <div className="space-y-1">
                <label className="text-[12px] font-semibold text-slate-700 leading-none">Nome do filtro</label>
                <div className="h-7 border border-slate-300 bg-white focus-within:border-green-500 overflow-hidden">
                  <Input value={configName} readOnly={isReadOnly} onChange={(e) => !isReadOnly && setConfigName(e.target.value.toUpperCase())} className="h-[26px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" />
                </div>
              </div>

              <div className="border border-slate-300 bg-slate-50 space-y-1 p-1">
                <div className="font-semibold text-slate-700 text-xs">Pastas do filtro</div>
                <div className="grid grid-cols-[1fr_32px] gap-1">
                  <Input value={newFolderName} readOnly={isReadOnly} onChange={(e) => !isReadOnly && setNewFolderName(e.target.value.toUpperCase())} placeholder="NOME DA NOVA PASTA" className="h-7 rounded-none text-xs uppercase" />
                  <Button type="button" onClick={addFolder} title="Criar pasta" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:text-accent-foreground h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-green-400 bg-green-500 hover:bg-green-600 text-white shadow-none"><Plus /></Button>
                </div>
                <div className="space-y-1">
                  {filterFolders.map((folder, index) =>
            <div key={folder.id} className="grid grid-cols-[1fr_92px] gap-2 items-center">
                      <Input value={folder.name} readOnly={isReadOnly} onChange={(e) => renameFolder(folder.id, e.target.value)} className="h-7 rounded-none text-xs uppercase" />
                      <div className="flex justify-end gap-0 [&>*:first-child]:border-l-[0.5px]">
                        <button type="button" onClick={() => moveFolder(folder.id, -1)} disabled={index === 0} className="h-7 w-7 border-y border-r border-l-0 border-slate-300 disabled:opacity-30"><ChevronUp className="w-3 h-3 mx-auto" /></button>
                        <button type="button" onClick={() => moveFolder(folder.id, 1)} disabled={index === filterFolders.length - 1} className="h-7 w-7 border-y border-r border-l-0 border-slate-300 disabled:opacity-30"><ChevronDown className="w-3 h-3 mx-auto" /></button>
                        <button type="button" onClick={() => removeFolder(folder.id)} disabled={filterFolders.length <= 1} className="h-7 w-7 border-y border-r border-l-0 border-slate-300 text-slate-600 disabled:opacity-30"><X className="w-3 h-3 mx-auto" /></button>
                      </div>
                    </div>
            )}
                </div>
              </div>

              <div className="border border-slate-300 bg-slate-50 p-1 space-y-1">
                <div className="font-semibold text-slate-700 text-xs">Adicionar campo na pasta</div>
                <div className="grid grid-cols-[180px_1fr_32px] gap-1">
                  <AutocompleteGenerico
              items={filterFolders.map((folder) => ({ ...folder, nome: folder.name }))}
              value={selectedFolderId || ""}
              onChange={(value) => !isReadOnly && setSelectedFolderId(value)}
              displayField="nome"
              searchFields={["nome"]}
              placeholder="PESQUISAR PASTA"
              inputClassName="h-7 text-xs"
              readOnly={isReadOnly}
              uppercaseDisplay={false} />
            
                  <AutocompleteGenerico
              items={availableFields.map((field) => ({ ...field, nome: field.label, group: field.group }))}
              value={selectedFieldId}
              onChange={(value) => !isReadOnly && setSelectedFieldId(value)}
              displayField="nome"
              searchFields={["nome", "group"]}
              placeholder="PESQUISAR CAMPO"
              inputClassName="h-7 text-xs"
              renderSubtext={(item) => item.group}
              readOnly={isReadOnly}
              uppercaseDisplay={false} />
            
                
                  <Button type="button" onClick={addSelectedField} title="Adicionar campo" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:text-accent-foreground h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-green-400 bg-green-500 hover:bg-green-600 text-white shadow-none"><Plus /></Button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Campos do filtro</span>
                <span className="rounded-sm bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{selectedFields.length} campo(s)</span>
              </div>
              <div className="border border-slate-300 bg-slate-50 p-1 space-y-1 overflow-x-auto">
                <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(170px,1fr)_minmax(170px,1fr)_minmax(320px,2fr)_96px] bg-white border-b border-gray-300 text-xs font-medium text-gray-900">
                  <div className="h-7 px-2 leading-7 text-center border-r border-gray-300">Campo</div>
                  <div className="h-7 px-2 leading-7 text-center border-r border-gray-300">Pasta</div>
                  <div className="h-7 px-2 leading-7 text-center border-r border-gray-300">Operador</div>
                  <div className="h-7 px-2 leading-7 text-center border-r border-gray-300">Valor padrão</div>
                  <div className="h-7 px-2 leading-7 text-center">Ações</div>
                </div>
                {selectedFields.length === 0 && <div className="border-b border-slate-200 bg-white p-3 text-xs text-slate-500">Nenhum campo adicionado. Crie ou escolha uma pasta, selecione um campo e clique em Adic.</div>}
                {selectedFields.map((field) => {
            const position = visibleFields.indexOf(field.id);
            const operatorOptions = getOperatorOptions(field);

            return (
              <div key={field.id} className="items-center border-b border-gray-300 text-xs hover:bg-gray-100 last:border-b-0 grid min-w-[960px] grid-cols-[minmax(180px,1.2fr)_minmax(170px,1fr)_minmax(170px,1fr)_minmax(320px,2fr)_96px]">
                      <div className="min-w-0 whitespace-normal break-words px-2 py-1 font-semibold text-gray-700 border-r border-gray-300">{field.label}</div>
                      <div className="px-1 py-1 border-r border-gray-300">
                        <AutocompleteGenerico
                    items={filterFolders.map((folder) => ({ ...folder, nome: folder.name }))}
                    value={fieldGroups[field.id] ?? ""}
                    onChange={(value) => !isReadOnly && setFieldGroups({ ...fieldGroups, [field.id]: value })}
                    displayField="nome"
                    searchFields={["nome"]}
                    placeholder="PASTA"
                    inputClassName="h-6 text-[11px]"
                    readOnly={isReadOnly}
                    uppercaseDisplay={false} />
                  
                      </div>
                      <div className="px-1 py-1 border-r border-gray-300">
                        <AutocompleteGenerico
                    items={operatorOptions.map((value) => ({ id: value, nome: OPERATOR_LABELS[value] }))}
                    value={operators[field.id] ?? ""}
                    onChange={(value) => updateFieldOperator(field.id, value)}
                    displayField="nome"
                    searchFields={["nome"]}
                    placeholder="OPERADOR"
                    inputClassName="h-6 text-[11px]"
                    readOnly={isReadOnly}
                    uppercaseDisplay={false} />
                  
                      </div>
                      <div className="px-1 py-1 border-r border-gray-300">
                        <FilterFieldValueEditor
                    field={field}
                    operator={operators[field.id] || operatorOptions[0]}
                    value={fieldValues[field.id] || {}}
                    onValueChange={(value) => updateFieldValue(field.id, value)}
                    relationOptions={relationOptions[field.source || "lotes"] || []} />
                      
                      </div>
                      <div className="flex items-center justify-center gap-0 px-1 py-1 [&>*:first-child]:border-l-[0.5px]">
                        <button type="button" title="Mover para cima" onClick={() => moveField(field.id, -1)} disabled={position <= 0} className="h-6 w-6 border-y border-r border-l-0 border-slate-300 text-slate-600 disabled:opacity-30"><ChevronUp className="w-3 h-3 mx-auto" /></button>
                        <button type="button" title="Mover para baixo" onClick={() => moveField(field.id, 1)} disabled={position === visibleFields.length - 1} className="h-6 w-6 border-y border-r border-l-0 border-slate-300 text-slate-600 disabled:opacity-30"><ChevronDown className="w-3 h-3 mx-auto" /></button>
                        <button type="button" title="Remover campo" onClick={() => removeSelectedField(field.id)} className="h-6 w-6 border-y border-r border-l-0 border-slate-300 text-slate-600"><X className="w-3 h-3 mx-auto" /></button>
                      </div>
                    </div>);

          })}
              </div>
            </div>
          </div> :

    <div className="flex-1 overflow-hidden bg-white flex flex-col">
            <SankhyaListToolbar
        viewMode="table"
        total={filterConfigs.length}
        currentIndex={selectedIndex}
        onNew={handleNew}
        onToggleView={() => openConfig(selectedConfig)}
        onBack={() => onOpenChange(false)}
        onDelete={() => selectedConfig && onDeleteConfig(selectedConfig.id)}
        onSettingsClick={() => {}}
        onAttachClick={() => {}}
        attachDisabled
        selectedCount={selectedConfig ? 1 : 0}
        title="Filtros Personalizados"
        recordLabel=""
        showUtilityActions={false}
        showSearch={false} />
          
            <div className="overflow-auto flex-1 min-h-0">
              <Table className="w-full min-w-[640px] border-separate border-spacing-0 table-fixed">
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white">
                    <TableHead className="h-7 w-[260px] text-xs font-medium text-gray-900 text-center border-r border-b border-gray-300 bg-white">Filtro</TableHead>
                    <TableHead className="h-7 text-xs font-medium text-gray-900 text-center border-r border-b border-gray-300 bg-white">Campos</TableHead>
                    <TableHead className="h-7 w-[120px] text-xs font-medium text-gray-900 text-center border-r border-b border-gray-300 bg-white">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filterConfigs.map((config) =>
            <TableRow key={config.id} onClick={() => onSelectConfig(config.id)} onDoubleClick={() => openConfig(config)} className={`${config.id === activeConfigId ? "bg-green-500 hover:bg-green-600 text-white" : "hover:bg-gray-100"} transition-colors cursor-pointer select-none`}>
                      <TableCell className={`px-2 py-1 text-xs border-r border-b font-medium ${config.id === activeConfigId ? "text-white border-white" : "text-gray-700 border-gray-300"}`}>{config.name}</TableCell>
                      <TableCell className={`px-2 py-1 text-xs border-r border-b ${config.id === activeConfigId ? "text-white border-white" : "text-gray-700 border-gray-300"}`}>
                        {config.visibleFields?.length || 0} campos · {Object.keys(config.fieldValues || {}).filter((key) => Object.values(config.fieldValues?.[key] || {}).some(Boolean)).length} pré-configurados
                      </TableCell>
                      <TableCell className="px-2 py-1 text-xs border-r border-b text-center"><Badge variant="outline" className="bg-white/90 text-slate-700 text-[10px]">{config.id === activeConfigId ? "Ativo" : "Salvo"}</Badge></TableCell>
                    </TableRow>
            )}
                </TableBody>
              </Table>
            </div>
          </div>
    }
    </div>;


  if (inline) return content;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-[98vw] max-h-[90vh] overflow-hidden flex flex-col sm:!p-1 sm:!rounded-none">
        {content}
      </DialogContent>
    </Dialog>);


}
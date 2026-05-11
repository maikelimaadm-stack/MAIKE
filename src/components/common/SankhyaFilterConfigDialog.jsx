import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import LegacyRecordToolbar from "@/components/lotes/LegacyRecordToolbar.jsx";
import SankhyaListToolbar from "@/components/common/SankhyaListToolbar";

const OPERATOR_LABELS = {
  between: "Entre",
  gt: "Maior que",
  lt: "Menor que",
  exact: "Exato"
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
  setOpenGroups,
  filterConfigs = [],
  activeConfigId,
  onSelectConfig,
  onSaveConfig,
  onDeleteConfig
}) {
  const [showForm, setShowForm] = useState(false);
  const [configName, setConfigName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");

  const selectedConfig = filterConfigs.find((config) => config.id === activeConfigId) || filterConfigs[0] || null;
  const selectedIndex = Math.max(0, filterConfigs.findIndex((config) => config.id === activeConfigId));

  const openConfig = (config) => {
    if (!config) return;
    onSelectConfig(config.id);
    setConfigName(config.name || "");
    setShowForm(true);
  };

  const handleNew = () => {
    setConfigName("NOVO FILTRO");
    onSaveConfig("NOVO FILTRO", true);
    setShowForm(true);
  };

  const handleSave = () => {
    const name = String(configName || "").trim().toUpperCase();
    if (!name) return;
    onSaveConfig(name, false);
  };

  const toggleField = (fieldId, checked) => {
    if (checked) {
      setVisibleFields([...visibleFields, fieldId]);
      if (!fieldGroups[fieldId]) setFieldGroups({ ...fieldGroups, [fieldId]: filterFolders[0]?.id });
      return;
    }
    setVisibleFields(visibleFields.filter((id) => id !== fieldId));
  };

  const moveField = (fieldId, direction) => {
    const index = visibleFields.indexOf(fieldId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= visibleFields.length) return;
    const next = [...visibleFields];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setVisibleFields(next);
  };

  const addFolder = () => {
    const name = newFolderName.trim().toUpperCase();
    if (!name) return;
    const folder = { id: makeFolderId(), name };
    setFilterFolders([...filterFolders, folder]);
    setOpenGroups((prev) => ({ ...prev, [folder.id]: true }));
    setNewFolderName("");
  };

  const renameFolder = (folderId, name) => {
    setFilterFolders(filterFolders.map((folder) => folder.id === folderId ? { ...folder, name: String(name || "").toUpperCase() } : folder));
  };

  const removeFolder = (folderId) => {
    if (filterFolders.length <= 1) return;
    const fallbackId = filterFolders.find((folder) => folder.id !== folderId)?.id;
    setFilterFolders(filterFolders.filter((folder) => folder.id !== folderId));
    setFieldGroups(Object.fromEntries(Object.entries(fieldGroups).map(([fieldId, currentFolderId]) => [fieldId, currentFolderId === folderId ? fallbackId : currentFolderId])));
  };

  const moveFolder = (folderId, direction) => {
    const index = filterFolders.findIndex((folder) => folder.id === folderId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= filterFolders.length) return;
    const next = [...filterFolders];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setFilterFolders(next);
  };

  const orderedFields = [
    ...visibleFields.map((id) => fields.find((field) => field.id === id)).filter(Boolean),
    ...fields.filter((field) => !visibleFields.includes(field.id))
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col sm:!p-1 sm:!rounded-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Configuração de filtros personalizados</DialogTitle>
        </DialogHeader>

        {showForm ? (
          <div className="border border-slate-300 bg-white h-[calc(90vh-90px)] min-h-[420px] flex flex-col overflow-hidden">
            <LegacyRecordToolbar
              title={configName || selectedConfig?.name || "FILTRO PERSONALIZADO"}
              badgeLabel="FILTRO"
              operationLabel="EDIÇÃO DE REGISTRO"
              showSaveActions
              onCancel={() => setShowForm(false)}
              onToggleView={() => setShowForm(false)}
              onNew={handleNew}
              total={filterConfigs.length}
              currentIndex={selectedIndex}
              onFirst={() => openConfig(filterConfigs[0])}
              onPrevious={() => openConfig(filterConfigs[selectedIndex - 1])}
              onNext={() => openConfig(filterConfigs[selectedIndex + 1])}
              onLast={() => openConfig(filterConfigs[filterConfigs.length - 1])}
              onDelete={() => selectedConfig && onDeleteConfig(selectedConfig.id)}
              onSettingsClick={() => {}}
              showUtilityActions={false}
            />

            <div className="flex-1 overflow-auto px-4 md:px-8 py-2 space-y-2 max-w-[900px]">
              <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
                <label className="text-[12px] text-slate-600 text-right leading-none">Nome do filtro:</label>
                <div className="h-6 border border-slate-300 bg-white focus-within:border-green-500 overflow-hidden">
                  <Input value={configName} onChange={(e) => setConfigName(e.target.value.toUpperCase())} className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" />
                </div>
              </div>

              <div className="border border-slate-300 bg-slate-50 p-2 space-y-2 ml-[191px]">
                <div className="font-semibold text-slate-700 text-xs">Pastas do filtro</div>
                <div className="grid grid-cols-[1fr_90px] gap-1">
                  <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value.toUpperCase())} placeholder="NOME DA NOVA PASTA" className="h-7 rounded-none text-xs uppercase" />
                  <Button type="button" onClick={addFolder} className="h-7 rounded-none bg-green-600 hover:bg-green-700 text-xs"><Plus className="w-3.5 h-3.5" /> Criar</Button>
                </div>
                <div className="space-y-1">
                  {filterFolders.map((folder, index) => (
                    <div key={folder.id} className="grid grid-cols-[1fr_92px] gap-2 items-center">
                      <Input value={folder.name} onChange={(e) => renameFolder(folder.id, e.target.value)} className="h-7 rounded-none text-xs uppercase" />
                      <div className="flex justify-end gap-1">
                        <button type="button" onClick={() => moveFolder(folder.id, -1)} disabled={index === 0} className="h-7 w-7 border border-slate-300 disabled:opacity-30"><ChevronUp className="w-3 h-3 mx-auto" /></button>
                        <button type="button" onClick={() => moveFolder(folder.id, 1)} disabled={index === filterFolders.length - 1} className="h-7 w-7 border border-slate-300 disabled:opacity-30"><ChevronDown className="w-3 h-3 mx-auto" /></button>
                        <button type="button" onClick={() => removeFolder(folder.id)} disabled={filterFolders.length <= 1} className="h-7 w-7 border border-red-200 text-red-600 disabled:opacity-30"><Trash2 className="w-3 h-3 mx-auto" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ml-[191px] text-xs font-semibold text-slate-700">Campos dentro das pastas</div>
              <div className="ml-[191px] space-y-1">
                {orderedFields.map((field) => {
                  const checked = visibleFields.includes(field.id);
                  const position = visibleFields.indexOf(field.id);
                  const isOperated = field.type === "number" || field.type === "date";

                  return (
                    <div key={field.id} className="grid grid-cols-[24px_1fr_150px_130px_52px] items-center gap-2 border border-slate-200 bg-white px-2 py-1 text-xs">
                      <Checkbox checked={checked} onCheckedChange={(value) => toggleField(field.id, !!value)} className="rounded-none h-4 w-4" />
                      <span className="font-medium text-slate-700 truncate">{field.label}</span>
                      <Select value={fieldGroups[field.id] || filterFolders[0]?.id} onValueChange={(value) => setFieldGroups({ ...fieldGroups, [field.id]: value })} disabled={!checked}>
                        <SelectTrigger className="h-7 rounded-none text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{filterFolders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}</SelectContent>
                      </Select>
                      {isOperated ? (
                        <Select value={operators[field.id] || "between"} onValueChange={(value) => setOperators({ ...operators, [field.id]: value })} disabled={!checked}>
                          <SelectTrigger className="h-7 rounded-none text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>{Object.entries(OPERATOR_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                        </Select>
                      ) : <span className="text-slate-500">Exato/contém</span>}
                      <div className="flex items-center justify-end gap-1">
                        <button type="button" onClick={() => moveField(field.id, -1)} disabled={!checked || position <= 0} className="h-6 w-6 border border-slate-300 disabled:opacity-30"><ChevronUp className="w-3 h-3 mx-auto" /></button>
                        <button type="button" onClick={() => moveField(field.id, 1)} disabled={!checked || position < 0 || position === visibleFields.length - 1} className="h-6 w-6 border border-slate-300 disabled:opacity-30"><ChevronDown className="w-3 h-3 mx-auto" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-2 flex justify-end">
              <Button type="button" onClick={handleSave} className="h-7 rounded-none bg-emerald-600 hover:bg-emerald-700 text-xs">Salvar filtro</Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden border border-slate-300 bg-white flex flex-col">
            <SankhyaListToolbar
              viewMode="table"
              total={filterConfigs.length}
              currentIndex={selectedIndex}
              onNew={handleNew}
              onToggleView={() => openConfig(selectedConfig)}
              onDelete={() => selectedConfig && onDeleteConfig(selectedConfig.id)}
              onSettingsClick={() => {}}
              onAttachClick={() => {}}
              attachDisabled
              selectedCount={selectedConfig ? 1 : 0}
              title="Filtros Personalizados"
              recordLabel=""
              showUtilityActions={false}
              showSearch={false}
            />
            <div className="overflow-auto flex-1">
              <Table className="w-full my-1 min-w-[640px] border-separate border-spacing-0 table-fixed">
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white border-t border-gray-200">
                    <TableHead className="h-7 w-[260px] text-xs text-center border-r border-t border-b border-gray-200 bg-white">Filtro</TableHead>
                    <TableHead className="h-7 text-xs text-center border-r border-t border-b border-gray-200 bg-white">Campos</TableHead>
                    <TableHead className="h-7 w-[120px] text-xs text-center border-r border-t border-b border-gray-200 bg-white">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filterConfigs.map((config) => (
                    <TableRow key={config.id} onClick={() => onSelectConfig(config.id)} onDoubleClick={() => openConfig(config)} className={`${config.id === activeConfigId ? "bg-green-500 hover:bg-green-600 text-white" : "hover:bg-gray-100"} transition-colors cursor-pointer select-none`}>
                      <TableCell className={`px-2 py-1 text-xs border-r border-b font-medium ${config.id === activeConfigId ? "text-white border-white" : "text-gray-700 border-gray-300"}`}>{config.name}</TableCell>
                      <TableCell className={`px-2 py-1 text-xs border-r border-b ${config.id === activeConfigId ? "text-white border-white" : "text-gray-700 border-gray-300"}`}>{config.visibleFields?.length || 0} campos configurados</TableCell>
                      <TableCell className="px-2 py-1 text-xs border-r border-b text-center"><Badge variant="outline" className="bg-white/90 text-slate-700 text-[10px]">{config.id === activeConfigId ? "Ativo" : "Salvo"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";

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
  setOpenGroups
}) {
  const [newFolderName, setNewFolderName] = useState("");

  const toggleField = (fieldId, checked) => {
    if (checked) {
      setVisibleFields([...visibleFields, fieldId]);
      if (!fieldGroups[fieldId]) {
        setFieldGroups({ ...fieldGroups, [fieldId]: filterFolders[0]?.id });
      }
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

  const updateOperator = (fieldId, value) => {
    setOperators({ ...operators, [fieldId]: value });
  };

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const folder = { id: makeFolderId(), name };
    setFilterFolders([...filterFolders, folder]);
    setOpenGroups((prev) => ({ ...prev, [folder.id]: true }));
    setNewFolderName("");
  };

  const renameFolder = (folderId, name) => {
    setFilterFolders(filterFolders.map((folder) => folder.id === folderId ? { ...folder, name } : folder));
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
      <DialogContent className="max-w-3xl rounded-none p-0 gap-0">
        <DialogHeader className="px-3 py-2 border-b border-slate-300 bg-slate-100">
          <DialogTitle className="text-sm font-semibold">Filtro personalizado</DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-auto p-2 space-y-2 text-xs">
          <div className="border border-slate-300 bg-slate-50 p-2 space-y-2">
            <div className="font-semibold text-slate-700">Pastas do filtro</div>
            <div className="grid grid-cols-[1fr_90px] gap-1">
              <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Nome da nova pasta" className="h-7 rounded-none text-xs" />
              <Button type="button" onClick={addFolder} className="h-7 rounded-none bg-green-600 hover:bg-green-700 text-xs"><Plus className="w-3.5 h-3.5" /> Criar</Button>
            </div>
            <div className="space-y-1">
              {filterFolders.map((folder, index) => (
                <div key={folder.id} className="grid grid-cols-[1fr_92px] gap-2 items-center">
                  <Input value={folder.name} onChange={(e) => renameFolder(folder.id, e.target.value)} className="h-7 rounded-none text-xs" />
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => moveFolder(folder.id, -1)} disabled={index === 0} className="h-7 w-7 border border-slate-300 disabled:opacity-30"><ChevronUp className="w-3 h-3 mx-auto" /></button>
                    <button type="button" onClick={() => moveFolder(folder.id, 1)} disabled={index === filterFolders.length - 1} className="h-7 w-7 border border-slate-300 disabled:opacity-30"><ChevronDown className="w-3 h-3 mx-auto" /></button>
                    <button type="button" onClick={() => removeFolder(folder.id)} disabled={filterFolders.length <= 1} className="h-7 w-7 border border-red-200 text-red-600 disabled:opacity-30"><Trash2 className="w-3 h-3 mx-auto" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="font-semibold text-slate-700 px-1">Campos dentro das pastas</div>
          {orderedFields.map((field) => {
            const checked = visibleFields.includes(field.id);
            const position = visibleFields.indexOf(field.id);
            const isNumeric = field.type === "number" || field.type === "date";

            return (
              <div key={field.id} className="grid grid-cols-[24px_1fr_150px_130px_52px] items-center gap-2 border border-slate-200 bg-white px-2 py-1">
                <Checkbox checked={checked} onCheckedChange={(value) => toggleField(field.id, !!value)} className="rounded-none h-4 w-4" />
                <span className="font-medium text-slate-700 truncate">{field.label}</span>
                <Select value={fieldGroups[field.id] || filterFolders[0]?.id} onValueChange={(value) => setFieldGroups({ ...fieldGroups, [field.id]: value })} disabled={!checked}>
                  <SelectTrigger className="h-7 rounded-none text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {filterFolders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {isNumeric ? (
                  <Select value={operators[field.id] || "between"} onValueChange={(value) => updateOperator(field.id, value)} disabled={!checked}>
                    <SelectTrigger className="h-7 rounded-none text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(OPERATOR_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                    </SelectContent>
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

        <DialogFooter className="px-3 py-2 border-t border-slate-300 bg-slate-50">
          <Button type="button" onClick={() => onOpenChange(false)} className="h-8 rounded-none bg-slate-700 hover:bg-slate-800 text-xs">Concluir</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
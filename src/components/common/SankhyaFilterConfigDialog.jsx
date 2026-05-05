import React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ChevronDown, ChevronUp } from "lucide-react";

const OPERATOR_LABELS = {
  between: "Entre",
  gt: "Maior que",
  lt: "Menor que",
  exact: "Exato"
};

const GROUP_ORDER = ["Detalhes do lote", "Localização", "Identificação"];

export default function SankhyaFilterConfigDialog({ open, onOpenChange, fields, visibleFields, setVisibleFields, operators, setOperators, groupNames, setGroupNames }) {
  const toggleField = (fieldId, checked) => {
    if (checked) {
      setVisibleFields([...visibleFields, fieldId]);
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

  const orderedFields = [
    ...visibleFields.map((id) => fields.find((field) => field.id === id)).filter(Boolean),
    ...fields.filter((field) => !visibleFields.includes(field.id))
  ].sort((a, b) => {
    const groupDiff = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
    return groupDiff || 0;
  });

  const groups = GROUP_ORDER.filter((group) => fields.some((field) => field.group === group));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-none p-0 gap-0">
        <DialogHeader className="px-3 py-2 border-b border-slate-300 bg-slate-100">
          <DialogTitle className="text-sm font-semibold">Configurar filtros</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto p-2 space-y-2 text-xs">
          <div className="border border-slate-300 bg-slate-50 p-2 space-y-1">
            <div className="font-semibold text-slate-700 mb-1">Nome das pastas</div>
            {groups.map((group) => (
              <div key={group} className="grid grid-cols-[130px_1fr] items-center gap-2">
                <span className="text-slate-500 truncate">{group}</span>
                <Input
                  value={groupNames?.[group] || group}
                  onChange={(e) => setGroupNames({ ...groupNames, [group]: e.target.value })}
                  className="h-7 rounded-none text-xs"
                />
              </div>
            ))}
          </div>

          {orderedFields.map((field) => {
            const checked = visibleFields.includes(field.id);
            const position = visibleFields.indexOf(field.id);
            const isNumeric = field.type === "number" || field.type === "date";

            return (
              <div key={field.id} className="grid grid-cols-[24px_1fr_130px_52px] items-center gap-2 border border-slate-200 bg-white px-2 py-1">
                <Checkbox checked={checked} onCheckedChange={(value) => toggleField(field.id, !!value)} className="rounded-none h-4 w-4" />
                <span className="font-medium text-slate-700 truncate">
                  <span className="text-slate-400 mr-1">{groupNames?.[field.group] || field.group} /</span>{field.label}
                </span>
                {isNumeric ? (
                  <Select value={operators[field.id] || "between"} onValueChange={(value) => updateOperator(field.id, value)} disabled={!checked}>
                    <SelectTrigger className="h-7 rounded-none text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(OPERATOR_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-slate-500">Exato/contém</span>
                )}
                <div className="flex items-center justify-end gap-1">
                  <button type="button" onClick={() => moveField(field.id, -1)} disabled={!checked || position <= 0} className="h-6 w-6 border border-slate-300 disabled:opacity-30">
                    <ChevronUp className="w-3 h-3 mx-auto" />
                  </button>
                  <button type="button" onClick={() => moveField(field.id, 1)} disabled={!checked || position < 0 || position === visibleFields.length - 1} className="h-6 w-6 border border-slate-300 disabled:opacity-30">
                    <ChevronDown className="w-3 h-3 mx-auto" />
                  </button>
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
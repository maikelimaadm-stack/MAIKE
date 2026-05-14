import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, EyeOff, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import ConditionalVisibilityEditor from "./ConditionalVisibilityEditor.jsx";

const SYSTEM_PANEL_IDS = ["geral", "compra", "identificacao", "observacoes", "campos_personalizados"];
const AGGREGATION_OPTIONS = [
{ value: "sum", label: "Soma" },
{ value: "avg", label: "Média" },
{ value: "max", label: "Maior" },
{ value: "min", label: "Menor" }];


const iconButtonClass = "h-7 w-8 rounded-none border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-40 disabled:bg-white";
const greenButtonClass = "h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-green-400 bg-green-500 hover:bg-green-600 text-white hover:text-white shadow-none";

const isCustomPanel = (panel) => panel && !SYSTEM_PANEL_IDS.includes(panel.id);
const isCustomField = (field) => field?.origem === "customizado" || String(field?.id || "").startsWith("custom:");

const CustomMarker = () => <span className="pointer-events-none absolute bottom-0 right-0 z-10 w-0 h-0 border-l-[7px] border-l-transparent border-b-[7px] border-b-green-500" />;

const formatPanelLabel = (value) => {
  const lowerWords = new Set(["da", "de", "do", "das", "dos", "e"]);
  return String(value || "").
  toLowerCase().
  split(/(\s+)/).
  map((part, index) => {
    if (!part.trim()) return part;
    if (index > 0 && lowerWords.has(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).
  join("");
};

function GreenCheck({ checked, disabled = false, onChange }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={`!h-4 !w-8 rounded-full relative inline-flex items-center transition-colors border-0 shadow-none ${checked ? "bg-green-500 hover:bg-green-600" : "bg-slate-300 hover:bg-slate-400"} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}>
      
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? "right-0.5" : "left-0.5"}`} />
    </button>);

}

export default function LayoutConfiguratorDialog({ open, onOpenChange, panels = [], fields = [], layout = {}, hiddenFieldIds = [], lockedFieldIds = [], requiredFieldIds = [], aggregationConfig = {}, visibilityRules = {}, defaultConfig = null, onSave, inline = false }) {
  const [draftPanels, setDraftPanels] = useState(panels);
  const [draftLayout, setDraftLayout] = useState(layout);
  const [draftHiddenFieldIds, setDraftHiddenFieldIds] = useState(hiddenFieldIds);
  const [draftLockedFieldIds, setDraftLockedFieldIds] = useState(lockedFieldIds);
  const [draftRequiredFieldIds, setDraftRequiredFieldIds] = useState(requiredFieldIds);
  const [draftAggregationConfig, setDraftAggregationConfig] = useState(aggregationConfig);
  const [draftVisibilityRules, setDraftVisibilityRules] = useState(visibilityRules);
  const [activePanelId, setActivePanelId] = useState(panels[0]?.id || "");
  const [selectedAvailable, setSelectedAvailable] = useState(null);
  const [selectedAvailableIds, setSelectedAvailableIds] = useState([]);
  const [selectedPanelField, setSelectedPanelField] = useState(null);
  const [selectedPanelFieldIds, setSelectedPanelFieldIds] = useState([]);
  const [search, setSearch] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [draggedFieldId, setDraggedFieldId] = useState(null);
  const [draggedPanelId, setDraggedPanelId] = useState(null);
  const [editingPanelId, setEditingPanelId] = useState(null);
  const [requiredPopup, setRequiredPopup] = useState({ open: false, message: "" });

  const showRequiredPopup = (message) => {
    setRequiredPopup({ open: true, message });
  };

  React.useEffect(() => {
    if (!open) return;
    setDraftPanels(panels);
    setDraftLayout(layout);
    setDraftHiddenFieldIds(hiddenFieldIds);
    setDraftLockedFieldIds(lockedFieldIds);
    setDraftRequiredFieldIds(requiredFieldIds);
    setDraftAggregationConfig(aggregationConfig);
    setDraftVisibilityRules(visibilityRules);
    setActivePanelId(panels[0]?.id || "");
    setSelectedAvailable(null);
    setSelectedAvailableIds([]);
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
    setSearch("");
    setIsEditing(false);
    setEditingPanelId(null);
  }, [open, panels, layout, hiddenFieldIds, lockedFieldIds, requiredFieldIds, aggregationConfig, visibilityRules]);

  const activePanel = draftPanels.find((panel) => panel.id === activePanelId) || draftPanels[0];
  const usedFieldIds = useMemo(() => new Set(Object.values(draftLayout || {}).flat()), [draftLayout]);
  const panelFieldIds = draftLayout[activePanel?.id] || [];
  const panelFields = panelFieldIds.map((id) => fields.find((field) => field.id === id)).filter(Boolean);
  const selectedField = fields.find((field) => field.id === selectedPanelField) || null;
  const activePanelIsSystem = SYSTEM_PANEL_IDS.includes(activePanel?.id);

  const availableFields = useMemo(() => {
    const term = search.trim().toLowerCase();
    return fields.
    filter((field) => !usedFieldIds.has(field.id)).
    filter((field) => !term || String(field.label || "").toLowerCase().includes(term));
  }, [fields, usedFieldIds, search]);


  const addField = () => {
    const ids = selectedAvailableIds.length ? selectedAvailableIds : selectedAvailable ? [selectedAvailable] : [];
    if (!ids.length || !activePanel) return;
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: [...(prev[activePanel.id] || []), ...ids.filter((id) => !(prev[activePanel.id] || []).includes(id))] }));
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
    setSelectedAvailable(null);
    setSelectedAvailableIds([]);
  };

  const addAllFields = () => {
    if (!activePanel || availableFields.length === 0) return;
    const ids = availableFields.map((field) => field.id);
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: [...(prev[activePanel.id] || []), ...ids.filter((id) => !(prev[activePanel.id] || []).includes(id))] }));
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
    setSelectedAvailable(null);
    setSelectedAvailableIds([]);
  };

  const removeField = () => {
    const ids = selectedPanelFieldIds.length ? selectedPanelFieldIds : selectedPanelField ? [selectedPanelField] : [];
    if (!ids.length || !activePanel) return;
    const requiredMoved = fields.some((field) => ids.includes(field.id) && (field.required || draftRequiredFieldIds.includes(field.id)));
    if (requiredMoved) showRequiredPopup("Campo obrigatório movido para disponíveis. Ele precisa voltar para o layout antes de salvar.");
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: (prev[activePanel.id] || []).filter((id) => !ids.includes(id)) }));
    setDraftHiddenFieldIds((prev) => prev.filter((id) => !ids.includes(id)));
    setDraftLockedFieldIds((prev) => prev.filter((id) => !ids.includes(id)));
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
  };

  const removeAllFields = () => {
    if (!activePanel || panelFieldIds.length === 0) return;
    const ids = [...panelFieldIds];
    const requiredMoved = fields.some((field) => ids.includes(field.id) && (field.required || draftRequiredFieldIds.includes(field.id)));
    if (requiredMoved) showRequiredPopup("Campos obrigatórios movidos para disponíveis. Eles precisam voltar para o layout antes de salvar.");
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: [] }));
    setDraftHiddenFieldIds((prev) => prev.filter((id) => !ids.includes(id)));
    setDraftLockedFieldIds((prev) => prev.filter((id) => !ids.includes(id)));
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
  };

  const createPanel = () => {
    const id = `painel_${Date.now()}`;
    const nextNumber = draftPanels.filter((panel) => !SYSTEM_PANEL_IDS.includes(panel.id)).length + 1;
    const nextPanel = { id, label: `Painel Personalizado ${nextNumber}` };
    setDraftPanels((prev) => [...prev, nextPanel]);
    setDraftLayout((prev) => ({ ...prev, [id]: [] }));
    setActivePanelId(id);
    setEditingPanelId(id);
    setIsEditing(true);
  };

  const deletePanel = () => {
    if (!activePanel || activePanelIsSystem) return;
    const fieldIds = draftLayout[activePanel.id] || [];
    setDraftPanels((prev) => prev.filter((panel) => panel.id !== activePanel.id));
    setDraftLayout((prev) => {
      const next = { ...prev };
      delete next[activePanel.id];
      return next;
    });
    const requiredMoved = fields.some((field) => fieldIds.includes(field.id) && (field.required || draftRequiredFieldIds.includes(field.id)));
    if (requiredMoved) showRequiredPopup("Campos obrigatórios ficaram disponíveis. Eles precisam voltar para o layout antes de salvar.");
    setDraftHiddenFieldIds((prev) => prev.filter((id) => !fieldIds.includes(id)));
    setDraftLockedFieldIds((prev) => prev.filter((id) => !fieldIds.includes(id)));
    setActivePanelId(draftPanels.find((panel) => panel.id !== activePanel.id)?.id || "");
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
    setEditingPanelId(null);
  };

  const movePanel = (direction) => {
    if (!activePanel) return;
    const index = draftPanels.findIndex((panel) => panel.id === activePanel.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= draftPanels.length) return;
    const next = [...draftPanels];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setDraftPanels(next);
  };

  const moveField = (direction) => {
    if (!selectedPanelField || !activePanel) return;
    const list = [...panelFieldIds];
    const index = list.indexOf(selectedPanelField);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    [list[index], list[nextIndex]] = [list[nextIndex], list[index]];
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: list }));
  };

  const reorderField = (targetFieldId) => {
    if (!draggedFieldId || !targetFieldId || draggedFieldId === targetFieldId || !activePanel) return;
    const list = [...panelFieldIds];
    const from = list.indexOf(draggedFieldId);
    const to = list.indexOf(targetFieldId);
    if (from < 0 || to < 0) return;
    list.splice(from, 1);
    list.splice(to, 0, draggedFieldId);
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: list }));
  };

  const dropFieldToAvailable = () => {
    if (!draggedFieldId || !activePanel) return;
    const ids = selectedPanelFieldIds.includes(draggedFieldId) ? selectedPanelFieldIds : [draggedFieldId];
    const requiredMoved = fields.some((field) => ids.includes(field.id) && (field.required || draftRequiredFieldIds.includes(field.id)));
    if (requiredMoved) showRequiredPopup("Campo obrigatório movido para disponíveis. Ele precisa voltar para o layout antes de salvar.");
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: (prev[activePanel.id] || []).filter((id) => !ids.includes(id)) }));
    setDraftHiddenFieldIds((prev) => prev.filter((id) => !ids.includes(id)));
    setDraftLockedFieldIds((prev) => prev.filter((id) => !ids.includes(id)));
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
    setDraggedFieldId(null);
  };

  const dropAvailableFieldToPanel = () => {
    if (!draggedFieldId || !activePanel) return;
    const ids = selectedAvailableIds.includes(draggedFieldId) ? selectedAvailableIds : [draggedFieldId];
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: [...(prev[activePanel.id] || []), ...ids.filter((id) => !(prev[activePanel.id] || []).includes(id))] }));
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
    setSelectedAvailable(null);
    setSelectedAvailableIds([]);
    setDraggedFieldId(null);
  };

  const reorderPanel = (targetPanelId) => {
    if (!draggedPanelId || !targetPanelId || draggedPanelId === targetPanelId) return;
    const next = [...draftPanels];
    const from = next.findIndex((panel) => panel.id === draggedPanelId);
    const to = next.findIndex((panel) => panel.id === targetPanelId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraftPanels(next);
  };

  const toggleListValue = (setter, fieldId, checked) => {
    if (!fieldId) return;
    setter((prev) => checked ? Array.from(new Set([...prev, fieldId])) : prev.filter((id) => id !== fieldId));
  };

  const setAggregationEnabled = (fieldId, enabled) => {
    setDraftAggregationConfig((prev) => {
      const next = { ...prev };
      if (!enabled) delete next[fieldId];else
      next[fieldId] = { enabled: true, type: prev[fieldId]?.type || "sum" };
      return next;
    });
  };

  const setAggregationType = (fieldId, type) => {
    setDraftAggregationConfig((prev) => ({ ...prev, [fieldId]: { enabled: true, type } }));
  };

  const setVisibilityRule = (fieldId, rule) => {
    if (!fieldId) return;
    setDraftVisibilityRules((prev) => {
      const next = { ...prev };
      if (!rule) delete next[fieldId];else
      next[fieldId] = rule;
      return next;
    });
  };

  const handleSave = () => {
    const usedIds = new Set(Object.values(draftLayout || {}).flat());
    const missingRequiredFields = fields.filter((field) => (field.required || draftRequiredFieldIds.includes(field.id)) && !usedIds.has(field.id));
    if (missingRequiredFields.length > 0) {
      showRequiredPopup(`Existem campos obrigatórios nos disponíveis: ${missingRequiredFields.map((field) => field.label).join(", ")}. Volte eles para o layout antes de salvar.`);
      return;
    }

    const finalPanels = draftPanels.map((panel) => {
      const isSystem = SYSTEM_PANEL_IDS.includes(panel.id);
      const isEmpty = (draftLayout[panel.id] || []).length === 0;
      return { ...panel, hidden: isSystem && isEmpty };
    });
    onSave?.({
      panels: finalPanels,
      layout: draftLayout,
      hiddenFieldIds: draftHiddenFieldIds,
      lockedFieldIds: draftLockedFieldIds,
      requiredFieldIds: draftRequiredFieldIds,
      aggregationConfig: draftAggregationConfig,
      visibilityRules: draftVisibilityRules
    });
    onOpenChange(false);
  };

  const restoreDefault = () => {
    if (!defaultConfig) return;
    setDraftPanels(defaultConfig.panels || []);
    setDraftLayout(defaultConfig.layout || {});
    setDraftHiddenFieldIds(defaultConfig.hiddenFieldIds || []);
    setDraftLockedFieldIds(defaultConfig.lockedFieldIds || []);
    setDraftRequiredFieldIds(defaultConfig.requiredFieldIds || []);
    setDraftAggregationConfig(defaultConfig.aggregationConfig || {});
    setDraftVisibilityRules(defaultConfig.visibilityRules || {});
    setActivePanelId(defaultConfig.panels?.[0]?.id || "");
    setSelectedAvailable(null);
    setSelectedAvailableIds([]);
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
  };

  const discardChanges = () => {
    setDraftPanels(panels);
    setDraftLayout(layout);
    setDraftHiddenFieldIds(hiddenFieldIds);
    setDraftLockedFieldIds(lockedFieldIds);
    setDraftRequiredFieldIds(requiredFieldIds);
    setDraftAggregationConfig(aggregationConfig);
    setDraftVisibilityRules(visibilityRules);
    setActivePanelId(panels[0]?.id || "");
    setSelectedAvailable(null);
    setSelectedAvailableIds([]);
    setSelectedPanelField(null);
    setSelectedPanelFieldIds([]);
    setEditingPanelId(null);
    setIsEditing(false);
  };

  const renderAvailableField = (field) => {
    const selected = selectedAvailableIds.includes(field.id);
    const required = field.required || draftRequiredFieldIds.includes(field.id);
    return <button
      key={field.id}
      type="button"
      disabled={!isEditing}
      draggable={isEditing}
      onClick={(event) => {
        const multi = event.ctrlKey || event.metaKey || event.shiftKey;
        setSelectedAvailable(field.id);
        setSelectedAvailableIds((prev) => multi ? prev.includes(field.id) ? prev.filter((id) => id !== field.id) : [...prev, field.id] : [field.id]);
        setSelectedPanelField(null);
        setSelectedPanelFieldIds([]);
      }}
      onDragStart={() => {
        setDraggedFieldId(field.id);
        setSelectedAvailable(field.id);
        setSelectedAvailableIds((prev) => prev.includes(field.id) ? prev : [field.id]);
      }}
      onDragEnd={() => setDraggedFieldId(null)}
      className={`relative w-full rounded-sm border px-2 py-1.5 text-left overflow-hidden transition-all focus-visible:outline-none flex items-center justify-between gap-2 ${selected ? "bg-gray-100 border-slate-400 text-slate-900" : "bg-gray-50 border-slate-200 text-slate-900 hover:bg-gray-100"}`}>
      {isCustomField(field) && <CustomMarker />}
      <div className="min-w-0">
        <div className="text-xs font-semibold truncate">{field.label}</div>
        <div className="text-[10px] text-slate-500 truncate">Disponível</div>
      </div>
      {required && <span className="text-[10px] font-bold text-red-600 leading-none">*</span>}
    </button>;
  };


  const renderPanelField = (field, index) => {
    const selected = selectedPanelFieldIds.includes(field.id);
    const hidden = draftHiddenFieldIds.includes(field.id);
    const locked = draftLockedFieldIds.includes(field.id);
    const required = field.required || draftRequiredFieldIds.includes(field.id);
    return (
      <button
        key={field.id}
        type="button"
        disabled={!isEditing}
        onClick={(event) => {
          const multi = event.ctrlKey || event.metaKey || event.shiftKey;
          setSelectedPanelField(field.id);
          setSelectedPanelFieldIds((prev) => multi ? prev.includes(field.id) ? prev.filter((id) => id !== field.id) : [...prev, field.id] : [field.id]);
          setSelectedAvailable(null);
          setSelectedAvailableIds([]);
        }}
        draggable={isEditing}
        onDragStart={() => {
          setDraggedFieldId(field.id);
          setSelectedPanelField(field.id);
          setSelectedPanelFieldIds((prev) => prev.includes(field.id) ? prev : [field.id]);
        }}
        onDragOver={(event) => {event.preventDefault();reorderField(field.id);}}
        onDrop={() => setDraggedFieldId(null)}
        onDragEnd={() => setDraggedFieldId(null)}
        className={`relative h-8 min-w-[210px] px-2 rounded-sm text-left items-center transition-all flex border justify-between overflow-hidden focus-visible:outline-none ${draggedFieldId === field.id ? "opacity-50 scale-95" : ""} ${selected ? "bg-gray-100 border-slate-400 text-slate-900" : "bg-gray-50 border-slate-200 text-slate-900 hover:bg-gray-100"} ${hidden ? "bg-slate-100 text-slate-400 border-slate-300" : ""}`}>
        
        {isCustomField(field) && <CustomMarker />}
        <span className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-semibold truncate">{field.label}</span>
        </span>
        <span className="flex items-center gap-1 ml-2 opacity-90">{hidden && <EyeOff className="w-3 h-3" />}{locked && <span className="text-[10px]">B</span>}{required && <span className="text-[10px]">*</span>}</span>
      </button>);

  };

  const content =
  <div className="w-full h-full overflow-hidden flex flex-col bg-white">
      {!inline && <DialogHeader className="sr-only"><DialogTitle>Configuração de layout do formulário</DialogTitle></DialogHeader>}

      <div className="border-slate-300 bg-white min-h-0 flex flex-col overflow-hidden flex-1 border-b">
        <div className="h-7 flex items-center gap-0 whitespace-nowrap bg-white border-y border-slate-300 overflow-hidden">
          <Button type="button" variant="outline" size="icon" onClick={() => onOpenChange(false)} className={iconButtonClass} title="Voltar"><ChevronLeft className="w-3.5 h-3.5" /></Button>
          {!isEditing && <Button type="button" variant="outline" size="icon" onClick={() => setIsEditing(true)} className={iconButtonClass} title="Editar layout"><Pencil className="w-3.5 h-3.5" /></Button>}
          {isEditing && <Button type="button" variant="outline" size="icon" onClick={createPanel} className={greenButtonClass} title="Novo painel"><Plus className="w-4 h-4" /></Button>}
          {isEditing && <Button type="button" variant="outline" size="icon" disabled={!activePanel || activePanelIsSystem} onClick={deletePanel} className={iconButtonClass} title="Excluir painel"><Trash2 className="w-3.5 h-3.5" /></Button>}
          {isEditing && <Button type="button" variant="outline" size="icon" onClick={handleSave} className={iconButtonClass} title="Salvar alterações"><Check className="w-4 h-4" /></Button>}
          {isEditing && <Button type="button" variant="outline" size="icon" onClick={discardChanges} className={iconButtonClass} title="Descartar"><X className="w-3.5 h-3.5" /></Button>}
          <div className="ml-auto flex items-center gap-0">
            {isEditing && <Button type="button" variant="outline" size="icon" onClick={restoreDefault} className={iconButtonClass} title="Restaurar padrão"><RotateCcw className="w-3.5 h-3.5" /></Button>}
          </div>
        </div>

        <div className="grid grid-cols-[320px_45px_1fr] flex-1 min-h-0">
          <aside
          className="border-r border-slate-300 bg-white p-2 overflow-hidden flex flex-col">

          
            <div className="text-sm font-semibold text-slate-800 mb-2">Campos disponíveis</div>
            <div className="relative mb-3">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar campo" className="rounded-none text-xs pr-3 pl-3 h-7" />
              <Search className="w-3.5 h-3.5 text-slate-600 absolute right-2 top-1.5" />
            </div>
            <div className="flex-1 overflow-auto space-y-1 pr-1" onDragOver={(event) => event.preventDefault()} onDrop={dropFieldToAvailable}>
              {availableFields.length === 0 ? <div className="text-xs text-slate-400 py-4 text-center">Solte aqui para remover do painel.</div> : availableFields.map(renderAvailableField)}
            </div>
          </aside>

          <section className="border-r border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-0">
            <Button type="button" variant="outline" size="icon" disabled={!isEditing || panelFieldIds.length === 0} onClick={removeAllFields} className={iconButtonClass} title="Mover todos para disponíveis"><ChevronsLeft className="w-3.5 h-3.5" /></Button>
            <Button type="button" variant="outline" size="icon" disabled={!isEditing || selectedPanelFieldIds.length === 0} onClick={removeField} className={iconButtonClass} title="Mover selecionados para disponíveis"><ChevronLeft className="w-3.5 h-3.5" /></Button>
            <Button type="button" variant="outline" size="icon" disabled={!isEditing || selectedAvailableIds.length === 0} onClick={addField} className={iconButtonClass} title="Adicionar selecionados ao painel"><ChevronRight className="w-3.5 h-3.5" /></Button>
            <Button type="button" variant="outline" size="icon" disabled={!isEditing || availableFields.length === 0} onClick={addAllFields} className={iconButtonClass} title="Mover todos para o painel"><ChevronsRight className="w-3.5 h-3.5" /></Button>
          </section>

          <main className="min-w-0 overflow-hidden flex flex-col bg-white">
            <div className="relative h-9 bg-white flex items-end px-1 gap-0 overflow-x-auto before:absolute before:left-0 before:right-0 before:bottom-0 before:h-px before:bg-slate-300">
              {draftPanels.map((panel) => {
              const isActive = activePanel?.id === panel.id;
              const isEmpty = (draftLayout[panel.id] || []).length === 0;
              const panelLabel = formatPanelLabel(panel.label);
              return (
                <button
                  key={panel.id}
                  type="button"
                  draggable={isEditing}
                  onDragStart={() => {setDraggedPanelId(panel.id);setActivePanelId(panel.id);}}
                  onDragOver={(event) => {event.preventDefault();reorderPanel(panel.id);}}
                  onDrop={() => setDraggedPanelId(null)}
                  onDragEnd={() => setDraggedPanelId(null)}
                  onClick={() => {
                    if (isActive && isEditing && !SYSTEM_PANEL_IDS.includes(panel.id)) setEditingPanelId(panel.id);else
                    setEditingPanelId(null);
                    setActivePanelId(panel.id);
                    setSelectedPanelField(null);
                    setSelectedPanelFieldIds([]);
                  }}
                  className={`relative z-10 h-8 px-4 mx-0.5 border border-slate-300 text-xs whitespace-nowrap transition-colors overflow-hidden ${draggedPanelId === panel.id ? "opacity-50" : ""} ${isActive ? "bg-white font-semibold text-slate-800 border-t-2 border-t-green-500 border-b-white" : "bg-slate-50 text-slate-700 border-b-slate-300 hover:bg-white"} ${isEmpty && SYSTEM_PANEL_IDS.includes(panel.id) ? "opacity-60" : ""}`}>
                  
                    {isCustomPanel(panel) && <CustomMarker />}
                    {isEditing && editingPanelId === panel.id && !SYSTEM_PANEL_IDS.includes(panel.id) ?
                  <Input
                    value={panel.label || ""}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onBlur={() => setEditingPanelId(null)}
                    onChange={(event) => setDraftPanels((prev) => prev.map((item) => item.id === panel.id ? { ...item, label: formatPanelLabel(event.target.value) } : item))}
                    className="h-6 w-40 border-0 bg-transparent p-0 text-xs font-semibold normal-case shadow-none focus-visible:ring-0" /> :

                  panelLabel}
                  </button>);

            })}

            </div>


            <div className="flex-1 overflow-auto p-3 border-t border-slate-300">
              <div className="flex flex-wrap content-start gap-2 min-h-[160px]" onDragOver={(event) => event.preventDefault()} onDrop={dropAvailableFieldToPanel}>
                {panelFields.length === 0 ? <div className="text-xs text-slate-400 p-4">Painel vazio. Se for painel do sistema, ele será ocultado ao salvar.</div> : panelFields.map(renderPanelField)}
              </div>
            </div>

            <div className="border-t px-3 py-2 flex items-center h-10 border-slate-300 bg-slate-50 gap-">
              <div className="w-64">
                <div className="text-xs font-semibold text-slate-700 hidden">Campo selecionado</div>
                <div className="text-xs text-slate-500 truncate hidden">{selectedField ? `Movendo/configurando: ${selectedField.label}` : "Selecione um campo do painel"}</div>
              </div>

              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <span>Oculto:</span>
                <GreenCheck checked={!!selectedField && draftHiddenFieldIds.includes(selectedField.id)} disabled={!selectedField || !isEditing || selectedField.required || draftRequiredFieldIds.includes(selectedField.id)} onChange={(checked) => toggleListValue(setDraftHiddenFieldIds, selectedField?.id, checked)} />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <span>Bloqueado:</span>
                <GreenCheck checked={!!selectedField && draftLockedFieldIds.includes(selectedField.id)} disabled={!selectedField || !isEditing || selectedField.required || draftRequiredFieldIds.includes(selectedField.id)} onChange={(checked) => toggleListValue(setDraftLockedFieldIds, selectedField?.id, checked)} />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <span>Obrigatório:</span>
                <GreenCheck checked={!!selectedField && (selectedField.required || draftRequiredFieldIds.includes(selectedField.id))} disabled={!selectedField || selectedField?.required || !isEditing} onChange={(checked) => {
                if (checked) {
                  setDraftHiddenFieldIds((prev) => prev.filter((id) => id !== selectedField?.id));
                  setDraftLockedFieldIds((prev) => prev.filter((id) => id !== selectedField?.id));
                }
                toggleListValue(setDraftRequiredFieldIds, selectedField?.id, checked);
              }} />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <span>Totalizar:</span>
                <GreenCheck checked={!!selectedField && !!draftAggregationConfig[selectedField.id]?.enabled} disabled={!selectedField || !selectedField?.totalizable || !isEditing} onChange={(checked) => setAggregationEnabled(selectedField?.id, checked)} />
              </label>
              <ConditionalVisibilityEditor selectedField={selectedField} fields={fields} visibilityRules={draftVisibilityRules} onChange={setVisibilityRule} disabled={!isEditing} />
              <Select value={selectedField ? draftAggregationConfig[selectedField.id]?.type || "sum" : "sum"} onValueChange={(value) => selectedField && setAggregationType(selectedField.id, value)} disabled={!selectedField || !draftAggregationConfig[selectedField.id]?.enabled || !isEditing}>
                <SelectTrigger className="h-7 w-28 rounded-none text-xs bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGGREGATION_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>)}
                </SelectContent>
              </Select>

            </div>
          </main>
        </div>
      </div>

      {requiredPopup.open &&
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30">
        <div className="w-[360px] max-w-[90vw] rounded-md border border-red-200 bg-white shadow-xl">
          <div className="border-b border-red-100 px-4 py-3 text-sm font-semibold text-red-700">Atenção</div>
          <div className="px-4 py-3 text-sm text-slate-700">{requiredPopup.message}</div>
          <div className="flex justify-end px-4 py-3 border-t bg-slate-50">
            <Button type="button" size="sm" onClick={() => setRequiredPopup({ open: false, message: "" })} className="h-8 bg-red-600 hover:bg-red-700 text-white">OK</Button>
          </div>
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
import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Eye, EyeOff, Plus, Search, Trash2, GripVertical } from "lucide-react";
import LegacyRecordToolbar from "@/components/lotes/LegacyRecordToolbar.jsx";

const SYSTEM_PANEL_IDS = ["geral", "compra", "identificacao", "observacoes", "campos_personalizados"];
const AGGREGATION_OPTIONS = [
  { value: "sum", label: "Soma" },
  { value: "avg", label: "Média" },
  { value: "max", label: "Maior" },
  { value: "min", label: "Menor" }
];

function GreenCheck({ checked, disabled = false, onChange }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={`w-8 h-4 rounded-full relative inline-block transition-colors ${checked ? "bg-green-500" : "bg-slate-300"} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? "right-0.5" : "left-0.5"}`} />
    </button>
  );
}

export default function LayoutConfiguratorDialog({ open, onOpenChange, panels = [], fields = [], layout = {}, hiddenFieldIds = [], lockedFieldIds = [], requiredFieldIds = [], aggregationConfig = {}, onSave }) {
  const [draftPanels, setDraftPanels] = useState(panels);
  const [draftLayout, setDraftLayout] = useState(layout);
  const [draftHiddenFieldIds, setDraftHiddenFieldIds] = useState(hiddenFieldIds);
  const [draftLockedFieldIds, setDraftLockedFieldIds] = useState(lockedFieldIds);
  const [draftRequiredFieldIds, setDraftRequiredFieldIds] = useState(requiredFieldIds);
  const [draftAggregationConfig, setDraftAggregationConfig] = useState(aggregationConfig);
  const [activePanelId, setActivePanelId] = useState(panels[0]?.id || "");
  const [selectedAvailable, setSelectedAvailable] = useState(null);
  const [selectedPanelField, setSelectedPanelField] = useState(null);
  const [search, setSearch] = useState("");
  const [dragState, setDragState] = useState(null);

  React.useEffect(() => {
    if (!open) return;
    setDraftPanels(panels);
    setDraftLayout(layout);
    setDraftHiddenFieldIds(hiddenFieldIds);
    setDraftLockedFieldIds(lockedFieldIds);
    setDraftRequiredFieldIds(requiredFieldIds);
    setDraftAggregationConfig(aggregationConfig);
    setActivePanelId(panels[0]?.id || "");
    setSelectedAvailable(null);
    setSelectedPanelField(null);
    setSearch("");
  }, [open, panels, layout, hiddenFieldIds, lockedFieldIds, requiredFieldIds, aggregationConfig]);

  const activePanel = draftPanels.find((panel) => panel.id === activePanelId) || draftPanels[0];
  const usedFieldIds = useMemo(() => new Set(Object.values(draftLayout || {}).flat()), [draftLayout]);
  const panelFieldIds = draftLayout[activePanel?.id] || [];
  const panelFields = panelFieldIds.map((id) => fields.find((field) => field.id === id)).filter(Boolean);
  const selectedField = fields.find((field) => field.id === selectedPanelField) || null;
  const activePanelIsSystem = SYSTEM_PANEL_IDS.includes(activePanel?.id);
  const canDeleteActivePanel = !!activePanel && !activePanelIsSystem;

  const availableFields = useMemo(() => {
    const term = search.trim().toLowerCase();
    return fields
      .filter((field) => !usedFieldIds.has(field.id))
      .filter((field) => !term || String(field.label || "").toLowerCase().includes(term));
  }, [fields, usedFieldIds, search]);

  const createPanel = () => {
    const id = `painel_${Date.now()}`;
    setDraftPanels((prev) => [...prev, { id, label: "NOVO PAINEL", custom: true }]);
    setDraftLayout((prev) => ({ ...prev, [id]: [] }));
    setActivePanelId(id);
    setSelectedPanelField(null);
  };

  const deletePanel = () => {
    if (!canDeleteActivePanel) return;
    const nextPanels = draftPanels.filter((panel) => panel.id !== activePanel.id);
    const nextLayout = { ...draftLayout };
    delete nextLayout[activePanel.id];
    setDraftPanels(nextPanels);
    setDraftLayout(nextLayout);
    setActivePanelId(nextPanels[0]?.id || "");
    setSelectedPanelField(null);
  };

  const addField = () => {
    if (!selectedAvailable || !activePanel) return;
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: [...(prev[activePanel.id] || []), selectedAvailable] }));
    setSelectedPanelField(selectedAvailable);
    setSelectedAvailable(null);
  };

  const removeField = () => {
    if (!selectedPanelField || !activePanel) return;
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: (prev[activePanel.id] || []).filter((id) => id !== selectedPanelField) }));
    setDraftHiddenFieldIds((prev) => prev.filter((id) => id !== selectedPanelField));
    setDraftLockedFieldIds((prev) => prev.filter((id) => id !== selectedPanelField));
    setDraftRequiredFieldIds((prev) => prev.filter((id) => id !== selectedPanelField));
    setSelectedPanelField(null);
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

  const toggleListValue = (setter, fieldId, checked) => {
    if (!fieldId) return;
    setter((prev) => checked ? Array.from(new Set([...prev, fieldId])) : prev.filter((id) => id !== fieldId));
  };

  const setAggregationEnabled = (fieldId, enabled) => {
    setDraftAggregationConfig((prev) => {
      const next = { ...prev };
      if (!enabled) delete next[fieldId];
      else next[fieldId] = { enabled: true, type: prev[fieldId]?.type || "sum" };
      return next;
    });
  };

  const setAggregationType = (fieldId, type) => {
    setDraftAggregationConfig((prev) => ({ ...prev, [fieldId]: { enabled: true, type } }));
  };

  const handleSave = () => {
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
      aggregationConfig: draftAggregationConfig
    });
    onOpenChange(false);
  };

  const handleDrop = (targetType, targetIndex = null) => {
    if (!dragState || !activePanel) return;

    if (targetType === "panel" && dragState.type === "available") {
      if (usedFieldIds.has(dragState.fieldId)) return;
      setDraftLayout((prev) => {
        const list = [...(prev[activePanel.id] || [])];
        const insertAt = targetIndex === null ? list.length : targetIndex;
        list.splice(insertAt, 0, dragState.fieldId);
        return { ...prev, [activePanel.id]: list };
      });
      setSelectedPanelField(dragState.fieldId);
    }

    if (targetType === "panel" && dragState.type === "panel") {
      setDraftLayout((prev) => {
        const list = [...(prev[activePanel.id] || [])].filter((id) => id !== dragState.fieldId);
        const insertAt = targetIndex === null ? list.length : targetIndex;
        list.splice(insertAt, 0, dragState.fieldId);
        return { ...prev, [activePanel.id]: list };
      });
    }

    if (targetType === "available" && dragState.type === "panel") {
      setSelectedPanelField(dragState.fieldId);
      setTimeout(removeField, 0);
    }
    setDragState(null);
  };

  const renderAvailableField = (field) => (
    <button
      key={field.id}
      type="button"
      draggable
      onDragStart={() => setDragState({ type: "available", fieldId: field.id })}
      onClick={() => setSelectedAvailable(field.id)}
      className={`w-full rounded-sm px-2 py-1.5 text-left ${selectedAvailable === field.id ? "bg-green-500 text-white" : "bg-slate-600 text-white hover:bg-slate-700"}`}
    >
      <div className="text-xs font-semibold truncate">{field.label}</div>
      <div className="text-[10px] opacity-80 truncate">Disponível</div>
    </button>
  );

  const renderPanelField = (field, index) => {
    const selected = selectedPanelField === field.id;
    const hidden = draftHiddenFieldIds.includes(field.id);
    const locked = draftLockedFieldIds.includes(field.id);
    const required = field.required || draftRequiredFieldIds.includes(field.id);
    return (
      <button
        key={field.id}
        type="button"
        draggable
        onDragStart={() => setDragState({ type: "panel", fieldId: field.id })}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => handleDrop("panel", index)}
        onClick={() => setSelectedPanelField(field.id)}
        className={`h-8 min-w-[210px] px-2 rounded-sm text-left border flex items-center justify-between ${selected ? "ring-2 ring-green-500" : ""} ${hidden ? "bg-slate-100 text-slate-400 border-slate-300" : required ? "bg-red-500 text-white border-red-500" : "bg-slate-600 text-white border-slate-600"}`}
      >
        <span className="flex items-center gap-1 min-w-0">
          <GripVertical className="w-3 h-3 shrink-0 opacity-70" />
          <span className="text-xs font-semibold truncate">{field.label}</span>
        </span>
        <span className="flex items-center gap-1 ml-2 opacity-90">{hidden && <EyeOff className="w-3 h-3" />}{locked && <span className="text-[10px]">B</span>}{required && <span className="text-[10px]">*</span>}</span>
      </button>
    );
  };

  const content = (
    <div className="w-full h-full overflow-hidden flex flex-col bg-white">
      <DialogHeader className="sr-only"><DialogTitle>Configuração de layout do formulário</DialogTitle></DialogHeader>

      <div className="border border-slate-300 bg-white flex-1 min-h-0 flex flex-col overflow-hidden">
        <LegacyRecordToolbar
          title="LAYOUT DO FORMULÁRIO"
          badgeLabel="CONFIGURAÇÃO"
          operationLabel="EDIÇÃO DE LAYOUT"
          showSaveActions
          showDeleteDuplicateActions={false}
          showUtilityActions={false}
          onSave={handleSave}
          onCancel={() => onOpenChange(false)}
          onToggleView={() => onOpenChange(false)}
          onBack={() => onOpenChange(false)}
          onNew={createPanel}
          total={draftPanels.length}
          currentIndex={Math.max(0, draftPanels.findIndex((panel) => panel.id === activePanel?.id))}
        />

        <div className="grid grid-cols-[240px_45px_1fr] flex-1 min-h-0">
          <aside
            className="border-r border-slate-300 bg-white p-2 overflow-hidden flex flex-col"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop("available")}
          >
            <div className="text-sm font-semibold text-slate-800 mb-2">Campos disponíveis</div>
            <div className="relative mb-3">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Procurar campo" className="h-6 rounded-none text-xs pr-7" />
              <Search className="w-3.5 h-3.5 text-slate-600 absolute right-2 top-1.5" />
            </div>
            <div className="flex-1 overflow-auto space-y-1 pr-1">
              {availableFields.length === 0 ? <div className="text-xs text-slate-400 py-4 text-center">Todos os campos estão em uso.</div> : availableFields.map(renderAvailableField)}
            </div>
          </aside>

          <section className="border-r border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-8">
            <Button type="button" variant="outline" size="icon" onClick={addField} className="h-10 w-9 rounded-none" title="Adicionar ao painel"><ArrowRight className="w-5 h-5" /></Button>
            <Button type="button" variant="outline" size="icon" onClick={removeField} className="h-10 w-9 rounded-none" title="Mover para disponíveis"><ArrowLeft className="w-5 h-5" /></Button>
          </section>

          <main className="min-w-0 overflow-hidden flex flex-col bg-white">
            <div className="h-9 border-b border-slate-300 bg-white flex items-end px-1 gap-1 overflow-x-auto">
              {draftPanels.map((panel) => {
                const isActive = activePanel?.id === panel.id;
                const isEmpty = (draftLayout[panel.id] || []).length === 0;
                return (
                  <button key={panel.id} type="button" onClick={() => { setActivePanelId(panel.id); setSelectedPanelField(null); }} className={`h-8 px-5 border border-b-0 text-xs whitespace-nowrap ${isActive ? "bg-white border-t-2 border-t-green-500 font-semibold text-slate-800" : "bg-slate-50 text-slate-700 hover:bg-white"} ${isEmpty && SYSTEM_PANEL_IDS.includes(panel.id) ? "opacity-60" : ""}`}>
                    {panel.label}
                  </button>
                );
              })}
              <Button type="button" variant="outline" size="icon" onClick={createPanel} className="h-8 w-10 rounded-none border-b-0 bg-green-500 hover:bg-green-600 text-white border-green-500 ml-1" title="Criar painel"><Plus className="w-4 h-4" /></Button>
              <Button type="button" variant="outline" size="icon" onClick={deletePanel} disabled={!canDeleteActivePanel} className="h-8 w-10 rounded-none border-b-0" title={canDeleteActivePanel ? "Excluir painel criado" : "Painel do sistema não pode ser excluído"}><Trash2 className="w-4 h-4" /></Button>
              <Button type="button" variant="outline" size="icon" onClick={() => movePanel(-1)} className="h-8 w-9 rounded-none border-b-0" title="Mover painel para esquerda"><ChevronLeft className="w-4 h-4" /></Button>
              <Button type="button" variant="outline" size="icon" onClick={() => movePanel(1)} className="h-8 w-9 rounded-none border-b-0" title="Mover painel para direita"><ChevronRight className="w-4 h-4" /></Button>
            </div>

            <div className="h-10 border-b border-slate-200 flex items-center gap-2 px-2 bg-slate-50">
              <span className="text-xs text-slate-600">Painel:</span>
              <Input value={activePanel?.label || ""} onChange={(e) => setDraftPanels((prev) => prev.map((panel) => panel.id === activePanel?.id ? { ...panel, label: e.target.value.toUpperCase() } : panel))} readOnly={activePanelIsSystem} className="h-7 w-72 rounded-none text-xs uppercase bg-white" />
              {activePanelIsSystem && <span className="text-[11px] text-slate-500">Painel do sistema: pode ser movido, mas não excluído.</span>}
            </div>

            <div className="flex-1 overflow-auto p-2" onDragOver={(e) => e.preventDefault()} onDrop={() => handleDrop("panel")}>
              <div className="flex flex-wrap gap-2 min-h-[120px]">
                {panelFields.length === 0 ? <div className="text-xs text-slate-400 p-4">Painel vazio. Se for painel do sistema, ele será ocultado ao salvar.</div> : panelFields.map(renderPanelField)}
              </div>
            </div>

            <div className="h-28 border-t border-slate-300 bg-slate-50 px-3 py-2 flex items-center gap-5">
              <div className="w-64">
                <div className="text-xs font-semibold text-slate-700">Configuração do campo</div>
                <div className="text-xs text-slate-500 truncate">{selectedField ? selectedField.label : "Selecione um campo do painel"}</div>
              </div>

              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <span>Oculto</span>
                <GreenCheck checked={!!selectedField && draftHiddenFieldIds.includes(selectedField.id)} disabled={!selectedField} onChange={(checked) => toggleListValue(setDraftHiddenFieldIds, selectedField?.id, checked)} />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <span>Bloqueado</span>
                <GreenCheck checked={!!selectedField && draftLockedFieldIds.includes(selectedField.id)} disabled={!selectedField} onChange={(checked) => toggleListValue(setDraftLockedFieldIds, selectedField?.id, checked)} />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <span>Obrigatório</span>
                <GreenCheck checked={!!selectedField && (selectedField.required || draftRequiredFieldIds.includes(selectedField.id))} disabled={!selectedField || selectedField?.required} onChange={(checked) => toggleListValue(setDraftRequiredFieldIds, selectedField?.id, checked)} />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-slate-600">
                <span>Totalizar</span>
                <GreenCheck checked={!!selectedField && !!draftAggregationConfig[selectedField.id]?.enabled} disabled={!selectedField || !selectedField?.totalizable} onChange={(checked) => setAggregationEnabled(selectedField?.id, checked)} />
              </label>
              <Select value={selectedField ? draftAggregationConfig[selectedField.id]?.type || "sum" : "sum"} onValueChange={(value) => selectedField && setAggregationType(selectedField.id, value)} disabled={!selectedField || !draftAggregationConfig[selectedField.id]?.enabled}>
                <SelectTrigger className="h-7 w-28 rounded-none text-xs bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGGREGATION_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value} className="text-xs">{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="icon" disabled={!selectedField} onClick={() => moveField(-1)} className="h-8 w-9 rounded-none" title="Mover campo para cima"><ChevronLeft className="w-4 h-4 rotate-90" /></Button>
              <Button type="button" variant="outline" size="icon" disabled={!selectedField} onClick={() => moveField(1)} className="h-8 w-9 rounded-none" title="Mover campo para baixo"><ChevronRight className="w-4 h-4 rotate-90" /></Button>
            </div>
          </main>
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-screen !max-w-none !h-screen !max-h-none overflow-hidden flex flex-col !p-0 !rounded-none">
        {content}
      </DialogContent>
    </Dialog>
  );
}
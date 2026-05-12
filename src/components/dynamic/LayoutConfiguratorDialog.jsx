import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Eye, EyeOff, Plus, Save, Trash2 } from "lucide-react";

const panelButtonClass = "h-7 rounded-none border-slate-300 px-2 text-xs justify-start";

export default function LayoutConfiguratorDialog({ open, onOpenChange, panels = [], fields = [], layout = {}, hiddenFieldIds = [], onSave }) {
  const [draftPanels, setDraftPanels] = useState(panels);
  const [draftLayout, setDraftLayout] = useState(layout);
  const [draftHiddenFieldIds, setDraftHiddenFieldIds] = useState(hiddenFieldIds);
  const [activePanelId, setActivePanelId] = useState(panels[0]?.id || "");
  const [selectedAvailable, setSelectedAvailable] = useState(null);
  const [selectedPanelField, setSelectedPanelField] = useState(null);

  React.useEffect(() => {
    if (!open) return;
    setDraftPanels(panels);
    setDraftLayout(layout);
    setDraftHiddenFieldIds(hiddenFieldIds);
    setActivePanelId(panels[0]?.id || "");
    setSelectedAvailable(null);
    setSelectedPanelField(null);
  }, [open, panels, layout, hiddenFieldIds]);

  const activePanel = draftPanels.find((panel) => panel.id === activePanelId) || draftPanels[0];
  const panelFieldIds = draftLayout[activePanel?.id] || [];
  const panelFields = panelFieldIds.map((id) => fields.find((field) => field.id === id)).filter(Boolean);
  const availableFields = useMemo(() => fields.filter((field) => !panelFieldIds.includes(field.id)), [fields, panelFieldIds]);

  const updatePanelLabel = (value) => {
    setDraftPanels((prev) => prev.map((panel) => panel.id === activePanel?.id ? { ...panel, label: value.toUpperCase() } : panel));
  };

  const createPanel = () => {
    const id = `painel_${Date.now()}`;
    setDraftPanels((prev) => [...prev, { id, label: "NOVO PAINEL" }]);
    setDraftLayout((prev) => ({ ...prev, [id]: [] }));
    setActivePanelId(id);
  };

  const deletePanel = () => {
    if (!activePanel || draftPanels.length <= 1) return;
    const nextPanels = draftPanels.filter((panel) => panel.id !== activePanel.id);
    const nextLayout = { ...draftLayout };
    delete nextLayout[activePanel.id];
    setDraftPanels(nextPanels);
    setDraftLayout(nextLayout);
    setActivePanelId(nextPanels[0]?.id || "");
  };

  const addField = () => {
    if (!selectedAvailable || !activePanel) return;
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: [...(prev[activePanel.id] || []), selectedAvailable] }));
    setSelectedAvailable(null);
  };

  const removeField = () => {
    if (!selectedPanelField || !activePanel) return;
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: (prev[activePanel.id] || []).filter((id) => id !== selectedPanelField) }));
    setSelectedPanelField(null);
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

  const toggleVisibility = () => {
    if (!selectedPanelField) return;
    setDraftHiddenFieldIds((prev) => prev.includes(selectedPanelField) ? prev.filter((id) => id !== selectedPanelField) : [...prev, selectedPanelField]);
  };

  const handleSave = () => {
    onSave?.({ panels: draftPanels, layout: draftLayout, hiddenFieldIds: draftHiddenFieldIds });
    onOpenChange(false);
  };

  const renderFieldRow = (field, selected, onClick) => {
    const hidden = draftHiddenFieldIds.includes(field.id);
    return (
      <button key={field.id} type="button" onClick={onClick} className={`w-full h-7 px-2 flex items-center justify-between border-b border-slate-200 text-left text-xs ${selected ? "bg-green-500 text-white" : hidden ? "bg-slate-100 text-slate-400 hover:bg-slate-100" : "bg-white hover:bg-slate-50 text-slate-700"}`}>
        <span className="truncate flex items-center gap-1">{hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}{field.label}</span>
        <span className="ml-2 text-[10px] opacity-70 uppercase">{field.type}</span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-screen !max-w-none !h-screen !max-h-none overflow-hidden flex flex-col !p-0 !rounded-none bg-white">
        <DialogHeader className="sr-only"><DialogTitle>Configurar layout do formulário</DialogTitle></DialogHeader>
        <div className="h-8 border-b border-slate-300 bg-white flex items-center gap-1 px-1">
          <Button type="button" variant="outline" size="sm" onClick={handleSave} className="h-7 rounded-none bg-green-500 hover:bg-green-600 text-white border-green-500 text-xs"><Save className="w-3.5 h-3.5 mr-1" />Salvar layout</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-7 rounded-none text-xs">Fechar</Button>
          <span className="ml-2 text-xs font-semibold text-slate-700 uppercase">Configuração de layout do formulário</span>
        </div>

        <div className="grid grid-cols-[220px_1fr] flex-1 min-h-0">
          <aside className="border-r border-slate-300 bg-slate-50 overflow-hidden flex flex-col">
            <div className="h-8 px-2 border-b border-slate-300 flex items-center justify-between text-xs font-semibold text-slate-700">
              Painéis
              <Button type="button" variant="outline" size="icon" onClick={createPanel} className="h-6 w-7 rounded-none"><Plus className="w-3.5 h-3.5" /></Button>
            </div>
            <div className="flex-1 overflow-auto p-1 space-y-1">
              {draftPanels.map((panel) => (
                <Button key={panel.id} type="button" variant="outline" onClick={() => setActivePanelId(panel.id)} className={`${panelButtonClass} w-full ${activePanel?.id === panel.id ? "bg-green-500 text-white hover:bg-green-600" : "bg-white"}`}>{panel.label}</Button>
              ))}
            </div>
          </aside>

          <main className="min-w-0 overflow-hidden flex flex-col">
            <div className="h-10 border-b border-slate-300 bg-white px-2 flex items-center gap-2">
              <span className="text-xs text-slate-600">Nome do painel:</span>
              <Input value={activePanel?.label || ""} onChange={(e) => updatePanelLabel(e.target.value)} className="h-7 w-72 rounded-none text-xs uppercase" />
              <Button type="button" variant="outline" size="sm" onClick={deletePanel} disabled={draftPanels.length <= 1} className="h-7 rounded-none text-xs"><Trash2 className="w-3.5 h-3.5 mr-1" />Excluir painel</Button>
            </div>

            <div className="grid grid-cols-[1fr_70px_1fr] gap-0 flex-1 min-h-0">
              <section className="min-w-0 border-r border-slate-300 flex flex-col">
                <div className="h-8 px-2 border-b border-slate-300 bg-slate-100 text-xs font-semibold flex items-center">Campos disponíveis</div>
                <div className="flex-1 overflow-auto">{availableFields.map((field) => renderFieldRow(field, selectedAvailable === field.id, () => setSelectedAvailable(field.id)))}</div>
              </section>

              <section className="border-r border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-1 p-1">
                <Button type="button" variant="outline" size="icon" onClick={addField} className="h-8 w-10 rounded-none"><ArrowRight className="w-4 h-4" /></Button>
                <Button type="button" variant="outline" size="icon" onClick={removeField} className="h-8 w-10 rounded-none"><ArrowLeft className="w-4 h-4" /></Button>
                <div className="h-px w-full bg-slate-300 my-1" />
                <Button type="button" variant="outline" size="icon" onClick={() => moveField(-1)} className="h-8 w-10 rounded-none"><ChevronUp className="w-4 h-4" /></Button>
                <Button type="button" variant="outline" size="icon" onClick={() => moveField(1)} className="h-8 w-10 rounded-none"><ChevronDown className="w-4 h-4" /></Button>
                <Button type="button" variant="outline" size="icon" onClick={toggleVisibility} className="h-8 w-10 rounded-none" title="Mostrar/Ocultar campo"><Eye className="w-4 h-4" /></Button>
              </section>

              <section className="min-w-0 flex flex-col">
                <div className="h-8 px-2 border-b border-slate-300 bg-slate-100 text-xs font-semibold flex items-center">Campos do painel</div>
                <div className="flex-1 overflow-auto">{panelFields.map((field) => renderFieldRow(field, selectedPanelField === field.id, () => setSelectedPanelField(field.id)))}</div>
              </section>
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
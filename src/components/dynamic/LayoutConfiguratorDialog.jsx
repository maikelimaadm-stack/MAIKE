import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Eye, EyeOff, Plus, Save, Search, Trash2, Lock, Unlock, AlertCircle } from "lucide-react";

const SYSTEM_PANEL_IDS = ["geral", "compra", "identificacao", "observacoes", "campos_personalizados"];

export default function LayoutConfiguratorDialog({ open, onOpenChange, panels = [], fields = [], layout = {}, hiddenFieldIds = [], lockedFieldIds = [], requiredFieldIds = [], onSave }) {
  const [draftPanels, setDraftPanels] = useState(panels);
  const [draftLayout, setDraftLayout] = useState(layout);
  const [draftHiddenFieldIds, setDraftHiddenFieldIds] = useState(hiddenFieldIds);
  const [draftLockedFieldIds, setDraftLockedFieldIds] = useState(lockedFieldIds);
  const [draftRequiredFieldIds, setDraftRequiredFieldIds] = useState(requiredFieldIds);
  const [activePanelId, setActivePanelId] = useState(panels[0]?.id || "");
  const [selectedAvailable, setSelectedAvailable] = useState(null);
  const [selectedPanelField, setSelectedPanelField] = useState(null);
  const [search, setSearch] = useState("");

  React.useEffect(() => {
    if (!open) return;
    setDraftPanels(panels);
    setDraftLayout(layout);
    setDraftHiddenFieldIds(hiddenFieldIds);
    setDraftLockedFieldIds(lockedFieldIds);
    setDraftRequiredFieldIds(requiredFieldIds);
    setActivePanelId(panels[0]?.id || "");
    setSelectedAvailable(null);
    setSelectedPanelField(null);
    setSearch("");
  }, [open, panels, layout, hiddenFieldIds, lockedFieldIds, requiredFieldIds]);

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

  const moveField = (direction) => {
    if (!selectedPanelField || !activePanel) return;
    const list = [...panelFieldIds];
    const index = list.indexOf(selectedPanelField);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    [list[index], list[nextIndex]] = [list[nextIndex], list[index]];
    setDraftLayout((prev) => ({ ...prev, [activePanel.id]: list }));
  };

  const toggleListValue = (setter, fieldId) => {
    if (!fieldId) return;
    setter((prev) => prev.includes(fieldId) ? prev.filter((id) => id !== fieldId) : [...prev, fieldId]);
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
      requiredFieldIds: draftRequiredFieldIds
    });
    onOpenChange(false);
  };

  const fieldUsageLabel = (fieldId) => {
    const owner = draftPanels.find((panel) => (draftLayout[panel.id] || []).includes(fieldId));
    return owner?.label || "";
  };

  const renderAvailableField = (field) => (
    <button key={field.id} type="button" onClick={() => setSelectedAvailable(field.id)} className={`w-full rounded px-2 py-1.5 text-left ${selectedAvailable === field.id ? "bg-slate-700 text-white" : "bg-slate-600 text-white hover:bg-slate-700"}`}>
      <div className="text-xs font-semibold truncate">{field.label}</div>
      <div className="text-[10px] opacity-80 truncate">Disponível</div>
    </button>
  );

  const renderPanelField = (field) => {
    const selected = selectedPanelField === field.id;
    const hidden = draftHiddenFieldIds.includes(field.id);
    const locked = draftLockedFieldIds.includes(field.id);
    const required = field.required || draftRequiredFieldIds.includes(field.id);
    return (
      <button key={field.id} type="button" onClick={() => setSelectedPanelField(field.id)} className={`h-8 min-w-[210px] px-2 rounded text-left border flex items-center justify-between ${selected ? "ring-2 ring-slate-600" : ""} ${hidden ? "bg-slate-100 text-slate-400 border-slate-300" : required ? "bg-red-500 text-white border-red-500" : "bg-slate-600 text-white border-slate-600"}`}>
        <span className="text-xs font-semibold truncate">{field.label}</span>
        <span className="flex items-center gap-1 ml-2 opacity-90">
          {hidden && <EyeOff className="w-3 h-3" />}
          {locked && <Lock className="w-3 h-3" />}
          {required && <AlertCircle className="w-3 h-3" />}
        </span>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !w-screen !max-w-none !h-screen !max-h-none overflow-hidden flex flex-col !p-0 !rounded-none bg-white">
        <DialogHeader className="sr-only"><DialogTitle>Configuração da Tela</DialogTitle></DialogHeader>

        <div className="h-[78px] border-b border-slate-300 bg-white px-2 flex items-start justify-between">
          <div className="flex items-center gap-2 pt-3">
            <button type="button" onClick={() => onOpenChange(false)} className="text-slate-400 hover:text-slate-700"><ArrowLeft className="w-5 h-5" /></button>
            <div>
              <h2 className="text-2xl leading-tight text-slate-800">Configuração da Tela</h2>
              <p className="text-xs text-slate-700 font-semibold mt-1">Cadastro de Lotes</p>
            </div>
          </div>
          <div className="flex items-center gap-1 pt-2">
            <Button type="button" variant="outline" size="sm" className="h-7 rounded-none text-xs">Iniciar Tour</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 rounded-none text-xs">Copiar personalização</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-7 rounded-none text-xs">Cancelar</Button>
            <Button type="button" variant="outline" size="sm" className="h-7 rounded-none text-xs">Restaurar configuração</Button>
            <Button type="button" size="sm" onClick={handleSave} className="h-7 rounded-none bg-slate-700 hover:bg-slate-800 text-white text-xs"><Save className="w-3.5 h-3.5 mr-1" />Salvar</Button>
          </div>
        </div>

        <div className="grid grid-cols-[240px_45px_1fr] flex-1 min-h-0">
          <aside className="border-r border-slate-300 bg-white p-2 overflow-hidden flex flex-col">
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
            <Button type="button" variant="outline" size="icon" onClick={removeField} className="h-10 w-9 rounded-none" title="Remover do painel"><ArrowLeft className="w-5 h-5" /></Button>
          </section>

          <main className="min-w-0 overflow-hidden flex flex-col bg-white">
            <div className="h-38 border-b border-slate-300 bg-white flex items-end px-1 gap-1 overflow-x-auto">
              <Button type="button" variant="outline" size="icon" className="h-8 w-8 rounded-none border-b-0" title="Painéis"><span className="text-xs">▣</span></Button>
              {draftPanels.map((panel) => {
                const isActive = activePanel?.id === panel.id;
                const isEmpty = (draftLayout[panel.id] || []).length === 0;
                return (
                  <button key={panel.id} type="button" onClick={() => { setActivePanelId(panel.id); setSelectedPanelField(null); }} className={`h-8 px-6 border border-b-0 text-sm whitespace-nowrap ${isActive ? "bg-white border-t-2 border-t-green-500 font-semibold text-slate-800" : "bg-slate-50 text-slate-700 hover:bg-white"} ${isEmpty && SYSTEM_PANEL_IDS.includes(panel.id) ? "opacity-60" : ""}`}>
                    {panel.label}
                  </button>
                );
              })}
              <Button type="button" variant="outline" size="icon" onClick={createPanel} className="h-8 w-10 rounded-none border-b-0 bg-green-500 hover:bg-green-600 text-white border-green-500 ml-2" title="Criar painel"><Plus className="w-4 h-4" /></Button>
              <Button type="button" variant="outline" size="icon" onClick={deletePanel} disabled={!canDeleteActivePanel} className="h-8 w-10 rounded-none border-b-0" title={canDeleteActivePanel ? "Excluir painel criado" : "Painel do sistema não pode ser excluído"}><Trash2 className="w-4 h-4" /></Button>
            </div>

            <div className="h-10 border-b border-slate-200 flex items-center gap-2 px-2 bg-slate-50">
              <span className="text-xs text-slate-600">Painel:</span>
              <Input value={activePanel?.label || ""} onChange={(e) => setDraftPanels((prev) => prev.map((panel) => panel.id === activePanel?.id ? { ...panel, label: e.target.value.toUpperCase() } : panel))} readOnly={activePanelIsSystem} className="h-7 w-72 rounded-none text-xs uppercase bg-white" />
              {activePanelIsSystem && <span className="text-[11px] text-slate-500">Painel do sistema: não pode ser excluído.</span>}
            </div>

            <div className="flex-1 overflow-auto p-2">
              <div className="flex flex-wrap gap-2 min-h-[120px]">
                {panelFields.length === 0 ? <div className="text-xs text-slate-400 p-4">Painel vazio. Se for painel do sistema, ele será ocultado ao salvar.</div> : panelFields.map(renderPanelField)}
              </div>
            </div>

            <div className="h-24 border-t border-slate-300 bg-slate-50 px-3 py-2 flex items-center gap-2">
              <div className="w-72">
                <div className="text-xs font-semibold text-slate-700">Configuração do campo</div>
                <div className="text-xs text-slate-500 truncate">{selectedField ? selectedField.label : "Selecione um campo do painel"}</div>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={!selectedField} onClick={() => toggleListValue(setDraftHiddenFieldIds, selectedField?.id)} className="h-8 rounded-none text-xs">
                {selectedField && draftHiddenFieldIds.includes(selectedField.id) ? <Eye className="w-3.5 h-3.5 mr-1" /> : <EyeOff className="w-3.5 h-3.5 mr-1" />}Oculto
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!selectedField} onClick={() => toggleListValue(setDraftLockedFieldIds, selectedField?.id)} className="h-8 rounded-none text-xs">
                {selectedField && draftLockedFieldIds.includes(selectedField.id) ? <Unlock className="w-3.5 h-3.5 mr-1" /> : <Lock className="w-3.5 h-3.5 mr-1" />}Bloqueado
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={!selectedField || selectedField?.required} onClick={() => toggleListValue(setDraftRequiredFieldIds, selectedField?.id)} className="h-8 rounded-none text-xs">
                <AlertCircle className="w-3.5 h-3.5 mr-1" />Obrigatório
              </Button>
              <Button type="button" variant="outline" size="icon" disabled={!selectedField} onClick={() => moveField(-1)} className="h-8 w-9 rounded-none"><ChevronUp className="w-4 h-4" /></Button>
              <Button type="button" variant="outline" size="icon" disabled={!selectedField} onClick={() => moveField(1)} className="h-8 w-9 rounded-none"><ChevronDown className="w-4 h-4" /></Button>
              {selectedField?.required && <span className="text-[11px] text-slate-500">Obrigatoriedade original não pode ser removida.</span>}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
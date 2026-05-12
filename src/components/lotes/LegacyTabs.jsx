import React from "react";

const SYSTEM_PANEL_IDS = ["geral", "compra", "identificacao", "observacoes", "campos_personalizados"];
const isCustomPanel = (tab) => tab && !SYSTEM_PANEL_IDS.includes(tab.id);
const displayCustomPrefix = (label, shouldPrefix) => shouldPrefix && !String(label || "").trim().startsWith("-") ? `- ${label}` : label;

export default function LegacyTabs({ tabs = [], activeTab, onChange }) {
  return (
    <div className="flex items-end gap-0 overflow-x-auto border-b border-slate-300 bg-white md:px-12">
      {tabs.map((tab) =>
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        className={`h-8 border border-b-0 text-xs whitespace-nowrap px-5 transition-all border-t-2 border-t-green-500 ${activeTab === tab.id ? "bg-white text-slate-800 font-semibold -mb-px" : ""}`}>
        
          {displayCustomPrefix(tab.label, isCustomPanel(tab))}
        </button>
      )}
    </div>);

}
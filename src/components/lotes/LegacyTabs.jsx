import React from "react";

const SYSTEM_PANEL_IDS = ["geral", "compra", "identificacao", "observacoes", "campos_personalizados"];
const isCustomPanel = (tab) => tab && !SYSTEM_PANEL_IDS.includes(tab.id);
const CustomMarker = () => <span className="pointer-events-none absolute bottom-0 right-0 z-10 w-0 h-0 border-l-[7px] border-l-transparent border-b-[7px] border-b-green-500" />;

export default function LegacyTabs({ tabs = [], activeTab, onChange }) {
  return (
    <div className="relative flex items-end gap-0 overflow-x-auto overflow-y-hidden bg-white md:px-12 pr-3 scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-slate-100 before:absolute before:left-0 before:right-0 before:bottom-0 before:h-px before:bg-slate-300">
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative z-10 flex-none h-8 min-w-max px-4 mx-0.5 border border-slate-300 text-xs whitespace-nowrap overflow-hidden transition-colors rounded-[2px_2px_0px_0px] ${active ? "bg-white text-slate-800 font-semibold border-t-2 border-t-green-500 border-b-white" : "bg-slate-50 text-slate-700 border-b-slate-300 hover:bg-white"}`}>
            {isCustomPanel(tab) && <CustomMarker />}
            {tab.label}
          </button>);

      })}
    </div>);

}
import React from "react";

export default function LegacyTabs({ tabs = [], activeTab, onChange }) {
  return (
    <div className="flex items-end gap-0 overflow-x-auto border-b border-slate-300 bg-white md:px-12">
      {tabs.map((tab) =>
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        className={`h-8 px-5 border border-b-0 text-xs whitespace-nowrap ${activeTab === tab.id ? "bg-white text-slate-800 font-semibold -mb-px" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>
        
          {tab.label}
        </button>
      )}
    </div>);

}
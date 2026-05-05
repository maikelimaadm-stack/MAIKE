import React from "react";
import { Button } from "@/components/ui/button";
import { Home, Filter, Table, Check, AlertTriangle, Search, Star, Clock, FileText, Paperclip, Zap, MoreHorizontal, Settings, ChevronDown, X } from "lucide-react";

const iconButtonClass = "h-7 w-8 rounded-none border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700";

export default function LegacyRecordToolbar({ title, statusLabel = "Editando registro", onCancel }) {
  return (
    <div className="border border-slate-300 bg-slate-100 shadow-sm">
      <div className="flex items-center gap-0 border-b border-slate-300 overflow-x-auto whitespace-nowrap">
        <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Home className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Filter className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-7 rounded-none border-slate-300 bg-slate-50 hover:bg-slate-100"><ChevronDown className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Table className="w-3.5 h-3.5" /></Button>
        <Button type="submit" variant="outline" size="icon" className="h-7 w-12 rounded-none border-slate-300 bg-slate-50 hover:bg-emerald-50 text-slate-800"><Check className="w-4 h-4" /></Button>
        <button type="button" onClick={onCancel} className="h-7 px-3 inline-flex items-center gap-1 border-y border-r border-slate-300 bg-slate-50 hover:bg-amber-50 text-xs text-slate-700">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Descartar
        </button>

        <div className="mx-1 h-10 px-4 inline-flex items-center gap-2 bg-white border-2 border-green-500 shadow-[0_0_0_1px_rgba(34,197,94,0.25)] text-xs font-semibold text-slate-700 hidden">
          {statusLabel}
          <X className="w-3 h-3 text-slate-400" />
        </div>

        <div className="ml-auto flex items-center gap-0">
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Search className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Star className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Clock className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><FileText className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Paperclip className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Zap className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><MoreHorizontal className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Settings className="w-3.5 h-3.5" /></Button>
        </div>
      </div>
      <div className="h-8 px-2 flex items-center gap-2 bg-white border-b border-slate-200">
        <span className="px-1.5 py-0.5 rounded-sm bg-slate-500 text-white text-[11px] font-bold">LOTE</span>
        <span className="text-xs font-semibold text-slate-700">{title}</span>
      </div>
    </div>);

}
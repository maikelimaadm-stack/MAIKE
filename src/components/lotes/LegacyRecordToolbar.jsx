import React from "react";
import { Button } from "@/components/ui/button";
import { Home, Filter, Table, Check, AlertTriangle, Search, Star, Clock, FileText, Paperclip, Zap, MoreHorizontal, Settings, ChevronDown, Plus, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Trash2, Copy, RefreshCw } from "lucide-react";

const iconButtonClass = "h-7 w-8 rounded-none border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700";

export default function LegacyRecordToolbar({ title, operationLabel, showSaveActions = false, onCancel, onSettingsClick, onToggleView, total = 0, currentIndex = 0, onNew, onFirst, onPrevious, onNext, onLast, onDelete, onDuplicate, onRefresh }) {
  const canNavigate = total > 0;
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= total - 1;
  return (
    <div className="bg-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-0 border-b border-slate-300 overflow-x-auto whitespace-nowrap">
        <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Home className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-9 rounded-none border-red-500 bg-red-500 hover:bg-red-600 text-white"><Filter className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-7 rounded-none border-red-500 bg-red-500 hover:bg-red-600 text-white"><ChevronDown className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onToggleView} className={iconButtonClass} title="Visualizar tabela">
          <Table className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={onNew} className="h-7 w-8 rounded-none border-green-500 bg-green-500 hover:bg-green-600 text-white"><Plus className="w-4 h-4" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onFirst} disabled={!canNavigate || isFirst} className={iconButtonClass} title="Primeiro registro"><ChevronsLeft className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onPrevious} disabled={!canNavigate || isFirst} className={iconButtonClass} title="Registro anterior"><ChevronLeft className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onNext} disabled={!canNavigate || isLast} className={iconButtonClass} title="Próximo registro"><ChevronRight className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onLast} disabled={!canNavigate || isLast} className={iconButtonClass} title="Último registro"><ChevronsRight className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onDelete} disabled={!canNavigate} className={iconButtonClass}><Trash2 className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onDuplicate} disabled={!canNavigate} className={iconButtonClass}><Copy className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onRefresh} className={iconButtonClass}><RefreshCw className="w-3.5 h-3.5" /></Button>
        {showSaveActions &&
        <>
            <Button type="submit" variant="outline" size="icon" className="h-7 w-12 rounded-none border-slate-300 bg-slate-50 hover:bg-emerald-50 text-slate-800" title="Salvar alterações"><Check className="w-4 h-4" /></Button>
            <button type="button" onClick={onCancel} className="h-7 px-3 inline-flex items-center gap-1 border-y border-r border-slate-300 bg-slate-50 hover:bg-amber-50 text-xs text-slate-700">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Descartar
            </button>
          </>
        }

        


        

        <div className="ml-auto flex items-center gap-0">
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Search className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Star className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Clock className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><FileText className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Paperclip className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Zap className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><MoreHorizontal className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass} onClick={onSettingsClick}><Settings className="w-3.5 h-3.5" /></Button>
          <div className="h-7 min-w-12 px-2 border-y border-r border-slate-300 bg-white flex items-center justify-center text-xs text-slate-600">
            {total > 0 ? `${currentIndex + 1}/${total}` : total}
          </div>
        </div>
      </div>
      <div className="h-8 flex items-center gap-2 bg-white border-b border-slate-200 pr-2 pl-2 my-1">
        <span className="px-1.5 py-0.5 rounded-sm bg-slate-500 text-white text-[11px] font-bold">LOTE</span>
        <span className="text-xs font-semibold text-slate-700 truncate min-w-0 flex-1">{title}</span>
        {operationLabel &&
        <span className="ml-auto text-[11px] font-bold text-emerald-700 uppercase whitespace-nowrap">
            {operationLabel}
          </span>
        }
      </div>
    </div>);

}
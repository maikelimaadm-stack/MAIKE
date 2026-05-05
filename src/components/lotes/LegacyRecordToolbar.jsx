import React from "react";
import { Button } from "@/components/ui/button";
import { Home, Filter, Table, Check, AlertTriangle, Search, Star, Clock, FileText, Paperclip, Zap, MoreHorizontal, Settings, ChevronDown, Plus, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Trash2, Copy, RefreshCw } from "lucide-react";

const iconButtonClass = "h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-slate-100 bg-white hover:bg-slate-50 text-slate-700 shadow-none";

export default function LegacyRecordToolbar({ title, operationLabel, showSaveActions = false, onCancel, onSettingsClick, onToggleView, total = 0, currentIndex = 0, onNew, onFirst, onPrevious, onNext, onLast, onDelete, onDuplicate, onRefresh }) {
  const canNavigate = total > 0;
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= total - 1;
  return (
    <div className="border-[0.5px] border-slate-100 bg-white shadow-none overflow-hidden">
      <div className="flex items-center gap-0 border-b-[0.5px] border-slate-100 overflow-x-auto whitespace-nowrap">
        <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Home className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-9 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-red-400 bg-red-500 hover:bg-red-600 text-white shadow-none"><Filter className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-7 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-red-400 bg-red-500 hover:bg-red-600 text-white shadow-none"><ChevronDown className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onToggleView} className={iconButtonClass} title="Visualizar tabela">
          <Table className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={onNew} className="h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-green-400 bg-green-500 hover:bg-green-600 text-white shadow-none"><Plus className="w-4 h-4" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onFirst} disabled={!canNavigate || isFirst} className={iconButtonClass} title="Primeiro registro"><ChevronsLeft className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onPrevious} disabled={!canNavigate || isFirst} className={iconButtonClass} title="Registro anterior"><ChevronLeft className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onNext} disabled={!canNavigate || isLast} className={iconButtonClass} title="Próximo registro"><ChevronRight className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onLast} disabled={!canNavigate || isLast} className={iconButtonClass} title="Último registro"><ChevronsRight className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onDelete} disabled={!canNavigate} className={iconButtonClass}><Trash2 className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onDuplicate} disabled={!canNavigate} className={iconButtonClass}><Copy className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onRefresh} className={iconButtonClass}><RefreshCw className="w-3.5 h-3.5" /></Button>
        {showSaveActions &&
        <>
            <Button type="submit" variant="outline" size="icon" className={iconButtonClass} title="Salvar alterações"><Check className="w-4 h-4" /></Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancel} className="h-7 px-3 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-slate-100 bg-slate-50 hover:bg-amber-50 text-xs text-slate-700 shadow-none">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> Descartar
            </Button>
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
          <div className="h-7 min-w-12 px-2 border-y-0 border-r-[0.5px] border-slate-100 bg-white flex items-center justify-center text-xs text-slate-600">
            {total > 0 ? `${currentIndex + 1}/${total}` : total}
          </div>
        </div>
      </div>
      <div className="mt-1 h-8 flex items-center gap-2 bg-white border-t-[0.5px] border-b-[0.5px] border-slate-100 px-2">
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
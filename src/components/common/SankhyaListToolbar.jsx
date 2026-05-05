import React from "react";
import { Button } from "@/components/ui/button";
import {
  Home,
  Filter,
  List,
  Table,
  Plus,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Trash2,
  Copy,
  RefreshCw,
  Search,
  Star,
  Clock,
  FileText,
  Paperclip,
  Zap,
  MoreHorizontal,
  Settings,
  ChevronDown } from
"lucide-react";

const iconButtonClass = "h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-slate-200/60 bg-white hover:bg-slate-50 text-slate-700 shadow-none";

export default function SankhyaListToolbar({
  viewMode = "table",
  total = 0,
  currentIndex = 0,
  searchValue = "",
  onSearchChange,
  onNew,
  onToggleView,
  onFirst,
  onPrevious,
  onNext,
  onLast,
  onDelete,
  onDuplicate,
  onRefresh,
  onSettingsClick,
  selectedCount = 0,
  title = "REGISTROS",
  recordLabel = "LOTE",
  operationLabel
}) {
  const canNavigate = viewMode === "record" && total > 0;
  const showRecordNavigation = viewMode === "record";
  const showDeleteSelectionAction = viewMode === "table" && selectedCount > 0;
  const showDuplicateSelectionAction = viewMode === "table" && selectedCount === 1;

  return (
    <div className="border-[0.5px] border-slate-200/60 bg-white shadow-none overflow-hidden">
      <div className="flex items-center gap-0 overflow-x-auto whitespace-nowrap bg-transparent border-b-[0.5px] border-slate-200/60">
        <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Home className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-9 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-red-400 bg-red-500 hover:bg-red-600 text-white shadow-none"><Filter className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-7 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-red-400 bg-red-500 hover:bg-red-600 text-white shadow-none"><ChevronDown className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onToggleView} className={iconButtonClass} title={viewMode === "table" ? "Visualizar registro" : "Visualizar tabela"}>
          {viewMode === "table" ? <List className="w-3.5 h-3.5" /> : <Table className="w-3.5 h-3.5" />}
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={onNew} className="h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-green-400 bg-green-500 hover:bg-green-600 text-white shadow-none"><Plus className="w-4 h-4" /></Button>
        {showRecordNavigation && <Button type="button" variant="outline" size="icon" onClick={onFirst} disabled={!canNavigate} className={iconButtonClass}><ChevronsLeft className="w-3.5 h-3.5" /></Button>}
        {showRecordNavigation && <Button type="button" variant="outline" size="icon" onClick={onPrevious} disabled={!canNavigate} className={iconButtonClass}><ChevronLeft className="w-3.5 h-3.5" /></Button>}
        {showRecordNavigation && <Button type="button" variant="outline" size="icon" onClick={onNext} disabled={!canNavigate} className={iconButtonClass}><ChevronRight className="w-3.5 h-3.5" /></Button>}
        {showRecordNavigation && <Button type="button" variant="outline" size="icon" onClick={onLast} disabled={!canNavigate} className={iconButtonClass}><ChevronsRight className="w-3.5 h-3.5" /></Button>}
        {showDeleteSelectionAction && <Button type="button" variant="outline" size="icon" onClick={onDelete} className={iconButtonClass}><Trash2 className="w-3.5 h-3.5" /></Button>}
        {showDuplicateSelectionAction && <Button type="button" variant="outline" size="icon" onClick={onDuplicate} className={iconButtonClass}><Copy className="w-3.5 h-3.5" /></Button>}
        <Button type="button" variant="outline" size="icon" onClick={onRefresh} className={iconButtonClass}><RefreshCw className="w-3.5 h-3.5" /></Button>

        <div className="ml-auto flex items-center gap-0">
          <div className="relative h-7 w-44 md:w-56 border-y-0 border-l-[0.5px] border-slate-200/60 bg-white">
            <input
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Pesquisar registros..."
              className="h-full w-full px-2 pr-7 text-xs bg-white outline-none" />
            
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          </div>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Star className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Clock className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><FileText className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Paperclip className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Zap className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><MoreHorizontal className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" onClick={onSettingsClick} className={iconButtonClass}><Settings className="w-3.5 h-3.5" /></Button>
          <div className="h-7 min-w-12 px-2 border-y-0 border-r-[0.5px] bg-white flex items-center justify-center text-xs text-slate-600 border-slate-200/60">
            {viewMode === "record" && total > 0 ? `${currentIndex + 1}/${total}` : total}
          </div>
        </div>
      </div>
      {viewMode === "record" &&
      <div className="mt-1 h-8 flex items-center gap-2 bg-white border-t border-b-[0.5px] border-slate-200 px-2">
          {recordLabel && <span className="px-1.5 py-0.5 rounded-sm bg-slate-500 text-white text-[11px] font-bold">{recordLabel}</span>}
          <span className="text-xs font-semibold text-slate-700 truncate min-w-0 flex-1">{title}</span>
          <span className="ml-auto text-[11px] font-bold text-emerald-700 uppercase whitespace-nowrap">
            {operationLabel || "VISUALIZAÇÃO DE REGISTRO"}
          </span>
        </div>
      }
    </div>);

}
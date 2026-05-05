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
  ChevronDown
} from "lucide-react";

const iconButtonClass = "h-7 w-8 rounded-none border-y-0 border-l-0 border-r border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 shadow-none";

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
  selectedCount = 0
}) {
  const canNavigate = viewMode === "record" && total > 0;
  const showRecordNavigation = viewMode === "record";
  const showDeleteSelectionAction = viewMode === "table" && selectedCount > 0;
  const showDuplicateSelectionAction = viewMode === "table" && selectedCount === 1;

  return (
    <div className="border border-slate-300 bg-slate-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-0 border-b border-slate-300 overflow-x-auto whitespace-nowrap">
        <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Home className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-9 rounded-none border-y-0 border-l-0 border-r border-red-600 bg-red-500 hover:bg-red-600 text-white shadow-none"><Filter className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" className="h-7 w-7 rounded-none border-y-0 border-l-0 border-r border-red-600 bg-red-500 hover:bg-red-600 text-white shadow-none"><ChevronDown className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onToggleView} className={iconButtonClass} title={viewMode === "table" ? "Visualizar registro" : "Visualizar tabela"}>
          {viewMode === "table" ? <List className="w-3.5 h-3.5" /> : <Table className="w-3.5 h-3.5" />}
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={onNew} className="h-7 w-8 rounded-none border-y-0 border-l-0 border-r border-green-600 bg-green-500 hover:bg-green-600 text-white shadow-none"><Plus className="w-4 h-4" /></Button>
        {showRecordNavigation && <Button type="button" variant="outline" size="icon" onClick={onFirst} disabled={!canNavigate} className={iconButtonClass}><ChevronsLeft className="w-3.5 h-3.5" /></Button>}
        {showRecordNavigation && <Button type="button" variant="outline" size="icon" onClick={onPrevious} disabled={!canNavigate} className={iconButtonClass}><ChevronLeft className="w-3.5 h-3.5" /></Button>}
        {showRecordNavigation && <Button type="button" variant="outline" size="icon" onClick={onNext} disabled={!canNavigate} className={iconButtonClass}><ChevronRight className="w-3.5 h-3.5" /></Button>}
        {showRecordNavigation && <Button type="button" variant="outline" size="icon" onClick={onLast} disabled={!canNavigate} className={iconButtonClass}><ChevronsRight className="w-3.5 h-3.5" /></Button>}
        {showDeleteSelectionAction && <Button type="button" variant="outline" size="icon" onClick={onDelete} className={iconButtonClass}><Trash2 className="w-3.5 h-3.5" /></Button>}
        {showDuplicateSelectionAction && <Button type="button" variant="outline" size="icon" onClick={onDuplicate} className={iconButtonClass}><Copy className="w-3.5 h-3.5" /></Button>}
        <Button type="button" variant="outline" size="icon" onClick={onRefresh} className={iconButtonClass}><RefreshCw className="w-3.5 h-3.5" /></Button>

        <div className="ml-auto flex items-center gap-0">
          <div className="relative h-7 w-44 md:w-56 border-y-0 border-l border-slate-300 bg-white">
            <input
              value={searchValue}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Pesquisar registros..."
              className="h-full w-full px-2 pr-7 text-xs bg-white outline-none"
            />
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          </div>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Star className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Clock className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><FileText className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Paperclip className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><Zap className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" className={iconButtonClass}><MoreHorizontal className="w-3.5 h-3.5" /></Button>
          <Button type="button" variant="outline" size="icon" onClick={onSettingsClick} className={iconButtonClass}><Settings className="w-3.5 h-3.5" /></Button>
          <div className="h-7 min-w-12 px-2 border-y-0 border-r border-slate-300 bg-white flex items-center justify-center text-xs text-slate-600">
            {viewMode === "record" && total > 0 ? `${currentIndex + 1}/${total}` : total}
          </div>
        </div>
      </div>
    </div>
  );
}
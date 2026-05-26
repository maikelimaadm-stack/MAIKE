import React from "react";
import { Button } from "@/components/ui/button";
import { Home, Filter, List, Check, X, FileText, Paperclip, MoreHorizontal, Settings, Plus, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Trash2, Copy, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";

const toolbarLineClass = "border-slate-300";
const iconButtonClass = "h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-none";
const fileButtonClass = iconButtonClass;

export default function LegacyRecordToolbar({ title, operationLabel, badgeLabel = "LOTE", showSaveActions = false, showEditAction = false, showDeleteDuplicateActions = true, showUtilityActions = true, onCancel, onSave, onEditRecord, onSettingsClick, onLayoutConfigClick, onAttachClick, attachDisabled = false, onToggleView, onBack, total = 0, currentIndex = 0, onNew, onFirst, onPrevious, onNext, onLast, onDelete, onDuplicate, onRefresh, filterOpen = false, filterActive = false, onToggleFilter, onClearFilter }) {
  const canNavigate = total > 0;
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= total - 1;
  return (
    <div className="bg-white shadow-none overflow-hidden">
      <div className={`flex items-center gap-0 overflow-x-auto whitespace-nowrap bg-white border-y ${toolbarLineClass} [&>*:first-child]:border-l-[0.5px]`}>


        {onBack && <Button type="button" variant="outline" size="icon" onClick={onBack} className={iconButtonClass} title="Voltar"><ChevronLeft className="w-3.5 h-3.5" /></Button>}
        <Button type="button" variant="outline" size="icon" onClick={onToggleView} className={iconButtonClass} title="Visualizar tabela">
          <List className="w-3.5 h-3.5" />
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={onNew} className="h-7 w-8 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-green-400 bg-green-500 hover:bg-green-600 text-white shadow-none"><Plus className="w-4 h-4" /></Button>
        {onToggleFilter && <Button type="button" variant="outline" size="icon" onClick={onToggleFilter} className={filterOpen || filterActive ? "relative h-7 w-9 rounded-none border-y-0 border-l-0 border-r-[0.5px] border-red-400 bg-red-500 hover:bg-red-600 text-white shadow-none" : iconButtonClass} title="Filtros">
          <Filter className="w-3.5 h-3.5" />
          {filterActive &&
          <span
            onClick={(e) => {e.stopPropagation();onClearFilter?.();}}
            className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-white text-red-600 border border-red-500 text-[10px] leading-[12px] font-bold">
            ×
          </span>
          }
        </Button>}
        <Button type="button" variant="outline" size="icon" onClick={onFirst} disabled={!canNavigate || isFirst} className={iconButtonClass} title="Primeiro registro"><ChevronsLeft className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onPrevious} disabled={!canNavigate || isFirst} className={iconButtonClass} title="Registro anterior"><ChevronLeft className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onNext} disabled={!canNavigate || isLast} className={iconButtonClass} title="Próximo registro"><ChevronRight className="w-3.5 h-3.5" /></Button>
        <Button type="button" variant="outline" size="icon" onClick={onLast} disabled={!canNavigate || isLast} className={iconButtonClass} title="Último registro"><ChevronsRight className="w-3.5 h-3.5" /></Button>
        {showEditAction &&
        <Button type="button" variant="outline" size="icon" onClick={onEditRecord} className={fileButtonClass} title="Editar registro">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        }
        {showDeleteDuplicateActions && <Button type="button" variant="outline" size="icon" onClick={onDelete} disabled={!canNavigate} className={showEditAction ? iconButtonClass : fileButtonClass} title="Excluir registro"><Trash2 className="w-3.5 h-3.5" /></Button>}
        {showDeleteDuplicateActions && <Button type="button" variant="outline" size="icon" onClick={onDuplicate} disabled={!canNavigate} className={iconButtonClass} title="Duplicar registro"><Copy className="w-3.5 h-3.5" /></Button>}

        {showSaveActions &&
        <>
            <Button type="button" variant="outline" size="icon" onClick={onSave} className={iconButtonClass} title="Salvar alterações"><Check className="w-4 h-4" /></Button>
            <Button type="button" variant="outline" size="icon" onClick={onCancel} className={iconButtonClass} title="Descartar">
              <X className="w-3.5 h-3.5" />
            </Button>
          </>
        }

        


        

        <div className="ml-auto flex items-center gap-0 [&>*:first-child]:border-l-[0.5px]">

          {showUtilityActions && <Button type="button" variant="outline" size="icon" className={showDeleteDuplicateActions ? iconButtonClass : fileButtonClass}><FileText className="w-3.5 h-3.5" /></Button>}
          {showUtilityActions && <Button type="button" variant="outline" size="icon" onClick={onAttachClick} disabled={attachDisabled} className={iconButtonClass} title={attachDisabled ? "Salve o registro antes de anexar" : "Anexos"}><Paperclip className="w-3.5 h-3.5" /></Button>}
          {showUtilityActions &&
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" className={iconButtonClass} title="Mais opções"><MoreHorizontal className="w-3.5 h-3.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-none p-1">
              <DropdownMenuItem onClick={onLayoutConfigClick} disabled={!onLayoutConfigClick} className="h-8 cursor-pointer gap-2 text-xs px-1">
                
                Layout do formulário
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
          {showUtilityActions && <Button type="button" variant="outline" size="icon" className={iconButtonClass} onClick={onSettingsClick}><Settings className="w-3.5 h-3.5" /></Button>}
          <div className="h-7 min-w-16 px-3 border-y-0 border-r-[0.5px] border-l-0 border-slate-300 bg-white flex items-center justify-center text-xs text-slate-600">
            {total > 0 ? `${currentIndex + 1}/${total}` : total}
          </div>
        </div>
      </div>
      <div className={`h-8 flex items-center gap-2 bg-white border-b-[0.5px] ${toolbarLineClass} px-2`}>
        <span className="px-1.5 py-0.5 rounded-sm bg-slate-500 text-white text-[11px] font-bold uppercase">{badgeLabel}</span>
        <span className="text-xs font-semibold text-slate-700 uppercase truncate min-w-0 flex-1">{title}</span>
        {operationLabel &&
        <span className="ml-auto text-[11px] font-bold text-emerald-700 uppercase whitespace-nowrap">
            {operationLabel}
          </span>
        }
      </div>
    </div>);

}